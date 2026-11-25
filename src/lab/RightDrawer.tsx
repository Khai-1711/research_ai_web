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
import { describeRetrieval, isWeakEvidenceSource, sourceTypeLabel } from '../utils/researchLabels.ts';
import { useI18n } from '../utils/i18n.tsx';

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
  const { lang, t } = useI18n();
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
    const md = generateRoomMarkdown(room, lang);
    try {
      await navigator.clipboard.writeText(md);
      setCopiedMd(true);
      setTimeout(() => setCopiedMd(false), 1800);
    } catch {
      triggerFileDownload(`${room.id}.md`, md, 'text/markdown;charset=utf-8');
    }
  };

  const handleDownloadMd = () => {
    triggerFileDownload(`${room.id}-report.md`, generateRoomMarkdown(room, lang), 'text/markdown;charset=utf-8');
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
      aria-label={t('rightAriaLabel')}
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
            {t('tabSources', { count: room.sources.length })}
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
            {t('tabOutline')}
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          title={t('hideRightTitle')}
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
              <p className="text-[13px] font-medium text-[var(--ink)]">{t('noSourcesTitle')}</p>
              <p className="text-xs text-[var(--ink-muted)] leading-relaxed">
                {t('noSourcesHint')}
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
                  {t('injectSourcesBtn', { count: room.sources.length })}
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
                              ? t('levelFullTextTitle')
                              : src.contentLevel === 'abstract_only'
                              ? t('levelAbstractOnlyTitle')
                              : t('levelExcerptTitle')
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
                            ? t('levelFullText')
                            : src.contentLevel === 'abstract_only'
                            ? t('levelAbstractOnly')
                            : t('levelExcerpt')}
                        </span>
                        {src.sourceType && (
                          <span
                            title={describeRetrieval(src, lang) || src.sourceType}
                            className={`px-1.5 py-0.2 rounded text-[10px] font-sans font-medium shrink-0 ${
                              isWeakEvidenceSource(src.sourceType)
                                ? 'bg-[var(--warn-soft)] text-[var(--warn)]'
                                : 'bg-[var(--bg-subtle)] text-[var(--ink-secondary)]'
                            }`}
                          >
                            {sourceTypeLabel(src, lang)}
                          </span>
                        )}
                        {typeof src.citedByCount === 'number' && (
                          <span title={t('citationsCountTitle')} className="text-[10px] shrink-0">
                            ↗{src.citedByCount}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate">{src.origin}</span>
                        {onDeleteSource && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => onDeleteSource(src.id)}
                            title={t('deleteSourceTitle', { id: src.id })}
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
                            {t('collapseExcerpt')}
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-3 h-3" />
                            {t('expandExcerpt', { chars: src.excerpt.length })}
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
                  {t('consensusHeading', { count: room.livingOutline.consensus.length })}
                </h4>
              </div>
              {room.livingOutline.consensus.length === 0 ? (
                <p className="text-xs text-[var(--ink-muted)]">
                  {t('consensusEmpty')}
                </p>
              ) : (
                <ol className="space-y-2.5">
                  {room.livingOutline.consensus.map((item, idx) => (
                    <li key={idx} className="text-[12.5px] leading-relaxed">
                      <div className="font-medium text-[var(--ink)]">
                        {idx + 1}. {item.title}
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-[var(--ink-muted)]">
                        {t('supportersPrefix')}
                        {item.supporters.map((s) => `@${s}`).join(', ')}
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
                {t('contradictionsHeading', { count: room.livingOutline.contradictions.length })}
              </h4>
              {room.livingOutline.contradictions.length === 0 ? (
                <p className="text-xs text-[var(--ink-muted)]">{t('contradictionsEmpty')}</p>
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
                      {t('askContradiction')}
                    </button>
                  </div>
                ))
              )}
            </section>

            {/* Gaps */}
            <section className="p-3.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] space-y-2.5">
              <h4 className="text-xs font-semibold text-[var(--ink)]">
                {t('gapsHeading', { count: room.livingOutline.gaps.length })}
              </h4>
              {room.livingOutline.gaps.length === 0 ? (
                <p className="text-xs text-[var(--ink-muted)]">{t('gapsEmpty')}</p>
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
                    {t('fillGapsBtn', { count: room.livingOutline.gaps.length })}
                  </button>
                </>
              )}
            </section>
          </div>
        )}
      </div>

      {/* Quiet export bar */}
      <div className="p-3 border-t border-[var(--border)] bg-[var(--surface)]">
        <div className="text-[11px] font-medium text-[var(--ink-muted)] mb-2">{t('exportSectionTitle')}</div>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={handleCopyMd}
            className="py-1.5 px-2 rounded-md border border-[var(--border)] bg-[var(--bg)] hover:border-[var(--accent)] text-[11.5px] font-medium text-[var(--ink)] flex items-center justify-center gap-1 transition-colors cursor-pointer"
          >
            {copiedMd ? <Check className="w-3 h-3 text-[var(--ok)]" /> : <Copy className="w-3 h-3" />}
            {copiedMd ? t('copiedBtn') : t('copyMdBtn')}
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
