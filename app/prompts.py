"""Tầng Ngữ cảnh & Quy tắc Viết Học thuật (Prompts & History Context).
- Chứa hằng số ngữ cảnh, hàm rút gọn lịch sử đa vòng và bộ sinh System/User Prompt cho từng góc nhìn AI.
- Tách bạch nghiêm ngặt [S#] (trích dẫn trực tiếp) và [Suy luận từ S#] (ngoại suy/tổng hợp), cùng nhãn mức độ nguồn.
"""

from __future__ import annotations

import re
from typing import Any

MAX_HISTORY_CHARS = 8000
MAX_DEEP_HISTORY_CHARS = 60000
MAX_PRESERVED_RESEARCH_CHARS = 16000
MAX_PERSPECTIVE_SOURCE_CHARS = 3000
MAX_PERSPECTIVE_SOURCE_CHARS_DEEP = 12000
_OLDER_USER_MAX_CHARS = 240
_HISTORY_OMISSION_NOTE = (
    "[Lưu ý: Một số lượt hội thoại cũ hơn đã được rút gọn hoặc lược bớt để đảm bảo giới hạn ngữ cảnh.]"
)

_RESEARCH_ROLE_KEYWORDS = ("nghiên_cứu", "nghien_cuu", "research", "tài_liệu", "tai_lieu")


_CJK_TEXT_RE = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]")


def extract_summary_1line(text: str) -> str:
    for line in (text or "").splitlines():
        cleaned = line.strip()
        if not cleaned:
            continue
        cleaned = re.sub(r"^#+\s*", "", cleaned)
        cleaned = re.sub(
            r"^(?:\*\*)?(?:Kết luận|Conclusion|Summary|结论|总结|まとめ|結論|결론|요약)\s*[:：](?:\*\*)?\s*",
            "",
            cleaned,
            flags=re.IGNORECASE,
        )
        cleaned = cleaned.replace("**", "").strip()
        min_len = 4 if _CJK_TEXT_RE.search(cleaned) else 16
        if len(cleaned) >= min_len:
            return cleaned[:152].rstrip() + "…" if len(cleaned) > 155 else cleaned
    fallback = re.sub(r"\s+", " ", (text or "").replace("**", "")).strip()
    return fallback[:152].rstrip() + "…" if len(fallback) > 155 else fallback


def format_conversation_history(
    history: list[dict[str, Any]],
    max_chars: int = MAX_HISTORY_CHARS,
) -> str:
    """Định dạng lịch sử hội thoại đa vòng thành ngữ cảnh có giới hạn độ dài."""
    normalized: list[tuple[int, dict[str, Any], str]] = []
    for item in history or []:
        if not isinstance(item, dict):
            continue
        sender_type = str(item.get("senderType") or "").strip()
        if sender_type not in {"user", "ai", "judge", "system"}:
            continue
        content = str(item.get("content") or "").strip()
        if not content:
            continue
        round_val = int(item.get("round") or 0)
        normalized.append((round_val, item, content))

    if not normalized or max_chars <= 0:
        return ""

    latest_round = max(r for r, _, _ in normalized)
    entries: list[str] = []
    for r, item, content in normalized:
        sender_type = str(item.get("senderType") or "").strip()
        preserve_full = bool(item.get("preserveFull") or item.get("pinnedToReport"))
        if sender_type == "user":
            label = f"[Vòng {r} · Người dùng]"
        elif sender_type == "ai":
            handle = str(item.get("handle") or "AI").strip().lstrip("@") or "AI"
            label = f"[Vòng {r} · @{handle}]"
        elif sender_type == "system":
            label = f"[Vòng {r} · Tài liệu nghiên cứu]"
        else:
            label = f"[Vòng {r} · Trọng tài]"

        if r == latest_round:
            body = content
        elif preserve_full:
            body = (
                content
                if len(content) <= MAX_PRESERVED_RESEARCH_CHARS
                else content[: MAX_PRESERVED_RESEARCH_CHARS - 1].rstrip() + "…"
            )
        elif sender_type == "user":
            body = (
                content
                if len(content) <= _OLDER_USER_MAX_CHARS
                else content[:_OLDER_USER_MAX_CHARS].rstrip() + "…"
            )
        else:
            summary = str(item.get("summary1Line") or "").strip()
            body = summary or extract_summary_1line(content)

        entries.append(f"{label}: {body}")

    joined = "\n".join(entries)
    if len(joined) <= max_chars:
        return joined

    if max_chars <= len(_HISTORY_OMISSION_NOTE) + 2:
        return entries[-1][:max_chars]

    budget = max_chars - len(_HISTORY_OMISSION_NOTE) - 1
    kept: list[str] = []
    used = 0
    for entry in reversed(entries):
        needed = len(entry) if not kept else len(entry) + 1
        if used + needed <= budget:
            kept.insert(0, entry)
            used += needed
        elif not kept:
            truncated = (
                entry[: max(0, budget - 1)].rstrip() + "…"
                if budget > 1
                else entry[:budget]
            )
            kept.insert(0, truncated)
            break
        else:
            break

    return f"{_HISTORY_OMISSION_NOTE}\n" + "\n".join(kept)


def format_content_level_label(level: str | None) -> str:
    lvl = str(level or "").strip().lower()
    if lvl == "full_text":
        return "TOÀN VĂN"
    if lvl == "abstract_only":
        return "CHỈ CÓ TÓM TẮT (ABSTRACT)"
    return "TRÍCH ĐOẠN"


_SOURCE_TYPE_TAGS = {
    "preprint": "PREPRINT · chưa bình duyệt",
    "published_venue": "ĐÃ XUẤT BẢN",
    "other_scholarly": "HỌC THUẬT KHÁC",
    "encyclopedia": "BÁCH KHOA",
    "web": "TRANG WEB",
    "web_pdf": "PDF WEB",
    "user_upload": "PDF NGƯỜI DÙNG",
    "user_excerpt": "TRÍCH ĐOẠN NGƯỜI DÙNG",
}


def format_source_type_tag(source: dict[str, Any]) -> str:
    """Nhãn loại nguồn để AI/Trọng tài cân trọng số bằng chứng (preprint ≠ bài đã xuất bản ≠ Wikipedia)."""
    tag = _SOURCE_TYPE_TAGS.get(str(source.get("sourceType") or "").strip())
    if not tag:
        return ""
    venue = str(source.get("venue") or "").strip()
    if source.get("sourceType") == "published_venue" and venue:
        tag = f"{tag}: {venue[:60]}"
    return f" [{tag}]"


def format_sources_for_prompt(
    sources: list[dict[str, Any]],
    *,
    max_excerpt_chars: int,
) -> str:
    if not sources:
        return "Chưa có nguồn đính kèm; trả lời dựa trên lập luận chuyên môn và không tự bịa mã [S#]."

    lines: list[str] = []
    for s in sources:
        if not isinstance(s, dict):
            continue
        sid = s.get("id")
        origin = s.get("origin") or "N/A"
        title = s.get("title") or ""
        level_tag = format_content_level_label(s.get("contentLevel"))
        excerpt = str(s.get("excerpt") or "").strip()
        if len(excerpt) > max_excerpt_chars:
            excerpt = excerpt[: max_excerpt_chars - 1].rstrip() + "…"
        lines.append(f'[{sid}] [{level_tag}]{format_source_type_tag(s)} ({origin}) {title}: "{excerpt}"')
    return "\n".join(lines) if lines else "Chưa có nguồn đính kèm; trả lời dựa trên lập luận chuyên môn và không tự bịa mã [S#]."


def is_deep_perspective_mode(perspective: dict[str, Any], detail_mode: str = "") -> bool:
    mode = str(detail_mode or "").strip().lower()
    handle_low = str(perspective.get("handle") or "").lower()
    tags_low = " ".join(str(t).lower() for t in (perspective.get("tags") or []))
    is_research_bot = any(kw in handle_low or kw in tags_low for kw in _RESEARCH_ROLE_KEYWORDS)
    return mode == "deep" or (is_research_bot and mode not in ("standard", "concise"))


def build_perspective_prompts(
    *,
    perspective: dict[str, Any],
    prompt: str,
    sources: list[dict[str, Any]],
    round_num: int,
    conversation_history: list[dict[str, Any]],
    peer_messages: list[dict[str, Any]],
    detail_mode: str = "",
) -> tuple[str, str, bool]:
    """Dựng (system_instruction, user_prompt, use_deep_mode) theo chuẩn toàn vẹn dữ liệu."""
    use_deep_mode = is_deep_perspective_mode(perspective, detail_mode)
    excerpt_limit = MAX_PERSPECTIVE_SOURCE_CHARS_DEEP if use_deep_mode else MAX_PERSPECTIVE_SOURCE_CHARS
    source_context = format_sources_for_prompt(sources, max_excerpt_chars=excerpt_limit)

    has_preserved = any(
        isinstance(item, dict) and (item.get("preserveFull") or item.get("pinnedToReport"))
        for item in conversation_history
    )
    history_block = format_conversation_history(
        conversation_history,
        max_chars=MAX_DEEP_HISTORY_CHARS if (has_preserved or use_deep_mode) else MAX_HISTORY_CHARS,
    )
    discussion_context = ""
    if history_block:
        discussion_context = (
            "\n\nLỊCH SỬ HỘI THOẠI TRƯỚC ĐÓ TRONG PHÒNG "
            "(đọc kỹ ngữ cảnh các vòng trước để trả lời nối tiếp, phản biện trực diện hoặc bổ sung điểm thiếu):\n"
            + history_block
        )
    elif peer_messages:
        lines = "\n".join(
            f"- @{m.get('handle')}: {m.get('content')}" for m in peer_messages
        )
        discussion_context = (
            "\n\nCÁC LẬP LUẬN TRƯỚC ĐÓ TRONG PHÒNG "
            "(hãy phản biện trực diện hoặc bổ sung điểm thiếu):\n" + lines
        )

    length_rule = (
        "5. CHẾ ĐỘ HỒ SƠ NGHIÊN CỨU CHUYÊN SÂU: KHÔNG giới hạn 230 từ. Hãy trình bày ĐẦY ĐỦ và CHI TIẾT toàn bộ hồ sơ tài liệu, bảng so sánh Markdown (nếu phù hợp), số liệu, dẫn chứng và trích đoạn cốt lõi từ các nguồn [S#] (500–1500+ từ) ngay trong bài trả lời để các Bot Phản biện và Trọng tài ở bước sau có trọn vẹn tư liệu đối chiếu."
        if use_deep_mode
        else "5. Giữ độ dài khoảng 130–230 từ để người dùng đọc nhanh các luận điểm chính."
    )

    system_instruction = "\n".join(
        [
            f"Bạn đang đóng vai góc nhìn @{perspective.get('handle')} ({perspective.get('name')}) "
            "trong một phòng nghiên cứu đa góc nhìn.",
            str(perspective.get("rolePrompt") or ""),
            "QUY TẮC ĐỊNH DẠNG & TOÀN VẸN BẮT BUỘC:",
            "0. NGÔN NGỮ TRẢ LỜI BẮT BUỘC: Luôn trả lời hoàn toàn bằng ĐÚNG NGÔN NGỮ mà người dùng sử dụng trong CÂU HỎI CỦA NGƯỜI DÙNG (nếu người dùng hỏi tiếng Anh → trả lời tiếng Anh; tiếng Trung/Nhật/Hàn/Việt → trả lời đúng ngôn ngữ đó). Chỉ giữ nguyên mã [S#] và thuật ngữ trích dẫn nguyên văn từ nguồn khi cần thiết.",
            '1. Dòng đầu tiên PHẢI bắt đầu bằng tiền tố tóm tắt kết luận khớp ngôn ngữ trả lời ("Kết luận: " / "Conclusion: " / "结论：" / "結論：" / "결론: ") và tóm gọn lập trường cốt lõi trong đúng 1 câu (dưới 28 từ).',
            "2. Sau đó trình bày phân tích có cấu trúc rõ ràng (dùng tiêu đề ##/###, gạch đầu dòng hoặc bảng Markdown | Cột | Giá trị |).",
            "3. TÁCH BẠCH BẰNG CHỨNG VÀ SUY LUẬN: Chỉ gắn [S1], [S2]... cho thông tin/con số CÓ THẬT trực tiếp trong văn bản nguồn tương ứng. Khi suy diễn, tổng hợp chéo hoặc nêu giả thuyết không ghi trực tiếp trong nguồn, BẮT BUỘC viết thẻ suy luận theo ngôn ngữ trả lời ([Suy luận từ S1] / [Inferred from S1] / [推论自 S1] / [推論: S1] / [추론: S1]) hoặc nói rõ đó là lập luận chuyên môn.",
            "4. TRUNG THỰC MỨC NGUỒN: Với nguồn mang nhãn [CHỈ CÓ TÓM TẮT (ABSTRACT)], tuyệt đối không tự bịa chi tiết thực nghiệm, cỡ mẫu hay số liệu bảng biểu không có trong phần trích dẫn. Tuyệt đối không bịa mã [S#] ngoài danh sách.",
            length_rule,
        ]
    )
    user_prompt = (
        f"VÒNG THẢO LUẬN: Vòng {round_num}\n"
        f"KHO NGUỒN ĐÍNH KÈM:\n{source_context}{discussion_context}\n\n"
        f"CÂU HỎI CỦA NGƯỜI DÙNG:\n{prompt}"
    )
    return system_instruction, user_prompt, use_deep_mode
