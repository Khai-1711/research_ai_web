import React, { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { FlowGraphModel, GraphNode } from './FlowCanvasSvg.tsx';
import { getPerspectiveColorVar } from '../utils/themeAndExport.ts';

interface SwimlaneViewProps {
  graph: FlowGraphModel;
  selectedNodeId: string | null;
  onSelectNode: (node: GraphNode) => void;
}

export function SwimlaneView({ graph, selectedNodeId, onSelectNode }: SwimlaneViewProps) {
  const { lanes, maxTime } = useMemo(() => {
    const activeNodes = graph.nodes.filter((n) => n.status !== 'disabled');
    const laneMap = new Map<string, GraphNode[]>();

    let maxT = 10;
    for (const n of activeNodes) {
      const lane = n.laneId || 'acc1';
      const arr = laneMap.get(lane) ?? [];
      arr.push(n);
      laneMap.set(lane, arr);
      const end = (n.startedOffsetSec ?? 0) + Math.max(0.8, n.elapsedSec ?? 3);
      if (end > maxT) maxT = end;
    }

    const order = (name: string) => {
      if (name === 'input') return 0;
      if (name === 'retrieval') return 1;
      if (name.startsWith('acc')) return 10 + Number(name.replace('acc', '') || 0);
      if (name === 'output') return 99;
      return 50;
    };

    const sortedLanes = Array.from(laneMap.entries())
      .sort(([a], [b]) => order(a) - order(b))
      .map(([laneId, items]) => ({
        laneId,
        items: items.sort((a, b) => (a.startedOffsetSec ?? 0) - (b.startedOffsetSec ?? 0)),
      }));

    return { lanes: sortedLanes, maxTime: Math.ceil(maxT / 5) * 5 };
  }, [graph.nodes]);

  const ticks = useMemo(() => {
    const step = maxTime <= 20 ? 5 : maxTime <= 60 ? 10 : 15;
    const arr: number[] = [];
    for (let t = 0; t <= maxTime; t += step) arr.push(t);
    return arr;
  }, [maxTime]);

  return (
    <div className="flex-1 overflow-auto p-6 sm:p-8 bg-[var(--bg)]">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3 pb-4 border-b border-[var(--border)]">
          <div>
            <h2 className="font-display text-xl font-semibold text-[var(--ink)]">
              Làn thời gian theo Worker (Swimlane Timeline)
            </h2>
            <p className="text-xs text-[var(--ink-secondary)] mt-1">
              Theo dõi chính xác các đợt chạy song song trên từng tài khoản (acc1..accN), thời điểm bắt đầu và độ trễ xử lý. Bấm vào bất kỳ thanh nào để mở chi tiết.
            </p>
          </div>
          <div className="font-mono-num text-xs text-[var(--ink-muted)]">
            Tổng khung thời gian: 0s – {maxTime}s
          </div>
        </div>

        {lanes.length === 0 ? (
          <div className="p-10 rounded-xl border border-dashed border-[var(--border-strong)] text-center text-sm text-[var(--ink-muted)]">
            Chưa có dữ liệu làn chạy nào. Hãy chạy thử luồng mẫu hoặc gửi câu hỏi ở Phòng Chat.
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-card)] overflow-hidden">
            {/* Time ruler */}
            <div className="grid grid-cols-[120px_1fr] border-b border-[var(--border)] bg-[var(--bg-subtle)] text-[11px] font-mono-num text-[var(--ink-muted)]">
              <div className="px-4 py-2.5 font-semibold">Lane / Worker</div>
              <div className="relative px-4 py-2.5">
                {ticks.map((t) => (
                  <span
                    key={t}
                    className="absolute top-2.5 -translate-x-1/2"
                    style={{ left: `${(t / maxTime) * 100}%` }}
                  >
                    {t}s
                  </span>
                ))}
              </div>
            </div>

            {/* Lane rows */}
            <div className="divide-y divide-[var(--border)]">
              {lanes.map(({ laneId, items }) => (
                <div key={laneId} className="grid grid-cols-[120px_1fr] min-h-[60px] items-center">
                  <div className="px-4 py-3 font-mono-num text-xs font-semibold text-[var(--ink)] border-r border-[var(--border)] h-full flex items-center bg-[var(--bg-subtle)]/45">
                    {laneId}
                  </div>
                  <div className="relative h-14 mx-4">
                    {/* Vertical grid ticks */}
                    {ticks.map((t) => (
                      <span
                        key={t}
                        className="absolute top-0 bottom-0 w-px bg-[var(--border)]/60 pointer-events-none"
                        style={{ left: `${(t / maxTime) * 100}%` }}
                      />
                    ))}

                    {items.map((node) => {
                      const start = node.startedOffsetSec ?? 0;
                      const dur = Math.max(1.2, node.elapsedSec ?? 4);
                      const leftPct = Math.min(96, (start / maxTime) * 100);
                      const widthPct = Math.max(4, Math.min(100 - leftPct, (dur / maxTime) * 100));
                      const color = getPerspectiveColorVar(node.actor.colorIndex);
                      const selected = selectedNodeId === node.id;

                      return (
                        <button
                          key={node.id}
                          type="button"
                          onClick={() => onSelectNode(node)}
                          title={`${node.actor.handle ? `@${node.actor.handle}` : node.actor.name} · ${start}s → ${(start + dur).toFixed(1)}s`}
                          className={`absolute top-2.5 h-9 rounded-lg px-2.5 flex items-center justify-between gap-1.5 text-left transition-all cursor-pointer overflow-hidden border ${
                            selected
                              ? 'ring-2 ring-[var(--accent)] border-[var(--accent)]'
                              : 'border-transparent hover:brightness-105'
                          }`}
                          style={{
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            backgroundColor: node.warningMessage ? 'var(--warn-soft)' : 'var(--bg-subtle)',
                            borderColor: node.warningMessage ? 'var(--warn)' : color,
                          }}
                        >
                          <span
                            className="text-[11.5px] font-semibold truncate"
                            style={{ color: node.warningMessage ? 'var(--warn)' : color }}
                          >
                            {node.actor.handle ? `@${node.actor.handle}` : node.actor.name}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[10.5px] font-mono-num text-[var(--ink-secondary)] shrink-0">
                            {node.warningMessage && (
                              <AlertTriangle className="w-3 h-3 text-[var(--warn)]" />
                            )}
                            {node.elapsedSec !== undefined ? `${node.elapsedSec.toFixed(1)}s` : '…'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
