export type AreaId = 'studio' | 'knowledge' | 'ingest' | 'github' | 'settings';

export type BrainRouteKind =
  | 'primary-worker'
  | 'backup-supabase'
  | 'ollama-direct'
  | 'built-in-only';

export interface BrainRouteStatus {
  activeKind: BrainRouteKind;
  activeEndpoint: string;
  failoverReason: string | null;
  latencyMs: number | null;
  activeProviders: string[];
  lastCheckedAt: string | null;
}

export type LearningEventKind =
  | 'auto_mined'
  | 'manual_teach'
  | 'url_ingested'
  | 'voice_captured'
  | 'ocr_distilled'
  | 'reinforced'
  | 'cloud_assisted'
  | 'repo_indexed';

export interface LearningEvent {
  id: string;
  kind: LearningEventKind;
  title: string;
  detail: string;
  source: string;
  createdAt: string;
}

export interface ConceptNode {
  label: string;
  count: number;
  entryIds: string[];
  related: string[];
}

export interface KnowledgeGrowthStats {
  totalEntries: number;
  uniqueConcepts: number;
  autoMinedCount: number;
  capturedCount: number;
  manualTeachCount: number;
  totalRecalls: number;
  avgConfidence: number;
  topConcepts: ConceptNode[];
}

export interface KnowledgeFolder {
  id: string;
  user_id: string;
  name: string;
  description: string;
  created_at: string;
}

export interface KnowledgeEntry {
  id: string;
  user_id: string;
  folder_id: string | null;
  title: string;
  content: string;
  tags: string[];
  source: string;
  recall_count?: number;
  confidence_score?: number;
  created_at: string;
  updated_at: string;
}

export interface UserPreferences {
  user_id: string;
  brain_url: string;
  backup_brain_url?: string;
  preferred_model: string;
  auto_learn_from_chat: boolean;
  prefer_built_in_first?: boolean;
  capture_interval_ms: number;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  user_id: string;
  role: 'user' | 'mantis';
  content: string;
  cited_entry_ids: string[];
  cited_repo_paths?: string[];
  created_at: string;
}

export interface GitHubConnection {
  id: string;
  user_id: string;
  owner: string;
  repo: string;
  branch: string;
  description: string;
  is_private: boolean;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
}

export interface RepoFile {
  id: string;
  user_id: string;
  connection_id: string;
  path: string;
  size_bytes: number;
  sha: string;
  content: string;
  updated_at: string;
}

export type SuggestionStatus = 'pending' | 'approved' | 'rejected';
export type SuggestionKind = 'code_help' | 'self_improvement';

export interface CodeSuggestion {
  id: string;
  user_id: string;
  connection_id: string | null;
  file_path: string;
  title: string;
  rationale: string;
  original_content: string;
  proposed_content: string;
  status: SuggestionStatus;
  suggestion_kind?: SuggestionKind;
  user_feedback: string;
  pr_url: string;
  created_at: string;
  updated_at: string;
}

export type AuditSeverity = 'high' | 'medium' | 'low';
export type AuditCategory = 'security' | 'accessibility' | 'reliability' | 'maintainability' | 'knowledge';

export interface SelfAuditFinding {
  id: string;
  filePath: string;
  severity: AuditSeverity;
  category: AuditCategory;
  title: string;
  description: string;
  highGuard: boolean;
  canAutoStageDiff: boolean;
  goalHint: string;
  fileContent: string;
}

export interface SelfAuditReport {
  repoLabel: string;
  branch: string;
  filesScanned: number;
  healthScore: number;
  findings: SelfAuditFinding[];
  matchedKnowledgeTitles: string[];
  scannedAt: string;
}

export interface SelfAuditRun {
  id: string;
  user_id: string;
  repo_label: string;
  branch: string;
  files_scanned: number;
  findings_count: number;
  health_score: number;
  summary: string;
  created_at: string;
}

export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  oldLineNo: number | null;
  newLineNo: number | null;
  text: string;
}

export interface RetrievalMatch {
  entry: KnowledgeEntry;
  folderName: string;
  score: number;
  reasons: string[];
}

export interface RepoMatch {
  file: RepoFile;
  score: number;
  reasons: string[];
}

export interface MemoryReadinessMetrics {
  entryCount: number;
  folderCount: number;
  substantiveCount: number;
  taggedCount: number;
  conversationTurns: number;
  repoFileCount: number;
  approvedSuggestions: number;
  reviewedSuggestions: number;
  selfAuditCount: number;
  readinessScore: number;
}
