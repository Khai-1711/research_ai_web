import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Edit3,
  MessageCircle,
  Pin,
  Plus,
  Search,
  Square,
  Users,
} from 'lucide-react';
import type { ChatMessage, LaneInfo, Perspective, Room } from '../types.ts';
import { formatLaneDisplay, getPerspectiveColorVar } from '../utils/themeAndExport.ts';
import { MarkdownText } from './MarkdownText.tsx';

export interface ActiveLaneJob {
  perspectiveId: string;
  handle: string;
  colorIndex: number;
  laneId: string;
  startedAtMs: number;
  status: 'queued' | 'running' | 'done' | 'error';
  roundLabel: string;
}

interface GroupFeedProps {
  room: Room;
  laneDetails?: LaneInfo[];
  activeJobs: ActiveLaneJob[];
  nowMs: number;
  onRenameRoom?: (newTitle: string) => void;
  onStopRunning: () => void;
  onCitationClick: (sourceId: string) => void;
  onTogglePerspective: (perspectiveId: string) => void;
  onOpenRoster: () => void;
  onPinToReport: (messageId: string) => void;
  onAskRoleDirectly: (handle: string) => void;
  onComparePerspective: (perspectiveId: string) => void;
  onOpenCompare: () => void;
}

export function GroupFeed({
  room,
  laneDetails = [],
  activeJobs,
  nowMs,
  onRenameRoom,
  onStopRunning,
  onCitationClick,
  onTogglePerspective,
  onOpenRoster,
  onPinToReport,
  onAskRoleDirectly,
  onComparePerspective,
  onOpenCompare,
}: GroupFeedProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(room.title);
  useEffect(() => {
    setEditingTitle(false);
    setTitleDraft(room.title);
  }, [room.id, room.title]);
  const enabledPerspectives = room.perspectives.filter((p) => p.enabled);
  const totalN = room.perspectives.length;
  const activeCount = enabledPerspectives.length;
  const isDenseScale = totalN >= 4 || activeCount >= 4;

  // User can override density; default expanded so full research documents are immediately readable
  const [densityOverride, setDensityOverride] = useState<'auto' | 'compact' | 'expanded'>('expanded');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [filterHandle, setFilterHandle] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const useCompactCards =
    densityOverride === 'compact' || (densityOverride === 'auto' && isDenseScale);

  const validSourceIds = useMemo(() => new Set(room.sources.map((s) => s.id)), [room.sources]);

  const groupedByRound = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const filtered = room.messages.filter((m) => {
      if (m.senderType === 'ai' && filterHandle !== 'all' && m.handle !== filterHandle) {
        return false;
      }
      if (query) {
        const hay = `${m.handle ?? ''} ${m.content} ${m.summary1Line ?? ''}`.toLowerCase();
        return hay.includes(query);
      }
      return true;
    });

    const groups: Array<{ round: number; label: string; messages: ChatMessage[] }> = [];
    for (const msg of filtered) {
      let g = groups.find((x) => x.round === msg.round);
      if (!g) {
        g = { round: msg.round, label: msg.roundLabel, messages: [] };
        groups.push(g);
      }
      g.messages.push(msg);
    }
    return groups;
  }, [room.messages, filterHandle, searchTerm]);

  const toggleCard = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const runningJobs = activeJobs.filter((j) => j.status === 'running');
  const queuedJobs = activeJobs.filter((j) => j.status === 'queued');
  const doneJobs = activeJobs.filter((j) => j.status === 'done');
  const isRunning = runningJobs.length > 0 || queuedJobs.length > 0;

  return (
    <div className="flex-1 overflow-y-auto px-5 sm:px-8 pt-6 pb-8">
      <div className="mx-auto max-w-[78ch] space-y-6">
        {/* Room Editorial Header */}
        <header className="space-y-3 pb-4 border-b border-[var(--border)]">
          {editingTitle ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && titleDraft.trim()) {
                    onRenameRoom?.(titleDraft.trim());
                    setEditingTitle(false);
                  } else if (e.key === 'Escape') {
                    setEditingTitle(false);
                  }
                }}
                autoFocus
                className="flex-1 font-display text-xl sm:text-2xl font-semibold px-3 py-1 rounded-lg bg-[var(--surface)] border border-[var(--accent)] text-[var(--ink)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  if (titleDraft.trim()) onRenameRoom?.(titleDraft.trim());
                  setEditingTitle(false);
                }}
                className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-semibold cursor-pointer"
              >
                Lưu
              </button>
              <button
                type="button"
                onClick={() => setEditingTitle(false)}
                className="px-2.5 py-1.5 rounded-lg text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] cursor-pointer"
              >
                Hủy
              </button>
            </div>
          ) : (
            <div className="group flex items-start gap-2">
              <h1 className="font-display text-2xl sm:text-[26px] font-semibold leading-tight text-[var(--ink)] [text-wrap:balance]">
                {room.title}
              </h1>
              {onRenameRoom && (
                <button
                  type="button"
                  title="Đổi tên phòng nghiên cứu"
                  onClick={() => {
                    setTitleDraft(room.title);
                    setEditingTitle(true);
                  }}
                  className="mt-1 p-1.5 rounded-md text-[var(--ink-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-subtle)] opacity-70 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          {/* Adaptive Perspective Control Bar */}
          {totalN === 1 ? (
            /* 1 AI: Minimal quiet label, zero unnecessary filters */
            <div className="flex items-center justify-between gap-3 text-xs text-[var(--ink-secondary)]">
              <div className="flex items-center gap-2">
                <span
                  className="font-semibold"
                  style={{ color: getPerspectiveColorVar(room.perspectives[0]?.colorIndex ?? 0) }}
                >
                  @{room.perspectives[0]?.handle}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-num text-[var(--ink-muted)]">
                  {room.perspectives[0]?.modelLabel}
                </span>
                <span aria-hidden="true">·</span>
                <span>Nghiên cứu tập trung 1-1</span>
              </div>
              <button
                type="button"
                onClick={onOpenRoster}
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Thêm góc nhìn
              </button>
            </div>
          ) : totalN <= 3 ? (
            /* 2–3 AI: Compact interactive chips directly above room */
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {room.perspectives.map((p: Perspective) => {
                  const color = getPerspectiveColorVar(p.colorIndex);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onTogglePerspective(p.id)}
                      title={p.enabled ? 'Bấm để tạm tắt góc nhìn này cho lượt tới' : 'Bấm để bật lại'}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                        p.enabled
                          ? 'bg-[var(--surface)] border-[var(--border-strong)] text-[var(--ink)]'
                          : 'bg-transparent border-dashed border-[var(--border)] text-[var(--ink-muted)] opacity-65'
                      }`}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: p.enabled ? color : 'var(--ink-muted)' }}
                      />
                      <span>@{p.handle}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={onOpenRoster}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)] transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Thêm góc nhìn
                </button>
              </div>
              <button
                type="button"
                onClick={onOpenCompare}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ink-secondary)] hover:text-[var(--accent)] transition-colors whitespace-nowrap cursor-pointer"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                So sánh cạnh nhau
              </button>
            </div>
          ) : (
            /* 4–12+ AI: Density Switch + Perspective Drawer Trigger + Filter */
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenRoster}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border-strong)] text-xs font-medium text-[var(--ink)] hover:border-[var(--accent)] transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Users className="w-3.5 h-3.5 text-[var(--accent)]" />
                  Góc nhìn: {activeCount}/{totalN}
                </button>

                <div className="inline-flex items-center p-0.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]">
                  <button
                    type="button"
                    onClick={() => setDensityOverride('compact')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      useCompactCards
                        ? 'bg-[var(--surface)] text-[var(--ink)] shadow-xs'
                        : 'text-[var(--ink-secondary)] hover:text-[var(--ink)]'
                    }`}
                  >
                    Thẻ gọn ({activeCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDensityOverride('expanded')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      !useCompactCards
                        ? 'bg-[var(--surface)] text-[var(--ink)] shadow-xs'
                        : 'text-[var(--ink-secondary)] hover:text-[var(--ink)]'
                    }`}
                  >
                    Mở tất cả
                  </button>
                </div>

                <button
                  type="button"
                  onClick={onOpenCompare}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs font-medium text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:border-[var(--accent)] transition-colors whitespace-nowrap cursor-pointer"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  So sánh 2–4 AI
                </button>
              </div>

              <div className="flex items-center gap-2">
                <select
                  aria-label="Lọc theo góc nhìn"
                  value={filterHandle}
                  onChange={(e) => setFilterHandle(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--ink)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
                >
                  <option value="all">Lọc: Tất cả góc nhìn</option>
                  {room.perspectives.map((p) => (
                    <option key={p.id} value={p.handle}>
                      @{p.handle}
                    </option>
                  ))}
                </select>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-[var(--ink-muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Tìm ý…"
                    className="w-32 sm:w-40 pl-7 pr-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>
            </div>
          )}
        </header>

        {/* Empty state */}
        {groupedByRound.length === 0 && !isRunning && (
          <div className="py-16 text-center space-y-2.5">
            <p className="font-display text-lg text-[var(--ink)]">
              Phòng nghiên cứu đã sẵn sàng
            </p>
            <p className="text-sm text-[var(--ink-secondary)] max-w-md mx-auto">
              Đặt câu hỏi bên dưới để {activeCount} góc nhìn đang bật cùng phân tích, hoặc bấm{' '}
              <strong>Deep Research</strong> để tìm nguồn học thuật thật từ arXiv và OpenAlex trước.
            </p>
          </div>
        )}

        {/* Messages grouped cleanly by Round */}
        {groupedByRound.map((group) => (
          <section key={group.round} className="space-y-4">
            {/* Editorial round divider */}
            <div className="flex items-center gap-3 text-xs text-[var(--ink-muted)]">
              <span className="h-px flex-1 bg-[var(--border)]" />
              <span className="font-medium whitespace-nowrap">{group.label}</span>
              <span className="h-px flex-1 bg-[var(--border)]" />
            </div>

            <div className="space-y-3.5">
              {group.messages.map((msg) => {
                if (msg.senderType === 'user') {
                  return (
                    <div
                      key={msg.id}
                      className="rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)] px-5 py-4"
                    >
                      <div className="text-[11.5px] font-medium text-[var(--ink-muted)] mb-1">
                        Câu hỏi của bạn
                      </div>
                      <div className="text-[15.5px] font-medium text-[var(--ink)] leading-relaxed">
                        {msg.content}
                      </div>
                    </div>
                  );
                }

                if (msg.senderType === 'system') {
                  const isCollapsedDossier = Boolean(expandedIds[`sys-collapse-${msg.id}`]);
                  return (
                    <article
                      key={msg.id}
                      className="rounded-xl bg-[var(--surface)] border border-[var(--accent)]/45 px-5 py-4 space-y-2.5 shadow-[var(--shadow-card)]"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 font-semibold text-[var(--accent)]">
                          <BookOpen className="w-4 h-4 shrink-0" />
                          <span>Hồ sơ Tài liệu Nghiên cứu (Toàn văn cho Phản biện & Trọng tài)</span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedIds((prev) => ({
                              ...prev,
                              [`sys-collapse-${msg.id}`]: !prev[`sys-collapse-${msg.id}`],
                            }))
                          }
                          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--ink-secondary)] hover:text-[var(--accent)] cursor-pointer shrink-0"
                        >
                          {isCollapsedDossier ? (
                            <>
                              Mở tài liệu <ChevronDown className="w-3.5 h-3.5" />
                            </>
                          ) : (
                            <>
                              Thu gọn <ChevronUp className="w-3.5 h-3.5" />
                            </>
                          )}
                        </button>
                      </div>
                      {!isCollapsedDossier ? (
                        <MarkdownText
                          text={msg.content}
                          onCitationClick={onCitationClick}
                          validSourceIds={validSourceIds}
                        />
                      ) : (
                        <p className="text-xs text-[var(--ink-secondary)]">
                          {msg.summary1Line || `${msg.citedSourceIds.length} nguồn tài liệu đã sẵn sàng cho Hội đồng AI.`}
                        </p>
                      )}
                    </article>
                  );
                }

                if (msg.senderType === 'judge') {
                  return (
                    <article
                      key={msg.id}
                      className="rounded-xl bg-[var(--accent-soft)] border border-[var(--accent)] px-5 py-4 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-[var(--accent)]">
                          Trọng tài · Tổng hợp vòng thảo luận
                        </span>
                        <span className="font-mono-num text-[var(--ink-muted)]">
                          {msg.elapsedSec ? `${msg.elapsedSec}s` : ''}
                        </span>
                      </div>
                      <MarkdownText
                        text={msg.content}
                        onCitationClick={onCitationClick}
                        validSourceIds={validSourceIds}
                      />
                    </article>
                  );
                }

                // AI perspective message (Adaptive: Full text vs Compact 2-line card)
                const roleColor = getPerspectiveColorVar(msg.colorIndex ?? 0);
                const isExpanded = !useCompactCards || Boolean(expandedIds[msg.id]);

                return (
                  <article
                    key={msg.id}
                    className={`rounded-xl border transition-colors ${
                      isExpanded
                        ? 'bg-[var(--surface)] border-[var(--border)] shadow-[var(--shadow-card)]'
                        : 'bg-[var(--surface)] border-[var(--border)] hover:border-[var(--border-strong)]'
                    }`}
                  >
                    {/* Card Header — quiet unboxed metadata with middle-dot separators */}
                    <div
                      onClick={useCompactCards ? () => toggleCard(msg.id) : undefined}
                      className={`px-5 pt-4 ${isExpanded ? 'pb-2.5' : 'pb-4'} ${
                        useCompactCards ? 'cursor-pointer select-none' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs min-w-0">
                          <span className="font-semibold text-[13.5px]" style={{ color: roleColor }}>
                            @{msg.handle}
                          </span>
                          <span aria-hidden="true" className="text-[var(--ink-muted)]">
                            ·
                          </span>
                          <span className="font-mono-num text-[var(--ink-muted)]">
                            {msg.modelLabel || 'gemini-4-hydrogen'}
                          </span>
                          {msg.laneId && (
                            <>
                              <span aria-hidden="true" className="text-[var(--ink-muted)]">
                                ·
                              </span>
                              <span className="font-mono-num text-[var(--ink-muted)]">
                                {formatLaneDisplay(msg.laneId, laneDetails)}
                              </span>
                            </>
                          )}
                          {msg.elapsedSec !== undefined && (
                            <>
                              <span aria-hidden="true" className="text-[var(--ink-muted)]">
                                ·
                              </span>
                              <span className="font-mono-num text-[var(--ink-muted)]">
                                {msg.elapsedSec.toFixed(1)}s
                              </span>
                            </>
                          )}
                          {msg.fallbackFrom && (
                            <span
                              title={`Đã đổi từ ${msg.fallbackFrom} sang ${msg.modelLabel}`}
                              className="inline-flex items-center gap-1 text-[var(--warn)] font-medium"
                            >
                              <AlertTriangle className="w-3 h-3" />
                              Fallback
                            </span>
                          )}
                          {msg.pinnedToReport && (
                            <span className="inline-flex items-center gap-1 text-[var(--accent)] font-medium">
                              <Pin className="w-3 h-3" />
                              Đã ghim
                            </span>
                          )}
                        </div>

                        {useCompactCards && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleCard(msg.id);
                            }}
                            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--ink-secondary)] hover:text-[var(--accent)] shrink-0 cursor-pointer"
                          >
                            {isExpanded ? (
                              <>
                                Thu gọn <ChevronUp className="w-3.5 h-3.5" />
                              </>
                            ) : (
                              <>
                                Bung chi tiết <ChevronDown className="w-3.5 h-3.5" />
                              </>
                            )}
                          </button>
                        )}
                      </div>

                      {/* Compact 2-line preview when collapsed */}
                      {!isExpanded && (
                        <div className="mt-2 text-[14px] text-[var(--ink)] leading-relaxed line-clamp-2">
                          <span className="font-medium text-[var(--ink-secondary)]">Kết luận: </span>
                          {msg.summary1Line || msg.content}
                          {msg.citedSourceIds.length > 0 && (
                            <span className="ml-1.5 inline-flex gap-1">
                              {msg.citedSourceIds.map((sid) => (
                                <button
                                  key={sid}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onCitationClick(sid);
                                  }}
                                  className="font-mono-num text-[11px] px-1.5 rounded bg-[var(--accent-soft)] text-[var(--accent)] hover:underline cursor-pointer"
                                >
                                  [{sid}]
                                </button>
                              ))}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Full Prose Body + Contextual Actions */}
                    {isExpanded && (
                      <div className="px-5 pb-4 space-y-3">
                        <MarkdownText
                          text={msg.content}
                          onCitationClick={onCitationClick}
                          validSourceIds={validSourceIds}
                        />
                        {msg.verification &&
                          (msg.verification.validCitations.length > 0 ||
                            msg.verification.inferredCitations.length > 0 ||
                            msg.verification.warnings.length > 0 ||
                            msg.verification.numericClaimsChecked > 0) && (
                            <div
                              className={`px-3 py-2 rounded-lg border text-[11.5px] space-y-1 ${
                                msg.verification.warnings.length > 0
                                  ? 'bg-[var(--warn-soft)] border-[var(--warn)]/45 text-[var(--ink)]'
                                  : 'bg-[var(--bg-subtle)] border-[var(--border)] text-[var(--ink-secondary)]'
                              }`}
                            >
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono-num">
                                <span
                                  className={`inline-flex items-center gap-1 font-sans font-semibold ${
                                    msg.verification.warnings.length > 0
                                      ? 'text-[var(--warn)]'
                                      : 'text-[var(--ok)]'
                                  }`}
                                >
                                  {msg.verification.warnings.length > 0 ? (
                                    <AlertTriangle className="w-3.5 h-3.5" />
                                  ) : (
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                  )}
                                  Kiểm chứng tự động
                                </span>
                                <span>
                                  {msg.verification.validCitations.length} trích dẫn trực tiếp
                                </span>
                                {msg.verification.inferredCitations.length > 0 && (
                                  <span>
                                    {msg.verification.inferredCitations.length} suy luận rõ nguồn
                                  </span>
                                )}
                                {msg.verification.numericClaimsChecked > 0 && (
                                  <span>
                                    Số liệu khớp: {msg.verification.numericClaimsMatched}/
                                    {msg.verification.numericClaimsChecked}
                                  </span>
                                )}
                              </div>
                              {msg.verification.warnings.map((w, wIdx) => (
                                <div key={wIdx} className="text-[var(--ink)]">
                                  • {w}
                                </div>
                              ))}
                            </div>
                          )}
                        <div className="pt-2.5 border-t border-[var(--border)] flex flex-wrap items-center gap-4 text-xs text-[var(--ink-secondary)]">
                          <button
                            type="button"
                            onClick={() => onPinToReport(msg.id)}
                            className={`inline-flex items-center gap-1.5 hover:text-[var(--accent)] transition-colors cursor-pointer ${
                              msg.pinnedToReport ? 'text-[var(--accent)] font-medium' : ''
                            }`}
                          >
                            <Pin className="w-3.5 h-3.5" />
                            {msg.pinnedToReport ? 'Bỏ ghim Báo cáo' : 'Ghim vào Báo cáo'}
                          </button>
                          {msg.handle && (
                            <button
                              type="button"
                              onClick={() => onAskRoleDirectly(msg.handle!)}
                              className="inline-flex items-center gap-1.5 hover:text-[var(--accent)] transition-colors cursor-pointer"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              Hỏi riêng @{msg.handle}
                            </button>
                          )}
                          {msg.perspectiveId && totalN >= 2 && (
                            <button
                              type="button"
                              onClick={() => onComparePerspective(msg.perspectiveId!)}
                              className="inline-flex items-center gap-1.5 hover:text-[var(--accent)] transition-colors cursor-pointer"
                            >
                              <ArrowLeftRight className="w-3.5 h-3.5" />
                              Đưa vào So sánh
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        ))}

        {/* Adaptive Progress Strip when AI turns are running */}
        {isRunning && (
          <section aria-live="polite" className="space-y-2.5">
            {activeJobs.length <= 3 ? (
              /* 1–3 AI: Live direct cards with elapsed seconds + lane */
              activeJobs
                .filter((j) => j.status === 'running' || j.status === 'queued')
                .map((job) => {
                  const sec =
                    job.status === 'running'
                      ? Math.max(0.1, (nowMs - job.startedAtMs) / 1000).toFixed(1)
                      : 'chờ đợt';
                  return (
                    <div
                      key={job.perspectiveId}
                      className="rounded-xl border border-dashed border-[var(--accent)] bg-[var(--surface)] px-5 py-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs">
                          <span
                            className="font-semibold"
                            style={{ color: getPerspectiveColorVar(job.colorIndex) }}
                          >
                            @{job.handle}
                          </span>
                          <span aria-hidden="true" className="text-[var(--ink-muted)]">
                            ·
                          </span>
                          <span className="font-mono-num text-[var(--accent)] inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {job.status === 'running' ? `${sec}s` : 'Đang xếp hàng'}
                          </span>
                          <span aria-hidden="true" className="text-[var(--ink-muted)]">
                            ·
                          </span>
                          <span className="font-mono-num text-[var(--ink-muted)]">
                            {formatLaneDisplay(job.laneId, laneDetails)}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--ink-secondary)] mt-1">
                          {job.status === 'running'
                            ? `Đang phân tích và tổng hợp lập luận (${job.roundLabel})…`
                            : 'Đang chờ luồng trống theo cấu hình max_concurrency…'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={onStopRunning}
                        className="px-3 py-1.5 rounded-lg border border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger-soft)] text-xs font-medium inline-flex items-center gap-1 shrink-0 cursor-pointer"
                      >
                        <Square className="w-3 h-3 fill-current" />
                        Dừng
                      </button>
                    </div>
                  );
                })
            ) : (
              /* 4+ AI: Single unified Batch Progress Strip */
              <div className="rounded-xl border border-[var(--accent)] bg-[var(--surface)] px-4 py-3.5 space-y-2.5 shadow-[var(--shadow-card)]">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-medium text-[var(--ink)] flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold text-[var(--accent)]">
                      Đã xong {doneJobs.length}/{activeJobs.length}
                    </span>
                    <span aria-hidden="true" className="text-[var(--ink-muted)]">
                      ·
                    </span>
                    <span className="text-[var(--ink-secondary)]">
                      Đang chạy:{' '}
                      {runningJobs
                        .map(
                          (j) =>
                            `@${j.handle} (${j.laneId} · ${Math.max(
                              0.1,
                              (nowMs - j.startedAtMs) / 1000
                            ).toFixed(0)}s)`
                        )
                        .join(', ')}
                    </span>
                    {queuedJobs.length > 0 && (
                      <>
                        <span aria-hidden="true" className="text-[var(--ink-muted)]">
                          ·
                        </span>
                        <span className="text-[var(--ink-muted)]">Chờ: {queuedJobs.length}</span>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={onStopRunning}
                    className="px-3 py-1 rounded-lg bg-[var(--danger-soft)] text-[var(--danger)] hover:opacity-90 text-xs font-medium inline-flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    <Square className="w-3 h-3 fill-current" />
                    Dừng
                  </button>
                </div>
                <div className="h-1.5 w-full rounded-full bg-[var(--bg-subtle)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent)] transition-all duration-300"
                    style={{
                      width: `${Math.max(8, Math.round((doneJobs.length / activeJobs.length) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
