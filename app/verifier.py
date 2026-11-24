"""Tầng Kiểm chứng Độc lập (Deterministic Verifier — thuần Python, không gọi LLM).
- Phân tách rõ trích dẫn trực tiếp [S#] và trích dẫn suy luận [Suy luận từ S#].
- Phát hiện mã nguồn bịa (không nằm trong Kho nguồn hợp lệ).
- Đối chiếu con số định lượng (%, p-value, cỡ mẫu, số thập phân) trong câu gắn [S#] với văn bản nguồn thật.
"""

from __future__ import annotations

import re
from typing import Any

_DIRECT_CITATION_RE = re.compile(r"\[S(\d+)\]")
_INFERENCE_BLOCK_RE = re.compile(
    r"\[\s*(?:Suy\s+luận\s+từ|Inference\s+from)\s+([^\]]+)\]",
    re.IGNORECASE,
)
_SOURCE_TOKEN_RE = re.compile(r"\bS(\d+)\b")
_URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)
_CODE_SPAN_RE = re.compile(r"`[^`]+`")
_SECTION_REF_RE = re.compile(
    r"\b(?:Mục|Bảng|Hình|Phần|Chương|Vòng|Section|Table|Fig\.?|Figure|Step|Bước)\s+\d+(?:\.\d+)*",
    re.IGNORECASE,
)
_LIST_PREFIX_RE = re.compile(r"^\s*(?:[•\-*]|\d+\.)\s+")

# Các mẫu số liệu định lượng cần đối chiếu trực tiếp với văn bản nguồn
_PCT_CLAIM_RE = re.compile(r"(?<![\w.])(\d+(?:[.,]\d+)?)\s*%")
_DECIMAL_CLAIM_RE = re.compile(r"(?<![\w.])(\d+[.,]\d+)(?![\w.])")
_SAMPLE_CLAIM_RE = re.compile(
    r"(?:\b[nN]\s*=\s*(\d+(?:[.,]\d+)?)|(?<![\w.])(\d+(?:[.,]\d+)?)\s+(?:bệnh nhân|người tham gia|mẫu|ca bệnh|participants|patients|subjects|samples|trials|studies))",
    re.IGNORECASE,
)
_RAW_NUMBER_TOKEN_RE = re.compile(r"\d+(?:[.,]\d+)*")


def extract_citation_breakdown(text: str, valid_ids: set[str]) -> dict[str, list[str]]:
    """Tách danh sách mã trích dẫn trực tiếp [S#], suy luận [Suy luận từ S#] và mã bịa."""
    raw = text or ""
    direct_valid: list[str] = []
    inferred_valid: list[str] = []
    invalid: list[str] = []

    for m in _DIRECT_CITATION_RE.finditer(raw):
        sid = f"S{m.group(1)}"
        if sid in valid_ids:
            if sid not in direct_valid:
                direct_valid.append(sid)
        elif sid not in invalid:
            invalid.append(sid)

    for block in _INFERENCE_BLOCK_RE.finditer(raw):
        for sm in _SOURCE_TOKEN_RE.finditer(block.group(1)):
            sid = f"S{sm.group(1)}"
            if sid in valid_ids:
                if sid not in inferred_valid:
                    inferred_valid.append(sid)
            elif sid not in invalid:
                invalid.append(sid)

    return {
        "directSourceIds": direct_valid,
        "inferredSourceIds": inferred_valid,
        "invalidSourceIds": invalid,
    }


def extract_cited_sources(text: str, valid_ids: set[str]) -> list[str]:
    """Trả về tất cả mã [S#] hợp lệ được trích dẫn (cả trực tiếp lẫn suy luận), giữ thứ tự."""
    raw = text or ""
    seen: list[str] = []
    combined_pattern = re.compile(
        r"\[S(\d+)\]"
        r"|\[\s*(?:Suy\s+luận\s+từ|Inference\s+from)\s+([^\]]+)\]",
        re.IGNORECASE,
    )
    for m in combined_pattern.finditer(raw):
        if m.group(1):
            sid = f"S{m.group(1)}"
            if sid in valid_ids and sid not in seen:
                seen.append(sid)
        elif m.group(2):
            for sm in _SOURCE_TOKEN_RE.finditer(m.group(2)):
                sid = f"S{sm.group(1)}"
                if sid in valid_ids and sid not in seen:
                    seen.append(sid)
    return seen


def _parse_numeric_variants(token: str) -> set[float]:
    """Chuyển chuỗi số (hỗ trợ cả '.' và ',') thành tập các giá trị số học có thể."""
    cleaned = token.strip()
    out: set[float] = set()
    if not cleaned:
        return out
    if "." not in cleaned and "," not in cleaned:
        try:
            out.add(float(cleaned))
        except ValueError:
            pass
        return out

    # Chuẩn hóa dấu phân cách hàng nghìn nếu dạng 1,200 hoặc 1.200
    if re.fullmatch(r"\d{1,3}(?:,\d{3})+", cleaned):
        try:
            out.add(float(cleaned.replace(",", "")))
        except ValueError:
            pass
    if re.fullmatch(r"\d{1,3}(?:\.\d{3})+", cleaned):
        try:
            out.add(float(cleaned.replace(".", "")))
        except ValueError:
            pass

    for sep_fix in (cleaned.replace(",", "."), cleaned.replace(".", "").replace(",", "."), cleaned.replace(",", "")):
        try:
            out.add(float(sep_fix))
        except ValueError:
            continue
    return out


def _extract_source_numbers(source_text: str) -> set[float]:
    nums: set[float] = set()
    for m in _RAW_NUMBER_TOKEN_RE.finditer(source_text or ""):
        nums.update(_parse_numeric_variants(m.group(0)))
    return nums


def _split_sentences(text: str) -> list[str]:
    sentences: list[str] = []
    for raw_line in (text or "").splitlines():
        line = _LIST_PREFIX_RE.sub("", raw_line).strip()
        if not line:
            continue
        # Bỏ dòng ngăn cách bảng Markdown (| --- | --- |)
        if re.fullmatch(r"[\|\s:\-]+", line):
            continue
        parts = re.split(r"(?<=[!?])\s+|(?<!\d)(?<=\.)\s+", line)
        for part in parts:
            s = part.strip()
            if s:
                sentences.append(s)
    return sentences


def _extract_sentence_numeric_claims(sentence: str) -> list[tuple[str, bool, set[float]]]:
    """Trả về danh sách (nhãn hiển thị, is_percent, tập giá trị số) cho các con số cần kiểm chứng."""
    sanitized = _URL_RE.sub(" ", sentence)
    sanitized = _INFERENCE_BLOCK_RE.sub(" ", sanitized)
    sanitized = _DIRECT_CITATION_RE.sub(" ", sanitized)
    sanitized = _CODE_SPAN_RE.sub(" ", sanitized)
    sanitized = _SECTION_REF_RE.sub(" ", sanitized)

    claims: list[tuple[str, bool, set[float]]] = []
    seen_spans: list[tuple[int, int]] = []

    def _overlaps(start: int, end: int) -> bool:
        return any(not (end <= s or start >= e) for s, e in seen_spans)

    for m in _PCT_CLAIM_RE.finditer(sanitized):
        seen_spans.append(m.span())
        vals = _parse_numeric_variants(m.group(1))
        if vals:
            claims.append((f"{m.group(1)}%", True, vals))

    for m in _DECIMAL_CLAIM_RE.finditer(sanitized):
        if _overlaps(*m.span()):
            continue
        vals = _parse_numeric_variants(m.group(1))
        # Bỏ qua các số mục như 1.1 hoặc năm viết nhầm
        if vals:
            seen_spans.append(m.span())
            claims.append((m.group(1), False, vals))

    for m in _SAMPLE_CLAIM_RE.finditer(sanitized):
        if _overlaps(*m.span()):
            continue
        num_str = m.group(1) or m.group(2) or ""
        vals = _parse_numeric_variants(num_str)
        if vals and any(v >= 10 for v in vals):
            seen_spans.append(m.span())
            claims.append((num_str, False, vals))

    return claims


def _claim_matches_source_numbers(
    claim_vals: set[float], is_percent: bool, source_nums: set[float]
) -> bool:
    for v in claim_vals:
        for s in source_nums:
            if abs(v - s) <= 1e-4:
                return True
            if is_percent and v > 0 and abs((v / 100.0) - s) <= 1e-4:
                return True
    return False


def verify_perspective_turn(text: str, sources: list[dict[str, Any]]) -> dict[str, Any]:
    """Kiểm chứng tính toàn vẹn trích dẫn và số liệu của một phản hồi AI so với Kho nguồn."""
    source_by_id: dict[str, dict[str, Any]] = {
        str(s.get("id")): s for s in (sources or []) if isinstance(s, dict) and s.get("id")
    }
    valid_ids = set(source_by_id.keys())
    breakdown = extract_citation_breakdown(text, valid_ids)

    source_text_by_id: dict[str, str] = {}
    source_nums_by_id: dict[str, set[float]] = {}
    abstract_only_cited: list[str] = []

    for sid, src in source_by_id.items():
        combined_src = " ".join(
            [
                str(src.get("origin") or ""),
                str(src.get("title") or ""),
                str(src.get("excerpt") or ""),
            ]
        )
        source_text_by_id[sid] = combined_src
        source_nums_by_id[sid] = _extract_source_numbers(combined_src)

    for sid in breakdown["directSourceIds"]:
        src = source_by_id.get(sid) or {}
        if str(src.get("contentLevel") or "") == "abstract_only" and sid not in abstract_only_cited:
            abstract_only_cited.append(sid)

    numeric_checked = 0
    numeric_matched = 0
    unverified_numbers: list[dict[str, Any]] = []

    for sentence in _split_sentences(text):
        direct_in_sentence = [
            f"S{m.group(1)}"
            for m in _DIRECT_CITATION_RE.finditer(sentence)
            if f"S{m.group(1)}" in valid_ids
        ]
        if not direct_in_sentence:
            continue

        # Loại trùng nhưng giữ thứ tự
        cited_here = list(dict.fromkeys(direct_in_sentence))
        combined_nums: set[float] = set()
        for sid in cited_here:
            combined_nums.update(source_nums_by_id.get(sid, set()))

        claims = _extract_sentence_numeric_claims(sentence)
        for label, is_pct, vals in claims:
            numeric_checked += 1
            if _claim_matches_source_numbers(vals, is_pct, combined_nums):
                numeric_matched += 1
            else:
                unverified_numbers.append(
                    {
                        "number": label,
                        "cited": cited_here,
                        "sentence": sentence[:180],
                    }
                )

    warnings: list[str] = []
    if breakdown["invalidSourceIds"]:
        warnings.append(
            f"Phát hiện mã trích dẫn không có trong Kho nguồn: {', '.join(f'[{x}]' for x in breakdown['invalidSourceIds'])}."
        )
    if unverified_numbers:
        preview = ", ".join(
            f"{u['number']} ({'+'.join(u['cited'])})" for u in unverified_numbers[:4]
        )
        extra = f" và {len(unverified_numbers) - 4} số khác" if len(unverified_numbers) > 4 else ""
        warnings.append(
            f"Có {len(unverified_numbers)} số liệu gắn trích dẫn trực tiếp nhưng chưa tìm thấy trong văn bản nguồn: {preview}{extra}."
        )

    return {
        "validCitations": breakdown["directSourceIds"],
        "inferredCitations": breakdown["inferredSourceIds"],
        "invalidCitations": breakdown["invalidSourceIds"],
        "numericClaimsChecked": numeric_checked,
        "numericClaimsMatched": numeric_matched,
        "unverifiedNumbers": unverified_numbers[:10],
        "abstractOnlyCited": abstract_only_cited,
        "warnings": warnings,
    }


def format_verification_for_judge(
    messages: list[dict[str, Any]],
    sources: list[dict[str, Any]],
    alias_map: dict[str, str],
    anonymize: bool,
) -> tuple[str, dict[str, Any]]:
    """Tổng hợp biên bản kiểm chứng khách quan cho từng ứng viên gửi Trọng tài."""
    per_handle_stats: dict[str, dict[str, Any]] = {}
    summary = {
        "totalValidCitations": 0,
        "totalInferredCitations": 0,
        "totalInvalidCitations": 0,
        "totalNumericChecked": 0,
        "totalNumericMatched": 0,
        "warnings": [],
    }

    for msg in messages:
        if not isinstance(msg, dict):
            continue
        sender_type = str(msg.get("senderType") or ("ai" if msg.get("handle") else "user")).strip()
        if sender_type != "ai" or not msg.get("handle"):
            continue
        handle = str(msg["handle"])
        content = str(msg.get("content") or "").strip()
        if not content:
            continue

        ver = verify_perspective_turn(content, sources)
        bucket = per_handle_stats.setdefault(
            handle,
            {
                "valid": set(),
                "inferred": set(),
                "invalid": set(),
                "num_checked": 0,
                "num_matched": 0,
                "unverified": [],
                "abstract_only": set(),
            },
        )
        bucket["valid"].update(ver["validCitations"])
        bucket["inferred"].update(ver["inferredCitations"])
        bucket["invalid"].update(ver["invalidCitations"])
        bucket["num_checked"] += ver["numericClaimsChecked"]
        bucket["num_matched"] += ver["numericClaimsMatched"]
        bucket["unverified"].extend(ver["unverifiedNumbers"])
        bucket["abstract_only"].update(ver["abstractOnlyCited"])

        summary["totalValidCitations"] += len(ver["validCitations"])
        summary["totalInferredCitations"] += len(ver["inferredCitations"])
        summary["totalInvalidCitations"] += len(ver["invalidCitations"])
        summary["totalNumericChecked"] += ver["numericClaimsChecked"]
        summary["totalNumericMatched"] += ver["numericClaimsMatched"]

    if not per_handle_stats:
        return "", summary

    lines: list[str] = []
    for handle, st in per_handle_stats.items():
        speaker = alias_map.get(handle, handle) if anonymize else f"@{handle}"
        valid_str = ", ".join(sorted(st["valid"])) or "không có"
        inf_str = ", ".join(sorted(st["inferred"])) or "không có"
        inv_str = ", ".join(sorted(st["invalid"])) or "0"
        line = (
            f"- {speaker}: trích dẫn trực tiếp hợp lệ=[{valid_str}]; "
            f"suy luận rõ ràng=[{inf_str}]; mã nguồn không tồn tại=[{inv_str}]; "
            f"số liệu khớp nguồn={st['num_matched']}/{st['num_checked']}"
        )
        if st["unverified"]:
            bad = ", ".join(f"{u['number']}@{','.join(u['cited'])}" for u in st["unverified"][:4])
            line += f"; CẢNH BÁO số liệu chưa khớp nguồn: [{bad}]"
            summary["warnings"].append(
                f"@{handle}: {len(st['unverified'])} số liệu gắn [S#] chưa đối chiếu thấy trong văn bản nguồn ({bad})."
            )
        if st["invalid"]:
            summary["warnings"].append(
                f"@{handle}: dùng mã nguồn không tồn tại ({', '.join(sorted(st['invalid']))})."
            )
        if st["abstract_only"]:
            line += f"; lưu ý đã trích từ nguồn chỉ mới có tóm tắt ({', '.join(sorted(st['abstract_only']))})"
        lines.append(line)

    return "\n".join(lines), summary
