"""Cấu hình của WebChat Backend (cổng 3000, URL kết nối Bridge, timeout liveness, bảo vệ chia sẻ từ xa).
- Sửa file này hoặc .env khi muốn đổi PORT, BRIDGE_URL, DEFAULT_MODEL, BRIDGE_IDLE_TIMEOUT_S, hoặc WEBCHAT_SHARE_TOKEN.
"""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from dotenv import load_dotenv

WEBCHAT_DIR = Path(__file__).resolve().parent.parent
SHARE_TOKEN_FILE = WEBCHAT_DIR / ".share_token"

# Đọc .env từ thư mục webchat/ nếu có
if (WEBCHAT_DIR / ".env").exists():
    load_dotenv(WEBCHAT_DIR / ".env", override=False)


def _read_share_token_file() -> str:
    try:
        if SHARE_TOKEN_FILE.is_file():
            return SHARE_TOKEN_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        pass
    return ""


def resolve_active_share_token(cfg: "Settings", runtime_token: str = "") -> str:
    """Trả về token chia sẻ đang hiệu lực từ runtime memory hoặc Settings (.env / .share_token)."""
    return (runtime_token or cfg.share_token or "").strip()


def ensure_share_token_file() -> str:
    """Đọc hoặc sinh mới passcode chia sẻ an toàn và lưu vào webchat/.share_token (chặn bởi .gitignore)."""
    existing = os.getenv("WEBCHAT_SHARE_TOKEN", "").strip() or _read_share_token_file()
    if existing:
        return existing
    token = secrets.token_urlsafe(12)
    SHARE_TOKEN_FILE.write_text(token + "\n", encoding="utf-8")
    return token


_LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost", "testclient"}
_LOCAL_SERVER_HOSTS = {"127.0.0.1", "localhost", "::1", "testserver", ""}
_PROXY_TUNNEL_HEADERS = (
    "cf-connecting-ip",
    "cf-ray",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-real-ip",
    "forwarded",
)


def _extract_hostname(raw_host_or_url: str, *, is_url: bool = False) -> str:
    clean = (raw_host_or_url or "").strip()
    if not clean:
        return ""
    try:
        parsed = urlsplit(clean if is_url else f"//{clean}")
        return (parsed.hostname or "").strip().lower()
    except ValueError:
        return clean.lower()


def is_direct_local_request(request: Any) -> bool:
    """Phân biệt truy cập trực tiếp từ máy chủ với truy cập qua Cloudflare Tunnel / ngrok / GitHub Pages."""
    client = getattr(request, "client", None)
    client_host = (getattr(client, "host", "") or "").strip().lower()
    if client_host not in _LOCAL_HOSTS:
        return False

    headers = getattr(request, "headers", None) or {}
    for hdr in _PROXY_TUNNEL_HEADERS:
        if headers.get(hdr):
            return False

    host_hdr = headers.get("host") or ""
    if _extract_hostname(host_hdr, is_url=False) not in _LOCAL_SERVER_HOSTS:
        return False

    origin_hdr = headers.get("origin") or ""
    if origin_hdr and _extract_hostname(origin_hdr, is_url=True) not in _LOCAL_SERVER_HOSTS:
        return False

    return True


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 3000
    bridge_url: str = "http://127.0.0.1:10000"
    bridge_api_key: str = ""
    default_model: str = "gemini-4-hydrogen"
    bridge_timeout_s: float = 250.0
    bridge_idle_timeout_s: float = 90.0
    bridge_max_retries: int = 2
    share_token: str = ""
    cors_origins: tuple[str, ...] = ("*",)
    data_dir: Path = WEBCHAT_DIR / "data" / "rooms"
    dist_dir: Path = WEBCHAT_DIR / "dist"


def load_settings() -> Settings:
    raw_bridge = os.getenv("BRIDGE_URL", "http://127.0.0.1:10000").strip()
    raw_cors = os.getenv("WEBCHAT_CORS_ORIGINS", "*").strip()
    cors_tuple = tuple(p.strip() for p in raw_cors.split(",") if p.strip()) or ("*",)
    raw_token = os.getenv("WEBCHAT_SHARE_TOKEN", "").strip() or _read_share_token_file()
    return Settings(
        host=os.getenv("HOST", "127.0.0.1").strip() or "127.0.0.1",
        port=int(os.getenv("PORT", "3000").strip() or "3000"),
        bridge_url=raw_bridge.rstrip("/"),
        bridge_api_key=os.getenv("BRIDGE_API_KEY", os.getenv("API_KEY", "")).strip(),
        default_model=os.getenv("DEFAULT_MODEL", "gemini-4-hydrogen").strip() or "gemini-4-hydrogen",
        bridge_timeout_s=float(os.getenv("BRIDGE_TIMEOUT_S", "250").strip() or "250"),
        bridge_idle_timeout_s=float(os.getenv("BRIDGE_IDLE_TIMEOUT_S", "90").strip() or "90"),
        bridge_max_retries=int(os.getenv("BRIDGE_MAX_RETRIES", "2").strip() or "2"),
        share_token=raw_token,
        cors_origins=cors_tuple,
        data_dir=Path(os.getenv("WEBCHAT_DATA_DIR", str(WEBCHAT_DIR / "data" / "rooms"))),
        dist_dir=Path(os.getenv("WEBCHAT_DIST_DIR", str(WEBCHAT_DIR / "dist"))),
    )
