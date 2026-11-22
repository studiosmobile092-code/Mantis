export type AreaId =
  | 'studio'
  | 'knowledge'
  | 'ingest'
  | 'github'
  | 'training'
  | 'export'
  | 'settings';

export type WorkspaceMode = 'train' | 'memory' | 'evals';
export type MemorySubView = 'knowledge' | 'capture' | 'repo';
export type EvalSubView = 'training' | 'export';
export type WorkspaceDrawer = 'none' | 'inspector' | 'settings';

export type StudioTabId = 'stream' | 'graph' | 'arena' | 'evals';

export type ComputeBackendKind = 'webgpu-vulkan' | 'webgpu' | 'worker-wasm' | 'main-thread';

export interface ComputeEngineStatus {
  backend: ComputeBackendKind;
  adapterLabel: string;
  workerActive: boolean;
  indexedVectorsCount: number;
  vectorBytesUsed: number;
  float32BytesSaved: number;
  lastComputeMs: number | null;
}

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
  | 'teacher_distilled'
  | 'dpo_logged'
  | 'eval_passed'
  | 'self_optimized'
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

export type KnowledgeStatus = 'raw' | 'reviewed' | 'trusted';
export type ThemeMode = 'dark' | 'dim' | 'light';
export type AccentColor = 'emerald' | 'blue' | 'violet' | 'amber' | 'rose';

export type SaveFeedbackState = 'idle' | 'saving' | 'saved' | 'queued' | 'failed';

export interface SaveFeedbackInfo {
  state: SaveFeedbackState;
  message: string;
  canRetry?: boolean;
}

export interface KnowledgeEntry {
  id: string;
  user_id: string;
  folder_id: string | null;
  title: string;
  content: string;
  tags: string[];
  source: string;
  status?: KnowledgeStatus;
  source_url?: string | null;
  extracted_at?: string | null;
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
  theme?: ThemeMode;
  accent_color?: AccentColor;
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
export type AuditCategory =
  | 'security'
  | 'accessibility'
  | 'reliability'
  | 'maintainability'
  | 'knowledge';

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
  bm25Score?: number;
  vectorScore?: number;
  rrfScore?: number;
}

export interface ContradictionAlert {
  newEntryId?: string;
  newTitle: string;
  newContent?: string;
  existingEntryId: string;
  existingTitle: string;
  existingContent?: string;
  existingFolder: string;
  existingStatus?: KnowledgeStatus;
  reason: string;
}

export interface CurriculumTopicGap {
  id: string;
  title: string;
  folderName: string;
  reason: 'uncovered' | 'low-usage' | 'eval-gap';
  suggestedPrompt: string;
  sourceEntryId?: string;
  sourceContent?: string;
}

export interface CurriculumTurn {
  userPrompt: string;
  idealResponse: string;
  takeaway: string;
}

export interface CurriculumDrillPacket {
  topicTitle: string;
  folderName: string;
  triggers: string[];
  responseVariants: string[];
  turns: CurriculumTurn[];
  evalPrompt: string;
  evalRequiredTerms: string[];
  modelUsed: string;
  usedTeacher: boolean;
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

export interface ScratchSkillRule {
  id: string;
  triggerType: 'exact' | 'pattern' | 'intent' | 'arithmetic';
  triggers: string[];
  responses: string[];
  folderName: string;
  tags: string[];
  learnedFrom: 'scratch' | 'teacher-distilled' | 'manual';
  confidence: number;
  usageCount: number;
  createdAt: string;
}

export interface TrainingSample {
  id: string;
  format: 'sft' | 'dpo';
  prompt: string;
  chosenResponse: string;
  rejectedResponse?: string;
  modelChosen: string;
  modelRejected?: string;
  rationale?: string;
  citedEntryIds: string[];
  verifiablePassed: boolean;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export interface EvalCase {
  id: string;
  title: string;
  prompt: string;
  requiredTerms: string[];
  forbiddenTerms: string[];
  requireCitation: boolean;
  requireSafeCode: boolean;
  category: 'recall' | 'reasoning' | 'coding' | 'security';
  createdAt: string;
}

export interface EvalCaseResult {
  caseId: string;
  title: string;
  passed: boolean;
  score: number;
  latencyMs: number;
  engineUsed: 'scratch' | 'cloud';
  responsePreview: string;
  failureReasons: string[];
}

export interface EvalRunSummary {
  id: string;
  runAt: string;
  engineMode: 'scratch' | 'cloud' | 'hybrid';
  totalCases: number;
  passedCases: number;
  passRate: number;
  avgLatencyMs: number;
  results: EvalCaseResult[];
}

export interface ResourceWasteItem {
  id: string;
  category: 'ram' | 'storage' | 'bundle' | 'duplicates';
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  estimatedBytesSaved: number;
  targetPath?: string;
  autoFixKind?: 'prune-duplicates' | 'compact-raw' | 'trim-chat-cache' | 'stage-code-opt';
}

export interface ResourceProfile {
  measuredAt: string;
  jsHeapUsedBytes: number | null;
  jsHeapLimitBytes: number | null;
  knowledgeBytes: number;
  vectorInt8Bytes: number;
  float32EquivalentBytes: number;
  repoBytes: number;
  duplicateClusterCount: number;
  staleRawCount: number;
  wasteItems: ResourceWasteItem[];
}

export interface ModelCardConfig {
  modelName: string;
  version: string;
  author: string;
  baseArchitecture: string;
  personaPrompt: string;
  tagline: string;
  temperature: number;
  includeOnlyTrusted: boolean;
}

export interface PortableBrainBundle {
  schema: 'mantis-brain-bundle/v1';
  exportedAt: string;
  modelCard: ModelCardConfig;
  evalSummary: {
    passRate: number | null;
    totalCases: number;
  };
  skills: ScratchSkillRule[];
  knowledge: Array<{
    id: string;
    title: string;
    content: string;
    folder: string;
    tags: string[];
    status: KnowledgeStatus;
    confidence: number;
    vectorInt8: number[];
    vectorScale: number;
  }>;
}

export interface AssassinPrepBrief {
  id: string;
  goal: string;
  matchedMemories: RetrievalMatch[];
  matchedFiles: RepoMatch[];
  proposedDiffs: Array<{
    filePath: string;
    title: string;
    rationale: string;
    originalContent: string;
    proposedContent: string;
  }>;
  verifierChecks: Array<{
    label: string;
    passed: boolean;
    detail: string;
  }>;
  prepLatencyMs: number;
  createdAt: string;
}

export interface SelfOptimizationProposal {
  id: string;
  kind: 'memory-prune' | 'code-opt';
  title: string;
  rationale: string;
  estimatedBytesSaved: number;
  targetPath: string;
  verifiedSafe: boolean;
  canApplyDirectly: boolean;
}

export type ExecutionIsolationMode =
  | 'student-strict'
  | 'hybrid-assist'
  | 'teacher-distill'
  | 'parallel-patch';

export type BpeMergePair = [string, string];

export interface BpeTokenizerState {
  vocab: string[];
  merges: BpeMergePair[];
}

export interface NeuralWeightMetrics {
  paramCount: number;
  vocabSize: number;
  hiddenDim: number;
  classCount: number;
  stepCount: number;
  lastLoss: number | null;
  firstLoss: number | null;
  lossHistory: number[];
  avgGradNorm: number;
  memoryBytes: number;
}

export interface NeuralPrototypeTarget {
  id: string;
  promptPattern: string;
  responseText: string;
  folderName: string;
  source: 'manual' | 'teacher-distilled' | 'sft' | 'dpo' | 'knowledge';
  entryId?: string;
  skillId?: string;
  trainedSteps: number;
  lastLoss: number;
}

export interface SerializedNeuralWeights {
  dims: {
    vocabSize: number;
    embDim: number;
    hiddenDim: number;
    classCount: number;
    loraRank: number;
  };
  embWeight: number[];
  w1: number[];
  b1: number[];
  w2: number[];
  b2: number[];
  loraA: number[];
  loraB: number[];
}

export interface NeuralCheckpoint {
  id: string;
  label: string;
  profileId: string;
  profileName: string;
  parentCheckpointId: string | null;
  createdAt: string;
  metrics: NeuralWeightMetrics;
  tokenizer: BpeTokenizerState;
  targets: NeuralPrototypeTarget[];
  weights: SerializedNeuralWeights;
}

export interface NeuralModelProfile {
  id: string;
  name: string;
  activeCheckpointId: string;
  createdAt: string;
  updatedAt: string;
}

export interface NeuralTrainingExample {
  prompt: string;
  response: string;
  folderName?: string;
  source?: NeuralPrototypeTarget['source'];
  entryId?: string;
  skillId?: string;
}

export interface NeuralTokenActivation {
  token: string;
  weight: number;
}

export interface NeuralPredictResult {
  replyText: string;
  confidence: number;
  entropy: number;
  lossEstimate: number | null;
  predictedTargetId: string | null;
  topTokens: NeuralTokenActivation[];
  isUntrained: boolean;
  checkpointId: string;
  isolationVerified: boolean;
}

export type LocalLlmTier = 'neural-core' | 'lightweight-8gb' | 'complex-high-ram';

export type LocalLlmRuntimeStatus =
  | 'idle'
  | 'probing'
  | 'downloading'
  | 'loading'
  | 'ready'
  | 'unloading'
  | 'error';

export interface LocalLlmModelSpec {
  id: string;
  label: string;
  shortLabel: string;
  hfRepoId: string;
  tier: LocalLlmTier;
  dtype: 'q4' | 'q4f16' | 'q8' | 'fp16';
  estimatedRamMb: number;
  minRecommendedRamGb: number;
  contextWindow: number;
  capabilities: string;
  safety8Gb: 'safe' | 'caution' | 'high-ram';
  colabBaseModel: string;
}

export interface HardwareTelemetry {
  deviceMemoryGb: number | null;
  hardwareConcurrency: number;
  jsHeapUsedMb: number | null;
  jsHeapLimitMb: number | null;
  webGpuSupported: boolean;
  webGpuF16Supported: boolean;
  maxBufferSizeMb: number | null;
  adapterLabel: string;
  is8GbSafeHeadroom: boolean;
  recommendedTier: LocalLlmTier;
}

export interface LocalLlmEngineState {
  status: LocalLlmRuntimeStatus;
  selectedModelId: string;
  loadedModelId: string | null;
  activeDevice: 'webgpu' | 'wasm' | null;
  activeDtype: string | null;
  loadProgressPercent: number;
  loadStatusText: string;
  downloadedBytes: number;
  totalBytes: number;
  lastTokensPerSec: number | null;
  lastGeneratedTokens: number;
  error: string | null;
  memoryPressureWarning: string | null;
  isGenerating: boolean;
}

export interface LocalLlmAdapterSpec {
  checkpointId: string;
  profileName: string;
  modelId: string;
  colabBaseModel: string;
  stepCount: number;
  vocabSize: number;
  trustedRulesUsed: number;
  neuralTargetsInjected: number;
  systemPrompt: string;
  biasTerms: string[];
}

export interface ChatTurnTelemetry {
  checkpointId: string;
  confidence: number;
  lossEstimate: number | null;
  topTokens: NeuralTokenActivation[];
  isolationMode: 'student-strict' | 'local-llm' | 'cloud-assist' | 'teacher-distill' | 'tool';
  cloudCalls: number;
  isUntrained: boolean;
  tokensPerSec?: number | null;
  localModelId?: string | null;
}


