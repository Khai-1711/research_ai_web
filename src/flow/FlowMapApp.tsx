import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Code2,
  Eye,
  Filter,
  GitBranch,
  Moon,
  Pause,
  Play,
  Radio,
  Shield,
  SkipBack,
  SkipForward,
  Sun,
  X,
} from 'lucide-react';
import type { FlowEvent, FlowViewTab, Room, ThemeMode } from '../types.ts';
import { buildApiUrl, fetchRooms } from '../utils/api.ts';
import {
  buildGraphFromEvents,
  FlowCanvasSvg,
  GraphEdge,
  GraphNode,
} from './FlowCanvasSvg.tsx';
import { SwimlaneView } from './SwimlaneView.tsx';
import {
  LanguageSelector,
  localizeFlowActorName,
  localizeFlowStageLabel,
  localizeHandle,
  localizeRoomTitle,
  useI18n,
} from '../utils/i18n.tsx';

interface FlowMapAppProps {
  theme: ThemeMode;
  onToggleTheme: () => void;
  onSwitchToLab: (roomId: string) => void;
  initialRoomId?: string;
}

type InspectorSelection =
  | { type: 'node'; node: GraphNode }
  | { type: 'edge'; edge: GraphEdge; fromNode: GraphNode; toNode: GraphNode }
  | null;

export function FlowMapApp({
  theme,
  onToggleTheme,
  onSwitchToLab,
  initialRoomId,
}: FlowMapAppProps) {
  const { lang, locale, t } = useI18n();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string>(initialRoomId || '');
  const [viewTab, setViewTab] = useState<FlowViewTab>('map');

  // Real SSE events from backend events.jsonl
  const [liveEvents, setLiveEvents] = useState<FlowEvent[]>([]);
  const [sseConnected, setSseConnected] = useState(false);

  // Replay controls
  const [isLiveMode, setIsLiveMode] = useState(true);
  const [replayIndex, setReplayIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1.5);

  // Filters
  const [onlyEnabled, setOnlyEnabled] = useState(false);
  const [tagFilter, setTagFilter] = useState('all');

  // Inspector Drawer (right slide-in — never obscures stage nodes)
  const [inspector, setInspector] = useState<InspectorSelection>(null);
  const [showRawDetails, setShowRawDetails] = useState(false);

  const maxStep = Math.max(0, liveEvents.length);

  // Load room list for selector
  useEffect(() => {
    fetchRooms()
      .then((res) => {
        setRooms(res.rooms);
        if (initialRoomId && res.rooms.some((r) => r.id === initialRoomId)) {
          setSelectedRoomId(initialRoomId);
        } else {
          const withMsgs = res.rooms.find((r) => r.messages.length > 0);
          if (withMsgs) {
            setSelectedRoomId(withMsgs.id);
          } else if (res.rooms[0]) {
            setSelectedRoomId(res.rooms[0].id);
          }
        }
      })
      .catch(() => {});
  }, [initialRoomId]);

  // Real SSE connection to /api/rooms/:id/events (Zero coupling with Interface 1!)
  useEffect(() => {
    if (!selectedRoomId) return;
    setInspector(null);
    setIsLiveMode(true);
    setIsPlaying(false);

    const es = new EventSource(
      buildApiUrl(`/api/rooms/${encodeURIComponent(selectedRoomId)}/events`, true)
    );
    es.onopen = () => setSseConnected(true);
    es.onerror = () => setSseConnected(false);

    es.addEventListener('snapshot', (e) => {
      try {
        const list = JSON.parse((e as MessageEvent).data) as FlowEvent[];
        setLiveEvents(list);
        setReplayIndex(list.length);
      } catch {
        // ignore
      }
    });

    es.addEventListener('flow', (e) => {
      try {
        const ev = JSON.parse((e as MessageEvent).data) as FlowEvent;
        setLiveEvents((prev) => {
          const next = [...prev, ev];
          setReplayIndex((cur) => (cur >= prev.length ? next.length : cur));
          return next;
        });
      } catch {
        // ignore
      }
    });

    return () => {
      es.close();
      setSseConnected(false);
    };
  }, [selectedRoomId]);

  // Keep replayIndex pinned to latest when in LIVE mode
  useEffect(() => {
    if (isLiveMode && !isPlaying) {
      setReplayIndex(liveEvents.length);
    }
  }, [isLiveMode, isPlaying, liveEvents.length]);

  // Replay timer loop
  useEffect(() => {
    if (!isPlaying) return;
    const intervalMs = Math.max(220, Math.round(950 / speed));
    const timer = setInterval(() => {
      setReplayIndex((prev) => {
        if (prev >= liveEvents.length) {
          setIsPlaying(false);
          return liveEvents.length;
        }
        return prev + 1;
      });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [isPlaying, speed, liveEvents.length]);

  const activeSlice = useMemo(
    () => (liveEvents.length === 0 ? [] : liveEvents.slice(0, Math.max(1, replayIndex))),
    [liveEvents, replayIndex]
  );

  const graph = useMemo(() => buildGraphFromEvents(activeSlice, lang), [activeSlice, lang]);

  const availableTags = useMemo(() => {
    const s = new Set<string>();
    graph.nodes.forEach((n) => n.actor.tags?.forEach((t) => s.add(t)));
    return Array.from(s);
  }, [graph.nodes]);

  const currentStepLabel = useMemo(() => {
    const last = activeSlice[activeSlice.length - 1];
    if (!last) return t('noEventsYet');
    const name = last.payload.actor.handle
      ? `@${localizeHandle(last.payload.actor.handle, lang)}`
      : localizeFlowActorName(last.payload.actor, lang);
    return t('eventStepLabel', {
      cur: activeSlice.length,
      total: liveEvents.length,
      stage: localizeFlowStageLabel(last.payload.stage_label, lang),
      name,
    });
  }, [activeSlice, liveEvents.length, lang, t]);

  const handleTogglePlay = () => {
    if (liveEvents.length === 0) return;
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    setIsLiveMode(false);
    if (replayIndex >= liveEvents.length) {
      setReplayIndex(1);
    }
    setIsPlaying(true);
  };

  return (
    <div className="h-screen flex flex-col bg-[var(--bg)] text-[var(--ink)] overflow-hidden">
      {/* Independent Flow Map Top Bar */}
      <header className="h-14 shrink-0 px-4 sm:px-5 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-4 z-30">
        {/* Zone 1: Flow Map Brand + Room Selector */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            <GitBranch className="w-4 h-4 text-[var(--accent)]" />
            <span className="font-display text-[17px] font-semibold text-[var(--ink)] whitespace-nowrap">
              AI Flow Map
            </span>
          </div>

          <select
            aria-label={t('flowRoomAria')}
            value={selectedRoomId}
            onChange={(e) => setSelectedRoomId(e.target.value)}
            className="max-w-[200px] sm:max-w-[260px] px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-xs font-medium text-[var(--ink)] truncate focus:outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {localizeRoomTitle(r.title, lang)}
              </option>
            ))}
          </select>
        </div>

        {/* Zone 2: Flow Map | Swimlane */}
        <nav className="hidden md:flex items-center gap-6 h-full">
          {(
            [
              { id: 'map', label: t('flowTabMap') },
              { id: 'swimlane', label: t('flowTabSwimlane') },
            ] as const
          ).map((tab) => {
            const active = viewTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setViewTab(tab.id)}
                className={`relative h-full inline-flex items-center text-[13.5px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'text-[var(--accent)]'
                    : 'text-[var(--ink-secondary)] hover:text-[var(--ink)]'
                }`}
              >
                {tab.label}
                {active && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--accent)] rounded-full" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Language + Theme switch + Back to Research Lab */}
        <div className="flex items-center gap-2 shrink-0">
          <LanguageSelector compact />

          <button
            type="button"
            onClick={onToggleTheme}
            title={t('flowThemeTitle')}
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
            onClick={() => onSwitchToLab(selectedRoomId)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-ink)] text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
          >
            {t('openChatBtn')}
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Stage + Right Slide-In Inspector (Zero Overlap!) */}
      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        {/* Quick Filter Bar floating top-right of canvas */}
        {viewTab === 'map' && (
          <div className="absolute right-4 top-3 z-20 flex items-center gap-2">
            {availableTags.length > 0 && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-xl border border-[var(--border)] bg-[var(--surface)]/92 text-xs">
                <Filter className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
                <select
                  aria-label={t('filterTagAria')}
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  className="bg-transparent text-xs text-[var(--ink)] focus:outline-none cursor-pointer"
                >
                  <option value="all">{t('filterAllTags')}</option>
                  {availableTags.map((tg) => (
                    <option key={tg} value={tg}>
                      #{tg}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              type="button"
              onClick={() => setOnlyEnabled((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-colors cursor-pointer ${
                onlyEnabled
                  ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)]'
                  : 'bg-[var(--surface)]/92 border-[var(--border)] text-[var(--ink-secondary)] hover:text-[var(--ink)]'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              {t('onlyEnabledAi')}
            </button>
          </div>
        )}

        {/* Active View: Flow Map SVG or Swimlane Gantt */}
        {viewTab === 'map' ? (
          <FlowCanvasSvg
            graph={graph}
            onlyEnabled={onlyEnabled}
            tagFilter={tagFilter}
            selectedNodeId={inspector?.type === 'node' ? inspector.node.id : null}
            selectedEdgeId={inspector?.type === 'edge' ? inspector.edge.id : null}
            onSelectNode={(node) => {
              setInspector({ type: 'node', node });
              setShowRawDetails(false);
            }}
            onSelectEdge={(edge, fromNode, toNode) => {
              setInspector({ type: 'edge', edge, fromNode, toNode });
              setShowRawDetails(false);
            }}
            isLivePlaying={isPlaying}
          />
        ) : (
          <SwimlaneView
            graph={graph}
            selectedNodeId={inspector?.type === 'node' ? inspector.node.id : null}
            onSelectNode={(node) => {
              setInspector({ type: 'node', node });
              setShowRawDetails(false);
            }}
          />
        )}

        {/* Docked Right Inspector Drawer (never covers stage nodes) */}
        {inspector && (
          <aside
            aria-label={t('inspectorDrawerAria')}
            className="w-[340px] shrink-0 h-full border-l border-[var(--border)] bg-[var(--surface)] flex flex-col z-20 shadow-[var(--shadow-float)]"
          >
            <div className="px-4 py-3.5 border-b border-[var(--border)] flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-[var(--ink-muted)]">
                  {inspector.type === 'edge' ? t('inspectorEdge') : t('inspectorNode')}
                </div>
                <h3 className="font-display text-[15.5px] font-semibold text-[var(--ink)] mt-0.5 leading-snug">
                  {inspector.type === 'edge'
                    ? `${inspector.fromNode.actor.handle ? `@${localizeHandle(inspector.fromNode.actor.handle, lang)}` : localizeFlowActorName(inspector.fromNode.actor, lang)} → ${
                        inspector.toNode.actor.handle ? `@${localizeHandle(inspector.toNode.actor.handle, lang)}` : localizeFlowActorName(inspector.toNode.actor, lang)
                      }`
                    : inspector.node.actor.handle
                    ? `@${localizeHandle(inspector.node.actor.handle, lang)}`
                    : localizeFlowActorName(inspector.node.actor, lang)}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInspector(null)}
                className="p-1 rounded-md text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-subtle)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-[13px]">
              {inspector.type === 'edge' ? (
                <>
                  {inspector.edge.anonymizedAs && (
                    <div className="p-3 rounded-xl bg-[var(--accent-soft)] border border-[var(--accent)]/40 text-xs text-[var(--accent)] flex items-start gap-2">
                      <Shield className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        {t('maskedAsNote', { alias: inspector.edge.anonymizedAs })}
                      </span>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-[var(--ink-secondary)]">
                      {t('transferredSummary')}
                    </div>
                    <p className="text-[var(--ink)] leading-relaxed">
                      {inspector.edge.summary ||
                        inspector.fromNode.summary1Line ||
                        t('transferredFallback')}
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-[var(--ink-muted)]">{t('transferKind')}</span>
                      <span className="font-mono-num text-[var(--ink)]">{inspector.edge.kind}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--ink-muted)]">{t('contextLength')}</span>
                      <span className="font-mono-num text-[var(--ink)]">
                        {t('charsUnit', { chars: inspector.edge.chars.toLocaleString(locale) })}
                      </span>
                    </div>
                    {inspector.edge.sourceIds && inspector.edge.sourceIds.length > 0 && (
                      <div className="flex justify-between">
                        <span className="text-[var(--ink-muted)]">{t('attachedSources')}</span>
                        <span className="font-mono-num text-[var(--accent)]">
                          {inspector.edge.sourceIds.map((s) => `[${s}]`).join(' ')}
                        </span>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowRawDetails((v) => !v)}
                    className="w-full py-2 px-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] hover:border-[var(--accent)] text-xs font-medium text-[var(--ink)] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Code2 className="w-3.5 h-3.5 text-[var(--accent)]" />
                    {showRawDetails ? t('hideSentText') : t('viewSentText')}
                  </button>

                  {showRawDetails && (
                    <pre className="p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)] text-[11.5px] font-mono-num text-[var(--ink-secondary)] whitespace-pre-wrap leading-relaxed overflow-x-auto">
                      {inspector.fromNode.content || inspector.fromNode.summary1Line}
                    </pre>
                  )}
                </>
              ) : (
                <>
                  {inspector.node.warningMessage && (
                    <div className="p-3 rounded-xl bg-[var(--warn-soft)] border border-[var(--warn)]/40 text-xs text-[var(--warn)] flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{inspector.node.warningMessage}</span>
                    </div>
                  )}

                  {inspector.node.errorMessage && (
                    <div className="p-3 rounded-xl bg-[var(--danger-soft)] border border-[var(--danger)]/40 text-xs text-[var(--danger)]">
                      {inspector.node.errorMessage}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-[var(--ink-secondary)]">
                      {t('nodeKeyPoint', { stage: inspector.node.stageLabel })}
                    </div>
                    <p className="text-[var(--ink)] leading-relaxed">
                      {inspector.node.summary1Line || t('noSummaryYet')}
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-[var(--ink-muted)]">{t('statusLabel')}</span>
                      <span
                        className="font-semibold"
                        style={{
                          color:
                            inspector.node.status === 'completed'
                              ? 'var(--ok)'
                              : inspector.node.status === 'running'
                              ? 'var(--accent)'
                              : 'var(--ink-muted)',
                        }}
                      >
                        {inspector.node.status === 'disabled'
                          ? t('statusDisabled')
                          : inspector.node.status === 'running'
                          ? t('statusRunning')
                          : inspector.node.status === 'completed'
                          ? t('statusCompleted')
                          : t('statusError')}
                      </span>
                    </div>
                    {inspector.node.laneId && (
                      <div className="flex justify-between">
                        <span className="text-[var(--ink-muted)]">{t('workerLaneLabel')}</span>
                        <span className="font-mono-num text-[var(--ink)]">
                          {inspector.node.laneId}
                        </span>
                      </div>
                    )}
                    {inspector.node.elapsedSec !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-[var(--ink-muted)]">{t('elapsedLabel')}</span>
                        <span className="font-mono-num text-[var(--ink)]">
                          {inspector.node.elapsedSec.toFixed(1)}s
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-[var(--ink-muted)]">{t('inputsReadLabel')}</span>
                      <span className="font-mono-num text-[var(--ink)]">
                        {t('streamsUnit', { count: inspector.node.inputs.length })}
                      </span>
                    </div>
                  </div>

                  {inspector.node.inputs.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-xs font-semibold text-[var(--ink-secondary)]">
                        {t('inputsListTitle')}
                      </div>
                      <ul className="space-y-1 text-xs text-[var(--ink-secondary)]">
                        {inspector.node.inputs.map((inp, i) => (
                          <li
                            key={i}
                            className="px-2.5 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] flex items-center justify-between gap-2"
                          >
                            <span className="truncate font-mono-num text-[11px]">
                              {inp.anonymized_as || inp.from_node_id}
                            </span>
                            <span className="font-mono-num text-[11px] text-[var(--ink-muted)] shrink-0">
                              {t('charsUnit', { chars: inp.chars })}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowRawDetails((v) => !v)}
                    className="w-full py-2 px-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] hover:border-[var(--accent)] text-xs font-medium text-[var(--ink)] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Code2 className="w-3.5 h-3.5 text-[var(--accent)]" />
                    {showRawDetails ? t('hideRawJson') : t('viewRawJson')}
                  </button>

                  {showRawDetails && (
                    <div className="space-y-2">
                      <div className="p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)] text-xs text-[var(--ink)] whitespace-pre-wrap leading-relaxed">
                        {inspector.node.content}
                      </div>
                      <pre className="p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)] text-[11px] font-mono-num text-[var(--ink-secondary)] overflow-x-auto">
                        {JSON.stringify(
                          inspector.node.rawEvents[inspector.node.rawEvents.length - 1],
                          null,
                          2
                        )}
                      </pre>
                    </div>
                  )}
                </>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Bottom Replay & LIVE Control Strip */}
      <footer className="shrink-0 px-4 sm:px-5 py-2.5 border-t border-[var(--border)] bg-[var(--surface)] flex flex-wrap items-center justify-between gap-3 z-20">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleTogglePlay}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-semibold hover:bg-[var(--accent-hover)] whitespace-nowrap cursor-pointer"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {isPlaying ? t('pauseBtn') : t('playBtn')}
          </button>

          <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
            <button
              type="button"
              onClick={() => {
                setIsPlaying(false);
                setIsLiveMode(false);
                setReplayIndex((i) => Math.max(1, i - 1));
              }}
              title={t('stepBackTitle')}
              className="p-1.5 rounded-md text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:bg-[var(--surface)] cursor-pointer"
            >
              <SkipBack className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setIsPlaying(false);
                setIsLiveMode(false);
                setReplayIndex((i) => Math.min(maxStep, i + 1));
              }}
              title={t('stepFwdTitle')}
              className="p-1.5 rounded-md text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:bg-[var(--surface)] cursor-pointer"
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Scrubber & Step description */}
        <div className="flex-1 min-w-[200px] max-w-xl flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="text-[var(--ink-secondary)] truncate">{currentStepLabel}</span>
            <button
              type="button"
              onClick={() => {
                setIsPlaying(false);
                setIsLiveMode(true);
                setReplayIndex(liveEvents.length);
              }}
              className={`inline-flex items-center gap-1 font-mono-num text-[11px] font-semibold shrink-0 ml-2 cursor-pointer ${
                isLiveMode ? 'text-[var(--ok)]' : 'text-[var(--ink-muted)] hover:text-[var(--accent)]'
              }`}
            >
              <Radio className="w-3 h-3" />
              {isLiveMode
                ? sseConnected
                  ? t('liveWatching')
                  : 'LIVE'
                : t('backToLive')}
            </button>
          </div>
          <input
            type="range"
            min={1}
            max={Math.max(1, maxStep)}
            value={Math.min(Math.max(1, replayIndex), Math.max(1, maxStep))}
            onChange={(e) => {
              setIsPlaying(false);
              setIsLiveMode(false);
              setReplayIndex(Number(e.target.value));
            }}
            className="w-full h-1.5 accent-[var(--accent)] cursor-pointer"
          />
        </div>

        {/* Speed picker */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[var(--ink-muted)] hidden sm:inline">{t('speedLabel')}</span>
          <select
            aria-label={t('speedLabel')}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="px-2 py-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] font-mono-num text-xs text-[var(--ink)] cursor-pointer"
          >
            <option value={0.5}>0.5×</option>
            <option value={1}>1.0×</option>
            <option value={1.5}>1.5×</option>
            <option value={2}>2.0×</option>
          </select>
        </div>
      </footer>
    </div>
  );
}
