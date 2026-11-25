import type {
  AIProviderConfig,
  BridgeHealth,
  ConversationHistoryItem,
  FlowEvent,
  LivingOutline,
  ModelOption,
  Perspective,
  ReportData,
  Room,
  SourceItem,
  TurnProvenance,
  TurnVerification,
} from '../types.ts';
import { getStoredUiLanguage, translate } from './i18n.tsx';

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg =
      (data as { error?: string }).error ||
      translate(getStoredUiLanguage(), 'httpServerError', { status: res.status });
    throw new Error(errMsg);
  }
  return data as T;
}

export async function fetchHealth(): Promise<BridgeHealth> {
  const res = await fetch('/api/health');
  return parseJson<BridgeHealth>(res);
}

export async function fetchModels(): Promise<{ models: ModelOption[] }> {
  const res = await fetch('/api/models');
  return parseJson<{ models: ModelOption[] }>(res);
}

export async function fetchProviders(): Promise<{ providers: AIProviderConfig[] }> {
  const res = await fetch('/api/providers');
  return parseJson<{ providers: AIProviderConfig[] }>(res);
}

export async function createProviderApi(payload: {
  name: string;
  kind: 'bridge' | 'gemini_api' | 'openai_compat';
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
}): Promise<{ provider: AIProviderConfig }> {
  const res = await fetch('/api/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson<{ provider: AIProviderConfig }>(res);
}

export async function deleteProviderApi(providerId: string): Promise<void> {
  const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}`, { method: 'DELETE' });
  await parseJson(res);
}

export async function renameLaneApi(
  laneId: string,
  name: string
): Promise<{ id: string; name: string; laneNames: Record<string, string> }> {
  const res = await fetch(`/api/lanes/${encodeURIComponent(laneId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return parseJson(res);
}

export async function createLaneApi(): Promise<{
  ok: boolean;
  lane_id: string;
  port: number;
  url: string;
  spawned: boolean;
  ready: boolean;
}> {
  const res = await fetch('/api/lanes/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return parseJson(res);
}

export async function loginLaneApi(
  laneId: string,
  label?: string
): Promise<{ ok: boolean; status: string; message?: string }> {
  const res = await fetch(`/api/lanes/${encodeURIComponent(laneId)}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(label ? { label } : {}),
  });
  return parseJson(res);
}

export async function finishLoginLaneApi(laneId: string): Promise<{
  ok: boolean;
  profile_id: string;
  account_key?: string;
  rotated?: boolean;
  delivery?: { applied?: boolean; delivery?: string; auth_ok?: boolean };
}> {
  const res = await fetch(`/api/lanes/${encodeURIComponent(laneId)}/finish-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return parseJson(res);
}

export async function syncLaneApi(
  laneId: string,
  label?: string
): Promise<{
  ok: boolean;
  profile_id: string;
  account_key?: string;
  rotated?: boolean;
  delivery?: { applied?: boolean; delivery?: string; auth_ok?: boolean };
}> {
  const res = await fetch(`/api/lanes/${encodeURIComponent(laneId)}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(label ? { label } : {}),
  });
  return parseJson(res);
}

export async function syncAllLanesApi(): Promise<{
  ok: boolean;
  total: number;
  synced: number;
}> {
  const res = await fetch('/api/lanes/sync-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return parseJson(res);
}

export async function testProviderApi(
  providerId: string,
  laneId?: string
): Promise<{
  ok: boolean;
  modelUsed?: string;
  laneId?: string;
  elapsedSec?: number;
  preview?: string;
  error?: string;
}> {
  const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(laneId ? { laneId } : {}),
  });
  return parseJson(res);
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

export async function uploadPdfSourceApi(file: File): Promise<{ item: Omit<SourceItem, 'id'> }> {
  const buf = await file.arrayBuffer();
  const res = await fetch(`/api/research/upload-pdf?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: buf,
  });
  return parseJson<{ item: Omit<SourceItem, 'id'> }>(res);
}

export async function runPerspectiveApi(
  payload: {
    perspective: Perspective;
    prompt: string;
    sources: SourceItem[];
    round: number;
    conversationHistory?: ConversationHistoryItem[];
    peerMessages?: Array<{ handle: string; content: string }>;
    laneId?: string;
    detailMode?: 'deep' | 'standard';
  },
  signal?: AbortSignal
): Promise<{
  content: string;
  summary1Line: string;
  citedSourceIds: string[];
  verification?: TurnVerification;
  elapsedSec: number;
  modelUsed: string;
  fallbackFrom?: string;
  laneId: string;
  rawPrompt: string;
  provenance?: TurnProvenance;
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
    messages: Array<{
      senderType?: 'user' | 'ai' | 'judge' | 'system';
      handle?: string;
      perspectiveId?: string;
      laneId?: string;
      modelLabel?: string;
      content: string;
      round: number;
    }>;
    perspectives: Perspective[];
    sources: SourceItem[];
    anonymize: boolean;
    judgeModel?: string;
    judgeProviderId?: string;
    judgeLaneId?: string;
    judgeRuns?: number;
    claimCheck?: boolean;
  },
  signal?: AbortSignal
): Promise<{
  report: ReportData;
  livingOutline: LivingOutline;
  elapsedSec: number;
  summary1Line: string;
  anonymizeUsed: boolean;
  laneId?: string;
  modelUsed?: string;
  provenance?: TurnProvenance;
}> {
  const res = await fetch('/api/ai/synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  return parseJson(res);
}
