import {
  Copy,
  FileCode2,
  Folder,
  Moon,
  Play,
  RefreshCw,
  RotateCcw,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {getLocalLlmSpec} from '../lib/localLlmEngine';
import type {
  BrainRouteStatus,
  ComputeEngineStatus,
  GitHubConnection,
  HardwareTelemetry,
  KnowledgeEntry,
  KnowledgeFolder,
  KnowledgeGrowthStats,
  LearningEvent,
  LocalLlmEngineState,
  NeuralCheckpoint,
  RepoFile,
  ThemeMode,
} from '../types/mantis';
import {LossSparkline} from './LossSparkline';

interface InspectorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  routeStatus: BrainRouteStatus;
  computeStatus: ComputeEngineStatus;
  localLlmState: LocalLlmEngineState;
  hardwareTelemetry: HardwareTelemetry | null;
  onLoadLocalLlm: (modelId?: string, allowOverride?: boolean) => Promise<void>;
  onUnloadLocalLlm: () => Promise<void>;
  onCancelLocalLlmLoad: () => void;
  onOpenLocalModels: () => void;
  modelName: string;
  activeCheckpoint: NeuralCheckpoint;
  checkpoints: NeuralCheckpoint[];
  isTrainingNeural: boolean;
  isStudentIsolated: boolean;
  onTrainNeuralBatch: () => Promise<void>;
  onRollbackCheckpoint: (checkpointId: string) => Promise<void>;
  onCloneCheckpoint: (checkpointId: string) => Promise<void>;
  onResetBlankSlate: () => Promise<void>;
  entries: KnowledgeEntry[];
  folders: KnowledgeFolder[];
  growth: KnowledgeGrowthStats;
  skillsCount: number;
  connection: GitHubConnection | null;
  repoFiles: RepoFile[];
  learningEvents: LearningEvent[];
  pendingOfflineCount: number;
  isOnline: boolean;
  isSyncing: boolean;
  theme: ThemeMode;
  onCycleTheme: () => void;
  onSync: () => void;
  onOpenSettings: () => void;
  onOpenTeach: () => void;
  onSelectFolder: (folderId: string) => void;
  onQueryConcept: (conceptLabel: string) => void;
  onInspectRepoFile: (filePath: string) => void;
  latestEvalPassRate?: number | null;
  enabledPrinciplesCount?: number;
}

function formatRouteLabel(routeStatus: BrainRouteStatus): string {
  switch (routeStatus.activeKind) {
    case 'primary-worker':
      return 'Worker Proxy';
    case 'backup-supabase':
      return 'Edge Backup';
    case 'ollama-direct':
      return 'Ollama Local';
    default:
      return 'Local Only';
  }
}

function formatEventKind(kind: LearningEvent['kind']): string {
  switch (kind) {
    case 'auto_mined':
      return 'Mined';
    case 'url_ingested':
      return 'Link';
    case 'voice_captured':
      return 'Voice';
    case 'ocr_distilled':
      return 'OCR';
    case 'reinforced':
      return 'Boost';
    case 'cloud_assisted':
      return 'Teacher';
    case 'teacher_distilled':
      return 'Distill';
    case 'dpo_logged':
      return 'Preference';
    case 'eval_passed':
      return 'Eval';
    case 'self_optimized':
      return 'Optimize';
    case 'repo_indexed':
      return 'Repo';
    default:
      return 'Taught';
  }
}

export function InspectorDrawer({
  isOpen,
  onClose,
  routeStatus,
  computeStatus,
  localLlmState,
  hardwareTelemetry,
  onLoadLocalLlm,
  onUnloadLocalLlm,
  onCancelLocalLlmLoad,
  onOpenLocalModels,
  modelName,
  activeCheckpoint,
  checkpoints,
  isTrainingNeural,
  isStudentIsolated,
  onTrainNeuralBatch,
  onRollbackCheckpoint,
  onCloneCheckpoint,
  onResetBlankSlate,
  entries,
  folders,
  growth,
  skillsCount,
  connection,
  repoFiles,
  learningEvents,
  pendingOfflineCount,
  isOnline,
  isSyncing,
  theme,
  onCycleTheme,
  onSync,
  onOpenSettings,
  onOpenTeach,
  onSelectFolder,
  onQueryConcept,
  onInspectRepoFile,
  latestEvalPassRate = null,
  enabledPrinciplesCount = 0,
}: InspectorDrawerProps) {
  const [confirmResetBlank, setConfirmResetBlank] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const folderCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) {
      if (entry.folder_id) {
        map.set(entry.folder_id, (map.get(entry.folder_id) || 0) + 1);
      }
    }
    return map;
  }, [entries]);

  const trustCounts = useMemo(() => {
    let trusted = 0;
    let reviewed = 0;
    let raw = 0;
    for (const e of entries) {
      const s = e.status || 'reviewed';
      if (s === 'trusted') trusted += 1;
      else if (s === 'raw') raw += 1;
      else reviewed += 1;
    }
    return {trusted, reviewed, raw};
  }, [entries]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Workspace Inspector"
      className="mantis-fade-in fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <aside
        className="mantis-drawer-in flex h-full w-full max-w-[390px] flex-col border-l border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
          <div className="min-w-0">
            <span className="text-xs font-semibold text-ink">Workspace Inspector</span>
            <span aria-hidden="true" className="mx-1.5 text-ink-subtle">
              ·
            </span>
            <span className="font-mono text-xs text-ink-muted">{modelName}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector drawer"
            className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-md text-ink-muted hover:bg-elevated hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Quick Action Strip */}
        <div className="grid shrink-0 grid-cols-3 gap-2 border-b border-line bg-inset px-4 py-2.5">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenSettings();
            }}
            className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-ink transition-colors hover:border-line-strong"
          >
            <Settings className="h-3.5 w-3.5 text-ink-muted" />
            <span>Settings</span>
          </button>

          <button
            type="button"
            onClick={onSync}
            disabled={isSyncing}
            className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-ink transition-colors hover:border-line-strong disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-ink-muted ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Syncing' : 'Sync'}</span>
          </button>

          <button
            type="button"
            onClick={onCycleTheme}
            className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-ink transition-colors hover:border-line-strong"
          >
            {theme === 'light' ? (
              <Sun className="h-3.5 w-3.5 text-ink-muted" />
            ) : (
              <Moon className="h-3.5 w-3.5 text-ink-muted" />
            )}
            <span className="capitalize">{theme}</span>
          </button>
        </div>

        {/* Single Scrollable Inspector Body */}
        <div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto px-4">
          {/* Runtime Telemetry (Factual Only, Tabular) */}
          <section className="space-y-2.5 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-ink">Runtime &amp; Storage</h2>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenTeach();
                }}
                className="text-xs font-medium text-accent-text hover:underline"
              >
                + Teach Rule
              </button>
            </div>

            <dl className="space-y-1.5 font-mono text-xs tabular-nums">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-muted">Isolation Gate</dt>
                <dd className={isStudentIsolated ? 'text-accent-text' : 'text-ink'}>
                  {isStudentIsolated ? 'Student Strict (0 Cloud)' : formatRouteLabel(routeStatus)}
                  {!isStudentIsolated && routeStatus.latencyMs !== null
                    ? ` · ${routeStatus.latencyMs} ms`
                    : ''}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-muted">Compute Backend</dt>
                <dd className="text-ink">{computeStatus.adapterLabel}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-muted">Int8 Index</dt>
                <dd className="text-ink">
                  {computeStatus.indexedVectorsCount} vecs ·{' '}
                  {Math.round(computeStatus.vectorBytesUsed / 1024)} KB
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-muted">Memory Breakdown</dt>
                <dd className="text-ink">
                  {trustCounts.trusted} trusted / {trustCounts.reviewed} reviewed /{' '}
                  {trustCounts.raw} raw
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-muted">Trained Skills</dt>
                <dd className="text-ink">
                  {skillsCount} skills · {growth.uniqueConcepts} concepts
                </dd>
              </div>
            </dl>

            {(!isOnline || pendingOfflineCount > 0) && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-warn-border bg-warn-soft px-3 py-2 text-xs">
                <span className="text-warn">
                  {!isOnline
                    ? 'Offline — changes queued locally'
                    : `${pendingOfflineCount} offline writes queued`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenSettings();
                  }}
                  className="font-semibold text-ink underline underline-offset-2"
                >
                  Inspect
                </button>
              </div>
            )}
          </section>

          {/* Neural Student Weights, Loss Curve & Checkpoint Rollback */}
          <section className="space-y-3 py-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold text-ink">Neural Student &amp; Checkpoints</h2>
              <span className="font-mono text-[11px] tabular-nums text-accent-text">
                {activeCheckpoint.id}
              </span>
            </div>

            <LossSparkline
              history={activeCheckpoint.metrics.lossHistory}
              label="AdamW Loss Curve"
            />

            <dl className="space-y-1 font-mono text-xs tabular-nums">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-muted">Profile</dt>
                <dd className="truncate text-ink">{activeCheckpoint.profileName}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-muted">Steps · Targets</dt>
                <dd className="text-ink">
                  {activeCheckpoint.metrics.stepCount} steps · {activeCheckpoint.targets.length}{' '}
                  targets
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-muted">BPE Vocabulary</dt>
                <dd className="text-ink">
                  {activeCheckpoint.metrics.vocabSize} tokens (
                  {activeCheckpoint.tokenizer.merges.length} merges)
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-muted">Weight Footprint</dt>
                <dd className="text-ink">
                  {activeCheckpoint.metrics.paramCount.toLocaleString()} params ·{' '}
                  {Math.round(activeCheckpoint.metrics.memoryBytes / 1024)} KB
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-muted">Last Loss · Grad</dt>
                <dd className="text-ink">
                  {activeCheckpoint.metrics.lastLoss !== null
                    ? `${activeCheckpoint.metrics.lastLoss.toFixed(3)} · |∇| ${activeCheckpoint.metrics.avgGradNorm.toFixed(2)}`
                    : 'Untrained (0 steps)'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-muted">Blind Eval · Rules</dt>
                <dd className="text-ink">
                  {latestEvalPassRate !== null ? `${latestEvalPassRate}% pass` : 'Not run'} ·{' '}
                  {enabledPrinciplesCount} rules
                </dd>
              </div>
            </dl>

            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                disabled={isTrainingNeural}
                onClick={() => void onTrainNeuralBatch()}
                className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-md bg-accent px-2 text-xs font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                <Play className="h-3 w-3" />
                <span>{isTrainingNeural ? 'Training…' : 'Train'}</span>
              </button>
              <button
                type="button"
                disabled={isTrainingNeural}
                onClick={() => void onCloneCheckpoint(activeCheckpoint.id)}
                className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-md border border-line bg-inset px-2 text-xs font-medium text-ink hover:border-line-strong disabled:opacity-50"
              >
                <Copy className="h-3 w-3 text-ink-muted" />
                <span>Clone</span>
              </button>
              {confirmResetBlank ? (
                <button
                  type="button"
                  disabled={isTrainingNeural}
                  onClick={async () => {
                    await onResetBlankSlate();
                    setConfirmResetBlank(false);
                  }}
                  className="inline-flex min-h-[40px] items-center justify-center rounded-md bg-red-600 px-2 text-xs font-semibold text-white hover:bg-red-500"
                >
                  Confirm 0
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isTrainingNeural}
                  onClick={() => setConfirmResetBlank(true)}
                  className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-md border border-line bg-inset px-2 text-xs font-medium text-ink-muted hover:border-line-strong hover:text-ink"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Reset 0</span>
                </button>
              )}
            </div>

            {checkpoints.length > 0 && (
              <div className="divide-y divide-line border-t border-line pt-1">
                {checkpoints.slice(0, 6).map((ckpt) => {
                  const isCurrent = ckpt.id === activeCheckpoint.id;
                  return (
                    <div
                      key={ckpt.id}
                      className="flex items-center justify-between gap-2 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 font-mono text-[11px]">
                          <span className={isCurrent ? 'font-semibold text-accent-text' : 'text-ink'}>
                            {ckpt.id}
                          </span>
                          <span className="text-ink-subtle">·</span>
                          <span className="tabular-nums text-ink-muted">
                            {ckpt.metrics.stepCount} stp
                          </span>
                          {ckpt.metrics.lastLoss !== null && (
                            <>
                              <span className="text-ink-subtle">·</span>
                              <span className="tabular-nums text-ink-muted">
                                L {ckpt.metrics.lastLoss.toFixed(2)}
                              </span>
                            </>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-ink-subtle">{ckpt.label}</div>
                      </div>
                      {isCurrent ? (
                        <span className="shrink-0 font-mono text-[11px] font-semibold text-accent-text">
                          Active
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void onRollbackCheckpoint(ckpt.id)}
                          className="min-h-[36px] shrink-0 rounded border border-line bg-inset px-2.5 text-[11px] font-medium text-ink hover:border-line-strong"
                        >
                          Rollback
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Local Q4 / High-Capacity Runtime & 8 GB Hardware Telemetry */}
          <section className="space-y-2.5 py-4">
            {(() => {
              const selectedSpec = getLocalLlmSpec(localLlmState.selectedModelId);
              const isBusy =
                localLlmState.status === 'downloading' ||
                localLlmState.status === 'loading' ||
                localLlmState.status === 'probing';
              const isLoaded =
                localLlmState.status === 'ready' && localLlmState.loadedModelId !== null;
              return (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-xs font-semibold text-ink">Local Q4 LLM &amp; Hardware</h2>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenLocalModels();
                      }}
                      className="text-xs font-medium text-accent-text hover:underline"
                    >
                      Manage Models
                    </button>
                  </div>

                  <dl className="space-y-1 font-mono text-xs tabular-nums">
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-ink-muted">Selected Q4</dt>
                      <dd className="truncate text-ink">
                        {selectedSpec.shortLabel} (~{selectedSpec.estimatedRamMb} MB)
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-ink-muted">Device RAM · GPU</dt>
                      <dd className="text-ink">
                        {hardwareTelemetry?.deviceMemoryGb
                          ? `~${hardwareTelemetry.deviceMemoryGb} GB`
                          : 'RAM N/A'}{' '}
                        ·{' '}
                        {hardwareTelemetry?.webGpuSupported
                          ? hardwareTelemetry.webGpuF16Supported
                            ? 'WebGPU f16'
                            : 'WebGPU'
                          : 'WASM'}
                      </dd>
                    </div>
                    {hardwareTelemetry?.jsHeapUsedMb !== null &&
                      hardwareTelemetry?.jsHeapUsedMb !== undefined && (
                        <div className="flex items-center justify-between gap-2">
                          <dt className="text-ink-muted">JS Heap</dt>
                          <dd className="text-ink">
                            {hardwareTelemetry.jsHeapUsedMb}
                            {hardwareTelemetry.jsHeapLimitMb
                              ? ` / ${hardwareTelemetry.jsHeapLimitMb} MB`
                              : ' MB'}
                          </dd>
                        </div>
                      )}
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-ink-muted">Runtime Status</dt>
                      <dd className={isLoaded ? 'text-accent-text' : 'text-ink-muted'}>
                        {isLoaded
                          ? `Ready (${localLlmState.activeDevice?.toUpperCase()} · ${localLlmState.activeDtype})`
                          : localLlmState.loadStatusText}
                      </dd>
                    </div>
                    {localLlmState.lastTokensPerSec !== null && (
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-ink-muted">Speed</dt>
                        <dd className="text-accent-text">
                          {localLlmState.lastTokensPerSec.toFixed(1)} tok/s ({localLlmState.lastGeneratedTokens}t)
                        </dd>
                      </div>
                    )}
                  </dl>

                  {isBusy && (
                    <div className="space-y-1.5 rounded border border-line bg-inset p-2.5">
                      <div className="flex items-center justify-between font-mono text-[11px] tabular-nums text-ink-muted">
                        <span className="truncate">{localLlmState.loadStatusText}</span>
                        <span>{localLlmState.loadProgressPercent}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-elevated">
                        <div
                          className="h-full bg-accent transition-all"
                          style={{width: `${localLlmState.loadProgressPercent}%`}}
                        />
                      </div>
                    </div>
                  )}

                  {localLlmState.error && (
                    <div className="rounded border border-danger-border bg-danger-soft px-2.5 py-2 font-mono text-[11px] text-danger">
                      {localLlmState.error}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-1.5">
                    {isBusy ? (
                      <button
                        type="button"
                        onClick={onCancelLocalLlmLoad}
                        className="col-span-2 min-h-[40px] rounded-md border border-line-strong bg-inset px-3 text-xs font-medium text-ink hover:text-danger"
                      >
                        Cancel Download / Load
                      </button>
                    ) : isLoaded ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenLocalModels();
                          }}
                          className="min-h-[40px] rounded-md border border-line bg-inset px-2.5 text-xs font-medium text-ink hover:border-line-strong"
                        >
                          Switch Tier
                        </button>
                        <button
                          type="button"
                          onClick={() => void onUnloadLocalLlm()}
                          className="min-h-[40px] rounded-md border border-line bg-inset px-2.5 text-xs font-medium text-ink-muted hover:border-danger-border hover:text-danger"
                        >
                          Unload RAM
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void onLoadLocalLlm(localLlmState.selectedModelId, false)}
                        className="col-span-2 min-h-[40px] rounded-md bg-accent px-3 text-xs font-semibold text-white hover:bg-accent-hover"
                      >
                        Load {selectedSpec.shortLabel}
                      </button>
                    )}
                  </div>
                </>
              );
            })()}
          </section>

          {/* Knowledge Folders */}
          <section className="space-y-2 py-4">
            <div className="flex items-center justify-between text-xs">
              <h2 className="font-semibold text-ink">Knowledge Folders</h2>
              <span className="font-mono text-ink-subtle tabular-nums">{entries.length}</span>
            </div>
            <div className="space-y-0.5">
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => {
                    onSelectFolder(folder.id);
                    onClose();
                  }}
                  className="flex min-h-[40px] w-full items-center justify-between gap-2 rounded-md px-2 text-left text-xs text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Folder className="h-3.5 w-3.5 shrink-0 text-accent-text" />
                    <span className="truncate">{folder.name}</span>
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-ink-subtle">
                    {folderCounts.get(folder.id) || 0}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* Indexed Concepts */}
          {growth.topConcepts.length > 0 && (
            <section className="space-y-2 py-4">
              <div className="flex items-center justify-between text-xs">
                <h2 className="font-semibold text-ink">Active Concepts</h2>
                <span className="font-mono text-ink-subtle tabular-nums">
                  {growth.uniqueConcepts}
                </span>
              </div>
              <div className="divide-y divide-line">
                {growth.topConcepts.slice(0, 6).map((concept) => (
                  <button
                    key={concept.label}
                    type="button"
                    onClick={() => {
                      onQueryConcept(concept.label);
                      onClose();
                    }}
                    className="flex min-h-[40px] w-full items-center justify-between gap-2 px-1 text-left font-mono text-xs text-ink-muted transition-colors hover:text-accent-text"
                  >
                    <span className="truncate">#{concept.label}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-ink-subtle">
                      {concept.count} notes
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Repository Quick Access */}
          {connection && repoFiles.length > 0 && (
            <section className="space-y-2 py-4">
              <div className="flex items-center justify-between text-xs">
                <h2 className="font-semibold text-ink">
                  {connection.owner}/{connection.repo}
                </h2>
                <span className="font-mono text-ink-subtle tabular-nums">{repoFiles.length}</span>
              </div>
              <div className="space-y-0.5">
                {repoFiles.slice(0, 10).map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => {
                      onInspectRepoFile(file.path);
                      onClose();
                    }}
                    className="flex min-h-[40px] w-full items-center gap-2 rounded-md px-2 text-left font-mono text-[11px] text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
                  >
                    <FileCode2 className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                    <span className="truncate">{file.path}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Recent Training & Ingestion Activity (Unboxed Typographic Timeline) */}
          <section className="space-y-2 py-4">
            <div className="flex items-center justify-between text-xs">
              <h2 className="font-semibold text-ink">Recent Session Events</h2>
              <span className="font-mono text-ink-subtle tabular-nums">
                {learningEvents.length}
              </span>
            </div>
            {learningEvents.length === 0 ? (
              <p className="text-xs text-ink-subtle">
                Training runs, extractions, and preference logs appear here during your session.
              </p>
            ) : (
              <div className="divide-y divide-line">
                {learningEvents.slice(0, 10).map((ev) => (
                  <div key={ev.id} className="py-2 text-xs">
                    <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-ink-subtle">
                      <span className="text-accent-text">{formatEventKind(ev.kind)}</span>
                      <span className="tabular-nums">
                        {new Date(ev.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate font-medium text-ink">{ev.title}</div>
                    {ev.detail && (
                      <div className="mt-0.5 truncate text-[11px] text-ink-muted">{ev.detail}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
