import type { FlowActor, FlowEvent } from '../types.ts';

export type FlowPattern = 'direct' | 'council' | 'debate' | 'research';

const ROLE_CATALOG: Array<{
  id: string;
  handle: string;
  name: string;
  tag: string;
  takeaway: string;
}> = [
  {
    id: 'sim-arch',
    handle: 'Kiến_trúc_sư',
    name: 'Kiến trúc sư',
    tag: 'Kỹ_thuật',
    takeaway: 'Đề xuất pipeline lai chấm sơ bộ + hàng đợi phúc khảo khi tin cậy < 0.85 [S1].',
  },
  {
    id: 'sim-sec',
    handle: 'Bảo_mật',
    name: 'Bảo mật',
    tag: 'Rủi_ro',
    takeaway: 'Cảnh báo prompt injection ẩn trong văn bản; bắt buộc lọc sạch đầu vào [S3].',
  },
  {
    id: 'sim-econ',
    handle: 'Kinh_tế',
    name: 'Kinh tế',
    tag: 'Kinh_doanh',
    takeaway: 'Giảm 45% chi phí sơ bộ nhưng kiểm toán chiếm ~20%, hòa vốn 2–3 năm [S2].',
  },
  {
    id: 'sim-legal',
    handle: 'Pháp_lý',
    name: 'Pháp lý',
    tag: 'Rủi_ro',
    takeaway: 'Hệ thống rủi ro cao cần lưu vết giải trình rubric và phúc khảo bởi người [S5].',
  },
  {
    id: 'sim-crit',
    handle: 'Phản_biện',
    name: 'Phản biện',
    tag: 'Rủi_ro',
    takeaway: 'Cảnh báo thiên kiến văn phong vùng miền nếu thiếu bộ hiệu chuẩn mù [S4].',
  },
  {
    id: 'sim-ethics',
    handle: 'Đạo_đức',
    name: 'Đạo đức AI',
    tag: 'Rủi_ro',
    takeaway: 'Yêu cầu công bố tỷ lệ sai số theo từng nhóm thí sinh để bảo đảm công bằng.',
  },
  {
    id: 'sim-ops',
    handle: 'Vận_hành',
    name: 'Vận hành',
    tag: 'Kinh_doanh',
    takeaway: 'Cần quy trình quét bài giấy chuẩn hóa và kịch bản dự phòng sự cố điện/mạng.',
  },
  {
    id: 'sim-ux',
    handle: 'Người_dùng',
    name: 'Thí sinh',
    tag: 'Kinh_doanh',
    takeaway: 'Thí sinh cần thấy bảng tiêu chí chấm minh bạch để tin tưởng kết quả.',
  },
  {
    id: 'sim-data',
    handle: 'Dữ_liệu',
    name: 'Khoa học dữ liệu',
    tag: 'Kỹ_thuật',
    takeaway: 'Đo độ đồng thuận Cohen Kappa ≥ 0.88 giữa AI và giám khảo trước khi mở rộng.',
  },
  {
    id: 'sim-policy',
    handle: 'Chính_sách',
    name: 'Chính sách công',
    tag: 'Kinh_doanh',
    takeaway: 'Khuyến nghị thí điểm ở 2–3 môn tự luận địa phương trước khi áp dụng toàn quốc.',
  },
];

export function buildSimulatedFlow(params: {
  roomId: string;
  totalCount: number;
  disabledIndices: number[];
  pattern: FlowPattern;
  maxConcurrency: number;
  anonymize: boolean;
}): FlowEvent[] {
  const { roomId, totalCount, disabledIndices, pattern, maxConcurrency, anonymize } = params;
  const runId = `sim-${Date.now()}`;
  const now = Date.now();
  let seq = 1;
  const events: FlowEvent[] = [];

  const disabledSet = new Set(disabledIndices);
  const participants: FlowActor[] = ROLE_CATALOG.slice(0, Math.max(2, Math.min(10, totalCount))).map(
    (r, idx) => ({
      id: r.id,
      name: r.name,
      handle: r.handle,
      colorIndex: idx % 10,
      enabled: !disabledSet.has(idx),
      tags: [r.tag],
      kind: 'ai',
    })
  );

  const activeRoles = participants.filter((p) => p.enabled);
  const effectiveActive = activeRoles.length > 0 ? activeRoles : [participants[0]];
  if (activeRoles.length === 0) participants[0].enabled = true;

  const lanes = Array.from({ length: Math.max(1, Math.min(4, maxConcurrency)) }, (_, i) => `acc${i + 1}`);
  const ts = (offsetSec: number) => new Date(now + offsetSec * 1000).toISOString();

  const promptText =
    pattern === 'research'
      ? 'Deep Research: Đánh giá rủi ro & chuẩn an toàn cho AI chấm thi tự luận quy mô quốc gia'
      : pattern === 'debate'
      ? 'Tranh luận 2 vòng: Có nên triển khai AI chấm thi đại học kết hợp giám khảo không?'
      : 'Đánh giá triển khai AI chấm thi đại học ở quy mô quốc gia theo các góc nhìn đang bật';

  // Stage 0: User / Planner
  events.push({
    seq: seq++,
    event_type: 'run_started',
    run_id: runId,
    room_id: roomId,
    timestamp: ts(0),
    payload: {
      node_id: 'stage0_user',
      stage_index: 0,
      stage_label: pattern === 'research' ? 'Kế hoạch (Planner)' : 'Đầu vào',
      pattern,
      actor: {
        id: 'user',
        name: pattern === 'research' ? 'Planner (Bạn)' : 'Bạn (Prompt)',
        colorIndex: 0,
        enabled: true,
        kind: pattern === 'research' ? 'planner' : 'user',
      },
      inputs: [],
      summary_1line: `"${promptText.slice(0, 62)}…" · Gửi tới ${effectiveActive.length}/${participants.length} AI`,
      content: promptText,
      participants,
      transport: { lane_id: 'input', started_offset_s: 0, elapsed_s: 0.4 },
    },
  });

  // Optional Research stage (Stage 1 for research, or parallel Source node in Stage 0)
  let sourceNodeId = 'stage0_sources';
  let councilStageIdx = 1;

  if (pattern === 'research') {
    sourceNodeId = 'stage1_sources';
    councilStageIdx = 2;
    events.push({
      seq: seq++,
      event_type: 'node_started',
      run_id: runId,
      room_id: roomId,
      timestamp: ts(0.6),
      payload: {
        node_id: sourceNodeId,
        stage_index: 1,
        stage_label: 'Nguồn mở [S#]',
        actor: { id: 'sources', name: 'arXiv · OpenAlex · Wiki', colorIndex: 1, enabled: true, kind: 'source' },
        inputs: [{ from_node_id: 'stage0_user', kind: 'prompt', chars: promptText.length, summary: 'Truy vấn 3 kho học thuật mở miễn phí' }],
        transport: { lane_id: 'retrieval', started_offset_s: 0.5, elapsed_s: 0 },
      },
    });
    events.push({
      seq: seq++,
      event_type: 'node_completed',
      run_id: runId,
      room_id: roomId,
      timestamp: ts(2.8),
      payload: {
        node_id: sourceNodeId,
        stage_index: 1,
        stage_label: 'Nguồn mở [S#]',
        actor: { id: 'sources', name: 'arXiv · OpenAlex · Wiki', colorIndex: 1, enabled: true, kind: 'source' },
        inputs: [{ from_node_id: 'stage0_user', kind: 'prompt', chars: promptText.length }],
        summary_1line: 'Nạp 5 nguồn xác minh [S1..S5] từ arXiv, OpenAlex và Wikipedia.',
        content: '[S1] Hybrid Grading arXiv 2025 · [S2] Economic Audit · [S3] Prompt Injection Defense · [S4] Fairness · [S5] EU AI Act.',
        transport: { lane_id: 'retrieval', started_offset_s: 0.5, elapsed_s: 2.3 },
      },
    });
  } else {
    events.push({
      seq: seq++,
      event_type: 'node_completed',
      run_id: runId,
      room_id: roomId,
      timestamp: ts(0.5),
      payload: {
        node_id: sourceNodeId,
        stage_index: 0,
        stage_label: 'Đầu vào',
        actor: { id: 'sources', name: 'Kho nguồn [5]', colorIndex: 1, enabled: true, kind: 'source' },
        inputs: [],
        summary_1line: '[S1] arXiv · [S2] OpenAlex · [S3] Bảo mật · [S4–S5]',
        content: '5 trích đoạn nguồn xác minh được đính kèm vào ngữ cảnh gọi không trạng thái.',
        transport: { lane_id: 'retrieval', started_offset_s: 0.1, elapsed_s: 0.4 },
      },
    });
  }

  // Council / Round 0 execution respecting maxConcurrency lanes
  const laneFreeAt: number[] = lanes.map(() => (pattern === 'research' ? 3.2 : 1.0));
  const stage1NodeIds: Array<{ nodeId: string; actor: FlowActor; finishAt: number }> = [];

  effectiveActive.forEach((actor, idx) => {
    // Pick earliest available lane
    let bestLaneIdx = 0;
    for (let i = 1; i < laneFreeAt.length; i++) {
      if (laneFreeAt[i] < laneFreeAt[bestLaneIdx]) bestLaneIdx = i;
    }
    const startAt = Number(laneFreeAt[bestLaneIdx].toFixed(1));
    const hasFallback = idx === Math.min(2, effectiveActive.length - 1) && effectiveActive.length >= 3;
    const duration = Number((6.2 + ((idx * 2.3) % 5.5) + (hasFallback ? 2.5 : 0)).toFixed(1));
    const finishAt = Number((startAt + duration).toFixed(1));
    laneFreeAt[bestLaneIdx] = finishAt + 0.4;

    const laneId = lanes[bestLaneIdx];
    const nodeId = `stage${councilStageIdx}_${actor.id}`;
    const catalog = ROLE_CATALOG.find((c) => c.id === actor.id);

    const inputs =
      pattern === 'research'
        ? [
            {
              from_node_id: sourceNodeId,
              kind: 'source' as const,
              chars: 1120,
              source_ids: ['S1', 'S2', 'S3'],
              summary: 'Ngữ cảnh 5 trích đoạn nguồn mở [S1..S5] từ bước tìm kiếm',
            },
          ]
        : [
            {
              from_node_id: 'stage0_user',
              kind: 'prompt' as const,
              chars: promptText.length,
              summary: 'Prompt gốc của người dùng',
            },
            {
              from_node_id: sourceNodeId,
              kind: 'source' as const,
              chars: 540,
              source_ids: [`S${(idx % 5) + 1}`],
              summary: `Trích đoạn nguồn [S${(idx % 5) + 1}] phù hợp vai @${actor.handle}`,
            },
          ];

    events.push({
      seq: seq++,
      event_type: 'node_started',
      run_id: runId,
      room_id: roomId,
      timestamp: ts(startAt),
      payload: {
        node_id: nodeId,
        stage_index: councilStageIdx,
        stage_label: pattern === 'debate' ? 'Vòng 0 · Độc lập' : 'Hội đồng N AI',
        actor,
        inputs,
        transport: { lane_id: laneId, started_offset_s: startAt, elapsed_s: 0 },
      },
    });

    if (hasFallback) {
      events.push({
        seq: seq++,
        event_type: 'node_warning',
        run_id: runId,
        room_id: roomId,
        timestamp: ts(startAt + 3.2),
        payload: {
          node_id: nodeId,
          stage_index: councilStageIdx,
          stage_label: pattern === 'debate' ? 'Vòng 0 · Độc lập' : 'Hội đồng N AI',
          actor,
          inputs: [],
          warning_message: `Lane ${laneId} gặp HTTP 429 tạm thời → tự chuyển model dự phòng gemini-4-hydrogen.`,
          transport: {
            lane_id: laneId,
            started_offset_s: startAt,
            elapsed_s: 3.2,
            fallback_from: 'gemini-4-neon',
            retry_count: 1,
          },
        },
      });
    }

    events.push({
      seq: seq++,
      event_type: 'node_completed',
      run_id: runId,
      room_id: roomId,
      timestamp: ts(finishAt),
      payload: {
        node_id: nodeId,
        stage_index: councilStageIdx,
        stage_label: pattern === 'debate' ? 'Vòng 0 · Độc lập' : 'Hội đồng N AI',
        actor,
        inputs,
        summary_1line: catalog?.takeaway || `Phân tích chuyên môn từ góc nhìn @${actor.handle}.`,
        content: `Kết luận: ${catalog?.takeaway || ''}\n\nLập luận chi tiết từ @${actor.handle} dựa trên bằng chứng đối chiếu và khung tiêu chí đánh giá.`,
        transport: {
          lane_id: laneId,
          started_offset_s: startAt,
          elapsed_s: duration,
          fallback_from: hasFallback ? 'gemini-4-neon' : undefined,
          retry_count: hasFallback ? 1 : 0,
        },
      },
    });

    stage1NodeIds.push({ nodeId, actor, finishAt });
  });

  const maxStage1End = Math.max(...stage1NodeIds.map((x) => x.finishAt));

  if (pattern === 'direct') {
    events.push({
      seq: seq++,
      event_type: 'node_completed',
      run_id: runId,
      room_id: roomId,
      timestamp: ts(maxStage1End + 0.5),
      payload: {
        node_id: 'stage2_output',
        stage_index: councilStageIdx + 1,
        stage_label: 'Trả về Bạn',
        actor: { id: 'output', name: 'Trả về Bạn', colorIndex: 1, enabled: true, kind: 'output' },
        inputs: stage1NodeIds.map((item) => ({
          from_node_id: item.nodeId,
          kind: 'turn',
          chars: 680,
          summary: `Phản hồi trực tiếp từ @${item.actor.handle}`,
        })),
        summary_1line: `Đã nhận đủ ${stage1NodeIds.length} câu trả lời trực tiếp (bỏ qua ${participants.length - effectiveActive.length} AI tạm tắt).`,
        content: 'Tất cả phản hồi đã hiển thị trong Phòng chat.',
        transport: { lane_id: 'output', started_offset_s: maxStage1End + 0.2, elapsed_s: 0.3 },
      },
    });
    return events;
  }

  let upstreamForJudge = stage1NodeIds;
  let judgeStageIdx = councilStageIdx + 1;
  let judgeStartAt = Number((maxStage1End + 0.6).toFixed(1));

  // Cross-round Debate (N x N) -> exercises the Exchange Bus!
  if (pattern === 'debate') {
    const r1Nodes: Array<{ nodeId: string; actor: FlowActor; finishAt: number }> = [];
    const r1Lanes = lanes.map(() => maxStage1End + 0.6);

    effectiveActive.forEach((actor, idx) => {
      let bestLane = 0;
      for (let i = 1; i < r1Lanes.length; i++) {
        if (r1Lanes[i] < r1Lanes[bestLane]) bestLane = i;
      }
      const startAt = Number(r1Lanes[bestLane].toFixed(1));
      const dur = Number((5.2 + ((idx * 1.7) % 3.4)).toFixed(1));
      const finishAt = Number((startAt + dur).toFixed(1));
      r1Lanes[bestLane] = finishAt + 0.3;

      const nodeId = `stage2_r1_${actor.id}`;
      const r1Inputs = stage1NodeIds.map((prev) => ({
        from_node_id: prev.nodeId,
        kind: 'turn' as const,
        chars: 520,
        summary: `Đọc lập luận Vòng 0 của @${prev.actor.handle}`,
      }));

      events.push({
        seq: seq++,
        event_type: 'node_started',
        run_id: runId,
        room_id: roomId,
        timestamp: ts(startAt),
        payload: {
          node_id: nodeId,
          stage_index: 2,
          stage_label: 'Vòng 1 · Phản biện chéo',
          actor: { ...actor, name: `${actor.name} (V1)` },
          inputs: r1Inputs,
          transport: { lane_id: lanes[bestLane], started_offset_s: startAt, elapsed_s: 0 },
        },
      });
      events.push({
        seq: seq++,
        event_type: 'node_completed',
        run_id: runId,
        room_id: roomId,
        timestamp: ts(finishAt),
        payload: {
          node_id: nodeId,
          stage_index: 2,
          stage_label: 'Vòng 1 · Phản biện chéo',
          actor: { ...actor, name: `${actor.name} (V1)` },
          inputs: r1Inputs,
          summary_1line: `Phản biện chéo ${stage1NodeIds.length - 1} góc nhìn còn lại và tinh chỉnh đề xuất.`,
          content: `@${actor.handle} đã đối chiếu bài Vòng 0 của các vai khác và cập nhật điều kiện đánh đổi.`,
          transport: { lane_id: lanes[bestLane], started_offset_s: startAt, elapsed_s: dur },
        },
      });
      r1Nodes.push({ nodeId, actor, finishAt });
    });

    upstreamForJudge = r1Nodes;
    judgeStageIdx = 3;
    judgeStartAt = Number((Math.max(...r1Nodes.map((n) => n.finishAt)) + 0.6).toFixed(1));
  }

  // Judge stage (with optional anonymization mask)
  const judgeEnd = Number((judgeStartAt + 7.4).toFixed(1));
  const judgeNodeId = `stage${judgeStageIdx}_judge`;
  const judgeInputs = upstreamForJudge.map((item, idx) => ({
    from_node_id: item.nodeId,
    kind: 'turn' as const,
    anonymized_as: anonymize ? `Ứng viên ${String.fromCharCode(65 + idx)}` : undefined,
    chars: 760,
    source_ids: [`S${(idx % 5) + 1}`],
    summary: anonymize
      ? `Bản ẩn danh (Ứng viên ${String.fromCharCode(65 + idx)}) che tên thật của @${item.actor.handle}`
      : `Lập luận công khai từ @${item.actor.handle}`,
  }));

  events.push({
    seq: seq++,
    event_type: 'node_started',
    run_id: runId,
    room_id: roomId,
    timestamp: ts(judgeStartAt),
    payload: {
      node_id: judgeNodeId,
      stage_index: judgeStageIdx,
      stage_label: 'Trọng tài',
      actor: { id: 'judge', name: 'Trọng tài', colorIndex: 3, enabled: true, kind: 'judge' },
      inputs: judgeInputs,
      transport: { lane_id: lanes[0], started_offset_s: judgeStartAt, elapsed_s: 0 },
    },
  });

  events.push({
    seq: seq++,
    event_type: 'node_completed',
    run_id: runId,
    room_id: roomId,
    timestamp: ts(judgeEnd),
    payload: {
      node_id: judgeNodeId,
      stage_index: judgeStageIdx,
      stage_label: 'Trọng tài',
      actor: { id: 'judge', name: 'Trọng tài', colorIndex: 3, enabled: true, kind: 'judge' },
      inputs: judgeInputs,
      summary_1line: `Tổng hợp ${upstreamForJudge.length} bản ${anonymize ? 'ẩn danh' : 'công khai'} → Chấm Rubric & rút ra 2 trục mâu thuẫn.`,
      content: `Trọng tài đã chấm bảng điểm Rubric cho ${upstreamForJudge.length} góc nhìn và khoanh vùng mâu thuẫn chính giữa chi phí đầu tư ban đầu và yêu cầu cách ly dữ liệu.`,
      transport: { lane_id: lanes[0], started_offset_s: judgeStartAt, elapsed_s: 7.4 },
    },
  });

  let finalUpstreamId = judgeNodeId;
  let finalStageIdx = judgeStageIdx + 1;
  let finalStart = Number((judgeEnd + 0.5).toFixed(1));

  // Extra Critic check stage in Council pattern
  if (pattern === 'council') {
    const criticNodeId = `stage${judgeStageIdx + 1}_critic`;
    const criticEnd = Number((finalStart + 5.8).toFixed(1));
    events.push({
      seq: seq++,
      event_type: 'node_started',
      run_id: runId,
      room_id: roomId,
      timestamp: ts(finalStart),
      payload: {
        node_id: criticNodeId,
        stage_index: judgeStageIdx + 1,
        stage_label: 'Phản biện cuối',
        actor: { id: 'final-critic', name: 'Người phản biện', colorIndex: 2, enabled: true, kind: 'critic' },
        inputs: [
          {
            from_node_id: judgeNodeId,
            kind: 'synthesis',
            chars: 1840,
            source_ids: ['S1', 'S2', 'S3', 'S4', 'S5'],
            summary: 'Bản tổng hợp ẩn danh + 2 mâu thuẫn để soi lỗ hổng trước khi trả về Bạn',
          },
        ],
        transport: { lane_id: lanes[1 % lanes.length], started_offset_s: finalStart, elapsed_s: 0 },
      },
    });
    events.push({
      seq: seq++,
      event_type: 'node_completed',
      run_id: runId,
      room_id: roomId,
      timestamp: ts(criticEnd),
      payload: {
        node_id: criticNodeId,
        stage_index: judgeStageIdx + 1,
        stage_label: 'Phản biện cuối',
        actor: { id: 'final-critic', name: 'Người phản biện', colorIndex: 2, enabled: true, kind: 'critic' },
        inputs: [
          {
            from_node_id: judgeNodeId,
            kind: 'synthesis',
            chars: 1840,
            source_ids: ['S1', 'S2', 'S3', 'S4', 'S5'],
          },
        ],
        summary_1line: 'Soi xong giả định yếu nhất & xác minh 100% trích dẫn [S1..S5] hợp lệ.',
        content: 'Xác minh đầy đủ trích dẫn và đề xuất bổ sung benchmark tiếng Việt chống prompt injection.',
        transport: { lane_id: lanes[1 % lanes.length], started_offset_s: finalStart, elapsed_s: 5.8 },
      },
    });
    finalUpstreamId = criticNodeId;
    finalStageIdx = judgeStageIdx + 2;
    finalStart = Number((criticEnd + 0.4).toFixed(1));
  }

  // Final Return to User stage
  events.push({
    seq: seq++,
    event_type: 'node_completed',
    run_id: runId,
    room_id: roomId,
    timestamp: ts(finalStart + 0.4),
    payload: {
      node_id: `stage${finalStageIdx}_output`,
      stage_index: finalStageIdx,
      stage_label: 'Trả về Bạn',
      actor: { id: 'output', name: 'Trả về Bạn', colorIndex: 1, enabled: true, kind: 'output' },
      inputs: [
        {
          from_node_id: finalUpstreamId,
          kind: 'synthesis',
          chars: 2240,
          source_ids: ['S1', 'S2', 'S3', 'S4', 'S5'],
          summary: 'Báo cáo tổng hợp sạch mắt đã kiểm chứng sẵn sàng đọc và xuất MD.',
        },
      ],
      summary_1line: 'Hoàn tất Báo cáo & Dàn ý sống — sẵn sàng đọc ở Phòng Chat.',
      content: 'Kết quả cuối cùng đã được đồng bộ về Phòng Chat (Giao diện 1).',
      transport: { lane_id: 'output', started_offset_s: finalStart, elapsed_s: 0.4 },
    },
  });

  return events;
}
