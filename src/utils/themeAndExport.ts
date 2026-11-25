import type { AppSettings, LaneInfo, PerspectivePreset, Room, ThemeMode } from '../types.ts';
import { DEFAULT_PRESETS } from '../presets.ts';
import { describeRetrieval, formatClaimCounts, sourceTypeLabel } from './researchLabels.ts';
import {
  formatExecutiveSummary,
  formatReportSubtitle,
  formatReportTitle,
  formatStructuredWarning,
  localizeHandle,
  localizeRoomTitle,
  translate,
  type UiLanguage,
} from './i18n.tsx';

export function formatLaneDisplay(
  laneId: string | undefined,
  laneDetails?: LaneInfo[],
  lang: UiLanguage = 'vi'
): string {
  if (!laneId) return translate(lang, 'auto');
  const found = laneDetails?.find((l) => l.id === laneId);
  if (!found) return laneId;
  const custom = found.name && found.name !== found.id ? found.name : '';
  return custom ? `${found.id} (${custom})` : found.id;
}

export const THEME_STORAGE_KEY = 'research_lab_theme_v2';
export const PANELS_STORAGE_KEY = 'research_lab_panels_v2';
export const PRESETS_STORAGE_KEY = 'research_lab_presets_v3';
export const SETTINGS_STORAGE_KEY = 'research_lab_settings_v2';

export function getPerspectiveColorVar(colorIndex: number): string {
  const safe = Math.abs(colorIndex) % 10;
  return `var(--p-${safe})`;
}

export function loadTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyAndSaveTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

export function loadPanelPrefs(): { leftOpen: boolean; rightOpen: boolean } {
  try {
    const raw = localStorage.getItem(PANELS_STORAGE_KEY);
    if (!raw) return { leftOpen: window.innerWidth >= 1220, rightOpen: false };
    const parsed = JSON.parse(raw) as { leftOpen?: boolean; rightOpen?: boolean };
    return {
      leftOpen: Boolean(parsed.leftOpen),
      rightOpen: Boolean(parsed.rightOpen),
    };
  } catch {
    return { leftOpen: false, rightOpen: false };
  }
}

export function savePanelPrefs(prefs: { leftOpen: boolean; rightOpen: boolean }): void {
  try {
    localStorage.setItem(PANELS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function loadPresets(): PerspectivePreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) return DEFAULT_PRESETS;
    const parsed = JSON.parse(raw) as PerspectivePreset[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_PRESETS;
  } catch {
    return DEFAULT_PRESETS;
  }
}

export function savePresets(presets: PerspectivePreset[]): void {
  try {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // ignore
  }
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return {
        maxConcurrency: 3,
        approveResearchPlan: true,
        anonymizeJudge: true,
        detailMode: 'deep',
        judgeModel: 'gemini-neon',
        judgeProviderId: 'bridge-local',
        judgeLaneId: '',
        judgeRuns: 2,
        claimCheck: true,
      };
    }
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      maxConcurrency: parsed.maxConcurrency ?? 3,
      approveResearchPlan: parsed.approveResearchPlan ?? true,
      anonymizeJudge: parsed.anonymizeJudge ?? true,
      detailMode: parsed.detailMode === 'standard' ? 'standard' : 'deep',
      judgeModel: parsed.judgeModel || 'gemini-neon',
      judgeProviderId: parsed.judgeProviderId || 'bridge-local',
      judgeLaneId: parsed.judgeLaneId || '',
      judgeRuns: Math.max(1, Math.min(3, Number(parsed.judgeRuns ?? 2) || 2)),
      claimCheck: parsed.claimCheck ?? true,
    };
  } catch {
    return {
      maxConcurrency: 2,
      approveResearchPlan: true,
      anonymizeJudge: true,
      detailMode: 'deep',
      judgeRuns: 2,
      claimCheck: true,
    };
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export function generateRoomMarkdown(room: Room, lang: UiLanguage = 'vi'): string {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
    translate(lang, key, vars);
  const lines: string[] = [];
  lines.push(`# ${localizeRoomTitle(room.title, lang)}`);
  lines.push('');
  lines.push(
    `> ${room.perspectives.filter((p) => p.enabled).length}/${room.perspectives.length} · ${t('sourcesCountShort', { count: room.sources.length })}`
  );
  lines.push('');

  if (room.report) {
    lines.push(`## ${formatReportTitle(room.report, lang)}`);
    lines.push(`*${formatReportSubtitle(room.report, lang)}*`);
    lines.push('');
    lines.push(`### ${t('sec1Title')}`);
    lines.push(formatExecutiveSummary(room.report, lang));
    lines.push('');

    if (room.report.rubric.length > 0) {
      lines.push(`## ${t('toc4')}`);
      lines.push(
        `| ${t('colPerspective')} | ${t('colEvidence')} | ${t('colLogic')} | ${t('colRebuttal')} | ${t('colTotal')} | ${t('colSpread')} |`
      );
      lines.push('| :--- | :---: | :---: | :---: | :---: | :---: |');
      for (const row of room.report.rubric) {
        const tag = row.fallbackScored ? ` *(${t('fallbackBadge')})*` : '';
        const spread =
          row.runsTotal && row.runsTotal > 1
            ? `±${(row.totalSpread ?? 0).toFixed(1)} (${row.runsScored ?? 0}/${row.runsTotal})`
            : '1';
        lines.push(
          `| @${localizeHandle(row.handle, lang)}${tag} | ${row.evidence.toFixed(1)} | ${row.logic.toFixed(1)} | ${row.rebuttal.toFixed(1)} | **${row.total.toFixed(1)}** | ${spread} |`
        );
      }
      const rel = room.report.judgeReliability;
      if (rel) {
        lines.push('');
        const rankTxt =
          rel.rankingStable === null
            ? t('rankingInsufficient')
            : rel.rankingStable
            ? t('rankingStable')
            : t('rankingChanged');
        lines.push(
          `> ${t('judgeReliabilityTitle')}: ${rel.runsParsed}/${rel.runsRequested} · ${rankTxt} · ${t('judgeFamilyLabel')} ${rel.judgeFamily}${rel.sameFamilyAsDebaters ? t('sameFamilyWarn') : ''} · seed ${rel.seed}`
        );
      }
      const claims = room.report.verificationSummary?.claimSupport;
      if (claims) {
        lines.push(`> ${t('claimSupportSummaryHeading', { summary: formatClaimCounts(claims.totals, lang) })}`);
      }
      const mdWarnings =
        room.report.evaluationWarningItems && room.report.evaluationWarningItems.length > 0
          ? room.report.evaluationWarningItems.map((w) => formatStructuredWarning(w, lang))
          : room.report.evaluationWarnings ?? [];
      for (const w of mdWarnings) {
        lines.push(`> ⚠ ${w}`);
      }
      lines.push('');
    }
  }

  lines.push(`## ${t('navChat')}`);
  for (const m of room.messages) {
    if (m.senderType === 'user') {
      lines.push(`### [${t('yourQuestion')} · ${t('roundN', { round: m.round })}]`);
      lines.push(m.content);
    } else if (m.senderType === 'system') {
      lines.push(`### [${t('dossierTitle')} · ${t('roundN', { round: m.round })}]`);
      lines.push(m.content);
    } else if (m.senderType === 'ai') {
      lines.push(
        `### @${m.handle} (${t('roundN', { round: m.round })} · ${m.modelLabel ?? ''} · ${m.elapsedSec ?? 0}s)`
      );
      lines.push(m.content);
    } else if (m.senderType === 'judge') {
      lines.push(`### ${t('judgeRoundTitle')} (${t('roundN', { round: m.round })})`);
      lines.push(m.content);
    }
    lines.push('');
  }

  if (room.sources.length > 0) {
    lines.push(`## ${t('sec5Title', { count: room.sources.length })}`);
    for (const s of room.sources) {
      lines.push(`- **[${s.id}]** (${s.origin}) ${s.title} — ${s.url} · *${sourceTypeLabel(s, lang)}*`);
      const how = describeRetrieval(s, lang);
      if (how) lines.push(`  - ${how}`);
      lines.push(`  > "${s.excerpt}"`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function triggerFileDownload(filename: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
