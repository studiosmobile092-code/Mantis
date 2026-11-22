import {
  Activity,
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Edit3,
  FlaskConical,
  Gauge,
  GraduationCap,
  Layers,
  Play,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  Scale,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  XCircle,
} from 'lucide-react';
import {type FormEvent, useEffect, useMemo, useState} from 'react';
import {
  generateCurriculumDrillWithTeacher,
  runArenaDuelWithBrain,
} from '../lib/aiBrain';
import {
  LOCAL_LLM_CATALOG,
  buildAdapterConditionedMessages,
  evaluateModelMemorySafety,
  generateWithLocalLlmStream,
  getLocalLlmSpec,
} from '../lib/localLlmEngine';
import {computeKnowledgeGrowth} from '../lib/mantisBrain';
import {buildTrainingExamplesFromWorkspace} from '../lib/neuralStudent';
import {
  analyzeCurriculumCoverage,
  synthesizeScratchWithHybrid,
  upsertScratchSkill,
} from '../lib/scratchEngine';
import {
  addEvalCase,
  addTrainingSample,
  buildSelfOptimizationProposals,
  deleteEvalCase,
  deleteTrainingSample,
  executeEvalSuite,
  updateTrainingSample,
} from '../lib/trainingStore';
import {
  inferNeuralStudentAsync,
  profileWorkspaceResourcesAsync,
  runHybridRetrievalAsync,
} from '../lib/workerClient';
import type {
  ComputeEngineStatus,
  CurriculumDrillPacket,
  EvalCase,
  EvalRunSummary,
  HardwareTelemetry,
  KnowledgeEntry,
  KnowledgeFolder,
  LocalLlmAdapterSpec,
  LocalLlmEngineState,
  NeuralCheckpoint,
  RepoFile,
  ResourceProfile,
  ScratchSkillRule,
  TrainingSample,
} from '../types/mantis';
import {LossSparkline} from './LossSparkline';

interface TrainingPanelProps {
  entries: KnowledgeEntry[];
  folders: KnowledgeFolder[];
  repoFiles: RepoFile[];
  repoLabel: string | null;
  messagesCountBytes: number;
  computeStatus: ComputeEngineStatus;
  brainUrl: string;
  backupBrainUrl?: string;
  brainModel: string;
  accessToken: string;
  activeCheckpoint: NeuralCheckpoint;
  checkpoints: NeuralCheckpoint[];
  isTrainingNeural: boolean;
  onTrainNeuralBatch: (epochs?: number) => Promise<{
    checkpointId: string;
    firstLoss: number;
    lastLoss: number;
    stepsAdded: number;
  } | null>;
  onRollbackCheckpoint: (checkpointId: string) => Promise<void>;
  onCloneCheckpoint: (checkpointId: string, profileName?: string) => Promise<void>;
  onResetBlankSlate: () => Promise<void>;
  trainingSamples: TrainingSample[];
  onChangeTrainingSamples: (next: TrainingSample[]) => void;
  scratchSkills: ScratchSkillRule[];
  onChangeScratchSkills: (next: ScratchSkillRule[]) => void;
  onUpdateScratchSkill: (
    skillId: string,
    patch: Partial<Pick<ScratchSkillRule, 'triggers' | 'responses' | 'folderName'>>,
  ) => void;
  onDeleteScratchSkill: (skillId: string) => void;
  evalCases: EvalCase[];
  onChangeEvalCases: (next: EvalCase[]) => void;
  evalRuns: EvalRunSummary[];
  onAddEvalRun: (run: EvalRunSummary) => void;
  onApplyMemoryOptimize: (kind: 'prune-duplicates' | 'compact-raw') => Promise<number>;
  onStageCodeOptimize: (filePath: string, title: string, goal: string) => Promise<void>;
  onCloudAsk?: (prompt: string) => Promise<{replyText: string; citedEntryIds: string[]}>;
  arenaInitialPrompt?: string;
  onConsumeArenaPrompt?: () => void;
  localLlmState: LocalLlmEngineState;
  hardwareTelemetry: HardwareTelemetry | null;
  onRefreshHardware: () => Promise<void>;
  onSelectLocalLlm: (modelId: string) => void;
  onLoadLocalLlm: (modelId?: string, allowHighRamOverride?: boolean) => Promise<void>;
  onUnloadLocalLlm: () => Promise<void>;
  onCancelLocalLlmLoad: () => void;
  onClearLocalLlmCache: () => Promise<boolean>;
  onStopLocalLlmGeneration: () => void;
  openLocalModelsSignal?: number;
}

type TrainingTab =
  | 'neural'
  | 'models'
  | 'arena'
  | 'curriculum'
  | 'dataset'
  | 'evals'
  | 'profiler';

function formatKb(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return 'N/A';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function TrainingPanel({
  entries,
  folders,
  repoFiles,
  repoLabel,
  messagesCountBytes,
  computeStatus,
  brainUrl,
  backupBrainUrl,
  brainModel,
  accessToken,
  activeCheckpoint,
  checkpoints,
  isTrainingNeural,
  onTrainNeuralBatch,
  onRollbackCheckpoint,
  onCloneCheckpoint,
  onResetBlankSlate,
  trainingSamples,
  onChangeTrainingSamples,
  scratchSkills,
  onChangeScratchSkills,
  onUpdateScratchSkill,
  onDeleteScratchSkill,
  evalCases,
  onChangeEvalCases,
  evalRuns,
  onAddEvalRun,
  onApplyMemoryOptimize,
  onStageCodeOptimize,
  onCloudAsk,
  arenaInitialPrompt,
  onConsumeArenaPrompt,
  localLlmState,
  hardwareTelemetry,
  onRefreshHardware,
  onSelectLocalLlm,
  onLoadLocalLlm,
  onUnloadLocalLlm,
  onCancelLocalLlmLoad,
  onClearLocalLlmCache,
  onStopLocalLlmGeneration,
  openLocalModelsSignal,
}: TrainingPanelProps) {
  const [activeTab, setActiveTab] = useState<TrainingTab>('neural');
  const [batchEpochs, setBatchEpochs] = useState<number>(20);
  const [neuralFeedback, setNeuralFeedback] = useState<string | null>(null);
  const [cloneNameInput, setCloneNameInput] = useState<string>('');
  const [confirmResetZero, setConfirmResetZero] = useState<boolean>(false);

  // Local Q4 Models & Adapter Bridge State
  const [allowHighRamOverride, setAllowHighRamOverride] = useState(false);
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);
  const [benchPrompt, setBenchPrompt] = useState(
    'Summarize what this student checkpoint has been taught so far.',
  );
  const [benchOutput, setBenchOutput] = useState('');
  const [benchTelemetry, setBenchTelemetry] = useState<{
    tps: number | null;
    tokens: number;
    durationMs: number;
    device: string;
  } | null>(null);
  const [benchError, setBenchError] = useState<string | null>(null);
  const [adapterPreview, setAdapterPreview] = useState<LocalLlmAdapterSpec | null>(null);

  // DPO Arena State
  const [arenaPrompt, setArenaPrompt] = useState('');
  const [isGeneratingDuel, setIsGeneratingDuel] = useState(false);
  const [duelResult, setDuelResult] = useState<{
    prompt: string;
    a: {label: string; text: string};
    b: {label: string; text: string};
    citedEntryIds: string[];
  } | null>(null);
  const [duelFeedback, setDuelFeedback] = useState<string | null>(null);

  // Curriculum Drills State
  const [customDrillTopic, setCustomDrillTopic] = useState('');
  const [isDrilling, setIsDrilling] = useState(false);
  const [activeDrill, setActiveDrill] = useState<CurriculumDrillPacket | null>(null);
  const [drillFeedback, setDrillFeedback] = useState<string | null>(null);

  // Scratch Skill Inline Editor State
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [editTriggersText, setEditTriggersText] = useState('');
  const [editResponsesText, setEditResponsesText] = useState('');
  const [editFolderText, setEditFolderText] = useState('');

  // Eval Bench State
  const [evalMode, setEvalMode] = useState<'scratch' | 'hybrid' | 'cloud'>('scratch');
  const [isRunningEval, setIsRunningEval] = useState(false);
  const [newCaseTitle, setNewCaseTitle] = useState('');
  const [newCasePrompt, setNewCasePrompt] = useState('');
  const [newCaseRequired, setNewCaseRequired] = useState('');

  // Resource Profiler State
  const [profile, setProfile] = useState<ResourceProfile | null>(null);
  const [isProfiling, setIsProfiling] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [optMessage, setOptMessage] = useState<string | null>(null);

  const curriculumCoverage = useMemo(
    () => analyzeCurriculumCoverage(entries, folders, scratchSkills, evalCases),
    [entries, folders, scratchSkills, evalCases],
  );

  const readyBatchExamples = useMemo(
    () =>
      buildTrainingExamplesFromWorkspace({
        trainingSamples,
        scratchSkills,
        entries,
        folders,
      }),
    [trainingSamples, scratchSkills, entries, folders],
  );

  useEffect(() => {
    if (arenaInitialPrompt) {
      setActiveTab('arena');
      setArenaPrompt(arenaInitialPrompt);
      onConsumeArenaPrompt?.();
    }
  }, [arenaInitialPrompt, onConsumeArenaPrompt]);

  useEffect(() => {
    if (openLocalModelsSignal && openLocalModelsSignal > 0) {
      setActiveTab('models');
    }
  }, [openLocalModelsSignal]);

  useEffect(() => {
    if (activeTab !== 'models') return;
    let cancelled = false;
    void Promise.all([
      runHybridRetrievalAsync({
        query: benchPrompt || 'architecture rules',
        entries,
        folders,
        limit: 4,
      }),
      inferNeuralStudentAsync(benchPrompt || 'hi', activeCheckpoint),
    ])
      .then(([hybridMatches, neuralPrediction]) => {
        if (cancelled) return;
        const built = buildAdapterConditionedMessages({
          prompt: benchPrompt || 'hi',
          checkpoint: activeCheckpoint,
          hybridMatches,
          folders,
          skills: scratchSkills,
          neuralPrediction,
          modelId: localLlmState.loadedModelId || localLlmState.selectedModelId,
        });
        setAdapterPreview(built.adapterSpec);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    benchPrompt,
    activeCheckpoint,
    entries,
    folders,
    scratchSkills,
    localLlmState.loadedModelId,
    localLlmState.selectedModelId,
  ]);

  async function refreshProfile() {
    setIsProfiling(true);
    setProfileError(null);
    try {
      const next = await profileWorkspaceResourcesAsync({
        entries,
        repoFiles,
        messagesCountBytes,
      });
      setProfile(next);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Unable to profile workspace RAM.');
    } finally {
      setIsProfiling(false);
    }
  }

  useEffect(() => {
    if (activeTab === 'profiler') {
      void refreshProfile();
    }
  }, [activeTab, entries.length, repoFiles.length]);

  async function handleRunDuel(event: FormEvent) {
    event.preventDefault();
    const q = arenaPrompt.trim();
    if (!q || isGeneratingDuel) return;
    setIsGeneratingDuel(true);
    setDuelFeedback(null);
    try {
      const hybrid = await runHybridRetrievalAsync({
        query: q,
        entries,
        folders,
        limit: 4,
      });
      const scratch = synthesizeScratchWithHybrid({
        prompt: q,
        hybridMatches: hybrid,
        entries,
        folders,
        repoFiles,
        repoLabel,
        growth: computeKnowledgeGrowth(entries),
        recordUsage: false,
      });
      const duel = await runArenaDuelWithBrain({
        brainUrl,
        backupBrainUrl,
        accessToken,
        model: brainModel,
        prompt: q,
        scratchCandidate: scratch.replyText,
        entries,
        folders,
        repoFiles,
      });
      setDuelResult({
        prompt: q,
        a: duel.candidateA,
        b: duel.candidateB,
        citedEntryIds: Array.from(new Set([...scratch.citedEntryIds, ...duel.citedEntryIds])),
      });
    } finally {
      setIsGeneratingDuel(false);
    }
  }

  function handlePickWinner(winner: 'A' | 'B') {
    if (!duelResult) return;
    const chosen = winner === 'A' ? duelResult.a : duelResult.b;
    const rejected = winner === 'A' ? duelResult.b : duelResult.a;
    const next = addTrainingSample({
      format: 'dpo',
      prompt: duelResult.prompt,
      chosenResponse: chosen.text,
      rejectedResponse: rejected.text,
      modelChosen: chosen.label,
      modelRejected: rejected.label,
      rationale: `Human preference selection (${winner} preferred over ${winner === 'A' ? 'B' : 'A'})`,
      citedEntryIds: duelResult.citedEntryIds,
      status: 'approved',
    });
    onChangeTrainingSamples(next);
    setDuelFeedback(`Logged DPO pair: "${chosen.label}" saved as chosen preference (secrets redacted).`);
  }

  async function handleRunEvalSuite() {
    if (isRunningEval || evalCases.length === 0) return;
    setIsRunningEval(true);
    try {
      const summary = await executeEvalSuite({
        cases: evalCases,
        entries,
        folders,
        repoFiles,
        repoLabel,
        cloudResponder: onCloudAsk,
        mode: evalMode,
        activeCheckpoint,
      });
      onAddEvalRun(summary);
    } finally {
      setIsRunningEval(false);
    }
  }

  function handleAddEvalCase(event: FormEvent) {
    event.preventDefault();
    if (!newCaseTitle.trim() || !newCasePrompt.trim()) return;
    const next = addEvalCase({
      title: newCaseTitle.trim(),
      prompt: newCasePrompt.trim(),
      requiredTerms: newCaseRequired
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      forbiddenTerms: ['undefined', 'sb_secret_', 'hf_'],
      requireCitation: false,
      requireSafeCode: true,
      category: 'coding',
    });
    onChangeEvalCases(next);
    setNewCaseTitle('');
    setNewCasePrompt('');
    setNewCaseRequired('');
  }

  async function handleRunCurriculumDrill(params: {
    topicTitle: string;
    folderName: string;
    sourceContent?: string;
  }) {
    if (!params.topicTitle.trim() || isDrilling) return;
    setIsDrilling(true);
    setDrillFeedback(null);
    try {
      const packet = await generateCurriculumDrillWithTeacher({
        brainUrl,
        backupBrainUrl,
        accessToken,
        model: brainModel,
        topicTitle: params.topicTitle,
        folderName: params.folderName,
        sourceContent: params.sourceContent,
        entries,
        folders,
      });
      setActiveDrill(packet);
    } finally {
      setIsDrilling(false);
    }
  }

  function handleCommitCurriculumDrill(packet: CurriculumDrillPacket, addEval: boolean) {
    const updatedSkills = upsertScratchSkill({
      triggerType: 'intent',
      triggers: packet.triggers,
      responses: packet.responseVariants,
      folderName: packet.folderName,
      tags: ['curriculum-drill'],
      learnedFrom: packet.usedTeacher ? 'teacher-distilled' : 'scratch',
      confidence: packet.usedTeacher ? 2.4 : 1.9,
      usageCount: 0,
    });
    onChangeScratchSkills(updatedSkills);

    let nextSamples = trainingSamples;
    for (const turn of packet.turns) {
      nextSamples = addTrainingSample({
        format: 'sft',
        prompt: turn.userPrompt,
        chosenResponse: turn.idealResponse,
        modelChosen: packet.modelUsed,
        citedEntryIds: [],
        status: 'approved',
      });
    }
    onChangeTrainingSamples(nextSamples);

    if (addEval && packet.evalPrompt.trim()) {
      const nextEvals = addEvalCase({
        title: `Drill: ${packet.topicTitle.slice(0, 48)}`,
        prompt: packet.evalPrompt,
        requiredTerms: packet.evalRequiredTerms,
        forbiddenTerms: ['undefined', 'sb_secret_', 'hf_'],
        requireCitation: false,
        requireSafeCode: true,
        category: 'recall',
      });
      onChangeEvalCases(nextEvals);
    }

    setDrillFeedback(
      `Committed "${packet.topicTitle}": saved ${packet.triggers.length} Scratch triggers, ${packet.turns.length} SFT turns${
        addEval ? ', and 1 Eval test case' : ''
      }.`,
    );
    setActiveDrill(null);
  }

  const proposals = profile ? buildSelfOptimizationProposals(profile, repoFiles) : [];
  const latestRun = evalRuns[0] || null;
  const approvedSamples = trainingSamples.filter((s) => s.status !== 'rejected');

  return (
    <div className="space-y-5">
      {/* Studio Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-ink">
            Training, Curriculum &amp; Evaluation Lab
          </h1>
          <p className="mt-0.5 text-xs text-ink-muted">
            Post-train Mantis on your workflow: fill skill gaps, log preference pairs, refine local student rules, and verify regressions.
          </p>
        </div>
        <div className="font-mono text-xs tabular-nums text-ink-muted">
          {activeCheckpoint.id} · {activeCheckpoint.metrics.stepCount} steps ·{' '}
          {activeCheckpoint.metrics.vocabSize} BPE · {latestRun ? `${latestRun.passRate}% eval` : 'No eval'}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-line pb-2">
        {(
          [
            {id: 'neural', label: `Neural Core (${activeCheckpoint.metrics.stepCount})`, icon: Layers},
            {
              id: 'models',
              label: localLlmState.loadedModelId
                ? `Local Q4 (${getLocalLlmSpec(localLlmState.loadedModelId).shortLabel})`
                : 'Local Q4 Models',
              icon: Cpu,
            },
            {id: 'arena', label: 'Preference Eval', icon: Scale},
            {id: 'curriculum', label: `Curriculum (${curriculumCoverage.gaps.length})`, icon: GraduationCap},
            {id: 'dataset', label: `Dataset & Skills (${trainingSamples.length + scratchSkills.length})`, icon: FlaskConical},
            {id: 'evals', label: `Eval Bench (${evalCases.length})`, icon: Gauge},
            {id: 'profiler', label: 'RAM & Self-Opt', icon: Wrench},
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'bg-accent text-white'
                  : 'text-ink-muted hover:bg-elevated hover:text-ink'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 0: NEURAL STUDENT CORE & CHECKPOINT REGISTRY */}
      {activeTab === 'neural' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-line bg-surface p-3.5">
              <div className="text-[11px] text-ink-muted">Active Checkpoint</div>
              <div className="mt-1 font-mono text-base font-semibold tabular-nums text-accent-text">
                {activeCheckpoint.id}
              </div>
              <div className="truncate font-mono text-[10px] text-ink-subtle">
                {activeCheckpoint.profileName}
              </div>
            </div>
            <div className="rounded-lg border border-line bg-surface p-3.5">
              <div className="text-[11px] text-ink-muted">AdamW Steps · Grad Norm</div>
              <div className="mt-1 font-mono text-base font-semibold tabular-nums text-ink">
                {activeCheckpoint.metrics.stepCount} steps
              </div>
              <div className="font-mono text-[10px] tabular-nums text-ink-subtle">
                {activeCheckpoint.metrics.lastLoss !== null
                  ? `Loss ${activeCheckpoint.metrics.lastLoss.toFixed(3)} · |∇| ${activeCheckpoint.metrics.avgGradNorm.toFixed(2)}`
                  : 'Untrained baseline (0 steps)'}
              </div>
            </div>
            <div className="rounded-lg border border-line bg-surface p-3.5">
              <div className="text-[11px] text-ink-muted">Dynamic BPE Vocabulary</div>
              <div className="mt-1 font-mono text-base font-semibold tabular-nums text-ink">
                {activeCheckpoint.metrics.vocabSize} tokens
              </div>
              <div className="font-mono text-[10px] tabular-nums text-ink-subtle">
                {activeCheckpoint.tokenizer.merges.length} merges · {activeCheckpoint.targets.length} targets
              </div>
            </div>
            <div className="rounded-lg border border-line bg-surface p-3.5">
              <div className="text-[11px] text-ink-muted">Student Weights (Float32+LoRA)</div>
              <div className="mt-1 font-mono text-base font-semibold tabular-nums text-ink">
                {activeCheckpoint.metrics.paramCount.toLocaleString()} params
              </div>
              <div className="font-mono text-[10px] tabular-nums text-ink-subtle">
                {Math.round(activeCheckpoint.metrics.memoryBytes / 1024)} KB indexed
              </div>
            </div>
          </div>

          {/* Batch Trainer Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-ink">
                Worker AdamW Trainer ({readyBatchExamples.length} corpus pairs ready)
              </div>
              <p className="text-xs text-ink-muted">
                Expands subword BPE merges and runs gradient descent across approved SFT turns, distilled skills, and Trusted rules inside your browser Web Worker.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {([10, 20, 40] as const).map((ep) => (
                <button
                  key={ep}
                  type="button"
                  onClick={() => setBatchEpochs(ep)}
                  className={`min-h-[40px] rounded border px-3 font-mono text-xs tabular-nums ${
                    batchEpochs === ep
                      ? 'border-accent-border bg-accent-soft text-accent-text'
                      : 'border-line bg-inset text-ink-muted hover:text-ink'
                  }`}
                >
                  {ep} epochs
                </button>
              ))}
              <button
                type="button"
                disabled={isTrainingNeural || readyBatchExamples.length === 0}
                onClick={async () => {
                  setNeuralFeedback(null);
                  const res = await onTrainNeuralBatch(batchEpochs);
                  if (res) {
                    setNeuralFeedback(
                      `Saved ${res.checkpointId} (+${res.stepsAdded} AdamW steps): loss ${res.firstLoss.toFixed(3)} → ${res.lastLoss.toFixed(3)}.`,
                    );
                  } else {
                    setNeuralFeedback(
                      'No approved SFT samples, skills, or Trusted memories available yet. Teach a rule or fix a chat turn first.',
                    );
                  }
                }}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md bg-accent px-4 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5" />
                <span>{isTrainingNeural ? 'Training Worker…' : 'Train Neural Batch'}</span>
              </button>
            </div>
          </div>

          {neuralFeedback && (
            <div className="rounded-md border border-accent-border bg-accent-soft px-3.5 py-2.5 font-mono text-xs text-accent-text">
              {neuralFeedback}
            </div>
          )}

          {/* Loss Curve + BPE Subword Sample */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
              <h2 className="text-xs font-semibold text-ink">Cross-Entropy Convergence</h2>
              <LossSparkline
                history={activeCheckpoint.metrics.lossHistory}
                height={108}
                label="Batch Mean Loss"
              />
            </div>

            <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-ink">Learned BPE Subword Vocabulary</h2>
                <span className="font-mono text-[11px] tabular-nums text-ink-subtle">
                  {activeCheckpoint.tokenizer.merges.length} merges
                </span>
              </div>
              {activeCheckpoint.tokenizer.vocab.length === 0 ? (
                <p className="text-xs text-ink-muted">
                  Vocabulary is empty (0 tokens). Train a batch or fix a turn to build subword tokens from scratch.
                </p>
              ) : (
                <div className="max-h-28 overflow-y-auto rounded border border-line bg-inset p-2.5 font-mono text-[11px] leading-relaxed text-ink-muted">
                  {activeCheckpoint.tokenizer.vocab
                    .slice(0, 64)
                    .map((tok) => tok.replace('</w>', '·'))
                    .join('  ')}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
                <input
                  type="text"
                  value={cloneNameInput}
                  onChange={(e) => setCloneNameInput(e.target.value)}
                  placeholder="Fork profile name (optional)…"
                  className="min-h-[40px] min-w-[160px] flex-1 rounded border border-line-strong bg-inset px-3 text-xs text-ink placeholder:text-ink-subtle"
                />
                <button
                  type="button"
                  disabled={isTrainingNeural}
                  onClick={async () => {
                    await onCloneCheckpoint(activeCheckpoint.id, cloneNameInput.trim() || undefined);
                    setCloneNameInput('');
                    setNeuralFeedback(`Cloned ${activeCheckpoint.id} into a new profile.`);
                  }}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded border border-line bg-inset px-3 text-xs font-medium text-ink hover:border-line-strong"
                >
                  <Copy className="h-3.5 w-3.5 text-ink-muted" />
                  <span>Clone Profile</span>
                </button>
                {confirmResetZero ? (
                  <button
                    type="button"
                    disabled={isTrainingNeural}
                    onClick={async () => {
                      await onResetBlankSlate();
                      setConfirmResetZero(false);
                      setNeuralFeedback('Reset active profile to 0-step blank slate.');
                    }}
                    className="inline-flex min-h-[40px] items-center rounded bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-500"
                  >
                    Confirm Reset 0
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isTrainingNeural}
                    onClick={() => setConfirmResetZero(true)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded border border-line bg-inset px-3 text-xs font-medium text-ink-muted hover:text-ink"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Blank-Slate Reset</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Checkpoint History & Rollback Registry */}
          <div className="space-y-2 rounded-lg border border-line bg-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-ink">
                Immutable Checkpoint Registry ({checkpoints.length})
              </h2>
              <span className="font-mono text-[11px] text-ink-subtle">
                IndexedDB Local Persistence
              </span>
            </div>

            <div className="divide-y divide-line">
              {checkpoints.map((ckpt) => {
                const isCurrent = ckpt.id === activeCheckpoint.id;
                return (
                  <div
                    key={ckpt.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-xs"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                        <span className={isCurrent ? 'font-semibold text-accent-text' : 'text-ink'}>
                          {ckpt.id}
                        </span>
                        <span className="text-ink-subtle">·</span>
                        <span className="text-ink-muted">{ckpt.profileName}</span>
                        <span className="text-ink-subtle">·</span>
                        <span className="tabular-nums text-ink-muted">
                          {ckpt.metrics.stepCount} steps · {ckpt.metrics.vocabSize} BPE ·{' '}
                          {ckpt.targets.length} targets
                        </span>
                        {ckpt.metrics.lastLoss !== null && (
                          <>
                            <span className="text-ink-subtle">·</span>
                            <span className="tabular-nums text-accent-text">
                              Loss {ckpt.metrics.lastLoss.toFixed(3)}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-ink-subtle">
                        {ckpt.label} · {new Date(ckpt.createdAt).toLocaleString()}
                      </div>
                    </div>

                    {isCurrent ? (
                      <span className="font-mono text-xs font-semibold text-accent-text">
                        Active Checkpoint
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void onRollbackCheckpoint(ckpt.id)}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded border border-line bg-inset px-3 text-xs font-medium text-ink hover:border-line-strong"
                      >
                        <RotateCcw className="h-3.5 w-3.5 text-ink-muted" />
                        <span>Rollback</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 0.5: DUAL-TIER LOCAL Q4 MODELS & 8 GB MEMORY GUARD */}
      {activeTab === 'models' && (
        <div className="space-y-5">
          {/* Hardware Telemetry & Guard Summary */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-line bg-surface p-3.5">
              <div className="text-[11px] text-ink-muted">Device Memory</div>
              <div className="mt-1 font-mono text-base font-semibold tabular-nums text-ink">
                {hardwareTelemetry?.deviceMemoryGb
                  ? `~${hardwareTelemetry.deviceMemoryGb} GB RAM`
                  : 'Browser Unreported'}
              </div>
              <div className="font-mono text-[10px] tabular-nums text-ink-subtle">
                {hardwareTelemetry?.hardwareConcurrency || 4} logical CPU threads
              </div>
            </div>

            <div className="rounded-lg border border-line bg-surface p-3.5">
              <div className="text-[11px] text-ink-muted">JS Heap Headroom</div>
              <div className="mt-1 font-mono text-base font-semibold tabular-nums text-ink">
                {hardwareTelemetry?.jsHeapUsedMb !== null && hardwareTelemetry?.jsHeapUsedMb !== undefined
                  ? `${hardwareTelemetry.jsHeapUsedMb} MB`
                  : 'Chrome Desktop Only'}
              </div>
              <div className="font-mono text-[10px] tabular-nums text-ink-subtle">
                {hardwareTelemetry?.jsHeapLimitMb
                  ? `Limit ${hardwareTelemetry.jsHeapLimitMb} MB`
                  : '8 GB guard active'}
              </div>
            </div>

            <div className="rounded-lg border border-line bg-surface p-3.5">
              <div className="text-[11px] text-ink-muted">Execution Backend</div>
              <div className="mt-1 font-mono text-base font-semibold text-accent-text">
                {hardwareTelemetry?.webGpuSupported
                  ? hardwareTelemetry.webGpuF16Supported
                    ? 'WebGPU (q4f16)'
                    : 'WebGPU (q4)'
                  : 'CPU WASM (q4)'}
              </div>
              <div className="truncate font-mono text-[10px] text-ink-subtle">
                {hardwareTelemetry?.adapterLabel || computeStatus.adapterLabel}
              </div>
            </div>

            <div className="rounded-lg border border-line bg-surface p-3.5">
              <div className="text-[11px] text-ink-muted">Active Q4 Weights</div>
              <div className="mt-1 font-mono text-base font-semibold text-ink">
                {localLlmState.loadedModelId
                  ? getLocalLlmSpec(localLlmState.loadedModelId).shortLabel
                  : '0 MB Loaded'}
              </div>
              <div className="truncate font-mono text-[10px] text-ink-subtle">
                {localLlmState.lastTokensPerSec
                  ? `Last speed: ${localLlmState.lastTokensPerSec.toFixed(1)} tok/s`
                  : localLlmState.loadStatusText}
              </div>
            </div>
          </div>

          {/* Runtime Controls & Download Progress */}
          <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <h2 className="text-xs font-semibold text-ink">
                  On-Device Runtime &amp; Browser Cache Controls
                </h2>
                <p className="font-mono text-[11px] text-ink-muted">
                  {localLlmState.loadStatusText}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void onRefreshHardware()}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded border border-line bg-inset px-3 text-xs font-medium text-ink hover:border-line-strong"
                >
                  <RefreshCw className="h-3.5 w-3.5 text-ink-muted" />
                  <span>Probe Hardware</span>
                </button>
                {(localLlmState.status === 'downloading' ||
                  localLlmState.status === 'loading' ||
                  localLlmState.status === 'probing') && (
                  <button
                    type="button"
                    onClick={onCancelLocalLlmLoad}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded border border-danger-border bg-danger-soft px-3 text-xs font-semibold text-danger hover:bg-surface"
                  >
                    <Square className="h-3 w-3" />
                    <span>Cancel Load</span>
                  </button>
                )}
                {localLlmState.loadedModelId && (
                  <button
                    type="button"
                    onClick={() => void onUnloadLocalLlm()}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded border border-line bg-inset px-3 text-xs font-medium text-ink hover:border-line-strong"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-ink-muted" />
                    <span>Unload RAM</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await onClearLocalLlmCache();
                    setCacheNotice(
                      ok
                        ? 'Cleared downloaded ONNX model weights from browser Cache Storage.'
                        : 'No cached weights found or browser Cache Storage unavailable.',
                    );
                  }}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded border border-line bg-inset px-3 text-xs font-medium text-ink-muted hover:text-ink"
                >
                  <span>Clear Cache</span>
                </button>
              </div>
            </div>

            {(localLlmState.status === 'downloading' ||
              localLlmState.status === 'loading' ||
              localLlmState.status === 'probing') && (
              <div className="space-y-1.5">
                <div className="h-1.5 w-full overflow-hidden rounded bg-inset">
                  <div
                    className="h-full bg-accent transition-all duration-200"
                    style={{width: `${Math.max(4, localLlmState.loadProgressPercent)}%`}}
                  />
                </div>
                <div className="flex justify-between font-mono text-[10px] tabular-nums text-ink-subtle">
                  <span>{localLlmState.loadStatusText}</span>
                  <span>{localLlmState.loadProgressPercent}%</span>
                </div>
              </div>
            )}

            {localLlmState.error && (
              <div
                role="alert"
                className="rounded border border-danger-border bg-danger-soft px-3 py-2 text-xs text-danger"
              >
                {localLlmState.error}
              </div>
            )}

            {cacheNotice && (
              <div className="rounded border border-accent-border bg-accent-soft px-3 py-2 text-xs text-accent-text">
                {cacheNotice}
              </div>
            )}
          </div>

          {/* Tier 1 & Tier 2 Model Catalog */}
          {(
            [
              {
                tier: 'lightweight-8gb' as const,
                title: 'Tier 1 — Lightweight 8 GB Tablet & Chromebook Safe (Q4 WebGPU / WASM)',
                subtitle:
                  'Fits comfortably inside 8 GB Android tablet & Chromebook browser limits (~280 MB–820 MB). Auto-unloads cleanly before high-RAM screen OCR.',
              },
              {
                tier: 'complex-high-ram' as const,
                title: 'Tier 2 — Complex & High-Capacity Local Models (1B–3B Q4)',
                subtitle:
                  'Smarter code & multi-step reasoning models for 12–16 GB+ machines. Guarded on <=8 GB devices to prevent Chrome out-of-memory reloads.',
              },
            ] as const
          ).map((group) => {
            const items = LOCAL_LLM_CATALOG.filter((m) => m.tier === group.tier);
            return (
              <div key={group.tier} className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-xs font-semibold tracking-wide text-ink uppercase">
                      {group.title}
                    </h2>
                    <p className="text-[11px] text-ink-muted">{group.subtitle}</p>
                  </div>

                  {group.tier === 'complex-high-ram' && (
                    <label className="inline-flex min-h-[38px] cursor-pointer items-center gap-2 rounded border border-line bg-surface px-3 text-[11px] text-ink-muted">
                      <input
                        type="checkbox"
                        checked={allowHighRamOverride}
                        onChange={(e) => setAllowHighRamOverride(e.target.checked)}
                        className="h-3.5 w-3.5 accent-emerald-500"
                      />
                      <span>Override 8 GB Memory Guard</span>
                    </label>
                  )}
                </div>

                <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
                  {items.map((spec) => {
                    const safety = evaluateModelMemorySafety(
                      spec,
                      hardwareTelemetry,
                      allowHighRamOverride,
                    );
                    const isSelected = localLlmState.selectedModelId === spec.id;
                    const isLoaded = localLlmState.loadedModelId === spec.id;
                    const isBusy =
                      localLlmState.status === 'probing' ||
                      localLlmState.status === 'downloading' ||
                      localLlmState.status === 'loading';

                    return (
                      <div
                        key={spec.id}
                        className={`flex flex-wrap items-center justify-between gap-3 p-3.5 text-xs ${
                          isSelected ? 'bg-inset/70' : ''
                        }`}
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                            <span className="text-xs font-semibold text-ink">{spec.label}</span>
                            <span className="text-ink-subtle">·</span>
                            <span className="tabular-nums text-ink-muted">
                              ~{spec.estimatedRamMb} MB RAM
                            </span>
                            <span className="text-ink-subtle">·</span>
                            <span className="tabular-nums text-ink-subtle">
                              {spec.contextWindow.toLocaleString()} ctx
                            </span>
                            <span className="text-ink-subtle">·</span>
                            <span className="text-ink-subtle">
                              Min {spec.minRecommendedRamGb} GB device
                            </span>
                          </div>
                          <div className="text-xs text-ink-muted">{spec.capabilities}</div>
                          <div
                            className={`font-mono text-[11px] ${
                              safety.severity === 'danger'
                                ? 'text-danger'
                                : safety.severity === 'caution'
                                  ? 'text-warn'
                                  : 'text-accent-text'
                            }`}
                          >
                            {safety.reason}
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          {!isSelected && (
                            <button
                              type="button"
                              onClick={() => onSelectLocalLlm(spec.id)}
                              className="min-h-[40px] rounded border border-line bg-inset px-3 text-xs font-medium text-ink-muted hover:text-ink"
                            >
                              Select Default
                            </button>
                          )}
                          {isLoaded ? (
                            <button
                              type="button"
                              onClick={() => void onUnloadLocalLlm()}
                              className="inline-flex min-h-[40px] items-center gap-1.5 rounded border border-accent-border bg-accent-soft px-3.5 text-xs font-semibold text-accent-text hover:bg-accent hover:text-white"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>Loaded · Unload</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isBusy || !safety.allowed}
                              onClick={() =>
                                void onLoadLocalLlm(spec.id, allowHighRamOverride)
                              }
                              className="inline-flex min-h-[40px] items-center gap-1.5 rounded bg-accent px-3.5 text-xs font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              <Play className="h-3.5 w-3.5" />
                              <span>
                                {!safety.allowed
                                  ? 'Guarded'
                                  : isSelected
                                    ? 'Load Weights'
                                    : 'Load & Activate'}
                              </span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Student Neural Adapter Bridge + Live Streaming Benchmark */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
              <div className="flex items-center justify-between border-b border-line pb-2">
                <h2 className="text-xs font-semibold text-ink">
                  Student Neural Adapter Conditioning
                </h2>
                <span className="font-mono text-[11px] tabular-nums text-accent-text">
                  {adapterPreview?.checkpointId || activeCheckpoint.id}
                </span>
              </div>
              <p className="text-xs text-ink-muted">
                Every Local Q4 prompt is grounded by your trained Student checkpoint, Hybrid BM25 + Int8 vectors, and Colab LoRA export target.
              </p>
              {adapterPreview && (
                <div className="space-y-1.5 font-mono text-[11px] text-ink-muted">
                  <div>
                    Colab QLoRA Base:{' '}
                    <span className="text-ink">{adapterPreview.colabBaseModel}</span>
                  </div>
                  <div className="tabular-nums">
                    Trained Steps: <span className="text-ink">{adapterPreview.stepCount}</span> · BPE
                    Vocab: <span className="text-ink">{adapterPreview.vocabSize}</span> · Memories
                    Injected: <span className="text-ink">{adapterPreview.trustedRulesUsed}</span> ·
                    Targets: <span className="text-ink">{adapterPreview.neuralTargetsInjected}</span>
                  </div>
                  <div>
                    Bias Subwords:{' '}
                    <span className="text-accent-text">
                      {adapterPreview.biasTerms.length > 0
                        ? adapterPreview.biasTerms.join(', ')
                        : 'None yet (step-train ckpt first)'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
              <div className="flex items-center justify-between border-b border-line pb-2">
                <h2 className="text-xs font-semibold text-ink">
                  On-Device Streaming Benchmark (0 Cloud Calls)
                </h2>
                {benchTelemetry && (
                  <span className="font-mono text-[11px] tabular-nums text-accent-text">
                    {benchTelemetry.tps !== null
                      ? `${benchTelemetry.tps.toFixed(1)} tok/s`
                      : ''}{' '}
                    · {benchTelemetry.tokens} tok · {benchTelemetry.device.toUpperCase()}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={benchPrompt}
                  onChange={(e) => setBenchPrompt(e.target.value)}
                  placeholder="Enter a test prompt for the loaded Local Q4 model…"
                  className="min-h-[40px] min-w-[200px] flex-1 rounded border border-line-strong bg-inset px-3 text-xs text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
                />
                {localLlmState.isGenerating ? (
                  <button
                    type="button"
                    onClick={onStopLocalLlmGeneration}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded border border-danger-border bg-danger-soft px-3.5 text-xs font-semibold text-danger"
                  >
                    <Square className="h-3 w-3" />
                    <span>Stop</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!localLlmState.loadedModelId || !benchPrompt.trim()}
                    onClick={async () => {
                      setBenchError(null);
                      setBenchOutput('');
                      setBenchTelemetry(null);
                      try {
                        const [hybridMatches, neuralPrediction] = await Promise.all([
                          runHybridRetrievalAsync({
                            query: benchPrompt,
                            entries,
                            folders,
                            limit: 4,
                          }),
                          inferNeuralStudentAsync(benchPrompt, activeCheckpoint),
                        ]);
                        const adapted = buildAdapterConditionedMessages({
                          prompt: benchPrompt,
                          checkpoint: activeCheckpoint,
                          hybridMatches,
                          folders,
                          skills: scratchSkills,
                          neuralPrediction,
                          modelId: localLlmState.loadedModelId || localLlmState.selectedModelId,
                        });
                        setAdapterPreview(adapted.adapterSpec);
                        const res = await generateWithLocalLlmStream({
                          messages: adapted.messages,
                          onToken: (text, tps, count) => {
                            setBenchOutput(text);
                            setBenchTelemetry({
                              tps,
                              tokens: count,
                              durationMs: 0,
                              device: localLlmState.activeDevice || 'wasm',
                            });
                          },
                        });
                        setBenchOutput(res.text);
                        setBenchTelemetry({
                          tps: res.tokensPerSec,
                          tokens: res.generatedTokens,
                          durationMs: res.durationMs,
                          device: res.device,
                        });
                      } catch (err) {
                        setBenchError(
                          err instanceof Error ? err.message : 'Local streaming benchmark failed.',
                        );
                      }
                    }}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded bg-accent px-3.5 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-45"
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span>Stream Benchmark</span>
                  </button>
                )}
              </div>

              {benchError && (
                <div className="rounded border border-danger-border bg-danger-soft px-3 py-2 text-xs text-danger">
                  {benchError}
                </div>
              )}

              <div className="min-h-[88px] max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-line bg-inset p-3 font-mono text-[11px] leading-relaxed text-ink">
                {benchOutput ||
                  (localLlmState.loadedModelId
                    ? 'Click Stream Benchmark to measure real WebGPU/WASM tokens/sec with Student Adapter conditioning.'
                    : 'Load a Local Q4 model above to benchmark offline streaming speed.')}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 1: DPO ARENA */}
      {activeTab === 'arena' && (
        <div className="space-y-4">
          <form onSubmit={handleRunDuel} className="flex flex-wrap gap-2">
            <input
              type="text"
              value={arenaPrompt}
              onChange={(e) => setArenaPrompt(e.target.value)}
              placeholder="Enter a prompt to compare Local Student vs. Cloud Teacher…"
              className="min-h-[44px] min-w-[240px] flex-1 rounded-md border border-line-strong bg-inset px-3.5 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={isGeneratingDuel || !arenaPrompt.trim()}
              className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>{isGeneratingDuel ? 'Comparing…' : 'Compare Replies'}</span>
            </button>
          </form>

          {duelFeedback && (
            <div className="rounded-md border border-accent-border bg-accent-soft px-3.5 py-2.5 text-xs text-accent-text">
              {duelFeedback}
            </div>
          )}

          {duelResult ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {(['a', 'b'] as const).map((side) => {
                const candidate = duelResult[side];
                const letter = side.toUpperCase() as 'A' | 'B';
                return (
                  <div
                    key={side}
                    className="flex flex-col justify-between gap-3 rounded-lg border border-line bg-surface p-4"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between border-b border-line pb-2">
                        <span className="font-mono text-xs font-semibold text-ink">
                          Candidate {letter} · {candidate.label}
                        </span>
                      </div>
                      <div className="max-h-72 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-ink">
                        {candidate.text}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handlePickWinner(letter)}
                      className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-3 py-2 text-xs font-semibold text-accent-text transition-colors hover:bg-accent hover:text-white"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>Prefer Candidate {letter} (Save DPO Pair)</span>
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-line bg-surface p-6 text-center text-xs leading-relaxed text-ink-muted">
              Compare local student and teacher replies to generate Chosen vs. Rejected DPO preference pairs for fine-tuning and export.
            </div>
          )}
        </div>
      )}

      {/* TAB 2: TEACHER-STUDENT CURRICULUM DRILLS */}
      {activeTab === 'curriculum' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-line bg-surface p-3.5">
              <div className="text-[11px] text-ink-muted">Topic Skill Coverage</div>
              <div className="mt-1 font-mono text-base font-semibold tabular-nums text-accent-text">
                {curriculumCoverage.coveragePercent}% ({curriculumCoverage.coveredEntries}/
                {curriculumCoverage.totalActiveEntries})
              </div>
            </div>
            <div className="rounded-lg border border-line bg-surface p-3.5">
              <div className="text-[11px] text-ink-muted">Untrained Gaps Queue</div>
              <div className="mt-1 font-mono text-base font-semibold tabular-nums text-ink">
                {curriculumCoverage.gaps.length}
              </div>
            </div>
            <div className="rounded-lg border border-line bg-surface p-3.5">
              <div className="text-[11px] text-ink-muted">Teacher Route</div>
              <div className="mt-1 font-mono text-xs font-medium text-ink">
                {brainUrl.trim() || backupBrainUrl?.trim() ? brainModel.split('/').pop() : 'Offline Synthesizer'}
              </div>
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleRunCurriculumDrill({
                topicTitle: customDrillTopic,
                folderName: 'Patterns',
              });
              setCustomDrillTopic('');
            }}
            className="flex flex-wrap gap-2"
          >
            <input
              type="text"
              value={customDrillTopic}
              onChange={(e) => setCustomDrillTopic(e.target.value)}
              placeholder="Enter any skill topic to drill across 3 turns (e.g. Supabase RLS rules, TypeScript async cleanup)…"
              className="min-h-[44px] min-w-[240px] flex-1 rounded-md border border-line-strong bg-inset px-3.5 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={isDrilling || !customDrillTopic.trim()}
              className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
            >
              <GraduationCap className="h-3.5 w-3.5" />
              <span>{isDrilling ? 'Synthesizing Drill…' : 'Generate 3-Turn Drill'}</span>
            </button>
          </form>

          {drillFeedback && (
            <div className="rounded-md border border-accent-border bg-accent-soft px-3.5 py-2.5 text-xs text-accent-text">
              {drillFeedback}
            </div>
          )}

          {activeDrill && (
            <div className="space-y-3 rounded-lg border border-accent-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
                <div>
                  <div className="font-mono text-[11px] font-semibold text-accent-text uppercase">
                    {activeDrill.usedTeacher ? `Teacher Drill · ${activeDrill.modelUsed}` : 'Local Rule Drill'}
                  </div>
                  <h3 className="text-sm font-semibold text-ink">{activeDrill.topicTitle}</h3>
                </div>
                <span className="rounded border border-line bg-inset px-2.5 py-1 font-mono text-[11px] text-ink-muted">
                  Folder: {activeDrill.folderName}
                </span>
              </div>

              <div className="font-mono text-[11px] text-ink-muted">
                Triggers: <span className="text-ink">{activeDrill.triggers.join(' · ')}</span>
              </div>

              <div className="space-y-2">
                {activeDrill.turns.map((turn, idx) => (
                  <div key={idx} className="space-y-1 rounded border border-line bg-inset p-3 text-xs">
                    <div className="font-semibold text-ink">
                      Turn {idx + 1}: {turn.userPrompt}
                    </div>
                    <div className="text-ink-muted">{turn.idealResponse}</div>
                    <div className="font-mono text-[10px] text-accent-text">
                      Takeaway: {turn.takeaway}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setActiveDrill(null)}
                  className="min-h-[40px] rounded border border-line px-3 text-xs text-ink-muted hover:text-ink"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => handleCommitCurriculumDrill(activeDrill, false)}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded border border-accent-border bg-accent-soft px-3.5 text-xs font-semibold text-accent-text hover:bg-accent hover:text-white"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>Save Skill + SFT Turns</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleCommitCurriculumDrill(activeDrill, true)}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded bg-accent px-4 text-xs font-semibold text-white hover:bg-accent-hover"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>Commit Skill + SFT + Eval Case</span>
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <h2 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
              Detected Knowledge &amp; Skill Gaps ({curriculumCoverage.gaps.length})
            </h2>
            {curriculumCoverage.gaps.length === 0 ? (
              <div className="rounded-lg border border-line bg-surface p-5 text-xs text-ink-muted">
                All active Trusted &amp; Reviewed Knowledge topics have Scratch trigger coverage. Add new rules or test custom drill topics above.
              </div>
            ) : (
              <div className="grid gap-2.5 md:grid-cols-2">
                {curriculumCoverage.gaps.map((gap) => (
                  <div
                    key={gap.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3.5 text-xs"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 font-mono text-[10px] text-accent-text uppercase">
                        <BookOpen className="h-3 w-3 shrink-0" />
                        <span>
                          {gap.folderName} · {gap.reason}
                        </span>
                      </div>
                      <div className="truncate font-medium text-ink">{gap.title}</div>
                      {gap.sourceContent && (
                        <div className="line-clamp-2 text-[11px] text-ink-muted">
                          {gap.sourceContent}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={isDrilling}
                      onClick={() =>
                        void handleRunCurriculumDrill({
                          topicTitle: gap.title,
                          folderName: gap.folderName,
                          sourceContent: gap.sourceContent,
                        })
                      }
                      className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-3 text-xs font-semibold text-accent-text hover:bg-accent hover:text-white disabled:opacity-50"
                    >
                      <GraduationCap className="h-3.5 w-3.5" />
                      <span>Drill</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: DATASET & LEARNED SCRATCH SKILLS */}
      {activeTab === 'dataset' && (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* Training Samples Table */}
          <div className="space-y-3">
            <h2 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
              Curated SFT &amp; DPO Samples ({trainingSamples.length})
            </h2>
            {trainingSamples.length === 0 ? (
              <div className="rounded-lg border border-line bg-surface p-5 text-xs text-ink-muted">
                No training pairs recorded yet. Approve patches, distill lessons from Teacher, or log winners in Preference Eval.
              </div>
            ) : (
              <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
                {trainingSamples.map((s) => (
                  <div
                    key={s.id}
                    className="space-y-2 rounded-lg border border-line bg-surface p-3 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-semibold text-accent-text uppercase">
                        {s.format} · {s.modelChosen}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            onChangeTrainingSamples(
                              updateTrainingSample(s.id, {
                                status: s.status === 'approved' ? 'rejected' : 'approved',
                              }),
                            )
                          }
                          className="min-h-[40px] rounded border border-line px-2.5 py-0.5 font-mono text-[11px] text-ink-muted hover:text-ink"
                        >
                          {s.status}
                        </button>
                        <button
                          type="button"
                          aria-label="Delete training sample"
                          onClick={() => onChangeTrainingSamples(deleteTrainingSample(s.id))}
                          className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded text-ink-subtle hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="font-medium text-ink">{s.prompt}</div>
                    <div className="line-clamp-3 font-mono text-[11px] text-ink-muted">
                      {s.chosenResponse}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Learned Scratch Skills */}
          <div className="space-y-3">
            <h2 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
              Distilled Offline Scratch Skills ({scratchSkills.length})
            </h2>
            {scratchSkills.length === 0 ? (
              <div className="rounded-lg border border-line bg-surface p-5 text-xs text-ink-muted">
                When Scratch AI encounters a prompt it doesn&apos;t know (like greetings or domain questions), Cloud Teacher teaches it multi-variant trigger rules saved here for permanent offline use.
              </div>
            ) : (
              <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
                {scratchSkills.map((sk) => {
                  const isEditing = editingSkillId === sk.id;
                  return (
                    <div
                      key={sk.id}
                      className="space-y-2 rounded-lg border border-line bg-surface p-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] font-semibold text-accent-text">
                          {sk.folderName} · {sk.usageCount} recalls · conf {sk.confidence.toFixed(1)}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label="Edit distilled skill"
                            onClick={() => {
                              if (isEditing) {
                                setEditingSkillId(null);
                              } else {
                                setEditingSkillId(sk.id);
                                setEditFolderText(sk.folderName);
                                setEditTriggersText(sk.triggers.join(', '));
                                setEditResponsesText(sk.responses.join('\n'));
                              }
                            }}
                            className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded text-ink-subtle hover:text-ink"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Delete distilled skill"
                            onClick={() => onDeleteScratchSkill(sk.id)}
                            className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded text-ink-subtle hover:text-danger"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {isEditing ? (
                        <div className="space-y-2 border-t border-line pt-2">
                          <input
                            type="text"
                            value={editFolderText}
                            onChange={(e) => setEditFolderText(e.target.value)}
                            placeholder="Folder name"
                            className="min-h-[40px] w-full rounded border border-line-strong bg-inset px-2.5 text-xs text-ink"
                          />
                          <input
                            type="text"
                            value={editTriggersText}
                            onChange={(e) => setEditTriggersText(e.target.value)}
                            placeholder="Comma-separated triggers"
                            className="min-h-[40px] w-full rounded border border-line-strong bg-inset px-2.5 font-mono text-xs text-ink"
                          />
                          <textarea
                            rows={3}
                            value={editResponsesText}
                            onChange={(e) => setEditResponsesText(e.target.value)}
                            placeholder="One response variant per line"
                            className="w-full rounded border border-line-strong bg-inset p-2.5 text-xs text-ink"
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingSkillId(null)}
                              className="min-h-[40px] rounded border border-line px-3 text-xs text-ink-muted"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                onUpdateScratchSkill(sk.id, {
                                  folderName: editFolderText.trim() || sk.folderName,
                                  triggers: editTriggersText
                                    .split(',')
                                    .map((t) => t.trim())
                                    .filter(Boolean),
                                  responses: editResponsesText
                                    .split('\n')
                                    .map((r) => r.trim())
                                    .filter(Boolean),
                                });
                                setEditingSkillId(null);
                              }}
                              className="min-h-[40px] rounded bg-accent px-3 text-xs font-semibold text-white hover:bg-accent-hover"
                            >
                              Save Skill
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="font-mono text-[11px] text-ink">
                            Triggers: {sk.triggers.join(' · ')}
                          </div>
                          <div className="line-clamp-2 text-[11px] text-ink-muted">
                            {sk.responses[0]}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: EVAL BENCH */}
      {activeTab === 'evals' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-ink-muted">Engine Target:</span>
              {(['scratch', 'hybrid', 'cloud'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setEvalMode(m)}
                  className={`min-h-[40px] rounded border px-3 text-xs font-medium capitalize ${
                    evalMode === m
                      ? 'border-accent-border bg-accent-soft text-accent-text'
                      : 'border-line bg-inset text-ink-muted hover:text-ink'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={isRunningEval || evalCases.length === 0}
              onClick={() => void handleRunEvalSuite()}
              className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              <span>{isRunningEval ? 'Running Suite…' : `Run All ${evalCases.length} Evals`}</span>
            </button>
          </div>

          {latestRun && (
            <div className="space-y-2 rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
                <span className="text-xs font-semibold text-ink">
                  Latest Run ({latestRun.engineMode.toUpperCase()})
                </span>
                <span className="font-mono text-xs font-semibold tabular-nums text-accent-text">
                  {latestRun.passedCases}/{latestRun.totalCases} passed ({latestRun.passRate}%) ·{' '}
                  {latestRun.avgLatencyMs} ms avg
                </span>
              </div>

              <div className="space-y-1.5">
                {latestRun.results.map((r) => (
                  <div
                    key={r.caseId}
                    className="flex flex-wrap items-start justify-between gap-2 rounded border border-line bg-inset px-3 py-2 text-xs"
                  >
                    <div className="flex items-start gap-2">
                      {r.passed ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-text" />
                      ) : (
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
                      )}
                      <div>
                        <div className="font-medium text-ink">{r.title}</div>
                        {r.failureReasons.length > 0 && (
                          <div className="text-[11px] text-danger">
                            {r.failureReasons.join(' · ')}
                          </div>
                        )}
                      </div>
                    </div>
                    <span className="font-mono text-[11px] tabular-nums text-ink-subtle">
                      {r.engineUsed} · {r.latencyMs} ms
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add Custom Eval Case */}
          <form
            onSubmit={handleAddEvalCase}
            className="grid gap-2.5 rounded-lg border border-line bg-surface p-4 md:grid-cols-[1fr_1.5fr_1fr_auto]"
          >
            <input
              type="text"
              value={newCaseTitle}
              onChange={(e) => setNewCaseTitle(e.target.value)}
              placeholder="Eval name (e.g. Auth rule check)"
              className="min-h-[40px] rounded border border-line-strong bg-inset px-3 text-xs text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
            />
            <input
              type="text"
              value={newCasePrompt}
              onChange={(e) => setNewCasePrompt(e.target.value)}
              placeholder="Test prompt..."
              className="min-h-[40px] rounded border border-line-strong bg-inset px-3 text-xs text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
            />
            <input
              type="text"
              value={newCaseRequired}
              onChange={(e) => setNewCaseRequired(e.target.value)}
              placeholder="Required keywords (comma sep)"
              className="min-h-[40px] rounded border border-line-strong bg-inset px-3 text-xs text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 rounded bg-elevated px-3.5 text-xs font-semibold text-ink hover:bg-accent hover:text-white"
            >
              <PlusCircle className="h-3.5 w-3.5" />
              <span>Add Case</span>
            </button>
          </form>

          {/* Eval Cases Inventory */}
          <div className="space-y-1.5">
            {evalCases.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{c.title}</div>
                  <div className="truncate font-mono text-[11px] text-ink-muted">
                    Prompt: &quot;{c.prompt}&quot; · Require: {c.requiredTerms.join(', ') || 'Safe output'}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Delete eval case"
                  onClick={() => onChangeEvalCases(deleteEvalCase(c.id))}
                  className="inline-flex min-h-[40px] min-w-[40px] shrink-0 items-center justify-center rounded text-ink-subtle hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: RAM & RECURSIVE SELF-OPTIMIZER */}
      {activeTab === 'profiler' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-ink-muted">
              <Cpu className="h-4 w-4 text-accent-text" />
              <span>
                Hardware Engine: <strong className="text-ink">{computeStatus.adapterLabel}</strong>
              </span>
            </div>
            <button
              type="button"
              disabled={isProfiling}
              onClick={() => void refreshProfile()}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded border border-line-strong bg-surface px-3 text-xs font-medium text-ink hover:bg-elevated"
            >
              <Activity className="h-3.5 w-3.5 text-accent-text" />
              <span>{isProfiling ? 'Profiling…' : 'Re-profile RAM & Storage'}</span>
            </button>
          </div>

          {profileError && (
            <div
              role="alert"
              className="rounded-md border border-danger-border bg-danger-soft px-3.5 py-2.5 text-xs text-danger"
            >
              {profileError}
            </div>
          )}

          {optMessage && (
            <div className="rounded-md border border-accent-border bg-accent-soft px-3.5 py-2.5 text-xs text-accent-text">
              {optMessage}
            </div>
          )}

          {profile && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-line bg-surface p-3.5">
                  <div className="text-[11px] text-ink-muted">JS Heap Used</div>
                  <div className="mt-1 font-mono text-base font-semibold tabular-nums text-ink">
                    {formatKb(profile.jsHeapUsedBytes)}
                  </div>
                </div>
                <div className="rounded-lg border border-line bg-surface p-3.5">
                  <div className="text-[11px] text-ink-muted">Int8 Vector Index</div>
                  <div className="mt-1 font-mono text-base font-semibold tabular-nums text-accent-text">
                    {formatKb(profile.vectorInt8Bytes)}
                  </div>
                  <div className="font-mono text-[10px] tabular-nums text-ink-subtle">
                    Saves {formatKb(profile.float32EquivalentBytes - profile.vectorInt8Bytes)} vs Float32
                  </div>
                </div>
                <div className="rounded-lg border border-line bg-surface p-3.5">
                  <div className="text-[11px] text-ink-muted">Knowledge Footprint</div>
                  <div className="mt-1 font-mono text-base font-semibold tabular-nums text-ink">
                    {formatKb(profile.knowledgeBytes)}
                  </div>
                </div>
                <div className="rounded-lg border border-line bg-surface p-3.5">
                  <div className="text-[11px] text-ink-muted">Repo Index Footprint</div>
                  <div className="mt-1 font-mono text-base font-semibold tabular-nums text-ink">
                    {formatKb(profile.repoBytes)}
                  </div>
                </div>
              </div>

              <div className="space-y-2.5">
                <h2 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
                  Self-Optimization Proposals ({proposals.length})
                </h2>

                {proposals.length === 0 ? (
                  <div className="rounded-lg border border-line bg-surface p-5 text-xs text-ink-muted">
                    Clean bill of health — no duplicate clusters, stale bloat, or oversized un-split TypeScript modules detected.
                  </div>
                ) : (
                  proposals.map((prop) => (
                    <div
                      key={prop.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3.5"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] font-semibold text-accent-text uppercase">
                            {prop.kind}
                          </span>
                          <span className="font-mono text-[11px] tabular-nums text-ink-subtle">
                            Est. save {formatKb(prop.estimatedBytesSaved)} · {prop.targetPath}
                          </span>
                        </div>
                        <div className="text-sm font-medium text-ink">{prop.title}</div>
                        <p className="text-xs text-ink-muted">{prop.rationale}</p>
                      </div>

                      {prop.canApplyDirectly ? (
                        <button
                          type="button"
                          onClick={async () => {
                            const kind = prop.id.includes('dup')
                              ? 'prune-duplicates'
                              : 'compact-raw';
                            const affected = await onApplyMemoryOptimize(kind);
                            setOptMessage(
                              `Optimized memory cleanly (${affected} entries updated).`,
                            );
                            await refreshProfile();
                          }}
                          className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover"
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>Run Optimization</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={async () => {
                            await onStageCodeOptimize(
                              prop.targetPath,
                              prop.title,
                              `${prop.rationale} Reduce RAM and bundle size safely without changing behavior.`,
                            );
                            setOptMessage(
                              `Staged self-optimization diff for ${prop.targetPath} in Code & Diffs → Suggestions for your approval.`,
                            );
                          }}
                          className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-accent-border bg-accent-soft px-3.5 py-1.5 text-xs font-semibold text-accent-text hover:bg-accent hover:text-white"
                        >
                          <Wrench className="h-3.5 w-3.5" />
                          <span>Stage Code Opt Diff</span>
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
