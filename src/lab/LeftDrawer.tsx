import React, { useEffect, useMemo, useState } from 'react';
import {
  BookmarkPlus,
  Check,
  Edit3,
  MessageSquare,
  Plus,
  Settings,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { LaneInfo, ModelOption, Perspective, PerspectivePreset, Room } from '../types.ts';
import { getPerspectiveColorVar } from '../utils/themeAndExport.ts';
import {
  localizeHandle,
  localizeModelLabel,
  localizePreset,
  localizeRoleName,
  localizeRoomTitle,
  useI18n,
} from '../utils/i18n.tsx';

interface LeftDrawerProps {
  open: boolean;
  onClose: () => void;
  rooms: Room[];
  activeRoom: Room;
  presets: PerspectivePreset[];
  models: ModelOption[];
  laneDetails?: LaneInfo[];
  onSelectRoom: (roomId: string) => void;
  onCreateRoomFromPreset: (preset: PerspectivePreset, customTitle?: string) => void;
  onRenameRoom: (roomId: string, newTitle: string) => void;
  onDeleteRoom: (roomId: string) => void;
  onTogglePerspective: (perspectiveId: string) => void;
  onToggleTagGroup: (tag: string) => void;
  onAddPerspective: (p: Omit<Perspective, 'id'>) => void;
  onUpdatePerspective: (perspectiveId: string, patch: Partial<Perspective>) => void;
  onRemovePerspective: (perspectiveId: string) => void;
  onSavePreset: (name: string) => void;
  onOpenSettings: () => void;
  defaultTab?: 'rooms' | 'roster';
}

const ROLE_TEMPLATES = [
  {
    label: 'Nghiên cứu học thuật',
    handle: 'Nghiên_cứu',
    name: 'Nghiên cứu & Tổng hợp nguồn',
    tag: 'Nghiên_cứu',
    prompt:
      'Bạn phụ trách nghiên cứu chuyên sâu, đọc kỹ tài liệu nguồn [S#], đối chiếu bằng chứng thực nghiệm và đưa ra phân tích có cấu trúc rõ ràng. Mở đầu bằng "Kết luận: ...".',
  },
  {
    label: 'Kiến trúc & Code',
    handle: 'Kỹ_thuật',
    name: 'Kiến trúc Kỹ thuật & Hiệu năng',
    tag: 'Kỹ_thuật',
    prompt:
      'Bạn là kỹ sư hệ thống. Tập trung vào thiết kế kiến trúc, hiệu năng, độ trễ và tính dễ bảo trì lâu dài. Mở đầu bằng "Kết luận: ...".',
  },
  {
    label: 'Phản biện rủi ro',
    handle: 'Phản_biện',
    name: 'Phản biện & Soi điểm mù',
    tag: 'Phản_biện',
    prompt:
      'Bạn là người phản biện độc lập. Tìm giả định yếu, lỗi âm thầm, rủi ro vận hành và chi phí ẩn của phương án. Mở đầu bằng "Kết luận: ...".',
  },
  {
    label: 'Kinh tế / Chi phí',
    handle: 'Chi_phí',
    name: 'Đánh giá Chi phí & Thực tế triển khai',
    tag: 'Kinh_tế',
    prompt:
      'Bạn phân tích chi phí triển khai, nhân sự, thời gian hoàn thành và tính khả thi thực tế. Mở đầu bằng "Kết luận: ...".',
  },
];

export function LeftDrawer({
  open,
  onClose,
  rooms,
  activeRoom,
  presets,
  models,
  laneDetails = [],
  onSelectRoom,
  onCreateRoomFromPreset,
  onRenameRoom,
  onDeleteRoom,
  onTogglePerspective,
  onToggleTagGroup,
  onAddPerspective,
  onUpdatePerspective,
  onRemovePerspective,
  onSavePreset,
  onOpenSettings,
  defaultTab = 'rooms',
}: LeftDrawerProps) {
  const { lang, t } = useI18n();
  const [tab, setTab] = useState<'rooms' | 'roster'>(defaultTab);
  useEffect(() => {
    setTab(defaultTab);
  }, [defaultTab]);
  const [renamingRoomId, setRenamingRoomId] = useState<string | null>(null);
  const [roomTitleDraft, setRoomTitleDraft] = useState('');

  const [showAddRole, setShowAddRole] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editHandle, setEditHandle] = useState('');
  const [editName, setEditName] = useState('');
  const [editPrompt, setEditPrompt] = useState('');

  const [newHandle, setNewHandle] = useState('');
  const [newName, setNewName] = useState('');
  const [newTag, setNewTag] = useState('Nghiên_cứu');
  const [newRolePrompt, setNewRolePrompt] = useState('');
  const [newModelKey, setNewModelKey] = useState('');
  const [newPinnedLaneId, setNewPinnedLaneId] = useState('');
  const [presetSavedNotice, setPresetSavedNotice] = useState(false);

  const enabledCount = activeRoom.perspectives.filter((p) => p.enabled).length;

  const effectiveModelOptions = useMemo<ModelOption[]>(() => {
    if (models.length > 0) return models;
    return [
      { id: 'gemini-4-hydrogen', label: t('model4HydrogenDesc'), providerId: 'bridge-local', providerName: 'Bridge' },
      { id: 'gemini-neon', label: t('model4NeonDesc'), providerId: 'bridge-local', providerName: 'Bridge' },
      { id: 'gemini-carbon', label: t('model4CarbonDesc'), providerId: 'bridge-local', providerName: 'Bridge' },
    ];
  }, [models, t]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    activeRoom.perspectives.forEach((p) => p.tags.forEach((t) => set.add(t)));
    return Array.from(set);
  }, [activeRoom.perspectives]);

  const handleAddRoleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanHandle = newHandle.trim().replace(/^@/, '').replace(/\s+/g, '_');
    if (!cleanHandle) return;
    const picked = newModelKey || `${effectiveModelOptions[0].providerId}::${effectiveModelOptions[0].id}`;
    const [providerId, modelLabel] = picked.split('::');
    const finalProv = providerId || 'bridge-local';
    onAddPerspective({
      handle: cleanHandle,
      name: newName.trim() || cleanHandle.replace(/_/g, ' '),
      rolePrompt:
        newRolePrompt.trim() ||
        `Phân tích vấn đề từ góc nhìn chuyên sâu của ${cleanHandle.replace(/_/g, ' ')}. Mở đầu bằng "Kết luận: ...".`,
      tags: [newTag.trim().replace(/^#/, '') || 'Tùy_chỉnh'],
      modelLabel: modelLabel || 'gemini-4-hydrogen',
      providerId: finalProv,
      pinnedLaneId: finalProv === 'bridge-local' && newPinnedLaneId ? newPinnedLaneId : undefined,
      colorIndex: activeRoom.perspectives.length % 10,
      enabled: true,
    });
    setNewHandle('');
    setNewName('');
    setNewRolePrompt('');
    setNewPinnedLaneId('');
    setShowAddRole(false);
  };

  if (!open) return null;

  return (
    <aside
      aria-label={t('leftAriaLabel')}
      className="w-[300px] shrink-0 h-full flex flex-col border-r border-[var(--border)] bg-[var(--bg-subtle)] transition-all duration-200 z-20"
    >
      {/* Segmented tabs */}
      <div className="px-3 pt-3 pb-2 flex items-center justify-between gap-2">
        <div className="flex flex-1 items-center p-0.5 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setTab('rooms')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              tab === 'rooms'
                ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                : 'text-[var(--ink-secondary)] hover:text-[var(--ink)]'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            {t('tabRooms')}
          </button>
          <button
            type="button"
            onClick={() => setTab('roster')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              tab === 'roster'
                ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                : 'text-[var(--ink-secondary)] hover:text-[var(--ink)]'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            {t('tabRoster', { enabled: enabledCount, total: activeRoom.perspectives.length })}
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          title={t('hideLeftTitle')}
          className="p-1.5 rounded-md text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tab 1: Rooms */}
      {tab === 'rooms' ? (
        <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-5">
          <div>
            <div className="px-1 mb-2 text-[12px] font-medium text-[var(--ink-muted)]">
              {t('createNewRoom')}
            </div>
            <div className="space-y-1.5">
              {presets.map((preset) => {
                const locPreset = localizePreset(preset, lang);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onCreateRoomFromPreset(preset)}
                    className="w-full text-left px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)] transition-colors group cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium text-[var(--ink)] truncate">
                        {locPreset.name}
                      </span>
                      <Plus className="w-3.5 h-3.5 text-[var(--ink-muted)] group-hover:text-[var(--accent)] shrink-0" />
                    </div>
                    <p className="text-[11.5px] text-[var(--ink-muted)] mt-0.5 line-clamp-1">
                      {locPreset.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="px-1 mb-2 flex items-center justify-between">
              <span className="text-[12px] font-medium text-[var(--ink-muted)]">
                {t('recentRoomsCount', { count: rooms.length })}
              </span>
            </div>
            <div className="space-y-1.5">
              {rooms.map((room) => {
                const isActive = room.id === activeRoom.id;
                const activeAi = room.perspectives.filter((p) => p.enabled).length;
                const isRenamingThis = renamingRoomId === room.id;
                return (
                  <div
                    key={room.id}
                    className={`group relative rounded-lg border transition-colors ${
                      isActive
                        ? 'bg-[var(--surface)] border-[var(--accent)] shadow-[var(--shadow-card)]'
                        : 'bg-transparent border-transparent hover:bg-[var(--surface)] hover:border-[var(--border)]'
                    }`}
                  >
                    {isRenamingThis ? (
                      <div className="p-2 space-y-1.5">
                        <input
                          type="text"
                          value={roomTitleDraft}
                          onChange={(e) => setRoomTitleDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && roomTitleDraft.trim()) {
                              onRenameRoom(room.id, roomTitleDraft.trim());
                              setRenamingRoomId(null);
                            } else if (e.key === 'Escape') {
                              setRenamingRoomId(null);
                            }
                          }}
                          autoFocus
                          className="w-full px-2 py-1 text-xs rounded-md bg-[var(--bg)] border border-[var(--accent)] text-[var(--ink)] focus:outline-none"
                        />
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setRenamingRoomId(null)}
                            className="px-2 py-0.5 text-[11px] rounded text-[var(--ink-muted)] hover:text-[var(--ink)] cursor-pointer"
                          >
                            {t('cancel')}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (roomTitleDraft.trim()) {
                                onRenameRoom(room.id, roomTitleDraft.trim());
                              }
                              setRenamingRoomId(null);
                            }}
                            className="px-2 py-0.5 text-[11px] font-semibold rounded bg-[var(--accent)] text-[var(--accent-ink)] cursor-pointer"
                          >
                            {t('save')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onSelectRoom(room.id)}
                          className="w-full text-left px-3 py-2.5 pr-14 cursor-pointer"
                        >
                          <div className="text-[13.5px] font-medium text-[var(--ink)] leading-snug line-clamp-2">
                            {localizeRoomTitle(room.title, lang)}
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-[var(--ink-muted)] font-mono-num">
                            <span>
                              {t('aiCountSuffix', { total: room.perspectives.length })}
                              {activeAi !== room.perspectives.length
                                ? t('enabledParen', { count: activeAi })
                                : ''}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{t('sourcesCountShort', { count: room.sources.length })}</span>
                          </div>
                        </button>
                        <div className="absolute right-1.5 top-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenamingRoomId(room.id);
                              setRoomTitleDraft(room.title);
                            }}
                            title={t('renameRoomTitle')}
                            className="p-1 rounded text-[var(--ink-muted)] hover:text-[var(--accent)] cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          {rooms.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteRoom(room.id);
                              }}
                              title={t('deleteRoomTitle')}
                              className="p-1 rounded text-[var(--ink-muted)] hover:text-[var(--danger)] cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        /* Tab 2: AI Roster with clear Role descriptions & Model selectors */
        <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-3.5">
          {allTags.length > 1 && (
            <div className="flex flex-wrap gap-1.5 px-1">
              {allTags.map((tag) => {
                const members = activeRoom.perspectives.filter((p) => p.tags.includes(tag));
                const allOn = members.length > 0 && members.every((m) => m.enabled);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => onToggleTagGroup(tag)}
                    className={`px-2 py-0.5 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                      allOn
                        ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)]'
                        : 'bg-[var(--surface)] border-[var(--border)] text-[var(--ink-secondary)] hover:text-[var(--ink)]'
                    }`}
                  >
                    #{tag}
                  </button>
                );
              })}
            </div>
          )}

          <div className="space-y-2">
            <div className="px-1 flex items-center justify-between">
              <span className="text-[11.5px] font-medium text-[var(--ink-muted)]">
                {t('roleAndModelHeading')}
              </span>
              <span className="text-[11px] font-mono-num text-[var(--ink-muted)]">
                {t('enabledSlashTotal', { enabled: enabledCount, total: activeRoom.perspectives.length })}
              </span>
            </div>

            {activeRoom.perspectives.map((p) => {
              const color = getPerspectiveColorVar(p.colorIndex);
              const currentProv = p.providerId || 'bridge-local';
              const currentKey = `${currentProv}::${p.modelLabel}`;
              const hasOption = effectiveModelOptions.some(
                (m) => `${m.providerId}::${m.id}` === currentKey
              );
              const isEditing = editingId === p.id;

              return (
                <div
                  key={p.id}
                  className={`p-2.5 rounded-xl border transition-all space-y-2 ${
                    p.enabled
                      ? 'bg-[var(--surface)] border-[var(--border)]'
                      : 'bg-[var(--surface)]/45 border-transparent opacity-65'
                  }`}
                >
                  {/* Top row: enable checkbox + handle + edit/delete */}
                  <div className="flex items-start justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={() => onTogglePerspective(p.id)}
                      className="flex items-center gap-2 min-w-0 text-left cursor-pointer"
                    >
                      <span
                        className="w-4 h-4 rounded flex items-center justify-center border shrink-0 transition-colors"
                        style={{
                          borderColor: p.enabled ? color : 'var(--border-strong)',
                          backgroundColor: p.enabled ? color : 'transparent',
                          color: p.enabled ? 'var(--accent-ink)' : 'transparent',
                        }}
                      >
                        <Check className="w-3 h-3 stroke-[2.7]" />
                      </span>
                      <span
                        className="text-[13px] font-semibold truncate"
                        style={{ color: p.enabled ? color : 'var(--ink-secondary)' }}
                      >
                        @{localizeHandle(p.handle, lang)}
                      </span>
                    </button>

                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        title={t('editRoleTitle')}
                        onClick={() => {
                          if (isEditing) {
                            setEditingId(null);
                          } else {
                            setEditingId(p.id);
                            setEditHandle(p.handle);
                            setEditName(p.name);
                            setEditPrompt(p.rolePrompt);
                          }
                        }}
                        className="p-1 rounded text-[var(--ink-muted)] hover:text-[var(--accent)] cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      {activeRoom.perspectives.length > 1 && (
                        <button
                          type="button"
                          title={t('deleteRoleTitle')}
                          onClick={() => onRemovePerspective(p.id)}
                          className="p-1 rounded text-[var(--ink-muted)] hover:text-[var(--danger)] cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Role summary or inline edit */}
                  {isEditing ? (
                    <div className="space-y-1.5 pt-0.5">
                      <input
                        type="text"
                        value={editHandle}
                        onChange={(e) => setEditHandle(e.target.value)}
                        placeholder={t('handlePlaceholder')}
                        className="w-full px-2 py-1 text-xs rounded-md bg-[var(--bg)] border border-[var(--border)] text-[var(--ink)] font-semibold focus:outline-none focus:border-[var(--accent)]"
                      />
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder={t('roleNamePlaceholder')}
                        className="w-full px-2 py-1 text-xs rounded-md bg-[var(--bg)] border border-[var(--border)] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
                      />
                      <textarea
                        rows={3}
                        value={editPrompt}
                        onChange={(e) => setEditPrompt(e.target.value)}
                        placeholder={t('rolePromptPlaceholder')}
                        className="w-full px-2 py-1 text-[11.5px] rounded-md bg-[var(--bg)] border border-[var(--border)] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)] resize-none"
                      />
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-2 py-0.5 text-[11px] rounded text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] cursor-pointer"
                        >
                          {t('cancel')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const cleanH = editHandle.trim().replace(/^@/, '').replace(/\s+/g, '_');
                            onUpdatePerspective(p.id, {
                              handle: cleanH || p.handle,
                              name: editName.trim() || p.name,
                              rolePrompt: editPrompt.trim() || p.rolePrompt,
                            });
                            setEditingId(null);
                          }}
                          className="px-2.5 py-0.5 text-[11px] font-semibold rounded bg-[var(--accent)] text-[var(--accent-ink)] cursor-pointer"
                        >
                          {t('saveChanges')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      <div className="text-[12px] font-medium text-[var(--ink)] leading-snug">
                        {t('roleLabelPrefix')}{localizeRoleName(p.name, lang)}
                      </div>
                      <p className="text-[11px] text-[var(--ink-muted)] line-clamp-2 leading-relaxed">
                        {p.rolePrompt}
                      </p>
                    </div>
                  )}

                  {/* Model + Bridge Account (acc1/acc2/acc3) selectors right on each AI card */}
                  <div className="pt-0.5 space-y-1.5">
                    <select
                      aria-label={`Model @${p.handle}`}
                      value={currentKey}
                      onChange={(e) => {
                        const [pid, mid] = e.target.value.split('::');
                        onUpdatePerspective(p.id, {
                          providerId: pid,
                          modelLabel: mid,
                          pinnedLaneId: pid === 'bridge-local' ? p.pinnedLaneId : undefined,
                        });
                      }}
                      className="w-full px-2 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[11.5px] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
                    >
                      {!hasOption && (
                        <option value={currentKey}>
                          {t('currentModelPrefix')}{p.modelLabel}
                        </option>
                      )}
                      {effectiveModelOptions.map((m) => (
                        <option key={`${m.providerId}::${m.id}`} value={`${m.providerId}::${m.id}`}>
                          [{m.providerName}] {localizeModelLabel(m, lang)}
                        </option>
                      ))}
                    </select>

                    {currentProv === 'bridge-local' && laneDetails.length > 0 && (
                      <select
                        aria-label={`Account @${p.handle}`}
                        value={p.pinnedLaneId || ''}
                        onChange={(e) =>
                          onUpdatePerspective(p.id, {
                            pinnedLaneId: e.target.value || undefined,
                          })
                        }
                        className="w-full px-2 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[11.5px] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
                      >
                        <option value="">{t('accAutoBridge')}</option>
                        {laneDetails.map((l) => (
                          <option key={l.id} value={l.id}>
                            {t('accPrefix', { id: l.id, name: l.name })}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add new AI to room */}
          {showAddRole ? (
            <form
              onSubmit={handleAddRoleSubmit}
              className="p-3 rounded-xl border border-[var(--accent)]/60 bg-[var(--surface)] space-y-2.5"
            >
              <div className="text-xs font-semibold text-[var(--ink)]">{t('addAiHeading')}</div>

              {/* Quick role templates */}
              <div className="flex flex-wrap gap-1">
                {ROLE_TEMPLATES.map((tpl) => {
                  const labelKey =
                    tpl.handle === 'Nghiên_cứu'
                      ? 'tplAcademic'
                      : tpl.handle === 'Kỹ_thuật'
                      ? 'tplTech'
                      : tpl.handle === 'Phản_biện'
                      ? 'tplCritic'
                      : 'tplCost';
                  return (
                    <button
                      key={tpl.handle}
                      type="button"
                      onClick={() => {
                        setNewHandle(tpl.handle);
                        setNewName(tpl.name);
                        setNewTag(tpl.tag);
                        setNewRolePrompt(tpl.prompt);
                      }}
                      className="px-2 py-0.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[10.5px] text-[var(--ink-secondary)] hover:border-[var(--accent)] hover:text-[var(--ink)] cursor-pointer"
                    >
                      + {t(labelKey)}
                    </button>
                  );
                })}
              </div>

              <input
                type="text"
                value={newHandle}
                onChange={(e) => setNewHandle(e.target.value)}
                placeholder={t('quickHandlePlaceholder')}
                className="w-full px-2.5 py-1.5 text-xs rounded-md bg-[var(--bg)] border border-[var(--border)] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
                required
              />
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('quickNamePlaceholder')}
                className="w-full px-2.5 py-1.5 text-xs rounded-md bg-[var(--bg)] border border-[var(--border)] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
              />
              <select
                value={newModelKey || `${effectiveModelOptions[0].providerId}::${effectiveModelOptions[0].id}`}
                onChange={(e) => setNewModelKey(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded-md bg-[var(--bg)] border border-[var(--border)] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
              >
                {effectiveModelOptions.map((m) => (
                  <option key={`${m.providerId}::${m.id}`} value={`${m.providerId}::${m.id}`}>
                    [{m.providerName}] {localizeModelLabel(m, lang)}
                  </option>
                ))}
              </select>
              {((newModelKey || `${effectiveModelOptions[0].providerId}::`).startsWith('bridge-local::') &&
                laneDetails.length > 0) && (
                <select
                  value={newPinnedLaneId}
                  onChange={(e) => setNewPinnedLaneId(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-md bg-[var(--bg)] border border-[var(--border)] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
                >
                  <option value="">{t('accAutoBridge')}</option>
                  {laneDetails.map((l) => (
                    <option key={l.id} value={l.id}>
                      {t('pinPrefix', { id: l.id, name: l.name })}
                    </option>
                  ))}
                </select>
              )}
              <textarea
                rows={2}
                value={newRolePrompt}
                onChange={(e) => setNewRolePrompt(e.target.value)}
                placeholder={t('rolePromptPlaceholder')}
                className="w-full px-2.5 py-1.5 text-xs rounded-md bg-[var(--bg)] border border-[var(--border)] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)] resize-none"
              />
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowAddRole(false)}
                  className="px-2.5 py-1 text-xs rounded-md text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 text-xs font-medium rounded-md bg-[var(--accent)] text-[var(--accent-ink)] hover:bg-[var(--accent-hover)] cursor-pointer"
                >
                  {t('addAiSubmit')}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-1.5 pt-1">
              <button
                type="button"
                onClick={() => setShowAddRole(true)}
                className="w-full py-2 px-3 rounded-lg border border-dashed border-[var(--border-strong)] text-xs font-medium text-[var(--ink-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('addAiHeading')}
              </button>
              <button
                type="button"
                onClick={onOpenSettings}
                className="w-full py-2 px-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs font-medium text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:border-[var(--accent)] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Settings className="w-3.5 h-3.5" />
                {t('addAiProviderBtn')}
              </button>
              <button
                type="button"
                onClick={() => {
                  onSavePreset(`${activeRoom.perspectives.length} AI · ${activeRoom.title.slice(0, 18)}`);
                  setPresetSavedNotice(true);
                  setTimeout(() => setPresetSavedNotice(false), 2000);
                }}
                className="w-full py-2 px-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs font-medium text-[var(--ink-secondary)] hover:text-[var(--ink)] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                {presetSavedNotice ? t('presetSaved') : t('savePresetBtn')}
              </button>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
