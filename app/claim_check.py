"""Kiểm chứng mức câu khẳng định: đoạn nguồn được trích có THẬT SỰ ủng hộ câu đó không (kiểu ALCE).

Khác app.verifier (chỉ đối chiếu con số), bước này hỏi 1 LLM duy nhất cho tối đa N câu có [S#], rồi
áp chốt chặn TẤT ĐỊNH: nhãn "supported"/"partial" chỉ được giữ nếu câu bằng chứng LLM trích ra
xuất hiện nguyên văn trong văn bản nguồn được trích; ngược lại hạ xuống "unclear".

- Prompt KHÔNG chứa @handle hay nhãn ứng viên -> không thiên vị theo danh tính.
- Kết quả là một tín hiệu ĐỘC LẬP với điểm Trọng tài (không đưa ngược vào prompt Trọng tài).
- Lỗi gọi model chỉ tạo cảnh báo, không làm hỏng báo cáo.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from app.bridge import BridgeCallError, BridgeClient, parse_resilient_json
from app.providers import ProviderStore

LABELS = ("supported", "partial", "unsupported", "unclear")
MAX_SOURCE_CHARS_FOR_CLAIMS = 4000
_MIN_QUOTE_WORDS = 3
_MIN_QUOTE_CJK_CHARS = 8
_CJK_CHAR_RE = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]")

_LABEL_ALIASES = {
    "supported": "supported",
    "support": "supported",
    "ủng hộ": "supported",
    "partial": "partial",
    "partially_supported": "partial",
    "partially supported": "partial",
    "một phần": "partial",
    "unsupported": "unsupported",
    "not_supported": "unsupported",
    "not supported": "unsupported",
    "contradicted": "unsupported",
    "không ủng hộ": "unsupported",
    "unclear": "unclear",
    "cannot_tell": "unclear",
    "not_enough_info": "unclear",
    "không rõ": "unclear",
}


def _has_cjk(text: str) -> bool:
    return bool(_CJK_CHAR_RE.search(text or ""))


def _quote_chunk_long_enough(chunk: str) -> bool:
    if _has_cjk(chunk):
        cjk_and_num = sum(
            1 for ch in chunk if not ch.isspace() and unicodedata.category(ch)[0] in ("L", "N")
        )
        return cjk_and_num >= _MIN_QUOTE_CJK_CHARS
    return len(chunk.split()) >= _MIN_QUOTE_WORDS


def _norm_text(text: str) -> str:
    t = unicodedata.normalize("NFC", str(text or "")).lower()
    t = t.replace("％", "%")
    t = re.sub(r"[“”„\"'‘’`´]", "", t)
    t = re.sub(r"[‐‑‒–—―]", "-", t)
    t = re.sub(r"\s+", " ", t)
    return t.strip()


def quote_found_in_sources(quote: str, source_texts: list[str]) -> bool:
    """Câu bằng chứng (có thể bị LLM lược bằng '…') có nằm nguyên văn trong nguồn không."""
    q = str(quote or "").strip()
    if not q:
        return False
    haystack = " ".join(_norm_text(s) for s in source_texts)
    chunks = [c.strip(" .,;:，；、。") for c in re.split(r"\s*(?:…|\.\.\.|\[\.\.\.\])\s*", q)]
    chunks = [c for c in chunks if _quote_chunk_long_enough(c)]
    if not chunks:
        return False
    return all(_norm_text(c) in haystack for c in chunks)


def build_claim_check_prompt(claims: list[dict[str, Any]], sources: list[dict[str, Any]]) -> str:
    cited_ids: list[str] = []
    for c in claims:
        for sid in c.get("sourceIds") or []:
            if sid not in cited_ids:
                cited_ids.append(sid)
    by_id = {str(s.get("id")): s for s in sources if isinstance(s, dict) and s.get("id")}
    source_lines: list[str] = []
    for sid in cited_ids:
        s = by_id.get(sid) or {}
        excerpt = str(s.get("excerpt") or "").strip()
        if len(excerpt) > MAX_SOURCE_CHARS_FOR_CLAIMS:
            excerpt = excerpt[: MAX_SOURCE_CHARS_FOR_CLAIMS - 1].rstrip() + "…"
        source_lines.append(f'[{sid}] ({s.get("origin") or "N/A"}) {s.get("title") or ""}:\n"""{excerpt}"""')
    claim_lines = [
        f"{c['id']} (trích: {', '.join(c.get('sourceIds') or [])}): {c['sentence']}" for c in claims
    ]
    return (
        "Bạn là người kiểm chứng trích dẫn. Với MỖI câu khẳng định dưới đây, chỉ dựa vào văn bản của CHÍNH "
        "các nguồn mà câu đó trích, hãy gán đúng 1 nhãn:\n"
        "- supported: nội dung chính của câu (kể cả con số) có trong nguồn.\n"
        "- partial: nguồn chỉ ủng hộ một phần, hoặc câu nói mạnh/rộng hơn nguồn.\n"
        "- unsupported: nguồn không nhắc tới hoặc nói khác câu.\n"
        "- unclear: đoạn nguồn quá ngắn/chỉ là tóm tắt nên không quyết định được.\n"
        "Câu có thể viết bằng tiếng Việt còn nguồn bằng tiếng Anh: hãy so nghĩa, không so chữ.\n"
        "Với supported/partial, trường evidence PHẢI chép NGUYÊN VĂN (giữ ngôn ngữ gốc của nguồn) một đoạn "
        "5–30 từ từ nguồn làm căn cứ; với unsupported/unclear để evidence rỗng.\n"
        'Chỉ trả về đúng 1 JSON: {"claims": [{"id": "C1", "label": "supported", "evidence": "..."}]}\n\n'
        "NGUỒN:\n" + "\n\n".join(source_lines) + "\n\nCÂU KHẲNG ĐỊNH:\n" + "\n".join(claim_lines)
    )


def _normalize_label(raw: Any) -> str | None:
    key = str(raw or "").strip().lower().replace("-", "_")
    return _LABEL_ALIASES.get(key) or _LABEL_ALIASES.get(key.replace("_", " "))


def parse_claim_check(
    text: str, claims: list[dict[str, Any]], sources: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    parsed = parse_resilient_json(text)
    rows: dict[str, dict[str, Any]] = {}
    for row in parsed.get("claims") or []:
        if isinstance(row, dict) and row.get("id"):
            rows[str(row["id"]).strip().upper()] = row
    by_id = {str(s.get("id")): s for s in sources if isinstance(s, dict) and s.get("id")}
    results: list[dict[str, Any]] = []
    for c in claims:
        row = rows.get(str(c["id"]).upper())
        label = _normalize_label(row.get("label")) if row else None
        evidence = str((row or {}).get("evidence") or "").strip()[:400]
        quote_ok: bool | None = None
        downgraded = False
        if label in ("supported", "partial"):
            texts = [
                " ".join([str(by_id.get(sid, {}).get("title") or ""), str(by_id.get(sid, {}).get("excerpt") or "")])
                for sid in c.get("sourceIds") or []
            ]
            quote_ok = quote_found_in_sources(evidence, texts)
            if not quote_ok:
                label = "unclear"
                downgraded = True
        results.append(
            {
                "id": c["id"],
                "handle": c["handle"],
                "round": c.get("round", 0),
                "sentence": c["sentence"],
                "sourceIds": list(c.get("sourceIds") or []),
                "label": label or "unchecked",
                "evidence": evidence if label in ("supported", "partial") else "",
                "evidenceQuoteFound": quote_ok,
                "downgradedNoQuote": downgraded,
            }
        )
    return results


def summarize_claim_support(results: list[dict[str, Any]]) -> dict[str, Any]:
    def _blank() -> dict[str, int]:
        return {"checked": 0, "supported": 0, "partial": 0, "unsupported": 0, "unclear": 0, "unchecked": 0}

    totals = _blank()
    by_handle: dict[str, dict[str, int]] = {}
    for r in results:
        bucket = by_handle.setdefault(r["handle"], _blank())
        lbl = r["label"] if r["label"] in totals else "unchecked"
        for b in (totals, bucket):
            b[lbl] += 1
            if lbl != "unchecked":
                b["checked"] += 1
    warnings: list[str] = []
    warning_items: list[dict[str, Any]] = []
    for handle, b in by_handle.items():
        if b["unsupported"]:
            w_text = f"@{handle}: {b['unsupported']}/{b['checked']} câu có [S#] bị đánh giá là nguồn KHÔNG ủng hộ."
            warnings.append(w_text)
            warning_items.append(
                {
                    "code": "claim_unsupported",
                    "params": {
                        "handle": handle,
                        "unsupported": b["unsupported"],
                        "checked": b["checked"],
                    },
                    "text": w_text,
                }
            )
    downgraded = sum(1 for r in results if r.get("downgradedNoQuote"))
    if downgraded:
        d_text = f"{downgraded} nhãn 'được ủng hộ' bị hạ xuống 'không rõ' vì câu bằng chứng không có nguyên văn trong nguồn."
        warnings.append(d_text)
        warning_items.append(
            {
                "code": "claim_downgraded",
                "params": {"count": downgraded},
                "text": d_text,
            }
        )
    return {"totals": totals, "byHandle": by_handle, "warnings": warnings, "warningItems": warning_items}


async def run_claim_check(
    *,
    claims: list[dict[str, Any]],
    sources: list[dict[str, Any]],
    prov_store: ProviderStore,
    bridge: BridgeClient,
    provider_id: str | None,
    model: str | None,
    pinned_lane_id: str | None,
    exclude_lanes: set[str] | None,
) -> dict[str, Any]:
    """Chạy 1 lượt kiểm chứng; luôn trả dict (có 'error' nếu thất bại) để không làm hỏng báo cáo."""
    if not claims:
        return {"results": [], "summary": summarize_claim_support([]), "error": None}
    prompt = build_claim_check_prompt(claims, sources)
    try:
        res = await prov_store.complete(
            default_bridge=bridge,
            provider_id=provider_id,
            system_instruction="Bạn là người kiểm chứng trích dẫn khoa học. Chỉ trả về duy nhất 1 JSON object hợp lệ.",
            user_prompt=prompt,
            model=model,
            pinned_lane_id=pinned_lane_id,
            exclude_lanes=None if pinned_lane_id else exclude_lanes,
        )
    except BridgeCallError as exc:
        unchecked = [
            {**c, "label": "unchecked", "evidence": "", "evidenceQuoteFound": None, "downgradedNoQuote": False}
            for c in claims
        ]
        summary = summarize_claim_support(unchecked)
        err_text = f"Không chạy được bước kiểm chứng mức câu: {exc}"
        summary["warnings"].append(err_text)
        summary["warningItems"].append(
            {"code": "claim_check_failed", "params": {"error": str(exc)}, "text": err_text}
        )
        return {"results": unchecked, "summary": summary, "error": str(exc)}
    results = parse_claim_check(res.text, claims, sources)
    summary = summarize_claim_support(results)
    unchecked_n = summary["totals"]["unchecked"]
    if unchecked_n:
        unc_text = f"{unchecked_n}/{len(results)} câu không nhận được nhãn hợp lệ từ model kiểm chứng."
        summary["warnings"].append(unc_text)
        summary["warningItems"].append(
            {
                "code": "claim_unchecked",
                "params": {"unchecked": unchecked_n, "total": len(results)},
                "text": unc_text,
            }
        )
    summary.update({"modelUsed": res.model_used, "laneId": res.lane_id, "providerId": res.provider_id})
    return {"results": results, "summary": summary, "error": None}
