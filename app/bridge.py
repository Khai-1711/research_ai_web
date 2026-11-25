"""Bộ kết nối (client) từ WebChat sang Bridge (:10000).
- Ghép system instruction + user prompt thành 1 tin nhắn user duy nhất (vì Bridge bỏ qua role='system').
- Tự động retry khi gặp lỗi 429/503 và tự động fallback về model 'auto' nếu tài khoản chưa có model chỉ định.
"""

from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import httpx
from json_repair import repair_json

RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}


def _is_loopback_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").strip().lower()
        return parsed.scheme in ("http", "https") and host in ("127.0.0.1", "localhost", "::1")
    except Exception:
        return False


class BridgeCallError(Exception):
    """Raised when dsh-gemini-bridge cannot fulfill a turn."""


@dataclass(frozen=True)
class AdapterResult:
    text: str
    model_used: str
    lane_id: str
    fallback_from: str | None = None
    retries: int = 0
    raw_prompt: str = ""
    # Provenance: lane_source cho biết laneId lấy từ đâu ("gateway" = header X-Gateway-Lane của Bridge,
    # "pinned" = luồng ghim, "api" = provider API, "unreported" = Bridge không báo lane thực tế).
    lane_source: str = ""
    provider_id: str = ""
    provider_kind: str = ""
    model_requested: str = ""

    def provenance(self) -> dict[str, Any]:
        return {
            "providerId": self.provider_id,
            "providerKind": self.provider_kind,
            "modelRequested": self.model_requested,
            "modelUsed": self.model_used,
            "fallbackFrom": self.fallback_from,
            "laneId": self.lane_id,
            "laneSource": self.lane_source or "unreported",
            "retries": self.retries,
        }


def compile_stateless_user_prompt(system_instruction: str, user_prompt: str) -> str:
    """Merge system instructions into one user message so dsh-gemini-bridge never drops role='system'."""
    sys_clean = (system_instruction or "").strip()
    usr_clean = (user_prompt or "").strip()
    if not sys_clean:
        return usr_clean
    return f"[VAI TRÒ & QUY TẮC BẮT BUỘC]\n{sys_clean}\n\n---\n\n{usr_clean}"


def parse_resilient_json(text: str) -> dict[str, Any]:
    """Extract and repair the first JSON object from LLM output (tolerates fences and prose)."""
    raw = (text or "").strip()
    if not raw:
        return {}

    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.IGNORECASE)
    candidate = fence.group(1).strip() if fence else raw

    # Find balanced outermost JSON object
    start = candidate.find("{")
    if start != -1:
        depth = 0
        in_str = False
        escaped = False
        end = -1
        for i in range(start, len(candidate)):
            ch = candidate[i]
            if in_str:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    in_str = False
            else:
                if ch == '"':
                    in_str = True
                elif ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        end = i + 1
                        break
        if end != -1:
            candidate = candidate[start:end]
        else:
            candidate = candidate[start:]

    try:
        parsed = json.loads(candidate)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    try:
        repaired = repair_json(candidate, return_objects=True)
        if isinstance(repaired, dict):
            return repaired
    except Exception:
        pass
    return {}


class BridgeClient:
    """HTTP client tailored for dsh-gemini-bridge (:10000 Gateway or direct worker)."""

    def __init__(
        self,
        base_url: str,
        *,
        api_key: str = "",
        default_model: str = "gemini-4-hydrogen",
        timeout_s: float = 250.0,
        max_retries: int = 2,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = (base_url or "").strip().rstrip("/")
        self.api_key = (api_key or "").strip()
        self.default_model = default_model
        self.timeout_s = float(timeout_s)
        self.max_retries = max(0, int(max_retries))
        self._transport = transport

    def _headers(
        self,
        *,
        ephemeral: bool = False,
        exclude_lanes: list[str] | set[str] | None = None,
    ) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if ephemeral:
            headers["X-DSH-Ephemeral"] = "1"
        if exclude_lanes:
            cleaned = sorted({str(x).strip() for x in exclude_lanes if str(x).strip()})
            if cleaned:
                headers["X-Exclude-Lanes"] = ",".join(cleaned)
        return headers

    def _make_client(self, timeout_s: float) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=timeout_s, write=30.0, pool=10.0),
            transport=self._transport,
        )

    async def check_health(self) -> dict[str, Any]:
        """Inspect /v1/lanes (matching real dsh-gemini-bridge schema) with /health fallback."""
        if not self.base_url:
            return {
                "mode": "bridge",
                "bridgeUrl": None,
                "healthyWorkers": 0,
                "totalWorkers": 0,
                "lanes": [],
                "laneDetails": [],
                "guestMode": False,
                "bridgeOffline": True,
                "defaultModel": self.default_model,
            }

        try:
            async with self._make_client(timeout_s=5.0) as client:
                r = await client.get(f"{self.base_url}/v1/lanes", headers=self._headers())
                if r.status_code == 200:
                    data = r.json()
                    raw_lanes = data.get("lanes") if isinstance(data, dict) else []
                    workers = [l for l in (raw_lanes or []) if isinstance(l, dict) and not l.get("is_self")]
                    if not workers and raw_lanes:
                        workers = [l for l in raw_lanes if isinstance(l, dict)]

                    profiles_list: list[dict[str, Any]] = []
                    browser_name: str | None = None
                    try:
                        rp = await client.get(
                            f"{self.base_url}/v1/profiles",
                            headers=self._headers(),
                            timeout=3.0,
                        )
                        if rp.status_code == 200 and rp.content:
                            pdata = rp.json()
                            if isinstance(pdata, dict):
                                raw_profs = pdata.get("profiles") or []
                                profiles_list = [p for p in raw_profs if isinstance(p, dict)]
                                bname = str(pdata.get("browser_name") or "").strip()
                                if bname:
                                    browser_name = bname
                    except Exception:
                        pass

                    profiles_by_id = {
                        str(p.get("profile_id") or ""): p
                        for p in profiles_list
                        if p.get("profile_id")
                    }
                    profiles_by_lane: dict[str, dict[str, Any]] = {}
                    for p in profiles_list:
                        plid = str(p.get("lane_id") or "").strip()
                        pslot = p.get("slot")
                        if plid and (pslot is None or pslot == 0):
                            profiles_by_lane.setdefault(plid, p)

                    lane_ids: list[str] = []
                    lane_details: list[dict[str, Any]] = []
                    healthy_count = 0
                    guest_detected = False
                    for i, w in enumerate(workers):
                        lid = str(w.get("id") or f"acc{i + 1}")
                        lane_ids.append(lid)
                        reachable = w.get("reachable") is True
                        control = str(w.get("control") or "off")
                        is_on = control == "on"
                        auth_ok = w.get("auth_ok") is True
                        acc_status = str(w.get("account_status") or "")
                        exhausted = acc_status.upper() == "EXHAUSTED"
                        if reachable and is_on and auth_ok and not exhausted:
                            healthy_count += 1
                        if reachable and is_on and not auth_ok:
                            guest_detected = True
                        bridge_label = str(w.get("label") or lid).strip() or lid
                        prof = profiles_by_lane.get(lid) or profiles_by_id.get(lid)
                        acc_key = str(
                            w.get("account_key")
                            or (prof or {}).get("last_account_key")
                            or ""
                        ).strip()
                        raw_overlaps = [
                            str(ov.get("other_instance") or "").strip()
                            for ov in (w.get("chain_overlap") or [])
                            if isinstance(ov, dict) and ov.get("other_instance")
                        ]
                        lane_details.append(
                            {
                                "id": lid,
                                "name": bridge_label,
                                "bridgeLabel": bridge_label,
                                "url": str(w.get("url") or "").rstrip("/"),
                                "reachable": reachable,
                                "control": control,
                                "authOk": auth_ok,
                                "model": str(w.get("model") or self.default_model),
                                "accountStatus": acc_status or ("AVAILABLE" if auth_ok else "GUEST"),
                                "accountKey": acc_key,
                                "duplicatedWith": raw_overlaps,
                                "profileId": str((prof or {}).get("profile_id") or lid),
                                "hasProfileData": bool((prof or {}).get("has_profile_data", False)),
                                "loginOpen": bool((prof or {}).get("login_open", False)),
                                "syncing": bool((prof or {}).get("syncing", False)),
                                "lastSyncStatus": str((prof or {}).get("last_sync_status") or ""),
                                "lastSyncError": (prof or {}).get("last_sync_error"),
                                "lastSyncAt": int((prof or {}).get("last_sync_at") or 0),
                            }
                        )

                    for d in lane_details:
                        dups = list(d["duplicatedWith"])
                        my_key = d["accountKey"]
                        if my_key:
                            for other in lane_details:
                                if other["id"] != d["id"] and other["accountKey"] == my_key:
                                    if other["id"] not in dups:
                                        dups.append(other["id"])
                        d["duplicatedWith"] = [x for x in dups if x and x != d["id"]]

                    return {
                        "mode": "bridge",
                        "bridgeUrl": self.base_url,
                        "healthyWorkers": healthy_count,
                        "totalWorkers": len(workers),
                        "lanes": lane_ids,
                        "laneDetails": lane_details,
                        "guestMode": guest_detected,
                        "bridgeOffline": False,
                        "defaultModel": self.default_model,
                        "cookieSyncBrowser": browser_name,
                    }

                # Fallback for single-worker bridge without Gateway /v1/lanes
                rh = await client.get(f"{self.base_url}/health", headers=self._headers())
                if rh.status_code == 200:
                    hd = rh.json() if rh.content else {}
                    auth_ok = bool(hd.get("auth_ok", True))
                    control = str(hd.get("control") or "on")
                    is_on = control == "on"
                    lid = str(hd.get("instance_id") or "default")
                    lbl = str(hd.get("instance_label") or lid)
                    model_name = str(hd.get("model") or self.default_model)
                    return {
                        "mode": "bridge",
                        "bridgeUrl": self.base_url,
                        "healthyWorkers": 1 if (is_on and auth_ok) else 0,
                        "totalWorkers": 1,
                        "lanes": [lid],
                        "laneDetails": [
                            {
                                "id": lid,
                                "name": lbl,
                                "bridgeLabel": lbl,
                                "url": self.base_url,
                                "reachable": True,
                                "control": control,
                                "authOk": auth_ok,
                                "model": model_name,
                                "accountStatus": "AVAILABLE" if auth_ok else "GUEST",
                            }
                        ],
                        "guestMode": bool(is_on and not auth_ok),
                        "bridgeOffline": False,
                        "defaultModel": model_name,
                    }
        except Exception:
            pass

        return {
            "mode": "bridge",
            "bridgeUrl": self.base_url,
            "healthyWorkers": 0,
            "totalWorkers": 0,
            "lanes": [],
            "laneDetails": [],
            "guestMode": False,
            "bridgeOffline": True,
            "defaultModel": self.default_model,
        }

    async def _admin_post(
        self,
        path: str,
        payload: dict[str, Any] | None = None,
        *,
        timeout_s: float = 30.0,
    ) -> dict[str, Any]:
        """Call a loopback Bridge admin/Profile Vault POST endpoint cleanly."""
        if not self.base_url:
            raise BridgeCallError("Chưa cấu hình BRIDGE_URL (vd: http://127.0.0.1:10000).")
        headers = {**self._headers(), "Origin": self.base_url}
        try:
            async with self._make_client(timeout_s=timeout_s) as client:
                resp = await client.post(
                    f"{self.base_url}{path}",
                    headers=headers,
                    json=payload or {},
                )
        except Exception as exc:
            raise BridgeCallError(f"Không kết nối được Bridge ({self.base_url}{path}): {exc}") from exc

        try:
            data = resp.json() if resp.content else {}
        except ValueError:
            data = {}
        if resp.status_code >= 400:
            err_obj = data.get("error") if isinstance(data, dict) else None
            if isinstance(err_obj, dict):
                err_msg = str(err_obj.get("message") or err_obj.get("code") or f"HTTP {resp.status_code}")
            elif err_obj:
                err_msg = str(err_obj)
            else:
                err_msg = resp.text[:220] or f"Bridge trả lỗi HTTP {resp.status_code}"
            raise BridgeCallError(err_msg)
        return data if isinstance(data, dict) else {"result": data}

    async def create_lane(self) -> dict[str, Any]:
        return await self._admin_post("/v1/lanes/create", {}, timeout_s=20.0)

    async def start_lane_login(self, lane_id: str, label: str = "") -> dict[str, Any]:
        lid = (lane_id or "").strip()
        if not lid:
            raise BridgeCallError("Thiếu mã luồng (lane_id).")
        return await self._admin_post(
            f"/v1/profiles/{lid}/login",
            {"lane_id": lid, "slot": 0, "label": (label or lid).strip()},
            timeout_s=15.0,
        )

    async def finish_lane_login(self, lane_id: str) -> dict[str, Any]:
        lid = (lane_id or "").strip()
        if not lid:
            raise BridgeCallError("Thiếu mã luồng (lane_id).")
        return await self._admin_post(
            f"/v1/profiles/{lid}/finish-login",
            {},
            timeout_s=45.0,
        )

    async def sync_lane_cookie(self, lane_id: str, label: str = "") -> dict[str, Any]:
        lid = (lane_id or "").strip()
        if not lid:
            raise BridgeCallError("Thiếu mã luồng (lane_id).")
        payload: dict[str, Any] = {"lane_id": lid, "slot": 0}
        if (label or "").strip():
            payload["label"] = label.strip()
        return await self._admin_post(
            f"/v1/profiles/{lid}/sync",
            payload,
            timeout_s=45.0,
        )

    async def sync_all_lane_cookies(self) -> dict[str, Any]:
        return await self._admin_post("/v1/profiles/sync-all", {}, timeout_s=120.0)

    async def resolve_lane_url(self, pinned_lane_id: str) -> str:
        """Resolve a pinned worker lane ID (e.g. 'acc1') via Gateway /v1/lanes to its direct loopback URL."""
        target_id = (pinned_lane_id or "").strip()
        if not target_id:
            return self.base_url
        try:
            async with self._make_client(timeout_s=5.0) as client:
                r = await client.get(f"{self.base_url}/v1/lanes", headers=self._headers())
        except Exception as exc:
            raise BridgeCallError(
                f"Không thể tra cứu luồng '{target_id}' từ Gateway ({self.base_url}): {exc}"
            ) from exc

        if r.status_code != 200:
            raise BridgeCallError(
                f"Gateway không trả danh sách luồng (/v1/lanes HTTP {r.status_code}) khi ghim '{target_id}'."
            )

        data = r.json() if r.content else {}
        lanes = data.get("lanes") if isinstance(data, dict) else []
        match = next(
            (l for l in (lanes or []) if isinstance(l, dict) and str(l.get("id") or "") == target_id),
            None,
        )
        if not match:
            raise BridgeCallError(
                f"Không tìm thấy tài khoản '{target_id}' trên Bridge. Hãy kiểm tra lại luồng đã ghim."
            )
        if match.get("reachable") is not True or match.get("control") != "on":
            raise BridgeCallError(
                f"Tài khoản '{target_id}' hiện đang TẮT hoặc không phản hồi (không tự chạy sang acc khác vì bạn đã ghim riêng)."
            )
        lane_url = str(match.get("url") or "").strip().rstrip("/")
        if not lane_url or not _is_loopback_url(lane_url):
            raise BridgeCallError(
                f"Địa chỉ của luồng '{target_id}' không hợp lệ hoặc không phải máy cục bộ."
            )
        return lane_url

    async def chat_stateless(
        self,
        *,
        system_instruction: str,
        user_prompt: str,
        model: str | None = None,
        pinned_lane_id: str | None = None,
        exclude_lanes: list[str] | set[str] | None = None,
    ) -> AdapterResult:
        """Send a stateless non-streaming single-user-message turn with retry/backoff."""
        if not self.base_url:
            raise BridgeCallError("Chưa cấu hình BRIDGE_URL (vd: http://127.0.0.1:10000).")

        clean_pin = (pinned_lane_id or "").strip()
        target_base = await self.resolve_lane_url(clean_pin) if clean_pin else self.base_url

        requested_model = (model or self.default_model).strip() or self.default_model
        combined_prompt = compile_stateless_user_prompt(system_instruction, user_prompt)
        payload = {
            "model": requested_model,
            "stream": False,
            "messages": [{"role": "user", "content": combined_prompt}],
        }
        req_headers = self._headers(
            ephemeral=True,
            exclude_lanes=None if clean_pin else exclude_lanes,
        )

        retries = 0
        last_error = "Không kết nối được dsh-gemini-bridge."
        async with self._make_client(timeout_s=self.timeout_s) as client:
            for attempt in range(self.max_retries + 1):
                try:
                    resp = await client.post(
                        f"{target_base}/v1/chat/completions",
                        headers=req_headers,
                        json=payload,
                    )
                except (httpx.ConnectError, httpx.TimeoutException, httpx.RemoteProtocolError) as exc:
                    last_error = f"Không kết nối được dsh-gemini-bridge ({target_base}): {exc}"
                    if attempt < self.max_retries:
                        retries += 1
                        await asyncio.sleep(min(15.0, 2.0 * (2**attempt)))
                        continue
                    raise BridgeCallError(last_error) from exc

                if resp.status_code in RETRYABLE_STATUS:
                    body_snippet = resp.text[:220]
                    last_error = f"dsh-gemini-bridge trả HTTP {resp.status_code}: {body_snippet}"
                    if attempt < self.max_retries:
                        retries += 1
                        retry_after = _parse_retry_after(resp.headers.get("retry-after"))
                        wait_s = retry_after if retry_after is not None else min(20.0, 3.0 * (2**attempt))
                        await asyncio.sleep(wait_s)
                        continue
                    raise BridgeCallError(last_error)

                if resp.status_code == 400 and "model_not_available" in resp.text and payload.get("model") != "auto":
                    payload["model"] = "auto"
                    retries += 1
                    continue

                if resp.status_code != 200:
                    raise BridgeCallError(
                        f"dsh-gemini-bridge trả lỗi HTTP {resp.status_code}: {resp.text[:220]}"
                    )

                try:
                    data = resp.json()
                except ValueError as exc:
                    raise BridgeCallError("dsh-gemini-bridge trả phản hồi không phải JSON.") from exc

                choices = data.get("choices") or []
                content = ""
                if choices and isinstance(choices[0], dict):
                    msg = choices[0].get("message") or {}
                    raw_content = msg.get("content")
                    if isinstance(raw_content, list):
                        content = "".join(
                            str(p.get("text", "")) for p in raw_content if isinstance(p, dict)
                        ).strip()
                    elif raw_content is not None:
                        content = str(raw_content).strip()

                if not content:
                    raise BridgeCallError("dsh-gemini-bridge trả về nội dung rỗng.")

                header_lane = (resp.headers.get("x-gateway-lane") or "").strip()
                lane_id = (header_lane or clean_pin or "bridge").strip()
                lane_source = "gateway" if header_lane else ("pinned" if clean_pin else "unreported")
                actual_model = (
                    resp.headers.get("x-actual-model")
                    or data.get("model")
                    or requested_model
                ).strip()
                fallback_from = (
                    resp.headers.get("x-fallback-from")
                    or data.get("fallback_from")
                    or ""
                ).strip() or (
                    requested_model if actual_model != requested_model else None
                )

                return AdapterResult(
                    text=content,
                    model_used=actual_model,
                    lane_id=lane_id,
                    fallback_from=fallback_from,
                    retries=retries,
                    raw_prompt=combined_prompt,
                    lane_source=lane_source,
                    model_requested=requested_model,
                )

        raise BridgeCallError(last_error)


def _parse_retry_after(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return max(0.0, min(60.0, float(value)))
    except ValueError:
        return None
