import type {
  AIProviderConfig,
  BridgeHealth,
  ConversationHistoryItem,
  FlowEvent,
  LivingOutline,
  LiveStreamStatus,
  LiveTurnPhase,
  ModelOption,
  Perspective,
  ReportData,
  Room,
  SourceItem,
  TurnProvenance,
  TurnVerification,
} from '../types.ts';
import { getStoredUiLanguage, translate } from './i18n.tsx';

const REMOTE_API_KEY = 'lab_remote_backend_url';
const REMOTE_TOKEN_KEY = 'lab_remote_share_token';
const STREAM_IDLE_TIMEOUT_MS = 90_000;

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 500, code = '') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function isStaticPagesHost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = (window.location.hostname || '').toLowerCase();
  return (
    host.endsWith('.github.io') ||
    host === 'github.io' ||
    window.location.protocol === 'file:'
  );
}

function normalizeApiBase(raw: string): string {
  const trimmed = (raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function extractInviteParts(inputUrl: string): { apiBase: string; shareToken: string } | null {
  const trimmed = (inputUrl || '').trim();
  if (!trimmed) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const qApi = u.searchParams.get('api') || '';
    const hashRaw = u.hash.startsWith('#') ? u.hash.slice(1) : u.hash;
    const hashParams = new URLSearchParams(hashRaw);
    const tok = u.searchParams.get('token') || hashParams.get('token') || '';
    if (qApi) {
      return {
        apiBase: normalizeApiBase(qApi),
        shareToken: tok.trim(),
      };
    }
  } catch {
    // ignore non-URL
  }
  return null;
}

function bootstrapRemoteConfigFromUrl(): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    const hashRaw = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    const hashParams = new URLSearchParams(hashRaw);
    const qApi = url.searchParams.get('api') || hashParams.get('api');
    const qTok = url.searchParams.get('token') || hashParams.get('token');

    let changedUrl = false;
    if (qApi && qApi.trim()) {
      window.localStorage.setItem(REMOTE_API_KEY, normalizeApiBase(qApi));
    }
    if (qTok && qTok.trim()) {
      window.localStorage.setItem(REMOTE_TOKEN_KEY, qTok.trim());
      if (url.searchParams.has('token')) {
        url.searchParams.delete('token');
        changedUrl = true;
      }
      if (hashParams.has('token')) {
        hashParams.delete('token');
        const nextHash = hashParams.toString();
        url.hash = nextHash ? `#${nextHash}` : '';
        changedUrl = true;
      }
    }
    if (changedUrl) {
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  } catch {
    // ignore URL/storage restrictions
  }
}

bootstrapRemoteConfigFromUrl();

export function getRemoteConfig(): { apiBase: string; shareToken: string } {
  if (typeof window === 'undefined') return { apiBase: '', shareToken: '' };
  try {
    return {
      apiBase: (window.localStorage.getItem(REMOTE_API_KEY) || '').trim(),
      shareToken: (window.localStorage.getItem(REMOTE_TOKEN_KEY) || '').trim(),
    };
  } catch {
    return { apiBase: '', shareToken: '' };
  }
}

export function saveRemoteConfig(rawApiOrInvite: string, rawToken?: string): {
  apiBase: string;
  shareToken: string;
} {
  const invite = extractInviteParts(rawApiOrInvite);
  const apiBase = invite ? invite.apiBase : normalizeApiBase(rawApiOrInvite);
  const shareToken = (rawToken !== undefined && rawToken.trim()
    ? rawToken
    : invite?.shareToken || ''
  ).trim();
  if (typeof window !== 'undefined') {
    try {
      if (apiBase) window.localStorage.setItem(REMOTE_API_KEY, apiBase);
      else window.localStorage.removeItem(REMOTE_API_KEY);
      if (shareToken) window.localStorage.setItem(REMOTE_TOKEN_KEY, shareToken);
      else window.localStorage.removeItem(REMOTE_TOKEN_KEY);
    } catch {
      // ignore
    }
  }
  return { apiBase, shareToken };
}

export function clearRemoteConfig(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(REMOTE_API_KEY);
    window.localStorage.removeItem(REMOTE_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function buildApiUrl(path: string, withQueryToken = false): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const { apiBase, shareToken } = getRemoteConfig();
  const base = apiBase ? `${apiBase}${cleanPath}` : cleanPath;
  if (!withQueryToken || !shareToken) return base;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}share_token=${encodeURIComponent(shareToken)}`;
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { shareToken } = getRemoteConfig();
  const headers = new Headers(init.headers || {});
  if (shareToken && !headers.has('X-Share-Token')) {
    headers.set('X-Share-Token', shareToken);
  }
  if (!headers.has('ngrok-skip-browser-warning')) {
    headers.set('ngrok-skip-browser-warning', '1');
  }
  const url = buildApiUrl(path);
  return fetch(url, { ...init, headers });
}

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errObj = data as { error?: string; code?: string };
    const errMsg =
      errObj.error || translate(getStoredUiLanguage(), 'httpServerError', { status: res.status });
    throw new ApiError(errMsg, res.status, String(errObj.code || ''));
  }
  return data as T;
}

export async function fetchHealth(): Promise<BridgeHealth> {
  const res = await apiFetch('/api/health');
  return parseJson<BridgeHealth>(res);
}

export async function fetchShareInfoApi(): Promise<{
  enabled: boolean;
  token: string;
  defaultPagesUrl: string;
}> {
  const res = await apiFetch('/api/share-info');
  return parseJson(res);
}

export async function enableShareTokenApi(): Promise<{
  enabled: boolean;
  token: string;
  defaultPagesUrl: string;
}> {
  const res = await apiFetch('/api/share-info/enable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return parseJson(res);
}

export async function fetchModels(): Promise<{ models: ModelOption[] }> {
  const res = await apiFetch('/api/models');
  return parseJson<{ models: ModelOption[] }>(res);
}

export async function fetchProviders(): Promise<{ providers: AIProviderConfig[] }> {
  const res = await apiFetch('/api/providers');
  return parseJson<{ providers: AIProviderConfig[] }>(res);
}

export async function createProviderApi(payload: {
  name: string;
  kind: 'bridge' | 'gemini_api' | 'openai_compat';
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
}): Promise<{ provider: AIProviderConfig }> {
  const res = await apiFetch('/api/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson<{ provider: AIProviderConfig }>(res);
}

export async function deleteProviderApi(providerId: string): Promise<void> {
  const res = await apiFetch(`/api/providers/${encodeURIComponent(providerId)}`, {
    method: 'DELETE',
  });
  await parseJson(res);
}

export async function renameLaneApi(
  laneId: string,
  name: string
): Promise<{ id: string; name: string; laneNames: Record<string, string> }> {
  const res = await apiFetch(`/api/lanes/${encodeURIComponent(laneId)}`, {
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
  const res = await apiFetch('/api/lanes/create', {
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
  const res = await apiFetch(`/api/lanes/${encodeURIComponent(laneId)}/login`, {
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
  const res = await apiFetch(`/api/lanes/${encodeURIComponent(laneId)}/finish-login`, {
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
  const res = await apiFetch(`/api/lanes/${encodeURIComponent(laneId)}/sync`, {
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
  const res = await apiFetch('/api/lanes/sync-all', {
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
  const res = await apiFetch(`/api/providers/${encodeURIComponent(providerId)}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(laneId ? { laneId } : {}),
  });
  return parseJson(res);
}

export async function fetchRooms(): Promise<{ rooms: Room[] }> {
  const res = await apiFetch('/api/rooms');
  return parseJson<{ rooms: Room[] }>(res);
}

export async function fetchRoomWithEvents(roomId: string): Promise<{ room: Room; events: FlowEvent[] }> {
  const res = await apiFetch(`/api/rooms/${encodeURIComponent(roomId)}`);
  return parseJson<{ room: Room; events: FlowEvent[] }>(res);
}

export async function createRoomApi(payload: Partial<Room>): Promise<{ room: Room }> {
  const res = await apiFetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson<{ room: Room }>(res);
}

export async function patchRoomApi(roomId: string, patch: Partial<Room>): Promise<{ room: Room }> {
  const res = await apiFetch(`/api/rooms/${encodeURIComponent(roomId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return parseJson<{ room: Room }>(res);
}

export async function deleteRoomApi(roomId: string): Promise<void> {
  const res = await apiFetch(`/api/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' });
  await parseJson(res);
}

export async function emitFlowEventApi(
  roomId: string,
  event: Omit<FlowEvent, 'seq' | 'room_id' | 'timestamp'> & { timestamp?: string }
): Promise<{ event: FlowEvent }> {
  const res = await apiFetch(`/api/rooms/${encodeURIComponent(roomId)}/flow-events`, {
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
  const res = await apiFetch('/api/research/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson<{ items: Omit<SourceItem, 'id'>[] }>(res);
}

export async function uploadPdfSourceApi(file: File): Promise<{ item: Omit<SourceItem, 'id'> }> {
  const buf = await file.arrayBuffer();
  const res = await apiFetch(`/api/research/upload-pdf?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: buf,
  });
  return parseJson<{ item: Omit<SourceItem, 'id'> }>(res);
}

async function readWithIdleWatchdog<T>(
  reader: ReadableStreamDefaultReader<T>,
  idleTimeoutMs: number
): Promise<ReadableStreamReadResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new ApiError('Mất tín hiệu kết nối tới máy chủ nghiên cứu (quá thời gian chờ nhịp tim).', 504, 'sse_idle_timeout'));
        }, idleTimeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function postSseWithLiveness<T>(
  path: string,
  payload: unknown,
  signal?: AbortSignal,
  onStatus?: (status: LiveStreamStatus) => void
): Promise<T> {
  const res = await apiFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream, application/json',
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    return parseJson<T>(res);
  }

  const ctype = (res.headers.get('content-type') || '').toLowerCase();
  if (!ctype.includes('text/event-stream') || !res.body) {
    return parseJson<T>(res);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let finalResult: T | undefined;
  let streamError: ApiError | undefined;

  const processFrame = (rawFrame: string) => {
    const lines = rawFrame.split(/\r?\n/);
    let evName = 'message';
    const dataParts: string[] = [];
    for (const line of lines) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) {
        evName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataParts.push(line.slice(5).trim());
      }
    }
    const dataStr = dataParts.join('\n').trim();
    if (!dataStr) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(dataStr) as Record<string, unknown>;
    } catch {
      return;
    }

    if (evName === 'status') {
      const rawPhase = String(parsed.phase || 'waiting_gemini') as LiveTurnPhase;
      onStatus?.({
        phase: rawPhase,
        laneId: typeof parsed.laneId === 'string' ? parsed.laneId : undefined,
        model: typeof parsed.model === 'string' ? parsed.model : undefined,
        thoughtChars: typeof parsed.thoughtChars === 'number' ? parsed.thoughtChars : undefined,
        replyChars: typeof parsed.replyChars === 'number' ? parsed.replyChars : undefined,
        heartbeat: Boolean(parsed.heartbeat),
      });
    } else if (evName === 'result') {
      finalResult = parsed as unknown as T;
    } else if (evName === 'error') {
      const msg = String(parsed.error || 'Lỗi máy chủ nghiên cứu.');
      const st = typeof parsed.status === 'number' ? parsed.status : 502;
      streamError = new ApiError(msg, st, String(parsed.code || ''));
    }
  };

  try {
    while (true) {
      const { value, done } = await readWithIdleWatchdog(reader, STREAM_IDLE_TIMEOUT_MS);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() || '';
      for (const frame of parts) {
        processFrame(frame);
        if (streamError) throw streamError;
        if (finalResult !== undefined) return finalResult;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      processFrame(buffer);
      if (streamError) throw streamError;
      if (finalResult !== undefined) return finalResult;
    }
  } finally {
    reader.releaseLock();
  }

  throw new ApiError('Luồng kết nối đóng trước khi trả kết quả hoàn chỉnh.', 502, 'incomplete_stream');
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
  signal?: AbortSignal,
  onStatus?: (status: LiveStreamStatus) => void
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
  return postSseWithLiveness('/api/ai/perspective', payload, signal, onStatus);
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
  signal?: AbortSignal,
  onStatus?: (status: LiveStreamStatus) => void
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
  return postSseWithLiveness('/api/ai/synthesize', payload, signal, onStatus);
}
