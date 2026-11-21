r"""Điểm vào chính của WebChat Backend (FastAPI trên http://127.0.0.1:3000).
- Phục vụ cả API (/api/*) lẫn giao diện React đã build trong webchat/dist/ (trang / và trang /flow).
- Chạy từ gốc dự án: python start.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.bridge import BridgeClient
from app.config import Settings, load_settings
from app.providers import ProviderStore
from app.routes import build_api_router
from app.storage import RoomStorage

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


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
