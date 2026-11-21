import React from 'react';
import { AlertTriangle, Cpu, RotateCcw, ShieldCheck, Sliders, X } from 'lucide-react';
import type { AppSettings, BridgeHealth } from '../types.ts';

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  health: BridgeHealth | null;
  onResetSeedRooms: () => void;
  isResetting: boolean;
}

export function SettingsDrawer({
  open,
  onClose,
  settings,
  onUpdateSettings,
  health,
  onResetSeedRooms,
  isResetting,
}: SettingsDrawerProps) {
  if (!open) return null;

  const healthyWorkers = health?.healthyWorkers ?? 4;
  const overSubscribed = settings.maxConcurrency > healthyWorkers && healthyWorkers > 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-[2px]">
      <div
        className="w-full max-w-[380px] h-full bg-[var(--surface)] border-l border-[var(--border)] shadow-[var(--shadow-float)] flex flex-col"
        role="dialog"
        aria-label="Cài đặt kỹ thuật và luồng chạy"
      >
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-[var(--ink)]">
              Cài đặt & Điều phối
            </h2>
            <p className="text-xs text-[var(--ink-muted)] mt-0.5">
              Thông số kỹ thuật được gom gọn tại đây để thanh chính luôn thoáng.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-subtle)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Adapter / Bridge Health */}
          <section className="space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]">
              <Cpu className="w-4 h-4 text-[var(--accent)]" />
              Kết nối AI & Worker Lanes
            </div>
            <div className="p-3.5 rounded-xl bg-[var(--bg)] border border-[var(--border)] space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[var(--ink-secondary)]">Chế độ Adapter</span>
                <span className="font-mono-num font-medium text-[var(--ink)]">
                  {health?.mode === 'bridge' ? 'dsh-gemini-bridge' : 'AI Studio Server'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--ink-secondary)]">Số worker khỏe</span>
                <span className="font-mono-num font-medium text-[var(--ok)]">
                  {health ? `${health.healthyWorkers}/${health.totalWorkers} worker` : 'Đang kiểm tra…'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--ink-secondary)]">Mô hình mặc định</span>
                <span className="font-mono-num text-[var(--ink)]">
                  {health?.defaultModel ?? 'gemini-4-hydrogen'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--ink-secondary)]">Lưu trữ phiên</span>
                <span className="font-mono-num text-[var(--ink-secondary)]">
                  events.jsonl + sources.json
                </span>
              </div>
            </div>
          </section>

          {/* Max concurrency */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="concurrency-range"
                className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]"
              >
                <Sliders className="w-4 h-4 text-[var(--accent)]" />
                Luồng chạy song song (max_concurrency)
              </label>
              <span className="font-mono-num text-sm font-semibold text-[var(--accent)]">
                {settings.maxConcurrency} luồng
              </span>
            </div>
            <input
              id="concurrency-range"
              type="range"
              min={1}
              max={6}
              value={settings.maxConcurrency}
              onChange={(e) => onUpdateSettings({ maxConcurrency: Number(e.target.value) })}
              className="w-full accent-[var(--accent)] cursor-pointer"
            />
            <div className="flex justify-between text-[11px] font-mono-num text-[var(--ink-muted)]">
              <span>1 (tuần tự)</span>
              <span>2</span>
              <span>4</span>
              <span>6 (tối đa)</span>
            </div>
            {overSubscribed && (
              <div className="p-2.5 rounded-lg bg-[var(--warn-soft)] text-[var(--warn)] text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Bạn đang đặt {settings.maxConcurrency} luồng vượt quá {healthyWorkers} worker khỏe. Khi nối dsh-gemini-bridge có thể gặp chờ khóa 429 bridge_busy.
                </span>
              </div>
            )}
          </section>

          {/* Research & Judge behavior toggles */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]">
              <ShieldCheck className="w-4 h-4 text-[var(--accent)]" />
              Hành vi nghiên cứu & Trọng tài
            </div>

            <label className="flex items-start justify-between gap-3 p-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] cursor-pointer">
              <div>
                <div className="text-[13px] font-medium text-[var(--ink)]">
                  Duyệt kế hoạch Deep Research
                </div>
                <div className="text-[11.5px] text-[var(--ink-muted)] mt-0.5">
                  Hiển thị từ khóa tìm nguồn arXiv/OpenAlex để bạn xác nhận trước khi chạy.
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.approveResearchPlan}
                onChange={(e) => onUpdateSettings({ approveResearchPlan: e.target.checked })}
                className="mt-1 w-4 h-4 accent-[var(--accent)] cursor-pointer"
              />
            </label>

            <label className="flex items-start justify-between gap-3 p-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] cursor-pointer">
              <div>
                <div className="text-[13px] font-medium text-[var(--ink)]">
                  Ẩn danh góc nhìn khi vào Trọng tài
                </div>
                <div className="text-[11.5px] text-[var(--ink-muted)] mt-0.5">
                  Che tên thật thành Ứng viên A/B/C và gắn biểu tượng mặt nạ trên Flow Map.
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.anonymizeJudge}
                onChange={(e) => onUpdateSettings({ anonymizeJudge: e.target.checked })}
                className="mt-1 w-4 h-4 accent-[var(--accent)] cursor-pointer"
              />
            </label>
          </section>

          {/* Test auto-hiding Bridge Alert Strip */}
          <section className="space-y-2">
            <div className="text-xs font-semibold text-[var(--ink)]">
              Kiểm thử dải cảnh báo Bridge tự ẩn
            </div>
            <p className="text-[11.5px] text-[var(--ink-muted)]">
              Bình thường dải cảnh báo ẩn hoàn toàn. Bạn có thể bật thử để xem cách nó xuất hiện khi có sự cố:
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: 'none', label: 'Bình thường' },
                  { id: 'offline', label: 'Bridge tắt' },
                  { id: 'guest', label: 'Guest Mode' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onUpdateSettings({ simulateBridgeAlert: opt.id })}
                  className={`py-1.5 px-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                    settings.simulateBridgeAlert === opt.id
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)]'
                      : 'bg-[var(--bg)] text-[var(--ink-secondary)] border-[var(--border)] hover:text-[var(--ink)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          {/* Reset seed data */}
          <section className="pt-3 border-t border-[var(--border)]">
            <button
              type="button"
              disabled={isResetting}
              onClick={onResetSeedRooms}
              className="w-full py-2.5 px-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] hover:border-[var(--danger)] hover:text-[var(--danger)] text-xs font-medium text-[var(--ink-secondary)] flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {isResetting ? 'Đang khôi phục…' : 'Khôi phục 3 phòng mẫu ban đầu'}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
