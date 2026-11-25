"""Tầng Kiểm chứng Độc lập (Deterministic Verifier — thuần Python, không gọi LLM).
- Phân tách rõ trích dẫn trực tiếp [S#] và trích dẫn suy luận [Suy luận từ S#].
- Nhận cả dạng trích nhiều nguồn: [S1, S2], [S1; S3], [S1-S3], [S1–S3] (trước đây bị bỏ qua hoàn toàn).
- Phát hiện mã nguồn bịa (không nằm trong Kho nguồn hợp lệ).
- Đối chiếu con số định lượng (%, p-value, cỡ mẫu, số thập phân) trong câu gắn [S#] với văn bản nguồn thật,
  có dung sai làm tròn theo số chữ số thập phân AI viết; số % nguyên chỉ khớp với số % trong nguồn
  (không còn khớp nhầm "5%" với "Table 5").
- Thu thập các câu khẳng định có trích dẫn (collect_cited_claims) để app.claim_check kiểm mức "nguồn có ủng hộ câu không".
"""

from __future__ import annotations

import re
from typing import Any

# [S1] | [S1, S2] | [S1; S2] | [S1，S2] | [S1 và S2] | [S1-S3] | [S1–S3] | [S1,3] | [S1、S2]
_DIRECT_CITATION_RE = re.compile(
    r"\[\s*(S\d+(?:\s*(?:,|;|，|；|&|、|và|and|和|と|및|[-–—])\s*S?\d+)*)\s*\]",
    re.IGNORECASE,
)
_CITATION_TOKEN_RE = re.compile(r"S?(\d+)|([-–—])", re.IGNORECASE)
_MAX_CITATION_RANGE = 20
_INFERENCE_BLOCK_RE = re.compile(
    r"\[\s*(?:Suy\s+luận\s+từ|Inferred\s+from|Inference\s+from|推论自|推論[:：]?|추론[:：]?)\s*([^\]]+)\]",
    re.IGNORECASE,
)
_SOURCE_TOKEN_RE = re.compile(r"\bS(\d+)\b", re.IGNORECASE)
_URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)
_CODE_SPAN_RE = re.compile(r"`[^`]+`")
_SECTION_REF_RE = re.compile(
    r"\b(?:Mục|Bảng|Hình|Phần|Chương|Vòng|Section|Table|Fig\.?|Figure|Step|Bước)\s+\d+(?:\.\d+)*",
    re.IGNORECASE,
)
_LIST_PREFIX_RE = re.compile(r"^\s*(?:[•\-*]|\d+\.)\s+")

# Chỉ chặn số đứng sát chữ Latin (kể cả tiếng Việt) / '_' / '.'; cho phép số đứng sát chữ CJK.
# (?<!\d,) chặn lỗi đọc 'đạt81,4%' thành '4%'.
_LATIN_WORD = r"0-9A-Za-z_À-ɏḀ-ỿ"
_NUM_LEFT = rf"(?<![{_LATIN_WORD}.])(?<!\d,)"
_NUM_RIGHT = rf"(?![{_LATIN_WORD}.])"

# Các mẫu số liệu định lượng cần đối chiếu trực tiếp với văn bản nguồn
_PCT_CLAIM_RE = re.compile(
    rf"(?:{_NUM_LEFT}(\d+(?:[.,]\d+)?)\s*(?:[%％]|パーセント|퍼센트)|百分之\s*(\d+(?:[.,]\d+)?){_NUM_RIGHT})"
)
_DECIMAL_CLAIM_RE = re.compile(rf"{_NUM_LEFT}(\d+[.,]\d+){_NUM_RIGHT}")
_SAMPLE_CLAIM_RE = re.compile(
    rf"(?:\b[nN]\s*=\s*(\d+(?:[.,]\d+)?){_NUM_RIGHT}|{_NUM_LEFT}(\d+(?:[.,]\d+)?)\s+(?:bệnh nhân|người tham gia|mẫu|ca bệnh|participants|patients|subjects|samples|trials|studies))",
    re.IGNORECASE,
)
_RAW_NUMBER_TOKEN_RE = re.compile(r"\d+(?:[.,]\d+)*")
_PCT_PREFIX_RE = re.compile(r"百分之\s*$")
_PCT_SUFFIX_RE = re.compile(
    r"\s*(?:[%％]|percent\b|per cent\b|phần trăm|パーセント|퍼센트|百分比|百分之)",
    re.IGNORECASE,
)

MAX_CLAIMS_TO_CHECK = 30
_MAX_CLAIM_CHARS = 320


# ---------------------------------------------------------------------------
# 1. Trích dẫn
# ---------------------------------------------------------------------------
def expand_citation_group(group: str) -> list[str]:
    """'S1, S3' -> ['S1','S3'];  'S1-S3' -> ['S1','S2','S3'];  'S2,4' -> ['S2','S4']."""
    numbers: list[int] = []
    prev: int | None = None
    pending_range = False
    for m in _CITATION_TOKEN_RE.finditer(group or ""):
        if m.group(2):
            pending_range = prev is not None
            continue
        n = int(m.group(1))
        if pending_range and prev is not None and prev < n <= prev + _MAX_CITATION_RANGE:
            numbers.extend(range(prev + 1, n + 1))
        else:
            numbers.append(n)
        prev = n
        pending_range = False
    return [f"S{n}" for n in dict.fromkeys(numbers)]


def iter_direct_citation_ids(text: str) -> list[str]:
    """Mọi mã nguồn trích trực tiếp theo thứ tự xuất hiện (có thể lặp)."""
    out: list[str] = []
    for m in _DIRECT_CITATION_RE.finditer(text or ""):
        out.extend(expand_citation_group(m.group(1)))
    return out


def extract_citation_breakdown(text: str, valid_ids: set[str]) -> dict[str, list[str]]:
    """Tách danh sách mã trích dẫn trực tiếp [S#], suy luận [Suy luận từ S#] và mã bịa."""
    raw = text or ""
    direct_valid: list[str] = []
    inferred_valid: list[str] = []
    invalid: list[str] = []

    for sid in iter_direct_citation_ids(raw):
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
    """Trả về tất cả mã [S#] hợp lệ được trích dẫn (cả trực tiếp lẫn suy luận), giữ thứ tự xuất hiện."""
    raw = text or ""
    hits: list[tuple[int, str]] = []
    for m in _DIRECT_CITATION_RE.finditer(raw):
        for sid in expand_citation_group(m.group(1)):
            hits.append((m.start(), sid))
    for m in _INFERENCE_BLOCK_RE.finditer(raw):
        for sm in _SOURCE_TOKEN_RE.finditer(m.group(1)):
            hits.append((m.start(), f"S{sm.group(1)}"))
    seen: list[str] = []
    for _pos, sid in sorted(hits, key=lambda h: h[0]):
        if sid in valid_ids and sid not in seen:
            seen.append(sid)
    return seen


# ---------------------------------------------------------------------------
# 2. Số liệu
# ---------------------------------------------------------------------------
def _numeric_variants(token: str) -> set[tuple[float, int]]:
    """Các cách đọc có thể của 1 chuỗi số -> {(giá_trị, số_chữ_số_thập_phân)} (hỗ trợ cả '.' và ',')."""
    cleaned = (token or "").strip()
    out: set[tuple[float, int]] = set()
    if not cleaned:
        return out
    if "." not in cleaned and "," not in cleaned:
        try:
            out.add((float(cleaned), 0))
        except ValueError:
            pass
        return out
    # Dấu phân cách hàng nghìn: 1,200 hoặc 1.200
    for sep in (",", "."):
        if re.fullmatch(rf"\d{{1,3}}(?:\{sep}\d{{3}})+", cleaned):
            try:
                out.add((float(cleaned.replace(sep, "")), 0))
            except ValueError:
                pass
    # Dấu cuối cùng là dấu thập phân, các dấu trước là hàng nghìn
    m = re.fullmatch(r"(\d+(?:[.,]\d+)*)[.,](\d+)", cleaned)
    if m:
        int_part = re.sub(r"[.,]", "", m.group(1))
        try:
            out.add((float(f"{int_part}.{m.group(2)}"), len(m.group(2))))
        except ValueError:
            pass
    return out


def _parse_numeric_variants(token: str) -> set[float]:
    """Giữ tương thích: chỉ trả về tập giá trị."""
    return {v for v, _d in _numeric_variants(token)}


def _extract_source_numbers(source_text: str) -> tuple[set[float], set[float]]:
    """(mọi số trong nguồn, các số đứng ngay trước dấu % / 'percent' / 'phần trăm')."""
    text = source_text or ""
    all_vals: set[float] = set()
    pct_vals: set[float] = set()
    for m in _RAW_NUMBER_TOKEN_RE.finditer(text):
        vals = _parse_numeric_variants(m.group(0))
        all_vals.update(vals)
        if _PCT_SUFFIX_RE.match(text, m.end()) or _PCT_PREFIX_RE.search(text[: m.start()]):
            pct_vals.update(vals)
    return all_vals, pct_vals


def _within_rounding(claim_value: float, claim_decimals: int, source_value: float) -> bool:
    """Số AI viết có phải là bản làm tròn của số trong nguồn không (vd 31.6 <- 31.64)."""
    tolerance = 0.5 * (10 ** -max(0, claim_decimals)) + 1e-9
    return abs(claim_value - source_value) <= tolerance


def _claim_matches_source_numbers(
    claim_variants: set[tuple[float, int]],
    is_percent: bool,
    source_nums: tuple[set[float], set[float]],
) -> bool:
    all_vals, pct_vals = source_nums
    for v, d in claim_variants:
        if is_percent:
            if any(_within_rounding(v, d, s) for s in pct_vals):
                return True
            # Nguồn ghi dạng tỉ lệ 0.052 cho 5.2%
            if any(0 < s < 1 and _within_rounding(v, d, s * 100) for s in all_vals):
                return True
            # Bảng ghi "Accuracy (%) 71.3": chỉ chấp nhận số CÓ phần thập phân để tránh khớp nhầm "Table 5"
            if d > 0 and any(_within_rounding(v, d, s) for s in all_vals):
                return True
            continue
        if any(_within_rounding(v, d, s) for s in all_vals):
            return True
    return False


def _split_sentences(text: str, *, split_table_cells: bool = True) -> list[str]:
    sentences: list[str] = []
    for raw_line in (text or "").splitlines():
        line = _LIST_PREFIX_RE.sub("", raw_line).strip()
        if not line:
            continue
        # Bỏ dòng ngăn cách bảng Markdown (| --- | --- |)
        if re.fullmatch(r"[\|\s:\-]+", line):
            continue
        # Mỗi ô bảng là 1 đơn vị riêng: tránh gán số của ô [Suy luận từ S1] sang ô [S1] cùng dòng
        segments = (
            [c.strip() for c in line.strip("|").split("|")]
            if split_table_cells and line.count("|") >= 2
            else [line]
        )
        for seg in segments:
            if not seg:
                continue
            for part in re.split(r"(?<=[!?])\s+|(?<!\d)(?<=\.)\s+|(?<=[。！？])\s*", seg):
                s = part.strip()
                if s:
                    sentences.append(s)
    return sentences


def _extract_sentence_numeric_claims(sentence: str) -> list[tuple[str, bool, set[tuple[float, int]]]]:
    """Trả về danh sách (nhãn hiển thị, is_percent, các cách đọc số) cho các con số cần kiểm chứng."""
    sanitized = _URL_RE.sub(" ", sentence)
    sanitized = _INFERENCE_BLOCK_RE.sub(" ", sanitized)
    sanitized = _DIRECT_CITATION_RE.sub(" ", sanitized)
    sanitized = _CODE_SPAN_RE.sub(" ", sanitized)
    sanitized = _SECTION_REF_RE.sub(" ", sanitized)

    claims: list[tuple[str, bool, set[tuple[float, int]]]] = []
    seen_spans: list[tuple[int, int]] = []

    def _overlaps(start: int, end: int) -> bool:
        return any(not (end <= s or start >= e) for s, e in seen_spans)

    for m in _PCT_CLAIM_RE.finditer(sanitized):
        seen_spans.append(m.span())
        num_str = m.group(1) or m.group(2) or ""
        vals = _numeric_variants(num_str)
        if vals:
            claims.append((f"{num_str}%", True, vals))

    for m in _DECIMAL_CLAIM_RE.finditer(sanitized):
        if _overlaps(*m.span()):
            continue
        vals = _numeric_variants(m.group(1))
        if vals:
            seen_spans.append(m.span())
            claims.append((m.group(1), False, vals))

    for m in _SAMPLE_CLAIM_RE.finditer(sanitized):
        if _overlaps(*m.span()):
            continue
        num_str = m.group(1) or m.group(2) or ""
        vals = _numeric_variants(num_str)
        if vals and any(v >= 10 for v, _d in vals):
            seen_spans.append(m.span())
            claims.append((num_str, False, vals))

    return claims


def _source_text(src: dict[str, Any]) -> str:
    return " ".join(
        [str(src.get("origin") or ""), str(src.get("title") or ""), str(src.get("excerpt") or "")]
    )


# ---------------------------------------------------------------------------
# 3. Kiểm chứng 1 lượt
# ---------------------------------------------------------------------------
def verify_perspective_turn(text: str, sources: list[dict[str, Any]]) -> dict[str, Any]:
    """Kiểm chứng tính toàn vẹn trích dẫn và số liệu của một phản hồi AI so với Kho nguồn."""
    source_by_id: dict[str, dict[str, Any]] = {
        str(s.get("id")): s for s in (sources or []) if isinstance(s, dict) and s.get("id")
    }
    valid_ids = set(source_by_id.keys())
    breakdown = extract_citation_breakdown(text, valid_ids)

    source_nums_by_id = {sid: _extract_source_numbers(_source_text(src)) for sid, src in source_by_id.items()}
    abstract_only_cited: list[str] = []
    for sid in breakdown["directSourceIds"]:
        src = source_by_id.get(sid) or {}
        if str(src.get("contentLevel") or "") == "abstract_only" and sid not in abstract_only_cited:
            abstract_only_cited.append(sid)

    numeric_checked = 0
    numeric_matched = 0
    unverified_numbers: list[dict[str, Any]] = []

    for sentence in _split_sentences(text):
        cited_here = list(
            dict.fromkeys(sid for sid in iter_direct_citation_ids(sentence) if sid in valid_ids)
        )
        if not cited_here:
            continue
        all_vals: set[float] = set()
        pct_vals: set[float] = set()
        for sid in cited_here:
            a, p = source_nums_by_id.get(sid, (set(), set()))
            all_vals |= a
            pct_vals |= p

        for label, is_pct, vals in _extract_sentence_numeric_claims(sentence):
            numeric_checked += 1
            if _claim_matches_source_numbers(vals, is_pct, (all_vals, pct_vals)):
                numeric_matched += 1
            else:
                unverified_numbers.append(
                    {"number": label, "cited": cited_here, "sentence": sentence[:180]}
                )

    warnings: list[str] = []
    warning_items: list[dict[str, Any]] = []
    if breakdown["invalidSourceIds"]:
        ids_text = ", ".join(f"[{x}]" for x in breakdown["invalidSourceIds"])
        text_inv = f"Phát hiện mã trích dẫn không có trong Kho nguồn: {ids_text}."
        warnings.append(text_inv)
        warning_items.append(
            {
                "code": "invalid_citations",
                "params": {"ids": breakdown["invalidSourceIds"], "idsText": ids_text},
                "text": text_inv,
            }
        )
    if unverified_numbers:
        preview = ", ".join(
            f"{u['number']} ({'+'.join(u['cited'])})" for u in unverified_numbers[:4]
        )
        extra_n = max(0, len(unverified_numbers) - 4)
        extra = f" và {extra_n} số khác" if extra_n else ""
        text_num = (
            f"Có {len(unverified_numbers)} số liệu gắn trích dẫn trực tiếp nhưng chưa tìm thấy trong văn bản nguồn: {preview}{extra}."
        )
        warnings.append(text_num)
        warning_items.append(
            {
                "code": "unverified_numbers",
                "params": {
                    "count": len(unverified_numbers),
                    "preview": preview,
                    "extraCount": extra_n,
                },
                "text": text_num,
            }
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
        "warningItems": warning_items,
    }


# ---------------------------------------------------------------------------
# 4. Thu thập câu khẳng định có trích dẫn để kiểm mức "nguồn có ủng hộ không"
# ---------------------------------------------------------------------------
def collect_cited_claims(
    messages: list[dict[str, Any]],
    sources: list[dict[str, Any]],
    *,
    max_claims: int = MAX_CLAIMS_TO_CHECK,
) -> list[dict[str, Any]]:
    """Chọn tối đa max_claims câu có [S#] hợp lệ, chia đều giữa các AI (ưu tiên câu có số liệu)."""
    valid_ids = {str(s.get("id")) for s in (sources or []) if isinstance(s, dict) and s.get("id")}
    per_handle: dict[str, list[dict[str, Any]]] = {}
    for msg in messages or []:
        if not isinstance(msg, dict):
            continue
        sender_type = str(msg.get("senderType") or ("ai" if msg.get("handle") else "user")).strip()
        if sender_type != "ai" or not msg.get("handle"):
            continue
        handle = str(msg["handle"])
        bucket = per_handle.setdefault(handle, [])
        for sentence in _split_sentences(str(msg.get("content") or ""), split_table_cells=False):
            cited = list(dict.fromkeys(s for s in iter_direct_citation_ids(sentence) if s in valid_ids))
            if not cited:
                continue
            text = re.sub(r"@[\wÀ-ỹ]+", "@AI", sentence).strip()
            if len(text) > _MAX_CLAIM_CHARS:
                text = text[: _MAX_CLAIM_CHARS - 1].rstrip() + "…"
            bucket.append(
                {
                    "handle": handle,
                    "round": msg.get("round", 0),
                    "sentence": text,
                    "sourceIds": cited,
                    "hasNumber": bool(_extract_sentence_numeric_claims(sentence)),
                }
            )
    for bucket in per_handle.values():
        bucket.sort(key=lambda c: (not c["hasNumber"],))  # ổn định: giữ thứ tự gốc trong mỗi nhóm

    chosen: list[dict[str, Any]] = []
    queues = [list(b) for b in per_handle.values() if b]
    while queues and len(chosen) < max_claims:
        for q in list(queues):
            if not q:
                queues.remove(q)
                continue
            chosen.append(q.pop(0))
            if len(chosen) >= max_claims:
                break
        queues = [q for q in queues if q]
    for idx, claim in enumerate(chosen, start=1):
        claim["id"] = f"C{idx}"
    return chosen


# ---------------------------------------------------------------------------
# 5. Biên bản cho Trọng tài
# ---------------------------------------------------------------------------
def format_verification_for_judge(
    messages: list[dict[str, Any]],
    sources: list[dict[str, Any]],
    alias_map: dict[str, str],
    anonymize: bool,
) -> tuple[str, dict[str, Any]]:
    """Tổng hợp biên bản kiểm chứng khách quan cho từng ứng viên gửi Trọng tài."""
    per_handle_stats: dict[str, dict[str, Any]] = {}
    summary: dict[str, Any] = {
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
