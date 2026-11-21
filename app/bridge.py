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

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
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
                            }
                        )

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

        retries = 0
        last_error = "Không kết nối được dsh-gemini-bridge."
        async with self._make_client(timeout_s=self.timeout_s) as client:
            for attempt in range(self.max_retries + 1):
                try:
                    resp = await client.post(
                        f"{target_base}/v1/chat/completions",
                        headers=self._headers(),
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

                lane_id = (resp.headers.get("x-gateway-lane") or clean_pin or "bridge").strip()
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
                )

        raise BridgeCallError(last_error)


def _parse_retry_after(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return max(0.0, min(60.0, float(value)))
    except ValueError:
        return None
