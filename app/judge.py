"""Tầng Trọng tài Ẩn danh & Tổng hợp Báo cáo (Judge & Synthesizer).
- Che danh tính 2 chiều (@handle <-> Ứng viên A/B) khi anonymize=True.
- Nhúng biên bản kiểm chứng định danh từ app.verifier vào prompt Trọng tài để chấm điểm Evidence công tâm.
- Gửi danh sách lane đã tham gia tranh luận (exclude_lanes) sang Bridge để ưu tiên Trọng tài chạy trên tài khoản độc lập.
"""

from __future__ import annotations

import math
import re
from typing import Any

from app.bridge import BridgeClient, parse_resilient_json
from app.prompts import extract_summary_1line, format_content_level_label
from app.providers import ProviderStore
from app.storage import utc_now_iso
from app.verifier import format_verification_for_judge

MAX_JUDGE_SOURCE_EXCERPT = 6000


def mask_handles_in_text(text: str, alias_map: dict[str, str]) -> str:
    """Che danh tính @handle trong văn bản bằng mã ẩn danh tương ứng."""
    out = str(text or "")
    if not out or not alias_map:
        return out
    for handle in sorted(alias_map.keys(), key=len, reverse=True):
        alias = alias_map[handle]
        if not handle or handle == alias:
            continue
        pattern = re.compile(
            rf"(?:^|(?<=[\s(\[\{{'\",.:;!?/]))@?{re.escape(handle)}(?=$|[\s)\]\}}'\",.:;!?/])",
            flags=re.IGNORECASE,
        )
        out = pattern.sub(alias, out)
    return out


def unmask_handles_in_text(text: str, reverse_alias: dict[str, str]) -> str:
    """Giải mã toàn bộ nhãn Ứng viên A/B trong báo cáo về @handle thực tế."""
    out = str(text or "")
    if not out or not reverse_alias:
        return out
    alias_entries: list[tuple[str, str]] = []
    for raw_alias, handle in reverse_alias.items():
        clean_alias = str(raw_alias or "").strip().lstrip("@")
        clean_handle = str(handle or "").strip().lstrip("@")
        if not clean_alias or not clean_handle or clean_alias.lower() == clean_handle.lower():
            continue
        alias_entries.append((clean_alias, f"@{clean_handle}"))
        if clean_alias.lower().startswith("ứng viên "):
            suffix = clean_alias[len("ứng viên ") :].strip()
            if suffix:
                alias_entries.append((f"Candidate {suffix}", f"@{clean_handle}"))

    alias_entries.sort(key=lambda pair: len(pair[0]), reverse=True)
    for alias_label, real_mention in alias_entries:
        parts = [re.escape(p) for p in alias_label.split()]
        flexible = r"\s+".join(parts)
        pattern = re.compile(
            rf"(?<![\wÀ-ỹ])@?{flexible}(?![\wÀ-ỹ])",
            flags=re.IGNORECASE,
        )
        out = pattern.sub(real_mention, out)
    return out


def build_judge_prompt(
    room_title: str,
    sources: list[dict[str, Any]],
    messages: list[dict[str, Any]],
    alias_map: dict[str, str],
    anonymize: bool,
    verification_report: str = "",
) -> str:
    """Xây dựng prompt cho Trọng tài bao gồm trích đoạn nguồn, lượt người dùng, biên bản kiểm chứng và che danh tính."""
    transcript_blocks: list[str] = []
    for m in messages:
        if not isinstance(m, dict):
            continue
        raw_content = str(m.get("content") or "").strip()
        if not raw_content:
            continue
        sender_type = str(m.get("senderType") or ("ai" if m.get("handle") else "user")).strip()
        round_num = m.get("round", 0)
        if sender_type == "system":
            continue
        body = mask_handles_in_text(raw_content, alias_map) if anonymize else raw_content
        if sender_type == "user":
            transcript_blocks.append(f"[Vòng {round_num} · Người dùng]:\n{body}")
        elif m.get("handle"):
            h = str(m["handle"])
            speaker = alias_map.get(h, f"@{h}" if not anonymize else h)
            transcript_blocks.append(f"[Vòng {round_num}] {speaker}:\n{body}")

    transcript = "\n\n---\n\n".join(transcript_blocks)

    if sources:
        source_lines: list[str] = []
        for s in sources:
            sid = s.get("id")
            origin = s.get("origin") or "N/A"
            title = s.get("title") or ""
            level_tag = format_content_level_label(s.get("contentLevel"))
            excerpt = str(s.get("excerpt") or "").strip()
            if len(excerpt) > MAX_JUDGE_SOURCE_EXCERPT:
                excerpt = excerpt[: MAX_JUDGE_SOURCE_EXCERPT - 1].rstrip() + "…"
            if excerpt:
                source_lines.append(f'[{sid}] [{level_tag}] ({origin}) {title}: "{excerpt}"')
            else:
                source_lines.append(f"[{sid}] [{level_tag}] ({origin}) {title}")
        source_list = "\n".join(source_lines)
    else:
        source_list = "(Chưa có nguồn)"

    ver_section = (
        f"\n\nBIÊN BẢN KIỂM CHỨNG ĐỊNH DANH TỰ ĐỘNG (DỮ LIỆU ĐỐI CHIẾU KHÁCH QUAN):\n{verification_report}"
        if verification_report
        else ""
    )

    labels_str = ", ".join(alias_map.values())
    return (
        f'Đề tài nghiên cứu: "{room_title}"\n\n'
        f"KHO NGUỒN HỢP LỆ:\n{source_list}\n\n"
        f"TOÀN BỘ LẬP LUẬN:\n{transcript}"
        f"{ver_section}\n\n"
        "Hãy đóng vai Trọng tài học thuật công tâm, đối chiếu trực tiếp lập luận với KHO NGUỒN HỢP LỆ, BIÊN BẢN KIỂM CHỨNG ĐỊNH DANH và các câu hỏi của Người dùng qua từng vòng. "
        "Ứng viên nào bịa mã [S#] không tồn tại hoặc gắn [S#] trực tiếp cho số liệu không có trong nguồn thì phải trừ điểm evidence nghiêm khắc; ứng viên nào trung thực tách bạch [S#] và [Suy luận từ S#] được đánh giá cao về tính minh bạch khoa học. "
        "Trả về ĐÚNG 1 khối JSON hợp lệ tiếng Việt (không văn bản thừa ngoài JSON) gồm các khóa: "
        "executiveSummary (1 đoạn súc tích kèm mã [S#] hợp lệ nếu có), "
        "consensus (mảng {title, supporters, citations}), "
        "contradictions (mảng {topic, detail, suggestedPrompt}), "
        "gaps (mảng chuỗi 2 lỗ hổng cần tìm thêm nguồn), "
        "openDebates (mảng 1-2 câu), "
        f"scores (mảng {{label, evidence, logic, rebuttal, summary, citations}} thang 0..10 cho từng mã nhãn: {labels_str})."
    )


async def synthesize_judge_report(
    *,
    body: dict[str, Any],
    bridge: BridgeClient,
    prov_store: ProviderStore,
    started_monotonic: float,
    time_fn,
    on_status: Any = None,
) -> tuple[int, dict[str, Any]]:
    room_title = str(body.get("roomTitle") or "Nghiên cứu").strip()
    messages = list(body.get("messages") or [])
    perspectives = list(body.get("perspectives") or [])
    sources = list(body.get("sources") or [])
    anonymize = bool(body.get("anonymize", True))

    ai_messages = [
        m
        for m in messages
        if isinstance(m, dict)
        and m.get("handle")
        and str(m.get("senderType") or "ai").strip() == "ai"
    ]
    if not ai_messages:
        return 400, {"error": "Cần ít nhất 1 phản hồi từ góc nhìn AI để Trọng tài tổng hợp."}

    active_handles: list[str] = []
    used_lanes: set[str] = set()
    for m in ai_messages:
        h = str(m["handle"])
        if h not in active_handles:
            active_handles.append(h)
        lid = str(m.get("laneId") or "").strip()
        if lid and lid not in ("bridge", "auto") and not lid.startswith("api:"):
            used_lanes.add(lid)

    alias_map: dict[str, str] = {}
    reverse_alias: dict[str, str] = {}
    for idx, h in enumerate(active_handles):
        letter = chr(65 + (idx % 26))
        alias = f"Ứng viên {letter}" if anonymize else f"@{h}"
        alias_map[h] = alias
        reverse_alias[alias] = h
        reverse_alias[alias.lstrip("@")] = h
        reverse_alias[h] = h

    verification_report, verification_summary = format_verification_for_judge(
        messages, sources, alias_map, anonymize
    )
    prompt_text = build_judge_prompt(
        room_title,
        sources,
        messages,
        alias_map,
        anonymize,
        verification_report=verification_report,
    )

    judge_model = str(body.get("judgeModel") or "").strip() or None
    judge_provider_id = str(body.get("judgeProviderId") or "").strip() or None
    judge_lane_id = str(body.get("judgeLaneId") or "").strip() or None

    result = await prov_store.complete(
        default_bridge=bridge,
        provider_id=judge_provider_id,
        system_instruction="Bạn là Trọng tài học thuật. Chỉ trả về duy nhất 1 JSON object hợp lệ.",
        user_prompt=prompt_text,
        model=judge_model,
        pinned_lane_id=judge_lane_id,
        exclude_lanes=None if judge_lane_id else (used_lanes or None),
        on_status=on_status,
    )

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

    def _parse_score_val(raw_val: Any) -> float | None:
        if raw_val is None or isinstance(raw_val, bool):
            return None
        try:
            val = float(raw_val)
        except (TypeError, ValueError):
            return None
        if math.isnan(val) or math.isinf(val):
            return None
        return round(min(10.0, max(0.0, val)), 1)

    def _find_score(handle: str) -> dict[str, Any]:
        for row in parsed.get("scores") or []:
            if not isinstance(row, dict):
                continue
            lbl = str(row.get("label") or "").strip()
            mapped = reverse_alias.get(lbl) or reverse_alias.get(lbl.lstrip("@"))
            if mapped == handle or lbl.lstrip("@").lower() == handle.lower():
                return row
            if alias_map.get(handle) and alias_map[handle].lower() in lbl.lower():
                return row
        return {}

    rubric: list[dict[str, Any]] = []
    breakdown: list[dict[str, Any]] = []
    evaluation_warnings: list[str] = []
    for handle in active_handles:
        p = next((item for item in perspectives if item.get("handle") == handle), {})
        row = _find_score(handle)
        ev_parsed = _parse_score_val(row.get("evidence"))
        lg_parsed = _parse_score_val(row.get("logic"))
        rb_parsed = _parse_score_val(row.get("rebuttal"))
        fallback_scored = ev_parsed is None or lg_parsed is None or rb_parsed is None
        ev = ev_parsed if ev_parsed is not None else 5.0
        lg = lg_parsed if lg_parsed is not None else 5.0
        rb = rb_parsed if rb_parsed is not None else 5.0
        tot = round((ev + lg + rb) / 3.0, 1)
        if fallback_scored:
            evaluation_warnings.append(
                f"@{handle}: Trọng tài không trả về đủ điểm số JSON hợp lệ — tạm hiển thị mức cơ sở dự phòng (5.0)."
            )
        rubric.append(
            {
                "perspectiveId": p.get("id", handle),
                "handle": handle,
                "colorIndex": int(p.get("colorIndex", 0)),
                "evidence": ev,
                "logic": lg,
                "rebuttal": rb,
                "total": tot,
                "fallbackScored": fallback_scored,
            }
        )
        raw_summary = str(row.get("summary") or "").strip()
        if not raw_summary:
            summary_text = (
                f"Chưa bóc tách được đánh giá chi tiết từ Trọng tài cho @{handle} (dùng điểm dự phòng)."
                if fallback_scored
                else f"Đóng góp góc nhìn chuyên môn từ @{handle}."
            )
        else:
            summary_text = unmask_handles_in_text(raw_summary, reverse_alias)
        breakdown.append(
            {
                "handle": handle,
                "summary": summary_text,
                "citations": _clean_cites(row.get("citations")),
            }
        )
    rubric.sort(key=lambda r: r["total"], reverse=True)

    raw_exec_summary = str(
        parsed.get("executiveSummary")
        or "Trọng tài đã tổng hợp các lập luận chính, cân đối bằng chứng và chỉ ra trục tranh luận cần tiếp tục xác minh."
    )
    exec_summary = unmask_handles_in_text(raw_exec_summary, reverse_alias)
    report = {
        "title": f"Báo cáo tổng hợp: {room_title}",
        "subtitle": f"Trọng tài {'(Ẩn danh)' if anonymize else '(Công khai)'} · {len(sources)} nguồn xác minh · {len(active_handles)}/{len(perspectives)} góc nhìn tham gia",
        "executiveSummary": exec_summary,
        "perspectiveBreakdown": breakdown,
        "openDebates": [
            unmask_handles_in_text(str(x), reverse_alias) for x in (parsed.get("openDebates") or [])
        ],
        "rubric": rubric,
        "evaluationWarnings": evaluation_warnings,
        "verificationSummary": verification_summary,
        "updatedAt": utc_now_iso(),
    }
    living_outline = {
        "consensus": [
            {
                "title": unmask_handles_in_text(str(c.get("title", "")), reverse_alias),
                "supporters": [
                    reverse_alias.get(str(s), unmask_handles_in_text(str(s), reverse_alias).lstrip("@"))
                    for s in (c.get("supporters") or [])
                ],
                "citations": _clean_cites(c.get("citations")),
            }
            for c in (parsed.get("consensus") or [])
            if isinstance(c, dict)
        ],
        "contradictions": [
            {
                "topic": unmask_handles_in_text(str(c.get("topic", "")), reverse_alias),
                "detail": unmask_handles_in_text(str(c.get("detail", "")), reverse_alias),
                "suggestedPrompt": unmask_handles_in_text(
                    str(c.get("suggestedPrompt", "")), reverse_alias
                ),
            }
            for c in (parsed.get("contradictions") or [])
            if isinstance(c, dict)
        ],
        "gaps": [
            unmask_handles_in_text(str(g), reverse_alias) for g in (parsed.get("gaps") or [])
        ],
    }

    return 200, {
        "report": report,
        "livingOutline": living_outline,
        "elapsedSec": round(time_fn() - started_monotonic, 1),
        "summary1Line": extract_summary_1line(exec_summary),
        "anonymizeUsed": anonymize,
        "laneId": result.lane_id,
        "modelUsed": result.model_used,
        "rawPrompt": result.raw_prompt,
    }
