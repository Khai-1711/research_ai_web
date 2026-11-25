"""Tầng Trọng tài Ẩn danh & Tổng hợp Báo cáo (Judge & Synthesizer).
- Che danh tính 2 chiều (@handle <-> Ứng viên A/B) khi anonymize=True.
- Nhúng biên bản kiểm chứng định danh từ app.verifier vào prompt Trọng tài để chấm điểm Evidence công tâm.
- Gửi danh sách lane đã tham gia tranh luận (exclude_lanes) sang Bridge để ưu tiên Trọng tài chạy trên tài khoản độc lập.

Giảm thiên lệch Trọng tài (LLM-as-a-Judge):
- Chấm NHIỀU lần (judgeRuns, mặc định 2, tối đa 3) với thứ tự ứng viên khác nhau: lần 1 giữ nguyên, lần 2 đảo
  ngược, lần 3 xáo theo seed ghi lại được. Nhãn "Ứng viên A/B" được gán lại theo thứ tự mới mỗi lần.
- Điểm cuối = trung bình các lần chấm hợp lệ, kèm độ lệch (max-min) và cờ thứ hạng có ổn định không.
- Cảnh báo khi Trọng tài cùng họ model với các AI tranh luận (nguy cơ tự ưu ái / self-preference).
- Không còn bịa "tóm tắt" khi JSON hỏng: báo rõ Trọng tài chưa tổng hợp được.
- Sau khi chấm, chạy bước kiểm chứng mức câu (app.claim_check) như một tín hiệu độc lập.
"""

from __future__ import annotations

import asyncio
import math
import random
import re
import time
from typing import Any

from app.bridge import BridgeCallError, BridgeClient, parse_resilient_json
from app.claim_check import run_claim_check
from app.prompts import extract_summary_1line, format_content_level_label, format_source_type_tag
from app.providers import ProviderStore
from app.storage import utc_now_iso
from app.verifier import collect_cited_claims, format_verification_for_judge

MAX_JUDGE_SOURCE_EXCERPT = 6000
DEFAULT_JUDGE_RUNS = 2
MAX_JUDGE_RUNS = 3
UNSTABLE_SPREAD_THRESHOLD = 1.5
_NO_SYNTHESIS_TEXT = (
    "⚠ Trọng tài không trả về JSON hợp lệ ở mọi lần chấm nên CHƯA có bản tổng hợp. "
    "Hãy chạy lại hoặc đổi model Trọng tài trong Cài đặt."
)


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


def _alias_label(idx: int) -> str:
    """A..Z rồi AA, AB... để không bao giờ trùng nhãn khi > 26 AI."""
    label = ""
    n = idx
    while True:
        label = chr(65 + (n % 26)) + label
        n = n // 26 - 1
        if n < 0:
            return f"Ứng viên {label}"


def build_alias_maps(order: list[str], anonymize: bool) -> tuple[dict[str, str], dict[str, str]]:
    alias_map: dict[str, str] = {}
    reverse_alias: dict[str, str] = {}
    for idx, h in enumerate(order):
        alias = _alias_label(idx) if anonymize else f"@{h}"
        alias_map[h] = alias
        reverse_alias[alias] = h
        reverse_alias[alias.lstrip("@")] = h
        reverse_alias[h] = h
    return alias_map, reverse_alias


def candidate_order_for_run(handles: list[str], run_idx: int, seed: str) -> list[str]:
    """Lần 0: giữ nguyên; lần 1: đảo ngược (hoán vị vị trí chuẩn); lần 2+: xáo theo seed tái lập được."""
    if run_idx == 0:
        return list(handles)
    if run_idx == 1:
        return list(reversed(handles))
    order = list(handles)
    random.Random(f"{seed}:{run_idx}").shuffle(order)
    return order


def order_messages_for_judge(messages: list[dict[str, Any]], order: list[str]) -> list[dict[str, Any]]:
    """Giữ thứ tự vòng; trong mỗi vòng: câu hỏi người dùng trước, sau đó các AI theo `order`."""
    rank = {h: i for i, h in enumerate(order)}

    def _round(m: dict[str, Any]) -> int:
        try:
            return int(m.get("round") or 0)
        except (TypeError, ValueError):
            return 0

    def _key(pair: tuple[int, dict[str, Any]]) -> tuple[int, int, int, int]:
        idx, m = pair
        is_ai = 1 if (m.get("handle") and str(m.get("senderType") or "ai") != "user") else 0
        return (_round(m), is_ai, rank.get(str(m.get("handle") or ""), len(rank)) if is_ai else 0, idx)

    valid = [(i, m) for i, m in enumerate(messages) if isinstance(m, dict)]
    return [m for _i, m in sorted(valid, key=_key)]


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
            type_tag = format_source_type_tag(s)
            excerpt = str(s.get("excerpt") or "").strip()
            if len(excerpt) > MAX_JUDGE_SOURCE_EXCERPT:
                excerpt = excerpt[: MAX_JUDGE_SOURCE_EXCERPT - 1].rstrip() + "…"
            if excerpt:
                source_lines.append(f'[{sid}] [{level_tag}]{type_tag} ({origin}) {title}: "{excerpt}"')
            else:
                source_lines.append(f"[{sid}] [{level_tag}]{type_tag} ({origin}) {title}")
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
        "KHÔNG cộng điểm vì bài dài hơn hay xuất hiện trước/sau: chỉ chấm theo chất lượng bằng chứng, lập luận và phản biện. "
        "Nguồn PREPRINT hoặc BÁCH KHOA có sức nặng bằng chứng thấp hơn nguồn ĐÃ XUẤT BẢN. "
        "Trả về ĐÚNG 1 khối JSON hợp lệ (không văn bản thừa ngoài JSON). TOÀN BỘ giá trị văn bản trong JSON (executiveSummary, consensus, contradictions, gaps, openDebates, summary) PHẢI viết bằng ĐÚNG NGÔN NGỮ mà Người dùng sử dụng trong câu hỏi/thảo luận ở trên (giữ nguyên tên khóa JSON tiếng Anh và giữ nguyên mã nhãn ứng viên trong trường label). Các khóa gồm: "
        "executiveSummary (1 đoạn súc tích kèm mã [S#] hợp lệ nếu có), "
        "consensus (mảng {title, supporters, citations}), "
        "contradictions (mảng {topic, detail, suggestedPrompt}), "
        "gaps (mảng chuỗi 2 lỗ hổng cần tìm thêm nguồn), "
        "openDebates (mảng 1-2 câu), "
        f"scores (mảng {{label, evidence, logic, rebuttal, summary, citations}} thang 0..10 cho từng mã nhãn: {labels_str})."
    )


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


def find_score_row(
    parsed: dict[str, Any], handle: str, alias_map: dict[str, str], reverse_alias: dict[str, str]
) -> dict[str, Any]:
    """Khớp CHÍNH XÁC nhãn -> handle (bỏ so chuỗi con: trước đây '@Kỹ_thuật' khớp nhầm '@Kỹ_thuật_2')."""
    target = str(alias_map.get(handle) or "").strip().lstrip("@").lower()
    candidate_en = (
        "candidate " + target[len("ứng viên ") :] if target.startswith("ứng viên ") else ""
    )
    for row in parsed.get("scores") or []:
        if not isinstance(row, dict):
            continue
        lbl = str(row.get("label") or "").strip().lstrip("@").strip()
        low = lbl.lower()
        if reverse_alias.get(lbl) == handle or reverse_alias.get(f"@{lbl}") == handle:
            return row
        if low == handle.lower() or (target and low == target):
            return row
        for prefix in (target, candidate_en):
            if prefix and re.match(rf"{re.escape(prefix)}(?![\wÀ-ỹ])", low):
                return row
    return {}


def model_family(kind: str | None, model: str | None) -> str:
    """Họ model thô để phát hiện Trọng tài cùng họ với AI tranh luận."""
    k = str(kind or "").strip().lower()
    m = str(model or "").strip().lower()
    if k in ("bridge", "gemini_api") or "gemini" in m:
        return "gemini"
    base = m.rsplit("/", 1)[-1]
    for fam, keys in (
        ("gpt", ("gpt", "o1", "o3", "o4", "chatgpt")),
        ("claude", ("claude",)),
        ("deepseek", ("deepseek",)),
        ("llama", ("llama",)),
        ("qwen", ("qwen", "qwq")),
        ("mistral", ("mistral", "mixtral", "codestral")),
        ("gemma", ("gemma",)),
        ("phi", ("phi",)),
        ("grok", ("grok",)),
    ):
        if any(base.startswith(key) for key in keys):
            return fam
    return re.split(r"[-_:.]", base)[0] or k or "unknown"


async def _run_single_judge(
    *,
    run_idx: int,
    order: list[str],
    anonymize: bool,
    room_title: str,
    messages: list[dict[str, Any]],
    sources: list[dict[str, Any]],
    prov_store: ProviderStore,
    bridge: BridgeClient,
    judge_provider_id: str | None,
    judge_model: str | None,
    judge_lane_id: str | None,
    exclude_lanes: set[str] | None,
    on_status: Any = None,
) -> dict[str, Any]:
    alias_map, reverse_alias = build_alias_maps(order, anonymize)
    ordered_messages = order_messages_for_judge(messages, order)
    verification_report, verification_summary = format_verification_for_judge(
        ordered_messages, sources, alias_map, anonymize
    )
    prompt_text = build_judge_prompt(
        room_title, sources, ordered_messages, alias_map, anonymize, verification_report=verification_report
    )
    run: dict[str, Any] = {
        "runIndex": run_idx,
        "order": order,
        "alias_map": alias_map,
        "reverse_alias": reverse_alias,
        "verification_summary": verification_summary,
        "parsed": {},
        "result": None,
        "error": None,
    }
    try:
        result = await prov_store.complete(
            default_bridge=bridge,
            provider_id=judge_provider_id,
            system_instruction="Bạn là Trọng tài học thuật. Chỉ trả về duy nhất 1 JSON object hợp lệ.",
            user_prompt=prompt_text,
            model=judge_model,
            pinned_lane_id=judge_lane_id,
            exclude_lanes=None if judge_lane_id else (exclude_lanes or None),
            on_status=on_status,
        )
    except BridgeCallError as exc:
        run["error"] = str(exc)
        return run
    run["result"] = result
    run["parsed"] = parse_resilient_json(result.text)
    return run


def _ranking(totals: dict[str, float]) -> list[str]:
    return [h for h, _t in sorted(totals.items(), key=lambda kv: (-kv[1], kv[0]))]


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
    try:
        judge_runs = int(body.get("judgeRuns") or DEFAULT_JUDGE_RUNS)
    except (TypeError, ValueError):
        judge_runs = DEFAULT_JUDGE_RUNS
    judge_runs = max(1, min(MAX_JUDGE_RUNS, judge_runs))
    seed = str(body.get("judgeSeed") or "").strip() or str(int(time.time() * 1000))
    claim_check_enabled = body.get("claimCheck", True) is not False

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

    judge_model = str(body.get("judgeModel") or "").strip() or None
    judge_provider_id = str(body.get("judgeProviderId") or "").strip() or None
    judge_lane_id = str(body.get("judgeLaneId") or "").strip() or None

    orders = [candidate_order_for_run(active_handles, i, seed) for i in range(judge_runs)]
    run_kwargs = dict(
        anonymize=anonymize,
        room_title=room_title,
        messages=messages,
        sources=sources,
        prov_store=prov_store,
        bridge=bridge,
        judge_provider_id=judge_provider_id,
        judge_model=judge_model,
        judge_lane_id=judge_lane_id,
        exclude_lanes=used_lanes,
        on_status=on_status,
    )
    if judge_lane_id:
        # Luồng ghim xử lý tuần tự 1 lượt/lần: gửi song song chỉ làm lượt sau dính lỗi "Bridge đang bận".
        runs = []
        for i, order in enumerate(orders):
            runs.append(await _run_single_judge(run_idx=i, order=order, **run_kwargs))
    else:
        runs = list(
            await asyncio.gather(
                *(_run_single_judge(run_idx=i, order=order, **run_kwargs) for i, order in enumerate(orders))
            )
        )

    completed = [r for r in runs if r["result"] is not None]
    if not completed:
        raise BridgeCallError(runs[0]["error"] or "Trọng tài không phản hồi.")
    parsed_runs = [r for r in completed if r["parsed"]]
    primary = parsed_runs[0] if parsed_runs else completed[0]
    p_alias, p_reverse = primary["alias_map"], primary["reverse_alias"]
    parsed = primary["parsed"]
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

    rubric: list[dict[str, Any]] = []
    breakdown: list[dict[str, Any]] = []
    evaluation_warnings: list[str] = []
    evaluation_warning_items: list[dict[str, Any]] = []
    late_warnings: list[str] = []
    late_warning_items: list[dict[str, Any]] = []
    per_run_totals: list[dict[str, float]] = [{} for _ in completed]

    def _push_warn(
        items: list[dict[str, Any]],
        texts: list[str],
        code: str,
        params: dict[str, Any],
        text: str,
    ) -> None:
        texts.append(text)
        items.append({"code": code, "params": params, "text": text})

    for handle in active_handles:
        p = next((item for item in perspectives if item.get("handle") == handle), {})
        scored: list[tuple[float, float, float]] = []
        totals_by_run: list[float | None] = []
        for ri, run in enumerate(completed):
            row = find_score_row(run["parsed"], handle, run["alias_map"], run["reverse_alias"])
            ev, lg, rb = (_parse_score_val(row.get(k)) for k in ("evidence", "logic", "rebuttal"))
            if ev is None or lg is None or rb is None:
                totals_by_run.append(None)
                continue
            scored.append((ev, lg, rb))
            run_total = round((ev + lg + rb) / 3.0, 1)
            totals_by_run.append(run_total)
            per_run_totals[ri][handle] = run_total

        fallback_scored = not scored
        if scored:
            ev = round(sum(s[0] for s in scored) / len(scored), 1)
            lg = round(sum(s[1] for s in scored) / len(scored), 1)
            rb = round(sum(s[2] for s in scored) / len(scored), 1)
            valid_totals = [t for t in totals_by_run if t is not None]
            tot = round(sum(valid_totals) / len(valid_totals), 1)
            spread = round(max(valid_totals) - min(valid_totals), 1)
        else:
            ev = lg = rb = tot = 5.0
            spread = 0.0
            _push_warn(
                evaluation_warning_items,
                evaluation_warnings,
                "fallback_scored",
                {"handle": handle},
                f"@{handle}: Trọng tài không trả về đủ điểm số JSON hợp lệ — tạm hiển thị mức cơ sở dự phòng (5.0).",
            )
        if scored and len(scored) < len(completed):
            _push_warn(
                late_warning_items,
                late_warnings,
                "partial_scores",
                {"handle": handle, "scored": len(scored), "total": len(completed)},
                f"@{handle}: chỉ {len(scored)}/{len(completed)} lần chấm trả đủ điểm hợp lệ.",
            )
        if spread >= UNSTABLE_SPREAD_THRESHOLD:
            _push_warn(
                late_warning_items,
                late_warnings,
                "score_unstable",
                {"handle": handle, "spread": spread},
                f"@{handle}: tổng điểm dao động {spread} giữa các lần chấm (đổi thứ tự ứng viên) — điểm KHÔNG ổn định.",
            )
        rubric.append(
            {
                "perspectiveId": p.get("id", handle),
                "handle": handle,
                "colorIndex": int(p.get("colorIndex") or 0),
                "evidence": ev,
                "logic": lg,
                "rebuttal": rb,
                "total": tot,
                "fallbackScored": fallback_scored,
                "runsScored": len(scored),
                "runsTotal": len(completed),
                "totalSpread": spread,
                "totalsByRun": totals_by_run,
            }
        )
        row = find_score_row(parsed, handle, p_alias, p_reverse)
        raw_summary = str(row.get("summary") or "").strip()
        summary_code: str | None = None
        if not raw_summary:
            summary_code = "breakdown_fallback" if fallback_scored else "breakdown_default"
            summary_text = (
                f"Chưa bóc tách được đánh giá chi tiết từ Trọng tài cho @{handle} (dùng điểm dự phòng)."
                if fallback_scored
                else f"Đóng góp góc nhìn chuyên môn từ @{handle}."
            )
        else:
            summary_text = unmask_handles_in_text(raw_summary, p_reverse)
        bd_item: dict[str, Any] = {
            "handle": handle,
            "summary": summary_text,
            "citations": _clean_cites(row.get("citations")),
        }
        if summary_code:
            bd_item["summaryCode"] = summary_code
        breakdown.append(bd_item)
    rubric.sort(key=lambda r: (r["fallbackScored"], -r["total"]))

    # Độ ổn định thứ hạng giữa các lần chấm (chỉ tính các lần có đủ điểm cho mọi ứng viên)
    full_rankings = [
        _ranking(t) for t in per_run_totals if t and len(t) == len(active_handles)
    ]
    ranking_stable: bool | None = (
        all(r == full_rankings[0] for r in full_rankings) if len(full_rankings) >= 2 else None
    )
    if ranking_stable is False:
        _push_warn(
            late_warning_items,
            late_warnings,
            "ranking_changed",
            {},
            "Thứ hạng các góc nhìn THAY ĐỔI khi đảo thứ tự ứng viên — không nên dựa vào bảng xếp hạng.",
        )

    # Trọng tài cùng họ model với AI tranh luận -> nguy cơ tự ưu ái
    judge_prov = prov_store.get_raw(judge_provider_id) or {}
    judge_family = model_family(
        judge_prov.get("kind"), primary["result"].model_used or judge_model or judge_prov.get("defaultModel")
    )
    model_by_handle: dict[str, str] = {}
    for m in ai_messages:
        if m.get("modelLabel"):
            model_by_handle[str(m["handle"])] = str(m["modelLabel"])
    debater_families: list[str] = []
    for handle in active_handles:
        p = next((item for item in perspectives if item.get("handle") == handle), {})
        p_prov = prov_store.get_raw(p.get("providerId")) or {}
        fam = model_family(p_prov.get("kind"), model_by_handle.get(handle) or p.get("modelLabel"))
        if fam not in debater_families:
            debater_families.append(fam)
    same_family = judge_family in debater_families
    if same_family:
        _push_warn(
            late_warning_items,
            late_warnings,
            "same_family",
            {"family": judge_family},
            f"Trọng tài cùng họ model '{judge_family}' với AI tranh luận — có nguy cơ tự ưu ái (self-preference). "
            "Nên chọn Trọng tài từ nhà cung cấp khác trong Cài đặt.",
        )

    parse_failed = len(completed) - len(parsed_runs)
    if parse_failed:
        _push_warn(
            late_warning_items,
            late_warnings,
            "parse_failed",
            {"failed": parse_failed, "total": len(completed)},
            f"Trọng tài trả JSON không hợp lệ ở {parse_failed}/{len(completed)} lần chấm.",
        )
    failed_calls = [r for r in runs if r["result"] is None]
    if failed_calls:
        err_snippet = failed_calls[0]["error"][:160]
        _push_warn(
            late_warning_items,
            late_warnings,
            "call_failed",
            {"failed": len(failed_calls), "total": len(runs), "error": err_snippet},
            f"{len(failed_calls)}/{len(runs)} lần chấm không gọi được model: {err_snippet}",
        )

    exec_summary_code: str | None = None
    if parsed_runs:
        parsed_exec = str(parsed.get("executiveSummary") or "").strip()
        if parsed_exec:
            raw_exec_summary = parsed_exec
        else:
            raw_exec_summary = "⚠ Trọng tài không viết phần tóm tắt (executiveSummary rỗng)."
            exec_summary_code = "empty_summary"
    else:
        raw_exec_summary = _NO_SYNTHESIS_TEXT
        exec_summary_code = "no_synthesis"
    exec_summary = unmask_handles_in_text(raw_exec_summary, p_reverse)

    verification_summary = dict(primary["verification_summary"])

    # Kiểm chứng mức câu (tín hiệu độc lập, KHÔNG đưa ngược vào điểm Trọng tài)
    claim_block: dict[str, Any] | None = None
    if claim_check_enabled:
        claims = collect_cited_claims(messages, sources)
        if claims:
            claim_block = await run_claim_check(
                claims=claims,
                sources=sources,
                prov_store=prov_store,
                bridge=bridge,
                provider_id=str(body.get("claimCheckProviderId") or "").strip() or judge_provider_id,
                model=str(body.get("claimCheckModel") or "").strip() or judge_model,
                pinned_lane_id=judge_lane_id,
                exclude_lanes=used_lanes,
            )
            verification_summary["claimSupport"] = {
                **claim_block["summary"],
                "claims": claim_block["results"],
            }
            late_warnings.extend(claim_block["summary"].get("warnings") or [])
            late_warning_items.extend(claim_block["summary"].get("warningItems") or [])

    judge_reliability = {
        "runsRequested": judge_runs,
        "runsCompleted": len(completed),
        "runsParsed": len(parsed_runs),
        "seed": seed,
        "candidateOrders": [r["order"] for r in completed],
        "rankingStable": ranking_stable,
        "maxTotalSpread": max((r["totalSpread"] for r in rubric), default=0.0),
        "judgeFamily": judge_family,
        "debaterFamilies": debater_families,
        "sameFamilyAsDebaters": same_family,
        "runs": [
            {
                "runIndex": r["runIndex"],
                "order": r["order"],
                **(r["result"].provenance() if r["result"] is not None else {}),
                "parsed": bool(r["parsed"]),
                "error": r["error"],
            }
            for r in runs
        ],
    }

    report = {
        "title": f"Báo cáo tổng hợp: {room_title}",
        "titleParams": {"roomTitle": room_title},
        "subtitle": (
            f"Trọng tài {'(Ẩn danh)' if anonymize else '(Công khai)'} · {len(completed)} lần chấm · "
            f"{len(sources)} nguồn · {len(active_handles)}/{len(perspectives)} góc nhìn tham gia"
        ),
        "metaParams": {
            "anonymize": bool(anonymize),
            "runsCompleted": len(completed),
            "sourceCount": len(sources),
            "activeCount": len(active_handles),
            "totalCount": len(perspectives),
        },
        "executiveSummary": exec_summary,
        "executiveSummaryCode": exec_summary_code,
        "perspectiveBreakdown": breakdown,
        "openDebates": [
            unmask_handles_in_text(str(x), p_reverse) for x in (parsed.get("openDebates") or [])
        ],
        "rubric": rubric,
        "evaluationWarnings": evaluation_warnings + late_warnings,
        "evaluationWarningItems": evaluation_warning_items + late_warning_items,
        "verificationSummary": verification_summary,
        "judgeReliability": judge_reliability,
        "updatedAt": utc_now_iso(),
    }
    living_outline = {
        "consensus": [
            {
                "title": unmask_handles_in_text(str(c.get("title", "")), p_reverse),
                "supporters": [
                    p_reverse.get(str(s), unmask_handles_in_text(str(s), p_reverse).lstrip("@"))
                    for s in (c.get("supporters") or [])
                ],
                "citations": _clean_cites(c.get("citations")),
            }
            for c in (parsed.get("consensus") or [])
            if isinstance(c, dict)
        ],
        "contradictions": [
            {
                "topic": unmask_handles_in_text(str(c.get("topic", "")), p_reverse),
                "detail": unmask_handles_in_text(str(c.get("detail", "")), p_reverse),
                "suggestedPrompt": unmask_handles_in_text(str(c.get("suggestedPrompt", "")), p_reverse),
            }
            for c in (parsed.get("contradictions") or [])
            if isinstance(c, dict)
        ],
        "gaps": [unmask_handles_in_text(str(g), p_reverse) for g in (parsed.get("gaps") or [])],
    }

    primary_result = primary["result"]
    return 200, {
        "report": report,
        "livingOutline": living_outline,
        "elapsedSec": round(time_fn() - started_monotonic, 1),
        "summary1Line": extract_summary_1line(exec_summary),
        "anonymizeUsed": anonymize,
        "laneId": primary_result.lane_id,
        "modelUsed": primary_result.model_used,
        "rawPrompt": primary_result.raw_prompt,
        "provenance": primary_result.provenance(),
    }
