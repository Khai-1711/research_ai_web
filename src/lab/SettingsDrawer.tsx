import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Cpu,
  Edit3,
  KeyRound,
  LogIn,
  Plus,
  RefreshCw,
  Scale,
  ShieldCheck,
  Sliders,
  Trash2,
  UserPlus,
  X,
  Zap,
} from 'lucide-react';
import type {
  AIProviderConfig,
  AppSettings,
  BridgeHealth,
  LaneInfo,
  ModelOption,
  Perspective,
} from '../types.ts';
import {
  createLaneApi,
  createProviderApi,
  deleteProviderApi,
  finishLoginLaneApi,
  loginLaneApi,
  renameLaneApi,
  syncAllLanesApi,
  syncLaneApi,
  testProviderApi,
} from '../utils/api.ts';
import { LanguageSelector, localizeModelLabel, useI18n } from '../utils/i18n.tsx';

// Lưu ý §5.b: role & prompt mẫu gửi cho AI giữ ổn định theo thiết kế; nhãn hiển thị dùng i18n khi render.
const QUICK_ROLE_TEMPLATES = [
  {
    label: 'Nghiên cứu',
    handle: 'Nghiên_cứu',
    role: 'Nghiên cứu & Tổng hợp bằng chứng',
    tag: 'Nghiên_cứu',
    prompt:
      'Bạn phụ trách nghiên cứu chuyên sâu, đọc kỹ nguồn tài liệu [S#], phân tích có cấu trúc rõ ràng và mở đầu bằng "Kết luận: ...".',
  },
  {
    label: 'Phản biện',
    handle: 'Phản_biện',
    role: 'Phản biện & Soi rủi ro',
    tag: 'Phản_biện',
    prompt:
      'Bạn là người phản biện độc lập. Chỉ ra điểm mù, giả định yếu, lỗi âm thầm và rủi ro triển khai. Mở đầu bằng "Kết luận: ...".',
  },
  {
    label: 'Kỹ thuật / Code',
    handle: 'Kỹ_thuật',
    role: 'Kiến trúc Kỹ thuật & Code',
    tag: 'Kỹ_thuật',
    prompt:
      'Bạn là kỹ sư hệ thống. Tập trung vào thiết kế kiến trúc, hiệu năng, độ tin cậy và bảo trì lâu dài. Mở đầu bằng "Kết luận: ...".',
  },
  {
    label: 'Thực tế / Chi phí',
    handle: 'Chi_phí',
    role: 'Đánh giá Chi phí & Khả thi',
    tag: 'Kinh_tế',
    prompt:
      'Bạn đánh giá chi phí triển khai, thời gian, nhân sự và tính thực tế khi vận hành. Mở đầu bằng "Kết luận: ...".',
  },
];

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  activeRoomTitle?: string;
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  health: BridgeHealth | null;
  models: ModelOption[];
  providers: AIProviderConfig[];
  onRefreshProvidersAndModels: () => Promise<void>;
  onAddPerspectiveToRoom: (p: Omit<Perspective, 'id'>) => void;
}

const KIND_LABELS: Record<AIProviderConfig['kind'], string> = {
  bridge: 'DSH Gemini Bridge',
  gemini_api: 'Gemini API Key',
  openai_compat: 'OpenAI / DeepSeek / Groq / Ollama',
};

export function SettingsDrawer({
  open,
  onClose,
  activeRoomTitle,
  settings,
  onUpdateSettings,
  health,
  models,
  providers,
  onRefreshProvidersAndModels,
  onAddPerspectiveToRoom,
}: SettingsDrawerProps) {
  const { lang, t } = useI18n();
  const [showAddForm, setShowAddForm] = useState(false);
  const [kind, setKind] = useState<AIProviderConfig['kind']>('gemini_api');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState('gemini-2.5-flash');
  const [roleTitle, setRoleTitle] = useState('Nghiên cứu & Phản biện');
  const [alsoAddToRoom, setAlsoAddToRoom] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; text: string }>>({});

  // Per-lane (acc1, acc2, acc3...) rename & assign-role state
  const [renamingLaneId, setRenamingLaneId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);

  const [assignLaneId, setAssignLaneId] = useState<string | null>(null);
  const [assignHandle, setAssignHandle] = useState('');
  const [assignRole, setAssignRole] = useState('');
  const [assignPrompt, setAssignPrompt] = useState('');
  const [assignTag, setAssignTag] = useState('Nghiên_cứu');
  const [assignModel, setAssignModel] = useState('gemini-neon');
  const [vaultBusyKey, setVaultBusyKey] = useState<string | null>(null);

  const rawLaneDetails: LaneInfo[] = health?.laneDetails?.length
    ? health.laneDetails
    : (health?.lanes || []).map((id) => ({
        id,
        name: id,
        bridgeLabel: id,
        url: '',
        reachable: true,
        control: 'on',
        authOk: !health?.guestMode,
        model: health?.defaultModel || 'gemini-4-hydrogen',
        accountStatus: 'AVAILABLE',
      }));

  const hasPendingVaultLogin = rawLaneDetails.some((l) => l.loginOpen || l.syncing);
  useEffect(() => {
    if (!open || !hasPendingVaultLogin) return;
    const timer = window.setInterval(() => {
      void onRefreshProvidersAndModels();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [open, hasPendingVaultLogin, onRefreshProvidersAndModels]);

  if (!open) return null;

  const laneDetails = rawLaneDetails;

  const bridgeModels = models.filter((m) => m.providerId === 'bridge-local');
  const fallbackBridgeModels: ModelOption[] =
    bridgeModels.length > 0
      ? bridgeModels
      : [
          {
            id: 'gemini-neon',
            label: localizeModelLabel({ id: 'gemini-neon', label: '4 Neon — Phân tích sâu hơn' }, lang),
            providerId: 'bridge-local',
            providerName: 'Bridge',
          },
          {
            id: 'gemini-carbon',
            label: localizeModelLabel({ id: 'gemini-carbon', label: '4 Carbon — Lập trình & Phức tạp' }, lang),
            providerId: 'bridge-local',
            providerName: 'Bridge',
          },
          {
            id: 'gemini-4-hydrogen',
            label: localizeModelLabel({ id: 'gemini-4-hydrogen', label: '4 Hydrogen — Trợ giúp hằng ngày' }, lang),
            providerId: 'bridge-local',
            providerName: 'Bridge',
          },
        ];

  const handleSaveLaneName = async (laneId: string) => {
    setRenameBusy(true);
    setFormMsg(null);
    try {
      await renameLaneApi(laneId, renameDraft.trim());
      await onRefreshProvidersAndModels();
      setRenamingLaneId(null);
      setFormMsg({
        ok: true,
        text: renameDraft.trim()
          ? t('settingsLaneRenamed', { id: laneId, name: renameDraft.trim() })
          : t('settingsLaneReset', { id: laneId }),
      });
    } catch (err) {
      setFormMsg({
        ok: false,
        text: err instanceof Error ? err.message : t('settingsErrRename'),
      });
    } finally {
      setRenameBusy(false);
    }
  };

  const openAssignForm = (lane: LaneInfo) => {
    if (assignLaneId === lane.id) {
      setAssignLaneId(null);
      return;
    }
    const cleanDefaultHandle =
      (lane.name && lane.name !== lane.id && lane.name !== lane.bridgeLabel ? lane.name : lane.id)
        .replace(/[^a-zA-Z0-9_\u00C0-\u1EF9]+/g, '_')
        .replace(/^_+|_+$/g, '') || lane.id;
    setAssignLaneId(lane.id);
    setAssignHandle(cleanDefaultHandle);
    setAssignRole('Nghiên cứu & Phân tích');
    setAssignTag('Nghiên_cứu');
    // Lưu ý §5.b: Prompt vai trò mặc định gửi cho AI
    setAssignPrompt(
      'Bạn phụ trách nghiên cứu chuyên sâu, phân tích rõ luận điểm, trích dẫn [S#] khi có nguồn và mở đầu bằng "Kết luận: ...".'
    );
    setAssignModel(fallbackBridgeModels[0]?.id || 'gemini-neon');
    setFormMsg(null);
  };

  const handleAssignLaneSubmit = (e: React.FormEvent, lane: LaneInfo) => {
    e.preventDefault();
    const cleanHandle =
      assignHandle
        .trim()
        .replace(/^@/, '')
        .replace(/\s+/g, '_') || lane.id;
    const roleLabel = assignRole.trim() || lane.name || lane.id;
    onAddPerspectiveToRoom({
      handle: cleanHandle,
      name: roleLabel,
      // Lưu ý §5.b: Prompt vai trò mặc định gửi cho AI
      rolePrompt:
        assignPrompt.trim() ||
        `Bạn đảm nhận vai trò "${roleLabel}". Phân tích rõ ràng, sắc bén và mở đầu bằng "Kết luận: ...".`,
      tags: [assignTag.trim().replace(/^#/, '') || 'Nghiên_cứu'],
      modelLabel: assignModel || 'gemini-neon',
      providerId: 'bridge-local',
      pinnedLaneId: lane.id,
      colorIndex: (laneDetails.findIndex((l) => l.id === lane.id) + 1) % 10,
      enabled: true,
    });
    setAssignLaneId(null);
    const namePart = lane.name && lane.name !== lane.id ? ` (${lane.name})` : '';
    setFormMsg({
      ok: true,
      text: t('settingsAssignedLane', { id: lane.id, namePart, handle: cleanHandle, role: roleLabel }),
    });
  };

  const handleCreateLane = async () => {
    setVaultBusyKey('create-lane');
    setFormMsg(null);
    try {
      const res = await createLaneApi();
      await onRefreshProvidersAndModels();
      setFormMsg({
        ok: true,
        text: t('settingsCreatedLane', { id: res.lane_id, port: res.port }),
      });
    } catch (err) {
      setFormMsg({
        ok: false,
        text: err instanceof Error ? err.message : t('settingsErrCreateLane'),
      });
    } finally {
      setVaultBusyKey(null);
    }
  };

  const handleSyncAllLanes = async () => {
    setVaultBusyKey('sync-all');
    setFormMsg(null);
    try {
      const res = await syncAllLanesApi();
      await onRefreshProvidersAndModels();
      setFormMsg({
        ok: res.total === 0 ? false : res.synced === res.total,
        text:
          res.total === 0
            ? t('settingsNoLoggedInSync')
            : t('settingsSyncedAll', { synced: res.synced, total: res.total }),
      });
    } catch (err) {
      setFormMsg({
        ok: false,
        text: err instanceof Error ? err.message : t('settingsErrSyncAll'),
      });
    } finally {
      setVaultBusyKey(null);
    }
  };

  const handleLaneLogin = async (lane: LaneInfo) => {
    setVaultBusyKey(`login::${lane.id}`);
    setFormMsg(null);
    try {
      const res = await loginLaneApi(lane.id, lane.name);
      await onRefreshProvidersAndModels();
      setFormMsg({
        ok: true,
        text: res.message || t('settingsLoginOpened', { id: lane.id }),
      });
    } catch (err) {
      setFormMsg({
        ok: false,
        text: err instanceof Error ? err.message : t('settingsErrLogin', { id: lane.id }),
      });
    } finally {
      setVaultBusyKey(null);
    }
  };

  const handleFinishLaneLogin = async (lane: LaneInfo) => {
    setVaultBusyKey(`finish::${lane.id}`);
    setFormMsg(null);
    try {
      const res = await finishLoginLaneApi(lane.id);
      await onRefreshProvidersAndModels();
      const keyPart = res.account_key ? ` (${res.account_key.slice(0, 6)})` : '';
      setFormMsg({
        ok: true,
        text: t('settingsCookieLoaded', { id: lane.id, keyPart }),
      });
    } catch (err) {
      setFormMsg({
        ok: false,
        text: err instanceof Error ? err.message : t('settingsErrFinishLogin', { id: lane.id }),
      });
    } finally {
      setVaultBusyKey(null);
    }
  };

  const handleSyncLane = async (lane: LaneInfo) => {
    setVaultBusyKey(`sync::${lane.id}`);
    setFormMsg(null);
    try {
      const res = await syncLaneApi(lane.id, lane.name);
      await onRefreshProvidersAndModels();
      const keyPart = res.account_key ? ` (${res.account_key.slice(0, 6)})` : '';
      setFormMsg({
        ok: true,
        text: t('settingsSyncedOne', { id: lane.id, keyPart }),
      });
    } catch (err) {
      setFormMsg({
        ok: false,
        text: err instanceof Error ? err.message : t('settingsErrSyncOne', { id: lane.id }),
      });
    } finally {
      setVaultBusyKey(null);
    }
  };

  const healthyWorkers = health?.healthyWorkers ?? 0;
  const totalWorkers = health?.totalWorkers ?? 0;
  const overSubscribed = healthyWorkers > 0 && settings.maxConcurrency > healthyWorkers;

  const handleKindChange = (nextKind: AIProviderConfig['kind']) => {
    setKind(nextKind);
    setFormMsg(null);
    if (nextKind === 'bridge') {
      setBaseUrl('http://127.0.0.1:10000');
      setDefaultModel('gemini-neon');
    } else if (nextKind === 'gemini_api') {
      setBaseUrl('');
      setDefaultModel('gemini-2.5-flash');
    } else {
      setBaseUrl('https://api.openai.com/v1');
      setDefaultModel('gpt-4o-mini');
    }
  };

  const handleCreateProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormMsg(null);
    try {
      const res = await createProviderApi({
        name: name.trim(),
        kind,
        baseUrl: baseUrl.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        defaultModel: defaultModel.trim() || undefined,
      });
      await onRefreshProvidersAndModels();

      if (alsoAddToRoom) {
        const cleanHandle = name
          .trim()
          .replace(/^@/, '')
          .replace(/[^a-zA-Z0-9_\u00C0-\u1EF9]+/g, '_')
          .replace(/^_+|_+$/g, '') || 'AI_Mới';
        onAddPerspectiveToRoom({
          handle: cleanHandle,
          name: roleTitle.trim() || res.provider.name,
          rolePrompt: `Bạn đảm nhận vai trò "${roleTitle.trim() || res.provider.name}". Phân tích khách quan, rõ luận điểm, trích dẫn [S#] khi có nguồn và mở đầu bằng "Kết luận: ...".`,
          tags: [kind === 'bridge' ? 'Bridge' : 'API'],
          modelLabel: res.provider.defaultModel || defaultModel.trim(),
          providerId: res.provider.id,
          colorIndex: providers.length % 10,
          enabled: true,
        });
      }

      setFormMsg({
        ok: true,
        text: t('settingsProviderAdded', {
          name: res.provider.name,
          model: res.provider.defaultModel || defaultModel.trim(),
        }),
      });
      setName('');
      setApiKey('');
      setShowAddForm(false);
    } catch (err) {
      setFormMsg({
        ok: false,
        text: err instanceof Error ? err.message : t('settingsErrAddProvider'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleTest = async (providerId: string, laneId?: string) => {
    const key = laneId ? `${providerId}::${laneId}` : providerId;
    setTestingId(key);
    try {
      const res = await testProviderApi(providerId, laneId);
      setTestResults((prev) => ({
        ...prev,
        [key]: {
          ok: true,
          text: `OK (${res.laneId || laneId || 'bridge'} · ${res.modelUsed} · ${res.elapsedSec}s): ${res.preview || t('settingsTestOkFallback')}`,
        },
      }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [key]: {
          ok: false,
          text: err instanceof Error ? err.message : t('settingsErrTest'),
        },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (providerId: string) => {
    try {
      await deleteProviderApi(providerId);
      await onRefreshProvidersAndModels();
    } catch (err) {
      setFormMsg({
        ok: false,
        text: err instanceof Error ? err.message : t('settingsErrDeleteProvider'),
      });
    }
  };

  const selectedJudgeKey = `${settings.judgeProviderId || 'bridge-local'}::${settings.judgeModel || 'gemini-neon'}`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35 backdrop-blur-[2px]">
      <div
        className="w-full max-w-[430px] h-full bg-[var(--surface)] border-l border-[var(--border)] shadow-[var(--shadow-float)] flex flex-col"
        role="dialog"
        aria-label={t('settingsAriaLabel')}
      >
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-[var(--ink)]">
              {t('settingsTitleHeading')}
            </h2>
            <p className="text-xs text-[var(--ink-muted)] mt-0.5">
              {t('settingsSubtitle')}
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
          {/* 0. UI Language Selector */}
          <section className="p-3.5 rounded-xl bg-[var(--bg)] border border-[var(--border)] space-y-2">
            <div className="text-xs font-semibold text-[var(--ink)]">{t('langSectionTitle')}</div>
            <p className="text-[11px] text-[var(--ink-muted)] leading-relaxed">
              {t('langSectionHint')}
            </p>
            <LanguageSelector />
            <p className="text-[11px] text-[var(--accent)] font-medium">
              {t('langAutoAiNote')}
            </p>
          </section>

          {/* 1. AI Providers (Bridge + API Key) */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]">
                <KeyRound className="w-4 h-4 text-[var(--accent)]" />
                {t('connectedProvidersTitle', { count: providers.length })}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onRefreshProvidersAndModels()}
                  title={t('reloadProvidersTitle')}
                  className="p-1.5 rounded-lg border border-[var(--border)] text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:border-[var(--accent)] cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddForm((v) => !v);
                    setFormMsg(null);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-semibold hover:bg-[var(--accent-hover)] cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t('addAiBtn')}
                </button>
              </div>
            </div>

            {formMsg && (
              <div
                className={`p-2.5 rounded-lg text-xs border ${
                  formMsg.ok
                    ? 'bg-[var(--ok-soft)] text-[var(--ok)] border-[var(--ok)]/30'
                    : 'bg-[var(--danger-soft)] text-[var(--danger)] border-[var(--danger)]/30'
                }`}
              >
                {formMsg.text}
              </div>
            )}

            {/* Add AI form */}
            {showAddForm && (
              <form
                onSubmit={handleCreateProvider}
                className="p-3.5 rounded-xl bg-[var(--bg)] border border-[var(--accent)]/50 space-y-2.5 text-xs"
              >
                <div className="font-semibold text-[var(--ink)]">{t('addProviderHeading')}</div>

                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      { id: 'bridge', label: t('kindBridgeLocal') },
                      { id: 'gemini_api', label: t('kindGeminiApi') },
                      { id: 'openai_compat', label: t('kindOpenAiCompat') },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleKindChange(opt.id)}
                      className={`py-1.5 px-2 rounded-lg font-medium border transition-colors cursor-pointer ${
                        kind === opt.id
                          ? 'bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)]'
                          : 'bg-[var(--surface)] text-[var(--ink-secondary)] border-[var(--border)] hover:text-[var(--ink)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div>
                  <label className="block text-[11px] text-[var(--ink-muted)] mb-1">
                    {t('providerNameLabel')}
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={
                      kind === 'bridge'
                        ? 'Gemini_Bridge_2'
                        : kind === 'gemini_api'
                        ? 'Gemini_API_Main'
                        : 'DeepSeek_R1 / Ollama_Local'
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>

                {kind !== 'gemini_api' && (
                  <div>
                    <label className="block text-[11px] text-[var(--ink-muted)] mb-1">
                      {kind === 'bridge' ? t('providerUrlBridge') : t('providerUrlBase')}
                    </label>
                    <input
                      type="text"
                      required={kind === 'openai_compat'}
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder={
                        kind === 'bridge'
                          ? 'http://127.0.0.1:11000'
                          : 'https://api.deepseek.com/v1'
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] font-mono-num focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-[11px] text-[var(--ink-muted)] mb-1">
                    API Key {kind === 'bridge' ? t('apiKeyOptional') : kind === 'openai_compat' ? t('apiKeyOllama') : t('apiKeyRequired')}
                  </label>
                  <input
                    type="password"
                    required={kind === 'gemini_api'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={kind === 'gemini_api' ? 'AIza...' : 'sk-...'}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] font-mono-num focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-[var(--ink-muted)] mb-1">{t('defaultModelLabel')}</label>
                    <input
                      type="text"
                      required
                      value={defaultModel}
                      onChange={(e) => setDefaultModel(e.target.value)}
                      placeholder="gemini-neon"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] font-mono-num focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[var(--ink-muted)] mb-1">{t('roleOnAddLabel')}</label>
                    <input
                      type="text"
                      value={roleTitle}
                      onChange={(e) => setRoleTitle(e.target.value)}
                      placeholder="Risk & Fact Critic"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 pt-1 text-[var(--ink-secondary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={alsoAddToRoom}
                    onChange={(e) => setAlsoAddToRoom(e.target.checked)}
                    className="accent-[var(--accent)]"
                  />
                  <span>{t('alsoAddToRoomLabel')}</span>
                </label>

                <div className="flex justify-end gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-2.5 py-1.5 rounded-lg text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] cursor-pointer"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] font-semibold hover:bg-[var(--accent-hover)] disabled:opacity-50 cursor-pointer"
                  >
                    {submitting ? t('savingText') : t('saveProviderBtn')}
                  </button>
                </div>
              </form>
            )}

            {/* List of connected providers */}
            <div className="space-y-2">
              {providers.map((p) => {
                const test = testResults[p.id];
                const isDefaultBridge = p.id === 'bridge-local';
                return (
                  <div
                    key={p.id}
                    className="p-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] space-y-1.5 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-[var(--ink)] flex items-center gap-1.5">
                          <Cpu className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                          <span className="truncate">{p.name}</span>
                        </div>
                        <div className="text-[11px] text-[var(--ink-muted)] mt-0.5">
                          {KIND_LABELS[p.kind]} · <span className="font-mono-num">{p.defaultModel}</span>
                        </div>
                        {isDefaultBridge && health && (
                          <div className="text-[11px] mt-1 font-mono-num text-[var(--ok)] flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            {t('loggedInLanesSummary', {
                              healthy: health.healthyWorkers,
                              total: health.totalWorkers,
                              lanes: health.lanes.join(', '),
                            })}
                          </div>
                        )}
                        {!isDefaultBridge && p.hasApiKey && (
                          <div className="text-[11px] text-[var(--ink-muted)] font-mono-num mt-0.5">
                            Key: {p.apiKeyMasked}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={testingId === p.id}
                          onClick={() => handleTest(p.id)}
                          className="px-2 py-1 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[11px] font-medium text-[var(--ink-secondary)] hover:border-[var(--accent)] hover:text-[var(--ink)] disabled:opacity-50 cursor-pointer"
                        >
                          {testingId === p.id ? t('testingShort') : t('testBtn')}
                        </button>
                        {!p.builtin && (
                          <button
                            type="button"
                            onClick={() => handleDelete(p.id)}
                            title={t('deleteProviderTitle')}
                            className="p-1 rounded-md text-[var(--ink-muted)] hover:text-[var(--danger)] cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    {test && (
                      <div
                        className={`text-[11px] px-2 py-1 rounded-md ${
                          test.ok ? 'bg-[var(--ok-soft)] text-[var(--ok)]' : 'bg-[var(--danger-soft)] text-[var(--danger)]'
                        }`}
                      >
                        {test.text}
                      </div>
                    )}

                    {/* Individual Bridge Accounts (acc1, acc2, acc3...) — CDP Login, Headless Sync, Rename & Assign */}
                    {isDefaultBridge && laneDetails.length > 0 && (
                      <div className="pt-2 mt-2 border-t border-[var(--border)] space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <div className="text-[11px] font-medium text-[var(--ink-secondary)]">
                            {t('perAccountBridge', {
                              mode: health?.cookieSyncBrowser ? `CDP: ${health.cookieSyncBrowser}` : 'Profile Vault',
                            })}
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={vaultBusyKey !== null}
                              onClick={handleSyncAllLanes}
                              title={t('syncAllTitle')}
                              className="px-2 py-0.5 rounded border border-[var(--border)] bg-[var(--surface)] text-[10.5px] text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:border-[var(--accent)] inline-flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                            >
                              <RefreshCw className={`w-2.5 h-2.5 ${vaultBusyKey === 'sync-all' ? 'animate-spin' : ''}`} />
                              {vaultBusyKey === 'sync-all' ? t('syncingText') : t('syncAllBtn')}
                            </button>
                            <button
                              type="button"
                              disabled={vaultBusyKey !== null}
                              onClick={handleCreateLane}
                              title={t('createLaneTitle')}
                              className="px-2 py-0.5 rounded bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-ink)] text-[10.5px] font-semibold inline-flex items-center gap-0.5 disabled:opacity-50 cursor-pointer"
                            >
                              <Plus className="w-2.5 h-2.5" />
                              {vaultBusyKey === 'create-lane' ? t('creatingText') : t('addLaneBtn')}
                            </button>
                          </div>
                        </div>
                        {laneDetails.map((lane) => {
                          const isRenaming = renamingLaneId === lane.id;
                          const isAssigning = assignLaneId === lane.id;
                          const laneTestKey = `${p.id}::${lane.id}`;
                          const laneTest = testResults[laneTestKey];
                          const isReady = lane.reachable && lane.control === 'on' && lane.authOk;
                          const hasDup = (lane.duplicatedWith || []).length > 0;
                          const isLaneBusy =
                            vaultBusyKey === `login::${lane.id}` ||
                            vaultBusyKey === `finish::${lane.id}` ||
                            vaultBusyKey === `sync::${lane.id}` ||
                            vaultBusyKey === 'sync-all';

                          return (
                            <div
                              key={lane.id}
                              className="p-2.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span
                                      className="w-2 h-2 rounded-full shrink-0"
                                      style={{
                                        backgroundColor: lane.loginOpen
                                          ? 'var(--warn)'
                                          : isReady
                                          ? 'var(--ok)'
                                          : lane.control === 'on'
                                          ? 'var(--warn)'
                                          : 'var(--ink-muted)',
                                      }}
                                    />
                                    <span className="font-mono-num text-[11px] px-1.5 py-0.5 rounded bg-[var(--bg-subtle)] text-[var(--accent)] font-semibold shrink-0">
                                      {lane.id}
                                    </span>
                                    <span className="font-medium text-[12px] text-[var(--ink)] truncate">
                                      {lane.name}
                                    </span>
                                  </div>
                                  <div className="text-[10.5px] text-[var(--ink-muted)] mt-0.5 font-mono-num">
                                    {lane.loginOpen
                                      ? t('laneBrowserOpen')
                                      : isReady
                                      ? t('laneCookieOk')
                                      : lane.control !== 'on'
                                      ? t('laneOff')
                                      : t('laneGuest')}
                                    {lane.accountKey ? ` · #${lane.accountKey.slice(0, 6)}` : ''}
                                    {lane.url ? ` · ${lane.url.replace(/^https?:\/\//, '')}` : ''}
                                  </div>
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    title={t('renameLaneTitle')}
                                    onClick={() => {
                                      if (isRenaming) {
                                        setRenamingLaneId(null);
                                      } else {
                                        setRenamingLaneId(lane.id);
                                        setRenameDraft(lane.name === lane.bridgeLabel ? '' : lane.name);
                                      }
                                    }}
                                    className="px-2 py-1 rounded-md border border-[var(--border)] bg-[var(--bg)] text-[11px] text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:border-[var(--accent)] inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <Edit3 className="w-3 h-3" />
                                    {t('renameLaneBtn')}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={testingId === laneTestKey}
                                    onClick={() => handleTest(p.id, lane.id)}
                                    title={lane.id}
                                    className="px-2 py-1 rounded-md border border-[var(--border)] bg-[var(--bg)] text-[11px] text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:border-[var(--accent)] disabled:opacity-50 cursor-pointer"
                                  >
                                    {testingId === laneTestKey ? '...' : t('testBtn')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openAssignForm(lane)}
                                    className={`px-2 py-1 rounded-md text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer ${
                                      isAssigning
                                        ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                                        : 'bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-ink)]'
                                    }`}
                                  >
                                    <UserPlus className="w-3 h-3" />
                                    {t('assignRoleBtn')}
                                  </button>
                                </div>
                              </div>

                              {/* Profile Vault Login / Sync controls */}
                              <div className="flex flex-wrap items-center gap-1.5">
                                {lane.loginOpen ? (
                                  <button
                                    type="button"
                                    disabled={isLaneBusy}
                                    onClick={() => handleFinishLaneLogin(lane)}
                                    className="px-2.5 py-1 rounded-md bg-[var(--ok)] text-white text-[11px] font-semibold inline-flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                                  >
                                    <Check className="w-3 h-3" />
                                    {vaultBusyKey === `finish::${lane.id}` ? t('gettingCookieText') : t('finishLoginBtn')}
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      disabled={vaultBusyKey !== null}
                                      onClick={() => handleLaneLogin(lane)}
                                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium inline-flex items-center gap-1 disabled:opacity-50 cursor-pointer ${
                                        !isReady || hasDup
                                          ? 'bg-[var(--accent)] text-[var(--accent-ink)] hover:bg-[var(--accent-hover)]'
                                          : 'border border-[var(--border)] bg-[var(--bg)] text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:border-[var(--accent)]'
                                      }`}
                                    >
                                      <LogIn className="w-3 h-3" />
                                      {vaultBusyKey === `login::${lane.id}`
                                        ? t('openingText')
                                        : isReady && !hasDup
                                        ? t('switchAccBtn')
                                        : hasDup
                                        ? t('switchSeparateAccBtn')
                                        : t('loginOnceBtn')}
                                    </button>
                                    {(lane.hasProfileData || isReady) && (
                                      <button
                                        type="button"
                                        disabled={vaultBusyKey !== null || !lane.hasProfileData}
                                        onClick={() => handleSyncLane(lane)}
                                        className="px-2.5 py-1 rounded-md border border-[var(--border)] bg-[var(--bg)] text-[11px] text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:border-[var(--accent)] inline-flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                                      >
                                        <Zap className="w-3 h-3 text-[var(--accent)]" />
                                        {vaultBusyKey === `sync::${lane.id}` ? t('syncingText') : t('syncBgBtn')}
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>

                              {hasDup && (
                                <div className="text-[11px] px-2 py-1.5 rounded-md bg-[var(--warn-soft)] text-[var(--warn)] flex items-start gap-1.5 border border-[var(--warn)]/30">
                                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                  <span>
                                    {t('dupWarning', { others: (lane.duplicatedWith || []).join(', ') })}
                                  </span>
                                </div>
                              )}

                              {!isReady && lane.lastSyncError && (
                                <div className="text-[10.5px] px-2 py-1 rounded bg-[var(--danger-soft)] text-[var(--danger)]">
                                  {lane.lastSyncError}
                                </div>
                              )}

                              {/* Inline rename input */}
                              {isRenaming && (
                                <div className="flex items-center gap-1.5 pt-1">
                                  <input
                                    type="text"
                                    value={renameDraft}
                                    onChange={(e) => setRenameDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleSaveLaneName(lane.id);
                                      } else if (e.key === 'Escape') {
                                        setRenamingLaneId(null);
                                      }
                                    }}
                                    placeholder={lane.bridgeLabel}
                                    autoFocus
                                    className="flex-1 px-2 py-1 rounded-md bg-[var(--bg)] border border-[var(--accent)] text-[11.5px] text-[var(--ink)] focus:outline-none"
                                  />
                                  <button
                                    type="button"
                                    disabled={renameBusy}
                                    onClick={() => handleSaveLaneName(lane.id)}
                                    className="px-2.5 py-1 rounded-md bg-[var(--accent)] text-[var(--accent-ink)] text-[11px] font-semibold disabled:opacity-50 cursor-pointer"
                                  >
                                    {t('save')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setRenamingLaneId(null)}
                                    className="px-1.5 py-1 rounded-md text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink)] cursor-pointer"
                                  >
                                    {t('cancel')}
                                  </button>
                                </div>
                              )}

                              {/* Inline role-assignment form pinned to this exact acc */}
                              {isAssigning && (
                                <form
                                  onSubmit={(e) => handleAssignLaneSubmit(e, lane)}
                                  className="p-2.5 rounded-lg bg-[var(--bg)] border border-[var(--accent)]/50 space-y-2"
                                >
                                  <div className="text-[11px] font-semibold text-[var(--accent)]">
                                    {t('pinAssignTitle', {
                                      id: lane.id,
                                      name: lane.name,
                                      room: activeRoomTitle ? `"${activeRoomTitle.slice(0, 32)}"` : '',
                                    })}
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {QUICK_ROLE_TEMPLATES.map((tpl) => {
                                      const tplKey =
                                        tpl.handle === 'Nghiên_cứu'
                                          ? 'tplAcademic'
                                          : tpl.handle === 'Phản_biện'
                                          ? 'tplCritic'
                                          : tpl.handle === 'Kỹ_thuật'
                                          ? 'tplTech'
                                          : 'tplCost';
                                      return (
                                        <button
                                          key={tpl.handle}
                                          type="button"
                                          onClick={() => {
                                            setAssignHandle(tpl.handle);
                                            setAssignRole(tpl.role);
                                            setAssignTag(tpl.tag);
                                            setAssignPrompt(tpl.prompt);
                                          }}
                                          className="px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)] text-[10.5px] text-[var(--ink-secondary)] hover:border-[var(--accent)] hover:text-[var(--ink)] cursor-pointer"
                                        >
                                          + {t(tplKey)}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  <div className="grid grid-cols-2 gap-1.5">
                                    <input
                                      type="text"
                                      required
                                      value={assignHandle}
                                      onChange={(e) => setAssignHandle(e.target.value)}
                                      placeholder={t('handlePlaceholder')}
                                      className="px-2 py-1 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[11.5px] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
                                    />
                                    <input
                                      type="text"
                                      value={assignRole}
                                      onChange={(e) => setAssignRole(e.target.value)}
                                      placeholder={t('roleNamePlaceholder')}
                                      className="px-2 py-1 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[11.5px] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
                                    />
                                  </div>
                                  <select
                                    value={assignModel}
                                    onChange={(e) => setAssignModel(e.target.value)}
                                    className="w-full px-2 py-1 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[11.5px] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
                                  >
                                    {fallbackBridgeModels.map((m) => (
                                      <option key={m.id} value={m.id}>
                                        Model: {localizeModelLabel(m, lang)}
                                      </option>
                                    ))}
                                  </select>
                                  <textarea
                                    rows={2}
                                    value={assignPrompt}
                                    onChange={(e) => setAssignPrompt(e.target.value)}
                                    placeholder={t('rolePromptPlaceholder')}
                                    className="w-full px-2 py-1 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[11px] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)] resize-none"
                                  />
                                  <div className="flex justify-end gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setAssignLaneId(null)}
                                      className="px-2 py-1 rounded text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink)] cursor-pointer"
                                    >
                                      {t('cancel')}
                                    </button>
                                    <button
                                      type="submit"
                                      className="px-2.5 py-1 rounded-md bg-[var(--accent)] text-[var(--accent-ink)] text-[11px] font-semibold cursor-pointer"
                                    >
                                      {t('pinAssignBtn', { id: lane.id })}
                                    </button>
                                  </div>
                                </form>
                              )}

                              {laneTest && (
                                <div
                                  className={`text-[10.5px] px-2 py-1 rounded ${
                                    laneTest.ok
                                      ? 'bg-[var(--ok-soft)] text-[var(--ok)]'
                                      : 'bg-[var(--danger-soft)] text-[var(--danger)]'
                                  }`}
                                >
                                  {laneTest.text}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* 2. Judge Model Selector */}
          <section className="space-y-2">
            <label
              htmlFor="judge-model-select"
              className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]"
            >
              <Scale className="w-4 h-4 text-[var(--accent)]" />
              {t('judgeModelLabel')}
            </label>
            <select
              id="judge-model-select"
              value={selectedJudgeKey}
              onChange={(e) => {
                const [pid, mid] = e.target.value.split('::');
                onUpdateSettings({ judgeProviderId: pid, judgeModel: mid });
              }}
              className="w-full px-3 py-2 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--ink)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
            >
              {models.map((m) => (
                <option key={`${m.providerId}::${m.id}`} value={`${m.providerId}::${m.id}`}>
                  [{m.providerName}] {localizeModelLabel(m, lang)}
                </option>
              ))}
            </select>

            {(settings.judgeProviderId || 'bridge-local') === 'bridge-local' && laneDetails.length > 0 && (
              <div className="pt-1 space-y-1">
                <label
                  htmlFor="judge-lane-select"
                  className="block text-[11px] font-medium text-[var(--ink-secondary)]"
                >
                  {t('judgeLaneLabel')}
                </label>
                <select
                  id="judge-lane-select"
                  value={settings.judgeLaneId || ''}
                  onChange={(e) => onUpdateSettings({ judgeLaneId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--ink)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
                >
                  <option value="">{t('judgeLaneAuto')}</option>
                  {laneDetails.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.id} — {l.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <p className="text-[11px] text-[var(--ink-muted)]">
              {t('judgeModelHint')}
            </p>
          </section>

          {/* 3. Max concurrency */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="concurrency-range"
                className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]"
              >
                <Sliders className="w-4 h-4 text-[var(--accent)]" />
                {t('concurrencyLabel')}
              </label>
              <span className="font-mono-num text-sm font-semibold text-[var(--accent)]">
                {t('concurrencyThreads', { count: settings.maxConcurrency })}
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
              <span>{t('concurrencySeq')}</span>
              <span>2</span>
              <span>3</span>
              <span>4</span>
              <span>6</span>
            </div>
            {overSubscribed && (
              <div className="p-2.5 rounded-lg bg-[var(--warn-soft)] text-[var(--warn)] text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {t('overSubscribedWarn', {
                    max: settings.maxConcurrency,
                    healthy: healthyWorkers,
                    total: totalWorkers,
                  })}
                </span>
              </div>
            )}
          </section>

          {/* 4. Research & Judge behavior toggles */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]">
              <ShieldCheck className="w-4 h-4 text-[var(--accent)]" />
              {t('behaviorSectionTitle')}
            </div>

            <label className="flex items-start justify-between gap-3 p-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] cursor-pointer">
              <div>
                <div className="text-[13px] font-medium text-[var(--ink)]">
                  {t('approveResearchTitle')}
                </div>
                <div className="text-[11.5px] text-[var(--ink-muted)] mt-0.5">
                  {t('approveResearchDesc')}
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
                  {t('anonymizeJudgeTitle')}
                </div>
                <div className="text-[11.5px] text-[var(--ink-muted)] mt-0.5">
                  {t('anonymizeJudgeDesc')}
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.anonymizeJudge}
                onChange={(e) => onUpdateSettings({ anonymizeJudge: e.target.checked })}
                className="mt-1 w-4 h-4 accent-[var(--accent)] cursor-pointer"
              />
            </label>

            <label className="flex items-start justify-between gap-3 p-3 rounded-xl bg-[var(--bg)] border border-[var(--border)]">
              <div>
                <div className="text-[13px] font-medium text-[var(--ink)]">{t('judgeRunsTitle')}</div>
                <div className="text-[11.5px] text-[var(--ink-muted)] mt-0.5">
                  {t('judgeRunsDesc')}
                </div>
              </div>
              <select
                value={settings.judgeRuns ?? 2}
                onChange={(e) => onUpdateSettings({ judgeRuns: Number(e.target.value) })}
                className="mt-0.5 px-2 py-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[13px] text-[var(--ink)] cursor-pointer"
              >
                <option value={1}>{t('nRunsOption', { n: 1 })}</option>
                <option value={2}>{t('nRunsOption', { n: 2 })}</option>
                <option value={3}>{t('nRunsOption', { n: 3 })}</option>
              </select>
            </label>

            <label className="flex items-start justify-between gap-3 p-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] cursor-pointer">
              <div>
                <div className="text-[13px] font-medium text-[var(--ink)]">{t('claimCheckTitle')}</div>
                <div className="text-[11.5px] text-[var(--ink-muted)] mt-0.5">
                  {t('claimCheckDesc')}
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.claimCheck ?? true}
                onChange={(e) => onUpdateSettings({ claimCheck: e.target.checked })}
                className="mt-1 w-4 h-4 accent-[var(--accent)] cursor-pointer"
              />
            </label>
          </section>
        </div>
      </div>
    </div>
  );
}
