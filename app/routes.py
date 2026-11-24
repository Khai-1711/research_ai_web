"""Tầng REST API & SSE (/api/*) mỏng của WebChat Backend.
- Ủy thác ngữ cảnh/quy tắc cho app.prompts, kiểm chứng cho app.verifier, trọng tài cho app.judge và tìm nguồn cho app.research.
- Giữ re-export các hàm/hằng số cũ để tương thích ngược với bộ kiểm thử.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import time
from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse

from app.bridge import BridgeCallError, BridgeClient
from app.config import ensure_share_token_file, is_direct_local_request, resolve_active_share_token
from app.judge import (
    MAX_JUDGE_SOURCE_EXCERPT,
    build_judge_prompt,
    mask_handles_in_text,
    synthesize_judge_report,
    unmask_handles_in_text,
)
from app.prompts import (
    MAX_DEEP_HISTORY_CHARS,
    MAX_HISTORY_CHARS,
    MAX_PERSPECTIVE_SOURCE_CHARS,
    MAX_PRESERVED_RESEARCH_CHARS,
    build_perspective_prompts,
    extract_summary_1line,
    format_conversation_history,
)
from app.providers import LaneNameStore, ProviderStore
from app.research import (
    _MAX_FETCH_BYTES,
    extract_uploaded_pdf_source,
    fetch_url_as_source,
    search_open_academic_sources,
)
from app.storage import RoomStorage, utc_now_iso
from app.verifier import extract_cited_sources, verify_perspective_turn

__all__ = [
    "MAX_HISTORY_CHARS",
    "MAX_DEEP_HISTORY_CHARS",
    "MAX_PRESERVED_RESEARCH_CHARS",
    "MAX_PERSPECTIVE_SOURCE_CHARS",
    "MAX_JUDGE_SOURCE_EXCERPT",
    "extract_summary_1line",
    "extract_cited_sources",
    "mask_handles_in_text",
    "unmask_handles_in_text",
    "build_judge_prompt",
    "format_conversation_history",
    "build_api_router",
]


def build_api_router(
    storage: RoomStorage,
    bridge: BridgeClient,
    providers: ProviderStore | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/api")
    prov_store = providers or ProviderStore(
        store_file=storage.data_dir.parent / "providers.json",
        default_bridge_url=bridge.base_url,
        default_model=bridge.default_model,
    )
    lane_name_store = LaneNameStore(storage.data_dir.parent / "lane_names.json")

    # 1. Health, Live Models, Bridge Lanes & AI Providers
    @router.get("/health")
    async def health(request: Request):
        data = await bridge.check_health()
        custom_names = lane_name_store.load_all()
        details = []
        for lane in data.get("laneDetails") or []:
            lid = str(lane.get("id") or "")
            bridge_lbl = str(lane.get("bridgeLabel") or lid)
            details.append({**lane, "name": custom_names.get(lid) or bridge_lbl})
        data["laneDetails"] = details
        cfg = getattr(request.app.state, "settings", None)
        runtime_tok = getattr(request.app.state, "runtime_share_token", "")
        active_tok = resolve_active_share_token(cfg, runtime_tok) if cfg is not None else ""
        data["isLocalOwner"] = is_direct_local_request(request)
        data["shareProtected"] = bool(active_tok)
        return data

    @router.get("/share-info")
    async def get_share_info(request: Request):
        if not is_direct_local_request(request):
            return JSONResponse(status_code=403, content={"error": "Chỉ máy chủ cục bộ mới được xem thông tin chia sẻ."})
        cfg = getattr(request.app.state, "settings", None)
        runtime_tok = getattr(request.app.state, "runtime_share_token", "")
        token = resolve_active_share_token(cfg, runtime_tok) if cfg is not None else ""
        return {
            "enabled": bool(token),
            "token": token,
            "defaultPagesUrl": "https://khai-1711.github.io/research_ai_web/",
        }

    @router.post("/share-info/enable")
    async def enable_share_info(request: Request):
        if not is_direct_local_request(request):
            return JSONResponse(status_code=403, content={"error": "Chỉ máy chủ cục bộ mới được bật mã chia sẻ."})
        cfg = getattr(request.app.state, "settings", None)
        runtime_tok = getattr(request.app.state, "runtime_share_token", "")
        existing = resolve_active_share_token(cfg, runtime_tok) if cfg is not None else ""
        token = existing or ensure_share_token_file()
        request.app.state.runtime_share_token = token
        return {
            "enabled": True,
            "token": token,
            "defaultPagesUrl": "https://khai-1711.github.io/research_ai_web/",
        }

    @router.patch("/lanes/{lane_id}")
    async def rename_lane(lane_id: str, request: Request):
        body = await request.json()
        raw_name = str(body.get("name") or "").strip()
        try:
            all_names = lane_name_store.set_name(lane_id, raw_name)
        except ValueError as exc:
            return JSONResponse(status_code=400, content={"error": str(exc)})
        return {"id": lane_id, "name": all_names.get(lane_id, ""), "laneNames": all_names}

    @router.post("/lanes/create")
    async def create_bridge_lane():
        try:
            return await bridge.create_lane()
        except BridgeCallError as exc:
            return JSONResponse(status_code=502, content={"error": str(exc)})

    @router.post("/lanes/sync-all")
    async def sync_all_bridge_lanes():
        try:
            return await bridge.sync_all_lane_cookies()
        except BridgeCallError as exc:
            return JSONResponse(status_code=502, content={"error": str(exc)})

    @router.post("/lanes/{lane_id}/login")
    async def login_bridge_lane(lane_id: str, request: Request):
        label = ""
        try:
            body = await request.json()
            if isinstance(body, dict):
                label = str(body.get("label") or "").strip()
        except Exception:
            pass
        if not label:
            label = lane_name_store.load_all().get(lane_id, "") or lane_id
        try:
            return await bridge.start_lane_login(lane_id, label=label)
        except BridgeCallError as exc:
            return JSONResponse(status_code=502, content={"error": str(exc)})

    @router.post("/lanes/{lane_id}/finish-login")
    async def finish_login_bridge_lane(lane_id: str):
        try:
            return await bridge.finish_lane_login(lane_id)
        except BridgeCallError as exc:
            return JSONResponse(status_code=502, content={"error": str(exc)})

    @router.post("/lanes/{lane_id}/sync")
    async def sync_bridge_lane(lane_id: str, request: Request):
        label = ""
        try:
            body = await request.json()
            if isinstance(body, dict):
                label = str(body.get("label") or "").strip()
        except Exception:
            pass
        if not label:
            label = lane_name_store.load_all().get(lane_id, "") or lane_id
        try:
            return await bridge.sync_lane_cookie(lane_id, label=label)
        except BridgeCallError as exc:
            return JSONResponse(status_code=502, content={"error": str(exc)})

    @router.get("/models")
    async def list_models():
        models = await prov_store.discover_models(bridge)
        return {"models": models}

    @router.get("/providers")
    async def list_providers():
        return {"providers": prov_store.list_public()}

    @router.post("/providers")
    async def create_provider(request: Request):
        body = await request.json()
        try:
            created = prov_store.add_provider(body)
        except ValueError as exc:
            return JSONResponse(status_code=400, content={"error": str(exc)})
        return JSONResponse(status_code=201, content={"provider": created})

    @router.delete("/providers/{provider_id}")
    async def delete_provider(provider_id: str):
        try:
            removed = prov_store.delete_provider(provider_id)
        except ValueError as exc:
            return JSONResponse(status_code=400, content={"error": str(exc)})
        if not removed:
            return JSONResponse(status_code=404, content={"error": "Không tìm thấy nguồn AI."})
        return {"deleted": True, "id": provider_id}

    @router.post("/providers/{provider_id}/test")
    async def test_provider(provider_id: str, request: Request):
        started = time.monotonic()
        pinned_lane_id: str | None = None
        try:
            body = await request.json()
            if isinstance(body, dict):
                pinned_lane_id = str(body.get("laneId") or "").strip() or None
        except Exception:
            pass
        try:
            res = await prov_store.complete(
                default_bridge=bridge,
                provider_id=provider_id,
                system_instruction="Trả lời đúng 1 câu ngắn xác nhận kết nối thành công bằng tiếng Việt.",
                user_prompt="Xin chào, hãy xác nhận kết nối.",
                pinned_lane_id=pinned_lane_id,
            )
            return {
                "ok": True,
                "modelUsed": res.model_used,
                "laneId": res.lane_id,
                "elapsedSec": round(time.monotonic() - started, 1),
                "preview": res.text[:160],
            }
        except BridgeCallError as exc:
            return JSONResponse(status_code=502, content={"ok": False, "error": str(exc)})

    # 2. Room CRUD
    @router.get("/rooms")
    async def list_rooms():
        return {
            "summaries": storage.list_room_summaries(),
            "rooms": storage.list_full_rooms(),
        }

    @router.get("/rooms/{room_id}")
    async def get_room(room_id: str):
        room = storage.get_room(room_id)
        if not room:
            return JSONResponse(status_code=404, content={"error": "Không tìm thấy phòng nghiên cứu."})
        return {"room": room, "events": storage.get_flow_events(room["id"])}

    @router.post("/rooms")
    async def create_room(request: Request):
        body = await request.json()
        now = utc_now_iso()
        rid = str(body.get("id") or "").strip() or f"room-{int(time.time() * 1000)}"
        title = str(body.get("title") or "").strip() or "Phòng nghiên cứu mới"
        room: dict[str, Any] = {
            "id": rid,
            "title": title,
            "topicPrompt": str(body.get("topicPrompt") or "").strip() or title,
            "createdAt": now,
            "updatedAt": now,
            "perspectives": body.get("perspectives") or [],
            "messages": body.get("messages") or [],
            "sources": body.get("sources") or [],
            "livingOutline": body.get("livingOutline")
            or {"consensus": [], "contradictions": [], "gaps": []},
            "audit": body.get("audit") or [],
        }
        if body.get("report") is not None:
            room["report"] = body["report"]
        storage.save_room(room)
        return JSONResponse(status_code=201, content={"room": room})

    @router.patch("/rooms/{room_id}")
    async def patch_room(room_id: str, request: Request):
        existing = storage.get_room(room_id)
        if not existing:
            return JSONResponse(status_code=404, content={"error": "Không tìm thấy phòng."})
        patch = await request.json()
        updated = {**existing, **patch, "id": existing["id"], "updatedAt": utc_now_iso()}
        storage.save_room(updated)
        return {"room": updated}

    @router.delete("/rooms/{room_id}")
    async def delete_room(room_id: str):
        if not storage.delete_room(room_id):
            return JSONResponse(status_code=404, content={"error": "Không tìm thấy phòng."})
        return {"ok": True}

    # 3. Flow Events SSE stream + JSONL download + append
    @router.get("/rooms/{room_id}/events")
    async def stream_room_events(room_id: str, request: Request):
        async def _gen():
            history = storage.get_flow_events(room_id)
            yield f"event: snapshot\ndata: {json.dumps(history, ensure_ascii=False)}\n\n"
            q, unsubscribe = storage.subscribe(room_id)
            try:
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        ev = await asyncio.wait_for(q.get(), timeout=20.0)
                        yield f"event: flow\ndata: {json.dumps(ev, ensure_ascii=False)}\n\n"
                    except asyncio.TimeoutError:
                        yield ": ping\n\n"
            finally:
                unsubscribe()

        return StreamingResponse(
            _gen(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @router.get("/rooms/{room_id}/events.jsonl")
    async def download_events_jsonl(room_id: str):
        raw = storage.get_raw_events_jsonl(room_id)
        return PlainTextResponse(
            content=raw,
            media_type="application/x-ndjson; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{room_id}-events.jsonl"'},
        )

    @router.post("/rooms/{room_id}/flow-events")
    async def post_flow_event(room_id: str, request: Request):
        body = await request.json()
        if not body.get("event_type") or not body.get("payload"):
            return JSONResponse(
                status_code=400, content={"error": "Thiếu trường event_type hoặc payload."}
            )
        saved = storage.append_flow_event(room_id, body)
        return JSONResponse(status_code=201, content={"event": saved})

    # 4. Real Open Academic Deep Research + Local PDF Upload
    @router.post("/research/search")
    async def research_search(request: Request):
        body = await request.json()
        url = str(body.get("url") or "").strip()
        query = str(body.get("query") or "").strip()
        try:
            if url:
                item = await fetch_url_as_source(url)
                return {"items": [item]}
            if not query:
                return JSONResponse(
                    status_code=400, content={"error": "Vui lòng nhập từ khóa nghiên cứu hoặc URL."}
                )
            items = await search_open_academic_sources(query)
            return {"items": items}
        except ValueError as exc:
            return JSONResponse(status_code=400, content={"error": str(exc)})
        except Exception as exc:
            return JSONResponse(status_code=500, content={"error": str(exc)})

    @router.post("/research/upload-pdf")
    async def research_upload_pdf(request: Request):
        ctype = (request.headers.get("content-type") or "").lower()
        filename = unquote(
            str(
                request.query_params.get("filename")
                or request.headers.get("x-file-name")
                or "tai-lieu.pdf"
            ).strip()
        )
        content_len = request.headers.get("content-length")
        if content_len and content_len.isdigit() and int(content_len) > (_MAX_FETCH_BYTES + 4 * 1024 * 1024):
            return JSONResponse(
                status_code=413,
                content={"error": "Tệp PDF vượt quá giới hạn dung lượng 15 MB."},
            )

        try:
            if "application/json" in ctype:
                body = await request.json()
                filename = str(body.get("filename") or filename).strip() or "tai-lieu.pdf"
                raw_b64 = str(body.get("contentBase64") or "").strip()
                if not raw_b64:
                    return JSONResponse(status_code=400, content={"error": "Thiếu nội dung PDF (contentBase64)."})
                try:
                    raw_bytes = base64.b64decode(raw_b64, validate=True)
                except binascii.Error:
                    return JSONResponse(status_code=400, content={"error": "Dữ liệu base64 không hợp lệ."})
            else:
                raw_bytes = await request.body()

            if len(raw_bytes) > _MAX_FETCH_BYTES:
                return JSONResponse(
                    status_code=413,
                    content={"error": "Tệp PDF vượt quá giới hạn dung lượng 15 MB."},
                )
            item = extract_uploaded_pdf_source(raw_bytes, filename=filename)
            return {"item": item}
        except ValueError as exc:
            return JSONResponse(status_code=400, content={"error": str(exc)})
        except Exception as exc:
            return JSONResponse(status_code=500, content={"error": str(exc)})

    async def _run_with_optional_sse(request: Request, runner):
        accept = (request.headers.get("accept") or "").lower()
        if "text/event-stream" not in accept:
            try:
                status_code, payload = await runner(None)
            except BridgeCallError as exc:
                return JSONResponse(status_code=502, content={"error": str(exc)})
            if status_code != 200:
                return JSONResponse(status_code=status_code, content=payload)
            return payload

        async def _sse_stream():
            queue: asyncio.Queue = asyncio.Queue()
            done_ev = asyncio.Event()
            last_phase = "waiting_gemini"

            async def _on_status(st: dict[str, Any]) -> None:
                nonlocal last_phase
                if isinstance(st, dict) and st.get("phase"):
                    last_phase = str(st["phase"])
                await queue.put(("status", st))

            async def _driver() -> None:
                try:
                    sc, pl = await runner(_on_status)
                    await queue.put(("result", (sc, pl)))
                except BridgeCallError as exc:
                    await queue.put(("error", (502, {"error": str(exc)})))
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    await queue.put(("error", (500, {"error": str(exc)})))
                finally:
                    done_ev.set()

            task = asyncio.create_task(_driver())
            try:
                while True:
                    if await request.is_disconnected():
                        task.cancel()
                        break
                    if done_ev.is_set() and queue.empty():
                        break
                    try:
                        kind, payload = await asyncio.wait_for(queue.get(), timeout=2.5)
                    except asyncio.TimeoutError:
                        if done_ev.is_set() and queue.empty():
                            break
                        hb = {"phase": last_phase, "heartbeat": True}
                        yield f"event: status\ndata: {json.dumps(hb, ensure_ascii=False)}\n\n"
                        continue

                    if kind == "status":
                        yield f"event: status\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
                    elif kind == "result":
                        sc, pl = payload
                        if sc == 200:
                            yield f"event: result\ndata: {json.dumps(pl, ensure_ascii=False)}\n\n"
                        else:
                            err_pl = {"status": sc, **(pl if isinstance(pl, dict) else {"error": str(pl)})}
                            yield f"event: error\ndata: {json.dumps(err_pl, ensure_ascii=False)}\n\n"
                        break
                    elif kind == "error":
                        sc, pl = payload
                        err_pl = {"status": sc, **(pl if isinstance(pl, dict) else {"error": str(pl)})}
                        yield f"event: error\ndata: {json.dumps(err_pl, ensure_ascii=False)}\n\n"
                        break
            finally:
                if not task.done():
                    task.cancel()
                await asyncio.gather(task, return_exceptions=True)

        return StreamingResponse(
            _sse_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    # 5. Stateless single-perspective AI turn via dsh-gemini-bridge + Verifier
    @router.post("/ai/perspective")
    async def run_perspective(request: Request):
        started = time.monotonic()
        body = await request.json()
        perspective = body.get("perspective") or {}
        prompt = str(body.get("prompt") or "").strip()
        sources = list(body.get("sources") or [])
        round_num = int(body.get("round") or 0)
        conversation_history = list(body.get("conversationHistory") or [])
        peer_messages = list(body.get("peerMessages") or [])
        requested_lane = str(body.get("laneId") or "").strip()
        detail_mode = str(body.get("detailMode") or "").strip()

        if not perspective or not prompt:
            return JSONResponse(
                status_code=400, content={"error": "Thiếu góc nhìn hoặc nội dung câu hỏi."}
            )

        system_instruction, user_prompt, _use_deep = build_perspective_prompts(
            perspective=perspective,
            prompt=prompt,
            sources=sources,
            round_num=round_num,
            conversation_history=conversation_history,
            peer_messages=peer_messages,
            detail_mode=detail_mode,
        )

        pinned_lane_id = (
            str(perspective.get("pinnedLaneId") or body.get("pinnedLaneId") or "").strip() or None
        )

        async def _runner(on_status):
            result = await prov_store.complete(
                default_bridge=bridge,
                provider_id=perspective.get("providerId"),
                system_instruction=system_instruction,
                user_prompt=user_prompt,
                model=perspective.get("modelLabel"),
                pinned_lane_id=pinned_lane_id,
                on_status=on_status,
            )
            elapsed_sec = round(time.monotonic() - started, 1)
            valid_ids = {str(s.get("id")) for s in sources if isinstance(s, dict) and s.get("id")}
            verification = verify_perspective_turn(result.text, sources)
            return 200, {
                "content": result.text,
                "summary1Line": extract_summary_1line(result.text),
                "citedSourceIds": extract_cited_sources(result.text, valid_ids),
                "verification": verification,
                "elapsedSec": elapsed_sec,
                "modelUsed": result.model_used,
                "fallbackFrom": result.fallback_from,
                "laneId": result.lane_id if result.lane_id != "bridge" else (requested_lane or "bridge"),
                "rawPrompt": result.raw_prompt,
            }

        return await _run_with_optional_sse(request, _runner)

    # 6. Judge & Synthesizer (Report + Dynamic Rubric + Living Outline + Cross-Account Exclusion)
    @router.post("/ai/synthesize")
    async def run_synthesize(request: Request):
        started = time.monotonic()
        body = await request.json()

        async def _runner(on_status):
            return await synthesize_judge_report(
                body=body,
                bridge=bridge,
                prov_store=prov_store,
                started_monotonic=started,
                time_fn=time.monotonic,
                on_status=on_status,
            )

        return await _run_with_optional_sse(request, _runner)

    return router
