import React, { useMemo, useState } from 'react';
import {
  BookmarkPlus,
  Check,
  MessageSquare,
  Plus,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { Perspective, PerspectivePreset, Room } from '../types.ts';
import { getPerspectiveColorVar } from '../utils/themeAndExport.ts';

interface LeftDrawerProps {
  open: boolean;
  onClose: () => void;
  rooms: Room[];
  activeRoom: Room;
  presets: PerspectivePreset[];
  onSelectRoom: (roomId: string) => void;
  onCreateRoomFromPreset: (preset: PerspectivePreset, customTitle?: string) => void;
  onDeleteRoom: (roomId: string) => void;
  onTogglePerspective: (perspectiveId: string) => void;
  onToggleTagGroup: (tag: string) => void;
  onAddPerspective: (p: Omit<Perspective, 'id'>) => void;
  onSavePreset: (name: string) => void;
  defaultTab?: 'rooms' | 'roster';
}

export function LeftDrawer({
  open,
  onClose,
  rooms,
  activeRoom,
  presets,
  onSelectRoom,
  onCreateRoomFromPreset,
  onDeleteRoom,
  onTogglePerspective,
  onToggleTagGroup,
  onAddPerspective,
  onSavePreset,
  defaultTab = 'rooms',
}: LeftDrawerProps) {
  const [tab, setTab] = useState<'rooms' | 'roster'>(defaultTab);
  const [showAddRole, setShowAddRole] = useState(false);
  const [newHandle, setNewHandle] = useState('');
  const [newName, setNewName] = useState('');
  const [newTag, setNewTag] = useState('Kỹ_thuật');
  const [newRolePrompt, setNewRolePrompt] = useState('');
  const [presetSavedNotice, setPresetSavedNotice] = useState(false);

  const enabledCount = activeRoom.perspectives.filter((p) => p.enabled).length;

  const allTags = useMemo(() => {
    const set = new Set<string>();
    activeRoom.perspectives.forEach((p) => p.tags.forEach((t) => set.add(t)));
    return Array.from(set);
  }, [activeRoom.perspectives]);

  const handleAddRoleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanHandle = newHandle.trim().replace(/^@/, '').replace(/\s+/g, '_');
    if (!cleanHandle) return;
    onAddPerspective({
      handle: cleanHandle,
      name: newName.trim() || cleanHandle.replace(/_/g, ' '),
      rolePrompt:
        newRolePrompt.trim() ||
        `Phân tích vấn đề từ góc nhìn chuyên sâu của ${cleanHandle.replace(/_/g, ' ')}. Mở đầu bằng "Kết luận: ...".`,
      tags: [newTag.trim().replace(/^#/, '') || 'Tùy_chỉnh'],
      modelLabel: 'gemini-4-hydrogen',
      colorIndex: activeRoom.perspectives.length % 10,
      enabled: true,
    });
    setNewHandle('');
    setNewName('');
    setNewRolePrompt('');
    setShowAddRole(false);
  };

  if (!open) return null;

  return (
    <aside
      aria-label="Ngăn Phòng và Góc nhìn"
      className="w-[280px] shrink-0 h-full flex flex-col border-r border-[var(--border)] bg-[var(--bg-subtle)] transition-all duration-200 z-20"
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
            Phòng
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
            Góc nhìn ({enabledCount}/{activeRoom.perspectives.length})
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Ẩn ngăn trái ([)"
          className="p-1.5 rounded-md text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tab 1: Rooms & Quick Templates */}
      {tab === 'rooms' ? (
        <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-5">
          {/* Quick room creation presets */}
          <div>
            <div className="px-1 mb-2 text-[12px] font-medium text-[var(--ink-muted)]">
              Tạo phòng mới theo mẫu
            </div>
            <div className="space-y-1.5">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onCreateRoomFromPreset(preset)}
                  className="w-full text-left px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)] transition-colors group cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-[var(--ink)] truncate">
                      {preset.name}
                    </span>
                    <Plus className="w-3.5 h-3.5 text-[var(--ink-muted)] group-hover:text-[var(--accent)] shrink-0" />
                  </div>
                  <p className="text-[11.5px] text-[var(--ink-muted)] mt-0.5 line-clamp-1">
                    {preset.description}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Room list */}
          <div>
            <div className="px-1 mb-2 flex items-center justify-between">
              <span className="text-[12px] font-medium text-[var(--ink-muted)]">
                Phòng gần đây ({rooms.length})
              </span>
            </div>
            <div className="space-y-1.5">
              {rooms.map((room) => {
                const isActive = room.id === activeRoom.id;
                const activeAi = room.perspectives.filter((p) => p.enabled).length;
                return (
                  <div
                    key={room.id}
                    className={`group relative rounded-lg border transition-colors ${
                      isActive
                        ? 'bg-[var(--surface)] border-[var(--accent)] shadow-[var(--shadow-card)]'
                        : 'bg-transparent border-transparent hover:bg-[var(--surface)] hover:border-[var(--border)]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectRoom(room.id)}
                      className="w-full text-left px-3 py-2.5 pr-8 cursor-pointer"
                    >
                      <div className="text-[13.5px] font-medium text-[var(--ink)] leading-snug line-clamp-2">
                        {room.title}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-[var(--ink-muted)] font-mono-num">
                        <span>
                          {room.perspectives.length} AI
                          {activeAi !== room.perspectives.length ? ` (bật ${activeAi})` : ''}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{room.sources.length} nguồn</span>
                      </div>
                    </button>
                    {rooms.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteRoom(room.id);
                        }}
                        title="Xóa phòng"
                        className="absolute right-2 top-2.5 p-1 rounded opacity-0 group-hover:opacity-100 text-[var(--ink-muted)] hover:text-[var(--danger)] transition-opacity cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        /* Tab 2: Perspective Roster */
        <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-4">
          {allTags.length > 0 && (
            <div>
              <div className="px-1 mb-1.5 text-[12px] font-medium text-[var(--ink-muted)]">
                Bật/tắt nhanh theo nhóm
              </div>
              <div className="flex flex-wrap gap-1.5">
                {allTags.map((tag) => {
                  const members = activeRoom.perspectives.filter((p) => p.tags.includes(tag));
                  const allOn = members.length > 0 && members.every((m) => m.enabled);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => onToggleTagGroup(tag)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
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
            </div>
          )}

          <div>
            <div className="px-1 mb-1.5 flex items-center justify-between">
              <span className="text-[12px] font-medium text-[var(--ink-muted)]">
                Tích để bật cho lượt tới
              </span>
              <span className="text-[11px] font-mono-num text-[var(--ink-muted)]">
                {enabledCount}/{activeRoom.perspectives.length}
              </span>
            </div>
            <div className="space-y-1.5">
              {activeRoom.perspectives.map((p) => {
                const color = getPerspectiveColorVar(p.colorIndex);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onTogglePerspective(p.id)}
                    className={`w-full text-left px-2.5 py-2 rounded-lg border transition-all flex items-start gap-2.5 cursor-pointer ${
                      p.enabled
                        ? 'bg-[var(--surface)] border-[var(--border)] hover:border-[var(--border-strong)]'
                        : 'bg-transparent border-transparent opacity-55 hover:opacity-85 hover:bg-[var(--surface)]'
                    }`}
                  >
                    <span
                      className="mt-0.5 w-4 h-4 rounded flex items-center justify-center border shrink-0 transition-colors"
                      style={{
                        borderColor: p.enabled ? color : 'var(--border-strong)',
                        backgroundColor: p.enabled ? color : 'transparent',
                        color: p.enabled ? 'var(--accent-ink)' : 'transparent',
                      }}
                    >
                      <Check className="w-3 h-3 stroke-[2.7]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className="text-[13px] font-semibold truncate"
                          style={{ color: p.enabled ? color : 'var(--ink-secondary)' }}
                        >
                          @{p.handle}
                        </span>
                        <span className="text-[11px] text-[var(--ink-muted)] truncate">
                          {p.enabled ? p.tags[0] || '' : 'tạm tắt'}
                        </span>
                      </div>
                      <p className="text-[11.5px] text-[var(--ink-muted)] line-clamp-1 mt-0.5">
                        {p.name}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Add new perspective inline form */}
          {showAddRole ? (
            <form
              onSubmit={handleAddRoleSubmit}
              className="p-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] space-y-2.5"
            >
              <div className="text-xs font-semibold text-[var(--ink)]">Thêm góc nhìn mới</div>
              <input
                type="text"
                value={newHandle}
                onChange={(e) => setNewHandle(e.target.value)}
                placeholder="Tên gọi (vd: Nhà_sử_học)"
                className="w-full px-2.5 py-1.5 text-xs rounded-md bg-[var(--bg)] border border-[var(--border)] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
                required
              />
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Vai trò hiển thị (tùy chọn)"
                className="w-full px-2.5 py-1.5 text-xs rounded-md bg-[var(--bg)] border border-[var(--border)] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
              />
              <input
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="Nhóm #tag (vd: Rủi_ro)"
                className="w-full px-2.5 py-1.5 text-xs rounded-md bg-[var(--bg)] border border-[var(--border)] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
              />
              <textarea
                rows={2}
                value={newRolePrompt}
                onChange={(e) => setNewRolePrompt(e.target.value)}
                placeholder="Chỉ dẫn góc nhìn..."
                className="w-full px-2.5 py-1.5 text-xs rounded-md bg-[var(--bg)] border border-[var(--border)] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)] resize-none"
              />
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowAddRole(false)}
                  className="px-2.5 py-1 text-xs rounded-md text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 text-xs font-medium rounded-md bg-[var(--accent)] text-[var(--accent-ink)] hover:bg-[var(--accent-hover)] cursor-pointer"
                >
                  Thêm vào phòng
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
                Thêm góc nhìn mới
              </button>
              <button
                type="button"
                onClick={() => {
                  onSavePreset(`Bộ ${activeRoom.perspectives.length} AI · ${activeRoom.title.slice(0, 18)}`);
                  setPresetSavedNotice(true);
                  setTimeout(() => setPresetSavedNotice(false), 2000);
                }}
                className="w-full py-2 px-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs font-medium text-[var(--ink-secondary)] hover:text-[var(--ink)] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                {presetSavedNotice ? 'Đã lưu vào Preset!' : 'Lưu danh sách làm Preset'}
              </button>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
