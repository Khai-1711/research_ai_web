import type {
  BridgeHealth,
  FlowEvent,
  LivingOutline,
  Perspective,
  ReportData,
  Room,
  SourceItem,
} from '../types.ts';

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = (data as { error?: string }).error || `Lỗi máy chủ (HTTP ${res.status})`;
    throw new Error(errMsg);
  }
  return data as T;
}

export async function fetchHealth(): Promise<BridgeHealth> {
  const res = await fetch('/api/health');
  return parseJson<BridgeHealth>(res);
}

export async function fetchRooms(): Promise<{ rooms: Room[] }> {
  const res = await fetch('/api/rooms');
  return parseJson<{ rooms: Room[] }>(res);
}

export async function fetchRoomWithEvents(roomId: string): Promise<{ room: Room; events: FlowEvent[] }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`);
  return parseJson<{ room: Room; events: FlowEvent[] }>(res);
}

export async function createRoomApi(payload: Partial<Room>): Promise<{ room: Room }> {
  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson<{ room: Room }>(res);
}

export async function patchRoomApi(roomId: string, patch: Partial<Room>): Promise<{ room: Room }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return parseJson<{ room: Room }>(res);
}

export async function deleteRoomApi(roomId: string): Promise<void> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' });
  await parseJson(res);
}

export async function resetSeedRoomsApi(): Promise<{ rooms: Room[] }> {
  const res = await fetch('/api/rooms/reset', { method: 'POST' });
  return parseJson<{ rooms: Room[] }>(res);
}

export async function emitFlowEventApi(
  roomId: string,
  event: Omit<FlowEvent, 'seq' | 'room_id' | 'timestamp'> & { timestamp?: string }
): Promise<{ event: FlowEvent }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/flow-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  return parseJson<{ event: FlowEvent }>(res);
}

export async function searchResearchApi(payload: {
  query?: string;
  url?: string;
}): Promise<{ items: Omit<SourceItem, 'id'>[] }> {
  const res = await fetch('/api/research/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson<{ items: Omit<SourceItem, 'id'>[] }>(res);
}

export async function runPerspectiveApi(
  payload: {
    perspective: Perspective;
    prompt: string;
    sources: SourceItem[];
    round: number;
    peerMessages?: Array<{ handle: string; content: string }>;
    laneId?: string;
  },
  signal?: AbortSignal
): Promise<{
  content: string;
  summary1Line: string;
  citedSourceIds: string[];
  elapsedSec: number;
  modelUsed: string;
  fallbackFrom?: string;
  laneId: string;
  rawPrompt: string;
}> {
  const res = await fetch('/api/ai/perspective', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  return parseJson(res);
}

export async function runSynthesizeApi(
  payload: {
    roomTitle: string;
    messages: Array<{ handle?: string; perspectiveId?: string; content: string; round: number }>;
    perspectives: Perspective[];
    sources: SourceItem[];
    anonymize: boolean;
  },
  signal?: AbortSignal
): Promise<{
  report: ReportData;
  livingOutline: LivingOutline;
  elapsedSec: number;
  summary1Line: string;
  anonymizeUsed: boolean;
}> {
  const res = await fetch('/api/ai/synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  return parseJson(res);
}
