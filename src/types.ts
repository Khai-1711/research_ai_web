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
  modelLabel: string; // e.g. "gemini-4-hydrogen"
  colorIndex: number; // 0..9 mapped to --p-0..--p-9
  enabled: boolean;
}

export interface SourceItem {
  id: string; // e.g. "S1", "S2"
  origin: string; // e.g. "arXiv · 2024", "OpenAlex · 2025", "Wikipedia", "URL"
  title: string;
  excerpt: string;
  url: string;
  verified: boolean;
  addedAt: string;
}

export interface ChatMessage {
  id: string;
  round: number;
  roundLabel: string; // e.g. "Vòng 0 · Trả lời độc lập"
  senderType: 'user' | 'ai' | 'judge' | 'system';
  perspectiveId?: string;
  handle?: string;
  colorIndex?: number;
  modelLabel?: string;
  laneId?: string;
  elapsedSec?: number;
  summary1Line?: string;
  content: string;
  citedSourceIds: string[];
  pinnedToReport?: boolean;
  fallbackFrom?: string;
  createdAt: string;
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
}

export interface ReportData {
  title: string;
  subtitle: string;
  executiveSummary: string;
  perspectiveBreakdown: Array<{
    handle: string;
    summary: string;
    citations: string[];
  }>;
  openDebates: string[];
  rubric: RubricRow[];
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

export interface BridgeHealth {
  mode: 'bridge' | 'gemini-preview';
  bridgeUrl: string | null;
  healthyWorkers: number;
  totalWorkers: number;
  lanes: string[];
  guestMode: boolean;
  bridgeOffline: boolean;
  defaultModel: string;
}

export interface AppSettings {
  maxConcurrency: number;
  approveResearchPlan: boolean;
  anonymizeJudge: boolean;
  simulateBridgeAlert: 'none' | 'offline' | 'guest';
}
