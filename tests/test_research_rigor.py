"""Kiểm thử các cải tiến P0 về độ tin cậy nghiên cứu:
1) Verifier nhận [S1, S2] / [S1-S3], không khớp nhầm "5%" với "Table 5", có dung sai làm tròn, tách ô bảng.
2) Kiểm chứng mức câu: hạ nhãn khi câu bằng chứng không có nguyên văn trong nguồn.
3) Trọng tài: chấm nhiều lần với thứ tự đảo, trung bình + độ lệch, cảnh báo thứ hạng không ổn định,
   cảnh báo cùng họ model, không bịa tóm tắt khi JSON hỏng, khớp nhãn chính xác (không so chuỗi con).
4) Provenance: lane không bị thay bằng lane frontend đoán; nguồn có loại + metadata truy xuất.
"""

from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from app.bridge import BridgeClient
from app.claim_check import parse_claim_check, quote_found_in_sources, summarize_claim_support
from app.config import Settings
from app.judge import build_alias_maps, candidate_order_for_run, find_score_row, model_family
from app.main import create_app
from app.research import classify_openalex_work, search_open_academic_sources
from app.verifier import (
    collect_cited_claims,
    expand_citation_group,
    extract_cited_sources,
    verify_perspective_turn,
)

SRC = [
    {"id": "S1", "origin": "arXiv", "title": "A", "excerpt": "Accuracy was 71.3 in Table 5 with 120 participants."},
    {"id": "S2", "origin": "OpenAlex", "title": "B", "excerpt": "Growth reached 31.64% in 2023 (ratio 0.052)."},
    {"id": "S3", "origin": "Wiki", "title": "C", "excerpt": "nothing numeric"},
]


def _chat_response(content: str, lane: str | None = None) -> httpx.Response:
    headers = {"X-Gateway-Lane": lane} if lane else {}
    return httpx.Response(200, headers=headers, json={"choices": [{"message": {"content": content}}]})


def _client(tmp_path: Path, handler) -> TestClient:
    bridge = BridgeClient("http://bridge.test", max_retries=0, transport=httpx.MockTransport(handler))
    cfg = Settings(data_dir=tmp_path / "rooms", dist_dir=tmp_path / "dist")
    return TestClient(create_app(cfg, bridge_client=bridge))


# ---------------------------------------------------------------- 1. Verifier
def test_citation_groups_and_ranges_are_parsed():
    assert expand_citation_group("S1, S2") == ["S1", "S2"]
    assert expand_citation_group("S1-S3") == ["S1", "S2", "S3"]
    assert expand_citation_group("S2–S4") == ["S2", "S3", "S4"]
    assert expand_citation_group("S1; S3") == ["S1", "S3"]
    assert expand_citation_group("S2,4") == ["S2", "S4"]
    valid = {"S1", "S2", "S3"}
    assert extract_cited_sources("Theo [S2, S1] và [Suy luận từ S3].", valid) == ["S2", "S1", "S3"]


def test_multi_source_citation_is_no_longer_a_blind_spot():
    v = verify_perspective_turn("Độ chính xác đạt 99.9% [S1, S2].", SRC)
    assert v["validCitations"] == ["S1", "S2"]
    assert v["numericClaimsChecked"] == 1
    assert v["numericClaimsMatched"] == 0
    assert v["unverifiedNumbers"][0]["cited"] == ["S1", "S2"]

    v_range = verify_perspective_turn("Độ chính xác đạt 99.9% [S1-S3].", SRC)
    assert v_range["validCitations"] == ["S1", "S2", "S3"]

    v_bad = verify_perspective_turn("Theo [S1, S9] thì vậy.", SRC)
    assert v_bad["invalidCitations"] == ["S9"]


def test_integer_percent_does_not_match_unrelated_integer():
    v = verify_perspective_turn("Độ chính xác đạt 5% [S1].", SRC)
    assert v["numericClaimsChecked"] == 1
    assert v["numericClaimsMatched"] == 0


def test_rounding_tolerance_and_fraction_forms():
    assert verify_perspective_turn("Tăng trưởng 31.6% [S2].", SRC)["numericClaimsMatched"] == 1
    assert verify_perspective_turn("Tăng trưởng 32% [S2].", SRC)["numericClaimsMatched"] == 1
    # AI thêm độ chính xác mà nguồn không có -> không khớp
    assert verify_perspective_turn("Tăng trưởng 31.641% [S2].", SRC)["numericClaimsMatched"] == 0
    # 0.052 trong nguồn <-> 5.2%
    assert verify_perspective_turn("Tỉ lệ 5.2% [S2].", SRC)["numericClaimsMatched"] == 1
    # Bảng ghi "Accuracy (%) 71.3": số có phần thập phân vẫn khớp
    assert verify_perspective_turn("Accuracy 71.3% [S1].", SRC)["numericClaimsMatched"] == 1


def test_table_cells_are_checked_separately():
    text = "| Chỉ số | Giá trị |\n|---|---|\n| Accuracy 71.3% [S1] | +12.4% [Suy luận từ S1] |"
    v = verify_perspective_turn(text, SRC)
    assert v["numericClaimsChecked"] == 1
    assert v["numericClaimsMatched"] == 1
    assert v["unverifiedNumbers"] == []


def test_collect_cited_claims_balances_handles_and_numbers_first():
    messages = [
        {"senderType": "ai", "handle": "A", "content": "Câu một [S1]. Có 120 participants [S1]. Câu ba [S3].", "round": 0},
        {"senderType": "ai", "handle": "B", "content": "Ý kiến @A sai [S2].", "round": 1},
        {"senderType": "user", "content": "Câu người dùng [S1]."},
    ]
    claims = collect_cited_claims(messages, SRC, max_claims=3)
    assert [c["id"] for c in claims] == ["C1", "C2", "C3"]
    assert claims[0]["handle"] == "A" and "120 participants" in claims[0]["sentence"]
    assert claims[1]["handle"] == "B" and "@AI" in claims[1]["sentence"] and "@A " not in claims[1]["sentence"]


# ---------------------------------------------------------------- 2. Claim check
def test_quote_guard_downgrades_hallucinated_support():
    assert quote_found_in_sources("Accuracy was 71.3 in Table 5", [SRC[0]["excerpt"]])
    assert quote_found_in_sources("Accuracy was 71.3 … with 120 participants", [SRC[0]["excerpt"]])
    assert not quote_found_in_sources("Accuracy was 99 percent overall", [SRC[0]["excerpt"]])

    claims = [
        {"id": "C1", "handle": "A", "sentence": "Độ chính xác 71.3 [S1]", "sourceIds": ["S1"]},
        {"id": "C2", "handle": "A", "sentence": "Độ chính xác 99% [S1]", "sourceIds": ["S1"]},
        {"id": "C3", "handle": "B", "sentence": "Tăng 31.64% [S2]", "sourceIds": ["S2"]},
        {"id": "C4", "handle": "B", "sentence": "Không có nhãn [S3]", "sourceIds": ["S3"]},
    ]
    llm_text = json.dumps(
        {
            "claims": [
                {"id": "C1", "label": "supported", "evidence": "Accuracy was 71.3 in Table 5"},
                {"id": "C2", "label": "supported", "evidence": "Accuracy reached 99 percent in all trials"},
                {"id": "C3", "label": "unsupported", "evidence": ""},
            ]
        }
    )
    results = parse_claim_check(llm_text, claims, SRC)
    labels = {r["id"]: r["label"] for r in results}
    assert labels == {"C1": "supported", "C2": "unclear", "C3": "unsupported", "C4": "unchecked"}
    assert next(r for r in results if r["id"] == "C2")["downgradedNoQuote"] is True
    summary = summarize_claim_support(results)
    assert summary["totals"]["supported"] == 1
    assert summary["byHandle"]["B"]["unsupported"] == 1
    assert any("@B" in w for w in summary["warnings"])


# ---------------------------------------------------------------- 3. Judge
def test_candidate_orders_and_alias_labels():
    handles = ["X", "Y", "Z"]
    assert candidate_order_for_run(handles, 0, "s") == ["X", "Y", "Z"]
    assert candidate_order_for_run(handles, 1, "s") == ["Z", "Y", "X"]
    assert candidate_order_for_run(handles, 2, "s") == candidate_order_for_run(handles, 2, "s")
    alias, _rev = build_alias_maps([f"h{i}" for i in range(28)], anonymize=True)
    assert len(set(alias.values())) == 28
    assert alias["h26"] == "Ứng viên AA"


def test_score_label_matching_is_exact_not_substring():
    alias, rev = build_alias_maps(["Kỹ_thuật", "Kỹ_thuật_2"], anonymize=False)
    parsed = {"scores": [{"label": "@Kỹ_thuật_2", "evidence": 2}, {"label": "@Kỹ_thuật", "evidence": 9}]}
    assert find_score_row(parsed, "Kỹ_thuật", alias, rev)["evidence"] == 9
    assert find_score_row(parsed, "Kỹ_thuật_2", alias, rev)["evidence"] == 2
    alias_a, rev_a = build_alias_maps(["P", "Q"], anonymize=True)
    parsed_a = {"scores": [{"label": "Candidate B (strong)", "evidence": 7}]}
    assert find_score_row(parsed_a, "Q", alias_a, rev_a)["evidence"] == 7
    assert find_score_row(parsed_a, "P", alias_a, rev_a) == {}


def test_model_family():
    assert model_family("bridge", "gemini-neon") == "gemini"
    assert model_family("openai_compat", "gpt-4o-mini") == "gpt"
    assert model_family("openai_compat", "deepseek-chat") == "deepseek"
    assert model_family("openai_compat", "meta-llama/llama-3.3-70b") == "llama"


def _position_biased_judge(prompts: list[str]):
    """Trọng tài giả lập thiên lệch vị trí: luôn cho 'Ứng viên A' 9 điểm, 'Ứng viên B' 5 điểm."""

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        prompt = str(payload["messages"][0]["content"])
        prompts.append(prompt)
        if "câu khẳng định" in prompt.lower():
            return _chat_response(json.dumps({"claims": []}), lane="acc9")
        return _chat_response(
            json.dumps(
                {
                    "executiveSummary": "Ứng viên A mạnh hơn Ứng viên B [S1].",
                    "consensus": [],
                    "contradictions": [],
                    "gaps": [],
                    "openDebates": [],
                    "scores": [
                        {"label": "Ứng viên A", "evidence": 9, "logic": 9, "rebuttal": 9, "summary": "A"},
                        {"label": "Ứng viên B", "evidence": 5, "logic": 5, "rebuttal": 5, "summary": "B"},
                    ],
                },
                ensure_ascii=False,
            ),
            lane="acc9",
        )

    return handler


def test_judge_runs_swap_order_and_expose_position_bias(tmp_path: Path):
    prompts: list[str] = []
    client = _client(tmp_path, _position_biased_judge(prompts))
    res = client.post(
        "/api/ai/synthesize",
        json={
            "roomTitle": "Thiên lệch vị trí",
            "anonymize": True,
            "judgeRuns": 2,
            "perspectives": [
                {"id": "p1", "handle": "Một", "colorIndex": 0, "providerId": "bridge-local", "modelLabel": "gemini-neon"},
                {"id": "p2", "handle": "Hai", "colorIndex": 1, "providerId": "bridge-local", "modelLabel": "gemini-carbon"},
            ],
            "messages": [
                {"senderType": "ai", "handle": "Một", "content": "NOI_DUNG_MOT [S1].", "round": 0},
                {"senderType": "ai", "handle": "Hai", "content": "NOI_DUNG_HAI [S1].", "round": 0},
            ],
            "sources": [{"id": "S1", "title": "P", "origin": "arXiv", "excerpt": "Some text here", "sourceType": "preprint"}],
        },
    )
    assert res.status_code == 200
    judge_prompts = [p for p in prompts if "Trọng tài" in p]
    assert len(judge_prompts) == 2
    first_a = re.search(r"Ứng viên A:\n(\S+)", judge_prompts[0]).group(1)
    second_a = re.search(r"Ứng viên A:\n(\S+)", judge_prompts[1]).group(1)
    assert {first_a, second_a} == {"NOI_DUNG_MOT", "NOI_DUNG_HAI"}  # thứ tự thật sự được đảo
    assert "[PREPRINT · chưa bình duyệt]" in judge_prompts[0]

    report = res.json()["report"]
    for row in report["rubric"]:
        assert row["total"] == 7.0
        assert row["totalSpread"] == 4.0
        assert row["runsScored"] == 2
    rel = report["judgeReliability"]
    assert rel["runsCompleted"] == 2 and rel["rankingStable"] is False
    assert rel["sameFamilyAsDebaters"] is True and rel["judgeFamily"] == "gemini"
    warnings = " ".join(report["evaluationWarnings"])
    assert "KHÔNG ổn định" in warnings
    assert "THAY ĐỔI khi đảo thứ tự" in warnings
    assert "tự ưu ái" in warnings
    assert "claimSupport" in report["verificationSummary"]
    assert "Ứng viên" not in report["executiveSummary"]


def test_judge_parse_failure_is_reported_not_fabricated(tmp_path: Path):
    client = _client(tmp_path, lambda req: _chat_response("không phải JSON"))
    res = client.post(
        "/api/ai/synthesize",
        json={
            "roomTitle": "JSON hỏng",
            "anonymize": True,
            "claimCheck": False,
            "perspectives": [{"id": "p1", "handle": "Một", "colorIndex": 0}],
            "messages": [{"senderType": "ai", "handle": "Một", "content": "x", "round": 0}],
            "sources": [],
        },
    )
    report = res.json()["report"]
    assert report["executiveSummary"].startswith("⚠")
    assert "đã tổng hợp các lập luận chính" not in report["executiveSummary"]
    assert report["evaluationWarnings"][0].startswith("@Một")
    assert any("JSON không hợp lệ ở 2/2" in w for w in report["evaluationWarnings"])
    assert report["judgeReliability"]["runsParsed"] == 0


# ---------------------------------------------------------------- 4. Provenance
def test_perspective_lane_is_not_replaced_by_client_guess(tmp_path: Path):
    client = _client(tmp_path, lambda req: _chat_response("Kết luận: ok [S1]."))
    res = client.post(
        "/api/ai/perspective",
        json={
            "perspective": {"id": "p1", "handle": "Một", "name": "M", "rolePrompt": "", "modelLabel": "gemini-neon"},
            "prompt": "Hỏi",
            "sources": [],
            "round": 0,
            "laneId": "acc2",
        },
    )
    data = res.json()
    assert data["laneId"] == "bridge"
    prov = data["provenance"]
    assert prov["laneSource"] == "unreported"
    assert prov["laneRequestedByClient"] == "acc2"
    assert prov["providerId"] == "bridge-local" and prov["providerKind"] == "bridge"
    assert prov["modelRequested"] == "gemini-neon"

    client_gw = _client(tmp_path / "gw", lambda req: _chat_response("Kết luận: ok.", lane="acc3"))
    data_gw = client_gw.post(
        "/api/ai/perspective",
        json={"perspective": {"id": "p1", "handle": "Một", "name": "M"}, "prompt": "Hỏi", "sources": [], "laneId": "acc1"},
    ).json()
    assert data_gw["laneId"] == "acc3" and data_gw["provenance"]["laneSource"] == "gateway"


def test_openalex_classification():
    assert classify_openalex_work({"type": "preprint"}) == "preprint"
    assert classify_openalex_work({"type": "article", "primary_location": {"source": {"type": "repository"}}}) == "preprint"
    assert classify_openalex_work({"type": "article", "primary_location": {"version": "submittedVersion", "source": {"type": "journal"}}}) == "preprint"
    assert classify_openalex_work({"type": "article", "primary_location": {"source": {"type": "journal"}}}) == "published_venue"
    assert classify_openalex_work({"type": "book"}) == "other_scholarly"


def test_search_results_carry_source_type_and_retrieval_metadata():
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "export.arxiv.org" in url:
            return httpx.Response(
                200,
                text="""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>https://arxiv.org/abs/2501.1</id>
<published>2025-01-01T00:00:00Z</published><title>Fintech trading signals</title>
<summary>Fintech trading signals study.</summary></entry></feed>""",
            )
        if "api.openalex.org" in url:
            return httpx.Response(
                200,
                json={
                    "results": [
                        {
                            "title": "Fintech trading journal paper",
                            "type": "article",
                            "publication_year": 2024,
                            "cited_by_count": 42,
                            "doi": "https://doi.org/10.1/x",
                            "primary_location": {"source": {"type": "journal", "display_name": "J. Finance"}},
                        }
                    ]
                },
            )
        return httpx.Response(200, json={"query": {"pages": {}}})

    items = asyncio.run(
        search_open_academic_sources(
            "fintech trading", transport=httpx.MockTransport(handler), upgrade_fulltext=False
        )
    )
    by_type = {i["sourceType"]: i for i in items}
    assert set(by_type) == {"preprint", "published_venue"}
    journal = by_type["published_venue"]
    assert journal["venue"] == "J. Finance" and journal["citedByCount"] == 42
    for item in items:
        r = item["retrieval"]
        assert r["query"] == "fintech trading" and r["retrievedAt"] and r["rank"] >= 1
        assert r["provider"] in ("arxiv", "openalex")
        assert r["params"]["maxSources"] == 6
        assert "_provider" not in item and "_pdf_url" not in item


def test_multilingual_prompts_and_verifier():
    from app.judge import build_judge_prompt
    from app.prompts import build_perspective_prompts, extract_summary_1line
    from app.verifier import verify_perspective_turn

    # 1. Perspective prompt enforces replying in user's language, not hardcoded Vietnamese
    sys_p, user_p, _ = build_perspective_prompts(
        perspective={"handle": "Quant", "name": "Quant Architect", "rolePrompt": "Analyze risk.", "tags": []},
        prompt="Compare Sharpe vs Sortino ratios for crypto bots.",
        sources=[],
        round_num=0,
        conversation_history=[],
        peer_messages=[],
    )
    assert "bằng tiếng Việt" not in sys_p
    assert "ĐÚNG NGÔN NGỮ" in sys_p
    assert "Compare Sharpe vs Sortino ratios" in user_p

    # 2. extract_summary_1line strips localized conclusion prefixes cleanly
    assert extract_summary_1line("Conclusion: Asymmetric reward lowers drawdown risk.") == "Asymmetric reward lowers drawdown risk."
    assert extract_summary_1line("**结论：** 策略需先做样本外检验并控制滑点。") == "策略需先做样本外检验并控制滑点。"
    assert extract_summary_1line("結論：過剰最適化を防ぐためウォークフォワード検証が必要。") == "過剰最適化を防ぐためウォークフォワード検証が必要。"
    assert extract_summary_1line("결론: 슬리피지 반영 없이는 실전 수익을 보장할 수 없다.") == "슬리피지 반영 없이는 실전 수익을 보장할 수 없다."

    # 3. Verifier parses multilingual inference tags, CJK group citations & CJK % suffixes
    text = (
        "Accuracy reached 81.4% [S1、S2]. "
        "Sharpe ratio is 1.9 [Inferred from S1] · [推论自 S2] · [推論: S1] · [추론: S2]."
    )
    res = verify_perspective_turn(
        text,
        [
            {"id": "S1", "contentLevel": "full_text", "excerpt": "81.4 パーセント efficiency recorded."},
            {"id": "S2", "contentLevel": "full_text", "excerpt": "Baseline control."},
        ],
    )
    assert res["validCitations"] == ["S1", "S2"]
    assert res["inferredCitations"] == ["S1", "S2"]
    assert res["numericClaimsMatched"] == 1

    # 4. Judge prompt retains internal Ứng viên A/B while instructing output in user's language
    jp = build_judge_prompt(
        room_title="Crypto Bot Eval",
        messages=[{"round": 0, "senderType": "user", "content": "Evaluate this bot."}],
        sources=[],
        alias_map={"Quant": "Ứng viên A"},
        anonymize=True,
    )
    assert "Ứng viên A" in jp
    assert "JSON hợp lệ tiếng Việt" not in jp
    assert "ĐÚNG NGÔN NGỮ" in jp
