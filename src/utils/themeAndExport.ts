import type { AppSettings, LaneInfo, PerspectivePreset, Room, ThemeMode } from '../types.ts';
import { DEFAULT_PRESETS } from '../presets.ts';

export function formatLaneDisplay(laneId: string | undefined, laneDetails?: LaneInfo[]): string {
  if (!laneId) return 'Tự động';
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
    };
  } catch {
    return {
      maxConcurrency: 2,
      approveResearchPlan: true,
      anonymizeJudge: true,
      detailMode: 'deep',
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

export function generateRoomMarkdown(room: Room): string {
  const lines: string[] = [];
  lines.push(`# ${room.title}`);
  lines.push('');
  lines.push(
    `> Phòng nghiên cứu · ${room.perspectives.filter((p) => p.enabled).length}/${room.perspectives.length} góc nhìn đang bật · ${room.sources.length} nguồn xác minh`
  );
  lines.push('');

  if (room.report) {
    lines.push('## 1. Tóm tắt kết luận');
    lines.push(room.report.executiveSummary);
    lines.push('');

    if (room.report.rubric.length > 0) {
      lines.push('## 2. Bảng điểm Trọng tài');
      lines.push('| Góc nhìn | Bằng chứng | Logic | Phản biện | Tổng |');
      lines.push('| :--- | :---: | :---: | :---: | :---: |');
      for (const row of room.report.rubric) {
        const tag = row.fallbackScored ? ' *(dự phòng)*' : '';
        lines.push(
          `| @${row.handle}${tag} | ${row.evidence.toFixed(1)} | ${row.logic.toFixed(1)} | ${row.rebuttal.toFixed(1)} | **${row.total.toFixed(1)}** |`
        );
      }
      lines.push('');
    }
  }

  lines.push('## 3. Diễn biến thảo luận');
  for (const m of room.messages) {
    if (m.senderType === 'user') {
      lines.push(`### [Bạn · Vòng ${m.round}]`);
      lines.push(m.content);
    } else if (m.senderType === 'system') {
      lines.push(`### [Hồ sơ Tài liệu Nghiên cứu · Vòng ${m.round}]`);
      lines.push(m.content);
    } else if (m.senderType === 'ai') {
      lines.push(
        `### @${m.handle} (Vòng ${m.round} · ${m.modelLabel ?? ''} · ${m.elapsedSec ?? 0}s)`
      );
      lines.push(m.content);
    } else if (m.senderType === 'judge') {
      lines.push(`### Trọng tài (Vòng ${m.round})`);
      lines.push(m.content);
    }
    lines.push('');
  }

  if (room.sources.length > 0) {
    lines.push('## 4. Tài liệu tham khảo');
    for (const s of room.sources) {
      lines.push(`- **[${s.id}]** (${s.origin}) ${s.title} — ${s.url}`);
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
