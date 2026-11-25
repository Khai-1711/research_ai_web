import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FileJson,
  MessageSquarePlus,
  Plus,
  Scale,
  X,
} from 'lucide-react';
import type { Room } from '../types.ts';
import {
  generateRoomMarkdown,
  getPerspectiveColorVar,
  triggerFileDownload,
} from '../utils/themeAndExport.ts';
import { MarkdownText } from './MarkdownText.tsx';
import { buildApiUrl } from '../utils/api.ts';
import { countInlineCitations } from '../utils/citations.ts';
import { describeRetrieval, formatClaimCounts, isWeakEvidenceSource, sourceTypeLabel } from '../utils/researchLabels.ts';
import {
  formatBreakdownSummary,
  formatExecutiveSummary,
  formatReportSubtitle,
  formatReportTitle,
  formatStructuredWarning,
  localizeHandle,
  useI18n,
} from '../utils/i18n.tsx';

/* ============================================================================
   1. COMPARE VIEW — Select any 2, 3, or 4 perspectives side-by-side
============================================================================ */

interface CompareViewProps {
  room: Room;
  initialSelectedIds: string[];
  onCitationClick: (sourceId: string) => void;
  onAskRole: (handle: string) => void;
}

export function CompareView({
  room,
  initialSelectedIds,
  onCitationClick,
  onAskRole,
}: CompareViewProps) {
  const { lang, t } = useI18n();
  const defaultIds = useMemo(() => {
    if (initialSelectedIds.length >= 2) return initialSelectedIds.slice(0, 4);
    const enabled = room.perspectives.filter((p) => p.enabled).map((p) => p.id);
    return (enabled.length >= 2 ? enabled : room.perspectives.map((p) => p.id)).slice(0, 3);
  }, [initialSelectedIds, room.perspectives]);

  const [selectedIds, setSelectedIds] = useState<string[]>(defaultIds);
  const [selectedRound, setSelectedRound] = useState<number>(0);
  const [blindMode, setBlindMode] = useState(false);

  const rounds = useMemo(() => {
    const r = Array.from(new Set(room.messages.filter((m) => m.senderType === 'ai').map((m) => m.round)));
    return r.length > 0 ? r.sort((a, b) => a - b) : [0];
  }, [room.messages]);

  const validSourceIds = useMemo(() => new Set(room.sources.map((s) => s.id)), [room.sources]);

  const handleChangeCol = (colIndex: number, newId: string) => {
    setSelectedIds((prev) => prev.map((id, i) => (i === colIndex ? newId : id)));
  };

  const handleAddCol = () => {
    if (selectedIds.length >= 4) return;
    const next = room.perspectives.find((p) => !selectedIds.includes(p.id));
    if (next) setSelectedIds((prev) => [...prev, next.id]);
  };

  const handleRemoveCol = (colIndex: number) => {
    if (selectedIds.length <= 2) return;
    setSelectedIds((prev) => prev.filter((_, i) => i !== colIndex));
  };

  const gridColsClass =
    selectedIds.length === 2
      ? 'grid-cols-1 md:grid-cols-2'
      : selectedIds.length === 3
      ? 'grid-cols-1 lg:grid-cols-3'
      : 'grid-cols-1 md:grid-cols-2';

  return (
    <div className="flex-1 overflow-y-auto p-5 sm:p-8 space-y-6">
      <div className="mx-auto max-w-6xl space-y-5">
        {/* Controls bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[var(--border)]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-[var(--ink-secondary)]">{t('comparingLabel')}</span>
            {selectedIds.map((pid, idx) => (
              <div key={`${pid}-${idx}`} className="inline-flex items-center gap-1">
                <select
                  value={pid}
                  onChange={(e) => handleChangeCol(idx, e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] text-xs font-medium text-[var(--ink)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
                >
                  {room.perspectives.map((p) => (
                    <option key={p.id} value={p.id}>
                      {blindMode
                        ? t('candidatePrefix', { letter: String.fromCharCode(65 + idx) })
                        : `@${localizeHandle(p.handle, lang)}`}
                    </option>
                  ))}
                </select>
                {selectedIds.length > 2 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveCol(idx)}
                    title={t('removeColTitle')}
                    className="p-1 text-[var(--ink-muted)] hover:text-[var(--danger)] cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
            {selectedIds.length < 4 && selectedIds.length < room.perspectives.length && (
              <button
                type="button"
                onClick={handleAddCol}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-dashed border-[var(--border-strong)] text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)] cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('addCol')}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedRound}
              onChange={(e) => setSelectedRound(Number(e.target.value))}
              className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--ink)] cursor-pointer"
            >
              {rounds.map((r) => (
                <option key={r} value={r}>
                  {t('roundN', { round: r })}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setBlindMode((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                blindMode
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)]'
                  : 'bg-[var(--surface)] text-[var(--ink-secondary)] border-[var(--border)] hover:text-[var(--ink)]'
              }`}
            >
              {blindMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {t('blindModeLabel', { state: blindMode ? t('onBadge') : t('offBadge') })}
            </button>
          </div>
        </div>

        {/* Comparison Grid */}
        <div className={`grid ${gridColsClass} gap-4`}>
          {selectedIds.map((pid, idx) => {
            const p = room.perspectives.find((item) => item.id === pid);
            if (!p) return null;
            const msg =
              room.messages.find(
                (m) => m.senderType === 'ai' && m.perspectiveId === p.id && m.round === selectedRound
              ) || room.messages.find((m) => m.senderType === 'ai' && m.perspectiveId === p.id);

            const label = blindMode
              ? t('candidatePrefix', { letter: String.fromCharCode(65 + idx) })
              : `@${localizeHandle(p.handle, lang)}`;
            const color = blindMode ? 'var(--accent)' : getPerspectiveColorVar(p.colorIndex);

            return (
              <div
                key={`${p.id}-${idx}`}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-card)] flex flex-col justify-between"
              >
                <div className="p-5 space-y-3">
                  <div className="flex items-center justify-between gap-2 pb-3 border-b border-[var(--border)]">
                    <span className="font-semibold text-sm" style={{ color }}>
                      {label}
                    </span>
                    <span className="text-[11.5px] font-mono-num text-[var(--ink-muted)]">
                      {msg
                        ? `${msg.laneId ?? 'acc1'} · ${msg.elapsedSec?.toFixed(1) ?? '0.0'}s`
                        : t('noReplyYet')}
                    </span>
                  </div>

                  {msg ? (
                    <MarkdownText
                      text={msg.content}
                      onCitationClick={onCitationClick}
                      validSourceIds={validSourceIds}
                    />
                  ) : (
                    <p className="text-sm text-[var(--ink-muted)] py-8 text-center">
                      {t('roleNotInRound', { round: selectedRound })}
                    </p>
                  )}
                </div>

                {!blindMode && (
                  <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--bg-subtle)] rounded-b-xl">
                    <button
                      type="button"
                      onClick={() => onAskRole(p.handle)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:underline cursor-pointer"
                    >
                      <MessageSquarePlus className="w-3.5 h-3.5" />
                      {t('askFollowUpRole', { handle: localizeHandle(p.handle, lang) })}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   2. REPORT VIEW — Document Canvas + Left TOC + Dynamic Rubric + Verifier
============================================================================ */

interface ReportViewProps {
  room: Room;
  isBusy: boolean;
  onRunJudge: () => void;
  onBackToChat: () => void;
  onCitationClick: (sourceId: string) => void;
}

export function ReportView({
  room,
  isBusy,
  onRunJudge,
  onBackToChat,
  onCitationClick,
}: ReportViewProps) {
  const { lang, t } = useI18n();
  const validSourceIds = useMemo(() => new Set(room.sources.map((s) => s.id)), [room.sources]);

  const citationStats = useMemo(() => {
    const allText = [
      room.report?.executiveSummary ?? '',
      ...room.messages.map((m) => m.content),
    ].join('\n');
    const { totalFound, validCount, inferredCount } = countInlineCitations(allText, validSourceIds);
    const invalidCount = Math.max(0, totalFound - validCount);

    const fullTextSources = room.sources.filter((s) => s.contentLevel === 'full_text').length;
    const abstractSources = room.sources.filter((s) => s.contentLevel === 'abstract_only').length;
    const fallbacks = room.audit.filter((a) => Boolean(a.fallbackWarning)).length;
    return {
      totalFound,
      validCount,
      invalidCount: totalFound - validCount,
      inferredCount,
      fullTextSources,
      abstractSources,
      fallbacks,
    };
  }, [room, validSourceIds]);

  const handleDownloadMd = () => {
    triggerFileDownload(`${room.id}-report.md`, generateRoomMarkdown(room, lang), 'text/markdown;charset=utf-8');
  };

  if (!room.report) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-4">
          <h2 className="font-display text-2xl font-semibold text-[var(--ink)]">
            {t('noReportTitle')}
          </h2>
          <p className="text-sm text-[var(--ink-secondary)] leading-relaxed">
            {t('noReportDesc')}
          </p>
          <button
            type="button"
            disabled={isBusy}
            onClick={onRunJudge}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] font-semibold text-sm hover:bg-[var(--accent-hover)] disabled:opacity-50 cursor-pointer"
          >
            <Scale className="w-4 h-4" />
            {isBusy ? t('judgeSynthesizing') : t('runJudgeBuildReport')}
          </button>
        </div>
      </div>
    );
  }

  const { report } = room;

  return (
    <div className="flex-1 overflow-y-auto px-5 sm:px-8 py-7">
      <div className="mx-auto max-w-5xl grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-8 items-start">
        {/* Left TOC & Verifier */}
        <aside className="lg:sticky lg:top-6 space-y-5">
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-[var(--ink-muted)] mb-2">{t('tocTitle')}</div>
            {[
              { href: '#sec-summary', label: t('toc1') },
              { href: '#sec-perspectives', label: t('toc2') },
              { href: '#sec-debates', label: t('toc3') },
              { href: '#sec-rubric', label: t('toc4') },
              { href: '#sec-refs', label: t('toc5') },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="block py-1 text-[13px] text-[var(--ink-secondary)] hover:text-[var(--accent)] transition-colors"
              >
                {item.label}
              </a>
            ))}
          </div>

          <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] space-y-1.5 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-[var(--ok)]">
              <CheckCircle2 className="w-4 h-4" />
              {t('integrityCheckTitle')}
            </div>
            <div className="font-mono-num text-[var(--ink-secondary)]">
              {t('validCitCheck', { valid: citationStats.validCount, total: citationStats.totalFound })}
            </div>
            {citationStats.inferredCount > 0 && (
              <div className="font-mono-num text-[var(--ink-secondary)]">
                {t('inferredCitCheck', { count: citationStats.inferredCount })}
              </div>
            )}
            <div className="font-mono-num text-[var(--ink-secondary)]">
              {t('unmatchedCitCheck', { count: citationStats.invalidCount })}
            </div>
            {report.verificationSummary && report.verificationSummary.totalNumericChecked > 0 && (
              <div className="font-mono-num text-[var(--ink-secondary)]">
                {t('numericMatchCheck', {
                  matched: report.verificationSummary.totalNumericMatched,
                  checked: report.verificationSummary.totalNumericChecked,
                })}
              </div>
            )}
            <div className="font-mono-num text-[var(--ink-muted)]">
              {t('sourcesBreakdownCheck', {
                full: citationStats.fullTextSources,
                abs: citationStats.abstractSources,
              })}
            </div>
            {citationStats.fallbacks > 0 && (
              <div className="font-mono-num text-[var(--warn)]">
                {t('fallbackTurnsCheck', { count: citationStats.fallbacks })}
              </div>
            )}
          </div>
        </aside>

        {/* Main Editorial Document Canvas */}
        <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-card)] p-6 sm:p-9 space-y-8">
          <header className="space-y-2 pb-6 border-b border-[var(--border)]">
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[var(--ink)] leading-snug [text-wrap:balance]">
              {formatReportTitle(report, lang)}
            </h1>
            <p className="text-xs text-[var(--ink-muted)] font-mono-num">{formatReportSubtitle(report, lang)}</p>
          </header>

          <section id="sec-summary" className="space-y-3">
            <h2 className="font-display text-lg font-semibold text-[var(--ink)]">
              {t('sec1Title')}
            </h2>
            <MarkdownText
              text={formatExecutiveSummary(report, lang)}
              onCitationClick={onCitationClick}
              validSourceIds={validSourceIds}
            />
          </section>

          <section id="sec-perspectives" className="space-y-3">
            <h2 className="font-display text-lg font-semibold text-[var(--ink)]">
              {t('sec2Title')}
            </h2>
            <div className="divide-y divide-[var(--border)]">
              {report.perspectiveBreakdown.map((item) => (
                <div key={item.handle} className="py-3 space-y-1">
                  <div className="text-sm font-semibold text-[var(--accent)]">
                    @{localizeHandle(item.handle, lang)}
                    {localizeHandle(item.handle, lang) !== item.handle && (
                      <span className="ml-1.5 text-[11px] font-normal text-[var(--ink-muted)] font-mono-num">
                        (@{item.handle})
                      </span>
                    )}
                  </div>
                  <p className="text-[14.5px] text-[var(--ink-secondary)] leading-relaxed">
                    {formatBreakdownSummary(item, lang)}{' '}
                    {item.citations.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => onCitationClick(c)}
                        className="font-mono-num text-[11px] mx-0.5 px-1.5 rounded bg-[var(--accent-soft)] text-[var(--accent)] hover:underline cursor-pointer"
                      >
                        [{c}]
                      </button>
                    ))}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {report.openDebates.length > 0 && (
            <section id="sec-debates" className="space-y-2.5">
              <h2 className="font-display text-lg font-semibold text-[var(--ink)]">
                {t('sec3Title')}
              </h2>
              <ul className="list-disc pl-5 space-y-1.5 text-[15px] text-[var(--ink-secondary)]">
                {report.openDebates.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </section>
          )}

          {report.rubric.length > 0 && (
            <section id="sec-rubric" className="space-y-3">
              <h2 className="font-display text-lg font-semibold text-[var(--ink)]">
                {t('sec4Title', { count: report.rubric.length })}
              </h2>
              {((report.evaluationWarningItems && report.evaluationWarningItems.length > 0) ||
                (report.evaluationWarnings && report.evaluationWarnings.length > 0)) && (
                <div className="p-3.5 rounded-xl border border-[var(--warn)]/60 bg-[var(--warn-soft)] space-y-1 text-xs text-[var(--ink)]">
                  <div className="flex items-center gap-1.5 font-semibold text-[var(--warn)]">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {t('judgeExtractWarnings')}
                  </div>
                  {(report.evaluationWarningItems && report.evaluationWarningItems.length > 0
                    ? report.evaluationWarningItems.map((w) => formatStructuredWarning(w, lang))
                    : (report.evaluationWarnings ?? [])
                  ).map((w, idx) => (
                    <div key={idx}>• {w}</div>
                  ))}
                </div>
              )}
              <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[var(--bg-subtle)] text-xs text-[var(--ink-secondary)]">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">{t('colPerspective')}</th>
                      <th className="py-2.5 px-4 font-semibold text-right">{t('colEvidence')}</th>
                      <th className="py-2.5 px-4 font-semibold text-right">{t('colLogic')}</th>
                      <th className="py-2.5 px-4 font-semibold text-right">{t('colRebuttal')}</th>
                      <th className="py-2.5 px-4 font-semibold text-right">{t('colTotal')}</th>
                      <th
                        className="py-2.5 px-4 font-semibold text-right"
                        title={t('colSpreadTitle')}
                      >
                        {t('colSpread')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] font-mono-num">
                    {report.rubric.map((row) => (
                      <tr key={row.perspectiveId} className="hover:bg-[var(--surface-hover)]">
                        <td
                          className="py-2.5 px-4 font-sans font-semibold"
                          style={{ color: getPerspectiveColorVar(row.colorIndex) }}
                        >
                          <span>@{localizeHandle(row.handle, lang)}</span>
                          {localizeHandle(row.handle, lang) !== row.handle && (
                            <span className="ml-1 text-[10px] font-normal text-[var(--ink-muted)] font-mono-num">
                              (@{row.handle})
                            </span>
                          )}
                          {row.fallbackScored && (
                            <span
                              title={t('fallbackTitle')}
                              className="ml-2 inline-block px-1.5 py-0.5 rounded bg-[var(--warn-soft)] text-[var(--warn)] text-[10px] font-medium align-middle"
                            >
                              {t('fallbackBadge')}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right text-[var(--ink-secondary)]">
                          {row.evidence.toFixed(1)}
                        </td>
                        <td className="py-2.5 px-4 text-right text-[var(--ink-secondary)]">
                          {row.logic.toFixed(1)}
                        </td>
                        <td className="py-2.5 px-4 text-right text-[var(--ink-secondary)]">
                          {row.rebuttal.toFixed(1)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-semibold text-[var(--accent)]">
                          {row.total.toFixed(1)}
                        </td>
                        <td
                          className={`py-2.5 px-4 text-right ${
                            (row.totalSpread ?? 0) >= 1.5 ? 'text-[var(--warn)] font-semibold' : 'text-[var(--ink-secondary)]'
                          }`}
                          title={
                            row.totalsByRun && row.totalsByRun.length > 1
                              ? t('spreadTitleMulti', {
                                  scores: row.totalsByRun.map((x) => (x === null ? '—' : x.toFixed(1))).join(' · '),
                                })
                              : t('spreadTitleSingle')
                          }
                        >
                          {row.runsTotal && row.runsTotal > 1
                            ? `±${(row.totalSpread ?? 0).toFixed(1)} (${row.runsScored ?? 0}/${row.runsTotal})`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {report.judgeReliability && (
                <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] space-y-1 text-xs text-[var(--ink-secondary)]">
                  <div className="font-semibold text-[var(--ink)]">{t('judgeReliabilityTitle')}</div>
                  <div>
                    {t('judgeRunsValid', {
                      parsed: report.judgeReliability.runsParsed,
                      requested: report.judgeReliability.runsRequested,
                      seed: report.judgeReliability.seed,
                    })}
                  </div>
                  <div>
                    {t('judgeOrderLine', {
                      status:
                        report.judgeReliability.rankingStable === null
                          ? t('rankingInsufficient')
                          : report.judgeReliability.rankingStable
                          ? t('rankingStable')
                          : t('rankingChanged'),
                    })}
                  </div>
                  <div>
                    • {t('judgeFamilyLabel')} <b>{report.judgeReliability.judgeFamily}</b>
                    {t('debaterFamiliesLabel')} {report.judgeReliability.debaterFamilies.join(', ') || '—'}
                    {report.judgeReliability.sameFamilyAsDebaters && (
                      <span className="text-[var(--warn)] font-semibold">{t('sameFamilyWarn')}</span>
                    )}
                  </div>
                </div>
              )}
              {report.verificationSummary?.claimSupport && (
                <details className="p-3.5 rounded-xl border border-[var(--border)] text-xs text-[var(--ink-secondary)]">
                  <summary className="cursor-pointer font-semibold text-[var(--ink)]">
                    {t('claimSupportSummaryHeading', {
                      summary: formatClaimCounts(report.verificationSummary.claimSupport.totals, lang),
                    })}
                  </summary>
                  <div className="mt-2 space-y-1">
                    {Object.entries(report.verificationSummary.claimSupport.byHandle).map(([h, c]) => (
                      <div key={h}>
                        • @{localizeHandle(h, lang)}: {formatClaimCounts(c, lang)}
                      </div>
                    ))}
                    <ul className="mt-2 space-y-1.5">
                      {report.verificationSummary.claimSupport.claims.map((c) => (
                        <li key={c.id} className="leading-relaxed">
                          <span
                            className={`font-mono-num font-semibold mr-1 ${
                              c.label === 'supported'
                                ? 'text-[var(--accent)]'
                                : c.label === 'unsupported'
                                ? 'text-[var(--warn)]'
                                : 'text-[var(--ink-secondary)]'
                            }`}
                          >
                            [{c.label}]
                          </span>
                          @{localizeHandle(c.handle, lang)}: {c.sentence}
                          {c.evidence && (
                            <span className="italic">
                              {t('sourceQuotePrefix')}“{c.evidence}”
                            </span>
                          )}
                          {c.downgradedNoQuote && (
                            <span className="text-[var(--warn)]">{t('downgradedNoQuoteNote')}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              )}
            </section>
          )}

          <section id="sec-refs" className="space-y-2.5">
            <h2 className="font-display text-lg font-semibold text-[var(--ink)]">
              {t('sec5Title', { count: room.sources.length })}
            </h2>
            <div className="space-y-2">
              {room.sources.map((s) => (
                <div key={s.id} className="text-[13.5px] text-[var(--ink-secondary)]">
                  <button
                    type="button"
                    onClick={() => onCitationClick(s.id)}
                    className="font-mono-num font-semibold text-[var(--accent)] hover:underline mr-1.5 cursor-pointer"
                  >
                    [{s.id}]
                  </button>
                  <span className="font-medium text-[var(--ink)]">{s.title}</span>
                  <span> ({s.origin}) </span>
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded text-[10.5px] font-medium align-middle ${
                      isWeakEvidenceSource(s.sourceType)
                        ? 'bg-[var(--warn-soft)] text-[var(--warn)]'
                        : 'bg-[var(--bg-subtle)] text-[var(--ink-secondary)]'
                    }`}
                    title={describeRetrieval(s, lang) || t('noRetrievalInfo')}
                  >
                    {sourceTypeLabel(s, lang)}
                  </span>
                  <span> — </span>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--accent)] hover:underline"
                  >
                    {t('openSourceLink')}
                  </a>
                </div>
              ))}
            </div>
          </section>

          <footer className="pt-5 border-t border-[var(--border)] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadMd}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-semibold hover:bg-[var(--accent-hover)] cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                {t('downloadReportMd')}
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={onRunJudge}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-xs font-medium text-[var(--ink)] hover:border-[var(--accent)] cursor-pointer"
              >
                <Scale className="w-3.5 h-3.5" />
                {t('updateSynthesis')}
              </button>
            </div>

            <button
              type="button"
              onClick={onBackToChat}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ink-secondary)] hover:text-[var(--ink)] cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {t('backToChat')}
            </button>
          </footer>
        </article>
      </div>
    </div>
  );
}

/* ============================================================================
   3. AUDIT VIEW — Raw Prompt Inspection, Fallback Warnings & JSONL Trail
============================================================================ */

interface AuditViewProps {
  room: Room;
}

export function AuditView({ room }: AuditViewProps) {
  const { lang, t } = useI18n();
  const [expandedPromptId, setExpandedPromptId] = useState<string | null>(
    room.audit[0]?.id ?? null
  );

  const handleDownloadJsonl = () => {
    const a = document.createElement('a');
    a.href = buildApiUrl(`/api/rooms/${encodeURIComponent(room.id)}/events.jsonl`);
    a.download = `${room.id}-events.jsonl`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="flex-1 overflow-y-auto px-5 sm:px-8 py-7">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[var(--border)]">
          <div>
            <h1 className="font-display text-2xl font-semibold text-[var(--ink)]">
              {t('auditTitle')}
            </h1>
            <p className="text-xs text-[var(--ink-muted)] mt-1">
              {t('auditSubtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={handleDownloadJsonl}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)] text-xs font-medium text-[var(--ink)] cursor-pointer"
          >
            <FileJson className="w-3.5 h-3.5 text-[var(--accent)]" />
            {t('downloadJsonl')}
          </button>
        </div>

        {/* Summary parameters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          {[
            { k: t('auditCallMode'), v: 'Stateless · SSE Liveness' },
            { k: t('auditLoggedTurns'), v: t('auditTurnsUnit', { count: room.audit.length }) },
            {
              k: t('auditFallbackWarns'),
              v: t('auditTurnsUnit', { count: room.audit.filter((a) => a.fallbackWarning).length }),
            },
            { k: t('auditVerifiedSources'), v: t('auditSourcesUnit', { count: room.sources.length }) },
          ].map((item) => (
            <div
              key={item.k}
              className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)]"
            >
              <div className="text-[var(--ink-muted)]">{item.k}</div>
              <div className="mt-1 font-mono-num font-semibold text-[var(--ink)]">{item.v}</div>
            </div>
          ))}
        </div>

        {/* Fallback warnings */}
        {room.audit.some((a) => a.fallbackWarning) && (
          <div className="p-4 rounded-xl border border-[var(--warn)] bg-[var(--warn-soft)] space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--warn)]">
              <AlertTriangle className="w-4 h-4" />
              {t('auditFallbackBanner')}
            </div>
            {room.audit
              .filter((a) => a.fallbackWarning)
              .map((a) => (
                <p key={a.id} className="text-xs text-[var(--ink)]">
                  • {t('roundN', { round: a.round })}: {a.fallbackWarning}
                </p>
              ))}
          </div>
        )}

        {/* Per-turn raw prompt list */}
        <div className="space-y-3">
          {room.audit.length === 0 ? (
            <div className="p-8 rounded-xl border border-dashed border-[var(--border-strong)] text-center text-sm text-[var(--ink-muted)]">
              {t('auditEmpty')}
            </div>
          ) : (
            room.audit.map((entry) => {
              const isOpen = expandedPromptId === entry.id;
              return (
                <div
                  key={entry.id}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedPromptId(isOpen ? null : entry.id)}
                    className="w-full text-left px-4 py-3 flex flex-wrap items-center justify-between gap-2 hover:bg-[var(--surface-hover)] cursor-pointer"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-[var(--ink)]">
                        @{localizeHandle(entry.handle, lang)}
                      </span>
                      <span className="text-[var(--ink-muted)]">·</span>
                      <span className="font-mono-num text-[var(--ink-secondary)]">
                        {t('roundN', { round: entry.round })}
                      </span>
                      <span className="text-[var(--ink-muted)]">·</span>
                      <span className="font-mono-num text-[var(--ink-muted)]">
                        {entry.modelUsed} · {entry.laneId} · {entry.elapsedSec.toFixed(1)}s
                      </span>
                      {entry.sourceIdsSeen.length > 0 && (
                        <>
                          <span className="text-[var(--ink-muted)]">·</span>
                          <span className="font-mono-num text-[var(--accent)]">
                            {t('auditSourcesPrefix')}{entry.sourceIdsSeen.map((s) => `[${s}]`).join(' ')}
                          </span>
                        </>
                      )}
                    </div>
                    <span className="text-xs font-medium text-[var(--accent)]">
                      {isOpen ? t('hideRawPrompt') : t('viewRawPrompt')}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 pt-2 border-t border-[var(--border)] bg-[var(--bg-subtle)]">
                      <pre className="text-[12px] font-mono-num whitespace-pre-wrap text-[var(--ink-secondary)] leading-relaxed overflow-x-auto">
                        {entry.rawPrompt}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
