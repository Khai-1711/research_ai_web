import React, { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  FileJson,
  ListTree,
  MessageSquarePlus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { Room } from '../types.ts';
import { generateRoomMarkdown, triggerFileDownload } from '../utils/themeAndExport.ts';

interface RightDrawerProps {
  open: boolean;
  activeTab: 'sources' | 'outline';
  onTabChange: (tab: 'sources' | 'outline') => void;
  onClose: () => void;
  room: Room;
  highlightedSourceId: string | null;
  onSelectSuggestedPrompt: (prompt: string) => void;
  onFillGapsResearch: (gaps: string[]) => void;
  onDeleteSource?: (sourceId: string) => void;
  onInjectSourcesToChat?: () => void;
  isBusy: boolean;
}

export function RightDrawer({
  open,
  activeTab,
  onTabChange,
  onClose,
  room,
  highlightedSourceId,
  onSelectSuggestedPrompt,
  onFillGapsResearch,
  onDeleteSource,
  onInjectSourcesToChat,
  isBusy,
}: RightDrawerProps) {
  const [copiedMd, setCopiedMd] = useState(false);
  const [expandedSourceIds, setExpandedSourceIds] = useState<Record<string, boolean>>({});
  const sourceRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (open && activeTab === 'sources' && highlightedSourceId) {
      const el = sourceRefs.current[highlightedSourceId];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [open, activeTab, highlightedSourceId]);

  if (!open) return null;

  const handleCopyMd = async () => {
    const md = generateRoomMarkdown(room);
    try {
      await navigator.clipboard.writeText(md);
      setCopiedMd(true);
      setTimeout(() => setCopiedMd(false), 1800);
    } catch {
      triggerFileDownload(`${room.id}.md`, md, 'text/markdown;charset=utf-8');
    }
  };

  const handleDownloadMd = () => {
    triggerFileDownload(`${room.id}-report.md`, generateRoomMarkdown(room), 'text/markdown;charset=utf-8');
  };

  const handleDownloadJsonl = () => {
    const a = document.createElement('a');
    a.href = `/api/rooms/${encodeURIComponent(room.id)}/events.jsonl`;
    a.download = `${room.id}-events.jsonl`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <aside
      aria-label="Ngăn Kho nguồn và Dàn ý sống"
      className="w-[320px] shrink-0 h-full flex flex-col border-l border-[var(--border)] bg-[var(--bg-subtle)] transition-all duration-200 z-20"
    >
      {/* Top segmented switch */}
      <div className="px-3 pt-3 pb-2 flex items-center justify-between gap-2">
        <div className="flex flex-1 items-center p-0.5 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
          <button
            type="button"
            onClick={() => onTabChange('sources')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'sources'
                ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                : 'text-[var(--ink-secondary)] hover:text-[var(--ink)]'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            Kho nguồn ({room.sources.length})
          </button>
          <button
            type="button"
            onClick={() => onTabChange('outline')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'outline'
                ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                : 'text-[var(--ink-secondary)] hover:text-[var(--ink)]'
            }`}
          >
            <ListTree className="w-3.5 h-3.5" />
            Dàn ý sống
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Ẩn ngăn phải (])"
          className="p-1.5 rounded-md text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Main scroll area */}
      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-3">
        {activeTab === 'sources' ? (
          room.sources.length === 0 ? (
            <div className="p-4 rounded-xl border border-dashed border-[var(--border-strong)] text-center space-y-2 mt-2">
              <p className="text-[13px] font-medium text-[var(--ink)]">Chưa có nguồn trích dẫn</p>
              <p className="text-xs text-[var(--ink-muted)] leading-relaxed">
                Dùng nút <strong>Deep Research</strong> hoặc <strong>URL / Tài liệu</strong> ở khung nhập để nạp nguồn thật từ arXiv, OpenAlex, Wikipedia.
              </p>
            </div>
          ) : (
            <>
              {onInjectSourcesToChat && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={onInjectSourcesToChat}
                  className="w-full py-2 px-3 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-ink)] text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <MessageSquarePlus className="w-3.5 h-3.5" />
                  In toàn bộ Kho nguồn vào Chat ({room.sources.length})
                </button>
              )}
              {room.sources.map((src) => {
                const isHighlighted = highlightedSourceId === src.id;
                const isLong = src.excerpt.length > 360;
                const isExpanded = Boolean(expandedSourceIds[src.id]);
                const shownExcerpt =
                  isLong && !isExpanded ? `${src.excerpt.slice(0, 340).trimEnd()}…` : src.excerpt;
                return (
                  <div
                    key={src.id}
                    ref={(el) => {
                      sourceRefs.current[src.id] = el;
                    }}
                    className={`p-3.5 rounded-xl border transition-all duration-200 ${
                      isHighlighted
                        ? 'bg-[var(--accent-soft)] border-[var(--accent)] shadow-[var(--shadow-card)]'
                        : 'bg-[var(--surface)] border-[var(--border)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11.5px] text-[var(--ink-muted)] font-mono-num">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-semibold text-[var(--accent)]">[{src.id}]</span>
                        <span
                          title={
                            src.contentLevel === 'full_text'
                              ? 'Nguồn đã trích xuất toàn văn / bài dài để AI đối chiếu sâu'
                              : src.contentLevel === 'abstract_only'
                              ? 'Nguồn hiện chỉ mới có phần tóm tắt (Abstract)'
                              : 'Nguồn trích đoạn / tổng quan'
                          }
                          className={`px-1.5 py-0.2 rounded text-[10px] font-sans font-medium shrink-0 ${
                            src.contentLevel === 'full_text'
                              ? 'bg-[var(--ok)]/15 text-[var(--ok)]'
                              : src.contentLevel === 'abstract_only'
                              ? 'bg-[var(--warn-soft)] text-[var(--warn)]'
                              : 'bg-[var(--bg-subtle)] text-[var(--ink-secondary)]'
                          }`}
                        >
                          {src.contentLevel === 'full_text'
                            ? 'Toàn văn'
                            : src.contentLevel === 'abstract_only'
                            ? 'Chỉ Tóm tắt'
                            : 'Trích đoạn'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate">{src.origin}</span>
                        {onDeleteSource && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => onDeleteSource(src.id)}
                            title={`Xóa nguồn [${src.id}]`}
                            className="p-0.5 rounded text-[var(--ink-muted)] hover:text-[var(--danger)] transition-colors disabled:opacity-40 cursor-pointer shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <h4 className="mt-1 text-[13.5px] font-semibold text-[var(--ink)] leading-snug">
                      {src.title}
                    </h4>
                    <p className="mt-1.5 text-[12.5px] text-[var(--ink-secondary)] leading-relaxed italic whitespace-pre-line">
                      “{shownExcerpt}”
                    </p>
                    {isLong && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedSourceIds((prev) => ({
                            ...prev,
                            [src.id]: !prev[src.id],
                          }))
                        }
                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] hover:underline cursor-pointer"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="w-3 h-3" />
                            Thu gọn trích đoạn
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-3 h-3" />
                            Xem toàn văn ({src.excerpt.length} ký tự)
                          </>
                        )}
                      </button>
                    )}
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--accent)] hover:underline truncate max-w-full"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      <span className="truncate">{src.url.replace(/^https?:\/\//, '')}</span>
                    </a>
                  </div>
                );
              })}
            </>
          )
        ) : (
          /* Living Outline Tab */
          <div className="space-y-4 pt-1">
            {/* Consensus */}
            <section className="p-3.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-[var(--ok)]">
                  Điểm đồng thuận ({room.livingOutline.consensus.length})
                </h4>
              </div>
              {room.livingOutline.consensus.length === 0 ? (
                <p className="text-xs text-[var(--ink-muted)]">
                  Bấm <strong>Trọng tài chốt</strong> sau khi thảo luận để tự động gom các điểm đồng thuận.
                </p>
              ) : (
                <ol className="space-y-2.5">
                  {room.livingOutline.consensus.map((item, idx) => (
                    <li key={idx} className="text-[12.5px] leading-relaxed">
                      <div className="font-medium text-[var(--ink)]">
                        {idx + 1}. {item.title}
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-[var(--ink-muted)]">
                        Ủng hộ: {item.supporters.map((s) => `@${s}`).join(', ')}
                        {item.citations.length > 0 && ` · ${item.citations.map((c) => `[${c}]`).join(' ')}`}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {/* Contradictions */}
            <section className="p-3.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] space-y-2.5">
              <h4 className="text-xs font-semibold text-[var(--warn)]">
                Trục mâu thuẫn chính ({room.livingOutline.contradictions.length})
              </h4>
              {room.livingOutline.contradictions.length === 0 ? (
                <p className="text-xs text-[var(--ink-muted)]">Chưa ghi nhận mâu thuẫn đáng kể.</p>
              ) : (
                room.livingOutline.contradictions.map((c, idx) => (
                  <div key={idx} className="space-y-1.5 text-[12.5px] leading-relaxed">
                    <div className="font-medium text-[var(--ink)]">{c.topic}</div>
                    <p className="text-[var(--ink-secondary)] text-[12px]">{c.detail}</p>
                    <button
                      type="button"
                      onClick={() => onSelectSuggestedPrompt(c.suggestedPrompt)}
                      className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--accent)] hover:underline cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Đưa thành câu hỏi phản biện
                    </button>
                  </div>
                ))
              )}
            </section>

            {/* Gaps */}
            <section className="p-3.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] space-y-2.5">
              <h4 className="text-xs font-semibold text-[var(--ink)]">
                Lỗ hổng cần tìm thêm ({room.livingOutline.gaps.length})
              </h4>
              {room.livingOutline.gaps.length === 0 ? (
                <p className="text-xs text-[var(--ink-muted)]">Chưa có lỗ hổng nào được đánh dấu.</p>
              ) : (
                <>
                  <ul className="space-y-1.5 text-[12.5px] text-[var(--ink-secondary)] list-disc pl-4">
                    {room.livingOutline.gaps.map((g, idx) => (
                      <li key={idx}>{g}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onFillGapsResearch(room.livingOutline.gaps)}
                    className="w-full py-2 px-3 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-ink)] text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <Search className="w-3.5 h-3.5" />
                    Tìm nguồn lấp {room.livingOutline.gaps.length} lỗ hổng này
                  </button>
                </>
              )}
            </section>
          </div>
        )}
      </div>

      {/* Quiet export bar */}
      <div className="p-3 border-t border-[var(--border)] bg-[var(--surface)]">
        <div className="text-[11px] font-medium text-[var(--ink-muted)] mb-2">Xuất dữ liệu phiên</div>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={handleCopyMd}
            className="py-1.5 px-2 rounded-md border border-[var(--border)] bg-[var(--bg)] hover:border-[var(--accent)] text-[11.5px] font-medium text-[var(--ink)] flex items-center justify-center gap-1 transition-colors cursor-pointer"
          >
            {copiedMd ? <Check className="w-3 h-3 text-[var(--ok)]" /> : <Copy className="w-3 h-3" />}
            {copiedMd ? 'Đã chép' : 'Copy MD'}
          </button>
          <button
            type="button"
            onClick={handleDownloadMd}
            className="py-1.5 px-2 rounded-md border border-[var(--border)] bg-[var(--bg)] hover:border-[var(--accent)] text-[11.5px] font-medium text-[var(--ink)] flex items-center justify-center gap-1 transition-colors cursor-pointer"
          >
            <Download className="w-3 h-3" />
            report.md
          </button>
          <button
            type="button"
            onClick={handleDownloadJsonl}
            className="py-1.5 px-2 rounded-md border border-[var(--border)] bg-[var(--bg)] hover:border-[var(--accent)] text-[11.5px] font-medium text-[var(--ink)] flex items-center justify-center gap-1 transition-colors cursor-pointer"
          >
            <FileJson className="w-3 h-3" />
            JSONL
          </button>
        </div>
      </div>
    </aside>
  );
}
