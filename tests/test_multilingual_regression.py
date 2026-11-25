"""Kiểm thử hồi quy đa ngôn ngữ (V1–V10 tiếng Việt, C1–C10 CJK) theo TODO_SUA_LOI_DA_NGON_NGU.md."""

from __future__ import annotations

import pytest

from app.claim_check import quote_found_in_sources
from app.verifier import _split_sentences, collect_cited_claims, verify_perspective_turn


SOURCE_VI_TEXT = "Độ chính xác đạt 81,4% trên tập kiểm tra với n = 120 người tham gia; độ trễ 2.4 giây."
SOURCES_VI = [{"id": "S1", "title": "Vi Benchmark", "excerpt": SOURCE_VI_TEXT}]


@pytest.mark.parametrize(
    ("case_id", "ai_text", "exp_valid", "exp_checked", "exp_matched"),
    [
        ("V1", "Độ chính xác đạt 81,4% [S1].", ["S1"], 1, 1),
        ("V2", "Độ chính xác đạt 95% [S1].", ["S1"], 1, 0),
        ("V3", "Mức tăng đạt81,4% [S1].", ["S1"], 0, 0),
        ("V4", "Dùng mô hình v2.5 [S1].", ["S1"], 0, 0),
        ("V5", "Kết quả [S1 và S1].", ["S1"], 0, 0),
        ("V6", "Độ trễ 2.4 giây [S1].", ["S1"], 1, 1),
        ("V7", "Xem Bảng 5 [S1].", ["S1"], 0, 0),
    ],
)
def test_vietnamese_regression_v1_to_v7(
    case_id: str,
    ai_text: str,
    exp_valid: list[str],
    exp_checked: int,
    exp_matched: int,
) -> None:
    res = verify_perspective_turn(ai_text, SOURCES_VI)
    assert res["validCitations"] == exp_valid, case_id
    if case_id == "V3":
        # Sau sửa 3.2: checked == 0 hoặc (checked == 1 and matched == 1), tuyệt đối không còn đọc nhầm 4%
        ok = (res["numericClaimsChecked"] == 0) or (
            res["numericClaimsChecked"] == 1 and res["numericClaimsMatched"] == 1
        )
        assert ok, f"V3 unexpected result: {res}"
    else:
        assert res["numericClaimsChecked"] == exp_checked, case_id
        assert res["numericClaimsMatched"] == exp_matched, case_id


def test_vietnamese_regression_v8_to_v10() -> None:
    # V8: tách câu tiếng Việt giữ nguyên 4 câu
    sents = _split_sentences("Câu một có 81,4% [S1]. Câu hai? Câu ba! Giá 2.4 giây.")
    assert len(sents) == 4

    # V9: quote tiếng Việt đủ dài khớp trong nguồn
    assert quote_found_in_sources("độ chính xác đạt 81,4% trên tập kiểm tra", [SOURCE_VI_TEXT]) is True

    # V10: quote quá ngắn bị từ chối
    assert quote_found_in_sources("81,4%", [SOURCE_VI_TEXT]) is False


@pytest.mark.parametrize(
    ("case_id", "ai_text", "source_text", "exp_checked", "exp_matched"),
    [
        ("C1", "准确率为95.0%[S1]。", "该模型在测试集上的准确率为81.4%，高于基线。", 1, 0),
        ("C2", "准确率为81.4%[S1]。", "该模型在测试集上的准确率为81.4%，高于基线。", 1, 1),
        ("C3", "精度は81.4%でした[S1]。", "評価データでの精度は81.4%でした。", 1, 1),
        ("C4", "정확도는81.4%였다 [S1].", "평가 데이터셋 정확도는81.4%였다.", 1, 1),
    ],
)
def test_cjk_numeric_claims_c1_to_c4(
    case_id: str,
    ai_text: str,
    source_text: str,
    exp_checked: int,
    exp_matched: int,
) -> None:
    res = verify_perspective_turn(ai_text, [{"id": "S1", "title": case_id, "excerpt": source_text}])
    assert res["validCitations"] == ["S1"], case_id
    assert res["numericClaimsChecked"] == exp_checked, case_id
    assert res["numericClaimsMatched"] == exp_matched, case_id


def test_cjk_quote_matching_c5_to_c7() -> None:
    zh_src = ["该模型在测试集上的准确率为81.4%，显著高于基线方法。"]
    ja_src = ["本実験での精度は81.4%でした。"]

    # C5
    assert quote_found_in_sources("准确率为81.4%，显著高于基线", zh_src) is True
    # C6
    assert quote_found_in_sources("精度は81.4%でした", ja_src) is True
    # C7
    assert quote_found_in_sources("81.4%", zh_src) is False
    assert quote_found_in_sources("准确率", zh_src) is False


def test_cjk_sentence_splitting_c8() -> None:
    sents = _split_sentences("第一句81.4%[S1]。第二句[推论自 S2]。第三句？好的！")
    assert len(sents) == 4


def test_cjk_fullwidth_group_citations_c9() -> None:
    sources = [
        {"id": "S1", "title": "A", "excerpt": "Alpha 10%"},
        {"id": "S2", "title": "B", "excerpt": "Beta 20%"},
    ]
    assert verify_perspective_turn("结果见[S1，S2]。", sources)["validCitations"] == ["S1", "S2"]
    assert verify_perspective_turn("结果见[S1；S2]。", sources)["validCitations"] == ["S1", "S2"]


def test_cjk_mixed_sentence_attribution_c10() -> None:
    sources = [
        {"id": "S1", "title": "EN", "excerpt": "Accuracy is 81.4% on validation."},
        {"id": "S2", "title": "JA", "excerpt": "比較実験の精度は12.5%でした。"},
    ]
    ai_text = "Accuracy 81.4% [S1]。精度は12.5%[S2]。"
    ver = verify_perspective_turn(ai_text, sources)
    assert ver["numericClaimsChecked"] == 2
    assert ver["numericClaimsMatched"] == 2

    claims = collect_cited_claims(
        [{"senderType": "ai", "handle": "Research", "round": 1, "content": ai_text}],
        sources,
    )
    assert len(claims) == 2
    assert claims[0]["sourceIds"] == ["S1"]
    assert claims[0]["hasNumber"] is True
    assert claims[1]["sourceIds"] == ["S2"]
    assert claims[1]["hasNumber"] is True


def test_cjk_percent_variants_and_summary_36() -> None:
    from app.prompts import extract_summary_1line

    # 3.6a: extract_summary_1line với câu CJK ngắn & tiền tố mở rộng
    assert extract_summary_1line("结论：策略可行。\n详细分析在第二段。") == "策略可行。"
    assert extract_summary_1line("总结：方案可用。") == "方案可用。"
    assert extract_summary_1line("まとめ：精度が向上。") == "精度が向上。"
    assert extract_summary_1line("요약: 전략 유효함.") == "전략 유효함."

    # 3.6b: các cách viết phần trăm khác nhau (％, 퍼센트, 百分之81.4) cả ở AI lẫn nguồn
    cases = [
        ("准确率为81.4％[S1]。", "该模型在测试集上的准确率为81.4％，高于基线。", 1, 1),
        ("准确率为百分之81.4[S1]。", "测试集准确率为百分之81.4。", 1, 1),
        ("정확도는 81.4 퍼센트 [S1].", "평가 데이터 정확도는 81.4 퍼센트다.", 1, 1),
        ("准确率为百分之95.0[S1]。", "测试集准确率为百分之81.4。", 1, 0),
    ]
    for ai_text, src_text, exp_checked, exp_matched in cases:
        res = verify_perspective_turn(ai_text, [{"id": "S1", "title": "P", "excerpt": src_text}])
        assert res["numericClaimsChecked"] == exp_checked, ai_text
        assert res["numericClaimsMatched"] == exp_matched, ai_text


def _load_vi_i18n_templates() -> dict[str, str]:
    """Đọc các mẫu dịch VI trực tiếp từ src/utils/i18n.tsx để kiểm khớp nguyên văn."""
    import re
    from pathlib import Path

    i18n_path = Path(__file__).resolve().parents[1] / "src" / "utils" / "i18n.tsx"
    src = i18n_path.read_text(encoding="utf-8")
    block_m = re.search(r"const VI = \{(.*?)\n\} as const;", src, re.DOTALL)
    assert block_m is not None
    block = block_m.group(1)

    templates: dict[str, str] = {}
    # Single-line or wrapped key: '...', or key:\n  '...'
    entry_re = re.compile(
        r"""^\s{2}([A-Za-z0-9_]+)\s*:\s*(?:\n\s*)?(['"])((?:\\.|(?!\2).)*)\2\s*,""",
        re.MULTILINE,
    )
    for m in entry_re.finditer(block):
        key = m.group(1)
        val = m.group(3).replace("\\'", "'").replace('\\"', '"')
        templates[key] = val
    return templates


def _format_vi_structured_warning(item: dict, vi: dict[str, str]) -> str:
    p = item.get("params") or {}
    code = item["code"]
    if code == "fallback_scored":
        return vi["warnFallbackScored"].format(**p)
    if code == "partial_scores":
        return vi["warnPartialScores"].format(**p)
    if code == "score_unstable":
        return vi["warnScoreUnstable"].format(**p)
    if code == "ranking_changed":
        return vi["warnRankingChanged"]
    if code == "same_family":
        return vi["warnSameFamily"].format(**p)
    if code == "parse_failed":
        return vi["warnParseFailed"].format(**p)
    if code == "call_failed":
        return vi["warnCallFailed"].format(**p)
    if code == "claim_unsupported":
        return vi["warnClaimUnsupported"].format(**p)
    if code == "claim_downgraded":
        return vi["warnClaimDowngraded"].format(**p)
    if code == "claim_check_failed":
        return vi["warnClaimCheckFailed"].format(**p)
    if code == "claim_unchecked":
        return vi["warnClaimUnchecked"].format(**p)
    if code == "invalid_citations":
        return vi["warnInvalidCitations"].format(**p)
    if code == "unverified_numbers":
        extra_n = int(p.get("extraCount") or 0)
        extra = vi["warnUnverifiedNumbersExtra"].format(extraCount=extra_n) if extra_n > 0 else ""
        return vi["warnUnverifiedNumbers"].format(count=p["count"], preview=p["preview"], extra=extra)
    return item["text"]


def test_structured_warnings_codes_and_vi_exact_parity(tmp_path) -> None:
    import json
    import httpx
    from fastapi.testclient import TestClient
    from app.bridge import BridgeClient
    from app.config import Settings
    from app.main import create_app

    vi = _load_vi_i18n_templates()

    # 1. Verifier warningItems (invalid_citations + unverified_numbers với >4 số để kiểm extraCount)
    v = verify_perspective_turn(
        "Kết quả [S99]: 11.1% [S1], 22.2% [S1], 33.3% [S1], 44.4% [S1], 55.5% [S1].",
        [{"id": "S1", "title": "T", "excerpt": "Nothing here"}],
    )
    codes_v = {w["code"] for w in v["warningItems"]}
    assert codes_v == {"invalid_citations", "unverified_numbers"}
    assert len(v["warnings"]) == len(v["warningItems"])
    for item in v["warningItems"]:
        assert _format_vi_structured_warning(item, vi) == item["text"]

    # 2. Claim check warnings (claim_unsupported, claim_downgraded, claim_unchecked)
    from app.claim_check import summarize_claim_support

    cc = summarize_claim_support(
        [
            {"id": "C1", "handle": "Một", "label": "unsupported", "downgradedNoQuote": False},
            {"id": "C2", "handle": "Một", "label": "unclear", "downgradedNoQuote": True},
        ]
    )
    assert {w["code"] for w in cc["warningItems"]} == {"claim_unsupported", "claim_downgraded"}
    for item in cc["warningItems"]:
        assert _format_vi_structured_warning(item, vi) == item["text"]

    # 3. Judge run #1: score_unstable + ranking_changed + same_family + partial_scores + empty_summary + claim_check
    call_idx = {"judge": 0}

    def _handler_judge_mixed(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        prompt = str(payload["messages"][0]["content"])
        if "câu khẳng định" in prompt.lower():
            return _chat_response_json(
                {
                    "claims": [
                        {"id": "C1", "label": "unsupported", "evidence": ""},
                        {"id": "C2", "label": "supported", "evidence": "quote không có trong nguồn"},
                    ]
                }
            )
        call_idx["judge"] += 1
        if call_idx["judge"] == 1:
            return _chat_response_json(
                {
                    "executiveSummary": "",
                    "scores": [
                        {"label": "Ứng viên A", "evidence": 9, "logic": 9, "rebuttal": 9, "summary": ""},
                        {"label": "Ứng viên B", "evidence": 5, "logic": 5, "rebuttal": 5, "summary": "ok"},
                    ],
                }
            )
        if call_idx["judge"] == 2:
            # Đảo ngược hoàn toàn điểm giữa 2 lần -> score_unstable + ranking_changed
            return _chat_response_json(
                {
                    "executiveSummary": "",
                    "scores": [
                        {"label": "Ứng viên A", "evidence": 9, "logic": 9, "rebuttal": 9},
                        {"label": "Ứng viên B", "evidence": 5, "logic": 5, "rebuttal": 5},
                    ],
                }
            )
        # Lần 3: trả JSON hỏng -> parse_failed + partial_scores (2/3)
        return httpx.Response(200, json={"choices": [{"message": {"content": "BAD JSON"}}]})

    def _chat_response_json(obj: dict) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"X-Gateway-Lane": "acc9"},
            json={"choices": [{"message": {"content": json.dumps(obj, ensure_ascii=False)}}]},
        )

    bridge = BridgeClient("http://bridge.test", max_retries=0, transport=httpx.MockTransport(_handler_judge_mixed))
    client = TestClient(create_app(Settings(data_dir=tmp_path / "r1", dist_dir=tmp_path / "d1"), bridge_client=bridge))
    res = client.post(
        "/api/ai/synthesize",
        json={
            "roomTitle": "Phòng kiểm thử",
            "anonymize": True,
            "judgeRuns": 3,
            "perspectives": [
                {"id": "p1", "handle": "Một", "colorIndex": 0, "providerId": "bridge-local", "modelLabel": "gemini-neon"},
                {"id": "p2", "handle": "Hai", "colorIndex": 1, "providerId": "bridge-local", "modelLabel": "gemini-neon"},
            ],
            "messages": [
                {"senderType": "ai", "handle": "Một", "content": "Phát biểu A [S1].", "round": 0},
                {"senderType": "ai", "handle": "Hai", "content": "Phát biểu B [S1].", "round": 0},
            ],
            "sources": [{"id": "S1", "title": "S", "origin": "arXiv", "excerpt": "Clean text with no match.", "sourceType": "preprint"}],
        },
    )
    assert res.status_code == 200
    rep = res.json()["report"]
    items = rep["evaluationWarningItems"]
    codes = {w["code"] for w in items}
    assert {
        "partial_scores",
        "score_unstable",
        "ranking_changed",
        "same_family",
        "parse_failed",
        "claim_unsupported",
        "claim_downgraded",
    }.issubset(codes)
    assert rep["executiveSummaryCode"] == "empty_summary"
    assert vi["execSummaryEmpty"] == rep["executiveSummary"]
    assert vi["reportTitleTpl"].format(**rep["titleParams"]) == rep["title"]
    mp = rep["metaParams"]
    mode_vi = vi["judgeModeAnon"] if mp["anonymize"] else vi["judgeModePublic"]
    assert (
        vi["reportSubtitleTpl"].format(
            mode=mode_vi,
            runs=mp["runsCompleted"],
            sources=mp["sourceCount"],
            active=mp["activeCount"],
            total=mp["totalCount"],
        )
        == rep["subtitle"]
    )
    for item in items:
        assert _format_vi_structured_warning(item, vi) == item["text"]
    assert [w["text"] for w in items] == rep["evaluationWarnings"]

    # 4. Judge run #2: no_synthesis + fallback_scored + call_failed (1 lần gọi lỗi, 1 lần JSON hỏng)
    call_idx2 = {"n": 0}

    def _handler_call_and_parse_fail(request: httpx.Request) -> httpx.Response:
        call_idx2["n"] += 1
        if call_idx2["n"] == 1:
            return httpx.Response(500, json={"error": "timeout"})
        return httpx.Response(200, json={"choices": [{"message": {"content": "not json"}}]})

    bridge2 = BridgeClient(
        "http://bridge.test", max_retries=0, transport=httpx.MockTransport(_handler_call_and_parse_fail)
    )
    client2 = TestClient(create_app(Settings(data_dir=tmp_path / "r2", dist_dir=tmp_path / "d2"), bridge_client=bridge2))
    res2 = client2.post(
        "/api/ai/synthesize",
        json={
            "roomTitle": "Lỗi gọi model",
            "anonymize": False,
            "judgeRuns": 2,
            "claimCheck": False,
            "perspectives": [{"id": "p1", "handle": "Một", "colorIndex": 0}],
            "messages": [{"senderType": "ai", "handle": "Một", "content": "x", "round": 0}],
            "sources": [],
        },
    )
    assert res2.status_code == 200
    rep2 = res2.json()["report"]
    codes2 = {w["code"] for w in rep2["evaluationWarningItems"]}
    assert {"fallback_scored", "parse_failed", "call_failed"}.issubset(codes2)
    assert rep2["executiveSummaryCode"] == "no_synthesis"
    assert vi["execSummaryNoSynthesis"] == rep2["executiveSummary"]
    for item in rep2["evaluationWarningItems"]:
        assert _format_vi_structured_warning(item, vi) == item["text"]
    assert [w["text"] for w in rep2["evaluationWarningItems"]] == rep2["evaluationWarnings"]


