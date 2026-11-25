import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Moon,
  PanelLeft,
  Plus,
  Scale,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import type {
  AIProviderConfig,
  AppSettings,
  BridgeHealth,
  ChatMessage,
  ConversationHistoryItem,
  LabViewTab,
  ModelOption,
  Perspective,
  PerspectivePreset,
  Room,
  RoundKind,
  SourceItem,
  ThemeMode,
} from '../types.ts';
import {
  createRoomApi,
  deleteRoomApi,
  emitFlowEventApi,
  fetchHealth,
  fetchModels,
  fetchProviders,
  fetchRooms,
  patchRoomApi,
  runPerspectiveApi,
  runSynthesizeApi,
  searchResearchApi,
  uploadPdfSourceApi,
} from '../utils/api.ts';
import {
  formatLaneDisplay,
  getPerspectiveColorVar,
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
import {
  isDefaultRoomTitle,
  LanguageSelector,
  localizeHandle,
  localizeModelLabel,
  localizeRoleName,
  useI18n,
} from '../utils/i18n.tsx';

function buildConversationHistorySnapshot(messages: ChatMessage[]): ConversationHistoryItem[] {
  return messages
    .filter(
      (m): m is ChatMessage & { senderType: 'user' | 'ai' | 'judge' | 'system' } =>
        (m.senderType === 'user' ||
          m.senderType === 'ai' ||
          m.senderType === 'judge' ||
          m.senderType === 'system') &&
        Boolean(m.content && m.content.trim())
    )
    .map((m) => ({
      round: m.round,
      senderType: m.senderType,
      handle: m.handle,
      content: m.content.trim(),
      summary1Line: m.summary1Line,
      preserveFull: Boolean(
        m.preserveFull ||
          m.pinnedToReport ||
          m.senderType === 'system' ||
          (m.handle && /nghiên_cứu|nghien_cuu|research|tài_liệu|tai_lieu/i.test(m.handle))
      ),
    }));
}

// Lưu ý §5.b: Hồ sơ tài liệu dưới đây là ngữ cảnh gửi cho AI đọc/trích dẫn [S#], giữ nguyên mẫu tiếng Việt.
function buildSourcesDossierContent(sourcesList: SourceItem[], topic?: string): string {
  const header = topic
    ? `**Hồ sơ Tài liệu Nghiên cứu (${sourcesList.length} nguồn)** — Chủ đề: *${topic}*`
    : `**Hồ sơ Tài liệu Nghiên cứu từ Kho nguồn (${sourcesList.length} nguồn)**`;
  const blocks = sourcesList.map((s) => {
    const levelTag =
      s.contentLevel === 'full_text'
        ? 'Toàn văn'
        : s.contentLevel === 'abstract_only'
        ? 'Chỉ có Tóm tắt'
        : 'Trích đoạn';
    return `### [${s.id}] ${s.title}\n- **Nguồn (${levelTag}):** ${s.origin} · [Liên kết gốc](${s.url})\n\n${s.excerpt}`;
  });
  return `${header}\n\n${blocks.join('\n\n---\n\n')}`;
}

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
  const { lang, t } = useI18n();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string>(initialRoomId || '');
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
  const [models, setModels] = useState<ModelOption[]>([]);
  const [providers, setProviders] = useState<AIProviderConfig[]>([]);
  const [composerText, setComposerText] = useState('');

  const [activeJobs, setActiveJobs] = useState<ActiveLaneJob[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const abortRef = useRef<AbortController | null>(null);
  const pipelineAbortedRef = useRef(false);

  const activeRoom = rooms.find((r) => r.id === activeRoomId) || rooms[0] || null;

  const refreshProvidersAndModels = useCallback(async () => {
    const [healthRes, modelsRes, providersRes] = await Promise.all([
      fetchHealth().catch(() => null),
      fetchModels().catch(() => ({ models: [] })),
      fetchProviders().catch(() => ({ providers: [] })),
    ]);
    if (healthRes) setHealth(healthRes);
    setModels(modelsRes.models || []);
    setProviders(providersRes.providers || []);
  }, []);

  // Load rooms, health, live models, and providers on mount
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetchRooms(),
      fetchHealth().catch(() => null),
      fetchModels().catch(() => ({ models: [] })),
      fetchProviders().catch(() => ({ providers: [] })),
    ])
      .then(([roomsRes, healthRes, modelsRes, providersRes]) => {
        if (!alive) return;
        setRooms(roomsRes.rooms);
        if (initialRoomId && roomsRes.rooms.some((r) => r.id === initialRoomId)) {
          setActiveRoomId(initialRoomId);
        } else if (roomsRes.rooms[0]) {
          setActiveRoomId(roomsRes.rooms[0].id);
        }
        if (healthRes) setHealth(healthRes);
        setModels(modelsRes.models || []);
        setProviders(providersRes.providers || []);
      })
      .catch((err) => {
        if (!alive) return;
        setErrorBanner(err instanceof Error ? err.message : t('errLoadRooms'));
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
      setErrorBanner(err instanceof Error ? err.message : t('errSaveRoom'));
    }
  }, [t]);

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
      setErrorBanner(err instanceof Error ? err.message : t('errCreateRoom'));
    }
  };

  const handleRenameRoom = async (roomId: string, newTitle: string) => {
    const clean = newTitle.trim();
    if (!clean) return;
    const target = rooms.find((r) => r.id === roomId);
    if (!target) return;
    await persistRoom({ ...target, title: clean });
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
      setErrorBanner(err instanceof Error ? err.message : t('errDeleteRoom'));
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

  const handleUpdatePerspective = (perspectiveId: string, patch: Partial<Perspective>) => {
    if (!activeRoom) return;
    persistRoom({
      ...activeRoom,
      perspectives: activeRoom.perspectives.map((p) =>
        p.id === perspectiveId ? { ...p, ...patch } : p
      ),
    });
  };

  const handleRemovePerspective = (perspectiveId: string) => {
    if (!activeRoom || activeRoom.perspectives.length <= 1) return;
    persistRoom({
      ...activeRoom,
      perspectives: activeRoom.perspectives.filter((p) => p.id !== perspectiveId),
    });
  };

  const handleSavePreset = (name: string) => {
    if (!activeRoom) return;
    const newPreset: PerspectivePreset = {
      id: `preset-${Date.now()}`,
      name,
      description: t('savedPresetDesc', { count: activeRoom.perspectives.length }),
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
    pipelineAbortedRef.current = true;
    abortRef.current?.abort();
    if (activeRoom) {
      emitFlowEventApi(activeRoom.id, {
        event_type: 'run_aborted',
        run_id: `abort-${Date.now()}`,
        payload: {
          node_id: 'run_aborted',
          stage_index: 1,
          stage_label: t('flowStageStopped'),
          actor: { id: 'system', name: t('flowActorUserStop'), colorIndex: 4, enabled: true, kind: 'output' },
          inputs: [],
          summary_1line: t('flowAbortSummary'),
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
    roundKind?: RoundKind;
    roundCount?: number;
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
      roundKind,
      roundCount,
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
    const authenticatedLanes = (health?.laneDetails || [])
      .filter((l) => l.reachable && l.control === 'on' && l.authOk)
      .map((l) => l.id);
    const lanes =
      authenticatedLanes.length > 0
        ? authenticatedLanes
        : health?.lanes?.length
        ? health.lanes
        : ['acc1', 'acc2', 'acc3', 'acc4'];
    const historySnapshot: ConversationHistoryItem[] =
      round > 0 && roomSnapshot.messages.length > 0
        ? buildConversationHistorySnapshot(roomSnapshot.messages)
        : [];

    let workingRoom: Room = {
      ...roomSnapshot,
      title:
        roomSnapshot.messages.length === 0 && isDefaultRoomTitle(roomSnapshot.title)
          ? prompt.slice(0, 72)
          : roomSnapshot.title,
      messages: includeUserMessage
        ? [
            ...roomSnapshot.messages,
            {
              id: `m-u-${Date.now()}`,
              round,
              roundLabel,
              roundKind,
              roundCount,
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
        stage_label: t('flowStageInput'),
        pattern,
        actor: { id: 'user', name: t('flowActorUser'), colorIndex: 0, enabled: true, kind: 'user' },
        inputs: [],
        summary_1line: t('flowStartSummary', {
          preview: prompt.slice(0, 75),
          active: targets.length,
          total: workingRoom.perspectives.length,
        }),
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
      laneId: t.pinnedLaneId || lanes[idx % lanes.length],
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
        const laneId = p.pinnedLaneId || lanes[workerCursor % lanes.length];
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
                summary: t('flowPromptSentTo', { handle: localizeHandle(p.handle, lang) }),
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
              conversationHistory: historySnapshot.length > 0 ? historySnapshot : undefined,
              peerMessages: historySnapshot.length > 0 ? undefined : peerMessages,
              laneId,
              detailMode: settings.detailMode || 'deep',
            },
            controller.signal
          );

          const isDeepOrResearch =
            (settings.detailMode || 'deep') === 'deep' ||
            pattern === 'research' ||
            /nghiên_cứu|nghien_cuu|research|tài_liệu|tai_lieu/i.test(p.handle) ||
            p.tags.some((t) => /nghiên_cứu|nghien_cuu|research|tài_liệu|tai_lieu/i.test(t));

          const aiMsg: ChatMessage = {
            id: `m-ai-${p.id}-${Date.now()}`,
            round,
            roundLabel,
            roundKind,
            roundCount,
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
            verification: result.verification,
            preserveFull: isDeepOrResearch,
            fallbackFrom: result.fallbackFrom,
            provenance: result.provenance,
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
            provenance: result.provenance,
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
          const msg = err instanceof Error ? err.message : t('errPerspectiveCall');
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
          stage_label: t('flowStageOutput'),
          actor: { id: 'output', name: t('flowActorOutput'), colorIndex: 1, enabled: true, kind: 'output' },
          inputs: completedNodeIds.map((nid) => ({
            from_node_id: nid,
            kind: 'turn',
            chars: 640,
          })),
          summary_1line: t('flowOutputSummary', {
            done: completedNodeIds.length,
            total: targets.length,
            roundLabel,
          }),
          content: t('flowOutputContent'),
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
      roundKind: nextRound === 0 ? 'independent' : 'discuss',
      roundCount: targets.length,
      pattern: targets.length >= 4 ? 'council' : 'direct',
    });
  };

  const executeAutoDebate = async (roomSnapshot: Room): Promise<Room> => {
    const targets = roomSnapshot.perspectives.filter((p) => p.enabled);
    if (targets.length === 0) return roomSnapshot;

    const latestRound =
      roomSnapshot.messages.length > 0 ? Math.max(...roomSnapshot.messages.map((m) => m.round)) : 0;

    const nextRound = latestRound + 1;
    return runPerspectivesBatch({
      roomSnapshot,
      // Lưu ý §5.b: Prompt phản biện gửi cho AI giữ ổn định tiếng Việt (backend ép AI trả lời theo ngôn ngữ người dùng).
      prompt: `Phản biện chéo các lập luận và tài liệu nghiên cứu ở Vòng ${latestRound} về chủ đề "${roomSnapshot.title}". Hãy trích dẫn mã [S#], chỉ rõ điểm đồng ý, điểm phản bác, kẽ hở số liệu và đề xuất điều chỉnh cụ thể.`,
      targets,
      round: nextRound,
      roundLabel: `Vòng ${nextRound} · Phản biện chéo (${targets.length})`,
      roundKind: 'rebuttal',
      roundCount: targets.length,
      pattern: 'debate',
      includeUserMessage: false,
    });
  };

  const handleAutoDebate = async () => {
    if (!activeRoom || isBusy) return;
    pipelineAbortedRef.current = false;
    await executeAutoDebate(activeRoom);
  };

  const executeJudge = async (roomSnapshot: Room): Promise<Room> => {
    setErrorBanner(null);
    setIsBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const runId = `judge-${Date.now()}`;

    try {
      const res = await runSynthesizeApi(
        {
          roomTitle: roomSnapshot.title,
          messages: roomSnapshot.messages
            .filter((m) => (m.senderType === 'ai' && Boolean(m.handle)) || m.senderType === 'user')
            .map((m) => ({
              senderType: m.senderType,
              handle: m.handle,
              perspectiveId: m.perspectiveId,
              laneId: m.laneId,
              modelLabel: m.modelLabel,
              content: m.content,
              round: m.round,
            })),
          perspectives: roomSnapshot.perspectives,
          sources: roomSnapshot.sources,
          anonymize: settings.anonymizeJudge,
          judgeRuns: settings.judgeRuns ?? 2,
          claimCheck: settings.claimCheck ?? true,
          judgeModel: settings.judgeModel,
          judgeProviderId: settings.judgeProviderId,
          judgeLaneId:
            (settings.judgeProviderId || 'bridge-local') === 'bridge-local' && settings.judgeLaneId
              ? settings.judgeLaneId
              : undefined,
        },
        controller.signal
      );

      const nextRound =
        roomSnapshot.messages.length > 0 ? Math.max(...roomSnapshot.messages.map((m) => m.round)) : 0;

      const judgeMsg: ChatMessage = {
        id: `m-judge-${Date.now()}`,
        round: nextRound,
        roundLabel: `Vòng ${nextRound} · Tổng hợp Trọng tài`,
        roundKind: 'judge',
        senderType: 'judge',
        elapsedSec: res.elapsedSec,
        summary1Line: res.summary1Line,
        content: res.report.executiveSummary,
        executiveSummaryCode: res.report.executiveSummaryCode ?? undefined,
        citedSourceIds: [],
        modelLabel: res.modelUsed,
        laneId: res.laneId,
        provenance: res.provenance,
        createdAt: new Date().toISOString(),
      };

      const updated: Room = {
        ...roomSnapshot,
        report: res.report,
        livingOutline: res.livingOutline,
        messages: [...roomSnapshot.messages, judgeMsg],
      };
      await persistRoom(updated);
      setRightTab('outline');
      setRightOpen(true);

      await emitFlowEventApi(roomSnapshot.id, {
        event_type: 'node_completed',
        run_id: runId,
        payload: {
          node_id: `stage2_judge_${runId}`,
          stage_index: 2,
          stage_label: t('flowStageJudge'),
          actor: { id: 'judge', name: t('flowActorJudge'), colorIndex: 3, enabled: true, kind: 'judge' },
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
          transport: { lane_id: res.laneId || 'bridge', started_offset_s: 1.0, elapsed_s: res.elapsedSec },
        },
      }).catch(() => {});
      return updated;
    } catch (err) {
      if (!controller.signal.aborted) {
        setErrorBanner(err instanceof Error ? err.message : t('errJudgeRun'));
      }
      return roomSnapshot;
    } finally {
      setIsBusy(false);
      abortRef.current = null;
    }
  };

  const handleRunJudge = async () => {
    if (!activeRoom || isBusy) return;
    pipelineAbortedRef.current = false;
    await executeJudge(activeRoom);
  };

  const executeDeepResearch = async (roomSnapshot: Room, query: string): Promise<Room> => {
    setErrorBanner(null);
    setIsBusy(true);
    try {
      const searchRes = await searchResearchApi({ query });
      const existingCount = roomSnapshot.sources.length;
      const newSources: SourceItem[] = searchRes.items.map((item, idx) => ({
        ...item,
        id: `S${existingCount + idx + 1}`,
      }));

      const nextRound =
        roomSnapshot.messages.length === 0
          ? 0
          : Math.max(...roomSnapshot.messages.map((m) => m.round)) + 1;
      const roundLabel = `Vòng ${nextRound} · Deep Research (${newSources.length} nguồn mới)`;

      const sourceTags = newSources.length
        ? newSources.map((s) => `[${s.id}]`).join(', ')
        : roomSnapshot.sources.map((s) => `[${s.id}]`).join(', ');

      const researchPrompt = newSources.length
        // Lưu ý §5.b: Prompt mẫu Deep Research gửi cho AI giữ nguyên theo quy ước.
        ? `Deep Research: Dựa trên toàn bộ hồ sơ tài liệu vừa nạp (${sourceTags}), hãy in các điểm dữ liệu/bằng chứng cốt lõi và phân tích chuyên sâu câu hỏi: ${query}`
        : `Deep Research: Chưa tải thêm được nguồn mới từ thư viện mở; hãy phân tích chuyên sâu câu hỏi dựa trên kho nguồn hiện có${sourceTags ? ` (${sourceTags})` : ''}: ${query}`;

      const insertedMessages: ChatMessage[] = [
        {
          id: `m-u-${Date.now()}`,
          round: nextRound,
          roundLabel,
          roundKind: 'deep_research',
          roundCount: newSources.length,
          senderType: 'user',
          content: researchPrompt,
          citedSourceIds: [],
          createdAt: new Date().toISOString(),
        },
      ];

      if (newSources.length > 0) {
        insertedMessages.push({
          id: `m-sys-${Date.now() + 1}`,
          round: nextRound,
          roundLabel,
          roundKind: 'deep_research',
          roundCount: newSources.length,
          senderType: 'system',
          content: buildSourcesDossierContent(newSources, query),
          summary1Line: `Hồ sơ tài liệu ${newSources.length} nguồn (${sourceTags})`,
          citedSourceIds: newSources.map((s) => s.id),
          preserveFull: true,
          createdAt: new Date().toISOString(),
        });
      }

      const updatedRoom: Room = {
        ...roomSnapshot,
        title:
          roomSnapshot.messages.length === 0 && isDefaultRoomTitle(roomSnapshot.title)
            ? query.slice(0, 72)
            : roomSnapshot.title,
        sources: [...roomSnapshot.sources, ...newSources],
        messages: [...roomSnapshot.messages, ...insertedMessages],
      };
      await persistRoom(updatedRoom);
      setRightTab('sources');
      setRightOpen(true);
      if (newSources[0]) setHighlightedSourceId(newSources[0].id);

      setIsBusy(false);
      const targets = updatedRoom.perspectives.filter((p) => p.enabled);
      if (targets.length > 0) {
        return await runPerspectivesBatch({
          roomSnapshot: updatedRoom,
          prompt: researchPrompt,
          targets,
          round: nextRound,
          roundLabel,
          roundKind: 'deep_research',
          roundCount: newSources.length,
          pattern: 'research',
          includeUserMessage: false,
        });
      }
      return updatedRoom;
    } catch (err) {
      setIsBusy(false);
      setErrorBanner(err instanceof Error ? err.message : t('errDeepResearch'));
      return roomSnapshot;
    }
  };

  const handleRunDeepResearch = async (query: string) => {
    if (!activeRoom || isBusy) return;
    pipelineAbortedRef.current = false;
    await executeDeepResearch(activeRoom, query);
  };

  const handleRunFullPipeline = async (query: string) => {
    if (!activeRoom || isBusy) return;
    pipelineAbortedRef.current = false;
    const afterResearch = await executeDeepResearch(activeRoom, query);
    if (pipelineAbortedRef.current) return;
    const afterDebate = await executeAutoDebate(afterResearch);
    if (pipelineAbortedRef.current) return;
    await executeJudge(afterDebate);
  };

  const handleDeleteSource = async (sourceId: string) => {
    if (!activeRoom) return;
    const updated: Room = {
      ...activeRoom,
      sources: activeRoom.sources.filter((s) => s.id !== sourceId),
    };
    if (highlightedSourceId === sourceId) {
      setHighlightedSourceId(null);
    }
    await persistRoom(updated);
  };

  const handleInjectSourcesToChat = async () => {
    if (!activeRoom || activeRoom.sources.length === 0) return;
    const nextRound =
      activeRoom.messages.length === 0
        ? 0
        : Math.max(...activeRoom.messages.map((m) => m.round));
    const dossierMsg: ChatMessage = {
      id: `m-sys-${Date.now()}`,
      round: nextRound,
      roundLabel: `Vòng ${nextRound} · Hồ sơ Tài liệu Kho nguồn (${activeRoom.sources.length})`,
      roundKind: 'dossier',
      roundCount: activeRoom.sources.length,
      senderType: 'system',
      content: buildSourcesDossierContent(activeRoom.sources),
      summary1Line: `Hồ sơ đầy đủ ${activeRoom.sources.length} nguồn từ Kho nguồn`,
      citedSourceIds: activeRoom.sources.map((s) => s.id),
      preserveFull: true,
      createdAt: new Date().toISOString(),
    };
    const updated: Room = {
      ...activeRoom,
      messages: [...activeRoom.messages, dossierMsg],
    };
    await persistRoom(updated);
    setViewTab('chat');
  };

  const handleAttachUrlOrText = async (payload: {
    url?: string;
    title?: string;
    text?: string;
    pdfFile?: File;
  }) => {
    if (!activeRoom) return;
    const nextId = `S${activeRoom.sources.length + 1}`;
    let added: SourceItem;

    if (payload.pdfFile) {
      const res = await uploadPdfSourceApi(payload.pdfFile);
      added = { ...res.item, id: nextId };
    } else if (payload.url) {
      const res = await searchResearchApi({ url: payload.url });
      if (!res.items[0]) throw new Error(t('errExtractUrl'));
      added = { ...res.items[0], id: nextId };
    } else {
      added = {
        id: nextId,
        origin: 'Tài liệu đính kèm',
        title: payload.title || 'Đoạn trích người dùng đính kèm',
        excerpt: payload.text || '',
        url: '#local-document',
        contentLevel: 'excerpt',
        charCount: (payload.text || '').length,
        verified: true,
        sourceType: 'user_excerpt',
        retrieval: { provider: 'manual', retrievedAt: new Date().toISOString() },
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

  // Auto-hiding Bridge / Guest Mode / Over-concurrency alert strip (HIDDEN during normal operation!)
  const alertMessage = (() => {
    if (health?.bridgeOffline) {
      return {
        tone: 'danger' as const,
        text: t('alertBridgeOffline'),
      };
    }
    if (health?.guestMode) {
      return {
        tone: 'warn' as const,
        text: t('alertGuestMode'),
      };
    }
    const duplicatedLanes = (health?.laneDetails || [])
      .filter((l) => (l.duplicatedWith || []).length > 0)
      .map((l) => l.id);
    if (duplicatedLanes.length > 0) {
      return {
        tone: 'warn' as const,
        text: t('alertDuplicateLanes', { lanes: duplicatedLanes.join(', ') }),
      };
    }
    if (health && health.healthyWorkers > 0 && settings.maxConcurrency > health.healthyWorkers) {
      return {
        tone: 'warn' as const,
        text: t('alertOverConcurrency', {
          max: settings.maxConcurrency,
          healthy: health.healthyWorkers,
        }),
      };
    }
    return null;
  })();

  if (loading || !activeRoom) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--bg)] text-[var(--ink-secondary)] text-sm">
        {t('loadingNotebook')}
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
            title={t('toggleLeftTitle')}
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
        <nav aria-label={t('navAriaLabel')} className="hidden md:flex items-center gap-6 h-full">
          {(
            [
              { id: 'chat', label: t('navChat') },
              { id: 'compare', label: t('navCompare') },
              { id: 'report', label: t('navReport') },
              { id: 'audit', label: t('navAudit') },
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

        {/* Zone 3: Flow Map + Language + Theme Toggle + Settings + Right Drawer */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onSwitchToFlowMap(activeRoom.id)}
            title={t('flowMapTitle')}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-ink)] text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
          >
            Flow Map
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>

          <LanguageSelector compact />

          <button
            type="button"
            onClick={onToggleTheme}
            title={theme === 'light' ? t('themeToDarkTitle') : t('themeToLightTitle')}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] hover:border-[var(--accent)] text-xs font-medium text-[var(--ink-secondary)] hover:text-[var(--ink)] transition-colors whitespace-nowrap cursor-pointer"
          >
            {theme === 'light' ? (
              <>
                <Moon className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">{t('themeDarkLabel')}</span>
              </>
            ) : (
              <>
                <Sun className="w-3.5 h-3.5 text-[var(--accent)]" />
                <span className="hidden xl:inline">{t('themeLightLabel')}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title={t('settingsTitle')}
            className="p-2 rounded-lg text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink)] transition-colors cursor-pointer"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setRightOpen((v) => !v)}
            title={t('rightDrawerTitle')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
              rightOpen
                ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink)]'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span className="hidden sm:inline font-mono-num">
              {t('sourcesCountBtn', { count: activeRoom.sources.length })}
            </span>
          </button>
        </div>
      </header>

      {/* Mobile View Switcher */}
      <div className="md:hidden flex items-center justify-around border-b border-[var(--border)] bg-[var(--surface)] px-2 py-1.5">
        {(
          [
            { id: 'chat', label: t('navChat') },
            { id: 'compare', label: t('navCompare') },
            { id: 'report', label: t('navReport') },
            { id: 'audit', label: t('navAudit') },
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
            {t('openSettings')}
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
          models={models}
          laneDetails={health?.laneDetails}
          onSelectRoom={handleSelectRoom}
          onCreateRoomFromPreset={handleCreateRoomFromPreset}
          onRenameRoom={handleRenameRoom}
          onDeleteRoom={handleDeleteRoom}
          onTogglePerspective={handleTogglePerspective}
          onToggleTagGroup={handleToggleTagGroup}
          onAddPerspective={handleAddPerspective}
          onUpdatePerspective={handleUpdatePerspective}
          onRemovePerspective={handleRemovePerspective}
          onSavePreset={handleSavePreset}
          onOpenSettings={() => setSettingsOpen(true)}
          defaultTab={leftDefaultTab}
        />

        <main className="flex-1 min-w-0 flex flex-col bg-[var(--bg)] overflow-hidden">
          {viewTab === 'chat' && (
            <>
              {/* Clear Role Assignment & Judge Model Strip */}
              <div className="shrink-0 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)]/75 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                  <span className="text-[11px] font-medium text-[var(--ink-muted)] mr-0.5">
                    {t('aiRosterLabel')}
                  </span>
                  {activeRoom.perspectives
                    .filter((p) => p.enabled)
                    .map((p) => {
                      const color = getPerspectiveColorVar(p.colorIndex);
                      const accLabel = p.pinnedLaneId
                        ? formatLaneDisplay(p.pinnedLaneId, health?.laneDetails, lang)
                        : '';
                      const dispHandle = localizeHandle(p.handle, lang);
                      const dispRole = localizeRoleName(p.name, lang);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setLeftDefaultTab('roster');
                            setLeftOpen(true);
                          }}
                          title={t('aiChipTitle', {
                            name: dispRole,
                            acc: accLabel ? t('accPinned', { acc: accLabel }) : t('accAuto'),
                          })}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--bg)] hover:border-[var(--accent)] transition-colors cursor-pointer max-w-[330px]"
                        >
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                          <span className="font-semibold shrink-0" style={{ color }}>
                            @{dispHandle}
                          </span>
                          <span className="text-[var(--ink-secondary)] truncate">{dispRole}</span>
                          <span className="text-[10.5px] font-mono-num px-1.5 py-0.5 rounded bg-[var(--bg-subtle)] text-[var(--ink-muted)] shrink-0">
                            {p.modelLabel.replace(/^gemini-/, '')}
                          </span>
                          {accLabel && (
                            <span className="text-[10.5px] font-mono-num px-1.5 py-0.5 rounded bg-[var(--accent-soft)] text-[var(--accent)] font-semibold shrink-0">
                              {accLabel}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-dashed border-[var(--border-strong)] text-[11px] font-medium text-[var(--ink-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    {t('addAiPinAcc')}
                  </button>
                </div>

                {/* Judge Model + Account quick picker */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <Scale className="w-3.5 h-3.5 text-[var(--accent)]" />
                  <span className="text-[11px] text-[var(--ink-muted)]">{t('judgeLabel')}</span>
                  <select
                    aria-label={t('judgeModelAria')}
                    value={`${settings.judgeProviderId || 'bridge-local'}::${settings.judgeModel || 'gemini-neon'}`}
                    onChange={(e) => {
                      const [pid, mid] = e.target.value.split('::');
                      updateSettings({ judgeProviderId: pid, judgeModel: mid });
                    }}
                    className="px-2 py-1 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[11.5px] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)] cursor-pointer max-w-[180px]"
                  >
                    {(models.length > 0
                      ? models
                      : [
                          { id: 'gemini-neon', label: t('model4NeonDesc'), providerId: 'bridge-local', providerName: 'Bridge' },
                          { id: 'gemini-carbon', label: t('model4CarbonDesc'), providerId: 'bridge-local', providerName: 'Bridge' },
                          { id: 'gemini-4-hydrogen', label: t('model4HydrogenDesc'), providerId: 'bridge-local', providerName: 'Bridge' },
                        ]
                    ).map((m) => (
                      <option key={`${m.providerId}::${m.id}`} value={`${m.providerId}::${m.id}`}>
                        {localizeModelLabel(m, lang)}
                      </option>
                    ))}
                  </select>
                  {(settings.judgeProviderId || 'bridge-local') === 'bridge-local' &&
                    (health?.laneDetails?.length || 0) > 0 && (
                      <select
                        aria-label={t('judgeAccAria')}
                        value={settings.judgeLaneId || ''}
                        onChange={(e) => updateSettings({ judgeLaneId: e.target.value })}
                        className="px-2 py-1 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[11.5px] font-mono-num text-[var(--ink)] focus:outline-none focus:border-[var(--accent)] cursor-pointer max-w-[140px]"
                      >
                        <option value="">{t('accAutoOption')}</option>
                        {health?.laneDetails?.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.id} ({l.name})
                          </option>
                        ))}
                      </select>
                    )}
                </div>
              </div>

              <GroupFeed
                room={activeRoom}
                laneDetails={health?.laneDetails}
                activeJobs={activeJobs}
                nowMs={nowMs}
                onRenameRoom={(title) => handleRenameRoom(activeRoom.id, title)}
                onStopRunning={handleStopRunning}
                onCitationClick={handleCitationClick}
                onTogglePerspective={handleTogglePerspective}
                onOpenRoster={() => {
                  setLeftDefaultTab('roster');
                  setLeftOpen(true);
                }}
                onPinToReport={handlePinToReport}
                onAskRoleDirectly={(handle) => {
                  const disp = localizeHandle(handle, lang);
                  setComposerText((prev) =>
                    prev.includes(`@${disp}`) ? prev : `@${disp} ${prev}`.trimStart()
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
                detailMode={settings.detailMode || 'deep'}
                onToggleDetailMode={() =>
                  updateSettings({
                    detailMode: (settings.detailMode || 'deep') === 'deep' ? 'standard' : 'deep',
                  })
                }
                onSend={handleSend}
                onAutoDebate={handleAutoDebate}
                onRunJudge={handleRunJudge}
                onRunDeepResearch={handleRunDeepResearch}
                onRunFullPipeline={handleRunFullPipeline}
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
          onDeleteSource={handleDeleteSource}
          onInjectSourcesToChat={handleInjectSourcesToChat}
          isBusy={isBusy}
        />
      </div>

      {/* Consolidated AI Providers, Model & Technical Settings Drawer */}
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        activeRoomTitle={activeRoom.title}
        settings={settings}
        onUpdateSettings={updateSettings}
        health={health}
        models={models}
        providers={providers}
        onRefreshProvidersAndModels={refreshProvidersAndModels}
        onAddPerspectiveToRoom={handleAddPerspective}
      />
    </div>
  );
}
