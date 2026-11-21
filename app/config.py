"""Cấu hình của WebChat Backend (cổng 3000, URL kết nối Bridge, model mặc định, đường dẫn dữ liệu).
- Sửa file này khi muốn đổi PORT (mặc định 3000), BRIDGE_URL (mặc định http://127.0.0.1:10000), hoặc DEFAULT_MODEL.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

WEBCHAT_DIR = Path(__file__).resolve().parent.parent

# Đọc .env từ thư mục webchat/ nếu có
if (WEBCHAT_DIR / ".env").exists():
    load_dotenv(WEBCHAT_DIR / ".env", override=False)


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 3000
    bridge_url: str = "http://127.0.0.1:10000"
    bridge_api_key: str = ""
    default_model: str = "gemini-4-hydrogen"
    bridge_timeout_s: float = 250.0
    bridge_max_retries: int = 2
    data_dir: Path = WEBCHAT_DIR / "data" / "rooms"
    dist_dir: Path = WEBCHAT_DIR / "dist"


def load_settings() -> Settings:
    raw_bridge = os.getenv("BRIDGE_URL", "http://127.0.0.1:10000").strip()
    return Settings(
        host=os.getenv("HOST", "127.0.0.1").strip() or "127.0.0.1",
        port=int(os.getenv("PORT", "3000").strip() or "3000"),
        bridge_url=raw_bridge.rstrip("/"),
        bridge_api_key=os.getenv("BRIDGE_API_KEY", os.getenv("API_KEY", "")).strip(),
        default_model=os.getenv("DEFAULT_MODEL", "gemini-4-hydrogen").strip() or "gemini-4-hydrogen",
        bridge_timeout_s=float(os.getenv("BRIDGE_TIMEOUT_S", "250").strip() or "250"),
        bridge_max_retries=int(os.getenv("BRIDGE_MAX_RETRIES", "2").strip() or "2"),
        data_dir=Path(os.getenv("WEBCHAT_DATA_DIR", str(WEBCHAT_DIR / "data" / "rooms"))),
        dist_dir=Path(os.getenv("WEBCHAT_DIST_DIR", str(WEBCHAT_DIR / "dist"))),
    )
