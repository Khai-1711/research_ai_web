import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Moon,
  PanelLeft,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import type {
  AppSettings,
  BridgeHealth,
  ChatMessage,
  LabViewTab,
  Perspective,
  PerspectivePreset,
  Room,
  SourceItem,
  ThemeMode,
} from '../types.ts';
import {
  createRoomApi,
  deleteRoomApi,
  emitFlowEventApi,
  fetchHealth,
  fetchRooms,
  patchRoomApi,
  resetSeedRoomsApi,
  runPerspectiveApi,
  runSynthesizeApi,
  searchResearchApi,
} from '../utils/api.ts';
import {
  loadPanelPrefs,
  loadPresets,
  loadSettings,
  savePanelPrefs,
  savePresets,
  saveSettings,
} from '../utils/themeAndExport.ts';
import { LeftDrawer } from './LeftDrawer.tsx';
import { RightDrawer } from './RightDrawer.tsx';
import { SettingsDrawer } from './SettingsDrawer.tsx';
import { ActiveLaneJob, GroupFeed } from './GroupFeed.tsx';
import { Composer } from './Composer.tsx';
import { AuditView, CompareView, ReportView } from './SecondaryViews.tsx';

interface ResearchLabAppProps {
  theme: ThemeMode;
  onToggleTheme: () => void;
  onSwitchToFlowMap: (roomId: string) => void;
  initialRoomId?: string;
}

export function ResearchLabApp({
  theme,
  onToggleTheme,
  onSwitchToFlowMap,
  initialRoomId,
}: ResearchLabAppProps) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string>(initialRoomId || 'room-rag-ft');
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [viewTab, setViewTab] = useState<LabViewTab>('chat');
  const [compareIds, setCompareIds] = useState<string[]>([]);

  const initialPanels = loadPanelPrefs();
  const [leftOpen, setLeftOpen] = useState<boolean>(initialPanels.leftOpen);
  const [leftDefaultTab, setLeftDefaultTab] = useState<'rooms' | 'roster'>('rooms');
  const [rightOpen, setRightOpen] = useState<boolean>(initialPanels.rightOpen);
  const [rightTab, setRightTab] = useState<'sources' | 'outline'>('sources');
  const [highlightedSourceId, setHighlightedSourceId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [presets, setPresets] = useState<PerspectivePreset[]>(loadPresets);
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [composerText, setComposerText] = useState('');

  const [activeJobs, setActiveJobs] = useState<ActiveLaneJob[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const abortRef = useRef<AbortController | null>(null);

  const activeRoom = rooms.find((r) => r.id === activeRoomId) || rooms[0] || null;

  // Load rooms and health from disk-backed Express API
  useEffect(() => {
    let alive = true;
    Promise.all([fetchRooms(), fetchHealth()])
      .then(([roomsRes, healthRes]) => {
        if (!alive) return;
        setRooms(roomsRes.rooms);
        if (initialRoomId && roomsRes.rooms.some((r) => r.id === initialRoomId)) {
          setActiveRoomId(initialRoomId);
        } else if (roomsRes.rooms.some((r) => r.id === 'room-rag-ft')) {
          setActiveRoomId('room-rag-ft');
        } else if (roomsRes.rooms[0]) {
          setActiveRoomId(roomsRes.rooms[0].id);
        }
        setHealth(healthRes);
      })
      .catch((err) => {
        if (!alive) return;
        setErrorBanner(err instanceof Error ? err.message : 'Không tải được dữ liệu phòng.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [initialRoomId]);

  // Save lightweight UI preferences only
  useEffect(() => {
    savePanelPrefs({ leftOpen, rightOpen });
  }, [leftOpen, rightOpen]);

  // Keyboard shortcuts [ and ] to toggle side panels for effortless focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      if (inInput) return;
      if (e.key === '[') {
        setLeftOpen((v) => !v);
      } else if (e.key === ']') {
        setRightOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Tick timer every 150ms while jobs are running
  useEffect(() => {
    if (!isBusy) return;
    const id = setInterval(() => setNowMs(Date.now()), 150);
    return () => clearInterval(id);
  }, [isBusy]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const persistRoom = useCallback(async (updated: Room) => {
    setRooms((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    try {
      await patchRoomApi(updated.id, updated);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Không lưu được thay đổi phòng.');
    }
  }, []);

  const handleSelectRoom = (roomId: string) => {
    setActiveRoomId(roomId);
    setViewTab('chat');
    setHighlightedSourceId(null);
    if (window.innerWidth < 1100) {
      setLeftOpen(false);
    }
  };

  const handleCreateRoomFromPreset = async (preset: PerspectivePreset, customTitle?: string) => {
    try {
      const perspectives: Perspective[] = preset.perspectives.map((p, idx) => ({
        ...p,
        id: `p-${Date.now()}-${idx}`,
      }));
      const res = await createRoomApi({
        title: customTitle || `Phòng mới · ${preset.name.split('·')[1]?.trim() || preset.name}`,
        topicPrompt: '',
        perspectives,
        messages: [],
        sources: [],
        livingOutline: { consensus: [], contradictions: [], gaps: [] },
        audit: [],
      });
      setRooms((prev) => [res.room, ...prev]);
      setActiveRoomId(res.room.id);
      setViewTab('chat');
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Không tạo được phòng mới.');
    }
  };

  const handleDeleteRoom = async (roomId: string) => {
    try {
      await deleteRoomApi(roomId);
      setRooms((prev) => {
        const next = prev.filter((r) => r.id !== roomId);
        if (activeRoomId === roomId && next[0]) {
          setActiveRoomId(next[0].id);
        }
        return next;
      });
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Không xóa được phòng.');
    }
  };

  const handleTogglePerspective = (perspectiveId: string) => {
    if (!activeRoom) return;
    const updated: Room = {
      ...activeRoom,
      perspectives: activeRoom.perspectives.map((p) =>
        p.id === perspectiveId ? { ...p, enabled: !p.enabled } : p
      ),
    };
    persistRoom(updated);
  };

  const handleToggleTagGroup = (tag: string) => {
    if (!activeRoom) return;
    const members = activeRoom.perspectives.filter((p) => p.tags.includes(tag));
    const allOn = members.length > 0 && members.every((m) => m.enabled);
    const updated: Room = {
      ...activeRoom,
      perspectives: activeRoom.perspectives.map((p) =>
        p.tags.includes(tag) ? { ...p, enabled: !allOn } : p
      ),
    };
    persistRoom(updated);
  };

  const handleAddPerspective = (p: Omit<Perspective, 'id'>) => {
    if (!activeRoom) return;
    const nextRole: Perspective = { ...p, id: `p-${Date.now()}` };
    persistRoom({
      ...activeRoom,
      perspectives: [...activeRoom.perspectives, nextRole],
    });
  };

  const handleSavePreset = (name: string) => {
    if (!activeRoom) return;
    const newPreset: PerspectivePreset = {
      id: `preset-${Date.now()}`,
      name,
      description: `Lưu từ phòng (${activeRoom.perspectives.length} góc nhìn)`,
      perspectives: activeRoom.perspectives.map(({ id: _id, ...rest }) => rest),
    };
    const next = [...presets, newPreset];
    setPresets(next);
    savePresets(next);
  };

  const handleCitationClick = (sourceId: string) => {
    setRightTab('sources');
    setRightOpen(true);
    setHighlightedSourceId(sourceId);
    if (window.innerWidth < 1280) {
      setLeftOpen(false);
    }
  };

  const handleStopRunning = () => {
    abortRef.current?.abort();
    if (activeRoom) {
      emitFlowEventApi(activeRoom.id, {
        event_type: 'run_aborted',
        run_id: `abort-${Date.now()}`,
        payload: {
          node_id: 'run_aborted',
          stage_index: 1,
          stage_label: 'Đã dừng',
          actor: { id: 'system', name: 'Người dùng dừng', colorIndex: 4, enabled: true, kind: 'output' },
          inputs: [],
          summary_1line: 'Người dùng đã chủ động dừng lượt chạy giữa chừng.',
        },
      }).catch(() => {});
    }
  };

  // Core Batch Runner (respects maxConcurrency + emits real 5-lifecycle FlowEvents via SSE!)
  const runPerspectivesBatch = async (params: {
    roomSnapshot: Room;
    prompt: string;
    targets: Perspective[];
    round: number;
    roundLabel: string;
    peerMessages?: Array<{ handle: string; content: string }>;
    pattern: 'direct' | 'council' | 'debate' | 'research';
    includeUserMessage?: boolean;
  }): Promise<Room> => {
    const {
      roomSnapshot,
      prompt,
      targets,
      round,
      roundLabel,
      peerMessages,
      pattern,
      includeUserMessage = true,
    } = params;

    setErrorBanner(null);
    setIsBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const runId = `run-${Date.now()}`;
    const runStartMs = Date.now();
    const lanes = health?.lanes?.length ? health.lanes : ['acc1', 'acc2', 'acc3', 'acc4'];

    let workingRoom: Room = {
      ...roomSnapshot,
      title:
        roomSnapshot.messages.length === 0 && roomSnapshot.title.startsWith('Phòng mới')
          ? prompt.slice(0, 72)
          : roomSnapshot.title,
      messages: includeUserMessage
        ? [
            ...roomSnapshot.messages,
            {
              id: `m-u-${Date.now()}`,
              round,
              roundLabel,
              senderType: 'user',
              content: prompt,
              citedSourceIds: [],
              createdAt: new Date().toISOString(),
            },
          ]
        : [...roomSnapshot.messages],
    };
    await persistRoom(workingRoom);

    // Emit run_started to events.jsonl & SSE so Flow Map shows both enabled & disabled AIs immediately
    await emitFlowEventApi(workingRoom.id, {
      event_type: 'run_started',
      run_id: runId,
      payload: {
        node_id: `stage0_user_${runId}`,
        stage_index: 0,
        stage_label: 'Đầu vào',
        pattern,
        actor: { id: 'user', name: 'Bạn (Prompt)', colorIndex: 0, enabled: true, kind: 'user' },
        inputs: [],
        summary_1line: `"${prompt.slice(0, 75)}" · Gửi tới ${targets.length}/${workingRoom.perspectives.length} AI`,
        content: prompt,
        participants: workingRoom.perspectives.map((p) => ({
          id: p.id,
          name: p.name,
          handle: p.handle,
          colorIndex: p.colorIndex,
          enabled: targets.some((t) => t.id === p.id),
          tags: p.tags,
          kind: 'ai',
        })),
        transport: { lane_id: 'input', started_offset_s: 0, elapsed_s: 0.3 },
      },
    }).catch(() => {});

    const initialJobs: ActiveLaneJob[] = targets.map((t, idx) => ({
      perspectiveId: t.id,
      handle: t.handle,
      colorIndex: t.colorIndex,
      laneId: lanes[idx % lanes.length],
      startedAtMs: Date.now(),
      status: 'queued',
      roundLabel,
    }));
    setActiveJobs(initialJobs);

    const queue = [...targets];
    const completedNodeIds: string[] = [];
    let workerCursor = 0;

    const worker = async () => {
      while (queue.length > 0 && !controller.signal.aborted) {
        const p = queue.shift();
        if (!p) break;
        const laneId = lanes[workerCursor % lanes.length];
        workerCursor++;
        const nodeId = `stage1_${p.id}_${runId}`;
        const jobStartMs = Date.now();
        const startedOffsetS = Number(((jobStartMs - runStartMs) / 1000).toFixed(1));

        setActiveJobs((prev) =>
          prev.map((j) =>
            j.perspectiveId === p.id
              ? { ...j, status: 'running', laneId, startedAtMs: jobStartMs }
              : j
          )
        );

        await emitFlowEventApi(workingRoom.id, {
          event_type: 'node_started',
          run_id: runId,
          payload: {
            node_id: nodeId,
            stage_index: 1,
            stage_label: roundLabel,
            actor: {
              id: p.id,
              name: p.name,
              handle: p.handle,
              colorIndex: p.colorIndex,
              enabled: true,
              tags: p.tags,
              kind: 'ai',
            },
            inputs: [
              {
                from_node_id: `stage0_user_${runId}`,
                kind: 'prompt',
                chars: prompt.length,
                summary: `Câu hỏi gửi tới @${p.handle}`,
                source_ids: workingRoom.sources.map((s) => s.id),
              },
            ],
            transport: { lane_id: laneId, started_offset_s: startedOffsetS, elapsed_s: 0 },
          },
        }).catch(() => {});

        try {
          const result = await runPerspectiveApi(
            {
              perspective: p,
              prompt,
              sources: workingRoom.sources,
              round,
              peerMessages,
              laneId,
            },
            controller.signal
          );

          const aiMsg: ChatMessage = {
            id: `m-ai-${p.id}-${Date.now()}`,
            round,
            roundLabel,
            senderType: 'ai',
            perspectiveId: p.id,
            handle: p.handle,
            colorIndex: p.colorIndex,
            modelLabel: result.modelUsed,
            laneId: result.laneId,
            elapsedSec: result.elapsedSec,
            summary1Line: result.summary1Line,
            content: result.content,
            citedSourceIds: result.citedSourceIds,
            fallbackFrom: result.fallbackFrom,
            createdAt: new Date().toISOString(),
          };

          const auditItem = {
            id: `aud-${p.id}-${Date.now()}`,
            round,
            handle: p.handle,
            modelRequested: p.modelLabel,
            modelUsed: result.modelUsed,
            laneId: result.laneId,
            elapsedSec: result.elapsedSec,
            fallbackWarning: result.fallbackFrom
              ? `@${p.handle} yêu cầu ${result.fallbackFrom} → dùng ${result.modelUsed}.`
              : undefined,
            rawPrompt: result.rawPrompt,
            sourceIdsSeen: result.citedSourceIds,
            timestamp: new Date().toISOString(),
          };

          workingRoom = {
            ...workingRoom,
            messages: [...workingRoom.messages, aiMsg],
            audit: [auditItem, ...workingRoom.audit],
          };
          await persistRoom(workingRoom);

          completedNodeIds.push(nodeId);
          await emitFlowEventApi(workingRoom.id, {
            event_type: 'node_completed',
            run_id: runId,
            payload: {
              node_id: nodeId,
              stage_index: 1,
              stage_label: roundLabel,
              actor: {
                id: p.id,
                name: p.name,
                handle: p.handle,
                colorIndex: p.colorIndex,
                enabled: true,
                tags: p.tags,
                kind: 'ai',
              },
              inputs: [
                {
                  from_node_id: `stage0_user_${runId}`,
                  kind: 'prompt',
                  chars: prompt.length,
                  source_ids: result.citedSourceIds,
                },
              ],
              summary_1line: result.summary1Line,
              content: result.content,
              transport: {
                lane_id: result.laneId,
                started_offset_s: startedOffsetS,
                elapsed_s: result.elapsedSec,
                fallback_from: result.fallbackFrom,
              },
            },
          }).catch(() => {});

          setActiveJobs((prev) =>
            prev.map((j) => (j.perspectiveId === p.id ? { ...j, status: 'done' } : j))
          );
        } catch (err) {
          if (controller.signal.aborted) break;
          const msg = err instanceof Error ? err.message : 'Lỗi gọi góc nhìn AI.';
          setErrorBanner(`@${p.handle}: ${msg}`);
          setActiveJobs((prev) =>
            prev.map((j) => (j.perspectiveId === p.id ? { ...j, status: 'error' } : j))
          );
          await emitFlowEventApi(workingRoom.id, {
            event_type: 'node_failed',
            run_id: runId,
            payload: {
              node_id: nodeId,
              stage_index: 1,
              stage_label: roundLabel,
              actor: {
                id: p.id,
                name: p.name,
                handle: p.handle,
                colorIndex: p.colorIndex,
                enabled: true,
                kind: 'ai',
              },
              inputs: [{ from_node_id: `stage0_user_${runId}`, kind: 'prompt', chars: prompt.length }],
              error_message: msg,
              transport: { lane_id: laneId, started_offset_s: startedOffsetS, elapsed_s: 0.5 },
            },
          }).catch(() => {});
        }
      }
    };

    const concurrency = Math.max(1, Math.min(settings.maxConcurrency, targets.length));
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    if (completedNodeIds.length > 0 && !controller.signal.aborted) {
      await emitFlowEventApi(workingRoom.id, {
        event_type: 'node_completed',
        run_id: runId,
        payload: {
          node_id: `stage2_output_${runId}`,
          stage_index: 2,
          stage_label: 'Trả về Bạn',
          actor: { id: 'output', name: 'Kết quả trả Bạn', colorIndex: 1, enabled: true, kind: 'output' },
          inputs: completedNodeIds.map((nid) => ({
            from_node_id: nid,
            kind: 'turn',
            chars: 640,
          })),
          summary_1line: `Đã hoàn tất ${completedNodeIds.length}/${targets.length} góc nhìn cho ${roundLabel}.`,
          content: 'Toàn bộ câu trả lời đã sẵn sàng đọc ở Giao diện 1.',
          transport: {
            lane_id: 'output',
            started_offset_s: Number(((Date.now() - runStartMs) / 1000).toFixed(1)),
            elapsed_s: 0.3,
          },
        },
      }).catch(() => {});
    }

    setIsBusy(false);
    setActiveJobs([]);
    abortRef.current = null;
    return workingRoom;
  };

  const handleSend = async (prompt: string, targets: Perspective[]) => {
    if (!activeRoom) return;
    setComposerText('');
    const nextRound =
      activeRoom.messages.length === 0
        ? 0
        : Math.max(...activeRoom.messages.map((m) => m.round)) + 1;

    await runPerspectivesBatch({
      roomSnapshot: activeRoom,
      prompt,
      targets,
      round: nextRound,
      roundLabel:
        nextRound === 0
          ? `Vòng 0 · Trả lời độc lập (${targets.length})`
          : `Vòng ${nextRound} · Thảo luận tiếp (${targets.length})`,
      pattern: targets.length >= 4 ? 'council' : 'direct',
    });
  };

  const handleAutoDebate = async () => {
    if (!activeRoom || isBusy) return;
    const targets = activeRoom.perspectives.filter((p) => p.enabled);
    if (targets.length === 0) return;

    const latestRound =
      activeRoom.messages.length > 0 ? Math.max(...activeRoom.messages.map((m) => m.round)) : 0;
    const peerMessages = activeRoom.messages
      .filter((m) => m.senderType === 'ai' && m.round === latestRound && m.handle)
      .map((m) => ({ handle: m.handle!, content: m.content }));

    const nextRound = latestRound + 1;
    await runPerspectivesBatch({
      roomSnapshot: activeRoom,
      prompt: `Phản biện chéo các lập luận ở Vòng ${latestRound} về chủ đề "${activeRoom.title}". Nêu rõ điểm đồng ý, điểm phản bác và đề xuất điều chỉnh cụ thể.`,
      targets,
      round: nextRound,
      roundLabel: `Vòng ${nextRound} · Phản biện chéo (${targets.length})`,
      peerMessages,
      pattern: 'debate',
      includeUserMessage: false,
    });
  };

  const handleRunJudge = async () => {
    if (!activeRoom || isBusy) return;
    setErrorBanner(null);
    setIsBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const runId = `judge-${Date.now()}`;

    try {
      const res = await runSynthesizeApi(
        {
          roomTitle: activeRoom.title,
          messages: activeRoom.messages
            .filter((m) => m.senderType === 'ai')
            .map((m) => ({
              handle: m.handle,
              perspectiveId: m.perspectiveId,
              content: m.content,
              round: m.round,
            })),
          perspectives: activeRoom.perspectives,
          sources: activeRoom.sources,
          anonymize: settings.anonymizeJudge,
        },
        controller.signal
      );

      const nextRound =
        activeRoom.messages.length > 0 ? Math.max(...activeRoom.messages.map((m) => m.round)) : 0;

      const judgeMsg: ChatMessage = {
        id: `m-judge-${Date.now()}`,
        round: nextRound,
        roundLabel: `Vòng ${nextRound} · Tổng hợp Trọng tài`,
        senderType: 'judge',
        elapsedSec: res.elapsedSec,
        summary1Line: res.summary1Line,
        content: res.report.executiveSummary,
        citedSourceIds: [],
        createdAt: new Date().toISOString(),
      };

      const updated: Room = {
        ...activeRoom,
        report: res.report,
        livingOutline: res.livingOutline,
        messages: [...activeRoom.messages, judgeMsg],
      };
      await persistRoom(updated);
      setRightTab('outline');
      setRightOpen(true);

      await emitFlowEventApi(activeRoom.id, {
        event_type: 'node_completed',
        run_id: runId,
        payload: {
          node_id: `stage2_judge_${runId}`,
          stage_index: 2,
          stage_label: 'Trọng tài',
          actor: { id: 'judge', name: 'Trọng tài', colorIndex: 3, enabled: true, kind: 'judge' },
          inputs: res.report.rubric.map((r, i) => ({
            from_node_id: `stage1_${r.perspectiveId}`,
            kind: 'turn',
            anonymized_as: settings.anonymizeJudge
              ? `Ứng viên ${String.fromCharCode(65 + i)}`
              : undefined,
            chars: 720,
          })),
          summary_1line: res.summary1Line,
          content: res.report.executiveSummary,
          transport: { lane_id: 'acc2', started_offset_s: 1.0, elapsed_s: res.elapsedSec },
        },
      }).catch(() => {});
    } catch (err) {
      if (!controller.signal.aborted) {
        setErrorBanner(err instanceof Error ? err.message : 'Lỗi chạy Trọng tài.');
      }
    } finally {
      setIsBusy(false);
      abortRef.current = null;
    }
  };

  const handleRunDeepResearch = async (query: string) => {
    if (!activeRoom || isBusy) return;
    setErrorBanner(null);
    setIsBusy(true);
    try {
      const searchRes = await searchResearchApi({ query });
      const existingCount = activeRoom.sources.length;
      const newSources: SourceItem[] = searchRes.items.map((item, idx) => ({
        ...item,
        id: `S${existingCount + idx + 1}`,
      }));

      const updatedRoom: Room = {
        ...activeRoom,
        sources: [...activeRoom.sources, ...newSources],
      };
      await persistRoom(updatedRoom);
      setRightTab('sources');
      setRightOpen(true);
      if (newSources[0]) setHighlightedSourceId(newSources[0].id);

      setIsBusy(false);
      const targets = updatedRoom.perspectives.filter((p) => p.enabled);
      if (targets.length > 0) {
        const nextRound =
          updatedRoom.messages.length === 0
            ? 0
            : Math.max(...updatedRoom.messages.map((m) => m.round)) + 1;
        await runPerspectivesBatch({
          roomSnapshot: updatedRoom,
          prompt: `Deep Research: Dựa trên các nguồn mới nạp (${newSources
            .map((s) => `[${s.id}]`)
            .join(', ')}), hãy phân tích câu hỏi: ${query}`,
          targets,
          round: nextRound,
          roundLabel: `Vòng ${nextRound} · Deep Research (${newSources.length} nguồn mới)`,
          pattern: 'research',
        });
      }
    } catch (err) {
      setIsBusy(false);
      setErrorBanner(err instanceof Error ? err.message : 'Không tìm được nguồn Deep Research.');
    }
  };

  const handleAttachUrlOrText = async (payload: { url?: string; title?: string; text?: string }) => {
    if (!activeRoom) return;
    const nextId = `S${activeRoom.sources.length + 1}`;
    let added: SourceItem;

    if (payload.url) {
      const res = await searchResearchApi({ url: payload.url });
      if (!res.items[0]) throw new Error('Không trích xuất được nội dung từ URL.');
      added = { ...res.items[0], id: nextId };
    } else {
      added = {
        id: nextId,
        origin: 'Tài liệu đính kèm',
        title: payload.title || 'Đoạn trích người dùng đính kèm',
        excerpt: payload.text || '',
        url: '#local-document',
        verified: true,
        addedAt: new Date().toISOString(),
      };
    }

    const updated: Room = { ...activeRoom, sources: [...activeRoom.sources, added] };
    await persistRoom(updated);
    setRightTab('sources');
    setRightOpen(true);
    setHighlightedSourceId(added.id);
  };

  const handlePinToReport = (messageId: string) => {
    if (!activeRoom) return;
    const updated: Room = {
      ...activeRoom,
      messages: activeRoom.messages.map((m) =>
        m.id === messageId ? { ...m, pinnedToReport: !m.pinnedToReport } : m
      ),
    };
    persistRoom(updated);
  };

  const handleResetSeedRooms = async () => {
    setIsResetting(true);
    try {
      const res = await resetSeedRoomsApi();
      setRooms(res.rooms);
      if (res.rooms[0]) setActiveRoomId(res.rooms[0].id);
      setSettingsOpen(false);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Không khôi phục được dữ liệu mẫu.');
    } finally {
      setIsResetting(false);
    }
  };

  // Auto-hiding Bridge / Guest Mode / Over-concurrency alert strip (HIDDEN during normal operation!)
  const alertMessage = (() => {
    if (settings.simulateBridgeAlert === 'offline' || health?.bridgeOffline) {
      return {
        tone: 'danger' as const,
        text:
          health?.mode === 'bridge'
            ? 'Mất kết nối dsh-gemini-bridge (:10000). Kiểm tra máy chủ Bridge hoặc mở Cài đặt.'
            : 'Chế độ mô phỏng: Bridge đang tắt — dải cảnh báo tự hiện khi kết nối gặp sự cố và ẩn hoàn toàn lúc bình thường.',
      };
    }
    if (settings.simulateBridgeAlert === 'guest' || health?.guestMode) {
      return {
        tone: 'warn' as const,
        text: 'Phát hiện phiên Guest Mode trên worker Google — phiên có thể bị giới hạn ngữ cảnh. Vui lòng kiểm tra tài khoản trong Cài đặt.',
      };
    }
    if (health && health.healthyWorkers > 0 && settings.maxConcurrency > health.healthyWorkers) {
      return {
        tone: 'warn' as const,
        text: `Đang đặt ${settings.maxConcurrency} luồng song song vượt quá ${health.healthyWorkers} worker khỏe — có thể chờ khóa tuần tự (429 bridge_busy).`,
      };
    }
    return null;
  })();

  if (loading || !activeRoom) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--bg)] text-[var(--ink-secondary)] text-sm">
        Đang mở Sổ tay Nghiên cứu…
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[var(--bg)] text-[var(--ink)] overflow-hidden">
      {/* 3-Zone Serene Top Header (Zero technical clutter) */}
      <header className="h-14 shrink-0 px-4 sm:px-5 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-4 z-30">
        {/* Zone 1: Left Drawer Toggle + Brand Wordmark */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              setLeftDefaultTab('rooms');
              setLeftOpen((v) => !v);
            }}
            title="Thu/mở ngăn Phòng & Góc nhìn (phím [)"
            className={`p-2 rounded-lg transition-colors cursor-pointer ${
              leftOpen
                ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink)]'
            }`}
          >
            <PanelLeft className="w-4 h-4" />
          </button>
          <span className="font-display text-[17px] font-semibold tracking-tight text-[var(--ink)] whitespace-nowrap">
            Research Lab
          </span>
        </div>

        {/* Zone 2: 4 Clean Single-Line View Tabs */}
        <nav aria-label="Chế độ xem" className="hidden md:flex items-center gap-6 h-full">
          {(
            [
              { id: 'chat', label: 'Phòng chat' },
              { id: 'compare', label: 'So sánh' },
              { id: 'report', label: 'Báo cáo' },
              { id: 'audit', label: 'Kiểm chứng' },
            ] as const
          ).map((item) => {
            const active = viewTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setViewTab(item.id)}
                className={`relative h-full inline-flex items-center text-[13.5px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'text-[var(--accent)]'
                    : 'text-[var(--ink-secondary)] hover:text-[var(--ink)]'
                }`}
              >
                {item.label}
                {active && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--accent)] rounded-full" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Open Flow Map + Theme Toggle + Settings + Right Drawer */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onSwitchToFlowMap(activeRoom.id)}
            title="Mở Giao diện 2: Bản đồ Luồng AI trực quan"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-ink)] text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
          >
            Flow Map
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            title={
              theme === 'light'
                ? 'Chuyển sang Tối Quái Dị (Nocturnal Oddity)'
                : 'Chuyển sang Sáng ấm (Sổ tay Nghiên cứu)'
            }
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] hover:border-[var(--accent)] text-xs font-medium text-[var(--ink-secondary)] hover:text-[var(--ink)] transition-colors whitespace-nowrap cursor-pointer"
          >
            {theme === 'light' ? (
              <>
                <Moon className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">Tối quái dị</span>
              </>
            ) : (
              <>
                <Sun className="w-3.5 h-3.5 text-[var(--accent)]" />
                <span className="hidden xl:inline">Sáng ấm</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="Cài đặt luồng chạy & Bridge"
            className="p-2 rounded-lg text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink)] transition-colors cursor-pointer"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setRightOpen((v) => !v)}
            title="Thu/mở Kho nguồn & Dàn ý sống (phím ])"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
              rightOpen
                ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink)]'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span className="hidden sm:inline font-mono-num">
              Nguồn ({activeRoom.sources.length})
            </span>
          </button>
        </div>
      </header>

      {/* Mobile View Switcher */}
      <div className="md:hidden flex items-center justify-around border-b border-[var(--border)] bg-[var(--surface)] px-2 py-1.5">
        {(
          [
            { id: 'chat', label: 'Phòng chat' },
            { id: 'compare', label: 'So sánh' },
            { id: 'report', label: 'Báo cáo' },
            { id: 'audit', label: 'Kiểm chứng' },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setViewTab(item.id)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
              viewTab === item.id
                ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'text-[var(--ink-secondary)]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Auto-hiding Contextual Alert Strip (Hidden during healthy operation) */}
      {alertMessage && (
        <div
          className={`px-5 py-2 text-xs flex items-center justify-between gap-3 border-b ${
            alertMessage.tone === 'danger'
              ? 'bg-[var(--danger-soft)] text-[var(--danger)] border-[var(--danger)]/30'
              : 'bg-[var(--warn-soft)] text-[var(--warn)] border-[var(--warn)]/30'
          }`}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{alertMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="underline font-medium whitespace-nowrap cursor-pointer"
          >
            Mở Cài đặt
          </button>
        </div>
      )}

      {/* Runtime Error Toast Strip */}
      {errorBanner && (
        <div className="px-5 py-2 text-xs bg-[var(--danger-soft)] text-[var(--danger)] border-b border-[var(--danger)]/30 flex items-center justify-between gap-3">
          <span>{errorBanner}</span>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="p-0.5 hover:opacity-75 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main 3-Zone Adaptive Workspace (Auto-hiding Sidebars, Center Focus) */}
      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        <LeftDrawer
          open={leftOpen}
          onClose={() => setLeftOpen(false)}
          rooms={rooms}
          activeRoom={activeRoom}
          presets={presets}
          onSelectRoom={handleSelectRoom}
          onCreateRoomFromPreset={handleCreateRoomFromPreset}
          onDeleteRoom={handleDeleteRoom}
          onTogglePerspective={handleTogglePerspective}
          onToggleTagGroup={handleToggleTagGroup}
          onAddPerspective={handleAddPerspective}
          onSavePreset={handleSavePreset}
          defaultTab={leftDefaultTab}
        />

        <main className="flex-1 min-w-0 flex flex-col bg-[var(--bg)] overflow-hidden">
          {viewTab === 'chat' && (
            <>
              <GroupFeed
                room={activeRoom}
                activeJobs={activeJobs}
                nowMs={nowMs}
                onStopRunning={handleStopRunning}
                onCitationClick={handleCitationClick}
                onTogglePerspective={handleTogglePerspective}
                onOpenRoster={() => {
                  setLeftDefaultTab('roster');
                  setLeftOpen(true);
                }}
                onPinToReport={handlePinToReport}
                onAskRoleDirectly={(handle) => {
                  setComposerText((prev) =>
                    prev.includes(`@${handle}`) ? prev : `@${handle} ${prev}`.trimStart()
                  );
                }}
                onComparePerspective={(pid) => {
                  setCompareIds((prev) => {
                    const next = Array.from(new Set([pid, ...prev])).slice(0, 4);
                    return next;
                  });
                  setViewTab('compare');
                }}
                onOpenCompare={() => setViewTab('compare')}
              />
              <Composer
                value={composerText}
                onChange={setComposerText}
                perspectives={activeRoom.perspectives}
                maxConcurrency={settings.maxConcurrency}
                isBusy={isBusy}
                approveResearchPlan={settings.approveResearchPlan}
                onSend={handleSend}
                onAutoDebate={handleAutoDebate}
                onRunJudge={handleRunJudge}
                onRunDeepResearch={handleRunDeepResearch}
                onAttachUrlOrText={handleAttachUrlOrText}
              />
            </>
          )}

          {viewTab === 'compare' && (
            <CompareView
              room={activeRoom}
              initialSelectedIds={compareIds}
              onCitationClick={handleCitationClick}
              onAskRole={(handle) => {
                setViewTab('chat');
                setComposerText(`@${handle} `);
              }}
            />
          )}

          {viewTab === 'report' && (
            <ReportView
              room={activeRoom}
              isBusy={isBusy}
              onRunJudge={handleRunJudge}
              onBackToChat={() => setViewTab('chat')}
              onCitationClick={handleCitationClick}
            />
          )}

          {viewTab === 'audit' && <AuditView room={activeRoom} />}
        </main>

        <RightDrawer
          open={rightOpen}
          activeTab={rightTab}
          onTabChange={setRightTab}
          onClose={() => setRightOpen(false)}
          room={activeRoom}
          highlightedSourceId={highlightedSourceId}
          onSelectSuggestedPrompt={(prompt) => {
            setViewTab('chat');
            setComposerText(prompt);
          }}
          onFillGapsResearch={(gaps) => {
            handleRunDeepResearch(gaps.join('; '));
          }}
          isBusy={isBusy}
        />
      </div>

      {/* Consolidated Technical Settings Drawer */}
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={updateSettings}
        health={health}
        onResetSeedRooms={handleResetSeedRooms}
        isResetting={isResetting}
      />
    </div>
  );
}
