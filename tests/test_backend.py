"""Unit and integration tests verifying all 5 dsh-gemini-bridge fixes, CRUD, SSE, and SSRF protection."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.bridge import BridgeClient, compile_stateless_user_prompt, parse_resilient_json
from app.config import Settings
from app.main import create_app
from app.research import (
    MAX_SOURCE_EXCERPT_LEN,
    is_safe_public_url,
    normalize_academic_query,
    search_open_academic_sources,
)
from app.routes import MAX_HISTORY_CHARS, format_conversation_history


def test_compile_stateless_merges_system_into_user_prompt():
    merged = compile_stateless_user_prompt("Vai trò phản biện", "Câu hỏi X")
    assert "Vai trò phản biện" in merged
    assert "Câu hỏi X" in merged


def test_resilient_json_parses_fenced_and_trailing_comma():
    raw = 'Đây là kết quả:\n```json\n{"executiveSummary": "Tóm tắt tốt", "gaps": ["Thiếu A",],}\n```\nHết.'
    parsed = parse_resilient_json(raw)
    assert parsed["executiveSummary"] == "Tóm tắt tốt"
    assert parsed["gaps"] == ["Thiếu A"]


def test_ssrf_blocks_loopback_and_private_ips():
    assert is_safe_public_url("http://127.0.0.1:10000/v1/lanes", resolve_dns=False) is False
    assert is_safe_public_url("http://localhost:3000", resolve_dns=False) is False
    assert is_safe_public_url("http://192.168.1.5/admin", resolve_dns=False) is False
    assert is_safe_public_url("file:///C:/Windows/win.ini", resolve_dns=False) is False
    assert is_safe_public_url("https://arxiv.org/abs/2501.00001", resolve_dns=False) is True


def test_health_accurately_counts_workers_and_detects_guest_mode(tmp_path: Path):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/lanes"
        return httpx.Response(
            200,
            json={
                "lanes": [
                    {"id": "frontend", "is_self": True, "reachable": True, "control": "on", "auth_ok": True},
                    {"id": "acc1", "is_self": False, "reachable": True, "control": "on", "auth_ok": True},
                    {"id": "acc2", "is_self": False, "reachable": True, "control": "on", "auth_ok": False},
                ]
            },
        )

    bridge = BridgeClient("http://bridge.test", transport=httpx.MockTransport(handler))
    cfg = Settings(data_dir=tmp_path / "rooms", dist_dir=tmp_path / "dist")
    client = TestClient(create_app(cfg, bridge_client=bridge))

    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["bridgeOffline"] is False
    assert body["totalWorkers"] == 2  # excludes Gateway is_self=True
    assert body["healthyWorkers"] == 1  # only acc1 is auth_ok=True
    assert body["guestMode"] is True  # acc2 is on & reachable but auth_ok=False
    assert body["lanes"] == ["acc1", "acc2"]


def test_perspective_uses_single_user_message_reads_gateway_lane_and_retries_429(tmp_path: Path):
    attempts = {"n": 0}
    captured_payloads: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        captured_payloads.append(json.loads(request.content.decode("utf-8")))
        if attempts["n"] == 1:
            return httpx.Response(429, headers={"Retry-After": "0"}, json={"error": {"code": "bridge_busy"}})
        return httpx.Response(
            200,
            headers={"X-Gateway-Lane": "acc2", "X-Actual-Model": "gemini-4-hydrogen", "X-Fallback-From": "gemini-4-neon"},
            json={
                "model": "gemini-4-neon",
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "Kết luận: Cần cơ chế hậu kiểm rõ ràng [S1].\n- Phân tích ngắn gọn [S99].",
                        }
                    }
                ],
            },
        )

    bridge = BridgeClient("http://bridge.test", max_retries=2, transport=httpx.MockTransport(handler))
    cfg = Settings(data_dir=tmp_path / "rooms", dist_dir=tmp_path / "dist")
    client = TestClient(create_app(cfg, bridge_client=bridge))

    res = client.post(
        "/api/ai/perspective",
        json={
            "perspective": {
                "id": "p1",
                "handle": "Kỹ_thuật",
                "name": "Kỹ thuật",
                "rolePrompt": "Đánh giá kiến trúc.",
                "modelLabel": "gemini-4-neon",
            },
            "prompt": "Nên dùng RAG hay Fine-tune?",
            "sources": [{"id": "S1", "origin": "arXiv", "title": "Paper 1", "excerpt": "RAG works."}],
            "round": 0,
        },
    )
    assert res.status_code == 200
    assert attempts["n"] == 2  # retried 429 cleanly
    # Verify single user message (no dropped system role!) and stream=False
    sent = captured_payloads[0]
    assert sent["stream"] is False
    assert len(sent["messages"]) == 1
    assert sent["messages"][0]["role"] == "user"
    assert "Đánh giá kiến trúc." in sent["messages"][0]["content"]

    data = res.json()
    assert data["laneId"] == "acc2"
    assert data["modelUsed"] == "gemini-4-hydrogen"
    assert data["fallbackFrom"] == "gemini-4-neon"
    assert data["citedSourceIds"] == ["S1"]  # S99 filtered out


def test_synthesize_handles_malformed_json_and_unmasks_aliases(tmp_path: Path):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"X-Gateway-Lane": "acc1"},
            json={
                "choices": [
                    {
                        "message": {
                            "content": 'Đây là kết quả:\n```json\n{"executiveSummary": "Nên dùng lai [S1]", "consensus": [{"title": "Cần phúc khảo", "supporters": ["Ứng viên A"], "citations": ["[S1]"]}], "contradictions": [], "gaps": ["Thiếu số liệu VN"], "openDebates": ["Chi phí?"], "scores": [{"label": "Ứng viên A", "evidence": 9.0, "logic": 8.5, "rebuttal": 8.0, "summary": "Chặt chẽ", "citations": ["S1"]},]}\n```'
                        }
                    }
                ]
            },
        )

    bridge = BridgeClient("http://bridge.test", transport=httpx.MockTransport(handler))
    cfg = Settings(data_dir=tmp_path / "rooms", dist_dir=tmp_path / "dist")
    client = TestClient(create_app(cfg, bridge_client=bridge))

    res = client.post(
        "/api/ai/synthesize",
        json={
            "roomTitle": "AI chấm thi",
            "anonymize": True,
            "perspectives": [{"id": "p1", "handle": "Kỹ_thuật", "colorIndex": 0}],
            "messages": [{"handle": "Kỹ_thuật", "content": "Lập luận 1", "round": 0}],
            "sources": [{"id": "S1", "title": "Paper", "origin": "arXiv"}],
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["report"]["rubric"][0]["handle"] == "Kỹ_thuật"
    assert body["report"]["rubric"][0]["total"] == 8.5
    assert body["livingOutline"]["consensus"][0]["supporters"] == ["Kỹ_thuật"]


def test_room_crud_and_flow_events_jsonl(tmp_path: Path):
    bridge = BridgeClient("http://bridge.test")
    cfg = Settings(data_dir=tmp_path / "rooms", dist_dir=tmp_path / "dist")
    client = TestClient(create_app(cfg, bridge_client=bridge))

    created = client.post("/api/rooms", json={"id": "room-test", "title": "Phòng thử"}).json()["room"]
    assert created["id"] == "room-test"

    ev_res = client.post(
        "/api/rooms/room-test/flow-events",
        json={
            "event_type": "run_started",
            "run_id": "run-1",
            "payload": {"node_id": "u0", "stage_index": 0, "stage_label": "Bạn", "actor": {"id": "u", "name": "Bạn", "colorIndex": 0, "enabled": True, "kind": "user"}, "inputs": []},
        },
    )
    assert ev_res.status_code == 201
    assert ev_res.json()["event"]["seq"] == 1

    dl = client.get("/api/rooms/room-test/events.jsonl")
    assert dl.status_code == 200
    assert '"seq": 1' in dl.text

    assert client.delete("/api/rooms/room-test").status_code == 200
    assert client.get("/api/rooms/room-test").status_code == 404


def test_providers_mask_secrets_and_models_discovery(tmp_path: Path):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/models":
            return httpx.Response(
                200,
                json={
                    "data": [
                        {"id": "gemini-4-hydrogen", "display_name": "Trợ giúp", "description": "4 Hydrogen"},
                        {"id": "gemini-neon", "display_name": "Phân tích sâu", "description": "4 Neon"},
                    ]
                },
            )
        return httpx.Response(404)

    bridge = BridgeClient("http://bridge.test", transport=httpx.MockTransport(handler))
    cfg = Settings(data_dir=tmp_path / "rooms", dist_dir=tmp_path / "dist")
    client = TestClient(create_app(cfg, bridge_client=bridge))

    created = client.post(
        "/api/providers",
        json={
            "name": "DeepSeek_Test",
            "kind": "openai_compat",
            "baseUrl": "https://api.deepseek.com/v1",
            "apiKey": "sk-secret-value-1234567890",
            "defaultModel": "deepseek-chat",
        },
    )
    assert created.status_code == 201
    prov = created.json()["provider"]
    assert prov["hasApiKey"] is True
    assert "1234567890" not in prov["apiKeyMasked"]
    assert "sk-secret-value" not in json.dumps(created.json())

    models = client.get("/api/models").json()["models"]
    model_ids = [m["id"] for m in models]
    assert "gemini-neon" in model_ids
    assert "deepseek-chat" in model_ids

    assert client.delete(f"/api/providers/{prov['id']}").status_code == 200


def test_empty_storage_creates_single_clean_room_without_examples(tmp_path: Path):
    bridge = BridgeClient("http://bridge.test")
    cfg = Settings(data_dir=tmp_path / "rooms", dist_dir=tmp_path / "dist")
    client = TestClient(create_app(cfg, bridge_client=bridge))

    rooms = client.get("/api/rooms").json()["rooms"]
    assert len(rooms) == 1
    assert rooms[0]["id"] == "room-default"
    assert rooms[0]["messages"] == []
    assert rooms[0]["sources"] == []
    room_ids = {r["id"] for r in rooms}
    assert not (room_ids & {"room-ai-exam", "room-lora", "room-rag-ft"})
    assert client.post("/api/rooms/reset").status_code in (404, 405)


def test_lane_rename_and_pinned_lane_direct_routing(tmp_path: Path):
    hit_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        hit_urls.append(str(request.url))
        if request.url.path == "/v1/lanes":
            return httpx.Response(
                200,
                json={
                    "lanes": [
                        {
                            "id": "acc1",
                            "label": "Agent-1",
                            "url": "http://127.0.0.1:10001",
                            "is_self": False,
                            "reachable": True,
                            "control": "on",
                            "auth_ok": True,
                            "model": "gemini-4-hydrogen",
                        },
                        {
                            "id": "acc2",
                            "label": "Agent-2",
                            "url": "http://127.0.0.1:10002",
                            "is_self": False,
                            "reachable": True,
                            "control": "on",
                            "auth_ok": True,
                            "model": "gemini-neon",
                        },
                        {
                            "id": "acc3",
                            "label": "Agent-3",
                            "url": "http://127.0.0.1:10003",
                            "is_self": False,
                            "reachable": True,
                            "control": "off",
                            "auth_ok": True,
                            "model": "gemini-4-hydrogen",
                        },
                    ]
                },
            )
        if str(request.url) == "http://127.0.0.1:10002/v1/chat/completions":
            return httpx.Response(
                200,
                json={
                    "model": "gemini-neon",
                    "choices": [{"message": {"role": "assistant", "content": "Kết luận: Phản hồi trực tiếp từ acc2."}}],
                },
            )
        return httpx.Response(500, json={"error": f"Unexpected URL {request.url}"})

    bridge = BridgeClient("http://127.0.0.1:10000", max_retries=0, transport=httpx.MockTransport(handler))
    cfg = Settings(data_dir=tmp_path / "rooms", dist_dir=tmp_path / "dist")
    client = TestClient(create_app(cfg, bridge_client=bridge))

    # 1. Rename acc2 and verify /api/health returns custom name in laneDetails
    ren = client.patch("/api/lanes/acc2", json={"name": "Acc Phản Biện"})
    assert ren.status_code == 200
    assert ren.json()["name"] == "Acc Phản Biện"

    health = client.get("/api/health").json()
    acc2_detail = next(l for l in health["laneDetails"] if l["id"] == "acc2")
    assert acc2_detail["name"] == "Acc Phản Biện"
    assert acc2_detail["url"] == "http://127.0.0.1:10002"

    # 2. Pinned lane routes directly to http://127.0.0.1:10002/v1/chat/completions
    res = client.post(
        "/api/ai/perspective",
        json={
            "perspective": {
                "id": "p-critic",
                "handle": "Phản_biện",
                "name": "Phản biện",
                "rolePrompt": "Soi rủi ro.",
                "modelLabel": "gemini-neon",
                "providerId": "bridge-local",
                "pinnedLaneId": "acc2",
            },
            "prompt": "Kiểm tra định tuyến ghim acc2",
            "sources": [],
            "round": 0,
        },
    )
    assert res.status_code == 200
    assert res.json()["laneId"] == "acc2"
    assert "http://127.0.0.1:10002/v1/chat/completions" in hit_urls

    # 3. Pinning to an OFF lane fails loudly (502), never silently routes to another acc
    res_off = client.post(
        "/api/ai/perspective",
        json={
            "perspective": {
                "id": "p-off",
                "handle": "Test_Off",
                "name": "Test",
                "rolePrompt": "Test",
                "modelLabel": "gemini-4-hydrogen",
                "providerId": "bridge-local",
                "pinnedLaneId": "acc3",
            },
            "prompt": "Chạy trên acc3 đang tắt",
            "sources": [],
            "round": 0,
        },
    )
    assert res_off.status_code == 502
    assert "acc3" in res_off.json()["error"]


def _make_captured_perspective_client(tmp_path: Path):
    captured_prompts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/chat/completions":
            payload = json.loads(request.content.decode("utf-8"))
            captured_prompts.append(str(payload["messages"][0]["content"]))
            return httpx.Response(
                200,
                headers={"X-Gateway-Lane": "acc1", "X-Actual-Model": "gemini-neon"},
                json={
                    "model": "gemini-neon",
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "Kết luận: Đã tiếp nhận đầy đủ ngữ cảnh vòng trước.\n- Phân tích nối tiếp cụ thể.",
                            }
                        }
                    ],
                },
            )
        return httpx.Response(404)

    bridge = BridgeClient("http://bridge.test", transport=httpx.MockTransport(handler))
    cfg = Settings(data_dir=tmp_path / "rooms", dist_dir=tmp_path / "dist")
    return TestClient(create_app(cfg, bridge_client=bridge)), captured_prompts


def test_perspective_round_0_omits_conversation_history_block(tmp_path: Path):
    client, captured_prompts = _make_captured_perspective_client(tmp_path)

    res = client.post(
        "/api/ai/perspective",
        json={
            "perspective": {
                "id": "p1",
                "handle": "Nghiên_cứu",
                "name": "Nghiên cứu",
                "rolePrompt": "Nghiên cứu độc lập.",
                "modelLabel": "gemini-neon",
            },
            "prompt": "Hãy nghiên cứu về AI cho sinh viên.",
            "sources": [],
            "round": 0,
            "conversationHistory": [],
        },
    )
    assert res.status_code == 200
    raw_prompt = res.json()["rawPrompt"]
    assert captured_prompts and raw_prompt == captured_prompts[0]
    assert "LỊCH SỬ HỘI THOẠI TRƯỚC ĐÓ TRONG PHÒNG" not in raw_prompt
    assert "CÁC LẬP LUẬN TRƯỚC ĐÓ TRONG PHÒNG" not in raw_prompt


def test_perspective_round_1_includes_full_latest_round_roles(tmp_path: Path):
    client, captured_prompts = _make_captured_perspective_client(tmp_path)

    user_r0 = "Hãy nghiên cứu về AI dành cho sinh viên đại học."
    ai_r0 = "Kết luận: AI giúp cá nhân hóa học tập nhưng có nguy cơ phụ thuộc.\n- Điểm 1: Tăng tốc tra cứu.\n- Điểm 2: Cần kiểm chứng nguồn."
    judge_r0 = "Tổng hợp Vòng 0: Cần đánh giá thêm tác động lên tư duy phản biện."

    res = client.post(
        "/api/ai/perspective",
        json={
            "perspective": {
                "id": "p2",
                "handle": "Phản_biện",
                "name": "Phản biện",
                "rolePrompt": "Phản biện lập luận.",
                "modelLabel": "gemini-neon",
            },
            "prompt": "đánh giá",
            "sources": [],
            "round": 1,
            "conversationHistory": [
                {"round": 0, "senderType": "user", "content": user_r0},
                {
                    "round": 0,
                    "senderType": "ai",
                    "handle": "Nghiên_cứu",
                    "content": ai_r0,
                    "summary1Line": "Tóm tắt ngắn R0",
                },
                {"round": 0, "senderType": "judge", "content": judge_r0},
            ],
        },
    )
    assert res.status_code == 200
    raw_prompt = res.json()["rawPrompt"]
    assert captured_prompts and raw_prompt == captured_prompts[0]
    assert "LỊCH SỬ HỘI THOẠI TRƯỚC ĐÓ TRONG PHÒNG" in raw_prompt
    assert f"[Vòng 0 · Người dùng]: {user_r0}" in raw_prompt
    assert f"[Vòng 0 · @Nghiên_cứu]: {ai_r0}" in raw_prompt
    assert f"[Vòng 0 · Trọng tài]: {judge_r0}" in raw_prompt


def test_perspective_compresses_older_rounds_and_respects_max_history_chars(tmp_path: Path):
    client, _ = _make_captured_perspective_client(tmp_path)

    long_old_user = "U0_" + ("a" * 310)
    long_old_ai_raw = "NỘI DUNG CŨ RẤT DÀI KHÔNG NÊN ĐƯA NGUYÊN VĂN " + ("x" * 400)
    old_ai_summary = "Tóm tắt Vòng 0 ngắn gọn."
    latest_ai_full = "Lập luận đầy đủ ở Vòng 1 cần giữ nguyên văn hoàn toàn."

    res = client.post(
        "/api/ai/perspective",
        json={
            "perspective": {
                "id": "p2",
                "handle": "Phản_biện",
                "name": "Phản biện",
                "rolePrompt": "Phản biện.",
                "modelLabel": "gemini-neon",
            },
            "prompt": "Tiếp tục ở vòng 2",
            "sources": [],
            "round": 2,
            "conversationHistory": [
                {"round": 0, "senderType": "user", "content": long_old_user},
                {
                    "round": 0,
                    "senderType": "ai",
                    "handle": "Nghiên_cứu",
                    "content": long_old_ai_raw,
                    "summary1Line": old_ai_summary,
                },
                {"round": 1, "senderType": "ai", "handle": "Phản_biện", "content": latest_ai_full},
            ],
        },
    )
    assert res.status_code == 200
    raw_prompt = res.json()["rawPrompt"]
    assert f"[Vòng 0 · @Nghiên_cứu]: {old_ai_summary}" in raw_prompt
    assert long_old_ai_raw not in raw_prompt
    assert long_old_user not in raw_prompt
    assert f"[Vòng 0 · Người dùng]: {long_old_user[:240]}…" in raw_prompt
    assert f"[Vòng 1 · @Phản_biện]: {latest_ai_full}" in raw_prompt

    # Stress check MAX_HISTORY_CHARS (8000) keeps newest turns and adds omission note
    huge_history = [
        {"round": 0, "senderType": "ai", "handle": "Agent_0", "content": "Turn_0_" + ("Z" * 1800)},
        *[
            {"round": 1, "senderType": "ai", "handle": f"Agent_{i}", "content": f"Latest_{i}_" + ("Z" * 1800)}
            for i in range(1, 6)
        ],
    ]
    bounded = format_conversation_history(huge_history, max_chars=MAX_HISTORY_CHARS)
    assert len(bounded) <= MAX_HISTORY_CHARS
    assert bounded.startswith("[Lưu ý:")
    assert "[Vòng 1 · @Agent_5]: Latest_5_" in bounded
    assert "Turn_0_" not in bounded


def test_perspective_prefers_conversation_history_over_peer_messages_and_keeps_legacy_fallback(
    tmp_path: Path,
):
    client, _ = _make_captured_perspective_client(tmp_path)

    res_both = client.post(
        "/api/ai/perspective",
        json={
            "perspective": {
                "id": "p2",
                "handle": "Phản_biện",
                "name": "Phản biện",
                "rolePrompt": "Phản biện.",
                "modelLabel": "gemini-neon",
            },
            "prompt": "Đánh giá",
            "sources": [],
            "round": 1,
            "conversationHistory": [
                {"round": 0, "senderType": "ai", "handle": "Nghiên_cứu", "content": "Nội dung từ history"},
            ],
            "peerMessages": [
                {"handle": "Nghiên_cứu", "content": "SENTINEL_PEER_ONLY"},
            ],
        },
    )
    assert res_both.status_code == 200
    raw_both = res_both.json()["rawPrompt"]
    assert "LỊCH SỬ HỘI THOẠI TRƯỚC ĐÓ TRONG PHÒNG" in raw_both
    assert "CÁC LẬP LUẬN TRƯỚC ĐÓ TRONG PHÒNG" not in raw_both
    assert "SENTINEL_PEER_ONLY" not in raw_both

    res_legacy = client.post(
        "/api/ai/perspective",
        json={
            "perspective": {
                "id": "p2",
                "handle": "Phản_biện",
                "name": "Phản biện",
                "rolePrompt": "Phản biện.",
                "modelLabel": "gemini-neon",
            },
            "prompt": "Đánh giá",
            "sources": [],
            "round": 1,
            "peerMessages": [
                {"handle": "Nghiên_cứu", "content": "Nội dung legacy peerMessages"},
            ],
        },
    )
    assert res_legacy.status_code == 200
    raw_legacy = res_legacy.json()["rawPrompt"]
    assert "CÁC LẬP LUẬN TRƯỚC ĐÓ TRONG PHÒNG" in raw_legacy
    assert "Nội dung legacy peerMessages" in raw_legacy


def test_health_merges_profile_vault_and_detects_duplicate_account_keys(tmp_path: Path):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/lanes":
            return httpx.Response(
                200,
                json={
                    "lanes": [
                        {
                            "id": "acc1",
                            "is_self": False,
                            "reachable": True,
                            "control": "on",
                            "auth_ok": True,
                            "account_key": "key_alpha_111",
                            "url": "http://127.0.0.1:10001",
                        },
                        {
                            "id": "acc2",
                            "is_self": False,
                            "reachable": True,
                            "control": "on",
                            "auth_ok": True,
                            "account_key": "key_shared_222",
                            "url": "http://127.0.0.1:10002",
                        },
                        {
                            "id": "acc3",
                            "is_self": False,
                            "reachable": True,
                            "control": "on",
                            "auth_ok": True,
                            "account_key": "key_shared_222",
                            "url": "http://127.0.0.1:10003",
                        },
                    ]
                },
            )
        if request.url.path == "/v1/profiles":
            return httpx.Response(
                200,
                json={
                    "browser_available": True,
                    "browser_name": "Chrome",
                    "profiles": [
                        {
                            "profile_id": "acc1",
                            "lane_id": "acc1",
                            "slot": 0,
                            "has_profile_data": True,
                            "login_open": False,
                            "syncing": False,
                            "last_sync_status": "ok",
                            "last_sync_at": 1700000000,
                        },
                        {
                            "profile_id": "acc3",
                            "lane_id": "acc3",
                            "slot": 0,
                            "has_profile_data": False,
                            "login_open": True,
                            "syncing": False,
                            "last_sync_status": "waiting_login",
                        },
                    ],
                },
            )
        return httpx.Response(404)

    bridge = BridgeClient("http://bridge.test", transport=httpx.MockTransport(handler))
    cfg = Settings(data_dir=tmp_path / "rooms", dist_dir=tmp_path / "dist")
    client = TestClient(create_app(cfg, bridge_client=bridge))

    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["cookieSyncBrowser"] == "Chrome"
    by_id = {d["id"]: d for d in body["laneDetails"]}
    assert by_id["acc1"]["hasProfileData"] is True
    assert by_id["acc1"]["duplicatedWith"] == []
    assert by_id["acc2"]["duplicatedWith"] == ["acc3"]
    assert by_id["acc3"]["duplicatedWith"] == ["acc2"]
    assert by_id["acc3"]["loginOpen"] is True


def test_lane_profile_vault_proxy_endpoints_forward_origin_and_payloads(tmp_path: Path):
    seen: list[tuple[str, str, dict]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8")) if request.content else {}
        seen.append((request.url.path, request.headers.get("origin", ""), body))
        if request.url.path == "/v1/lanes/create":
            return httpx.Response(200, json={"ok": True, "lane_id": "acc4", "port": 10004, "url": "http://127.0.0.1:10004", "spawned": True, "ready": True})
        if request.url.path == "/v1/profiles/acc1/login":
            return httpx.Response(200, json={"ok": True, "status": "waiting_login"})
        if request.url.path == "/v1/profiles/acc1/finish-login":
            return httpx.Response(200, json={"ok": True, "profile_id": "acc1", "account_key": "abc123"})
        if request.url.path == "/v1/profiles/acc1/sync":
            return httpx.Response(200, json={"ok": True, "profile_id": "acc1", "account_key": "abc123", "rotated": True})
        if request.url.path == "/v1/profiles/sync-all":
            return httpx.Response(200, json={"ok": True, "total": 2, "synced": 2})
        return httpx.Response(404)

    bridge = BridgeClient("http://bridge.test", transport=httpx.MockTransport(handler))
    cfg = Settings(data_dir=tmp_path / "rooms", dist_dir=tmp_path / "dist")
    client = TestClient(create_app(cfg, bridge_client=bridge))

    assert client.post("/api/lanes/create").json()["lane_id"] == "acc4"
    assert client.post("/api/lanes/acc1/login", json={"label": "Nghien cuu"}).json()["status"] == "waiting_login"
    assert client.post("/api/lanes/acc1/finish-login").json()["account_key"] == "abc123"
    assert client.post("/api/lanes/acc1/sync", json={}).json()["rotated"] is True
    assert client.post("/api/lanes/sync-all").json()["synced"] == 2

    assert [s[0] for s in seen] == [
        "/v1/lanes/create",
        "/v1/profiles/acc1/login",
        "/v1/profiles/acc1/finish-login",
        "/v1/profiles/acc1/sync",
        "/v1/profiles/sync-all",
    ]
    assert all(s[1] == "http://bridge.test" for s in seen)
    assert seen[1][2] == {"lane_id": "acc1", "slot": 0, "label": "Nghien cuu"}


def test_lane_profile_vault_propagates_bridge_error_as_502(tmp_path: Path):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            409,
            json={"error": {"code": "profile_login_required", "message": "Hãy bấm Đăng nhập 1 lần trước."}},
        )

    bridge = BridgeClient("http://bridge.test", transport=httpx.MockTransport(handler))
    cfg = Settings(data_dir=tmp_path / "rooms", dist_dir=tmp_path / "dist")
    client = TestClient(create_app(cfg, bridge_client=bridge))

    res = client.post("/api/lanes/acc2/sync", json={})
    assert res.status_code == 502
    assert "Đăng nhập 1 lần" in res.json()["error"]


def test_judge_prompt_includes_source_excerpts_and_user_turns(tmp_path: Path):
    captured_prompts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/chat/completions":
            payload = json.loads(request.content.decode("utf-8"))
            captured_prompts.append(str(payload["messages"][0]["content"]))
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "executiveSummary": "Tổng kết đối chiếu nguồn [S1] và [S2].",
                                        "consensus": [],
                                        "contradictions": [],
                                        "gaps": [],
                                        "openDebates": [],
                                        "scores": [
                                            {"label": "Ứng viên A", "evidence": 8.5, "logic": 8.0, "rebuttal": 7.5, "summary": "Tốt", "citations": ["S1"]},
                                            {"label": "Ứng viên B", "evidence": 9.0, "logic": 8.5, "rebuttal": 8.5, "summary": "Phản biện sắc", "citations": ["S2"]},
                                        ],
                                    },
                                    ensure_ascii=False,
                                )
                            }
                        }
                    ]
                },
            )
        return httpx.Response(404)

    bridge = BridgeClient("http://bridge.test", transport=httpx.MockTransport(handler))
    cfg = Settings(data_dir=tmp_path / "rooms", dist_dir=tmp_path / "dist")
    client = TestClient(create_app(cfg, bridge_client=bridge))

    res = client.post(
        "/api/ai/synthesize",
        json={
            "roomTitle": "Fintech & Bắt tin thị trường",
            "anonymize": True,
            "perspectives": [
                {"id": "p1", "handle": "Nghiên_cứu", "colorIndex": 0},
                {"id": "p2", "handle": "Phản_biện", "colorIndex": 2},
            ],
            "messages": [
                {"senderType": "user", "content": "Phân tích NLP bắt tin thị trường.", "round": 0},
                {"senderType": "ai", "handle": "Nghiên_cứu", "content": "Luận điểm dựa trên [S1].", "round": 0},
                {"senderType": "user", "content": "Hãy phản biện độ trễ thực thi lệnh.", "round": 1},
                {"senderType": "ai", "handle": "Phản_biện", "content": "Độ trễ NLP cao khi thị trường biến động [S2].", "round": 1},
            ],
            "sources": [
                {"id": "S1", "title": "FinBERT Paper", "origin": "arXiv", "excerpt": "TRICH_DOAN_NGUON_SO_1_VE_FINBERT"},
                {"id": "S2", "title": "Order Flow Latency", "origin": "OpenAlex", "excerpt": "TRICH_DOAN_NGUON_SO_2_VE_DO_TRE"},
            ],
        },
    )
    assert res.status_code == 200
    assert captured_prompts
    sent = captured_prompts[0]
    assert "TRICH_DOAN_NGUON_SO_1_VE_FINBERT" in sent
    assert "TRICH_DOAN_NGUON_SO_2_VE_DO_TRE" in sent
    assert "[Vòng 0 · Người dùng]:\nPhân tích NLP bắt tin thị trường." in sent
    assert "[Vòng 1 · Người dùng]:\nHãy phản biện độ trễ thực thi lệnh." in sent


def test_judge_missing_scores_marks_fallback_instead_of_fake_8_0(tmp_path: Path):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/chat/completions":
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "message": {
                                "content": "Đây là phản hồi văn bản tự do bị hỏng JSON hoàn toàn, không có scores."
                            }
                        }
                    ]
                },
            )
        return httpx.Response(404)

    bridge = BridgeClient("http://bridge.test", transport=httpx.MockTransport(handler))
    cfg = Settings(data_dir=tmp_path / "rooms", dist_dir=tmp_path / "dist")
    client = TestClient(create_app(cfg, bridge_client=bridge))

    res = client.post(
        "/api/ai/synthesize",
        json={
            "roomTitle": "Kiểm tra JSON hỏng",
            "anonymize": True,
            "perspectives": [{"id": "p1", "handle": "Kỹ_thuật", "colorIndex": 0}],
            "messages": [{"senderType": "ai", "handle": "Kỹ_thuật", "content": "Lập luận test", "round": 0}],
            "sources": [],
        },
    )
    assert res.status_code == 200
    report = res.json()["report"]
    row = report["rubric"][0]
    assert row["fallbackScored"] is True
    assert row["evidence"] == 5.0
    assert row["logic"] == 5.0
    assert row["rebuttal"] == 5.0
    assert row["total"] == 5.0
    assert report["evaluationWarnings"]
    assert "@Kỹ_thuật" in report["evaluationWarnings"][0]


def test_judge_bidirectional_anonymization_masks_and_unmasks_all_fields(tmp_path: Path):
    captured_prompts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/chat/completions":
            payload = json.loads(request.content.decode("utf-8"))
            captured_prompts.append(str(payload["messages"][0]["content"]))
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "executiveSummary": "Ứng viên A đề xuất chuẩn [S1], nhưng Ứng viên B phản bác có cơ sở.",
                                        "consensus": [{"title": "Ứng viên A và Ứng viên B đồng ý chuẩn hóa log", "supporters": ["Ứng viên A", "@Ứng viên B"], "citations": ["S1"]}],
                                        "contradictions": [{"topic": "Cách Ứng viên A chọn model", "detail": "Ứng viên B cho rằng Ứng viên A bỏ qua độ trễ", "suggestedPrompt": "Hỏi Ứng viên A về P99"}],
                                        "gaps": ["Cần kiểm tra kịch bản mà Ứng viên B nêu"],
                                        "openDebates": ["Ứng viên A và Ứng viên B chưa thống nhất chi phí GPU."],
                                        "scores": [
                                            {"label": "Ứng viên A", "evidence": 8.0, "logic": 8.5, "rebuttal": 7.5, "summary": "Ứng viên A phân tích rõ.", "citations": ["S1"]},
                                            {"label": "Ứng viên B", "evidence": 8.5, "logic": 9.0, "rebuttal": 9.0, "summary": "Ứng viên B phản biện Ứng viên A tốt.", "citations": ["S1"]},
                                        ],
                                    },
                                    ensure_ascii=False,
                                )
                            }
                        }
                    ]
                },
            )
        return httpx.Response(404)

    bridge = BridgeClient("http://bridge.test", transport=httpx.MockTransport(handler))
    cfg = Settings(data_dir=tmp_path / "rooms", dist_dir=tmp_path / "dist")
    client = TestClient(create_app(cfg, bridge_client=bridge))

    res = client.post(
        "/api/ai/synthesize",
        json={
            "roomTitle": "Che danh tính 2 chiều",
            "anonymize": True,
            "perspectives": [
                {"id": "p1", "handle": "Kỹ_thuật", "colorIndex": 0},
                {"id": "p2", "handle": "Phản_biện", "colorIndex": 1},
            ],
            "messages": [
                {"senderType": "ai", "handle": "Kỹ_thuật", "content": "Tôi là @Kỹ_thuật đề xuất dùng LLM.", "round": 0},
                {"senderType": "ai", "handle": "Phản_biện", "content": "Phản đối lập luận của @Kỹ_thuật về chi phí.", "round": 1},
            ],
            "sources": [{"id": "S1", "title": "Paper", "origin": "arXiv", "excerpt": "Chi tiết chi phí"}],
        },
    )
    assert res.status_code == 200
    # 1. Chiều gửi: @Kỹ_thuật và @Phản_biện phải bị che hoàn toàn trong prompt gửi Trọng tài
    sent_prompt = captured_prompts[0]
    assert "Kỹ_thuật" not in sent_prompt
    assert "Phản_biện" not in sent_prompt
    assert "Ứng viên A" in sent_prompt

    # 2. Chiều nhận: Không còn sót nhãn 'Ứng viên A/B' ở mọi trường
    body = res.json()
    dumped = json.dumps(body["report"], ensure_ascii=False) + json.dumps(body["livingOutline"], ensure_ascii=False)
    assert "Ứng viên A" not in dumped
    assert "Ứng viên B" not in dumped
    assert "@Kỹ_thuật" in body["report"]["executiveSummary"]
    assert "@Phản_biện" in body["report"]["executiveSummary"]
    assert body["livingOutline"]["consensus"][0]["supporters"] == ["Kỹ_thuật", "Phản_biện"]
    assert "@Kỹ_thuật" in body["livingOutline"]["contradictions"][0]["suggestedPrompt"]


def test_research_role_unlocks_deep_length_and_preserves_full_dossier_for_critics(tmp_path: Path):
    client, _ = _make_captured_perspective_client(tmp_path)

    # 1. Bot Nghiên cứu / detailMode="deep" không bị khoá giới hạn 130-230 từ
    res_deep = client.post(
        "/api/ai/perspective",
        json={
            "perspective": {
                "id": "p-res",
                "handle": "Nghiên_cứu",
                "name": "Nghiên cứu nguồn",
                "rolePrompt": "In đầy đủ tài liệu.",
                "tags": ["Nghiên_cứu"],
                "modelLabel": "gemini-neon",
            },
            "prompt": "Tổng hợp tài liệu",
            "sources": [{"id": "S1", "origin": "arXiv", "title": "Paper", "excerpt": "A" * 1200}],
            "round": 0,
            "detailMode": "deep",
        },
    )
    assert res_deep.status_code == 200
    deep_prompt = res_deep.json()["rawPrompt"]
    assert "KHÔNG giới hạn 230 từ" in deep_prompt
    assert ("A" * 1200) in deep_prompt

    # 2. Ở vòng sau (Round 2), toàn bộ tài liệu dài của @Nghiên_cứu và thẻ Hồ sơ Tài liệu phải được giữ nguyên cho Bot Phản biện
    long_research_dossier = "HỒ SƠ TÀI LIỆU CHI TIẾT VÒNG 0: " + ("Dữ liệu thực nghiệm [S1] " * 45)
    long_system_dossier = "HỒ SƠ NGUỒN ĐẦY ĐỦ CHO PHẢN BIỆN: " + ("Nội dung gốc bài báo " * 30)
    res_critic = client.post(
        "/api/ai/perspective",
        json={
            "perspective": {
                "id": "p-crit",
                "handle": "Phản_biện",
                "name": "Phản biện",
                "rolePrompt": "Soi lỗi lập luận.",
                "modelLabel": "gemini-neon",
            },
            "prompt": "Hãy phản biện hồ sơ trên",
            "sources": [],
            "round": 2,
            "conversationHistory": [
                {
                    "round": 0,
                    "senderType": "system",
                    "content": long_system_dossier,
                    "preserveFull": True,
                },
                {
                    "round": 0,
                    "senderType": "ai",
                    "handle": "Nghiên_cứu",
                    "content": long_research_dossier,
                    "summary1Line": "Tóm tắt 1 dòng ngắn",
                    "preserveFull": True,
                },
                {
                    "round": 1,
                    "senderType": "user",
                    "content": "Làm rõ độ tin cậy dữ liệu",
                },
            ],
        },
    )
    assert res_critic.status_code == 200
    critic_prompt = res_critic.json()["rawPrompt"]
    assert "HỒ SƠ TÀI LIỆU CHI TIẾT VÒNG 0:" in critic_prompt
    assert "Dữ liệu thực nghiệm [S1]" in critic_prompt
    assert "HỒ SƠ NGUỒN ĐẦY ĐỦ CHO PHẢN BIỆN:" in critic_prompt

    # 3. Khi có 2 bài phân tích chuyên sâu dài (~9000 ký tự mỗi bài > 18000 ký tự), vẫn không bị cắt mất bài @Nghiên_cứu
    deep_r0_res = "PHAN_TICH_NGHIEN_CUU_CHUYEN_SAU " + ("X" * 8800)
    deep_r0_crit = "PHAN_BIEN_VONG_0_CHUYEN_SAU " + ("Y" * 8800)
    res_round1 = client.post(
        "/api/ai/perspective",
        json={
            "perspective": {
                "id": "p-crit",
                "handle": "Phản_biện",
                "name": "Phản biện",
                "rolePrompt": "Phản biện chéo.",
                "modelLabel": "gemini-neon",
            },
            "prompt": "Phản biện chéo vòng 1",
            "sources": [],
            "round": 1,
            "conversationHistory": [
                {"round": 0, "senderType": "ai", "handle": "Nghiên_cứu", "content": deep_r0_res, "preserveFull": True},
                {"round": 0, "senderType": "ai", "handle": "Phản_biện", "content": deep_r0_crit, "preserveFull": True},
            ],
        },
    )
    assert res_round1.status_code == 200
    r1_prompt = res_round1.json()["rawPrompt"]
    assert "PHAN_TICH_NGHIEN_CUU_CHUYEN_SAU" in r1_prompt
    assert "PHAN_BIEN_VONG_0_CHUYEN_SAU" in r1_prompt
    assert "[Lưu ý:" not in r1_prompt


@pytest.mark.asyncio
async def test_research_query_normalization_and_long_source_excerpts():
    normalized = normalize_academic_query(
        "Deep Research: Hãy nghiên cứu về fintech và các cách bắt thông tin mới và thị trường trong trading"
    )
    assert "deep research" not in normalized.lower()
    assert "fintech" in normalized.lower()
    assert "trading" in normalized.lower()

    long_abstract = "Algorithmic fintech market news sentiment trading architecture. " * 25  # ~1500 chars
    off_topic_abstract = "Ancient pottery archaeology excavation ceramic findings in Mediterranean."

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "export.arxiv.org" in url:
            xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>https://arxiv.org/abs/2501.99999</id>
    <published>2025-02-01T00:00:00Z</published>
    <title>Unrelated Pottery Study</title>
    <summary>{off_topic_abstract}</summary>
  </entry>
  <entry>
    <id>https://arxiv.org/abs/2501.12345</id>
    <published>2025-03-01T00:00:00Z</published>
    <title>Fintech Real-Time Market News Detection for Algorithmic Trading</title>
    <summary>{long_abstract}</summary>
  </entry>
</feed>"""
            return httpx.Response(200, text=xml)
        if "api.openalex.org" in url:
            return httpx.Response(200, json={"results": []})
        if "wikipedia.org" in url:
            return httpx.Response(200, json={"query": {"pages": {}}})
        return httpx.Response(404)

    items = await search_open_academic_sources(
        "Deep Research: fintech và cách bắt thông tin thị trường trong trading",
        transport=httpx.MockTransport(handler),
    )
    assert len(items) == 1  # Off-topic pottery paper filtered out automatically!
    assert "Fintech Real-Time Market News Detection" in items[0]["title"]
    assert len(items[0]["excerpt"]) > 900
    assert len(items[0]["excerpt"]) <= MAX_SOURCE_EXCERPT_LEN


def _build_synthetic_pdf_bytes(text: str) -> bytes:
    import io
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    writer = PdfWriter()
    page = writer.add_blank_page(612, 792)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})}
    )
    stream = DecodedStreamObject()
    stream.set_data(f"BT /F1 12 Tf 72 720 Td ({escaped}) Tj ET".encode("latin-1", errors="replace"))
    page[NameObject("/Contents")] = writer._add_object(stream)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def test_bridge_ephemeral_and_synthesize_exclude_lanes(tmp_path: Path):
    recorded_headers: list[dict[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        recorded_headers.append({k.lower(): v for k, v in request.headers.items()})
        if request.url.path == "/v1/lanes":
            return httpx.Response(
                200,
                json={
                    "lanes": [
                        {
                            "id": "acc1",
                            "is_self": False,
                            "reachable": True,
                            "control": "on",
                            "auth_ok": True,
                            "url": "http://127.0.0.1:10001",
                        }
                    ]
                },
            )
        if request.url.path == "/v1/chat/completions":
            return httpx.Response(
                200,
                headers={"X-Gateway-Lane": "acc3"},
                json={
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "executiveSummary": "Tổng kết [S1]",
                                        "consensus": [],
                                        "contradictions": [],
                                        "gaps": [],
                                        "openDebates": [],
                                        "scores": [
                                            {"label": "Ứng viên A", "evidence": 8.0, "logic": 8.0, "rebuttal": 8.0, "summary": "Tốt", "citations": ["S1"]},
                                            {"label": "Ứng viên B", "evidence": 8.5, "logic": 8.5, "rebuttal": 8.0, "summary": "Khá", "citations": ["S1"]},
                                        ],
                                    },
                                    ensure_ascii=False,
                                )
                            }
                        }
                    ]
                },
            )
        return httpx.Response(404)

    bridge = BridgeClient("http://127.0.0.1:10000", transport=httpx.MockTransport(handler))
    cfg = Settings(data_dir=tmp_path / "rooms", dist_dir=tmp_path / "dist")
    client = TestClient(create_app(cfg, bridge_client=bridge))

    # 1. Synthesize automatically sends X-DSH-Ephemeral: 1 and X-Exclude-Lanes: acc1,acc2
    res = client.post(
        "/api/ai/synthesize",
        json={
            "roomTitle": "Chấm chéo tài khoản",
            "anonymize": True,
            "perspectives": [
                {"id": "p1", "handle": "Nghiên_cứu", "colorIndex": 0},
                {"id": "p2", "handle": "Phản_biện", "colorIndex": 1},
            ],
            "messages": [
                {"senderType": "ai", "handle": "Nghiên_cứu", "laneId": "acc1", "content": "Theo [S1] tỷ lệ đạt 61.2%.", "round": 0},
                {"senderType": "ai", "handle": "Phản_biện", "laneId": "acc2", "content": "Phản biện [S1].", "round": 0},
            ],
            "sources": [{"id": "S1", "title": "Study", "origin": "arXiv", "excerpt": "Rate was 61.2%.", "contentLevel": "full_text"}],
        },
    )
    assert res.status_code == 200
    assert res.json()["laneId"] == "acc3"
    assert recorded_headers[-1].get("x-dsh-ephemeral") == "1"
    assert recorded_headers[-1].get("x-exclude-lanes") == "acc1,acc2"

    # 2. Perspective on pinned lane sends X-DSH-Ephemeral: 1 WITHOUT X-Exclude-Lanes
    res_pin = client.post(
        "/api/ai/perspective",
        json={
            "perspective": {"id": "p1", "handle": "Nghiên_cứu", "name": "NC", "rolePrompt": "Đọc nguồn", "pinnedLaneId": "acc1"},
            "prompt": "Kiểm tra pin",
            "sources": [],
            "round": 0,
        },
    )
    assert res_pin.status_code == 200
    assert recorded_headers[-1].get("x-dsh-ephemeral") == "1"
    assert "x-exclude-lanes" not in recorded_headers[-1]


@pytest.mark.asyncio
async def test_fetch_url_multi_hop_redirect_and_ssrf_block():
    from app.research import fetch_url_as_source

    def handler_ok(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url == "https://doi.org/10.1000/test":
            return httpx.Response(302, headers={"Location": "/step2/article"})
        if url == "https://doi.org/step2/article":
            return httpx.Response(301, headers={"Location": "https://cdn.example.org/final-paper.html"})
        if url == "https://cdn.example.org/final-paper.html":
            return httpx.Response(
                200,
                headers={"Content-Type": "text/html"},
                text="<html><head><title>Final DOI Paper</title></head><body>" + ("Academic findings. " * 200) + "</body></html>",
            )
        return httpx.Response(404)

    src = await fetch_url_as_source(
        "https://doi.org/10.1000/test",
        transport=httpx.MockTransport(handler_ok),
        resolve_dns=False,
    )
    assert src["title"] == "Final DOI Paper"
    assert src["url"] == "https://cdn.example.org/final-paper.html"
    assert src["contentLevel"] == "full_text"

    def handler_ssrf(request: httpx.Request) -> httpx.Response:
        if "doi.org" in str(request.url):
            return httpx.Response(302, headers={"Location": "http://127.0.0.1:10000/v1/lanes"})
        return httpx.Response(200, text="should not reach")

    with pytest.raises(ValueError, match="không được phép"):
        await fetch_url_as_source(
            "https://doi.org/10.1000/evil",
            transport=httpx.MockTransport(handler_ssrf),
            resolve_dns=False,
        )


def test_upload_pdf_extracts_fulltext_and_rejects_invalid_bytes(tmp_path: Path):
    import base64

    bridge = BridgeClient("http://bridge.test")
    cfg = Settings(data_dir=tmp_path / "rooms", dist_dir=tmp_path / "dist")
    client = TestClient(create_app(cfg, bridge_client=bridge))

    pdf_bytes = _build_synthetic_pdf_bytes(
        "Randomized trial of 420 patients showed primary outcome reduction of 38.5%."
    )
    res_bin = client.post(
        "/api/research/upload-pdf?filename=clinical_trial_2026.pdf",
        headers={"Content-Type": "application/pdf"},
        content=pdf_bytes,
    )
    assert res_bin.status_code == 200
    item = res_bin.json()["item"]
    assert item["contentLevel"] == "full_text"
    assert "38.5%" in item["excerpt"]
    assert "420 patients" in item["excerpt"]
    assert "clinical_trial_2026.pdf" in item["title"]

    res_json = client.post(
        "/api/research/upload-pdf",
        json={"filename": "study_b64.pdf", "contentBase64": base64.b64encode(pdf_bytes).decode("ascii")},
    )
    assert res_json.status_code == 200
    assert res_json.json()["item"]["contentLevel"] == "full_text"

    res_bad = client.post(
        "/api/research/upload-pdf?filename=fake.pdf",
        headers={"Content-Type": "application/pdf"},
        content=b"not a real pdf binary header",
    )
    assert res_bad.status_code == 400
    assert "PDF" in res_bad.json()["error"]


@pytest.mark.asyncio
async def test_search_upgrades_open_access_arxiv_to_fulltext_pdf():
    from app.research import MAX_FULLTEXT_EXCERPT_LEN

    full_pdf_text = (
        "Full text Clinical Multi-Center Study on Fintech Real-Time Sentiment Trading: "
        "We evaluated 1240 trading sessions and measured 74.8% precision. " * 15
    )
    pdf_bytes = _build_synthetic_pdf_bytes(full_pdf_text)

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "export.arxiv.org" in url:
            xml = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>https://arxiv.org/abs/2501.55555</id>
    <published>2025-04-01T00:00:00Z</published>
    <title>Fintech Real-Time Market Signal Trading Architecture</title>
    <summary>Short abstract about fintech market signal trading.</summary>
  </entry>
</feed>"""
            return httpx.Response(200, text=xml)
        if url == "https://arxiv.org/pdf/2501.55555.pdf":
            return httpx.Response(200, headers={"Content-Type": "application/pdf"}, content=pdf_bytes)
        return httpx.Response(404, json={"results": []})

    items = await search_open_academic_sources(
        "fintech market signal trading",
        transport=httpx.MockTransport(handler),
        upgrade_fulltext=True,
    )
    assert len(items) == 1
    assert items[0]["contentLevel"] == "full_text"
    assert "74.8% precision" in items[0]["excerpt"]
    assert "Toàn văn PDF" in items[0]["origin"]
    assert len(items[0]["excerpt"]) <= MAX_FULLTEXT_EXCERPT_LEN


def test_verifier_detects_fabricated_numbers_and_distinguishes_inferences():
    from app.verifier import format_verification_for_judge, verify_perspective_turn

    sources = [
        {
            "id": "S1",
            "origin": "NEJM · 2024",
            "title": "PFO Closure Trial",
            "contentLevel": "abstract_only",
            "excerpt": "In 664 patients, recurrence rate was 1.6% vs 5.2% (HR 0.28, p = 0.01).",
        }
    ]

    # 1. Mixed valid stats + fabricated stat + invalid citation + honest inference
    text = (
        "Tỷ lệ tái phát đạt 1,6% với 664 bệnh nhân [S1].\n"
        "Tuy nhiên tỷ lệ tử vong tăng 94.7% trong mẫu mở rộng [S1] và theo [S9] cũng tương tự.\n"
        "Với kết quả này có thể suy đoán lợi ích tăng thêm khoảng 25% ở nhóm trẻ [Suy luận từ S1]."
    )
    ver = verify_perspective_turn(text, sources)
    assert ver["validCitations"] == ["S1"]
    assert ver["inferredCitations"] == ["S1"]
    assert ver["invalidCitations"] == ["S9"]
    # Matched: 1,6% and 664 patients (2 matched); unverified: 94.7% (1 unmatched); 25% skipped because [Suy luận từ S1]
    assert ver["numericClaimsMatched"] == 2
    assert ver["numericClaimsChecked"] == 3
    assert [u["number"] for u in ver["unverifiedNumbers"]] == ["94.7%"]
    assert ver["abstractOnlyCited"] == ["S1"]
    assert len(ver["warnings"]) == 2

    # 2. Verify Judge verification block respects anonymize=True (zero handle leak)
    alias_map = {"Kỹ_thuật": "Ứng viên A"}
    report_str, summary = format_verification_for_judge(
        [{"senderType": "ai", "handle": "Kỹ_thuật", "content": text}],
        sources,
        alias_map,
        anonymize=True,
    )
    assert "Ứng viên A" in report_str
    assert "Kỹ_thuật" not in report_str
    assert "94.7%" in report_str
    assert summary["totalInvalidCitations"] == 1
    assert summary["totalNumericMatched"] == 2
    assert summary["totalNumericChecked"] == 3
