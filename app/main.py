r"""Điểm vào chính của WebChat Backend (FastAPI trên http://127.0.0.1:3000).
- Phục vụ cả API (/api/*) lẫn giao diện React đã build trong webchat/dist/ (trang / và trang /flow).
- Hỗ trợ CORS cho GitHub Pages + bảo vệ truy cập từ xa bằng WEBCHAT_SHARE_TOKEN và khóa API quản trị máy chủ.
- Chạy từ gốc dự án: python start.py (hoặc python start.py share để mở link cho bạn test).
"""

from __future__ import annotations

import hmac
import sys
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.bridge import BridgeClient
from app.config import (
    Settings,
    is_direct_local_request,
    load_settings,
    resolve_active_share_token,
)
from app.providers import ProviderStore
from app.routes import build_api_router
from app.storage import RoomStorage

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def _is_host_admin_api(method: str, path: str) -> bool:
    """Chặn thao tác nhạy cảm (mở trình duyệt đăng nhập Cookie, tạo tiến trình, sửa/xóa provider, đọc mã gốc) từ xa."""
    clean_method = method.upper()
    if path in ("/api/lanes/create", "/api/lanes/sync-all") or path.startswith("/api/share-info"):
        return True
    if path.startswith("/api/lanes/"):
        if (
            path.endswith("/login")
            or path.endswith("/finish-login")
            or path.endswith("/sync")
            or clean_method == "PATCH"
        ):
            return True
    if path == "/api/providers" and clean_method == "POST":
        return True
    if path.startswith("/api/providers/") and clean_method == "DELETE":
        return True
    return False


def _extract_request_share_token(request: Request) -> str:
    tok = (request.headers.get("x-share-token") or "").strip()
    if tok:
        return tok
    auth = (request.headers.get("authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return str(request.query_params.get("share_token") or "").strip()


def create_app(
    settings: Settings | None = None,
    *,
    bridge_client: BridgeClient | None = None,
) -> FastAPI:
    cfg = settings or load_settings()
    storage = RoomStorage(cfg.data_dir, default_model=cfg.default_model)
    storage.ensure_default_room()
    bridge = bridge_client or BridgeClient(
        cfg.bridge_url,
        api_key=cfg.bridge_api_key,
        default_model=cfg.default_model,
        timeout_s=cfg.bridge_timeout_s,
        idle_timeout_s=cfg.bridge_idle_timeout_s,
        max_retries=cfg.bridge_max_retries,
    )

    providers = ProviderStore(
        store_file=cfg.data_dir.parent / "providers.json",
        default_bridge_url=cfg.bridge_url,
        default_model=cfg.default_model,
    )

    app = FastAPI(title="Research Lab & Visual AI Flow Map (Python Backend)", version="0.1.0")
    app.state.settings = cfg
    app.state.storage = storage
    app.state.bridge = bridge
    app.state.providers = providers
    app.state.runtime_share_token = cfg.share_token

    @app.middleware("http")
    async def remote_share_security_middleware(request: Request, call_next):
        path = request.url.path or ""
        if path.startswith("/api/") and request.method.upper() != "OPTIONS":
            if not is_direct_local_request(request):
                if _is_host_admin_api(request.method, path):
                    return JSONResponse(
                        status_code=403,
                        content={
                            "error": "Thao tác quản trị máy chủ (đăng nhập Cookie / sửa nguồn AI) chỉ thực hiện trực tiếp trên máy chủ.",
                            "code": "host_admin_only",
                        },
                    )
                active_token = resolve_active_share_token(
                    cfg, getattr(app.state, "runtime_share_token", "")
                )
                if not active_token:
                    return JSONResponse(
                        status_code=401,
                        content={
                            "error": "Chế độ chia sẻ từ xa chưa được bật (thiếu WEBCHAT_SHARE_TOKEN).",
                            "code": "share_disabled",
                        },
                    )
                provided = _extract_request_share_token(request)
                if not provided or not hmac.compare_digest(provided, active_token):
                    return JSONResponse(
                        status_code=401,
                        content={
                            "error": "Passcode truy cập từ xa không đúng hoặc còn thiếu.",
                            "code": "invalid_share_token",
                        },
                    )
        return await call_next(request)

    # CORSMiddleware đăng ký sau @app.middleware để bọc ngoài cùng (kể cả phản hồi 401/403)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(cfg.cors_origins),
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Gateway-Lane", "X-Actual-Model", "X-Fallback-From"],
    )

    app.include_router(build_api_router(storage, bridge, providers))

    dist_dir = Path(cfg.dist_dir)
    assets_dir = dist_dir / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"error": "Not found"})
        if dist_dir.exists():
            candidate = (dist_dir / full_path).resolve()
            try:
                candidate.relative_to(dist_dir.resolve())
                if candidate.is_file():
                    return FileResponse(str(candidate))
            except ValueError:
                pass
            if "/assets/" in f"/{full_path}" and assets_dir.exists():
                rel_asset = full_path.split("assets/", 1)[-1]
                asset_candidate = (assets_dir / rel_asset).resolve()
                try:
                    asset_candidate.relative_to(assets_dir.resolve())
                    if asset_candidate.is_file():
                        return FileResponse(str(asset_candidate))
                except ValueError:
                    pass
            index_file = dist_dir / "index.html"
            if index_file.exists():
                return FileResponse(str(index_file))
        return JSONResponse(
            status_code=503,
            content={"error": "Chưa tìm thấy bản build frontend dist/. Hãy chạy npm run build trước."},
        )

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    cfg = load_settings()
    print(f"Research Lab & Flow Map (Python FastAPI) listening on http://{cfg.host}:{cfg.port}")
    uvicorn.run(app, host=cfg.host, port=cfg.port, log_level="info")
