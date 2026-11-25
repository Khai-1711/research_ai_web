import React, { useMemo, useRef, useState } from 'react';
import { Maximize2, Minus, Plus, Shield } from 'lucide-react';
import type { FlowActor, FlowEvent, FlowInputEdge } from '../types.ts';
import { getPerspectiveColorVar } from '../utils/themeAndExport.ts';
import {
  localizeFlowActorName,
  localizeFlowStageLabel,
  localizeHandle,
  translate,
  type UiLanguage,
  useI18n,
} from '../utils/i18n.tsx';

export interface GraphNode {
  id: string;
  stageIndex: number;
  stageLabel: string;
  actor: FlowActor;
  status: 'disabled' | 'queued' | 'running' | 'completed' | 'failed';
  summary1Line: string;
  content: string;
  warningMessage?: string;
  errorMessage?: string;
  inputs: FlowInputEdge[];
  laneId?: string;
  elapsedSec?: number;
  startedOffsetSec?: number;
  fallbackFrom?: string;
  rawEvents: FlowEvent[];
}

export interface GraphEdge {
  id: string;
  fromId: string;
  toId: string;
  fromStage: number;
  toStage: number;
  kind: FlowInputEdge['kind'];
  anonymizedAs?: string;
  chars: number;
  summary?: string;
  sourceIds?: string[];
  active: boolean; // animated particle while target running or just completed
}

export interface FlowGraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stages: Array<{ index: number; label: string; nodeIds: string[] }>;
}

export function buildGraphFromEvents(events: FlowEvent[], lang: UiLanguage = 'vi'): FlowGraphModel {
  const nodeMap = new Map<string, GraphNode>();

  for (const ev of events) {
    const p = ev.payload;
    if (ev.event_type === 'run_aborted') continue;

    // Seed disabled participants from run_started so user immediately sees who is excluded!
    if (ev.event_type === 'run_started' && p.participants) {
      const targetStage = p.pattern === 'research' ? 2 : 1;
      const targetLabel =
        p.pattern === 'debate' ? translate(lang, 'flowRound0Debate') : translate(lang, 'flowCouncilStage');
      for (const part of p.participants) {
        if (!part.enabled) {
          const disabledId = `disabled_${part.id}`;
          if (!nodeMap.has(disabledId)) {
            const displayHandle = localizeHandle(part.handle || part.name, lang);
            nodeMap.set(disabledId, {
              id: disabledId,
              stageIndex: targetStage,
              stageLabel: targetLabel,
              actor: { ...part, name: localizeFlowActorName(part, lang) },
              status: 'disabled',
              summary1Line: translate(lang, 'flowDisabledSummary'),
              content: translate(lang, 'flowDisabledContent', { handle: displayHandle }),
              inputs: [],
              rawEvents: [ev],
            });
          }
        }
      }
    }

    const existing = nodeMap.get(p.node_id);
    const statusFromEvent: GraphNode['status'] =
      ev.event_type === 'run_started'
        ? 'completed'
        : ev.event_type === 'node_started'
        ? 'running'
        : ev.event_type === 'node_completed'
        ? 'completed'
        : ev.event_type === 'node_failed'
        ? 'failed'
        : existing?.status ?? 'running';

    const rawStage = p.stage_label || existing?.stageLabel;
    const localizedStage = rawStage
      ? localizeFlowStageLabel(rawStage, lang)
      : translate(lang, 'flowStageFallback', { idx: p.stage_index });
    const rawActor = p.actor || existing?.actor;

    const merged: GraphNode = {
      id: p.node_id,
      stageIndex: p.stage_index,
      stageLabel: localizedStage,
      actor: rawActor ? { ...rawActor, name: localizeFlowActorName(rawActor, lang) } : rawActor,
      status: ev.event_type === 'node_warning' ? existing?.status ?? 'running' : statusFromEvent,
      summary1Line: p.summary_1line || existing?.summary1Line || '',
      content: p.content || existing?.content || '',
      warningMessage: p.warning_message || existing?.warningMessage,
      errorMessage: p.error_message || existing?.errorMessage,
      inputs: p.inputs && p.inputs.length > 0 ? p.inputs : existing?.inputs ?? [],
      laneId: p.transport?.lane_id || existing?.laneId,
      elapsedSec: p.transport?.elapsed_s ?? existing?.elapsedSec,
      startedOffsetSec: p.transport?.started_offset_s ?? existing?.startedOffsetSec,
      fallbackFrom: p.transport?.fallback_from || existing?.fallbackFrom,
      rawEvents: existing ? [...existing.rawEvents, ev] : [ev],
    };

    nodeMap.set(p.node_id, merged);
  }

  const nodes = Array.from(nodeMap.values());
  const stageMap = new Map<number, { index: number; label: string; nodeIds: string[] }>();

  for (const n of nodes) {
    const s = stageMap.get(n.stageIndex);
    if (!s) {
      stageMap.set(n.stageIndex, { index: n.stageIndex, label: n.stageLabel, nodeIds: [n.id] });
    } else {
      s.nodeIds.push(n.id);
      if (n.status !== 'disabled') s.label = n.stageLabel;
    }
  }

  // Sort nodes inside each stage: active first, disabled at bottom
  const stages = Array.from(stageMap.values())
    .sort((a, b) => a.index - b.index)
    .map((s) => ({
      ...s,
      nodeIds: s.nodeIds.sort((idA, idB) => {
        const a = nodeMap.get(idA)!;
        const b = nodeMap.get(idB)!;
        if (a.status === 'disabled' && b.status !== 'disabled') return 1;
        if (a.status !== 'disabled' && b.status === 'disabled') return -1;
        return 0;
      }),
    }));

  const edges: GraphEdge[] = [];
  for (const n of nodes) {
    if (n.status === 'disabled') continue;
    for (const inp of n.inputs) {
      const fromNode = nodeMap.get(inp.from_node_id);
      if (!fromNode) continue;
      edges.push({
        id: `${inp.from_node_id}__${n.id}`,
        fromId: inp.from_node_id,
        toId: n.id,
        fromStage: fromNode.stageIndex,
        toStage: n.stageIndex,
        kind: inp.kind,
        anonymizedAs: inp.anonymized_as || undefined,
        chars: inp.chars,
        summary: inp.summary,
        sourceIds: inp.source_ids,
        active: n.status === 'running' || n.status === 'completed',
      });
    }
  }

  return { nodes, edges, stages };
}

interface FlowCanvasSvgProps {
  graph: FlowGraphModel;
  onlyEnabled: boolean;
  tagFilter: string;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onSelectNode: (node: GraphNode) => void;
  onSelectEdge: (edge: GraphEdge, fromNode: GraphNode, toNode: GraphNode) => void;
  isLivePlaying: boolean;
}

export function FlowCanvasSvg({
  graph,
  onlyEnabled,
  tagFilter,
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
  isLivePlaying,
}: FlowCanvasSvgProps) {
  const { lang, t } = useI18n();
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; origX: number; origY: number }>({
    active: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });

  // Filter nodes when user toggles "Chỉ hiện AI đang bật" or #tag
  const visibleNodeIds = useMemo(() => {
    const set = new Set<string>();
    for (const n of graph.nodes) {
      if (onlyEnabled && n.status === 'disabled') continue;
      if (
        tagFilter !== 'all' &&
        n.actor.kind === 'ai' &&
        !(n.actor.tags ?? []).includes(tagFilter)
      ) {
        continue;
      }
      set.add(n.id);
    }
    return set;
  }, [graph.nodes, onlyEnabled, tagFilter]);

  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode>();
    graph.nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [graph.nodes]);

  const maxStageNodes = useMemo(() => {
    let m = 1;
    for (const s of graph.stages) {
      const count = s.nodeIds.filter((id) => visibleNodeIds.has(id)).length;
      if (count > m) m = count;
    }
    return m;
  }, [graph.stages, visibleNodeIds]);

  // Adaptive card sizing: 1-4 AI full cards, 5+ AI compact 1-line cards
  const compactMode = maxStageNodes >= 5;
  const nodeW = compactMode ? 212 : 228;
  const nodeH = compactMode ? 54 : 80;
  const rowGap = compactMode ? 12 : 18;
  const colGap = 112;
  const padX = 48;
  const padTop = 64;

  // Compute node positions centered vertically per stage column
  const layout = useMemo(() => {
    const activeStages = graph.stages.filter((s) =>
      s.nodeIds.some((id) => visibleNodeIds.has(id))
    );
    const maxColHeight = maxStageNodes * nodeH + Math.max(0, maxStageNodes - 1) * rowGap;
    const totalH = Math.max(460, maxColHeight + padTop + 56);
    const totalW = Math.max(920, padX * 2 + activeStages.length * nodeW + Math.max(0, activeStages.length - 1) * colGap);

    const pos = new Map<string, { x: number; y: number; cx: number; cy: number }>();
    const stageX = new Map<number, number>();

    activeStages.forEach((stage, colIdx) => {
      const x = padX + colIdx * (nodeW + colGap);
      stageX.set(stage.index, x);
      const ids = stage.nodeIds.filter((id) => visibleNodeIds.has(id));
      const colH = ids.length * nodeH + Math.max(0, ids.length - 1) * rowGap;
      const startY = padTop + (totalH - padTop - 40 - colH) / 2;

      ids.forEach((id, rowIdx) => {
        const y = startY + rowIdx * (nodeH + rowGap);
        pos.set(id, { x, y, cx: x + nodeW / 2, cy: y + nodeH / 2 });
      });
    });

    return { pos, stageX, activeStages, totalW, totalH };
  }, [graph.stages, visibleNodeIds, maxStageNodes, nodeH, rowGap, nodeW]);

  // Focus Highlight: compute connected node & edge sets when hovering any node or edge
  const focusSet = useMemo(() => {
    const activeTarget = hoveredNodeId || selectedNodeId;
    if (!activeTarget && !hoveredEdgeId) return null;

    const nodes = new Set<string>();
    const edges = new Set<string>();

    if (hoveredEdgeId) {
      const e = graph.edges.find((x) => x.id === hoveredEdgeId);
      if (e) {
        edges.add(e.id);
        nodes.add(e.fromId);
        nodes.add(e.toId);
      }
      return { nodes, edges };
    }

    if (activeTarget) {
      nodes.add(activeTarget);
      // Traverse upstream & downstream connected path
      const walk = (start: string, dir: 'up' | 'down') => {
        const stack = [start];
        const seen = new Set<string>([start]);
        while (stack.length > 0) {
          const cur = stack.pop()!;
          for (const e of graph.edges) {
            if (dir === 'up' && e.toId === cur && !seen.has(e.fromId)) {
              seen.add(e.fromId);
              nodes.add(e.fromId);
              edges.add(e.id);
              stack.push(e.fromId);
            }
            if (dir === 'down' && e.fromId === cur && !seen.has(e.toId)) {
              seen.add(e.toId);
              nodes.add(e.toId);
              edges.add(e.id);
              stack.push(e.toId);
            }
          }
        }
      };
      walk(activeTarget, 'up');
      walk(activeTarget, 'down');
    }
    return { nodes, edges };
  }, [hoveredNodeId, hoveredEdgeId, selectedNodeId, graph.edges]);

  // Detect stage-pair density to choose Bezier vs Convergence Bus (N->1) vs Exchange Bus (N x N)
  const visibleEdges = useMemo(
    () => graph.edges.filter((e) => visibleNodeIds.has(e.fromId) && visibleNodeIds.has(e.toId)),
    [graph.edges, visibleNodeIds]
  );

  const stagePairMetrics = useMemo(() => {
    const map = new Map<
      string,
      {
        count: number;
        fromSet: Set<string>;
        toSet: Set<string>;
        hasAnon: boolean;
        minY: number;
        maxY: number;
        busX: number;
      }
    >();

    for (const e of visibleEdges) {
      const p1 = layout.pos.get(e.fromId);
      const p2 = layout.pos.get(e.toId);
      if (!p1 || !p2) continue;
      const key = `${e.fromStage}->${e.toStage}`;
      let m = map.get(key);
      if (!m) {
        m = {
          count: 0,
          fromSet: new Set(),
          toSet: new Set(),
          hasAnon: false,
          minY: Math.min(p1.cy, p2.cy),
          maxY: Math.max(p1.cy, p2.cy),
          busX: (p1.x + nodeW + p2.x) / 2,
        };
        map.set(key, m);
      }
      m.count++;
      m.fromSet.add(e.fromId);
      m.toSet.add(e.toId);
      if (e.anonymizedAs) m.hasAnon = true;
      m.minY = Math.min(m.minY, p1.cy, p2.cy);
      m.maxY = Math.max(m.maxY, p1.cy, p2.cy);
    }
    return map;
  }, [visibleEdges, layout.pos, nodeW]);

  const buildEdgePath = (e: GraphEdge): { d: string; midX: number; midY: number } | null => {
    const p1 = layout.pos.get(e.fromId);
    const p2 = layout.pos.get(e.toId);
    if (!p1 || !p2) return null;

    const x1 = p1.x + nodeW;
    const y1 = p1.cy;
    const x2 = p2.x;
    const y2 = p2.cy;

    const pair = stagePairMetrics.get(`${e.fromStage}->${e.toStage}`);
    const useConvergenceBus = pair && pair.fromSet.size >= 4 && pair.toSet.size === 1;
    const useExchangeBus = pair && pair.count > 8 && pair.fromSet.size >= 3 && pair.toSet.size >= 3;

    if (useConvergenceBus || useExchangeBus) {
      const bx = pair!.busX;
      const r = 10;
      const dy1 = y2 === y1 ? 0 : y2 > y1 ? r : -r;
      if (Math.abs(y2 - y1) < 20) {
        return { d: `M ${x1} ${y1} L ${x2} ${y2}`, midX: bx, midY: (y1 + y2) / 2 };
      }
      const d = `M ${x1} ${y1} L ${bx - r} ${y1} Q ${bx} ${y1} ${bx} ${y1 + dy1} L ${bx} ${y2 - dy1} Q ${bx} ${y2} ${bx + r} ${y2} L ${x2} ${y2}`;
      return { d, midX: bx, midY: (y1 + y2) / 2 };
    }

    const dx = Math.max(44, (x2 - x1) * 0.52);
    const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    return { d, midX: (x1 + x2) / 2, midY: (y1 + y2) / 2 };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-interactive="true"]')) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: pan.x,
      origY: pan.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    setPan({
      x: dragRef.current.origX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.origY + (e.clientY - dragRef.current.startY),
    });
  };

  const handleMouseUp = () => {
    dragRef.current.active = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom((z) => Math.max(0.5, Math.min(1.8, Number((z + delta).toFixed(2)))));
    }
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div
      className="relative flex-1 overflow-hidden bg-[var(--bg)] select-none cursor-grab active:cursor-grabbing"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      {/* Subtle architectural dot grid background */}
      <div
        className="absolute inset-0 pointer-events-none opacity-45"
        style={{
          backgroundImage: 'radial-gradient(var(--border-strong) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
        }}
      />

      {/* Zoom & Fit Controls (bottom-left above replay bar) */}
      <div
        data-interactive="true"
        className="absolute left-4 bottom-4 z-20 flex items-center gap-1 p-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-card)]"
      >
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.15).toFixed(2))))}
          title={t('canvasZoomOut')}
          className="p-1.5 rounded-lg text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink)] cursor-pointer"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span className="px-2 text-[11.5px] font-mono-num text-[var(--ink-secondary)]">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(1.8, Number((z + 0.15).toFixed(2))))}
          title={t('canvasZoomIn')}
          className="p-1.5 rounded-lg text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink)] cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <span className="w-px h-4 bg-[var(--border)] mx-0.5" />
        <button
          type="button"
          onClick={resetView}
          title={t('canvasFitScreenTitle')}
          className="px-2 py-1 rounded-lg text-[11.5px] font-medium text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink)] inline-flex items-center gap-1 cursor-pointer"
        >
          <Maximize2 className="w-3 h-3" />
          {t('canvasFitScreenBtn')}
        </button>
      </div>

      {/* Interactive SVG Stage */}
      {graph.nodes.length === 0 ? (
        <div className="w-full h-full flex items-center justify-center p-8 relative z-10">
          <div className="max-w-md text-center p-6 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)]/85 space-y-2">
            <p className="font-display text-base font-semibold text-[var(--ink)]">
              {t('canvasEmptyTitle')}
            </p>
            <p className="text-xs text-[var(--ink-secondary)] leading-relaxed">
              {t('canvasEmptyHint')}
            </p>
          </div>
        </div>
      ) : (
        <div
          className="w-full h-full flex items-center justify-center transition-transform duration-75"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
          }}
        >
        <svg
          width={layout.totalW}
          height={layout.totalH}
          viewBox={`0 0 ${layout.totalW} ${layout.totalH}`}
          className="overflow-visible"
        >
          <defs>
            <marker
              id="flow-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="var(--border-strong)" />
            </marker>
            <marker
              id="flow-arrow-accent"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="var(--accent)" />
            </marker>
          </defs>

          {/* Stage Column Headers */}
          {layout.activeStages.map((stage, idx) => {
            const x = layout.stageX.get(stage.index) ?? 0;
            return (
              <g key={`stage-hdr-${stage.index}`}>
                <text
                  x={x + nodeW / 2}
                  y={28}
                  textAnchor="middle"
                  fill="var(--ink-muted)"
                  fontSize="11"
                  fontWeight="600"
                  letterSpacing="0.04em"
                >
                  {t('canvasStagePrefix', { idx, label: stage.label.toUpperCase() })}
                </text>
                <line
                  x1={x + 12}
                  y1={38}
                  x2={x + nodeW - 12}
                  y2={38}
                  stroke="var(--border)"
                  strokeWidth="1"
                />
              </g>
            );
          })}

          {/* Exchange Bus / Convergence Bus visual backbone rails */}
          {Array.from(stagePairMetrics.entries()).map(([key, m]) => {
            const isBus =
              (m.fromSet.size >= 4 && m.toSet.size === 1) ||
              (m.count > 8 && m.fromSet.size >= 3 && m.toSet.size >= 3);
            if (!isBus) return null;
            const midY = (m.minY + m.maxY) / 2;
            return (
              <g key={`bus-${key}`} className="pointer-events-none">
                <line
                  x1={m.busX}
                  y1={m.minY}
                  x2={m.busX}
                  y2={m.maxY}
                  stroke="var(--border-strong)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  opacity={focusSet ? 0.25 : 0.75}
                />
                {m.hasAnon && (
                  <g transform={`translate(${m.busX - 24}, ${midY - 12})`}>
                    <rect
                      width="48"
                      height="24"
                      rx="12"
                      fill="var(--surface)"
                      stroke="var(--accent)"
                      strokeWidth="1.5"
                    />
                    <text
                      x="24"
                      y="15.5"
                      textAnchor="middle"
                      fontSize="10.5"
                      fontWeight="600"
                      fill="var(--accent)"
                    >
                      {t('canvasMaskedBadge')}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Edges (with wide 16px invisible hit area + animated glowing particles!) */}
          {visibleEdges.map((edge) => {
            const geom = buildEdgePath(edge);
            if (!geom) return null;
            const fromNode = nodeById.get(edge.fromId)!;
            const toNode = nodeById.get(edge.toId)!;

            const isSelected = selectedEdgeId === edge.id;
            const isHovered = hoveredEdgeId === edge.id;
            const isInFocus = !focusSet || focusSet.edges.has(edge.id);
            const opacity = isSelected || isHovered ? 1 : isInFocus ? 0.82 : 0.16;

            const strokeColor =
              isSelected || isHovered || (focusSet && focusSet.edges.has(edge.id))
                ? 'var(--accent)'
                : toNode.status === 'running'
                ? 'var(--accent)'
                : 'var(--border-strong)';

            const showParticle =
              (toNode.status === 'running' || (isLivePlaying && isInFocus)) &&
              opacity > 0.3;

            return (
              <g
                key={edge.id}
                data-interactive="true"
                className="cursor-pointer transition-opacity duration-150"
                style={{ opacity }}
                onMouseEnter={() => setHoveredEdgeId(edge.id)}
                onMouseLeave={() => setHoveredEdgeId(null)}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onSelectEdge(edge, fromNode, toNode);
                }}
              >
                {/* Wide 16px invisible hit path so users never struggle clicking a thin wire */}
                <path d={geom.d} fill="none" stroke="transparent" strokeWidth={16} />

                {/* Visible curve */}
                <path
                  d={geom.d}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={isSelected || isHovered ? 2.6 : 1.75}
                  strokeDasharray={toNode.status === 'running' ? '6 5' : undefined}
                  className={toNode.status === 'running' ? 'animate-dash-flow' : undefined}
                  markerEnd={
                    strokeColor === 'var(--accent)'
                      ? 'url(#flow-arrow-accent)'
                      : 'url(#flow-arrow)'
                  }
                />

                {/* Glowing data particle traveling along the wire */}
                {showParticle && (
                  <circle r="3.6" fill="var(--accent)">
                    <animateMotion
                      dur={toNode.status === 'running' ? '1.35s' : '2.6s'}
                      repeatCount="indefinite"
                      path={geom.d}
                    />
                  </circle>
                )}

                {/* Individual anonymization label if not on a converged bus */}
                {edge.anonymizedAs &&
                  !(stagePairMetrics.get(`${edge.fromStage}->${edge.toStage}`)?.fromSet.size ?? 0 >= 4) && (
                    <g transform={`translate(${geom.midX - 28}, ${geom.midY - 10})`}>
                      <rect
                        width="56"
                        height="19"
                        rx="9.5"
                        fill="var(--surface)"
                        stroke="var(--accent)"
                        strokeWidth="1"
                      />
                      <text
                        x="28"
                        y="12.5"
                        textAnchor="middle"
                        fontSize="9.5"
                        fontWeight="600"
                        fill="var(--accent)"
                      >
                        {edge.anonymizedAs}
                      </text>
                    </g>
                  )}
              </g>
            );
          })}

          {/* Nodes */}
          {graph.nodes
            .filter((n) => visibleNodeIds.has(n.id))
            .map((node) => {
              const p = layout.pos.get(node.id);
              if (!p) return null;

              const isDisabled = node.status === 'disabled';
              const isRunning = node.status === 'running';
              const isSelected = selectedNodeId === node.id;
              const isInFocus = !focusSet || focusSet.nodes.has(node.id);
              const opacity = isDisabled
                ? focusSet
                  ? 0.16
                  : 0.42
                : isSelected
                ? 1
                : isInFocus
                ? 1
                : 0.22;

              const accentColor =
                node.actor.kind === 'output'
                  ? 'var(--ok)'
                  : node.actor.kind === 'user' || node.actor.kind === 'planner'
                  ? 'var(--accent)'
                  : getPerspectiveColorVar(node.actor.colorIndex);

              const borderColor = isSelected
                ? 'var(--accent)'
                : isRunning
                ? 'var(--accent)'
                : node.status === 'failed'
                ? 'var(--danger)'
                : node.warningMessage
                ? 'var(--warn)'
                : isDisabled
                ? 'var(--border)'
                : 'var(--border-strong)';

              const titleText = node.actor.handle ? `@${localizeHandle(node.actor.handle, lang)}` : node.actor.name;
              const statusTag = isDisabled
                ? t('canvasStatusDisabled')
                : isRunning
                ? t('canvasStatusRunning', { time: node.elapsedSec ? `${node.elapsedSec.toFixed(1)}s` : '…' })
                : node.status === 'failed'
                ? t('canvasStatusFailed')
                : node.elapsedSec !== undefined
                ? `${node.elapsedSec.toFixed(1)}s`
                : t('canvasStatusDone');

              return (
                <g
                  key={node.id}
                  data-interactive="true"
                  transform={`translate(${p.x}, ${p.y})`}
                  className="cursor-pointer transition-opacity duration-150"
                  style={{ opacity }}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onSelectNode(node);
                  }}
                >
                  <rect
                    width={nodeW}
                    height={nodeH}
                    rx="12"
                    fill="var(--surface)"
                    stroke={borderColor}
                    strokeWidth={isSelected || isRunning ? 2 : 1.25}
                    strokeDasharray={isRunning ? '6 4' : isDisabled ? '3 3' : undefined}
                    className={isRunning ? 'animate-node-running' : undefined}
                  />

                  {/* Subtle top color indicator dot */}
                  <circle
                    cx="15"
                    cy={compactMode ? 18 : 20}
                    r="4"
                    fill={isDisabled ? 'var(--ink-muted)' : accentColor}
                  />

                  {/* Node Name */}
                  <text
                    x="26"
                    y={compactMode ? 22 : 24}
                    fontSize="12.5"
                    fontWeight="600"
                    fill={isDisabled ? 'var(--ink-muted)' : 'var(--ink)'}
                  >
                    {titleText.length > 18 ? titleText.slice(0, 17) + '…' : titleText}
                  </text>

                  {/* Status / Elapsed Timer right-aligned */}
                  <text
                    x={nodeW - 12}
                    y={compactMode ? 22 : 24}
                    textAnchor="end"
                    fontSize="10.5"
                    fontFamily="var(--font-mono)"
                    fontWeight="600"
                    fill={
                      isRunning
                        ? 'var(--accent)'
                        : node.warningMessage
                        ? 'var(--warn)'
                        : node.status === 'failed'
                        ? 'var(--danger)'
                        : isDisabled
                        ? 'var(--ink-muted)'
                        : 'var(--ok)'
                    }
                  >
                    {statusTag}
                  </text>

                  {/* Warning amber dot if fallback/429 */}
                  {node.warningMessage && (
                    <circle cx={nodeW - 8} cy={8} r="4.5" fill="var(--warn)" />
                  )}

                  {/* Summary 1-line text */}
                  <foreignObject
                    x="12"
                    y={compactMode ? 28 : 34}
                    width={nodeW - 24}
                    height={compactMode ? 22 : 40}
                    className="pointer-events-none"
                  >
                    <div
                      className={`text-[11px] leading-[1.35] text-[var(--ink-secondary)] ${
                        compactMode ? 'truncate' : 'line-clamp-2'
                      }`}
                    >
                      {node.summary1Line ||
                        (isRunning ? t('canvasBodyRunning') : t('canvasBodyWaiting'))}
                    </div>
                  </foreignObject>
                </g>
              );
            })}
        </svg>
        </div>
      )}

      {/* Subtle Visual Legend (top-left) */}
      <div
        data-interactive="true"
        className="absolute left-4 top-3 z-20 hidden lg:flex items-center gap-4 px-3 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)]/92 backdrop-blur-xs text-[11px] text-[var(--ink-secondary)]"
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--accent)]" />
          {t('canvasLegendParticle')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3.5 h-2.5 rounded border border-dashed border-[var(--accent)]" />
          {t('canvasLegendRunning')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--ok)]" />
          {t('canvasLegendDone')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--warn)]" />
          Fallback / 429
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Shield className="w-3 h-3 text-[var(--accent)]" />
          {t('canvasLegendMasked')}
        </span>
      </div>
    </div>
  );
}
