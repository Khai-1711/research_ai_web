export type ThemeMode = 'light' | 'dark';

export type LabViewTab = 'chat' | 'compare' | 'report' | 'audit';
export type FlowViewTab = 'map' | 'swimlane';
export type AppSurface = 'lab' | 'flow';

export interface Perspective {
  id: string;
  handle: string; // e.g. "Kỹ_thuật" (displayed as @Kỹ_thuật)
  name: string;
  rolePrompt: string;
  tags: string[]; // e.g. ["Kỹ_thuật", "Rủi_ro"]
  modelLabel: string; // e.g. "gemini-4-hydrogen", "gemini-neon", "gemini-carbon"
  providerId?: string; // e.g. "bridge-local" or custom API provider id
  pinnedLaneId?: string; // e.g. "acc1", "acc2", "acc3" (empty = auto load-balance)
  colorIndex: number; // 0..9 mapped to --p-0..--p-9
  enabled: boolean;
}

export interface SourceItem {
  id: string; // e.g. "S1", "S2"
  origin: string; // e.g. "arXiv · 2024", "OpenAlex · 2025", "Wikipedia", "URL"
  title: string;
  excerpt: string;
  url: string;
  contentLevel?: 'full_text' | 'abstract_only' | 'excerpt';
  charCount?: number;
  verified: boolean;
  addedAt: string;
  /** Loại nguồn để cân trọng số bằng chứng (preprint ≠ bài đã xuất bản ≠ Wikipedia). */
  sourceType?: SourceType;
  venue?: string | null;
  citedByCount?: number | null;
  publishedYear?: string | null;
  doi?: string | null;
  /** Nguồn được lấy thế nào: câu truy vấn, thời điểm, tham số — để tái lập lần tìm. */
  retrieval?: SourceRetrieval;
}

export type SourceType =
  | 'preprint'
  | 'published_venue'
  | 'other_scholarly'
  | 'encyclopedia'
  | 'web'
  | 'web_pdf'
  | 'user_upload'
  | 'user_excerpt';

export interface SourceRetrieval {
  provider: string;
  query?: string;
  normalizedQuery?: string;
  retrievedAt: string;
  rank?: number;
  fulltextUpgraded?: boolean;
  requestedUrl?: string;
  finalUrl?: string;
  filename?: string;
  params?: Record<string, unknown>;
}

/** Nguồn gốc thực tế của 1 lượt AI (provider, model yêu cầu/thực dùng, lane và lane lấy từ đâu). */
export interface TurnProvenance {
  providerId: string;
  providerKind: string;
  modelRequested: string;
  modelUsed: string;
  fallbackFrom?: string | null;
  laneId: string;
  laneSource: 'gateway' | 'pinned' | 'api' | 'unreported' | string;
  laneRequestedByClient?: string | null;
  retries?: number;
  perspectiveId?: string;
  detailMode?: string | null;
  round?: number;
  completedAt?: string;
  elapsedSec?: number;
}

export interface StructuredWarningItem {
  code: string;
  params?: Record<string, unknown>;
  text: string;
}

export interface TurnVerification {
  validCitations: string[];
  inferredCitations: string[];
  invalidCitations: string[];
  numericClaimsChecked: number;
  numericClaimsMatched: number;
  unverifiedNumbers: Array<{ number: string; cited: string[]; sentence: string }>;
  abstractOnlyCited: string[];
  warnings: string[];
  warningItems?: StructuredWarningItem[];
}

export type RoundKind = 'independent' | 'discuss' | 'rebuttal' | 'judge' | 'deep_research' | 'dossier';

export interface ChatMessage {
  id: string;
  round: number;
  roundLabel: string; // e.g. "Vòng 0 · Trả lời độc lập"
  roundKind?: RoundKind;
  roundCount?: number;
  senderType: 'user' | 'ai' | 'judge' | 'system';
  perspectiveId?: string;
  handle?: string;
  colorIndex?: number;
  modelLabel?: string;
  laneId?: string;
  elapsedSec?: number;
  summary1Line?: string;
  content: string;
  executiveSummaryCode?: 'empty_summary' | 'no_synthesis' | null;
  citedSourceIds: string[];
  verification?: TurnVerification;
  pinnedToReport?: boolean;
  preserveFull?: boolean;
  fallbackFrom?: string;
  provenance?: TurnProvenance;
  createdAt: string;
}

export interface ConversationHistoryItem {
  round: number;
  senderType: 'user' | 'ai' | 'judge' | 'system';
  handle?: string;
  content: string;
  summary1Line?: string;
  preserveFull?: boolean;
}

export interface LivingOutline {
  consensus: Array<{
    title: string;
    supporters: string[];
    citations: string[];
  }>;
  contradictions: Array<{
    topic: string;
    detail: string;
    suggestedPrompt: string;
  }>;
  gaps: string[];
}

export interface RubricRow {
  perspectiveId: string;
  handle: string;
  colorIndex: number;
  evidence: number;
  logic: number;
  rebuttal: number;
  total: number;
  fallbackScored?: boolean;
  /** Số lần chấm có đủ điểm hợp lệ / tổng số lần chấm. */
  runsScored?: number;
  runsTotal?: number;
  /** Chênh lệch tổng điểm lớn nhất giữa các lần chấm (đổi thứ tự ứng viên). */
  totalSpread?: number;
  totalsByRun?: Array<number | null>;
}

export type ClaimSupportLabel = 'supported' | 'partial' | 'unsupported' | 'unclear' | 'unchecked';

export interface ClaimSupportCounts {
  checked: number;
  supported: number;
  partial: number;
  unsupported: number;
  unclear: number;
  unchecked: number;
}

export interface ClaimSupportResult {
  id: string;
  handle: string;
  round: number;
  sentence: string;
  sourceIds: string[];
  label: ClaimSupportLabel;
  evidence: string;
  evidenceQuoteFound: boolean | null;
  downgradedNoQuote: boolean;
}

export interface ClaimSupportSummary {
  totals: ClaimSupportCounts;
  byHandle: Record<string, ClaimSupportCounts>;
  warnings: string[];
  warningItems?: StructuredWarningItem[];
  claims: ClaimSupportResult[];
  modelUsed?: string;
  laneId?: string;
  providerId?: string;
}

export interface VerificationSummary {
  totalValidCitations: number;
  totalInferredCitations: number;
  totalInvalidCitations: number;
  totalNumericChecked: number;
  totalNumericMatched: number;
  warnings: string[];
  warningItems?: StructuredWarningItem[];
  claimSupport?: ClaimSupportSummary;
}

export interface JudgeReliability {
  runsRequested: number;
  runsCompleted: number;
  runsParsed: number;
  seed: string;
  candidateOrders: string[][];
  rankingStable: boolean | null;
  maxTotalSpread: number;
  judgeFamily: string;
  debaterFamilies: string[];
  sameFamilyAsDebaters: boolean;
  runs: Array<Partial<TurnProvenance> & { runIndex: number; order: string[]; parsed: boolean; error: string | null }>;
}

export interface ReportData {
  title: string;
  titleParams?: { roomTitle: string };
  subtitle: string;
  metaParams?: {
    anonymize: boolean;
    runsCompleted: number;
    sourceCount: number;
    activeCount: number;
    totalCount: number;
  };
  executiveSummary: string;
  executiveSummaryCode?: 'empty_summary' | 'no_synthesis' | null;
  perspectiveBreakdown: Array<{
    handle: string;
    summary: string;
    summaryCode?: 'breakdown_fallback' | 'breakdown_default' | null;
    citations: string[];
  }>;
  openDebates: string[];
  rubric: RubricRow[];
  evaluationWarnings?: string[];
  evaluationWarningItems?: StructuredWarningItem[];
  verificationSummary?: VerificationSummary;
  judgeReliability?: JudgeReliability;
  updatedAt: string;
}

export interface AuditEntry {
  id: string;
  round: number;
  handle: string;
  modelRequested: string;
  modelUsed: string;
  laneId: string;
  elapsedSec: number;
  fallbackWarning?: string;
  rawPrompt: string;
  sourceIdsSeen: string[];
  provenance?: TurnProvenance;
  timestamp: string;
}

export interface FlowInputEdge {
  from_node_id: string;
  kind: 'prompt' | 'turn' | 'source' | 'synthesis';
  anonymized_as?: string;
  chars: number;
  summary?: string;
  source_ids?: string[];
}

export type FlowEventType =
  | 'run_started'
  | 'node_started'
  | 'node_warning'
  | 'node_completed'
  | 'node_failed'
  | 'run_aborted';

export interface FlowActor {
  id: string;
  name: string;
  handle?: string;
  colorIndex: number;
  enabled: boolean;
  tags?: string[];
  kind: 'user' | 'source' | 'ai' | 'judge' | 'critic' | 'output' | 'planner';
}

export interface FlowEventPayload {
  node_id: string;
  stage_index: number;
  stage_label: string;
  actor: FlowActor;
  inputs: FlowInputEdge[];
  summary_1line?: string;
  content?: string;
  warning_message?: string;
  error_message?: string;
  pattern?: 'direct' | 'council' | 'debate' | 'research';
  participants?: FlowActor[]; // Sent in run_started so disabled AIs render immediately
  transport?: {
    lane_id: string;
    started_offset_s: number;
    elapsed_s: number;
    fallback_from?: string;
    retry_count?: number;
  };
}

export interface FlowEvent {
  seq: number;
  event_type: FlowEventType;
  run_id: string;
  room_id: string;
  timestamp: string;
  payload: FlowEventPayload;
}

export interface Room {
  id: string;
  title: string;
  topicPrompt: string;
  createdAt: string;
  updatedAt: string;
  perspectives: Perspective[];
  messages: ChatMessage[];
  sources: SourceItem[];
  livingOutline: LivingOutline;
  report?: ReportData;
  audit: AuditEntry[];
}

export interface RoomSummary {
  id: string;
  title: string;
  totalPerspectives: number;
  enabledPerspectives: number;
  sourceCount: number;
  messageCount: number;
  updatedAt: string;
}

export interface PerspectivePreset {
  id: string;
  name: string;
  description: string;
  perspectives: Omit<Perspective, 'id'>[];
}

export interface LaneInfo {
  id: string;
  name: string;
  bridgeLabel: string;
  url: string;
  reachable: boolean;
  control: string;
  authOk: boolean;
  model: string;
  accountStatus: string;
  accountKey?: string;
  duplicatedWith?: string[];
  profileId?: string;
  hasProfileData?: boolean;
  loginOpen?: boolean;
  syncing?: boolean;
  lastSyncStatus?: string;
  lastSyncError?: string | null;
  lastSyncAt?: number;
}

export type LiveTurnPhase = 'queued_lock' | 'waiting_gemini' | 'thinking' | 'generating';

export interface LiveStreamStatus {
  phase: LiveTurnPhase;
  laneId?: string;
  model?: string;
  thoughtChars?: number;
  replyChars?: number;
  heartbeat?: boolean;
  elapsedS?: number;
}

export interface BridgeHealth {
  mode: 'bridge' | 'gemini-preview';
  bridgeUrl: string | null;
  healthyWorkers: number;
  totalWorkers: number;
  lanes: string[];
  laneDetails?: LaneInfo[];
  guestMode: boolean;
  bridgeOffline: boolean;
  defaultModel: string;
  cookieSyncBrowser?: string | null;
  isLocalOwner?: boolean;
  shareProtected?: boolean;
}

export interface ModelOption {
  id: string;
  label: string;
  providerId: string;
  providerName: string;
}

export interface AIProviderConfig {
  id: string;
  name: string;
  kind: 'bridge' | 'gemini_api' | 'openai_compat';
  baseUrl: string;
  defaultModel: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  builtin: boolean;
}

export interface AppSettings {
  maxConcurrency: number;
  approveResearchPlan: boolean;
  anonymizeJudge: boolean;
  detailMode?: 'deep' | 'standard';
  judgeModel?: string;
  judgeProviderId?: string;
  judgeLaneId?: string;
  /** Số lần Trọng tài chấm với thứ tự ứng viên khác nhau (1–3, mặc định 2). */
  judgeRuns?: number;
  /** Bật bước kiểm "nguồn có ủng hộ từng câu khẳng định không" (mặc định bật). */
  claimCheck?: boolean;
}
