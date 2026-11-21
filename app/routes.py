"""Toàn bộ REST API, SSE (/flow) và prompt điều phối hội đồng AI / Trọng tài (Judge).
- Sửa file này khi muốn thay đổi cách ghép ngữ cảnh cho từng góc nhìn AI, prompt chấm điểm Judge, hoặc thêm API mới.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse

from app.bridge import BridgeCallError, BridgeClient, parse_resilient_json
from app.providers import LaneNameStore, ProviderStore
from app.research import fetch_url_as_source, search_open_academic_sources
from app.storage import RoomStorage, utc_now_iso

_CITATION_RE = re.compile(r"\[S(\d+)\]")


def extract_summary_1line(text: str) -> str:
    for line in (text or "").splitlines():
        cleaned = line.strip()
        if not cleaned:
            continue
        cleaned = re.sub(r"^#+\s*", "", cleaned)
        cleaned = re.sub(r"^\*\*Kết luận:\*\*\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"^Kết luận:\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = cleaned.replace("**", "").strip()
        if len(cleaned) >= 16:
            return cleaned[:152].rstrip() + "…" if len(cleaned) > 155 else cleaned
    fallback = re.sub(r"\s+", " ", (text or "").replace("**", "")).strip()
    return fallback[:152].rstrip() + "…" if len(fallback) > 155 else fallback


def extract_cited_sources(text: str, valid_ids: set[str]) -> list[str]:
    seen: list[str] = []
    for m in _CITATION_RE.finditer(text or ""):
        sid = f"S{m.group(1)}"
        if sid in valid_ids and sid not in seen:
            seen.append(sid)
    return seen


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
    async def health():
        data = await bridge.check_health()
        custom_names = lane_name_store.load_all()
        details = []
        for lane in data.get("laneDetails") or []:
            lid = str(lane.get("id") or "")
            bridge_lbl = str(lane.get("bridgeLabel") or lid)
            details.append({**lane, "name": custom_names.get(lid) or bridge_lbl})
        data["laneDetails"] = details
        return data

    @router.patch("/lanes/{lane_id}")
    async def rename_lane(lane_id: str, request: Request):
        body = await request.json()
        raw_name = str(body.get("name") or "").strip()
        try:
            all_names = lane_name_store.set_name(lane_id, raw_name)
        except ValueError as exc:
            return JSONResponse(status_code=400, content={"error": str(exc)})
        return {"id": lane_id, "name": all_names.get(lane_id, ""), "laneNames": all_names}

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

    # 4. Real Open Academic Deep Research
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

    # 5. Stateless single-perspective AI turn via dsh-gemini-bridge
    @router.post("/ai/perspective")
    async def run_perspective(request: Request):
        started = time.monotonic()
        body = await request.json()
        perspective = body.get("perspective") or {}
        prompt = str(body.get("prompt") or "").strip()
        sources = list(body.get("sources") or [])
        round_num = int(body.get("round") or 0)
        peer_messages = list(body.get("peerMessages") or [])
        requested_lane = str(body.get("laneId") or "").strip()

        if not perspective or not prompt:
            return JSONResponse(
                status_code=400, content={"error": "Thiếu góc nhìn hoặc nội dung câu hỏi."}
            )

        if sources:
            source_context = "\n".join(
                f"[{s.get('id')}] ({s.get('origin')}) {s.get('title')}: \"{s.get('excerpt', '')}\""
                for s in sources
            )
        else:
            source_context = (
                "Chưa có nguồn đính kèm; trả lời dựa trên lập luận chuyên môn và không tự bịa mã [S#]."
            )

        peer_context = ""
        if peer_messages:
            lines = "\n".join(
                f"- @{m.get('handle')}: {m.get('content')}" for m in peer_messages
            )
            peer_context = (
                "\n\nCÁC LẬP LUẬN TRƯỚC ĐÓ TRONG PHÒNG "
                "(hãy phản biện trực diện hoặc bổ sung điểm thiếu):\n" + lines
            )

        system_instruction = "\n".join(
            [
                f"Bạn đang đóng vai góc nhìn @{perspective.get('handle')} ({perspective.get('name')}) "
                "trong một phòng nghiên cứu đa góc nhìn bằng tiếng Việt.",
                str(perspective.get("rolePrompt") or ""),
                "QUY TẮC ĐỊNH DẠNG BẮT BUỘC:",
                '1. Dòng đầu tiên PHẢI bắt đầu bằng "Kết luận: " tóm gọn lập trường cốt lõi trong đúng 1 câu (dưới 28 từ).',
                "2. Sau đó trình bày 2–4 ý phân tích súc tích, dễ đọc (dùng gạch đầu dòng hoặc đánh số ngắn).",
                "3. CHỈ gắn mã trích dẫn [S1], [S2]... khớp chính xác với danh sách nguồn được cung cấp bên dưới. Tuyệt đối không bịa mã nguồn không tồn tại.",
                "4. Giữ độ dài khoảng 130–230 từ để người dùng đọc sâu thoải mái.",
            ]
        )
        user_prompt = (
            f"VÒNG THẢO LUẬN: Vòng {round_num}\n"
            f"KHO NGUỒN ĐÍNH KÈM:\n{source_context}{peer_context}\n\n"
            f"CÂU HỎI CỦA NGƯỜI DÙNG:\n{prompt}"
        )

        pinned_lane_id = (
            str(perspective.get("pinnedLaneId") or body.get("pinnedLaneId") or "").strip() or None
        )
        try:
            result = await prov_store.complete(
                default_bridge=bridge,
                provider_id=perspective.get("providerId"),
                system_instruction=system_instruction,
                user_prompt=user_prompt,
                model=perspective.get("modelLabel"),
                pinned_lane_id=pinned_lane_id,
            )
        except BridgeCallError as exc:
            return JSONResponse(status_code=502, content={"error": str(exc)})

        elapsed_sec = round(time.monotonic() - started, 1)
        valid_ids = {str(s.get("id")) for s in sources if s.get("id")}
        return {
            "content": result.text,
            "summary1Line": extract_summary_1line(result.text),
            "citedSourceIds": extract_cited_sources(result.text, valid_ids),
            "elapsedSec": elapsed_sec,
            "modelUsed": result.model_used,
            "fallbackFrom": result.fallback_from,
            "laneId": result.lane_id if result.lane_id != "bridge" else (requested_lane or "bridge"),
            "rawPrompt": result.raw_prompt,
        }

    # 6. Judge & Synthesizer (Report + Dynamic Rubric + Living Outline)
    @router.post("/ai/synthesize")
    async def run_synthesize(request: Request):
        started = time.monotonic()
        body = await request.json()
        room_title = str(body.get("roomTitle") or "Nghiên cứu").strip()
        messages = list(body.get("messages") or [])
        perspectives = list(body.get("perspectives") or [])
        sources = list(body.get("sources") or [])
        anonymize = bool(body.get("anonymize", True))

        ai_messages = [m for m in messages if m.get("handle")]
        if not ai_messages:
            return JSONResponse(
                status_code=400,
                content={"error": "Cần ít nhất 1 phản hồi từ góc nhìn AI để Trọng tài tổng hợp."},
            )

        active_handles: list[str] = []
        for m in ai_messages:
            h = str(m["handle"])
            if h not in active_handles:
                active_handles.append(h)

        alias_map: dict[str, str] = {}
        reverse_alias: dict[str, str] = {}
        for idx, h in enumerate(active_handles):
            letter = chr(65 + (idx % 26))
            alias = f"Ứng viên {letter}" if anonymize else f"@{h}"
            alias_map[h] = alias
            reverse_alias[alias] = h
            reverse_alias[alias.lstrip("@")] = h
            reverse_alias[h] = h

        transcript = "\n\n---\n\n".join(
            f"[Vòng {m.get('round', 0)}] {alias_map.get(str(m['handle']), m['handle'])}:\n{m.get('content', '')}"
            for m in ai_messages
        )
        source_list = "\n".join(
            f"[{s.get('id')}] {s.get('title')} ({s.get('origin')})" for s in sources
        )
        labels_str = ", ".join(alias_map[h] for h in active_handles)
        prompt_text = (
            f'Đề tài nghiên cứu: "{room_title}"\n\n'
            f"KHO NGUỒN HỢP LỆ:\n{source_list or '(Chưa có nguồn)'}\n\n"
            f"TOÀN BỘ LẬP LUẬN:\n{transcript}\n\n"
            "Hãy đóng vai Trọng tài học thuật công tâm, trả về ĐÚNG 1 khối JSON hợp lệ tiếng Việt "
            "(không văn bản thừa ngoài JSON) gồm các khóa: "
            "executiveSummary (1 đoạn súc tích kèm mã [S#] hợp lệ nếu có), "
            "consensus (mảng {title, supporters, citations}), "
            "contradictions (mảng {topic, detail, suggestedPrompt}), "
            "gaps (mảng chuỗi 2 lỗ hổng cần tìm thêm nguồn), "
            "openDebates (mảng 1-2 câu), "
            f"scores (mảng {{label, evidence, logic, rebuttal, summary, citations}} thang 0..10 cho từng mã nhãn: {labels_str})."
        )

        judge_model = str(body.get("judgeModel") or "").strip() or None
        judge_provider_id = str(body.get("judgeProviderId") or "").strip() or None
        judge_lane_id = str(body.get("judgeLaneId") or "").strip() or None
        try:
            result = await prov_store.complete(
                default_bridge=bridge,
                provider_id=judge_provider_id,
                system_instruction="Bạn là Trọng tài học thuật. Chỉ trả về duy nhất 1 JSON object hợp lệ.",
                user_prompt=prompt_text,
                model=judge_model,
                pinned_lane_id=judge_lane_id,
            )
        except BridgeCallError as exc:
            return JSONResponse(status_code=502, content={"error": str(exc)})

        parsed = parse_resilient_json(result.text)
        valid_source_ids = {str(s.get("id")) for s in sources if s.get("id")}

        def _clean_cites(raw: Any) -> list[str]:
            if not isinstance(raw, list):
                return []
            out: list[str] = []
            for item in raw:
                cid = str(item).strip().strip("[]")
                if cid in valid_source_ids and cid not in out:
                    out.append(cid)
            return out

        def _find_score(handle: str) -> dict[str, Any]:
            for row in parsed.get("scores") or []:
                if not isinstance(row, dict):
                    continue
                lbl = str(row.get("label") or "")
                if reverse_alias.get(lbl) == handle or handle in lbl:
                    return row
            return {}

        rubric: list[dict[str, Any]] = []
        breakdown: list[dict[str, Any]] = []
        for handle in active_handles:
            p = next((item for item in perspectives if item.get("handle") == handle), {})
            row = _find_score(handle)
            ev = round(float(row.get("evidence", 8.0)), 1)
            lg = round(float(row.get("logic", 8.0)), 1)
            rb = round(float(row.get("rebuttal", 8.0)), 1)
            tot = round((ev + lg + rb) / 3.0, 1)
            rubric.append(
                {
                    "perspectiveId": p.get("id", handle),
                    "handle": handle,
                    "colorIndex": int(p.get("colorIndex", 0)),
                    "evidence": ev,
                    "logic": lg,
                    "rebuttal": rb,
                    "total": tot,
                }
            )
            breakdown.append(
                {
                    "handle": handle,
                    "summary": str(row.get("summary") or f"Đóng góp góc nhìn chuyên môn từ @{handle}."),
                    "citations": _clean_cites(row.get("citations")),
                }
            )
        rubric.sort(key=lambda r: r["total"], reverse=True)

        exec_summary = str(
            parsed.get("executiveSummary")
            or "Trọng tài đã tổng hợp các lập luận chính, cân đối bằng chứng và chỉ ra trục tranh luận cần tiếp tục xác minh."
        )
        report = {
            "title": f"Báo cáo tổng hợp: {room_title}",
            "subtitle": f"Trọng tài {'(Ẩn danh)' if anonymize else '(Công khai)'} · {len(sources)} nguồn xác minh · {len(active_handles)}/{len(perspectives)} góc nhìn tham gia",
            "executiveSummary": exec_summary,
            "perspectiveBreakdown": breakdown,
            "openDebates": [str(x) for x in (parsed.get("openDebates") or [])],
            "rubric": rubric,
            "updatedAt": utc_now_iso(),
        }
        living_outline = {
            "consensus": [
                {
                    "title": str(c.get("title", "")),
                    "supporters": [
                        reverse_alias.get(str(s), str(s).lstrip("@"))
                        for s in (c.get("supporters") or [])
                    ],
                    "citations": _clean_cites(c.get("citations")),
                }
                for c in (parsed.get("consensus") or [])
                if isinstance(c, dict)
            ],
            "contradictions": [
                {
                    "topic": str(c.get("topic", "")),
                    "detail": str(c.get("detail", "")),
                    "suggestedPrompt": str(c.get("suggestedPrompt", "")),
                }
                for c in (parsed.get("contradictions") or [])
                if isinstance(c, dict)
            ],
            "gaps": [str(g) for g in (parsed.get("gaps") or [])],
        }

        return {
            "report": report,
            "livingOutline": living_outline,
            "elapsedSec": round(time.monotonic() - started, 1),
            "summary1Line": extract_summary_1line(exec_summary),
            "anonymizeUsed": anonymize,
            "laneId": result.lane_id,
            "modelUsed": result.model_used,
        }

    return router
