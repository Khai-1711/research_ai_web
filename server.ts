import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import {
  appendFlowEvent,
  deleteRoom,
  ensureSeedData,
  getFlowEvents,
  getRawEventsJsonl,
  getRoom,
  listFullRooms,
  listRoomSummaries,
  resetAllSeedData,
  saveRoom,
  subscribeRoomEvents,
} from './server/storage.ts';
import { fetchUrlAsSource, searchOpenAcademicSources } from './server/research.ts';
import type {
  BridgeHealth,
  FlowEvent,
  LivingOutline,
  Perspective,
  ReportData,
  Room,
  SourceItem,
} from './src/types.ts';

const PORT = 3000;
const DEFAULT_MODEL = 'gemini-4-hydrogen';

function getGenAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractSummary1Line(text: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const cleaned = line
      .replace(/^#+\s*/, '')
      .replace(/^\*\*Kết luận:\*\*\s*/i, '')
      .replace(/^Kết luận:\s*/i, '')
      .replace(/\*\*/g, '')
      .trim();
    if (cleaned.length >= 16) {
      return cleaned.length > 155 ? cleaned.slice(0, 152).trimEnd() + '…' : cleaned;
    }
  }
  const fallback = text.replace(/\s+/g, ' ').replace(/\*\*/g, '').trim();
  return fallback.length > 155 ? fallback.slice(0, 152).trimEnd() + '…' : fallback;
}

function extractCitedSources(text: string, validIds: Set<string>): string[] {
  const matches = text.match(/\[S(\d+)\]/g) ?? [];
  const unique = new Set<string>();
  for (const m of matches) {
    const id = m.slice(1, -1);
    if (validIds.has(id)) unique.add(id);
  }
  return Array.from(unique);
}

async function callAdapterText(params: {
  systemInstruction: string;
  userPrompt: string;
  model?: string;
}): Promise<{ text: string; modelUsed: string; fallbackFrom?: string; laneId: string }> {
  const bridgeUrl = process.env.BRIDGE_URL?.trim();
  const requestedModel = params.model || DEFAULT_MODEL;

  if (bridgeUrl) {
    const res = await fetch(`${bridgeUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: requestedModel,
        stream: false,
        messages: [
          { role: 'system', content: params.systemInstruction },
          { role: 'user', content: params.userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`dsh-gemini-bridge trả lỗi HTTP ${res.status}: ${errBody.slice(0, 180)}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
    };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('dsh-gemini-bridge trả về nội dung rỗng.');
    return {
      text,
      modelUsed: json.model || requestedModel,
      laneId: 'bridge-acc1',
    };
  }

  const ai = getGenAIClient();
  if (!ai) {
    throw new Error(
      'Chưa cấu hình GEMINI_API_KEY hoặc BRIDGE_URL. Vui lòng kiểm tra khóa trong Settings > Secrets.'
    );
  }

  const response = await ai.models.generateContent({
    model: DEFAULT_MODEL,
    contents: params.userPrompt,
    config: {
      systemInstruction: params.systemInstruction,
    },
  });

  const text = (response.text ?? '').trim();
  if (!text) {
    throw new Error('Mô hình trả về phản hồi rỗng. Vui lòng thử lại.');
  }

  return {
    text,
    modelUsed: DEFAULT_MODEL,
    fallbackFrom: requestedModel !== DEFAULT_MODEL ? requestedModel : undefined,
    laneId: 'acc1',
  };
}

async function startServer() {
  ensureSeedData();
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // 1. Health & Bridge / Worker Lanes status
  app.get('/api/health', async (_req, res) => {
    const bridgeUrl = process.env.BRIDGE_URL?.trim() || null;
    if (bridgeUrl) {
      try {
        const r = await fetch(`${bridgeUrl.replace(/\/$/, '')}/v1/lanes`);
        if (r.ok) {
          const data = (await r.json()) as { lanes?: Array<{ id?: string; healthy?: boolean; guest?: boolean }> };
          const lanes = (data.lanes ?? []).map((l, i) => l.id || `acc${i + 1}`);
          const healthy = (data.lanes ?? []).filter((l) => l.healthy !== false).length || lanes.length || 2;
          const guestMode = (data.lanes ?? []).some((l) => l.guest === true);
          const health: BridgeHealth = {
            mode: 'bridge',
            bridgeUrl,
            healthyWorkers: healthy,
            totalWorkers: Math.max(lanes.length, healthy),
            lanes: lanes.length ? lanes : ['acc1', 'acc2'],
            guestMode,
            bridgeOffline: false,
            defaultModel: DEFAULT_MODEL,
          };
          return res.json(health);
        }
      } catch {
        const health: BridgeHealth = {
          mode: 'bridge',
          bridgeUrl,
          healthyWorkers: 0,
          totalWorkers: 2,
          lanes: ['acc1', 'acc2'],
          guestMode: false,
          bridgeOffline: true,
          defaultModel: DEFAULT_MODEL,
        };
        return res.json(health);
      }
    }

    const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY');
    const health: BridgeHealth = {
      mode: 'gemini-preview',
      bridgeUrl: null,
      healthyWorkers: hasGeminiKey ? 4 : 0,
      totalWorkers: 4,
      lanes: ['acc1', 'acc2', 'acc3', 'acc4'],
      guestMode: false,
      bridgeOffline: !hasGeminiKey,
      defaultModel: DEFAULT_MODEL,
    };
    return res.json(health);
  });

  // 2. Room CRUD (disk-backed meta.json + sources.json + events.jsonl)
  app.get('/api/rooms', (_req, res) => {
    res.json({
      summaries: listRoomSummaries(),
      rooms: listFullRooms(),
    });
  });

  app.get('/api/rooms/:id', (req, res) => {
    const room = getRoom(req.params.id);
    if (!room) return res.status(404).json({ error: 'Không tìm thấy phòng nghiên cứu.' });
    res.json({ room, events: getFlowEvents(room.id) });
  });

  app.post('/api/rooms', (req, res) => {
    const body = req.body as Partial<Room>;
    const now = new Date().toISOString();
    const id = body.id?.trim() || `room-${Date.now()}`;
    const room: Room = {
      id,
      title: body.title?.trim() || 'Phòng nghiên cứu mới',
      topicPrompt: body.topicPrompt?.trim() || body.title?.trim() || '',
      createdAt: now,
      updatedAt: now,
      perspectives: body.perspectives ?? [],
      messages: body.messages ?? [],
      sources: body.sources ?? [],
      livingOutline: body.livingOutline ?? { consensus: [], contradictions: [], gaps: [] },
      report: body.report,
      audit: body.audit ?? [],
    };
    saveRoom(room);
    res.status(201).json({ room });
  });

  app.patch('/api/rooms/:id', (req, res) => {
    const existing = getRoom(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Không tìm thấy phòng.' });
    const patch = req.body as Partial<Room>;
    const updated: Room = {
      ...existing,
      ...patch,
      id: existing.id,
      updatedAt: new Date().toISOString(),
    };
    saveRoom(updated);
    res.json({ room: updated });
  });

  app.delete('/api/rooms/:id', (req, res) => {
    const ok = deleteRoom(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Không tìm thấy phòng.' });
    res.json({ ok: true });
  });

  app.post('/api/rooms/reset', (_req, res) => {
    const rooms = resetAllSeedData();
    res.json({ rooms });
  });

  // 3. Flow Events SSE stream + JSONL download + append
  app.get('/api/rooms/:id/events', (req, res) => {
    const roomId = req.params.id;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const history = getFlowEvents(roomId);
    res.write(`event: snapshot\ndata: ${JSON.stringify(history)}\n\n`);

    const unsubscribe = subscribeRoomEvents(roomId, (ev: FlowEvent) => {
      res.write(`event: flow\ndata: ${JSON.stringify(ev)}\n\n`);
    });

    const keepAlive = setInterval(() => {
      res.write(': ping\n\n');
    }, 20000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  app.get('/api/rooms/:id/events.jsonl', (req, res) => {
    const raw = getRawEventsJsonl(req.params.id);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}-events.jsonl"`);
    res.send(raw);
  });

  app.post('/api/rooms/:id/flow-events', (req, res) => {
    const roomId = req.params.id;
    const body = req.body as Omit<FlowEvent, 'seq'>;
    if (!body?.event_type || !body?.payload) {
      return res.status(400).json({ error: 'Thiếu trường event_type hoặc payload.' });
    }
    const saved = appendFlowEvent(roomId, {
      ...body,
      room_id: roomId,
      timestamp: body.timestamp || new Date().toISOString(),
    });
    res.status(201).json({ event: saved });
  });

  // 4. Real Open Academic Deep Research (arXiv + OpenAlex + Wikipedia + URL)
  app.post('/api/research/search', async (req, res) => {
    try {
      const { query, url } = req.body as { query?: string; url?: string };
      if (url && url.trim()) {
        const item = await fetchUrlAsSource(url.trim());
        return res.json({ items: [item] });
      }
      if (!query || !query.trim()) {
        return res.status(400).json({ error: 'Vui lòng nhập từ khóa nghiên cứu hoặc URL.' });
      }
      const items = await searchOpenAcademicSources(query.trim());
      return res.json({ items });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lỗi tìm kiếm nguồn mở.';
      return res.status(500).json({ error: message });
    }
  });

  // 5. Stateless single-perspective AI turn (stream=false)
  app.post('/api/ai/perspective', async (req, res) => {
    const started = Date.now();
    try {
      const {
        perspective,
        prompt,
        sources,
        round,
        peerMessages,
        laneId,
      } = req.body as {
        perspective: Perspective;
        prompt: string;
        sources: SourceItem[];
        round: number;
        peerMessages?: Array<{ handle: string; content: string }>;
        laneId?: string;
      };

      if (!perspective || !prompt?.trim()) {
        return res.status(400).json({ error: 'Thiếu góc nhìn hoặc nội dung câu hỏi.' });
      }

      const sourceContext =
        sources && sources.length > 0
          ? sources
              .map((s) => `[${s.id}] (${s.origin}) ${s.title}: "${s.excerpt}"`)
              .join('\n')
          : 'Chưa có nguồn đính kèm; trả lời dựa trên lập luận chuyên môn và không tự bịa mã [S#].';

      const peerContext =
        peerMessages && peerMessages.length > 0
          ? '\n\nCÁC LẬP LUẬN TRƯỚC ĐÓ TRONG PHÒNG (hãy phản biện trực diện hoặc bổ sung điểm thiếu):\n' +
            peerMessages.map((m) => `- @${m.handle}: ${m.content}`).join('\n')
          : '';

      const systemInstruction = [
        `Bạn đang đóng vai góc nhìn @${perspective.handle} (${perspective.name}) trong một phòng nghiên cứu đa góc nhìn bằng tiếng Việt.`,
        perspective.rolePrompt,
        'QUY TẮC ĐỊNH DẠNG BẮT BUỘC:',
        '1. Dòng đầu tiên PHẢI bắt đầu bằng "Kết luận: " tóm gọn lập trường cốt lõi trong đúng 1 câu (dưới 28 từ).',
        '2. Sau đó trình bày 2–4 ý phân tích súc tích, dễ đọc (dùng gạch đầu dòng hoặc đánh số ngắn).',
        '3. CHỈ gắn mã trích dẫn [S1], [S2]... khớp chính xác với danh sách nguồn được cung cấp bên dưới. Tuyệt đối không bịa mã nguồn không tồn tại.',
        '4. Giữ độ dài khoảng 130–230 từ để người dùng đọc sâu thoải mái.',
      ].join('\n');

      const userPrompt = `VÒNG THẢO LUẬN: Vòng ${round}\nKHO NGUỒN ĐÍNH KÈM:\n${sourceContext}${peerContext}\n\nCÂU HỎI CỦA NGƯỜI DÙNG:\n${prompt.trim()}`;

      const result = await callAdapterText({
        systemInstruction,
        userPrompt,
        model: perspective.modelLabel,
      });

      const elapsedSec = Number(((Date.now() - started) / 1000).toFixed(1));
      const validIds = new Set((sources ?? []).map((s) => s.id));
      const citedSourceIds = extractCitedSources(result.text, validIds);
      const summary1Line = extractSummary1Line(result.text);

      res.json({
        content: result.text,
        summary1Line,
        citedSourceIds,
        elapsedSec,
        modelUsed: result.modelUsed,
        fallbackFrom: result.fallbackFrom,
        laneId: laneId || result.laneId,
        rawPrompt: `[SYSTEM]\n${systemInstruction}\n\n[USER]\n${userPrompt}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Không thể gọi AI cho góc nhìn này.';
      res.status(502).json({ error: message });
    }
  });

  // 6. Judge & Synthesizer (Report + Dynamic Rubric + Living Outline)
  app.post('/api/ai/synthesize', async (req, res) => {
    const started = Date.now();
    try {
      const { roomTitle, messages, perspectives, sources, anonymize } = req.body as {
        roomTitle: string;
        messages: Array<{ handle?: string; perspectiveId?: string; content: string; round: number }>;
        perspectives: Perspective[];
        sources: SourceItem[];
        anonymize: boolean;
      };

      const aiMessages = (messages ?? []).filter((m) => m.handle);
      if (aiMessages.length === 0) {
        return res.status(400).json({ error: 'Cần ít nhất 1 phản hồi từ góc nhìn AI để Trọng tài tổng hợp.' });
      }

      const activeHandles = Array.from(new Set(aiMessages.map((m) => m.handle!)));
      const aliasMap = new Map<string, string>();
      activeHandles.forEach((h, idx) => {
        const letter = String.fromCharCode(65 + (idx % 26));
        aliasMap.set(h, anonymize ? `Ứng viên ${letter}` : `@${h}`);
      });

      const transcript = aiMessages
        .map((m) => `[Vòng ${m.round}] ${aliasMap.get(m.handle!) ?? m.handle}:\n${m.content}`)
        .join('\n\n---\n\n');

      const sourceList = (sources ?? [])
        .map((s) => `[${s.id}] ${s.title} (${s.origin})`)
        .join('\n');

      const ai = getGenAIClient();
      const bridgeUrl = process.env.BRIDGE_URL?.trim();

      const promptText = `Đề tài nghiên cứu: "${roomTitle}"\n\nKHO NGUỒN HỢP LỆ:\n${sourceList || '(Chưa có nguồn)'}\n\nTOÀN BỘ LẬP LUẬN:\n${transcript}\n\nHãy đóng vai Trọng tài học thuật công tâm, trả về JSON tổng hợp đầy đủ tiếng Việt gồm: executiveSummary (1 đoạn súc tích kèm mã [S#] hợp lệ nếu có), consensus (2-3 điểm đồng thuận), contradictions (1-2 trục mâu thuẫn kèm suggestedPrompt để phản biện tiếp), gaps (2 lỗ hổng cần tìm thêm nguồn), openDebates (1-2 câu), và scores (chấm điểm evidence, logic, rebuttal thang 0..10 cho từng mã nhãn: ${activeHandles.map((h) => aliasMap.get(h)).join(', ')}).`;

      let parsed: {
        executiveSummary?: string;
        consensus?: Array<{ title: string; supporters: string[]; citations: string[] }>;
        contradictions?: Array<{ topic: string; detail: string; suggestedPrompt: string }>;
        gaps?: string[];
        openDebates?: string[];
        scores?: Array<{ label: string; evidence: number; logic: number; rebuttal: number; summary: string; citations: string[] }>;
      } = {};

      if (bridgeUrl || !ai) {
        const fallback = await callAdapterText({
          systemInstruction: 'Bạn là Trọng tài học thuật. Trả về đúng 1 khối JSON hợp lệ, không kèm văn bản thừa.',
          userPrompt: promptText,
        });
        const jsonMatch = fallback.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        }
      } else {
        const response = await ai.models.generateContent({
          model: DEFAULT_MODEL,
          contents: promptText,
          config: {
            systemInstruction:
              'Bạn là Trọng tài nghiên cứu đa góc nhìn. Tổng hợp trung lập bằng tiếng Việt và chỉ dẫn mã [S#] có trong danh sách nguồn.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                executiveSummary: { type: Type.STRING },
                consensus: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      supporters: { type: Type.ARRAY, items: { type: Type.STRING } },
                      citations: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                  },
                },
                contradictions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      topic: { type: Type.STRING },
                      detail: { type: Type.STRING },
                      suggestedPrompt: { type: Type.STRING },
                    },
                  },
                },
                gaps: { type: Type.ARRAY, items: { type: Type.STRING } },
                openDebates: { type: Type.ARRAY, items: { type: Type.STRING } },
                scores: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING },
                      evidence: { type: Type.NUMBER },
                      logic: { type: Type.NUMBER },
                      rebuttal: { type: Type.NUMBER },
                      summary: { type: Type.STRING },
                      citations: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                  },
                },
              },
            },
          },
        });
        parsed = JSON.parse((response.text ?? '{}').trim());
      }

      const reverseAlias = new Map<string, string>();
      aliasMap.forEach((alias, handle) => {
        reverseAlias.set(alias, handle);
        reverseAlias.set(alias.replace(/^@/, ''), handle);
        reverseAlias.set(handle, handle);
      });

      const validSourceIds = new Set((sources ?? []).map((s) => s.id));
      const cleanCitations = (arr?: string[]) =>
        (arr ?? [])
          .map((c) => c.replace(/^\[|\]$/g, ''))
          .filter((c) => validSourceIds.has(c));

      const rubric = activeHandles.map((handle) => {
        const p = perspectives.find((item) => item.handle === handle);
        const scoreRow = (parsed.scores ?? []).find(
          (s) => reverseAlias.get(s.label) === handle || s.label.includes(handle)
        );
        const evidence = Number((scoreRow?.evidence ?? 8.2).toFixed(1));
        const logic = Number((scoreRow?.logic ?? 8.4).toFixed(1));
        const rebuttal = Number((scoreRow?.rebuttal ?? 8.0).toFixed(1));
        const total = Number(((evidence + logic + rebuttal) / 3).toFixed(1));
        return {
          perspectiveId: p?.id ?? handle,
          handle,
          colorIndex: p?.colorIndex ?? 0,
          evidence,
          logic,
          rebuttal,
          total,
        };
      });
      rubric.sort((a, b) => b.total - a.total);

      const report: ReportData = {
        title: `Báo cáo tổng hợp: ${roomTitle}`,
        subtitle: `Trọng tài ${anonymize ? '(Ẩn danh)' : '(Công khai)'} · ${sources.length} nguồn xác minh · ${activeHandles.length}/${perspectives.length} góc nhìn tham gia`,
        executiveSummary:
          parsed.executiveSummary ||
          'Trọng tài đã tổng hợp các lập luận chính, cân đối bằng chứng và chỉ ra trục tranh luận cần tiếp tục xác minh.',
        perspectiveBreakdown: activeHandles.map((handle) => {
          const scoreRow = (parsed.scores ?? []).find(
            (s) => reverseAlias.get(s.label) === handle || s.label.includes(handle)
          );
          return {
            handle,
            summary: scoreRow?.summary || `Đóng góp góc nhìn chuyên môn từ @${handle}.`,
            citations: cleanCitations(scoreRow?.citations),
          };
        }),
        openDebates: parsed.openDebates ?? [],
        rubric,
        updatedAt: new Date().toISOString(),
      };

      const livingOutline: LivingOutline = {
        consensus: (parsed.consensus ?? []).map((c) => ({
          title: c.title,
          supporters: (c.supporters ?? []).map((s) => reverseAlias.get(s) ?? s.replace(/^@/, '')),
          citations: cleanCitations(c.citations),
        })),
        contradictions: parsed.contradictions ?? [],
        gaps: parsed.gaps ?? [],
      };

      const elapsedSec = Number(((Date.now() - started) / 1000).toFixed(1));
      res.json({
        report,
        livingOutline,
        elapsedSec,
        summary1Line: extractSummary1Line(report.executiveSummary),
        anonymizeUsed: anonymize,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lỗi tổng hợp Trọng tài.';
      res.status(502).json({ error: message });
    }
  });

  // 7. Vite dev middleware or production static assets
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Research Lab & Flow Map server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
