import type {Session} from '@supabase/supabase-js';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  RefreshCw,
  WifiOff,
} from 'lucide-react';
import {Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AuthGate} from './components/AuthGate';
import {ChatWorkspace, type StudioComposerMode} from './components/ChatWorkspace';
import {CommandPalette} from './components/CommandPalette';
import {InspectorDrawer} from './components/InspectorDrawer';
import {SchemaSetupBanner} from './components/SchemaSetupBanner';
import {TeachPanel} from './components/TeachPanel';
import {TopBar} from './components/TopBar';
import {
  DEFAULT_BRAIN_MODEL,
  askAiBrainChat,
  distillLessonWithTeacher,
  getLocalBrainConfig,
  getRouteStatus,
  normalizeBrainUrl,
  probeActiveBrainRoute,
  setLocalBrainConfig,
  setStudentIsolationLock,
  subscribeRouteStatus,
  suggestCodeWithAiBrain,
  suggestSemanticFolderWithAi,
  type DistilledKnowledgeItem,
} from './lib/aiBrain';
import {ensureAutoFolderExists, inferFolderDeterministically} from './lib/autoFolders';
import {
  fetchGitHubFileContent,
  fetchGitHubRepoMetadata,
  fetchGitHubTreeFiles,
  getSessionGitHubToken,
  parseGitHubRepoInput,
} from './lib/github';
import {
  applyEntryMetaFallbacks,
  enqueueOfflineWrite,
  formatActionableError,
  getDefaultStatusForSource,
  isDuplicateWithinWindow,
  isLikelyOfflineError,
  isMissingPhase6ColumnError,
  loadOfflineWriteQueue,
  markHashSaved,
  markOfflineWriteForceOverwrite,
  migrateEntryMetaFallback,
  type OfflineQueuedWrite,
  removeOfflineWriteById,
  removeOfflineWritesForEntry,
  resolveGuaranteedFolderId,
  saveEntryMetaFallback,
  saveOfflineWriteQueue,
  unmarkHashSaved,
} from './lib/knowledgeSync';
import {
  autoUnloadBeforeHeavyTask,
  buildAdapterConditionedMessages,
  cancelLocalLlmLoad,
  clearLocalLlmBrowserCache,
  generateWithLocalLlmStream,
  getLocalLlmSpec,
  getLocalLlmState,
  loadLocalLlmModel,
  refreshHardwareTelemetry,
  selectLocalLlmModel,
  stopLocalLlmGeneration,
  subscribeLocalLlmState,
  unloadLocalLlmModel,
} from './lib/localLlmEngine';
import {
  computeKnowledgeGrowth,
  mineKnowledgeFromText,
} from './lib/mantisBrain';
import {STARTER_FOLDERS, computeMemoryReadiness, retrieveRelevantRepoFiles} from './lib/memory';
import {loadModelCard} from './lib/modelExporter';
import {
  buildTrainingExamplesFromWorkspace,
  cloneCheckpointAsProfile,
  createBlankSlateCheckpoint,
  loadNeuralCheckpointState,
  resetNeuralProfileToBlankSlate,
  rollbackToCheckpoint,
} from './lib/neuralStudent';
import {
  deleteScratchSkill,
  loadScratchSkills,
  synthesizeScratchWithHybrid,
  updateScratchSkill,
  upsertScratchSkill,
} from './lib/scratchEngine';
import {
  DEFAULT_MANTIS_REPO,
  buildSelfImprovementDraft,
  fetchMantisSelfSnapshot,
  looksLikeMantisRepo,
  runMantisSelfAudit,
} from './lib/selfImprove';
import {
  generateImprovementSuggestion,
  generateNewCodeSuggestion,
  type GeneratedSuggestionDraft,
} from './lib/suggestions';
import {isMissingTableError, supabase} from './lib/supabase';
import {
  applyThemeAndAccent,
  getNextThemeMode,
  getStoredAccent,
  getStoredTheme,
  normalizeAccentColor,
  normalizeThemeMode,
} from './lib/theme';
import {
  addTrainingSample,
  loadEvalCases,
  loadEvalRuns,
  loadTrainingSamples,
  runStaticCodeSafetyCheck,
} from './lib/trainingStore';
import {
  detectContradictionsAsync,
  getComputeStatus,
  inferNeuralStudentAsync,
  initComputeEngine,
  runHybridRetrievalAsync,
  subscribeComputeStatus,
  trainNeuralStudentAsync,
} from './lib/workerClient';
import type {
  AccentColor,
  AreaId,
  AssassinPrepBrief,
  BrainRouteStatus,
  ChatMessage,
  ChatTurnTelemetry,
  CodeSuggestion,
  ComputeEngineStatus,
  ContradictionAlert,
  EvalCase,
  EvalRunSummary,
  EvalSubView,
  GitHubConnection,
  HardwareTelemetry,
  KnowledgeEntry,
  KnowledgeFolder,
  KnowledgeStatus,
  LearningEvent,
  LearningEventKind,
  LocalLlmEngineState,
  MemorySubView,
  ModelCardConfig,
  NeuralCheckpoint,
  NeuralTrainingExample,
  RepoFile,
  SaveFeedbackInfo,
  ScratchSkillRule,
  SelfAuditFinding,
  SelfAuditReport,
  SelfAuditRun,
  SuggestionKind,
  SuggestionStatus,
  ThemeMode,
  TrainingSample,
  UserPreferences,
  WorkspaceMode,
} from './types/mantis';

const KnowledgeBrowser = lazy(() =>
  import('./components/KnowledgeBrowser').then((m) => ({default: m.KnowledgeBrowser})),
);
const CapturePanel = lazy(() =>
  import('./components/CapturePanel').then((m) => ({default: m.CapturePanel})),
);
const GitHubPanel = lazy(() =>
  import('./components/GitHubPanel').then((m) => ({default: m.GitHubPanel})),
);
const TrainingPanel = lazy(() =>
  import('./components/TrainingPanel').then((m) => ({default: m.TrainingPanel})),
);
const ExportStudioPanel = lazy(() =>
  import('./components/ExportStudioPanel').then((m) => ({default: m.ExportStudioPanel})),
);
const SettingsPanel = lazy(() =>
  import('./components/SettingsPanel').then((m) => ({default: m.SettingsPanel})),
);

function PanelLoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-24 animate-pulse rounded-lg border border-line bg-surface" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-44 animate-pulse rounded-lg border border-line bg-surface" />
        <div className="h-44 animate-pulse rounded-lg border border-line bg-surface" />
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('train');
  const [memorySubView, setMemorySubView] = useState<MemorySubView>('knowledge');
  const [evalSubView, setEvalSubView] = useState<EvalSubView>('training');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [studioSubView, setStudioSubView] = useState<'console' | 'teach'>('console');
  const [studioTab, setStudioTab] = useState<'stream' | 'graph'>('stream');
  const [githubSubTab, setGithubSubTab] = useState<'files' | 'suggestions' | 'self-improve'>('files');

  const [computeStatus, setComputeStatus] = useState<ComputeEngineStatus>(() => getComputeStatus());
  const [activeCheckpoint, setActiveCheckpoint] = useState<NeuralCheckpoint>(() =>
    createBlankSlateCheckpoint(),
  );
  const [checkpoints, setCheckpoints] = useState<NeuralCheckpoint[]>(() => [
    createBlankSlateCheckpoint(),
  ]);
  const [isTrainingNeural, setIsTrainingNeural] = useState(false);
  const [turnTelemetryByMsgId, setTurnTelemetryByMsgId] = useState<Record<string, ChatTurnTelemetry>>(
    {},
  );
  const activeCheckpointRef = useRef<NeuralCheckpoint>(activeCheckpoint);
  useEffect(() => {
    activeCheckpointRef.current = activeCheckpoint;
  }, [activeCheckpoint]);

  const [localLlmState, setLocalLlmState] = useState<LocalLlmEngineState>(() => getLocalLlmState());
  const [hardwareTelemetry, setHardwareTelemetry] = useState<HardwareTelemetry | null>(null);
  const [streamingLocalReply, setStreamingLocalReply] = useState<{
    text: string;
    tokensPerSec: number | null;
    generatedTokens: number;
    modelLabel: string;
  } | null>(null);
  const [openLocalModelsSignal, setOpenLocalModelsSignal] = useState(0);

  const [scratchSkills, setScratchSkills] = useState<ScratchSkillRule[]>(() => loadScratchSkills());
  const [trainingSamples, setTrainingSamples] = useState<TrainingSample[]>(() => loadTrainingSamples());
  const [evalCases, setEvalCases] = useState<EvalCase[]>(() => loadEvalCases());
  const [evalRuns, setEvalRuns] = useState<EvalRunSummary[]>(() => loadEvalRuns());
  const [modelCard, setModelCard] = useState<ModelCardConfig>(() => loadModelCard());
  const [activeAssassinBrief, setActiveAssassinBrief] = useState<AssassinPrepBrief | null>(null);
  const [contradictionAlerts, setContradictionAlerts] = useState<ContradictionAlert[]>([]);
  const [distillingMsgId, setDistillingMsgId] = useState<string | null>(null);
  const [arenaInitialPrompt, setArenaInitialPrompt] = useState<string>('');

  const [folders, setFolders] = useState<KnowledgeFolder[]>([]);
  const foldersRef = useRef<KnowledgeFolder[]>(folders);
  useEffect(() => {
    foldersRef.current = folders;
  }, [folders]);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connection, setConnection] = useState<GitHubConnection | null>(null);
  const [repoFiles, setRepoFiles] = useState<RepoFile[]>([]);
  const [suggestions, setSuggestions] = useState<CodeSuggestion[]>([]);
  const [auditRuns, setAuditRuns] = useState<SelfAuditRun[]>([]);
  const [latestAuditReport, setLatestAuditReport] = useState<SelfAuditReport | null>(null);
  const [learningEvents, setLearningEvents] = useState<LearningEvent[]>([]);

  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [escalatingMsgId, setEscalatingMsgId] = useState<string | null>(null);
  const [isSyncingRepo, setIsSyncingRepo] = useState(false);
  const [syncProgressText, setSyncProgressText] = useState<string | null>(null);
  const [isAuditingSelf, setIsAuditingSelf] = useState(false);
  const [auditProgressText, setAuditProgressText] = useState<string | null>(null);

  const [schemaMissing, setSchemaMissing] = useState(false);
  const [phase2SchemaMissing, setPhase2SchemaMissing] = useState(false);
  const [phase3SchemaMissing, setPhase3SchemaMissing] = useState(false);
  const [phase4SchemaMissing, setPhase4SchemaMissing] = useState(false);
  const [phase5SchemaMissing, setPhase5SchemaMissing] = useState(false);
  const [phase6SchemaMissing, setPhase6SchemaMissing] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedbackInfo>({
    state: 'idle',
    message: '',
  });
  const [offlineQueueItems, setOfflineQueueItems] = useState<OfflineQueuedWrite[]>(() =>
    loadOfflineWriteQueue(),
  );
  const offlineQueueCount = offlineQueueItems.length;
  const retrySaveFnRef = useRef<(() => Promise<void>) | null>(null);
  const feedbackClearTimerRef = useRef<number | null>(null);

  const initialLocalBrain = useMemo(() => getLocalBrainConfig(), []);
  const [brainUrl, setBrainUrl] = useState(initialLocalBrain.brainUrl);
  const [backupBrainUrl, setBackupBrainUrl] = useState(initialLocalBrain.backupBrainUrl);
  const [brainModel, setBrainModel] = useState(initialLocalBrain.model || DEFAULT_BRAIN_MODEL);
  const [autoLearnFromChat, setAutoLearnFromChat] = useState(true);
  const [preferBuiltInFirst, setPreferBuiltInFirst] = useState(
    initialLocalBrain.preferBuiltInFirst,
  );
  const [routeStatus, setRouteStatus] = useState<BrainRouteStatus>(() => getRouteStatus());

  const [highlightedEntryId, setHighlightedEntryId] = useState<string | null>(null);
  const [selectedKnowledgeFolderId, setSelectedKnowledgeFolderId] = useState<string>('all');
  const [selectedRepoPath, setSelectedRepoPath] = useState<string | null>(null);
  const [composerPrefill, setComposerPrefill] = useState<string>('');
  const [teachPrefill, setTeachPrefill] = useState<{
    key: number;
    title: string;
    content: string;
    tags: string;
  }>({key: 0, title: '', content: '', tags: ''});

  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  const [accentColor, setAccentColor] = useState<AccentColor>(() => getStoredAccent());
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('mantis_onboarding_dismissed_v1') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    applyThemeAndAccent(theme, accentColor);
  }, [theme, accentColor]);

  useEffect(() => {
    void initComputeEngine();
    const unsubCompute = subscribeComputeStatus((status) => {
      setComputeStatus(status);
    });
    const unsubLlm = subscribeLocalLlmState((llm) => {
      setLocalLlmState(llm);
    });
    void refreshHardwareTelemetry()
      .then((hw) => setHardwareTelemetry(hw))
      .catch(() => undefined);
    return () => {
      unsubCompute();
      unsubLlm();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void loadNeuralCheckpointState()
      .then((state) => {
        if (!mounted) return;
        activeCheckpointRef.current = state.activeCheckpoint;
        setActiveCheckpoint(state.activeCheckpoint);
        setCheckpoints(state.checkpoints);
      })
      .catch(() => {
        // Retain default blank-slate ckpt-000
      });
    return () => {
      mounted = false;
    };
  }, []);

  const navigateToArea = useCallback((area: AreaId) => {
    setInspectorOpen(false);
    if (area === 'settings') {
      setSettingsOpen(true);
      return;
    }
    setSettingsOpen(false);
    if (area === 'studio') {
      setWorkspaceMode('train');
    } else if (area === 'knowledge') {
      setWorkspaceMode('memory');
      setMemorySubView('knowledge');
    } else if (area === 'ingest') {
      setWorkspaceMode('memory');
      setMemorySubView('capture');
    } else if (area === 'github') {
      setWorkspaceMode('memory');
      setMemorySubView('repo');
    } else if (area === 'training') {
      setWorkspaceMode('evals');
      setEvalSubView('training');
    } else if (area === 'export') {
      setWorkspaceMode('evals');
      setEvalSubView('export');
    }
  }, []);

  const openLocalModelsTab = useCallback(() => {
    navigateToArea('training');
    setOpenLocalModelsSignal((n) => n + 1);
  }, [navigateToArea]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT';

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      } else if (
        (e.metaKey || e.ctrlKey) &&
        (e.key.toLowerCase() === 'i' || e.key.toLowerCase() === 'b')
      ) {
        e.preventDefault();
        setInspectorOpen((prev) => !prev);
      } else if (e.altKey && !isTyping && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setSettingsOpen(false);
        setWorkspaceMode('train');
        setStudioSubView('teach');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const setTransientSaveFeedback = useCallback(
    (info: SaveFeedbackInfo, autoClearMs = 2600) => {
      if (feedbackClearTimerRef.current !== null) {
        window.clearTimeout(feedbackClearTimerRef.current);
        feedbackClearTimerRef.current = null;
      }
      setSaveFeedback(info);
      if (autoClearMs > 0 && (info.state === 'saved' || info.state === 'queued')) {
        feedbackClearTimerRef.current = window.setTimeout(() => {
          setSaveFeedback({state: 'idle', message: ''});
        }, autoClearMs);
      }
    },
    [],
  );

  const pushLearningEvent = useCallback(
    (kind: LearningEventKind, title: string, detail: string, source: string) => {
      setLearningEvents((prev) => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          kind,
          title,
          detail,
          source,
          createdAt: new Date().toISOString(),
        },
        ...prev.slice(0, 29),
      ]);
    },
    [],
  );

  const handleLoadLocalLlm = useCallback(
    async (modelId?: string, allowHighRamOverride = false) => {
      const result = await loadLocalLlmModel(modelId, {allowHighRamOverride});
      const hw = await refreshHardwareTelemetry().catch(() => null);
      if (hw) setHardwareTelemetry(hw);
      if (result.status === 'ready' && result.loadedModelId) {
        const spec = getLocalLlmSpec(result.loadedModelId);
        pushLearningEvent(
          'manual_teach',
          `Loaded ${spec.shortLabel} (${result.activeDevice?.toUpperCase() || 'WASM'})`,
          `${result.activeDtype || spec.dtype} · ~${spec.estimatedRamMb} MB RAM`,
          'local-llm',
        );
      }
    },
    [pushLearningEvent],
  );

  const handleUnloadLocalLlm = useCallback(async () => {
    await unloadLocalLlmModel();
    const hw = await refreshHardwareTelemetry().catch(() => null);
    if (hw) setHardwareTelemetry(hw);
  }, []);

  const handleTrainNeuralBatch = useCallback(
    async (
      epochs = 20,
      extraExamples?: NeuralTrainingExample[],
      customLabel?: string,
    ): Promise<{
      checkpointId: string;
      firstLoss: number;
      lastLoss: number;
      stepsAdded: number;
    } | null> => {
      if (isTrainingNeural) return null;
      const baseExamples = buildTrainingExamplesFromWorkspace({
        trainingSamples,
        scratchSkills,
        entries,
        folders: foldersRef.current,
      });
      const seenPrompts = new Map<string, number>();
      const mergedExamples: NeuralTrainingExample[] = [];
      for (const item of baseExamples) {
        const key = item.prompt.toLowerCase();
        seenPrompts.set(key, mergedExamples.length);
        mergedExamples.push(item);
      }
      for (const extra of extraExamples || []) {
        const cleanPrompt = extra.prompt.trim();
        const cleanResp = extra.response.trim();
        if (!cleanPrompt || !cleanResp) continue;
        const key = cleanPrompt.toLowerCase();
        const normalized: NeuralTrainingExample = {
          prompt: cleanPrompt,
          response: cleanResp,
          folderName: extra.folderName?.trim() || 'Patterns',
          source: extra.source || 'manual',
          entryId: extra.entryId,
          skillId: extra.skillId,
        };
        const existingIdx = seenPrompts.get(key);
        if (existingIdx !== undefined) {
          mergedExamples[existingIdx] = normalized;
        } else {
          seenPrompts.set(key, mergedExamples.length);
          mergedExamples.unshift(normalized);
        }
      }

      if (mergedExamples.length === 0) return null;

      setIsTrainingNeural(true);
      try {
        const result = await trainNeuralStudentAsync({
          checkpoint: activeCheckpointRef.current,
          examples: mergedExamples,
          epochs,
          label:
            customLabel ||
            `Batch (${mergedExamples.length} examples · ${epochs} epochs)`,
          persist: true,
        });
        if (result.stepsAdded > 0) {
          activeCheckpointRef.current = result.checkpoint;
          setActiveCheckpoint(result.checkpoint);
          setCheckpoints(result.checkpoints);
          pushLearningEvent(
            'self_optimized',
            `Trained ${result.checkpoint.id} (+${result.stepsAdded} steps)`,
            `Loss ${result.firstLoss.toFixed(3)} -> ${result.lastLoss.toFixed(3)} · ${result.checkpoint.metrics.vocabSize} BPE tokens`,
            'neural-worker',
          );
        }
        return {
          checkpointId: result.checkpoint.id,
          firstLoss: result.firstLoss,
          lastLoss: result.lastLoss,
          stepsAdded: result.stepsAdded,
        };
      } finally {
        setIsTrainingNeural(false);
      }
    },
    [entries, isTrainingNeural, pushLearningEvent, scratchSkills, trainingSamples],
  );

  const handleRollbackCheckpoint = useCallback(
    async (checkpointId: string) => {
      const next = await rollbackToCheckpoint(checkpointId);
      activeCheckpointRef.current = next.activeCheckpoint;
      setActiveCheckpoint(next.activeCheckpoint);
      setCheckpoints(next.checkpoints);
      pushLearningEvent(
        'self_optimized',
        `Rolled back to ${next.activeCheckpoint.id}`,
        `${next.activeCheckpoint.metrics.stepCount} steps · ${next.activeCheckpoint.metrics.vocabSize} BPE tokens`,
        'checkpoint',
      );
      setTransientSaveFeedback({
        state: 'saved',
        message: `Rolled back to ${next.activeCheckpoint.id} ✓`,
      });
    },
    [pushLearningEvent, setTransientSaveFeedback],
  );

  const handleCloneCheckpoint = useCallback(
    async (checkpointId: string, profileName?: string) => {
      const next = await cloneCheckpointAsProfile(
        checkpointId,
        profileName || `${modelCard.modelName} Fork`,
      );
      activeCheckpointRef.current = next.activeCheckpoint;
      setActiveCheckpoint(next.activeCheckpoint);
      setCheckpoints(next.checkpoints);
      pushLearningEvent(
        'self_optimized',
        `Cloned ${checkpointId} -> ${next.activeCheckpoint.id}`,
        next.activeCheckpoint.profileName,
        'checkpoint',
      );
      setTransientSaveFeedback({
        state: 'saved',
        message: `Cloned profile: ${next.activeCheckpoint.profileName} ✓`,
      });
    },
    [modelCard.modelName, pushLearningEvent, setTransientSaveFeedback],
  );

  const handleResetBlankSlate = useCallback(async () => {
    const next = await resetNeuralProfileToBlankSlate(modelCard.modelName || 'Mantis Student');
    activeCheckpointRef.current = next.activeCheckpoint;
    setActiveCheckpoint(next.activeCheckpoint);
    setCheckpoints(next.checkpoints);
    pushLearningEvent(
      'self_optimized',
      `Reset to blank slate (${next.activeCheckpoint.id})`,
      '0 gradient steps · 0 BPE vocab · zero world knowledge',
      'checkpoint',
    );
    setTransientSaveFeedback({
      state: 'saved',
      message: `Reset to 0 steps (${next.activeCheckpoint.id}) ✓`,
    });
  }, [modelCard.modelName, pushLearningEvent, setTransientSaveFeedback]);

  useEffect(() => {
    return subscribeRouteStatus((next) => {
      setRouteStatus(next);
    });
  }, []);

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getSession().then(({data}) => {
      if (!mounted) return;
      setSession(data.session);
      setAuthReady(true);
    });

    const {data: authListener} = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setAuthReady(true);
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const loadWorkspaceData = useCallback(async (activeSession: Session) => {
    setIsLoadingData(true);
    setErrorBanner(null);

    try {
      const [
        foldersRes,
        entriesRes,
        messagesRes,
        connRes,
        filesRes,
        suggestionsRes,
        auditRunsRes,
        prefsRes,
      ] = await Promise.all([
        supabase.from('knowledge_folders').select('*').order('created_at', {ascending: true}),
        supabase.from('knowledge_entries').select('*').order('updated_at', {ascending: false}),
        supabase.from('chat_messages').select('*').order('created_at', {ascending: true}),
        supabase
          .from('github_connections')
          .select('*')
          .order('updated_at', {ascending: false})
          .limit(1),
        supabase.from('repo_files').select('*').order('path', {ascending: true}),
        supabase.from('code_suggestions').select('*').order('created_at', {ascending: false}),
        supabase.from('self_audit_runs').select('*').order('created_at', {ascending: false}),
        supabase.from('user_preferences').select('*').limit(1),
      ]);

      if (
        isMissingTableError(foldersRes.error) ||
        isMissingTableError(entriesRes.error) ||
        isMissingTableError(messagesRes.error)
      ) {
        setSchemaMissing(true);
        setFolders([]);
        setEntries([]);
        setMessages([]);
        return;
      }

      const phase1Error = foldersRes.error || entriesRes.error || messagesRes.error;
      if (phase1Error) {
        setErrorBanner(phase1Error.message);
        return;
      }

      setSchemaMissing(false);
      let loadedFolders = (foldersRes.data as KnowledgeFolder[]) || [];

      if (loadedFolders.length === 0) {
        const seedRows = STARTER_FOLDERS.map((folder) => ({
          user_id: activeSession.user.id,
          name: folder.name,
          description: folder.description,
        }));
        const {data: seeded, error: seedError} = await supabase
          .from('knowledge_folders')
          .insert(seedRows)
          .select('*');
        if (!seedError && seeded) {
          loadedFolders = seeded as KnowledgeFolder[];
        }
      }

      setFolders(loadedFolders);
      foldersRef.current = loadedFolders;
      const rawEntries = (entriesRes.data as KnowledgeEntry[]) || [];
      const hasPhase6EntryCols =
        rawEntries.length === 0 || 'status' in rawEntries[0] || 'source_url' in rawEntries[0];
      if (!hasPhase6EntryCols) {
        setPhase6SchemaMissing(true);
      } else {
        setPhase6SchemaMissing(false);
      }
      const loadedEntries = applyEntryMetaFallbacks(rawEntries);
      setEntries(loadedEntries);
      setMessages((messagesRes.data as ChatMessage[]) || []);

      if (isMissingTableError(connRes.error) || isMissingTableError(filesRes.error)) {
        setPhase2SchemaMissing(true);
        setConnection(null);
        setRepoFiles([]);
      } else if (connRes.error || filesRes.error) {
        setPhase2SchemaMissing(false);
        setErrorBanner((connRes.error || filesRes.error)?.message || null);
      } else {
        setPhase2SchemaMissing(false);
        const connList = (connRes.data as GitHubConnection[]) || [];
        const activeConn = connList[0] || null;
        setConnection(activeConn);
        const allFiles = (filesRes.data as RepoFile[]) || [];
        setRepoFiles(
          activeConn ? allFiles.filter((f) => f.connection_id === activeConn.id) : [],
        );
      }

      if (isMissingTableError(suggestionsRes.error)) {
        setPhase3SchemaMissing(true);
        setSuggestions([]);
      } else if (suggestionsRes.error) {
        setPhase3SchemaMissing(false);
        setErrorBanner(suggestionsRes.error.message);
      } else {
        setPhase3SchemaMissing(false);
        setSuggestions((suggestionsRes.data as CodeSuggestion[]) || []);
      }

      if (isMissingTableError(auditRunsRes.error)) {
        setPhase4SchemaMissing(true);
        setAuditRuns([]);
      } else if (auditRunsRes.error) {
        setPhase4SchemaMissing(false);
        setErrorBanner(auditRunsRes.error.message);
      } else {
        setPhase4SchemaMissing(false);
        setAuditRuns((auditRunsRes.data as SelfAuditRun[]) || []);
      }

      const localCfg = getLocalBrainConfig();
      let resolvedPrimary = localCfg.brainUrl;
      let resolvedBackup = localCfg.backupBrainUrl;
      let resolvedModel = localCfg.model || DEFAULT_BRAIN_MODEL;
      let resolvedPreferBuiltIn = localCfg.preferBuiltInFirst;

      if (isMissingTableError(prefsRes.error)) {
        setPhase5SchemaMissing(true);
      } else if (!prefsRes.error) {
        setPhase5SchemaMissing(false);
        const prefRow = ((prefsRes.data as UserPreferences[]) || [])[0];
        if (prefRow) {
          resolvedPrimary = prefRow.brain_url || resolvedPrimary;
          resolvedBackup = prefRow.backup_brain_url ?? resolvedBackup;
          resolvedModel = prefRow.preferred_model || resolvedModel;
          resolvedPreferBuiltIn =
            typeof prefRow.prefer_built_in_first === 'boolean'
              ? prefRow.prefer_built_in_first
              : resolvedPreferBuiltIn;
          setBrainUrl(resolvedPrimary);
          setBackupBrainUrl(resolvedBackup);
          setBrainModel(resolvedModel);
          setAutoLearnFromChat(prefRow.auto_learn_from_chat);
          setPreferBuiltInFirst(resolvedPreferBuiltIn);
          setLocalBrainConfig(resolvedPrimary, resolvedModel, resolvedBackup, resolvedPreferBuiltIn);

          if (prefRow.theme || prefRow.accent_color) {
            const nextTheme = normalizeThemeMode(prefRow.theme);
            const nextAccent = normalizeAccentColor(prefRow.accent_color);
            setTheme(nextTheme);
            setAccentColor(nextAccent);
            applyThemeAndAccent(nextTheme, nextAccent);
          } else if (!('theme' in prefRow)) {
            setPhase6SchemaMissing(true);
          }
        }
      }

      // Probe Primary + Chromebook Backup endpoints silently in background so failover happens automatically
      if (resolvedPrimary || resolvedBackup) {
        void probeActiveBrainRoute({
          brainUrl: resolvedPrimary,
          backupBrainUrl: resolvedBackup,
          accessToken: activeSession.access_token,
          preferredModel: resolvedModel,
        });
      }
    } catch (err) {
      setErrorBanner(formatActionableError(err));
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  const flushOfflineQueue = useCallback(async () => {
    if (!session) return;
    const queue = loadOfflineWriteQueue();
    if (queue.length === 0) {
      setOfflineQueueItems([]);
      return;
    }

    const remaining = [...queue];
    const deferred: OfflineQueuedWrite[] = [];
    let flushedCount = 0;

    while (remaining.length > 0) {
      const nextItem = remaining[0];
      try {
        if (nextItem.kind === 'save_entry') {
          let res = await supabase
            .from('knowledge_entries')
            .insert(nextItem.payload)
            .select('id')
            .single();

          if (res.error && isMissingPhase6ColumnError(res.error)) {
            setPhase6SchemaMissing(true);
            const stripped = {...nextItem.payload};
            delete stripped.status;
            delete stripped.source_url;
            delete stripped.extracted_at;
            res = await supabase
              .from('knowledge_entries')
              .insert(stripped)
              .select('id')
              .single();
          }

          if (res.error) {
            if (isLikelyOfflineError(res.error)) break;
            deferred.push({
              ...nextItem,
              retryCount: (nextItem.retryCount || 0) + 1,
              lastError: formatActionableError(res.error),
            });
            remaining.shift();
            continue;
          }

          if (nextItem.optimisticId && res.data?.id) {
            migrateEntryMetaFallback(nextItem.optimisticId, String(res.data.id));
          }
          remaining.shift();
          flushedCount += 1;
        } else if (nextItem.kind === 'update_entry') {
          const {id, ...fields} = nextItem.payload;
          const entryId = String(id);

          if (nextItem.baseUpdatedAt && !nextItem.forceOverwrite) {
            const {data: serverRow, error: checkErr} = await supabase
              .from('knowledge_entries')
              .select('id,title,updated_at')
              .eq('id', entryId)
              .maybeSingle();

            if (checkErr && isLikelyOfflineError(checkErr)) break;
            if (
              serverRow?.updated_at &&
              Date.parse(String(serverRow.updated_at)) > Date.parse(nextItem.baseUpdatedAt) + 1500
            ) {
              deferred.push({
                ...nextItem,
                hasConflict: true,
                conflictServerTitle: String(serverRow.title || ''),
                conflictServerUpdatedAt: String(serverRow.updated_at),
                lastError: 'Server note changed on another device since going offline.',
              });
              remaining.shift();
              continue;
            }
          }

          let {error} = await supabase
            .from('knowledge_entries')
            .update(fields)
            .eq('id', entryId);

          if (error && isMissingPhase6ColumnError(error)) {
            setPhase6SchemaMissing(true);
            const stripped = {...fields};
            delete stripped.status;
            const retryRes = await supabase
              .from('knowledge_entries')
              .update(stripped)
              .eq('id', entryId);
            error = retryRes.error;
          }

          if (error) {
            if (isLikelyOfflineError(error)) break;
            deferred.push({
              ...nextItem,
              retryCount: (nextItem.retryCount || 0) + 1,
              lastError: formatActionableError(error),
            });
            remaining.shift();
            continue;
          }
          remaining.shift();
          flushedCount += 1;
        } else if (nextItem.kind === 'update_status') {
          const {id, status} = nextItem.payload;
          const entryId = String(id);

          if (nextItem.baseUpdatedAt && !nextItem.forceOverwrite) {
            const {data: serverRow, error: checkErr} = await supabase
              .from('knowledge_entries')
              .select('id,title,updated_at')
              .eq('id', entryId)
              .maybeSingle();

            if (checkErr && isLikelyOfflineError(checkErr)) break;
            if (
              serverRow?.updated_at &&
              Date.parse(String(serverRow.updated_at)) > Date.parse(nextItem.baseUpdatedAt) + 1500
            ) {
              deferred.push({
                ...nextItem,
                hasConflict: true,
                conflictServerTitle: String(serverRow.title || ''),
                conflictServerUpdatedAt: String(serverRow.updated_at),
                lastError: 'Server note changed on another device since going offline.',
              });
              remaining.shift();
              continue;
            }
          }

          const {error} = await supabase
            .from('knowledge_entries')
            .update({status})
            .eq('id', entryId);

          if (error) {
            if (isMissingPhase6ColumnError(error)) {
              setPhase6SchemaMissing(true);
              remaining.shift();
              flushedCount += 1;
              continue;
            }
            if (isLikelyOfflineError(error)) break;
            deferred.push({
              ...nextItem,
              retryCount: (nextItem.retryCount || 0) + 1,
              lastError: formatActionableError(error),
            });
            remaining.shift();
            continue;
          }
          remaining.shift();
          flushedCount += 1;
        }
      } catch (err) {
        if (isLikelyOfflineError(err)) break;
        deferred.push({
          ...nextItem,
          retryCount: (nextItem.retryCount || 0) + 1,
          lastError: formatActionableError(err),
        });
        remaining.shift();
      }
    }

    const persisted = [...deferred, ...remaining];
    saveOfflineWriteQueue(persisted);
    setOfflineQueueItems(persisted);

    if (deferred.some((item) => item.hasConflict || item.lastError)) {
      setTransientSaveFeedback(
        {
          state: 'queued',
          message: `${deferred.length} queued ${deferred.length === 1 ? 'write needs' : 'writes need'} review in Settings`,
        },
        4500,
      );
    }

    if (flushedCount > 0) {
      setTransientSaveFeedback({
        state: 'saved',
        message: `Synced ${flushedCount} queued ${flushedCount === 1 ? 'change' : 'changes'} ✓`,
      });
      await loadWorkspaceData(session);
    }
  }, [session, loadWorkspaceData, setTransientSaveFeedback]);

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      void flushOfflineQueue();
    };
    const onOffline = () => {
      setIsOnline(false);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [flushOfflineQueue]);

  useEffect(() => {
    if (session) {
      void loadWorkspaceData(session).then(() => void flushOfflineQueue());
    } else {
      setFolders([]);
      foldersRef.current = [];
      setEntries([]);
      setMessages([]);
      setConnection(null);
      setRepoFiles([]);
      setSuggestions([]);
      setAuditRuns([]);
      setLatestAuditReport(null);
      setLearningEvents([]);
      setSchemaMissing(false);
      setPhase2SchemaMissing(false);
      setPhase3SchemaMissing(false);
      setPhase4SchemaMissing(false);
      setPhase5SchemaMissing(false);
      setPhase6SchemaMissing(false);
      setErrorBanner(null);
    }
  }, [session, loadWorkspaceData, flushOfflineQueue]);

  const metrics = useMemo(
    () =>
      computeMemoryReadiness(
        entries,
        folders,
        messages,
        repoFiles,
        suggestions,
        auditRuns.length,
      ),
    [entries, folders, messages, repoFiles, suggestions, auditRuns.length],
  );

  const knowledgeGrowth = useMemo(() => computeKnowledgeGrowth(entries), [entries]);

  const pendingSuggestionsCount = useMemo(
    () => suggestions.filter((s) => s.status === 'pending').length,
    [suggestions],
  );

  const messagesCountBytes = useMemo(
    () => messages.reduce((sum, m) => sum + m.content.length * 2, 0),
    [messages],
  );

  async function handleCreateFolder(
    name: string,
    description: string,
  ): Promise<KnowledgeFolder | null> {
    if (!session) return null;
    setErrorBanner(null);
    const {data, error} = await supabase
      .from('knowledge_folders')
      .insert({
        user_id: session.user.id,
        name,
        description,
      })
      .select('*')
      .single();

    if (error) {
      setErrorBanner(error.message);
      return null;
    }

    const created = data as KnowledgeFolder;
    foldersRef.current = [...foldersRef.current, created];
    setFolders((prev) => [...prev, created]);
    return created;
  }

  async function handleDeleteFolder(folderId: string): Promise<boolean> {
    if (!session) return false;
    setErrorBanner(null);
    const {error} = await supabase.from('knowledge_folders').delete().eq('id', folderId);
    if (error) {
      setErrorBanner(error.message);
      return false;
    }
    foldersRef.current = foldersRef.current.filter((f) => f.id !== folderId);
    setFolders((prev) => prev.filter((f) => f.id !== folderId));
    setEntries((prev) =>
      prev.map((e) => (e.folder_id === folderId ? {...e, folder_id: null} : e)),
    );
    return true;
  }

  async function handleSaveEntry(payload: {
    title: string;
    content: string;
    folderId: string | null;
    tags: string[];
    source: string;
    status?: KnowledgeStatus;
    sourceUrl?: string | null;
    extractedAt?: string | null;
  }): Promise<boolean> {
    if (!session) return false;
    setErrorBanner(null);

    const cleanTitle = payload.title.trim();
    const cleanContent = payload.content.trim();
    if (!cleanTitle || !cleanContent) {
      setTransientSaveFeedback({state: 'failed', message: 'Failed – Title and content required'}, 0);
      return false;
    }

    const dedupe = isDuplicateWithinWindow(cleanTitle, cleanContent, entries);
    if (dedupe.isDuplicate) {
      setTransientSaveFeedback({state: 'saved', message: 'Saved ✓ (already in memory)'});
      return true;
    }

    // Non-blocking contradiction guard against Trusted & Reviewed entries
    const liveFolders = foldersRef.current;
    void detectContradictionsAsync({
      candidateTitle: cleanTitle,
      candidateContent: cleanContent,
      entries,
      folders: liveFolders,
    }).then((alerts) => {
      if (alerts.length > 0) {
        setContradictionAlerts(alerts);
      }
    });

    markHashSaved(dedupe.hash);
    const nowIso = new Date().toISOString();
    const desiredStatus = payload.status || getDefaultStatusForSource(payload.source);
    let resolvedFolderId = resolveGuaranteedFolderId(payload.folderId, liveFolders);

    if (!resolvedFolderId && liveFolders.length === 0) {
      const createdFolder = await handleCreateFolder('Patterns', 'Default knowledge folder');
      if (createdFolder) {
        resolvedFolderId = createdFolder.id;
      }
    }

    const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const optimisticEntry: KnowledgeEntry = {
      id: optimisticId,
      user_id: session.user.id,
      folder_id: resolvedFolderId,
      title: cleanTitle,
      content: cleanContent,
      tags: payload.tags,
      source: payload.source,
      status: desiredStatus,
      source_url: payload.sourceUrl ?? null,
      extracted_at: payload.extractedAt ?? null,
      recall_count: 0,
      confidence_score: 1,
      created_at: nowIso,
      updated_at: nowIso,
    };

    // Immediate optimistic UI update + Saving feedback
    setEntries((prev) => [optimisticEntry, ...prev]);
    setTransientSaveFeedback({state: 'saving', message: 'Saving…'}, 0);

    const baseInsert = {
      user_id: session.user.id,
      folder_id: resolvedFolderId,
      title: cleanTitle,
      content: cleanContent,
      tags: payload.tags,
      source: payload.source,
    };

    const executeSave = async () => {
      try {
        const insertPayload: Record<string, unknown> = phase6SchemaMissing
          ? baseInsert
          : {
              ...baseInsert,
              status: desiredStatus,
              source_url: payload.sourceUrl ?? null,
              extracted_at: payload.extractedAt ?? null,
            };

        let res = await supabase
          .from('knowledge_entries')
          .insert(insertPayload)
          .select('*')
          .single();

        if (res.error && isMissingPhase6ColumnError(res.error)) {
          setPhase6SchemaMissing(true);
          res = await supabase
            .from('knowledge_entries')
            .insert(baseInsert)
            .select('*')
            .single();
        }

        if (res.error) {
          if (isLikelyOfflineError(res.error)) {
            const nextQ = enqueueOfflineWrite({
              kind: 'save_entry',
              optimisticId,
              payload: insertPayload,
            });
            setOfflineQueueItems(nextQ);
            saveEntryMetaFallback(optimisticId, {
              status: desiredStatus,
              source_url: payload.sourceUrl ?? null,
              extracted_at: payload.extractedAt ?? null,
            });
            setTransientSaveFeedback({
              state: 'queued',
              message: 'Offline — queued to sync',
            });
            return true;
          }

          // Roll back optimistic insert on hard failure
          setEntries((prev) => prev.filter((item) => item.id !== optimisticId));
          unmarkHashSaved(dedupe.hash);
          const friendly = formatActionableError(res.error);
          setErrorBanner(friendly);
          retrySaveFnRef.current = async () => {
            await handleSaveEntry(payload);
          };
          setTransientSaveFeedback(
            {state: 'failed', message: 'Failed – Retry', canRetry: true},
            0,
          );
          return false;
        }

        const inserted = res.data as KnowledgeEntry;
        saveEntryMetaFallback(inserted.id, {
          status: inserted.status || desiredStatus,
          source_url: inserted.source_url ?? payload.sourceUrl ?? null,
          extracted_at: inserted.extracted_at ?? payload.extractedAt ?? null,
        });
        const hydrated = applyEntryMetaFallbacks([inserted])[0];

        setEntries((prev) => prev.map((item) => (item.id === optimisticId ? hydrated : item)));
        pushLearningEvent(
          'manual_teach',
          hydrated.title,
          hydrated.content.slice(0, 90),
          payload.source,
        );
        retrySaveFnRef.current = null;
        setTransientSaveFeedback({state: 'saved', message: 'Saved ✓'});
        return true;
      } catch (err) {
        if (isLikelyOfflineError(err)) {
          const nextQ = enqueueOfflineWrite({
            kind: 'save_entry',
            optimisticId,
            payload: baseInsert,
          });
          setOfflineQueueItems(nextQ);
          saveEntryMetaFallback(optimisticId, {
            status: desiredStatus,
            source_url: payload.sourceUrl ?? null,
            extracted_at: payload.extractedAt ?? null,
          });
          setTransientSaveFeedback({state: 'queued', message: 'Offline — queued to sync'});
          return true;
        }
        setEntries((prev) => prev.filter((item) => item.id !== optimisticId));
        unmarkHashSaved(dedupe.hash);
        setErrorBanner(formatActionableError(err));
        retrySaveFnRef.current = async () => {
          await handleSaveEntry(payload);
        };
        setTransientSaveFeedback({state: 'failed', message: 'Failed – Retry', canRetry: true}, 0);
        return false;
      }
    };

    return executeSave();
  }

  async function handleUpdateEntry(
    id: string,
    payload: {
      title: string;
      content: string;
      folderId: string | null;
      tags: string[];
      status?: KnowledgeStatus;
    },
  ): Promise<boolean> {
    if (!session) return false;
    setErrorBanner(null);

    const prevSnapshot = entries.find((item) => item.id === id);
    if (!prevSnapshot) return false;

    const guaranteedFolderId = payload.folderId
      ? resolveGuaranteedFolderId(payload.folderId, foldersRef.current)
      : null;

    const optimisticUpdated: KnowledgeEntry = {
      ...prevSnapshot,
      title: payload.title,
      content: payload.content,
      folder_id: guaranteedFolderId,
      tags: payload.tags,
      status: payload.status ?? prevSnapshot.status,
      updated_at: new Date().toISOString(),
    };

    setEntries((prev) => prev.map((item) => (item.id === id ? optimisticUpdated : item)));
    setTransientSaveFeedback({state: 'saving', message: 'Saving…'}, 0);

    const baseUpdate = {
      title: payload.title,
      content: payload.content,
      folder_id: guaranteedFolderId,
      tags: payload.tags,
    };

    if (id.startsWith('optimistic-')) {
      const nextQ = enqueueOfflineWrite({
        kind: 'update_entry',
        baseUpdatedAt: prevSnapshot.updated_at,
        payload: {id, ...baseUpdate, ...(payload.status ? {status: payload.status} : {})},
      });
      setOfflineQueueItems(nextQ);
      if (payload.status) saveEntryMetaFallback(id, {status: payload.status});
      setTransientSaveFeedback({state: 'queued', message: 'Updated in offline queue ✓'});
      return true;
    }

    try {
      let res = await supabase
        .from('knowledge_entries')
        .update(
          phase6SchemaMissing || !payload.status
            ? baseUpdate
            : {...baseUpdate, status: payload.status},
        )
        .eq('id', id)
        .select('*')
        .single();

      if (res.error && isMissingPhase6ColumnError(res.error)) {
        setPhase6SchemaMissing(true);
        res = await supabase
          .from('knowledge_entries')
          .update(baseUpdate)
          .eq('id', id)
          .select('*')
          .single();
      }

      if (res.error) {
        if (isLikelyOfflineError(res.error)) {
          const nextQ = enqueueOfflineWrite({
            kind: 'update_entry',
            baseUpdatedAt: prevSnapshot.updated_at,
            payload: {id, ...baseUpdate, ...(payload.status ? {status: payload.status} : {})},
          });
          setOfflineQueueItems(nextQ);
          if (payload.status) saveEntryMetaFallback(id, {status: payload.status});
          setTransientSaveFeedback({state: 'queued', message: 'Offline — queued to sync'});
          return true;
        }
        setEntries((prev) => prev.map((item) => (item.id === id ? prevSnapshot : item)));
        setErrorBanner(formatActionableError(res.error));
        retrySaveFnRef.current = async () => {
          await handleUpdateEntry(id, payload);
        };
        setTransientSaveFeedback({state: 'failed', message: 'Failed – Retry', canRetry: true}, 0);
        return false;
      }

      const rawUpdated = res.data as KnowledgeEntry;
      if (payload.status) {
        saveEntryMetaFallback(id, {status: rawUpdated.status || payload.status});
      }
      const hydrated = applyEntryMetaFallbacks([rawUpdated])[0];
      setEntries((prev) => prev.map((item) => (item.id === id ? hydrated : item)));
      void detectContradictionsAsync({
        candidateTitle: hydrated.title,
        candidateContent: hydrated.content,
        newEntryId: hydrated.id,
        excludeEntryId: hydrated.id,
        entries,
        folders: foldersRef.current,
      }).then((alerts) => {
        if (alerts.length > 0) {
          setContradictionAlerts(alerts);
        }
      });
      retrySaveFnRef.current = null;
      setTransientSaveFeedback({state: 'saved', message: 'Saved ✓'});
      return true;
    } catch (err) {
      if (isLikelyOfflineError(err)) {
        const nextQ = enqueueOfflineWrite({
          kind: 'update_entry',
          baseUpdatedAt: prevSnapshot.updated_at,
          payload: {id, ...baseUpdate, ...(payload.status ? {status: payload.status} : {})},
        });
        setOfflineQueueItems(nextQ);
        if (payload.status) saveEntryMetaFallback(id, {status: payload.status});
        setTransientSaveFeedback({state: 'queued', message: 'Offline — queued to sync'});
        return true;
      }
      setEntries((prev) => prev.map((item) => (item.id === id ? prevSnapshot : item)));
      setErrorBanner(formatActionableError(err));
      retrySaveFnRef.current = async () => {
        await handleUpdateEntry(id, payload);
      };
      setTransientSaveFeedback({state: 'failed', message: 'Failed – Retry', canRetry: true}, 0);
      return false;
    }
  }

  async function handleUpdateEntryStatus(
    id: string,
    nextStatus: KnowledgeStatus,
  ): Promise<boolean> {
    if (!session) return false;
    const prevSnapshot = entries.find((item) => item.id === id);
    if (!prevSnapshot) return false;

    setEntries((prev) =>
      prev.map((item) => (item.id === id ? {...item, status: nextStatus} : item)),
    );
    saveEntryMetaFallback(id, {status: nextStatus});
    setTransientSaveFeedback({state: 'saving', message: 'Saving…'}, 0);

    if (id.startsWith('optimistic-')) {
      const nextQ = enqueueOfflineWrite({
        kind: 'update_status',
        baseUpdatedAt: prevSnapshot.updated_at,
        payload: {id, status: nextStatus},
      });
      setOfflineQueueItems(nextQ);
      setTransientSaveFeedback({
        state: 'queued',
        message: nextStatus === 'trusted' ? 'Trusted in offline queue ✓' : 'Queued ✓',
      });
      return true;
    }

    if (phase6SchemaMissing) {
      setTransientSaveFeedback({
        state: 'saved',
        message: nextStatus === 'trusted' ? 'Marked Trusted ✓' : 'Saved ✓',
      });
      return true;
    }

    try {
      const {error} = await supabase
        .from('knowledge_entries')
        .update({status: nextStatus})
        .eq('id', id);

      if (error) {
        if (isMissingPhase6ColumnError(error)) {
          setPhase6SchemaMissing(true);
          setTransientSaveFeedback({
            state: 'saved',
            message: nextStatus === 'trusted' ? 'Marked Trusted ✓' : 'Saved ✓',
          });
          return true;
        }
        if (isLikelyOfflineError(error)) {
          const nextQ = enqueueOfflineWrite({
            kind: 'update_status',
            baseUpdatedAt: prevSnapshot.updated_at,
            payload: {id, status: nextStatus},
          });
          setOfflineQueueItems(nextQ);
          setTransientSaveFeedback({state: 'queued', message: 'Offline — queued to sync'});
          return true;
        }
        setEntries((prev) => prev.map((item) => (item.id === id ? prevSnapshot : item)));
        saveEntryMetaFallback(id, {status: prevSnapshot.status});
        setErrorBanner(formatActionableError(error));
        retrySaveFnRef.current = async () => {
          await handleUpdateEntryStatus(id, nextStatus);
        };
        setTransientSaveFeedback({state: 'failed', message: 'Failed – Retry', canRetry: true}, 0);
        return false;
      }

      setTransientSaveFeedback({
        state: 'saved',
        message: nextStatus === 'trusted' ? 'Marked Trusted ✓' : 'Saved ✓',
      });
      return true;
    } catch (err) {
      if (isLikelyOfflineError(err)) {
        const nextQ = enqueueOfflineWrite({
          kind: 'update_status',
          baseUpdatedAt: prevSnapshot.updated_at,
          payload: {id, status: nextStatus},
        });
        setOfflineQueueItems(nextQ);
        setTransientSaveFeedback({state: 'queued', message: 'Offline — queued to sync'});
        return true;
      }
      setEntries((prev) => prev.map((item) => (item.id === id ? prevSnapshot : item)));
      setErrorBanner(formatActionableError(err));
      setTransientSaveFeedback({state: 'failed', message: 'Failed – Retry', canRetry: true}, 0);
      return false;
    }
  }

  async function handleDeleteEntry(id: string): Promise<boolean> {
    if (!session) return false;
    setErrorBanner(null);

    const prevSnapshot = entries.find((item) => item.id === id);
    setEntries((prev) => prev.filter((item) => item.id !== id));

    if (id.startsWith('optimistic-')) {
      setOfflineQueueItems(removeOfflineWritesForEntry(id));
      return true;
    }

    const {error} = await supabase.from('knowledge_entries').delete().eq('id', id);
    if (error) {
      if (prevSnapshot) {
        setEntries((prev) => [prevSnapshot, ...prev]);
      }
      setErrorBanner(formatActionableError(error));
      setTransientSaveFeedback({state: 'failed', message: 'Failed – Retry'}, 0);
      return false;
    }

    setOfflineQueueItems(removeOfflineWritesForEntry(id));
    setTransientSaveFeedback({state: 'saved', message: 'Deleted ✓'});
    return true;
  }

  async function persistSuggestionDraft(
    draft: GeneratedSuggestionDraft,
    kind: SuggestionKind = 'code_help',
  ): Promise<CodeSuggestion | null> {
    if (!session) return null;
    setErrorBanner(null);
    const insertPayload: Record<string, unknown> = {
      user_id: session.user.id,
      connection_id: connection?.id || null,
      file_path: draft.filePath,
      title: draft.title,
      rationale: draft.rationale,
      original_content: draft.originalContent,
      proposed_content: draft.proposedContent,
      status: 'pending',
      user_feedback: '',
      pr_url: '',
    };
    if (!phase4SchemaMissing) {
      insertPayload.suggestion_kind = kind;
    }

    const {data, error} = await supabase
      .from('code_suggestions')
      .insert(insertPayload)
      .select('*')
      .single();

    if (error) {
      if (isMissingTableError(error)) {
        setPhase3SchemaMissing(true);
      } else {
        setErrorBanner(error.message);
      }
      return null;
    }

    const saved = data as CodeSuggestion;
    setSuggestions((prev) => [saved, ...prev]);
    return saved;
  }

  async function handleSelectAppearance(nextTheme: ThemeMode, nextAccent: AccentColor) {
    const safeTheme = normalizeThemeMode(nextTheme);
    const safeAccent = normalizeAccentColor(nextAccent);
    setTheme(safeTheme);
    setAccentColor(safeAccent);
    applyThemeAndAccent(safeTheme, safeAccent);

    if (!session || phase5SchemaMissing || phase6SchemaMissing) return;
    const {error} = await supabase.from('user_preferences').upsert(
      {
        user_id: session.user.id,
        brain_url: brainUrl,
        backup_brain_url: backupBrainUrl,
        preferred_model: brainModel,
        auto_learn_from_chat: autoLearnFromChat,
        prefer_built_in_first: preferBuiltInFirst,
        theme: safeTheme,
        accent_color: safeAccent,
      },
      {onConflict: 'user_id'},
    );
    if (error && isMissingPhase6ColumnError(error)) {
      setPhase6SchemaMissing(true);
    }
  }

  async function handleSaveBrainConfig(
    url: string,
    backupUrl: string,
    model: string,
    autoLearn: boolean,
    preferBuiltIn: boolean,
  ) {
    const cleanPrimary = normalizeBrainUrl(url);
    const cleanBackup = normalizeBrainUrl(backupUrl);
    setBrainUrl(cleanPrimary);
    setBackupBrainUrl(cleanBackup);
    setBrainModel(model);
    setAutoLearnFromChat(autoLearn);
    setPreferBuiltInFirst(preferBuiltIn);
    setLocalBrainConfig(cleanPrimary, model, cleanBackup, preferBuiltIn);

    if (!session) return;

    const fullPayload = {
      user_id: session.user.id,
      brain_url: cleanPrimary,
      backup_brain_url: cleanBackup,
      preferred_model: model,
      auto_learn_from_chat: autoLearn,
      prefer_built_in_first: preferBuiltIn,
      ...(phase6SchemaMissing ? {} : {theme, accent_color: accentColor}),
    };

    const {error} = await supabase.from('user_preferences').upsert(fullPayload, {
      onConflict: 'user_id',
    });

    if (!error) {
      setPhase5SchemaMissing(false);
      return;
    }

    if (isMissingTableError(error)) {
      setPhase5SchemaMissing(true);
      return;
    }

    // Graceful backward compatibility if Phase 5 or Phase 6 preference columns haven't been added
    if (
      error.message.includes('backup_brain_url') ||
      error.message.includes('prefer_built_in_first') ||
      isMissingPhase6ColumnError(error)
    ) {
      await supabase.from('user_preferences').upsert(
        {
          user_id: session.user.id,
          brain_url: cleanPrimary,
          preferred_model: model,
          auto_learn_from_chat: autoLearn,
        },
        {onConflict: 'user_id'},
      );
    }
  }

  async function handleTogglePreferBuiltIn(next: boolean) {
    setPreferBuiltInFirst(next);
    setLocalBrainConfig(brainUrl, brainModel, backupBrainUrl, next);
    if (!session || phase5SchemaMissing) return;
    await supabase
      .from('user_preferences')
      .update({prefer_built_in_first: next})
      .eq('user_id', session.user.id);
  }

  async function handleSaveCapturedEntries(
    items: DistilledKnowledgeItem[],
    sourceType: string,
    meta?: {status?: KnowledgeStatus; sourceUrl?: string | null; extractedAt?: string | null},
  ): Promise<number> {
    if (!session || items.length === 0) return 0;
    setErrorBanner(null);

    let activeFolders = [...foldersRef.current];
    const desiredStatus = meta?.status || getDefaultStatusForSource(sourceType);
    const basePrepared: Array<{
      baseRow: {
        user_id: string;
        folder_id: string | null;
        title: string;
        content: string;
        tags: string[];
        source: string;
      };
      hash: string;
    }> = [];

    for (const item of items) {
      const cleanTitle = item.title.trim().slice(0, 120);
      const cleanContent = item.content.trim();
      if (!cleanTitle || !cleanContent) continue;

      const dedupe = isDuplicateWithinWindow(cleanTitle, cleanContent, entries);
      if (dedupe.isDuplicate) continue;
      markHashSaved(dedupe.hash);

      const inferred = inferFolderDeterministically(
        cleanTitle,
        cleanContent,
        activeFolders,
        item.folder,
      );
      const ensured = await ensureAutoFolderExists(
        inferred.folderName,
        inferred.description,
        activeFolders,
        handleCreateFolder,
      );
      activeFolders = ensured.updatedFolders;

      const guaranteedFolderId = resolveGuaranteedFolderId(ensured.folder?.id, activeFolders);

      basePrepared.push({
        hash: dedupe.hash,
        baseRow: {
          user_id: session.user.id,
          folder_id: guaranteedFolderId,
          title: cleanTitle,
          content: cleanContent,
          tags: Array.from(
            new Set(
              [...item.tags, ...inferred.suggestedTags]
                .map((t) => t.trim().toLowerCase())
                .filter(Boolean),
            ),
          ),
          source: sourceType,
        },
      });
    }

    if (basePrepared.length === 0) return 0;

    setTransientSaveFeedback({state: 'saving', message: 'Saving…'}, 0);
    const nowIso = new Date().toISOString();
    const optimisticRows: KnowledgeEntry[] = basePrepared.map((p, idx) => ({
      id: `optimistic-cap-${Date.now()}-${idx}`,
      ...p.baseRow,
      status: desiredStatus,
      source_url: meta?.sourceUrl ?? null,
      extracted_at: meta?.extractedAt ?? null,
      recall_count: 0,
      confidence_score: 1,
      created_at: nowIso,
      updated_at: nowIso,
    }));

    setEntries((prev) => [...optimisticRows, ...prev]);

    try {
      let res = await supabase
        .from('knowledge_entries')
        .insert(
          basePrepared.map((p) =>
            phase6SchemaMissing
              ? p.baseRow
              : {
                  ...p.baseRow,
                  status: desiredStatus,
                  source_url: meta?.sourceUrl ?? null,
                  extracted_at: meta?.extractedAt ?? null,
                },
          ),
        )
        .select('*');

      if (res.error && isMissingPhase6ColumnError(res.error)) {
        setPhase6SchemaMissing(true);
        res = await supabase
          .from('knowledge_entries')
          .insert(basePrepared.map((p) => p.baseRow))
          .select('*');
      }

      if (res.error) {
        for (const p of basePrepared) unmarkHashSaved(p.hash);
        if (isLikelyOfflineError(res.error)) {
          let latestQ = loadOfflineWriteQueue();
          for (let idx = 0; idx < basePrepared.length; idx += 1) {
            const p = basePrepared[idx];
            const optId = optimisticRows[idx]?.id;
            if (optId) {
              saveEntryMetaFallback(optId, {
                status: desiredStatus,
                source_url: meta?.sourceUrl ?? null,
                extracted_at: meta?.extractedAt ?? null,
              });
            }
            latestQ = enqueueOfflineWrite({
              kind: 'save_entry',
              optimisticId: optId,
              payload: {
                ...p.baseRow,
                status: desiredStatus,
                source_url: meta?.sourceUrl ?? null,
                extracted_at: meta?.extractedAt ?? null,
              },
            });
          }
          setOfflineQueueItems(latestQ);
          setTransientSaveFeedback({state: 'queued', message: 'Offline — queued to sync'});
          return basePrepared.length;
        }
        const optIds = new Set(optimisticRows.map((o) => o.id));
        setEntries((prev) => prev.filter((item) => !optIds.has(item.id)));
        setErrorBanner(formatActionableError(res.error));
        setTransientSaveFeedback({state: 'failed', message: 'Failed – Retry'}, 0);
        return 0;
      }

      const savedRaw = (res.data as KnowledgeEntry[]) || [];
      for (const row of savedRaw) {
        saveEntryMetaFallback(row.id, {
          status: row.status || desiredStatus,
          source_url: row.source_url ?? meta?.sourceUrl ?? null,
          extracted_at: row.extracted_at ?? meta?.extractedAt ?? null,
        });
      }
      const hydratedSaved = applyEntryMetaFallbacks(savedRaw);
      const optIds = new Set(optimisticRows.map((o) => o.id));
      setEntries((prev) => [...hydratedSaved, ...prev.filter((item) => !optIds.has(item.id))]);

      const kind: LearningEventKind = sourceType.includes('youtube') || sourceType.includes('article')
        ? 'url_ingested'
        : sourceType.includes('mic')
          ? 'voice_captured'
          : sourceType.includes('ocr')
            ? 'ocr_distilled'
            : 'auto_mined';

      for (const row of hydratedSaved.slice(0, 3)) {
        pushLearningEvent(kind, row.title, row.content.slice(0, 85), sourceType);
      }

      setTransientSaveFeedback({state: 'saved', message: 'Saved ✓'});
      return hydratedSaved.length;
    } catch (err) {
      for (const p of basePrepared) unmarkHashSaved(p.hash);
      if (isLikelyOfflineError(err)) {
        let latestQ = loadOfflineWriteQueue();
        for (let idx = 0; idx < basePrepared.length; idx += 1) {
          const p = basePrepared[idx];
          const optId = optimisticRows[idx]?.id;
          if (optId) {
            saveEntryMetaFallback(optId, {
              status: desiredStatus,
              source_url: meta?.sourceUrl ?? null,
              extracted_at: meta?.extractedAt ?? null,
            });
          }
          latestQ = enqueueOfflineWrite({
            kind: 'save_entry',
            optimisticId: optId,
            payload: {
              ...p.baseRow,
              status: desiredStatus,
              source_url: meta?.sourceUrl ?? null,
              extracted_at: meta?.extractedAt ?? null,
            },
          });
        }
        setOfflineQueueItems(latestQ);
        setTransientSaveFeedback({state: 'queued', message: 'Offline — queued to sync'});
        return basePrepared.length;
      }
      const optIds = new Set(optimisticRows.map((o) => o.id));
      setEntries((prev) => prev.filter((item) => !optIds.has(item.id)));
      setErrorBanner(formatActionableError(err));
      setTransientSaveFeedback({state: 'failed', message: 'Failed – Retry'}, 0);
      return 0;
    }
  }

  async function handleReinforceEntries(entryIds: string[]) {
    if (!session || entryIds.length === 0) return;
    setEntries((prev) =>
      prev.map((e) =>
        entryIds.includes(e.id)
          ? {
              ...e,
              recall_count: (e.recall_count || 0) + 1,
              confidence_score: (e.confidence_score || 1) + 1,
            }
          : e,
      ),
    );
    pushLearningEvent(
      'reinforced',
      `Boosted ${entryIds.length} ${entryIds.length === 1 ? 'memory' : 'memories'}`,
      'Marked helpful during Studio session',
      'studio',
    );
    if (phase5SchemaMissing) return;
    await Promise.all(
      entryIds
        .filter((id) => !id.startsWith('optimistic-'))
        .map(async (id) => {
          const current = entries.find((e) => e.id === id);
          if (!current) return;
          await supabase
            .from('knowledge_entries')
            .update({
              recall_count: (current.recall_count || 0) + 1,
              confidence_score: (current.confidence_score || 1) + 1,
            })
            .eq('id', id);
        }),
    );
  }

  async function handleGenerateFromFile(file: RepoFile, goal: string) {
    let draft = generateImprovementSuggestion(file, goal, entries, folders);
    if ((brainUrl.trim() || backupBrainUrl.trim()) && session?.access_token) {
      try {
        const aiDraft = await suggestCodeWithAiBrain({
          brainUrl,
          backupBrainUrl,
          accessToken: session.access_token,
          model: brainModel,
          filePath: file.path,
          originalContent: file.content,
          goal: goal || 'Improve code safety, reliability, tablet UX, and clarity',
          entries,
          folders,
        });
        if (aiDraft.proposedContent.trim()) {
          draft = {
            ...draft,
            title: aiDraft.title,
            rationale: `${aiDraft.rationale} (Assist: ${aiDraft.model})`,
            proposedContent: aiDraft.proposedContent,
          };
          pushLearningEvent('cloud_assisted', `Code Diff: ${file.path}`, aiDraft.title, 'github');
        }
      } catch {
        // Fallback smoothly to deterministic static analyzer
      }
    }
    await persistSuggestionDraft(draft, 'code_help');
  }

  async function handleGenerateNewFile(targetPath: string, goal: string) {
    let draft = generateNewCodeSuggestion(targetPath, goal, entries, folders);
    if ((brainUrl.trim() || backupBrainUrl.trim()) && session?.access_token) {
      try {
        const aiDraft = await suggestCodeWithAiBrain({
          brainUrl,
          backupBrainUrl,
          accessToken: session.access_token,
          model: brainModel,
          filePath: targetPath,
          originalContent: '',
          goal: goal || 'Create a clean, well-typed module following user Knowledge rules',
          entries,
          folders,
        });
        if (aiDraft.proposedContent.trim()) {
          draft = {
            ...draft,
            title: aiDraft.title,
            rationale: `${aiDraft.rationale} (Assist: ${aiDraft.model})`,
            proposedContent: aiDraft.proposedContent,
          };
        }
      } catch {
        // Fallback smoothly to deterministic scaffold
      }
    }
    await persistSuggestionDraft(draft, 'code_help');
  }

  async function handleRunSelfAudit(repoInput?: string): Promise<SelfAuditReport> {
    const parsed = parseGitHubRepoInput(repoInput || DEFAULT_MANTIS_REPO);
    if (!parsed) {
      throw new Error(
        'Enter a valid GitHub repository as owner/repo (e.g. studiosmobile092-code/Mantis).',
      );
    }

    setIsAuditingSelf(true);
    setAuditProgressText(`Starting guarded inspection of ${parsed.owner}/${parsed.repo}...`);
    setErrorBanner(null);

    try {
      const canUseIndexedFiles =
        connection &&
        connection.owner.toLowerCase() === parsed.owner.toLowerCase() &&
        connection.repo.toLowerCase() === parsed.repo.toLowerCase() &&
        repoFiles.length > 0 &&
        looksLikeMantisRepo(repoFiles);

      let targetRepoLabel = `${parsed.owner}/${parsed.repo}`;
      let targetBranch = connection?.branch || 'main';
      let targetFiles = repoFiles;

      if (!canUseIndexedFiles) {
        const snapshot = await fetchMantisSelfSnapshot(
          parsed.owner,
          parsed.repo,
          undefined,
          getSessionGitHubToken() || undefined,
          setAuditProgressText,
        );
        targetRepoLabel = snapshot.repoLabel;
        targetBranch = snapshot.branch;
        targetFiles = snapshot.files;
      }

      setAuditProgressText(`Scanning ${targetFiles.length} project files against safety & UX rules...`);
      const report = runMantisSelfAudit(
        targetFiles,
        targetRepoLabel,
        targetBranch,
        entries,
        folders,
      );
      setLatestAuditReport(report);

      if (session && !phase4SchemaMissing) {
        const summary =
          report.findings.length === 0
            ? 'Clean scan — 0 issues detected.'
            : `${report.findings.length} guarded findings (${report.findings.filter((f) => f.severity === 'high').length} high).`;
        const {data: savedRun, error: runErr} = await supabase
          .from('self_audit_runs')
          .insert({
            user_id: session.user.id,
            repo_label: report.repoLabel,
            branch: report.branch,
            files_scanned: report.filesScanned,
            findings_count: report.findings.length,
            health_score: report.healthScore,
            summary,
          })
          .select('*')
          .single();

        if (!runErr && savedRun) {
          setAuditRuns((prev) => [savedRun as SelfAuditRun, ...prev]);
        }
      }

      setAuditProgressText(
        `Audit complete: ${report.filesScanned} files scanned, ${report.findings.length} findings, Health ${report.healthScore}/100.`,
      );
      return report;
    } finally {
      setIsAuditingSelf(false);
    }
  }

  async function handleStageAuditFinding(finding: SelfAuditFinding) {
    const draft = buildSelfImprovementDraft(finding, entries, folders);
    await persistSuggestionDraft(draft, 'self_improvement');
  }

  async function handleUpdateProposedContent(
    id: string,
    proposedContent: string,
  ): Promise<boolean> {
    if (!session) return false;
    setErrorBanner(null);
    const {data, error} = await supabase
      .from('code_suggestions')
      .update({proposed_content: proposedContent})
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      setErrorBanner(error.message);
      return false;
    }

    const updated = data as CodeSuggestion;
    setSuggestions((prev) => prev.map((s) => (s.id === id ? updated : s)));
    return true;
  }

  async function handleReviewSuggestion(
    id: string,
    status: SuggestionStatus,
    feedback: string,
    prUrl?: string,
  ): Promise<boolean> {
    if (!session) return false;
    setErrorBanner(null);
    const patch: Record<string, unknown> = {
      status,
      user_feedback: feedback,
    };
    if (prUrl !== undefined) {
      patch.pr_url = prUrl;
    }

    const {data, error} = await supabase
      .from('code_suggestions')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      setErrorBanner(error.message);
      return false;
    }

    const updated = data as CodeSuggestion;
    setSuggestions((prev) => prev.map((s) => (s.id === id ? updated : s)));
    return true;
  }

  async function handleDeleteSuggestion(id: string): Promise<boolean> {
    if (!session) return false;
    setErrorBanner(null);
    const {error} = await supabase.from('code_suggestions').delete().eq('id', id);
    if (error) {
      setErrorBanner(error.message);
      return false;
    }
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
    return true;
  }

  async function handleConnectGitHubRepo(
    owner: string,
    repo: string,
    branchOverride?: string,
    token?: string,
  ) {
    if (!session) return;
    setIsSyncingRepo(true);
    setSyncProgressText(`Connecting to ${owner}/${repo}...`);
    setErrorBanner(null);

    try {
      const meta = await fetchGitHubRepoMetadata(owner, repo, token);
      const targetBranch = branchOverride || meta.defaultBranch;

      setSyncProgressText(`Scanning file tree on branch "${targetBranch}"...`);
      const treeFiles = await fetchGitHubTreeFiles(owner, repo, targetBranch, token, 40);

      const downloaded: Array<{path: string; sha: string; size_bytes: number; content: string}> =
        [];
      const batchSize = 5;

      for (let i = 0; i < treeFiles.length; i += batchSize) {
        const batch = treeFiles.slice(i, i + batchSize);
        setSyncProgressText(
          `Indexing ${Math.min(i + batch.length, treeFiles.length)} / ${treeFiles.length} source files...`,
        );
        const results = await Promise.allSettled(
          batch.map(async (f) => {
            const content = await fetchGitHubFileContent(
              owner,
              repo,
              targetBranch,
              f.path,
              meta.isPrivate,
              token,
            );
            return {
              path: f.path,
              sha: f.sha,
              size_bytes: f.size,
              content,
            };
          }),
        );
        for (const r of results) {
          if (r.status === 'fulfilled') {
            downloaded.push(r.value);
          }
        }
      }

      setSyncProgressText('Saving repository index to Supabase...');

      await supabase.from('github_connections').delete().eq('user_id', session.user.id);

      const {data: newConn, error: connErr} = await supabase
        .from('github_connections')
        .insert({
          user_id: session.user.id,
          owner: meta.owner,
          repo: meta.repo,
          branch: targetBranch,
          description: meta.description,
          is_private: meta.isPrivate,
          last_synced_at: new Date().toISOString(),
        })
        .select('*')
        .single();

      if (connErr) {
        throw new Error(connErr.message);
      }

      const createdConn = newConn as GitHubConnection;
      let savedFiles: RepoFile[] = [];

      if (downloaded.length > 0) {
        const rows = downloaded.map((item) => ({
          user_id: session.user.id,
          connection_id: createdConn.id,
          path: item.path,
          size_bytes: item.size_bytes,
          sha: item.sha,
          content: item.content,
        }));
        const {data: insertedFiles, error: filesErr} = await supabase
          .from('repo_files')
          .insert(rows)
          .select('*');
        if (filesErr) {
          throw new Error(filesErr.message);
        }
        savedFiles = ((insertedFiles as RepoFile[]) || []).sort((a, b) =>
          a.path.localeCompare(b.path),
        );
      }

      setConnection(createdConn);
      setRepoFiles(savedFiles);
      setSelectedRepoPath(savedFiles[0]?.path || null);
      setSyncProgressText(
        `Indexed ${savedFiles.length} files from ${createdConn.owner}/${createdConn.repo} (${createdConn.branch}).`,
      );
      pushLearningEvent(
        'repo_indexed',
        `Indexed ${createdConn.owner}/${createdConn.repo}`,
        `${savedFiles.length} source files synced to Supabase`,
        'github',
      );
    } finally {
      setIsSyncingRepo(false);
    }
  }

  async function handleResyncGitHubRepo(token?: string) {
    if (!connection) return;
    try {
      await handleConnectGitHubRepo(connection.owner, connection.repo, connection.branch, token);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to re-sync repository.');
    }
  }

  async function handleDisconnectGitHubRepo() {
    if (!session || !connection) return;
    setIsSyncingRepo(true);
    setErrorBanner(null);
    try {
      const {error} = await supabase.from('github_connections').delete().eq('id', connection.id);
      if (error) {
        setErrorBanner(error.message);
        return;
      }
      setConnection(null);
      setRepoFiles([]);
      setSelectedRepoPath(null);
      setSyncProgressText(null);
    } finally {
      setIsSyncingRepo(false);
    }
  }

  async function runTeacherDistillForPrompt(prompt: string) {
    if (!session) return null;
    const lesson = await distillLessonWithTeacher({
      brainUrl,
      backupBrainUrl,
      accessToken: session.access_token,
      model: brainModel,
      prompt,
      entries,
      folders: foldersRef.current,
    });
    if (!lesson.usedTeacher) return lesson;

    const updatedSkills = upsertScratchSkill({
      triggerType: 'intent',
      triggers: lesson.triggers,
      responses: lesson.responseVariants,
      folderName: lesson.folderName,
      tags: lesson.tags,
      learnedFrom: 'teacher-distilled',
      confidence: 2.0,
      usageCount: 0,
    });
    setScratchSkills(updatedSkills);

    const ensured = await ensureAutoFolderExists(
      lesson.folderName,
      `Auto-distilled Teacher lessons (${lesson.folderName})`,
      foldersRef.current,
      handleCreateFolder,
    );
    await handleSaveEntry({
      title: lesson.knowledgeTitle,
      content: lesson.knowledgeContent,
      folderId: ensured.folder?.id || null,
      tags: lesson.tags,
      source: 'teacher_distilled',
      status: 'reviewed',
    });

    const nextSamples = addTrainingSample({
      format: 'sft',
      prompt,
      chosenResponse: lesson.answer,
      modelChosen: lesson.modelUsed,
      citedEntryIds: [],
      status: 'approved',
    });
    setTrainingSamples(nextSamples);

    pushLearningEvent(
      'teacher_distilled',
      `Taught Scratch: ${lesson.triggers.slice(0, 2).join(', ')}`,
      `Filed to ${ensured.folder?.name || lesson.folderName} (${lesson.responseVariants.length} variants)`,
      lesson.modelUsed,
    );

    await handleTrainNeuralBatch(
      14,
      [
        {
          prompt,
          response: lesson.answer,
          folderName: ensured.folder?.name || lesson.folderName,
          source: 'teacher-distilled',
        },
      ],
      `Distill: ${prompt.slice(0, 32)}`,
    );

    return lesson;
  }

  async function handleSendChatMessage(prompt: string, modeOverride?: StudioComposerMode) {
    if (!session) return;
    setIsSendingChat(true);
    setErrorBanner(null);

    try {
      const userInsertPayload: Record<string, unknown> = {
        user_id: session.user.id,
        role: 'user',
        content: prompt,
        cited_entry_ids: [],
      };
      if (!phase2SchemaMissing) {
        userInsertPayload.cited_repo_paths = [];
      }

      const {data: userMsgData, error: userMsgErr} = await supabase
        .from('chat_messages')
        .insert(userInsertPayload)
        .select('*')
        .single();

      if (userMsgErr) {
        setErrorBanner(userMsgErr.message);
        return;
      }

      const savedUserMsg = userMsgData as ChatMessage;
      setMessages((prev) => [...prev, savedUserMsg]);

      let replyText = '';
      let citedEntryIds: string[] = [];
      let citedRepoPaths: string[] = [];
      let pendingTelemetry: ChatTurnTelemetry | undefined;
      const repoLabel = connection ? `${connection.owner}/${connection.repo}` : null;
      const hasCloudConfigured = Boolean(
        (brainUrl.trim() || backupBrainUrl.trim()) && session.access_token,
      );

      let autoMinedCount = 0;
      if (autoLearnFromChat && !prompt.startsWith('/')) {
        const mined = mineKnowledgeFromText(prompt, entries, foldersRef.current);
        if (mined.length > 0) {
          autoMinedCount = await handleSaveCapturedEntries(mined, 'auto_mined');
        }
      }

      const isAssassinRequest =
        modeOverride === 'assassin' || prompt.toLowerCase().startsWith('/execute ');

      if (prompt.toLowerCase().startsWith('/teach ')) {
        const rawBody = prompt.slice(7).trim();
        const separatorIdx = rawBody.indexOf('::');
        const noteTitle =
          separatorIdx > 0
            ? rawBody.slice(0, separatorIdx).trim()
            : rawBody.slice(0, 64).trim() || 'Quick Note';
        const noteContent =
          separatorIdx > 0 ? rawBody.slice(separatorIdx + 2).trim() : rawBody;

        if (!noteContent) {
          replyText = 'Provide note details after `/teach Title :: Details`.';
        } else {
          const liveFolders = foldersRef.current;
          const semantic = inferFolderDeterministically(noteTitle, noteContent, liveFolders);
          const ensured = await ensureAutoFolderExists(
            semantic.folderName,
            semantic.description,
            liveFolders,
            handleCreateFolder,
          );
          const savedOk = await handleSaveEntry({
            title: noteTitle,
            content: noteContent,
            folderId: ensured.folder?.id || null,
            tags: semantic.suggestedTags,
            source: 'chat',
            status: 'trusted',
          });
          const trainRes = await handleTrainNeuralBatch(
            14,
            [
              {
                prompt: noteTitle,
                response: noteContent,
                folderName: ensured.folder?.name || semantic.folderName,
                source: 'manual',
              },
            ],
            `Teach: ${noteTitle.slice(0, 28)}`,
          );
          pendingTelemetry = {
            checkpointId: trainRes?.checkpointId || activeCheckpointRef.current.id,
            confidence: 0.9,
            lossEstimate: trainRes ? trainRes.lastLoss : activeCheckpointRef.current.metrics.lastLoss,
            topTokens: [],
            isolationMode: 'student-strict',
            cloudCalls: 0,
            isUntrained: false,
          };
          replyText = savedOk
            ? `Saved "${noteTitle}" as Trusted to ${
                ensured.folder?.name || semantic.folderName
              }${
                trainRes
                  ? ` and step-trained ${trainRes.checkpointId} (loss ${trainRes.firstLoss.toFixed(3)} -> ${trainRes.lastLoss.toFixed(3)}).`
                  : '.'
              }`
            : 'Could not save note to Supabase — tap Retry on the save status notice.';
        }
      } else if (isAssassinRequest) {
        const prepStart = performance.now();
        const goal = prompt.toLowerCase().startsWith('/execute ')
          ? prompt.slice(9).trim()
          : prompt.trim();

        const [hybridMatches, repoMatches] = await Promise.all([
          runHybridRetrievalAsync({query: goal, entries, folders, limit: 4}),
          Promise.resolve(retrieveRelevantRepoFiles(goal, repoFiles, 3)),
        ]);

        const primaryFile = repoMatches[0]?.file || null;
        const proposedDiffs: AssassinPrepBrief['proposedDiffs'] = [];

        if (primaryFile) {
          let draft = generateImprovementSuggestion(primaryFile, goal, entries, folders);
          if (hasCloudConfigured) {
            try {
              const aiDraft = await suggestCodeWithAiBrain({
                brainUrl,
                backupBrainUrl,
                accessToken: session.access_token,
                model: brainModel,
                filePath: primaryFile.path,
                originalContent: primaryFile.content,
                goal,
                entries,
                folders,
              });
              if (aiDraft.proposedContent.trim()) {
                draft = {
                  ...draft,
                  title: aiDraft.title,
                  rationale: `${aiDraft.rationale} (Assist: ${aiDraft.model})`,
                  proposedContent: aiDraft.proposedContent,
                };
              }
            } catch {
              // fallback cleanly to deterministic draft
            }
          }
          proposedDiffs.push({
            filePath: draft.filePath,
            title: draft.title,
            rationale: draft.rationale,
            originalContent: draft.originalContent,
            proposedContent: draft.proposedContent,
          });
        }

        const safetyCheck = runStaticCodeSafetyCheck(
          proposedDiffs.map((d) => d.proposedContent).join('\n') || goal,
        );
        const prepLatencyMs = Math.round((performance.now() - prepStart) * 10) / 10;

        setActiveAssassinBrief({
          id: `brief-${Date.now()}`,
          goal,
          matchedMemories: hybridMatches,
          matchedFiles: repoMatches,
          proposedDiffs,
          verifierChecks: [
            {
              label: 'Static Secret & Unsafe Sink Guard',
              passed: safetyCheck.passed,
              detail: safetyCheck.passed
                ? 'Zero hardcoded tokens, dangerouslySetInnerHTML, or blocking alerts'
                : safetyCheck.issues.join(' · '),
            },
            {
              label: 'Hybrid Context Grounding',
              passed: hybridMatches.length > 0 || repoMatches.length > 0,
              detail: `${hybridMatches.length} memories + ${repoMatches.length} repo files matched`,
            },
          ],
          prepLatencyMs,
          createdAt: new Date().toISOString(),
        });

        citedEntryIds = hybridMatches.map((m) => m.entry.id);
        citedRepoPaths = repoMatches.map((r) => r.file.path);
        replyText = [
          `Parallel patch prep finished in ${prepLatencyMs} ms for: "${goal}".`,
          primaryFile
            ? `Staged isolated diff preview on \`${primaryFile.path}\` above the stream. Review the static checks and click **Approve & Stage Diff** when ready.`
            : 'Context & safety gate assembled above. Connect a GitHub repo or specify a file name to include a code diff.',
        ].join('\n\n');
      } else if (prompt.toLowerCase().startsWith('/suggest ')) {
        const targetQuery = prompt.slice(9).trim();
        if (phase3SchemaMissing) {
          replyText =
            'Phase 3 SQL migration is required before saving code suggestions. Open Settings to copy and run Phase 3 SQL.';
        } else {
          const matchedFile = repoFiles.find((f) =>
            f.path.toLowerCase().includes(targetQuery.toLowerCase()),
          );
          const targetPath = matchedFile
            ? matchedFile.path
            : targetQuery.includes('.')
              ? targetQuery
              : 'src/lib/proposedHelper.ts';
          let draft = matchedFile
            ? generateImprovementSuggestion(matchedFile, '', entries, folders)
            : generateNewCodeSuggestion(targetPath, targetQuery, entries, folders);

          if (hasCloudConfigured) {
            try {
              const aiDraft = await suggestCodeWithAiBrain({
                brainUrl,
                backupBrainUrl,
                accessToken: session.access_token,
                model: brainModel,
                filePath: targetPath,
                originalContent: matchedFile?.content || '',
                goal: matchedFile
                  ? `Improve ${matchedFile.path} following saved Knowledge rules`
                  : targetQuery,
                entries,
                folders,
              });
              if (aiDraft.proposedContent.trim()) {
                draft = {
                  ...draft,
                  title: aiDraft.title,
                  rationale: `${aiDraft.rationale} (Assist: ${aiDraft.model})`,
                  proposedContent: aiDraft.proposedContent,
                };
              }
            } catch {
              // Fallback cleanly to deterministic analyzer
            }
          }

          const created = await persistSuggestionDraft(draft);
          if (created) {
            if (matchedFile) {
              citedRepoPaths = [matchedFile.path];
            }
            replyText = [
              `Created code suggestion "${created.title}" (status: pending review).`,
              `Rationale: ${created.rationale}`,
              '',
              'Open Code & Diffs → Suggestions to inspect the line-by-line diff and Approve or Reject before any repository edits.',
            ].join('\n');
          } else {
            replyText = 'Could not save code suggestion to Supabase. Check Settings for schema status.';
          }
        }
      } else if (
        prompt.toLowerCase().trim() === '/self-audit' ||
        prompt.toLowerCase().startsWith('/self-audit ')
      ) {
        const targetRepo =
          prompt.trim().slice(11).trim() ||
          (connection && looksLikeMantisRepo(repoFiles)
            ? `${connection.owner}/${connection.repo}`
            : DEFAULT_MANTIS_REPO);
        try {
          const report = await handleRunSelfAudit(targetRepo);
          const topFindings = report.findings
            .slice(0, 4)
            .map((f, idx) => `${idx + 1}. [${f.severity.toUpperCase()}] ${f.filePath} — ${f.title}`);
          replyText = [
            `Guarded Self-Audit complete for ${report.repoLabel} (${report.branch}):`,
            `- Files scanned: ${report.filesScanned}`,
            `- Code Health Score: ${report.healthScore} / 100`,
            `- Findings: ${report.findings.length}`,
            ...(topFindings.length > 0 ? ['', 'Top findings:', ...topFindings] : []),
          ].join('\n');
          citedRepoPaths = report.findings.slice(0, 3).map((f) => f.filePath);
        } catch (err) {
          replyText = `Self-Audit could not complete: ${
            err instanceof Error ? err.message : 'Unable to fetch repository'
          }`;
        }
      } else if (modeOverride === 'local-llm') {
        const liveFolders = foldersRef.current;
        const currentCkpt = activeCheckpointRef.current;
        setStudentIsolationLock(true);
        try {
          let activeLlm = getLocalLlmState();
          if (activeLlm.status !== 'ready' || !activeLlm.loadedModelId) {
            activeLlm = await loadLocalLlmModel(activeLlm.selectedModelId, {
              allowHighRamOverride: false,
            });
          }

          const spec = getLocalLlmSpec(activeLlm.loadedModelId || activeLlm.selectedModelId);
          if (activeLlm.status !== 'ready' || !activeLlm.loadedModelId) {
            pendingTelemetry = {
              checkpointId: currentCkpt.id,
              confidence: 0,
              lossEstimate: currentCkpt.metrics.lastLoss,
              topTokens: [],
              isolationMode: 'local-llm',
              cloudCalls: 0,
              isUntrained: currentCkpt.metrics.stepCount === 0,
              tokensPerSec: null,
              localModelId: spec.id,
            };
            replyText = [
              `Local Q4 model (${spec.label}) could not initialize automatically:`,
              activeLlm.error || activeLlm.loadStatusText,
              '',
              'Open Eval & Export → Training & Evals → Local Q4 Models to probe hardware, pick an 8 GB-safe model (such as SmolLM2-360M Q4), or manually override the memory guard.',
            ].join('\n');
          } else {
            const [hybridMatches, neuralPred] = await Promise.all([
              runHybridRetrievalAsync({
                query: prompt,
                entries,
                folders: liveFolders,
                limit: 4,
              }),
              inferNeuralStudentAsync(prompt, currentCkpt),
            ]);
            const adapted = buildAdapterConditionedMessages({
              prompt,
              checkpoint: currentCkpt,
              hybridMatches,
              folders: liveFolders,
              skills: scratchSkills,
              neuralPrediction: neuralPred,
              modelId: activeLlm.loadedModelId,
            });

            let partialText = '';
            setStreamingLocalReply({
              text: '',
              tokensPerSec: null,
              generatedTokens: 0,
              modelLabel: spec.shortLabel,
            });

            try {
              const gen = await generateWithLocalLlmStream({
                messages: adapted.messages,
                onToken: (accumulatedText, tokensPerSec, generatedTokens) => {
                  partialText = accumulatedText;
                  setStreamingLocalReply({
                    text: accumulatedText,
                    tokensPerSec,
                    generatedTokens,
                    modelLabel: spec.shortLabel,
                  });
                },
              });
              replyText =
                gen.text ||
                partialText.trim() ||
                'Generation stopped before producing tokens.';
              citedEntryIds = hybridMatches.map((m) => m.entry.id);
              pendingTelemetry = {
                checkpointId: currentCkpt.id,
                confidence: neuralPred.confidence,
                lossEstimate: neuralPred.lossEstimate,
                topTokens: neuralPred.topTokens,
                isolationMode: 'local-llm',
                cloudCalls: 0,
                isUntrained: currentCkpt.metrics.stepCount === 0,
                tokensPerSec: gen.tokensPerSec,
                localModelId: gen.modelId,
              };
            } catch (localErr) {
              replyText = partialText.trim()
                ? `${partialText.trim()}\n\n[Local stream interrupted: ${
                    localErr instanceof Error ? localErr.message : 'Stopped'
                  }]`
                : `Local Q4 generation failed: ${
                    localErr instanceof Error ? localErr.message : 'Runtime error'
                  }`;
              citedEntryIds = hybridMatches.map((m) => m.entry.id);
              pendingTelemetry = {
                checkpointId: currentCkpt.id,
                confidence: neuralPred.confidence,
                lossEstimate: neuralPred.lossEstimate,
                topTokens: neuralPred.topTokens,
                isolationMode: 'local-llm',
                cloudCalls: 0,
                isUntrained: currentCkpt.metrics.stepCount === 0,
                tokensPerSec: null,
                localModelId: spec.id,
              };
            } finally {
              setStreamingLocalReply(null);
            }
          }
        } finally {
          setStreamingLocalReply(null);
          setStudentIsolationLock(false);
        }
      } else if (
        (modeOverride === 'cloud' || (!preferBuiltInFirst && modeOverride !== 'scratch')) &&
        hasCloudConfigured &&
        modeOverride !== 'distill'
      ) {
        try {
          const aiRes = await askAiBrainChat({
            brainUrl,
            backupBrainUrl,
            accessToken: session.access_token,
            model: brainModel,
            prompt,
            entries,
            folders,
            repoFiles,
            history: messages,
          });
          replyText = aiRes.replyText;
          citedEntryIds = aiRes.citedEntryIds;
          citedRepoPaths = aiRes.citedRepoPaths;
          pendingTelemetry = {
            checkpointId: activeCheckpointRef.current.id,
            confidence: 1,
            lossEstimate: null,
            topTokens: [],
            isolationMode: 'cloud-assist',
            cloudCalls: 1,
            isUntrained: activeCheckpointRef.current.metrics.stepCount === 0,
          };
          pushLearningEvent('cloud_assisted', 'Cloud Assist Reply', prompt.slice(0, 75), aiRes.modelUsed);

          setTrainingSamples(
            addTrainingSample({
              format: 'sft',
              prompt,
              chosenResponse: aiRes.replyText,
              modelChosen: aiRes.modelUsed,
              citedEntryIds: aiRes.citedEntryIds,
              status: 'pending',
            }),
          );

          if (autoLearnFromChat && aiRes.learnedItems.length > 0) {
            const count = await handleSaveCapturedEntries(
              aiRes.learnedItems.map((l) => ({
                title: l.title,
                folder: l.folderName,
                tags: l.tags,
                content: l.content,
              })),
              'ai_chat',
            );
            autoMinedCount += count;
          }
        } catch (aiErr) {
          const currentCkpt = activeCheckpointRef.current;
          const [hybridMatches, neuralPred] = await Promise.all([
            runHybridRetrievalAsync({
              query: prompt,
              entries,
              folders,
              limit: 4,
            }),
            inferNeuralStudentAsync(prompt, currentCkpt),
          ]);
          const scratch = synthesizeScratchWithHybrid({
            prompt,
            hybridMatches,
            entries,
            folders,
            repoFiles,
            repoLabel,
            growth: knowledgeGrowth,
            activeCheckpoint: currentCkpt,
            neuralPrediction: neuralPred,
          });
          pendingTelemetry = {
            checkpointId: currentCkpt.id,
            confidence: scratch.confidence,
            lossEstimate: neuralPred.lossEstimate,
            topTokens: neuralPred.topTokens,
            isolationMode: 'student-strict',
            cloudCalls: 0,
            isUntrained: Boolean(scratch.isUntrained),
          };
          replyText = `[Scratch Fallback — Cloud Assist unavailable: ${
            aiErr instanceof Error ? aiErr.message : 'Network error'
          }]\n\n${scratch.replyText}`;
          citedEntryIds = scratch.citedEntryIds;
          citedRepoPaths = scratch.citedRepoPaths;
        }
      } else {
        // Student Isolated Leads via Real Neural BPE+MLP/LoRA Core + Hybrid BM25/Int8 RRF
        const liveFolders = foldersRef.current;
        const currentCkpt = activeCheckpointRef.current;
        const isStrictIsolated = modeOverride !== 'distill';

        if (isStrictIsolated) {
          setStudentIsolationLock(true);
        }

        let hybridMatches;
        let neuralPred;
        let scratch;
        try {
          [hybridMatches, neuralPred] = await Promise.all([
            runHybridRetrievalAsync({
              query: prompt,
              entries,
              folders: liveFolders,
              limit: 4,
            }),
            inferNeuralStudentAsync(prompt, currentCkpt),
          ]);
          scratch = synthesizeScratchWithHybrid({
            prompt,
            hybridMatches,
            entries,
            folders: liveFolders,
            repoFiles,
            repoLabel,
            growth: knowledgeGrowth,
            activeCheckpoint: currentCkpt,
            neuralPrediction: neuralPred,
          });
          if (scratch.usedSkillId) {
            setScratchSkills(loadScratchSkills());
          }
        } finally {
          if (isStrictIsolated) {
            setStudentIsolationLock(false);
          }
        }

        const shouldDistill =
          !isStrictIsolated &&
          modeOverride === 'distill' &&
          hasCloudConfigured &&
          !prompt.toLowerCase().startsWith('/search ') &&
          !prompt.toLowerCase().startsWith('/repo ');

        if (shouldDistill) {
          try {
            const lesson = await runTeacherDistillForPrompt(prompt);
            const postCkpt = activeCheckpointRef.current;
            if (lesson?.usedTeacher) {
              pendingTelemetry = {
                checkpointId: postCkpt.id,
                confidence: 0.92,
                lossEstimate: postCkpt.metrics.lastLoss,
                topTokens: neuralPred.topTokens,
                isolationMode: 'teacher-distill',
                cloudCalls: 1,
                isUntrained: postCkpt.metrics.stepCount === 0,
              };
              replyText = `${lesson.answer}\n\n[Teacher Distilled -> Trained ${postCkpt.id} & learned ${lesson.triggers.length} triggers in "${lesson.folderName}"]`;
              citedEntryIds = scratch.citedEntryIds;
              citedRepoPaths = scratch.citedRepoPaths;
            } else {
              pendingTelemetry = {
                checkpointId: currentCkpt.id,
                confidence: scratch.confidence,
                lossEstimate: neuralPred.lossEstimate,
                topTokens: neuralPred.topTokens,
                isolationMode: 'student-strict',
                cloudCalls: 0,
                isUntrained: Boolean(scratch.isUntrained),
              };
              replyText = scratch.replyText;
              citedEntryIds = scratch.citedEntryIds;
              citedRepoPaths = scratch.citedRepoPaths;
            }
          } catch {
            pendingTelemetry = {
              checkpointId: currentCkpt.id,
              confidence: scratch.confidence,
              lossEstimate: neuralPred.lossEstimate,
              topTokens: neuralPred.topTokens,
              isolationMode: 'student-strict',
              cloudCalls: 0,
              isUntrained: Boolean(scratch.isUntrained),
            };
            replyText = scratch.replyText;
            citedEntryIds = scratch.citedEntryIds;
            citedRepoPaths = scratch.citedRepoPaths;
          }
        } else {
          pendingTelemetry = {
            checkpointId: currentCkpt.id,
            confidence: scratch.confidence,
            lossEstimate: neuralPred.lossEstimate,
            topTokens: neuralPred.topTokens,
            isolationMode: 'student-strict',
            cloudCalls: 0,
            isUntrained: Boolean(scratch.isUntrained),
          };
          const lowConfNotice =
            scratch.needsTeacherDistill &&
            scratch.confidence < 0.55 &&
            !scratch.replyText.includes('found no') &&
            !scratch.replyText.includes('Untrained')
              ? '\n\n[Low Confidence · Use Fix Answer or Teacher Distill to step-train this topic]'
              : '';
          replyText = `${scratch.replyText}${lowConfNotice}`;
          citedEntryIds = scratch.citedEntryIds;
          citedRepoPaths = scratch.citedRepoPaths;
        }
      }

      if (autoMinedCount > 0) {
        replyText = `${replyText}\n\n[Mantis auto-mined & saved ${autoMinedCount} new Knowledge ${
          autoMinedCount === 1 ? 'entry' : 'entries'
        } into Supabase]`;
      }

      const mantisInsertPayload: Record<string, unknown> = {
        user_id: session.user.id,
        role: 'mantis',
        content: replyText,
        cited_entry_ids: citedEntryIds,
      };
      if (!phase2SchemaMissing) {
        mantisInsertPayload.cited_repo_paths = citedRepoPaths;
      }

      const {data: mantisMsgData, error: mantisMsgErr} = await supabase
        .from('chat_messages')
        .insert(mantisInsertPayload)
        .select('*')
        .single();

      if (mantisMsgErr) {
        setErrorBanner(mantisMsgErr.message);
        return;
      }

      const savedMantisMsg = mantisMsgData as ChatMessage;
      if (pendingTelemetry) {
        setTurnTelemetryByMsgId((prev) => ({
          ...prev,
          [savedMantisMsg.id]: pendingTelemetry!,
        }));
      }
      setMessages((prev) => [...prev, savedMantisMsg]);
    } finally {
      setStudentIsolationLock(false);
      setIsSendingChat(false);
    }
  }

  async function handleDistillMessageWithTeacher(msgId: string) {
    if (!session) return;
    const msgIdx = messages.findIndex((m) => m.id === msgId);
    if (msgIdx <= 0) return;
    let userMsg: ChatMessage | null = null;
    for (let i = msgIdx - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === 'user') {
        userMsg = messages[i];
        break;
      }
    }
    if (!userMsg) return;

    if (!brainUrl.trim() && !backupBrainUrl.trim()) {
      setErrorBanner('Connect your Cloudflare Worker, Edge Backup, or Ollama route in Settings to run Teacher Distillation.');
      navigateToArea('settings');
      return;
    }

    setDistillingMsgId(msgId);
    try {
      const lesson = await runTeacherDistillForPrompt(userMsg.content);
      if (lesson) {
        const summaryMsg = `${lesson.answer}\n\n[Teacher Distilled Skill -> Folder: "${lesson.folderName}" · Triggers: ${lesson.triggers.join(', ')}]`;
        const {data: savedMsg} = await supabase
          .from('chat_messages')
          .insert({
            user_id: session.user.id,
            role: 'mantis',
            content: summaryMsg,
            cited_entry_ids: [],
            ...(phase2SchemaMissing ? {} : {cited_repo_paths: []}),
          })
          .select('*')
          .single();
        if (savedMsg) {
          setMessages((prev) => [...prev, savedMsg as ChatMessage]);
        }
      }
    } finally {
      setDistillingMsgId(null);
    }
  }

  async function handleApproveAssassinBrief(brief: AssassinPrepBrief) {
    for (const diff of brief.proposedDiffs) {
      await persistSuggestionDraft(
        {
          filePath: diff.filePath,
          title: diff.title,
          rationale: diff.rationale,
          originalContent: diff.originalContent,
          proposedContent: diff.proposedContent,
          matchedRuleTitles: brief.matchedMemories.map((m) => m.entry.title),
        },
        'code_help',
      );
    }
    const chosenSummary =
      brief.proposedDiffs.length > 0
        ? brief.proposedDiffs.map((d) => `${d.filePath}: ${d.title}`).join('\n')
        : `Verified plan for: ${brief.goal}`;
    setTrainingSamples(
      addTrainingSample({
        format: 'sft',
        prompt: brief.goal,
        chosenResponse: chosenSummary,
        modelChosen: 'Parallel Patch Prep',
        citedEntryIds: brief.matchedMemories.map((m) => m.entry.id),
        status: 'approved',
      }),
    );
    setActiveAssassinBrief(null);
    setTransientSaveFeedback({
      state: 'saved',
      message:
        brief.proposedDiffs.length > 0
          ? 'Approved — Diff staged in Code & Diffs ✓'
          : 'Approved — Added to SFT dataset ✓',
    });
  }

  function handleRejectAssassinBrief(brief: AssassinPrepBrief) {
    const rejectedSummary = brief.proposedDiffs.map((d) => d.title).join('; ') || brief.goal;
    setTrainingSamples(
      addTrainingSample({
        format: 'dpo',
        prompt: brief.goal,
        chosenResponse: 'Require tighter alignment with repo rules before editing.',
        rejectedResponse: rejectedSummary,
        modelChosen: 'Operator Guardrail',
        modelRejected: 'Parallel Patch Draft',
        rationale: 'Rejected parallel patch brief during approval gate',
        citedEntryIds: brief.matchedMemories.map((m) => m.entry.id),
        status: 'approved',
      }),
    );
    pushLearningEvent('dpo_logged', 'Logged DPO Negative Signal', brief.goal.slice(0, 60), 'patch');
    setActiveAssassinBrief(null);
  }

  async function handleApplyMemoryOptimize(
    kind: 'prune-duplicates' | 'compact-raw',
  ): Promise<number> {
    if (!session) return 0;
    let affected = 0;

    if (kind === 'prune-duplicates') {
      const seen = new Map<string, KnowledgeEntry>();
      const toDeleteIds: string[] = [];
      for (const e of entries) {
        const key = `${e.title.toLowerCase().trim()}::${e.content.slice(0, 120).toLowerCase().trim()}`;
        const existing = seen.get(key);
        if (!existing) {
          seen.set(key, e);
        } else if (e.status !== 'trusted') {
          toDeleteIds.push(e.id);
        } else if (existing.status !== 'trusted') {
          toDeleteIds.push(existing.id);
          seen.set(key, e);
        }
      }
      for (const id of toDeleteIds.slice(0, 50)) {
        const ok = await handleDeleteEntry(id);
        if (ok) affected += 1;
      }
    } else if (kind === 'compact-raw') {
      const rawLarge = entries.filter((e) => e.status === 'raw' && e.content.length > 1800);
      for (const entry of rawLarge.slice(0, 30)) {
        const compacted = `${entry.content.slice(0, 1400).trim()}…`;
        const ok = await handleUpdateEntry(entry.id, {
          title: entry.title,
          content: compacted,
          folderId: entry.folder_id,
          tags: entry.tags,
          status: entry.status,
        });
        if (ok) affected += 1;
      }
    }

    if (affected > 0) {
      pushLearningEvent(
        'self_optimized',
        kind === 'prune-duplicates' ? 'Pruned Duplicate Memories' : 'Compacted Stale Raw Captures',
        `${affected} entries optimized`,
        'profiler',
      );
    }
    return affected;
  }

  async function handleStageCodeOptimize(filePath: string, title: string, goal: string) {
    const targetFile = repoFiles.find((f) => f.path === filePath);
    if (!targetFile) {
      setErrorBanner(`Sync ${filePath} in Code & Diffs first to stage an automated optimization diff.`);
      return;
    }
    await handleGenerateFromFile(targetFile, `${title}: ${goal}`);
    pushLearningEvent('self_optimized', `Staged Opt Diff: ${filePath}`, title, 'profiler');
  }

  async function handleTeachScratchFix(
    userPrompt: string,
    correctedAnswer: string,
  ): Promise<boolean> {
    if (!session) return false;
    const cleanPrompt = userPrompt.trim();
    const cleanAnswer = correctedAnswer.trim();
    if (!cleanPrompt || !cleanAnswer) return false;

    const liveFolders = foldersRef.current;
    const semantic = inferFolderDeterministically(cleanPrompt, cleanAnswer, liveFolders);
    const ensured = await ensureAutoFolderExists(
      semantic.folderName,
      semantic.description,
      liveFolders,
      handleCreateFolder,
    );

    const updatedSkills = upsertScratchSkill({
      triggerType: 'intent',
      triggers: [cleanPrompt.toLowerCase()],
      responses: [cleanAnswer],
      folderName: ensured.folder?.name || semantic.folderName,
      tags: semantic.suggestedTags,
      learnedFrom: 'manual',
      confidence: 2.6,
      usageCount: 0,
    });
    setScratchSkills(updatedSkills);

    const saved = await handleSaveEntry({
      title: cleanPrompt.length > 72 ? `${cleanPrompt.slice(0, 69).trim()}…` : cleanPrompt,
      content: cleanAnswer,
      folderId: ensured.folder?.id || null,
      tags: semantic.suggestedTags,
      source: 'teach',
      status: 'trusted',
    });

    setTrainingSamples(
      addTrainingSample({
        format: 'sft',
        prompt: cleanPrompt,
        chosenResponse: cleanAnswer,
        modelChosen: 'Operator Feedback Fix',
        citedEntryIds: [],
        status: 'approved',
      }),
    );

    pushLearningEvent(
      'manual_teach',
      `Fixed Scratch Skill: ${cleanPrompt.slice(0, 48)}`,
      `Saved to ${ensured.folder?.name || semantic.folderName}`,
      'feedback',
    );

    await handleTrainNeuralBatch(
      18,
      [
        {
          prompt: cleanPrompt,
          response: cleanAnswer,
          folderName: ensured.folder?.name || semantic.folderName,
          source: 'manual',
        },
      ],
      `Fix: ${cleanPrompt.slice(0, 32)}`,
    );

    return saved;
  }

  async function handleEscalateMessageToCloud(msgId: string) {
    if (!session) return;
    const msgIdx = messages.findIndex((m) => m.id === msgId);
    if (msgIdx <= 0) return;
    let userMsg: ChatMessage | null = null;
    for (let i = msgIdx - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === 'user') {
        userMsg = messages[i];
        break;
      }
    }
    if (!userMsg) return;

    if (!brainUrl.trim() && !backupBrainUrl.trim()) {
      setErrorBanner('Configure your Cloudflare Worker or Chromebook Supabase Backup URL in Settings to use Cloud Assist.');
      navigateToArea('settings');
      return;
    }

    setEscalatingMsgId(msgId);
    setErrorBanner(null);

    try {
      const aiRes = await askAiBrainChat({
        brainUrl,
        backupBrainUrl,
        accessToken: session.access_token,
        model: brainModel,
        prompt: userMsg.content,
        entries,
        folders,
        repoFiles,
        history: messages.slice(0, msgIdx - 1),
      });

      let assistedContent = `[Cloud Assist · ${aiRes.modelUsed}]\n\n${aiRes.replyText}`;
      if (autoLearnFromChat && aiRes.learnedItems.length > 0) {
        const count = await handleSaveCapturedEntries(
          aiRes.learnedItems.map((l) => ({
            title: l.title,
            folder: l.folderName,
            tags: l.tags,
            content: l.content,
          })),
          'ai_chat',
        );
        if (count > 0) {
          assistedContent = `${assistedContent}\n\n[Distilled & saved ${count} Knowledge ${
            count === 1 ? 'entry' : 'entries'
          }]`;
        }
      }

      pushLearningEvent(
        'cloud_assisted',
        `Cloud Assist: ${userMsg.content.slice(0, 48)}`,
        `Answered via ${aiRes.modelUsed}`,
        'cloud',
      );

      const {data: savedAssist, error: assistErr} = await supabase
        .from('chat_messages')
        .insert({
          user_id: session.user.id,
          role: 'mantis',
          content: assistedContent,
          cited_entry_ids: aiRes.citedEntryIds,
          ...(phase2SchemaMissing ? {} : {cited_repo_paths: aiRes.citedRepoPaths}),
        })
        .select('*')
        .single();

      if (assistErr) {
        setErrorBanner(assistErr.message);
        return;
      }

      setMessages((prev) => [...prev, savedAssist as ChatMessage]);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Cloud Assist request failed.');
    } finally {
      setEscalatingMsgId(null);
    }
  }

  async function handleClearChat() {
    if (!session) return;
    setErrorBanner(null);
    const {error} = await supabase
      .from('chat_messages')
      .delete()
      .eq('user_id', session.user.id);
    if (error) {
      setErrorBanner(error.message);
      return;
    }
    setMessages([]);
  }

  async function handleQuickSaveChatMessage(
    suggestedTitle: string,
    content: string,
  ): Promise<string | null> {
    if (!session) return null;
    const folderGuess = await suggestSemanticFolderWithAi({
      brainUrl,
      backupBrainUrl,
      accessToken: session.access_token,
      model: brainModel,
      title: suggestedTitle,
      content,
      existingFolders: foldersRef.current,
    });
    const ensured = await ensureAutoFolderExists(
      folderGuess.folderName,
      folderGuess.description,
      foldersRef.current,
      handleCreateFolder,
    );
    const saved = await handleSaveEntry({
      title: suggestedTitle,
      content,
      folderId: ensured.folder?.id || null,
      tags: folderGuess.tags,
      source: 'chat_saved',
      status: 'trusted',
    });
    return saved ? ensured.folder?.name || folderGuess.folderName : null;
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setSession(null);
  }

  if (!authReady) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-canvas text-sm text-ink-muted">
        Loading Mantis Studio...
      </div>
    );
  }

  if (!session) {
    return <AuthGate onAuthenticated={() => {}} />;
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-canvas text-ink">
      <TopBar
        activeMode={workspaceMode}
        onSelectMode={(mode) => {
          setSettingsOpen(false);
          setWorkspaceMode(mode);
        }}
        modelName={activeCheckpoint.profileName || modelCard.modelName}
        checkpointId={activeCheckpoint.id}
        localModelShortLabel={
          localLlmState.loadedModelId
            ? getLocalLlmSpec(localLlmState.loadedModelId).shortLabel
            : null
        }
        isOnline={isOnline}
        pendingOfflineCount={offlineQueueCount}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen((prev) => !prev)}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      />

      {/* Alert Strip (Only mounted when active) */}
      {(schemaMissing || contradictionAlerts.length > 0 || (errorBanner && !schemaMissing)) && (
        <div className="shrink-0 space-y-2 border-b border-line bg-inset px-3 py-2.5 sm:px-6">
          <div className="mx-auto max-w-[1440px] space-y-2">
            {schemaMissing && (
              <SchemaSetupBanner
                isChecking={isLoadingData}
                onRetry={() => void loadWorkspaceData(session)}
              />
            )}

            {contradictionAlerts.length > 0 && (
              <div
                role="status"
                className="space-y-2 rounded-lg border border-warn-border bg-warn-soft px-3.5 py-2.5 text-xs text-ink"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-warn" />
                    <span>
                      <strong>Contradiction Guard ({contradictionAlerts.length}):</strong> &quot;
                      {contradictionAlerts[0].newTitle}&quot; conflicts with{' '}
                      <span className="font-mono uppercase text-warn">
                        {contradictionAlerts[0].existingStatus || 'trusted'}
                      </span>{' '}
                      note &quot;{contradictionAlerts[0].existingTitle}&quot; (
                      {contradictionAlerts[0].reason}).
                    </span>
                  </div>
                </div>

                {(contradictionAlerts[0].newContent || contradictionAlerts[0].existingContent) && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {contradictionAlerts[0].newContent && (
                      <div className="rounded border border-warn-border/60 bg-surface/70 p-2 text-[11px]">
                        <div className="font-mono font-semibold text-ink">New / Updated:</div>
                        <div className="mt-0.5 line-clamp-2 text-ink-muted">
                          {contradictionAlerts[0].newContent}
                        </div>
                      </div>
                    )}
                    {contradictionAlerts[0].existingContent && (
                      <div className="rounded border border-warn-border/60 bg-surface/70 p-2 text-[11px]">
                        <div className="font-mono font-semibold text-warn">
                          Existing ({contradictionAlerts[0].existingFolder}):
                        </div>
                        <div className="mt-0.5 line-clamp-2 text-ink-muted">
                          {contradictionAlerts[0].existingContent}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const target = contradictionAlerts[0];
                      const ok = await handleUpdateEntryStatus(target.existingEntryId, 'raw');
                      if (ok) {
                        pushLearningEvent(
                          'manual_teach',
                          `Superseded rule: ${target.existingTitle}`,
                          `Demoted to Raw in favor of "${target.newTitle}"`,
                          'contradiction-guard',
                        );
                        setTransientSaveFeedback({
                          state: 'saved',
                          message: 'Demoted old conflicting rule to Raw ✓',
                        });
                        setContradictionAlerts((prev) => prev.slice(1));
                      }
                    }}
                    className="min-h-[40px] rounded border border-accent-border bg-accent-soft px-3 text-xs font-semibold text-accent-text hover:bg-accent hover:text-white"
                  >
                    Demote Old Note to Raw (Keep New)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHighlightedEntryId(contradictionAlerts[0].existingEntryId);
                      navigateToArea('knowledge');
                      setContradictionAlerts((prev) => prev.slice(1));
                    }}
                    className="min-h-[40px] rounded border border-warn-border bg-surface/80 px-3 text-xs font-semibold text-warn hover:bg-surface"
                  >
                    Inspect Old Note
                  </button>
                  <button
                    type="button"
                    onClick={() => setContradictionAlerts((prev) => prev.slice(1))}
                    className="min-h-[40px] px-2.5 text-xs text-ink-muted hover:text-ink"
                  >
                    Keep Both (Dismiss)
                  </button>
                </div>
              </div>
            )}

            {errorBanner && !schemaMissing && (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger-border bg-danger-soft px-3.5 py-2.5 text-xs text-danger"
              >
                <span>{errorBanner}</span>
                <button
                  type="button"
                  onClick={() => void loadWorkspaceData(session)}
                  className="min-h-[40px] rounded border border-danger-border bg-surface/60 px-3 py-1 font-semibold text-danger hover:bg-surface"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Primary Zero-Scroll 100dvh Workspace */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {settingsOpen ? (
          <>
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-line bg-inset px-3 sm:px-6">
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back to {workspaceMode === 'train' ? 'Train & Chat' : workspaceMode === 'memory' ? 'Memory & Data' : 'Eval & Export'}</span>
              </button>
              <span className="font-mono text-[11px] text-ink-subtle">
                Settings &amp; Diagnostics
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
              <div className="mx-auto max-w-5xl">
                <Suspense fallback={<PanelLoadingSkeleton />}>
                  <SettingsPanel
                    userEmail={session.user.email || 'Signed-in user'}
                    metrics={metrics}
                    routeStatus={routeStatus}
                    theme={theme}
                    accentColor={accentColor}
                    onSelectAppearance={handleSelectAppearance}
                    schemaMissing={schemaMissing}
                    phase2SchemaMissing={phase2SchemaMissing}
                    phase3SchemaMissing={phase3SchemaMissing}
                    phase4SchemaMissing={phase4SchemaMissing}
                    phase5SchemaMissing={phase5SchemaMissing}
                    phase6SchemaMissing={phase6SchemaMissing}
                    offlineQueueCount={offlineQueueCount}
                    offlineQueueItems={offlineQueueItems}
                    onFlushOfflineQueue={() => void flushOfflineQueue()}
                    onForceOverwriteOfflineWrite={(queueId) => {
                      const updated = markOfflineWriteForceOverwrite(queueId);
                      setOfflineQueueItems(updated);
                      void flushOfflineQueue();
                    }}
                    onDiscardOfflineWrite={(queueId) => {
                      const updated = removeOfflineWriteById(queueId);
                      setOfflineQueueItems(updated);
                    }}
                    brainUrl={brainUrl}
                    backupBrainUrl={backupBrainUrl}
                    brainModel={brainModel}
                    autoLearnFromChat={autoLearnFromChat}
                    preferBuiltInFirst={preferBuiltInFirst}
                    accessToken={session.access_token}
                    connection={connection}
                    onSaveBrainConfig={handleSaveBrainConfig}
                    onOpenLocalModels={openLocalModelsTab}
                    onSignOut={handleSignOut}
                  />
                </Suspense>
              </div>
            </div>
          </>
        ) : workspaceMode === 'train' ? (
          studioSubView === 'teach' ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
              <div className="mx-auto max-w-4xl space-y-4">
                <button
                  type="button"
                  onClick={() => setStudioSubView('console')}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>Back to Stream</span>
                </button>
                <TeachPanel
                  key={teachPrefill.key}
                  folders={folders}
                  entries={entries}
                  brainUrl={brainUrl}
                  backupBrainUrl={backupBrainUrl}
                  brainModel={brainModel}
                  accessToken={session.access_token}
                  initialTitle={teachPrefill.title}
                  initialContent={teachPrefill.content}
                  initialTags={teachPrefill.tags}
                  saveFeedback={saveFeedback}
                  onRetrySave={
                    retrySaveFnRef.current ? () => void retrySaveFnRef.current?.() : undefined
                  }
                  onSaveEntry={handleSaveEntry}
                  onCreateFolder={handleCreateFolder}
                  onOpenKnowledge={() => navigateToArea('knowledge')}
                />
              </div>
            </div>
          ) : (
            <ChatWorkspace
              messages={messages}
              entries={entries}
              folders={folders}
              repoFiles={repoFiles}
              growth={knowledgeGrowth}
              connection={connection}
              routeStatus={routeStatus}
              preferBuiltInFirst={preferBuiltInFirst}
              onTogglePreferBuiltIn={(next) => void handleTogglePreferBuiltIn(next)}
              brainModel={brainModel}
              activeCheckpoint={activeCheckpoint}
              turnTelemetryByMsgId={turnTelemetryByMsgId}
              isLoading={isLoadingData}
              isSending={isSendingChat}
              escalatingMsgId={escalatingMsgId}
              distillingMsgId={distillingMsgId}
              activeTab={studioTab}
              onChangeTab={setStudioTab}
              activeAssassinBrief={activeAssassinBrief}
              onApproveAssassinBrief={handleApproveAssassinBrief}
              onRejectAssassinBrief={handleRejectAssassinBrief}
              composerPrefill={composerPrefill}
              onConsumeComposerPrefill={() => setComposerPrefill('')}
              onSendMessage={handleSendChatMessage}
              onEscalateMessageToCloud={handleEscalateMessageToCloud}
              onDistillMessageWithTeacher={handleDistillMessageWithTeacher}
              onTeachScratchFix={handleTeachScratchFix}
              onSendToArena={(promptText) => {
                setArenaInitialPrompt(promptText);
                navigateToArea('training');
              }}
              onClearChat={handleClearChat}
              onInspectEntry={(entryId) => {
                setHighlightedEntryId(entryId);
                navigateToArea('knowledge');
              }}
              onInspectRepoFile={(repoPath) => {
                setSelectedRepoPath(repoPath);
                setGithubSubTab('files');
                navigateToArea('github');
              }}
              onSaveTextToTeach={(suggestedTitle, content) => {
                setTeachPrefill({
                  key: Date.now(),
                  title: suggestedTitle,
                  content,
                  tags: '',
                });
                setStudioSubView('teach');
              }}
              onQuickSaveMessage={handleQuickSaveChatMessage}
              onReinforceEntries={handleReinforceEntries}
              onOpenIngest={() => navigateToArea('ingest')}
              onOpenTeach={() => setStudioSubView('teach')}
              onOpenSuggestions={() => {
                setGithubSubTab('suggestions');
                navigateToArea('github');
              }}
              onOpenSettings={() => navigateToArea('settings')}
              localLlmState={localLlmState}
              hardwareTelemetry={hardwareTelemetry}
              streamingLocalReply={streamingLocalReply}
              onStopLocalGeneration={stopLocalLlmGeneration}
              onOpenLocalModels={openLocalModelsTab}
              showOnboarding={!onboardingDismissed}
              onOpenKnowledge={() => navigateToArea('knowledge')}
              onDismissOnboarding={() => {
                setOnboardingDismissed(true);
                try {
                  window.localStorage.setItem('mantis_onboarding_dismissed_v1', 'true');
                } catch {
                  // ignore
                }
              }}
            />
          )
        ) : workspaceMode === 'memory' ? (
          <>
            <nav
              aria-label="Memory and data views"
              className="flex h-11 shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-inset px-3 sm:px-6"
            >
              {(
                [
                  {id: 'knowledge', label: `Memories · ${entries.length}`},
                  {id: 'capture', label: 'Capture'},
                  {
                    id: 'repo',
                    label:
                      pendingSuggestionsCount > 0
                        ? `Code & Diffs · ${pendingSuggestionsCount}`
                        : 'Code & Diffs',
                  },
                ] as const
              ).map((tab) => {
                const active = memorySubView === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setMemorySubView(tab.id)}
                    className={`inline-flex min-h-[36px] shrink-0 items-center whitespace-nowrap rounded-md px-3 text-xs font-medium tabular-nums transition-colors ${
                      active
                        ? 'bg-elevated text-ink'
                        : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </nav>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
              <div className="mx-auto max-w-[1440px]">
                <Suspense fallback={<PanelLoadingSkeleton />}>
                  {memorySubView === 'knowledge' && (
                    <KnowledgeBrowser
                      folders={folders}
                      entries={entries}
                      isLoading={isLoadingData}
                      highlightedEntryId={highlightedEntryId}
                      initialFolderId={selectedKnowledgeFolderId}
                      saveFeedback={saveFeedback}
                      onClearHighlight={() => setHighlightedEntryId(null)}
                      onCreateFolder={handleCreateFolder}
                      onDeleteFolder={handleDeleteFolder}
                      onUpdateEntry={handleUpdateEntry}
                      onUpdateEntryStatus={handleUpdateEntryStatus}
                      onDeleteEntry={handleDeleteEntry}
                      onOpenTeach={() => {
                        setStudioSubView('teach');
                        navigateToArea('studio');
                      }}
                    />
                  )}

                  {memorySubView === 'capture' && (
                    <CapturePanel
                      brainUrl={brainUrl}
                      backupBrainUrl={backupBrainUrl}
                      brainModel={brainModel}
                      accessToken={session.access_token}
                      folders={folders}
                      entries={entries}
                      onCreateFolder={handleCreateFolder}
                      onSaveEntry={handleSaveEntry}
                      onSaveCapturedEntries={handleSaveCapturedEntries}
                      onBeforeHeavyTask={async (taskLabel) => {
                        await autoUnloadBeforeHeavyTask(taskLabel);
                      }}
                      onOpenKnowledge={() => navigateToArea('knowledge')}
                    />
                  )}

                  {memorySubView === 'repo' && (
                    <GitHubPanel
                      connection={connection}
                      repoFiles={repoFiles}
                      suggestions={suggestions}
                      auditRuns={auditRuns}
                      latestAuditReport={latestAuditReport}
                      activeSubTab={githubSubTab}
                      onChangeSubTab={setGithubSubTab}
                      phase2SchemaMissing={phase2SchemaMissing}
                      phase3SchemaMissing={phase3SchemaMissing}
                      phase4SchemaMissing={phase4SchemaMissing}
                      isSyncingRepo={isSyncingRepo}
                      syncProgressText={syncProgressText}
                      isAuditingSelf={isAuditingSelf}
                      auditProgressText={auditProgressText}
                      selectedFilePath={selectedRepoPath}
                      onSelectFilePath={setSelectedRepoPath}
                      onVerifyTables={() => void loadWorkspaceData(session)}
                      onConnectRepo={handleConnectGitHubRepo}
                      onResyncRepo={handleResyncGitHubRepo}
                      onDisconnectRepo={handleDisconnectGitHubRepo}
                      onSaveFileToTeach={(file) => {
                        const snippet =
                          file.content.length > 1500
                            ? `${file.content.slice(0, 1500)}\n// ...`
                            : file.content;
                        setTeachPrefill({
                          key: Date.now(),
                          title: `Repo note: ${file.path}`,
                          content: `From ${connection?.owner || ''}/${connection?.repo || ''} (${file.path}):\n\n${snippet}`,
                          tags: 'github, source',
                        });
                        setStudioSubView('teach');
                        navigateToArea('studio');
                      }}
                      onSaveLessonToTeach={(title, content, tags) => {
                        setTeachPrefill({
                          key: Date.now(),
                          title,
                          content,
                          tags,
                        });
                        setStudioSubView('teach');
                        navigateToArea('studio');
                      }}
                      onGenerateFromFile={handleGenerateFromFile}
                      onGenerateNewFile={handleGenerateNewFile}
                      onUpdateProposedContent={handleUpdateProposedContent}
                      onReviewSuggestion={handleReviewSuggestion}
                      onDeleteSuggestion={handleDeleteSuggestion}
                      onRunSelfAudit={async (repoInput) => {
                        await handleRunSelfAudit(repoInput);
                      }}
                      onStageAuditFinding={handleStageAuditFinding}
                    />
                  )}
                </Suspense>
              </div>
            </div>
          </>
        ) : (
          <>
            <nav
              aria-label="Evaluation and export views"
              className="flex h-11 shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-inset px-3 sm:px-6"
            >
              {(
                [
                  {id: 'training', label: 'Training & Evals'},
                  {id: 'export', label: 'Model Export'},
                ] as const
              ).map((tab) => {
                const active = evalSubView === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setEvalSubView(tab.id)}
                    className={`inline-flex min-h-[36px] shrink-0 items-center whitespace-nowrap rounded-md px-3 text-xs font-medium transition-colors ${
                      active
                        ? 'bg-elevated text-ink'
                        : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </nav>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
              <div className="mx-auto max-w-[1440px]">
                <Suspense fallback={<PanelLoadingSkeleton />}>
                  {evalSubView === 'training' && (
                    <TrainingPanel
                      entries={entries}
                      folders={folders}
                      repoFiles={repoFiles}
                      repoLabel={connection ? `${connection.owner}/${connection.repo}` : null}
                      messagesCountBytes={messagesCountBytes}
                      computeStatus={computeStatus}
                      brainUrl={brainUrl}
                      backupBrainUrl={backupBrainUrl}
                      brainModel={brainModel}
                      accessToken={session.access_token}
                      activeCheckpoint={activeCheckpoint}
                      checkpoints={checkpoints}
                      isTrainingNeural={isTrainingNeural}
                      onTrainNeuralBatch={(epochs) => handleTrainNeuralBatch(epochs)}
                      onRollbackCheckpoint={handleRollbackCheckpoint}
                      onCloneCheckpoint={handleCloneCheckpoint}
                      onResetBlankSlate={handleResetBlankSlate}
                      trainingSamples={trainingSamples}
                      onChangeTrainingSamples={setTrainingSamples}
                      scratchSkills={scratchSkills}
                      onChangeScratchSkills={setScratchSkills}
                      onUpdateScratchSkill={(id, patch) =>
                        setScratchSkills(updateScratchSkill(id, patch))
                      }
                      onDeleteScratchSkill={(id) => setScratchSkills(deleteScratchSkill(id))}
                      evalCases={evalCases}
                      onChangeEvalCases={setEvalCases}
                      evalRuns={evalRuns}
                      onAddEvalRun={(run) => {
                        setEvalRuns((prev) => [run, ...prev.slice(0, 29)]);
                        pushLearningEvent(
                          'eval_passed',
                          `Eval Suite: ${run.passRate}% (${run.passedCases}/${run.totalCases})`,
                          `${run.engineMode} · ${run.avgLatencyMs} ms avg`,
                          'eval',
                        );
                      }}
                      onApplyMemoryOptimize={handleApplyMemoryOptimize}
                      onStageCodeOptimize={handleStageCodeOptimize}
                      onCloudAsk={
                        (brainUrl.trim() || backupBrainUrl.trim()) && session.access_token
                          ? async (prompt) => {
                              const res = await askAiBrainChat({
                                brainUrl,
                                backupBrainUrl,
                                accessToken: session.access_token,
                                model: brainModel,
                                prompt,
                                entries,
                                folders,
                                repoFiles,
                                history: [],
                              });
                              return {replyText: res.replyText, citedEntryIds: res.citedEntryIds};
                            }
                          : undefined
                      }
                      arenaInitialPrompt={arenaInitialPrompt}
                      onConsumeArenaPrompt={() => setArenaInitialPrompt('')}
                      localLlmState={localLlmState}
                      hardwareTelemetry={hardwareTelemetry}
                      onRefreshHardware={async () => {
                        const hw = await refreshHardwareTelemetry();
                        setHardwareTelemetry(hw);
                      }}
                      onSelectLocalLlm={selectLocalLlmModel}
                      onLoadLocalLlm={handleLoadLocalLlm}
                      onUnloadLocalLlm={handleUnloadLocalLlm}
                      onCancelLocalLlmLoad={cancelLocalLlmLoad}
                      onClearLocalLlmCache={clearLocalLlmBrowserCache}
                      onStopLocalLlmGeneration={stopLocalLlmGeneration}
                      openLocalModelsSignal={openLocalModelsSignal}
                    />
                  )}

                  {evalSubView === 'export' && (
                    <ExportStudioPanel
                      modelCard={modelCard}
                      onUpdateModelCard={setModelCard}
                      entries={entries}
                      folders={folders}
                      skills={scratchSkills}
                      trainingSamples={trainingSamples}
                      latestEval={evalRuns[0] || null}
                    />
                  )}
                </Suspense>
              </div>
            </div>
          </>
        )}
      </main>

      <InspectorDrawer
        isOpen={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        routeStatus={routeStatus}
        computeStatus={computeStatus}
        localLlmState={localLlmState}
        hardwareTelemetry={hardwareTelemetry}
        onLoadLocalLlm={handleLoadLocalLlm}
        onUnloadLocalLlm={handleUnloadLocalLlm}
        onCancelLocalLlmLoad={cancelLocalLlmLoad}
        onOpenLocalModels={openLocalModelsTab}
        modelName={activeCheckpoint.profileName || modelCard.modelName}
        activeCheckpoint={activeCheckpoint}
        checkpoints={checkpoints}
        isTrainingNeural={isTrainingNeural}
        isStudentIsolated={preferBuiltInFirst}
        onTrainNeuralBatch={async () => {
          await handleTrainNeuralBatch(20);
        }}
        onRollbackCheckpoint={handleRollbackCheckpoint}
        onCloneCheckpoint={handleCloneCheckpoint}
        onResetBlankSlate={handleResetBlankSlate}
        entries={entries}
        folders={folders}
        growth={knowledgeGrowth}
        skillsCount={scratchSkills.length}
        connection={connection}
        repoFiles={repoFiles}
        learningEvents={learningEvents}
        pendingOfflineCount={offlineQueueCount}
        isOnline={isOnline}
        isSyncing={isLoadingData}
        theme={theme}
        onCycleTheme={() => void handleSelectAppearance(getNextThemeMode(theme), accentColor)}
        onSync={() => {
          void flushOfflineQueue();
          void loadWorkspaceData(session);
        }}
        onOpenSettings={() => navigateToArea('settings')}
        onOpenTeach={() => {
          setStudioSubView('teach');
          navigateToArea('studio');
        }}
        onSelectFolder={(folderId) => {
          setSelectedKnowledgeFolderId(folderId);
          navigateToArea('knowledge');
        }}
        onQueryConcept={(label) => {
          setStudioSubView('console');
          setStudioTab('stream');
          navigateToArea('studio');
          setComposerPrefill(`/search ${label}`);
        }}
        onInspectRepoFile={(repoPath) => {
          setSelectedRepoPath(repoPath);
          setGithubSubTab('files');
          navigateToArea('github');
        }}
      />

      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        entries={entries}
        folders={folders}
        repoFiles={repoFiles}
        onNavigateArea={navigateToArea}
        onOpenGraph={() => {
          navigateToArea('studio');
          setStudioSubView('console');
          setStudioTab('graph');
        }}
        onPrefillExecute={() => {
          navigateToArea('studio');
          setStudioSubView('console');
          setStudioTab('stream');
          setComposerPrefill('/execute ');
        }}
        onOpenTeach={() => {
          setStudioSubView('teach');
          navigateToArea('studio');
        }}
        onSync={() => {
          void flushOfflineQueue();
          void loadWorkspaceData(session);
        }}
        onSelectTheme={(nextTheme) => void handleSelectAppearance(nextTheme, accentColor)}
        onToggleInspector={() => setInspectorOpen((prev) => !prev)}
        onInspectKnowledge={(entry) => {
          setHighlightedEntryId(entry.id);
          navigateToArea('knowledge');
        }}
        onInspectRepoFile={(filePath) => {
          setSelectedRepoPath(filePath);
          setGithubSubTab('files');
          navigateToArea('github');
        }}
      />

      {/* Non-blocking Global Save & Sync Feedback */}
      {saveFeedback.state !== 'idle' && (
        <div
          role="status"
          aria-live="polite"
          className={`mantis-slide-up fixed right-4 bottom-28 z-40 flex items-center gap-2.5 rounded-md border px-3.5 py-2 text-xs font-medium shadow-lg sm:bottom-6 ${
            saveFeedback.state === 'failed'
              ? 'border-danger-border bg-surface/95 text-danger'
              : saveFeedback.state === 'queued'
                ? 'border-warn-border bg-surface/95 text-warn'
                : saveFeedback.state === 'saved'
                  ? 'border-accent-border bg-surface/95 text-accent-text'
                  : 'border-line-strong bg-surface/95 text-ink'
          }`}
        >
          {saveFeedback.state === 'saving' && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-text" />
          )}
          {saveFeedback.state === 'saved' && (
            <CheckCircle2 className="h-3.5 w-3.5 text-accent-text" />
          )}
          {saveFeedback.state === 'queued' && (
            <WifiOff className="h-3.5 w-3.5 text-warn" />
          )}
          {saveFeedback.state === 'failed' && (
            <AlertCircle className="h-3.5 w-3.5 text-danger" />
          )}

          <span>{saveFeedback.message}</span>

          {saveFeedback.state === 'failed' && retrySaveFnRef.current && (
            <button
              type="button"
              onClick={() => void retrySaveFnRef.current?.()}
              className="inline-flex min-h-[40px] items-center gap-1 rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500"
            >
              <RefreshCw className="h-3 w-3" />
              <span>Retry</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
