import fs from 'fs';
import path from 'path';
import type { FlowEvent, Room, RoomSummary, SourceItem } from '../src/types.ts';
import { SEED_FLOW_EVENTS, SEED_ROOMS } from '../src/seedData.ts';

const DATA_ROOT = path.resolve(process.cwd(), 'data', 'rooms');

type SSEListener = (event: FlowEvent) => void;
const roomListeners = new Map<string, Set<SSEListener>>();

function safeRoomId(roomId: string): string {
  return roomId.replace(/[^a-zA-Z0-9_-]/g, '');
}

function getRoomDir(roomId: string): string {
  const safe = safeRoomId(roomId);
  if (!safe) throw new Error('Invalid room ID');
  return path.join(DATA_ROOT, safe);
}

export function ensureSeedData(): void {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  const existing = fs.readdirSync(DATA_ROOT).filter((name) => {
    const p = path.join(DATA_ROOT, name, 'meta.json');
    return fs.existsSync(p);
  });

  if (existing.length === 0) {
    for (const room of SEED_ROOMS) {
      saveRoom(room);
      const events = SEED_FLOW_EVENTS[room.id] ?? [];
      if (events.length > 0) {
        writeFlowEvents(room.id, events);
      }
    }
  }
}

export function resetAllSeedData(): Room[] {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  for (const entry of fs.readdirSync(DATA_ROOT)) {
    fs.rmSync(path.join(DATA_ROOT, entry), { recursive: true, force: true });
  }
  for (const room of SEED_ROOMS) {
    saveRoom(room);
    const events = SEED_FLOW_EVENTS[room.id] ?? [];
    if (events.length > 0) {
      writeFlowEvents(room.id, events);
    }
  }
  return listFullRooms();
}

export function saveRoom(room: Room): Room {
  const dir = getRoomDir(room.id);
  fs.mkdirSync(dir, { recursive: true });

  const { sources, ...metaWithoutSources } = room;
  fs.writeFileSync(
    path.join(dir, 'meta.json'),
    JSON.stringify(metaWithoutSources, null, 2),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(dir, 'sources.json'),
    JSON.stringify(sources ?? [], null, 2),
    'utf-8'
  );

  const eventsPath = path.join(dir, 'events.jsonl');
  if (!fs.existsSync(eventsPath)) {
    fs.writeFileSync(eventsPath, '', 'utf-8');
  }
  return room;
}

export function getRoom(roomId: string): Room | null {
  try {
    const dir = getRoomDir(roomId);
    const metaPath = path.join(dir, 'meta.json');
    if (!fs.existsSync(metaPath)) return null;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Omit<Room, 'sources'>;
    const sourcesPath = path.join(dir, 'sources.json');
    const sources: SourceItem[] = fs.existsSync(sourcesPath)
      ? (JSON.parse(fs.readFileSync(sourcesPath, 'utf-8')) as SourceItem[])
      : [];
    return { ...meta, sources };
  } catch {
    return null;
  }
}

export function listFullRooms(): Room[] {
  ensureSeedData();
  const dirs = fs.readdirSync(DATA_ROOT);
  const rooms: Room[] = [];
  for (const d of dirs) {
    const r = getRoom(d);
    if (r) rooms.push(r);
  }
  return rooms.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export function listRoomSummaries(): RoomSummary[] {
  return listFullRooms().map((r) => ({
    id: r.id,
    title: r.title,
    totalPerspectives: r.perspectives.length,
    enabledPerspectives: r.perspectives.filter((p) => p.enabled).length,
    sourceCount: r.sources.length,
    messageCount: r.messages.length,
    updatedAt: r.updatedAt,
  }));
}

export function deleteRoom(roomId: string): boolean {
  const dir = getRoomDir(roomId);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export function writeFlowEvents(roomId: string, events: FlowEvent[]): void {
  const dir = getRoomDir(roomId);
  fs.mkdirSync(dir, { recursive: true });
  const lines = events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '');
  fs.writeFileSync(path.join(dir, 'events.jsonl'), lines, 'utf-8');
}

export function getFlowEvents(roomId: string): FlowEvent[] {
  try {
    const eventsPath = path.join(getRoomDir(roomId), 'events.jsonl');
    if (!fs.existsSync(eventsPath)) return [];
    const raw = fs.readFileSync(eventsPath, 'utf-8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FlowEvent);
  } catch {
    return [];
  }
}

export function getRawEventsJsonl(roomId: string): string {
  try {
    const eventsPath = path.join(getRoomDir(roomId), 'events.jsonl');
    if (!fs.existsSync(eventsPath)) return '';
    return fs.readFileSync(eventsPath, 'utf-8');
  } catch {
    return '';
  }
}

export function appendFlowEvent(roomId: string, eventWithoutSeq: Omit<FlowEvent, 'seq'>): FlowEvent {
  const dir = getRoomDir(roomId);
  fs.mkdirSync(dir, { recursive: true });
  const existing = getFlowEvents(roomId);
  const nextSeq = existing.length > 0 ? existing[existing.length - 1].seq + 1 : 1;
  const fullEvent: FlowEvent = {
    ...eventWithoutSeq,
    seq: nextSeq,
  };
  fs.appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify(fullEvent) + '\n', 'utf-8');

  const listeners = roomListeners.get(safeRoomId(roomId));
  if (listeners) {
    for (const fn of listeners) {
      try {
        fn(fullEvent);
      } catch {
        // Ignore broken SSE client
      }
    }
  }
  return fullEvent;
}

export function subscribeRoomEvents(roomId: string, listener: SSEListener): () => void {
  const key = safeRoomId(roomId);
  let set = roomListeners.get(key);
  if (!set) {
    set = new Set();
    roomListeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) {
      roomListeners.delete(key);
    }
  };
}
