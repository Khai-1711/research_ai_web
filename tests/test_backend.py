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
from app.research import is_safe_public_url


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
