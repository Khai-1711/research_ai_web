import React, { useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CornerDownLeft,
  FileUp,
  Link2,
  Play,
  Rocket,
  Scale,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { Perspective } from '../types.ts';
import { getPerspectiveColorVar } from '../utils/themeAndExport.ts';
import {
  getHandleAliases,
  localizeHandle,
  localizeRoleName,
  translate,
  type UiLanguage,
  useI18n,
} from '../utils/i18n.tsx';

interface ComposerProps {
  value: string;
  onChange: (val: string) => void;
  perspectives: Perspective[];
  maxConcurrency: number;
  isBusy: boolean;
  approveResearchPlan: boolean;
  detailMode: 'deep' | 'standard';
  onToggleDetailMode: () => void;
  onSend: (prompt: string, targetPerspectives: Perspective[]) => void;
  onAutoDebate: (rounds: number) => void;
  onRunJudge: () => void;
  onRunDeepResearch: (query: string) => void;
  onRunFullPipeline: (query: string) => void;
  onAttachUrlOrText: (payload: {
    url?: string;
    title?: string;
    text?: string;
    pdfFile?: File;
  }) => Promise<void>;
}

export function resolveTargetsFromPrompt(
  prompt: string,
  perspectives: Perspective[],
  lang: UiLanguage = 'vi'
): { targets: Perspective[]; label: string } {
  const tagMatches = Array.from(prompt.matchAll(/@#([^\s.,!?;:]+)/g)).map((m) =>
    m[1].toLowerCase()
  );
  const handleMatches = Array.from(prompt.matchAll(/(?<!\S)@([^#\s.,!?;:]+)/g)).map((m) =>
    m[1].toLowerCase()
  );

  if (tagMatches.length > 0 || handleMatches.length > 0) {
    const matched = perspectives.filter((p) => {
      const aliases = getHandleAliases(p.handle);
      const hHit = handleMatches.some((hm) => aliases.includes(hm));
      const tHit = p.tags.some((t) => tagMatches.includes(t.toLowerCase()));
      return hHit || tHit;
    });
    if (matched.length > 0) {
      const prefix =
        tagMatches.length > 0
          ? translate(lang, 'composerGroupPrefix', { tags: tagMatches.join(', #') })
          : matched.map((m) => `@${localizeHandle(m.handle, lang)}`).join(', ');
      return {
        targets: matched,
        label: translate(lang, 'composerTargetsCount', { prefix, count: matched.length }),
      };
    }
  }

  const enabled = perspectives.filter((p) => p.enabled);
  return {
    targets: enabled,
    label: translate(lang, 'composerEnabledRatio', {
      enabled: enabled.length,
      total: perspectives.length,
    }),
  };
}

export function Composer({
  value,
  onChange,
  perspectives,
  maxConcurrency,
  isBusy,
  approveResearchPlan,
  detailMode,
  onToggleDetailMode,
  onSend,
  onAutoDebate,
  onRunJudge,
  onRunDeepResearch,
  onRunFullPipeline,
  onAttachUrlOrText,
}: ComposerProps) {
  const { lang, t } = useI18n();
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [attachUrl, setAttachUrl] = useState('');
  const [attachNoteTitle, setAttachNoteTitle] = useState('');
  const [attachNoteBody, setAttachNoteBody] = useState('');
  const [attachPdfFile, setAttachPdfFile] = useState<File | null>(null);
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachError, setAttachError] = useState('');
  const pdfInputRef = useRef<HTMLInputElement | null>(null);

  const [pendingResearchQuery, setPendingResearchQuery] = useState<string | null>(null);

  const { targets, label } = useMemo(() => {
    const resolved = resolveTargetsFromPrompt(value, perspectives, lang);
    if (
      resolved.targets.length === perspectives.filter((p) => p.enabled).length &&
      !/@\S+/.test(value)
    ) {
      return {
        targets: resolved.targets,
        label: t('activePerspectivesLabel', {
          enabled: resolved.targets.length,
          total: perspectives.length,
        }),
      };
    }
    return resolved;
  }, [value, perspectives, lang, t]);

  const batchEstimate = Math.max(1, Math.ceil(targets.length / Math.max(1, maxConcurrency)));

  // Autocomplete popover when typing @ or @#
  const mentionQuery = useMemo(() => {
    const match = value.match(/(?:^|\s)@(#?[^\s]*)$/);
    return match ? match[1] : null;
  }, [value]);

  const mentionOptions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    const tags = Array.from(new Set(perspectives.flatMap((p) => p.tags)));
    const tagItems = tags
      .filter((tItem) => !q || `#${tItem.toLowerCase()}`.includes(q) || tItem.toLowerCase().includes(q.replace(/^#/, '')))
      .map((tItem) => ({
        insert: `@#${tItem} `,
        display: `@#${tItem}`,
        sub: t('mentionGroupSub', { count: perspectives.filter((p) => p.tags.includes(tItem)).length }),
        color: 'var(--accent)',
      }));

    if (q.startsWith('#')) return tagItems;

    const roleItems = perspectives
      .filter((p) => {
        const disp = localizeHandle(p.handle, lang);
        const roleDisp = localizeRoleName(p.name, lang);
        return (
          !q ||
          p.handle.toLowerCase().includes(q) ||
          disp.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          roleDisp.toLowerCase().includes(q)
        );
      })
      .map((p) => {
        const disp = localizeHandle(p.handle, lang);
        return {
          insert: `@${disp} `,
          display: `@${disp}`,
          sub: localizeRoleName(p.name, lang),
          color: getPerspectiveColorVar(p.colorIndex),
        };
      });

    return [...roleItems, ...tagItems].slice(0, 7);
  }, [mentionQuery, perspectives, lang, t]);

  const insertMention = (token: string) => {
    const replaced = value.replace(/(?:^|\s)@(#?[^\s]*)$/, (full) => {
      const leadingSpace = full.startsWith(' ') ? ' ' : '';
      return leadingSpace + token;
    });
    onChange(replaced);
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!value.trim() || isBusy || targets.length === 0) return;
    onSend(value.trim(), targets);
  };

  const handleDeepResearchClick = () => {
    const q = value.trim() || t('defaultResearchQuery');
    if (approveResearchPlan) {
      setPendingResearchQuery(q);
    } else {
      onRunDeepResearch(q);
    }
  };

  const handleAttachSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttachError('');
    if (!attachPdfFile && !attachUrl.trim() && !attachNoteBody.trim()) {
      setAttachError(t('attachEmptyErr'));
      return;
    }
    setAttachBusy(true);
    try {
      await onAttachUrlOrText({
        pdfFile: attachPdfFile || undefined,
        url: attachUrl.trim() || undefined,
        title: attachNoteTitle.trim() || undefined,
        text: attachNoteBody.trim() || undefined,
      });
      setAttachPdfFile(null);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
      setAttachUrl('');
      setAttachNoteTitle('');
      setAttachNoteBody('');
      setShowUrlModal(false);
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : t('attachFailErr'));
    } finally {
      setAttachBusy(false);
    }
  };

  return (
    <div className="shrink-0 border-t border-[var(--border)] bg-[var(--bg)] px-4 sm:px-8 py-3.5">
      <div className="mx-auto max-w-[78ch] relative space-y-2.5">
        {/* Optional Deep Research Plan Approval Card */}
        {pendingResearchQuery !== null && (
          <div className="p-3.5 rounded-xl border border-[var(--accent)] bg-[var(--surface)] shadow-[var(--shadow-card)] space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--accent)]">
                <Sparkles className="w-3.5 h-3.5" />
                {t('deepResearchPlanHeader')}
              </div>
              <button
                type="button"
                onClick={() => setPendingResearchQuery(null)}
                className="text-[var(--ink-muted)] hover:text-[var(--ink)] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <input
              type="text"
              value={pendingResearchQuery}
              onChange={(e) => setPendingResearchQuery(e.target.value)}
              className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
            />
            <div className="flex items-center justify-between gap-2 text-[11.5px] text-[var(--ink-muted)]">
              <span>{t('deepResearchPlanHint', { count: targets.length })}</span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setPendingResearchQuery(null)}
                  className="px-2.5 py-1 rounded-md text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const q = pendingResearchQuery.trim();
                    setPendingResearchQuery(null);
                    if (q) onRunDeepResearch(q);
                  }}
                  className="px-3 py-1 rounded-md bg-[var(--accent)] text-[var(--accent-ink)] font-medium hover:bg-[var(--accent-hover)] cursor-pointer"
                >
                  {t('runSourcesAndDebate')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Quick workflow actions (calm, 1-click user controls) */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={isBusy}
            onClick={() => {
              const q = value.trim() || t('defaultPipelineQuery');
              if (value.trim()) onChange('');
              onRunFullPipeline(q);
            }}
            title={t('btnFullPipelineTitle')}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] hover:bg-[var(--accent)] text-xs font-semibold text-[var(--accent)] hover:text-[var(--accent-ink)] transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            <Rocket className="w-3 h-3" />
            {t('btnFullPipeline')}
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => onAutoDebate(1)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)] text-xs font-medium text-[var(--ink-secondary)] hover:text-[var(--ink)] transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            <Play className="w-3 h-3 text-[var(--accent)]" />
            {t('btnAutoDebate')}
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={onRunJudge}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)] text-xs font-medium text-[var(--ink-secondary)] hover:text-[var(--ink)] transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            <Scale className="w-3 h-3 text-[var(--accent)]" />
            {t('btnRunJudge')}
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={handleDeepResearchClick}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)] text-xs font-medium text-[var(--ink-secondary)] hover:text-[var(--ink)] transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            <Search className="w-3 h-3 text-[var(--accent)]" />
            {t('btnDeepResearch')}
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => setShowUrlModal(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)] text-xs font-medium text-[var(--ink-secondary)] hover:text-[var(--ink)] transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            <Link2 className="w-3 h-3 text-[var(--accent)]" />
            {t('btnAttachUrl')}
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={onToggleDetailMode}
            title={t('btnModeTitle')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer ${
              detailMode === 'deep'
                ? 'border-[var(--accent)]/60 bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--ink-secondary)] hover:text-[var(--ink)]'
            }`}
          >
            <BookOpen className="w-3 h-3" />
            {detailMode === 'deep' ? t('btnModeDeep') : t('btnModeStandard')}
          </button>
        </div>

        {/* Autocomplete menu for @vai and @#nhóm */}
        {mentionOptions.length > 0 && (
          <div className="absolute bottom-full left-0 mb-2 w-72 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-[var(--shadow-float)] py-1.5 z-30">
            <div className="px-3 py-1 text-[11px] font-medium text-[var(--ink-muted)]">
              {t('mentionMenuTitle')}
            </div>
            {mentionOptions.map((opt) => (
              <button
                key={opt.display}
                type="button"
                onClick={() => insertMention(opt.insert)}
                className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-hover)] flex items-center justify-between gap-2 cursor-pointer"
              >
                <span className="text-xs font-semibold" style={{ color: opt.color }}>
                  {opt.display}
                </span>
                <span className="text-[11px] text-[var(--ink-muted)] truncate">{opt.sub}</span>
              </button>
            ))}
          </div>
        )}

        {/* Main Input Box */}
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] focus-within:border-[var(--accent)] transition-colors shadow-[var(--shadow-card)]"
        >
          <textarea
            rows={2}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={t('composerPlaceholder', { count: targets.length })}
            className="w-full px-4 pt-3 pb-2 bg-transparent text-[14.5px] text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:outline-none resize-none leading-relaxed"
          />
          <div className="px-3.5 pb-2.5 pt-1 flex items-center justify-between gap-3">
            {/* Quiet scope forecast (no garish pill) */}
            <div className="text-[12px] text-[var(--ink-secondary)] truncate">
              {t('sendTo')}{' '}
              <span className="font-medium text-[var(--ink)]">{label}</span>
              <span aria-hidden="true" className="mx-1.5 text-[var(--ink-muted)]">
                ·
              </span>
              <span className="font-mono-num text-[var(--ink-muted)]">
                {t('batchesLabel', { batches: batchEstimate, max: maxConcurrency })}
              </span>
            </div>

            <button
              type="submit"
              disabled={isBusy || !value.trim() || targets.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] hover:bg-[var(--accent-hover)] text-xs font-semibold transition-colors disabled:opacity-45 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {t('btnSend')}
              <CornerDownLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      </div>

      {/* URL / Document Attachment Modal */}
      {showUrlModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-float)] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-[var(--ink)]">
                {t('attachModalTitle')}
              </h3>
              <button
                type="button"
                onClick={() => setShowUrlModal(false)}
                className="p-1 rounded-md text-[var(--ink-muted)] hover:text-[var(--ink)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAttachSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                  {t('attachPdfLabel')}
                </label>
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setAttachPdfFile(f);
                    setAttachError('');
                  }}
                  className="hidden"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => pdfInputRef.current?.click()}
                    className="flex-1 px-3 py-2 text-xs rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--bg)] hover:border-[var(--accent)] text-[var(--ink)] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <FileUp className="w-3.5 h-3.5 text-[var(--accent)]" />
                    <span className="truncate">
                      {attachPdfFile ? attachPdfFile.name : t('attachPdfPick')}
                    </span>
                  </button>
                  {attachPdfFile && (
                    <button
                      type="button"
                      onClick={() => {
                        setAttachPdfFile(null);
                        if (pdfInputRef.current) pdfInputRef.current.value = '';
                      }}
                      title={t('attachPdfUnselect')}
                      className="p-2 rounded-lg border border-[var(--border)] text-[var(--ink-muted)] hover:text-[var(--danger)] cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <div className="text-center text-[11px] text-[var(--ink-muted)]">{t('attachOrUrl')}</div>
              <div>
                <input
                  type="url"
                  value={attachUrl}
                  onChange={(e) => setAttachUrl(e.target.value)}
                  placeholder={t('attachUrlPlaceholder')}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div className="text-center text-[11px] text-[var(--ink-muted)]">{t('attachOrNote')}</div>
              <div className="space-y-2">
                <input
                  type="text"
                  value={attachNoteTitle}
                  onChange={(e) => setAttachNoteTitle(e.target.value)}
                  placeholder={t('attachTitlePlaceholder')}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
                />
                <textarea
                  rows={3}
                  value={attachNoteBody}
                  onChange={(e) => setAttachNoteBody(e.target.value)}
                  placeholder={t('attachBodyPlaceholder')}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)] resize-none"
                />
              </div>
              {attachError && <p className="text-xs text-[var(--danger)]">{attachError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowUrlModal(false)}
                  className="px-3 py-1.5 text-xs rounded-lg text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={attachBusy}
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] hover:bg-[var(--accent-hover)] disabled:opacity-50 cursor-pointer"
                >
                  {attachBusy ? t('attachAdding') : t('attachSubmit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
