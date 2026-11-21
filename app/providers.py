"""Quản lý các nguồn AI (Providers): Bridge cục bộ, Gemini API chính thức, và OpenAI-compatible API.
- Lưu cấu hình vào webchat/data/providers.json (nằm trong .gitignore).
- Tuyệt đối không trả raw API key ra frontend (chỉ trả bản che như 'AIza...9x2Q').
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

import httpx

from app.bridge import AdapterResult, BridgeCallError, BridgeClient

_SAFE_LANE_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,32}$")


def mask_secret(secret: str) -> str:
    raw = (secret or "").strip()
    if not raw:
        return ""
    if len(raw) <= 8:
        return "*" * len(raw)
    return f"{raw[:4]}...{raw[-4:]}"


def _atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as tmp:
            tmp_name = tmp.name
            json.dump(data, tmp, ensure_ascii=False, indent=2)
            tmp.flush()
        os.replace(tmp_name, path)
        tmp_name = None
    finally:
        if tmp_name:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass


class LaneNameStore:
    """Lưu tên tự đặt của người dùng cho từng luồng Bridge (acc1, acc2, acc3...) trong lane_names.json."""

    def __init__(self, store_file: Path) -> None:
        self.store_file = Path(store_file)

    def load_all(self) -> dict[str, str]:
        if not self.store_file.is_file():
            return {}
        try:
            raw = json.loads(self.store_file.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                return {
                    str(k): str(v).strip()
                    for k, v in raw.items()
                    if _SAFE_LANE_ID_RE.match(str(k)) and str(v).strip()
                }
        except Exception:
            pass
        return {}

    def set_name(self, lane_id: str, custom_name: str) -> dict[str, str]:
        lid = str(lane_id or "").strip()
        if not _SAFE_LANE_ID_RE.match(lid):
            raise ValueError("Mã luồng không hợp lệ.")
        cleaned = str(custom_name or "").strip()[:60]
        data = self.load_all()
        if cleaned:
            data[lid] = cleaned
        else:
            data.pop(lid, None)
        _atomic_write_json(self.store_file, data)
        return data


class ProviderStore:
    """Lưu trữ và điều phối gọi AI tới đúng nguồn (Bridge / Gemini API / OpenAI-compatible)."""

    DEFAULT_BRIDGE_ID = "bridge-local"

    def __init__(self, store_file: Path, default_bridge_url: str, default_model: str) -> None:
        self.store_file = Path(store_file)
        self.default_bridge_url = (default_bridge_url or "http://127.0.0.1:10000").rstrip("/")
        self.default_model = default_model or "gemini-4-hydrogen"

    def _builtin_bridge(self) -> dict[str, Any]:
        return {
            "id": self.DEFAULT_BRIDGE_ID,
            "name": "DSH Gemini Bridge (Cục bộ)",
            "kind": "bridge",
            "baseUrl": self.default_bridge_url,
            "apiKey": "",
            "defaultModel": self.default_model,
            "builtin": True,
        }

    def _load_custom(self) -> list[dict[str, Any]]:
        if not self.store_file.is_file():
            return []
        try:
            raw = json.loads(self.store_file.read_text(encoding="utf-8"))
            if isinstance(raw, list):
                return [item for item in raw if isinstance(item, dict) and item.get("id")]
        except Exception:
            pass
        return []

    def _save_custom(self, items: list[dict[str, Any]]) -> None:
        _atomic_write_json(self.store_file, items)

    def list_raw(self) -> list[dict[str, Any]]:
        return [self._builtin_bridge(), *self._load_custom()]

    def list_public(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for p in self.list_raw():
            key = str(p.get("apiKey") or "")
            out.append(
                {
                    "id": p["id"],
                    "name": p.get("name") or p["id"],
                    "kind": p.get("kind") or "bridge",
                    "baseUrl": p.get("baseUrl") or "",
                    "defaultModel": p.get("defaultModel") or "",
                    "hasApiKey": bool(key),
                    "apiKeyMasked": mask_secret(key),
                    "builtin": bool(p.get("builtin", False)),
                }
            )
        return out

    def get_raw(self, provider_id: str | None) -> dict[str, Any] | None:
        if not provider_id or provider_id == self.DEFAULT_BRIDGE_ID:
            return self._builtin_bridge()
        for item in self._load_custom():
            if item.get("id") == provider_id:
                return item
        return None

    def add_provider(self, payload: dict[str, Any]) -> dict[str, Any]:
        kind = str(payload.get("kind") or "").strip().lower()
        if kind not in ("bridge", "gemini_api", "openai_compat"):
            raise ValueError("Loại nguồn AI phải là 'bridge', 'gemini_api', hoặc 'openai_compat'.")

        name = str(payload.get("name") or "").strip()
        if not name:
            raise ValueError("Vui lòng đặt tên gợi nhớ cho AI.")

        base_url = str(payload.get("baseUrl") or "").strip().rstrip("/")
        api_key = str(payload.get("apiKey") or "").strip()
        default_model = str(payload.get("defaultModel") or "").strip()

        if kind == "bridge":
            base_url = base_url or self.default_bridge_url
            default_model = default_model or self.default_model
        elif kind == "gemini_api":
            if not api_key:
                raise ValueError("Cần nhập Gemini API Key (lấy tại aistudio.google.com).")
            base_url = base_url or "https://generativelanguage.googleapis.com/v1beta"
            default_model = default_model or "gemini-2.5-flash"
        elif kind == "openai_compat":
            if not base_url:
                raise ValueError("Cần nhập Base URL (vd: https://api.openai.com/v1 hoặc http://127.0.0.1:11434/v1).")
            if not default_model:
                raise ValueError("Cần nhập tên Model (vd: gpt-4o-mini, deepseek-chat, llama-3.3-70b-versatile).")

        item = {
            "id": f"prov-{uuid.uuid4().hex[:8]}",
            "name": name[:80],
            "kind": kind,
            "baseUrl": base_url,
            "apiKey": api_key,
            "defaultModel": default_model,
            "builtin": False,
        }
        items = self._load_custom()
        items.append(item)
        self._save_custom(items)
        return {
            "id": item["id"],
            "name": item["name"],
            "kind": item["kind"],
            "baseUrl": item["baseUrl"],
            "defaultModel": item["defaultModel"],
            "hasApiKey": bool(api_key),
            "apiKeyMasked": mask_secret(api_key),
            "builtin": False,
        }

    def delete_provider(self, provider_id: str) -> bool:
        if provider_id == self.DEFAULT_BRIDGE_ID:
            raise ValueError("Không thể xoá nguồn Bridge mặc định.")
        items = self._load_custom()
        next_items = [p for p in items if p.get("id") != provider_id]
        if len(next_items) == len(items):
            return False
        self._save_custom(next_items)
        return True

    async def discover_models(self, default_bridge: BridgeClient) -> list[dict[str, Any]]:
        """Lấy danh sách model thật từ Bridge (/v1/models) cộng thêm model của các API provider đã nạp."""
        models: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()

        # 1. Hỏi danh sách model thật đang có trên Bridge cục bộ
        if default_bridge.base_url:
            try:
                async with default_bridge._make_client(timeout_s=4.0) as client:
                    r = await client.get(
                        f"{default_bridge.base_url}/v1/models",
                        headers=default_bridge._headers(),
                    )
                    if r.status_code == 200:
                        data = r.json()
                        for entry in data.get("data") or []:
                            if not isinstance(entry, dict):
                                continue
                            mid = str(entry.get("id") or "").strip()
                            if not mid or (self.DEFAULT_BRIDGE_ID, mid) in seen:
                                continue
                            seen.add((self.DEFAULT_BRIDGE_ID, mid))
                            disp = str(entry.get("display_name") or "").strip()
                            desc = str(entry.get("description") or "").strip()
                            label = f"{desc} — {disp}" if (desc and disp and desc != disp) else (desc or disp or mid)
                            models.append(
                                {
                                    "id": mid,
                                    "label": label,
                                    "providerId": self.DEFAULT_BRIDGE_ID,
                                    "providerName": "Bridge",
                                }
                            )
            except Exception:
                pass

        if not any(m["providerId"] == self.DEFAULT_BRIDGE_ID for m in models):
            models.append(
                {
                    "id": self.default_model,
                    "label": self.default_model,
                    "providerId": self.DEFAULT_BRIDGE_ID,
                    "providerName": "Bridge",
                }
            )

        # 2. Ghép thêm các model từ các provider người dùng tự nạp
        for p in self._load_custom():
            pid = p["id"]
            mid = str(p.get("defaultModel") or "").strip()
            if mid and (pid, mid) not in seen:
                seen.add((pid, mid))
                models.append(
                    {
                        "id": mid,
                        "label": f"{mid} ({p.get('name')})",
                        "providerId": pid,
                        "providerName": p.get("name") or pid,
                    }
                )

        return models

    async def complete(
        self,
        *,
        default_bridge: BridgeClient,
        provider_id: str | None,
        system_instruction: str,
        user_prompt: str,
        model: str | None = None,
        pinned_lane_id: str | None = None,
    ) -> AdapterResult:
        prov = self.get_raw(provider_id)
        if prov is None:
            raise BridgeCallError(f"Không tìm thấy nguồn AI '{provider_id}'.")

        kind = prov.get("kind") or "bridge"
        chosen_model = (model or prov.get("defaultModel") or self.default_model).strip()

        if kind == "bridge":
            if prov["id"] == self.DEFAULT_BRIDGE_ID:
                return await default_bridge.chat_stateless(
                    system_instruction=system_instruction,
                    user_prompt=user_prompt,
                    model=chosen_model,
                    pinned_lane_id=pinned_lane_id,
                )
            custom_bridge = BridgeClient(
                prov["baseUrl"],
                api_key=str(prov.get("apiKey") or ""),
                default_model=chosen_model,
                timeout_s=default_bridge.timeout_s,
                max_retries=default_bridge.max_retries,
            )
            return await custom_bridge.chat_stateless(
                system_instruction=system_instruction,
                user_prompt=user_prompt,
                model=chosen_model,
                pinned_lane_id=pinned_lane_id,
            )

        if kind == "gemini_api":
            return await _call_gemini_official_api(
                base_url=prov["baseUrl"],
                api_key=str(prov.get("apiKey") or ""),
                model=chosen_model,
                system_instruction=system_instruction,
                user_prompt=user_prompt,
                lane_label=prov.get("name") or prov["id"],
            )

        return await _call_openai_compat_api(
            base_url=prov["baseUrl"],
            api_key=str(prov.get("apiKey") or ""),
            model=chosen_model,
            system_instruction=system_instruction,
            user_prompt=user_prompt,
            lane_label=prov.get("name") or prov["id"],
        )


async def _call_gemini_official_api(
    *,
    base_url: str,
    api_key: str,
    model: str,
    system_instruction: str,
    user_prompt: str,
    lane_label: str,
) -> AdapterResult:
    clean_base = base_url.rstrip("/")
    endpoint = f"{clean_base}/models/{model}:generateContent"
    payload: dict[str, Any] = {
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
    }
    if system_instruction.strip():
        payload["systemInstruction"] = {"parts": [{"text": system_instruction.strip()}]}

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0)) as client:
            resp = await client.post(
                endpoint,
                params={"key": api_key},
                headers={"Content-Type": "application/json"},
                json=payload,
            )
    except httpx.HTTPError as exc:
        raise BridgeCallError(f"Lỗi kết nối Gemini API: {exc}") from exc

    if resp.status_code != 200:
        raise BridgeCallError(f"Gemini API trả HTTP {resp.status_code}: {resp.text[:240]}")

    data = resp.json()
    candidates = data.get("candidates") or []
    parts = ((candidates[0].get("content") or {}).get("parts") or []) if candidates else []
    text = "".join(str(p.get("text") or "") for p in parts if isinstance(p, dict)).strip()
    if not text:
        raise BridgeCallError("Gemini API trả về nội dung rỗng.")

    return AdapterResult(
        text=text,
        model_used=model,
        lane_id=f"api:{lane_label}",
        fallback_from=None,
        retries=0,
        raw_prompt=f"{system_instruction}\n\n{user_prompt}".strip(),
    )


async def _call_openai_compat_api(
    *,
    base_url: str,
    api_key: str,
    model: str,
    system_instruction: str,
    user_prompt: str,
    lane_label: str,
) -> AdapterResult:
    clean = base_url.rstrip("/")
    if clean.endswith("/chat/completions"):
        endpoint = clean
    elif clean.endswith("/v1"):
        endpoint = f"{clean}/chat/completions"
    else:
        endpoint = f"{clean}/v1/chat/completions"

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    messages: list[dict[str, str]] = []
    if system_instruction.strip():
        messages.append({"role": "system", "content": system_instruction.strip()})
    messages.append({"role": "user", "content": user_prompt})

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0)) as client:
            resp = await client.post(
                endpoint,
                headers=headers,
                json={"model": model, "stream": False, "messages": messages},
            )
    except httpx.HTTPError as exc:
        raise BridgeCallError(f"Lỗi kết nối API ({clean}): {exc}") from exc

    if resp.status_code != 200:
        raise BridgeCallError(f"API trả HTTP {resp.status_code}: {resp.text[:240]}")

    data = resp.json()
    choices = data.get("choices") or []
    content = ""
    if choices and isinstance(choices[0], dict):
        msg = choices[0].get("message") or {}
        raw = msg.get("content")
        if isinstance(raw, list):
            content = "".join(str(p.get("text", "")) for p in raw if isinstance(p, dict)).strip()
        elif raw is not None:
            content = str(raw).strip()
    if not content:
        raise BridgeCallError("API trả về nội dung rỗng.")

    return AdapterResult(
        text=content,
        model_used=str(data.get("model") or model),
        lane_id=f"api:{lane_label}",
        fallback_from=None,
        retries=0,
        raw_prompt=f"{system_instruction}\n\n{user_prompt}".strip(),
    )
