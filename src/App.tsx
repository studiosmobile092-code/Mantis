import type {Session} from '@supabase/supabase-js';
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FolderTree,
  Loader2,
  PanelLeftOpen,
  PanelRightOpen,
  RefreshCw,
  WifiOff,
  X,
} from 'lucide-react';
import {Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AuthGate} from './components/AuthGate';
import {ChatWorkspace} from './components/ChatWorkspace';
import {CommandPalette} from './components/CommandPalette';
import {LiveMonitorPanel} from './components/LiveMonitorPanel';
import {OnboardingGuide} from './components/OnboardingGuide';
import {SchemaSetupBanner} from './components/SchemaSetupBanner';
import {StudioExplorer} from './components/StudioExplorer';
import {TeachPanel} from './components/TeachPanel';
import {TopBar} from './components/TopBar';
import {
  DEFAULT_BRAIN_MODEL,
  askAiBrainChat,
  getLocalBrainConfig,
  getRouteStatus,
  normalizeBrainUrl,
  probeActiveBrainRoute,
  setLocalBrainConfig,
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
  resolveGuaranteedFolderId,
  saveEntryMetaFallback,
  saveOfflineWriteQueue,
  unmarkHashSaved,
} from './lib/knowledgeSync';
import {
  computeKnowledgeGrowth,
  mineKnowledgeFromText,
  synthesizeBuiltInReply,
} from './lib/mantisBrain';
import {STARTER_FOLDERS, computeMemoryReadiness} from './lib/memory';
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
import type {
  AccentColor,
  AreaId,
  BrainRouteStatus,
  ChatMessage,
  CodeSuggestion,
  GitHubConnection,
  KnowledgeEntry,
  KnowledgeFolder,
  KnowledgeStatus,
  LearningEvent,
  LearningEventKind,
  RepoFile,
  SaveFeedbackInfo,
  SelfAuditFinding,
  SelfAuditReport,
  SelfAuditRun,
  SuggestionKind,
  SuggestionStatus,
  ThemeMode,
  UserPreferences,
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

  const [activeArea, setActiveArea] = useState<AreaId>('studio');
  const [studioSubView, setStudioSubView] = useState<'console' | 'teach'>('console');
  const [githubSubTab, setGithubSubTab] = useState<'files' | 'suggestions' | 'self-improve'>('files');
  const [mobileDrawer, setMobileDrawer] = useState<'none' | 'explorer' | 'monitor'>('none');

  const [folders, setFolders] = useState<KnowledgeFolder[]>([]);
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
  const [offlineQueueCount, setOfflineQueueCount] = useState<number>(() => loadOfflineWriteQueue().length);
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
  const [leftPaneOpen, setLeftPaneOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('mantis_left_pane_v1') !== 'false';
    } catch {
      return true;
    }
  });
  const [rightPaneOpen, setRightPaneOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('mantis_right_pane_v1') !== 'false';
    } catch {
      return true;
    }
  });
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
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setLeftPaneOpen((prev) => {
          const next = !prev;
          try {
            window.localStorage.setItem('mantis_left_pane_v1', String(next));
          } catch {
            // ignore
          }
          return next;
        });
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
    if (queue.length === 0) return;

    const remaining = [...queue];
    let flushedCount = 0;

    while (remaining.length > 0) {
      const nextItem = remaining[0];
      try {
        if (nextItem.kind === 'save_entry') {
          const {error} = await supabase.from('knowledge_entries').insert(nextItem.payload);
          if (error && !isMissingPhase6ColumnError(error)) {
            if (isLikelyOfflineError(error)) break;
          }
        } else if (nextItem.kind === 'update_entry') {
          const {id, ...fields} = nextItem.payload;
          const {error} = await supabase
            .from('knowledge_entries')
            .update(fields)
            .eq('id', String(id));
          if (error && isLikelyOfflineError(error)) break;
        } else if (nextItem.kind === 'update_status') {
          const {id, status} = nextItem.payload;
          const {error} = await supabase
            .from('knowledge_entries')
            .update({status})
            .eq('id', String(id));
          if (error && !isMissingPhase6ColumnError(error) && isLikelyOfflineError(error)) break;
        }
        remaining.shift();
        flushedCount += 1;
      } catch (err) {
        if (isLikelyOfflineError(err)) break;
        remaining.shift();
      }
    }

    saveOfflineWriteQueue(remaining);
    setOfflineQueueCount(remaining.length);
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

    markHashSaved(dedupe.hash);
    const nowIso = new Date().toISOString();
    const desiredStatus = payload.status || getDefaultStatusForSource(payload.source);
    let resolvedFolderId = resolveGuaranteedFolderId(payload.folderId, folders);

    if (!resolvedFolderId && folders.length === 0) {
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
            const nextQ = enqueueOfflineWrite({kind: 'save_entry', payload: baseInsert});
            setOfflineQueueCount(nextQ.length);
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
          const nextQ = enqueueOfflineWrite({kind: 'save_entry', payload: baseInsert});
          setOfflineQueueCount(nextQ.length);
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
      ? resolveGuaranteedFolderId(payload.folderId, folders)
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
            payload: {id, ...baseUpdate},
          });
          setOfflineQueueCount(nextQ.length);
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
      retrySaveFnRef.current = null;
      setTransientSaveFeedback({state: 'saved', message: 'Saved ✓'});
      return true;
    } catch (err) {
      if (isLikelyOfflineError(err)) {
        const nextQ = enqueueOfflineWrite({kind: 'update_entry', payload: {id, ...baseUpdate}});
        setOfflineQueueCount(nextQ.length);
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

    if (id.startsWith('optimistic-') || phase6SchemaMissing) {
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
            payload: {id, status: nextStatus},
          });
          setOfflineQueueCount(nextQ.length);
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
          payload: {id, status: nextStatus},
        });
        setOfflineQueueCount(nextQ.length);
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

  function handleToggleLeftPane() {
    setLeftPaneOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('mantis_left_pane_v1', String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  function handleToggleRightPane() {
    setRightPaneOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('mantis_right_pane_v1', String(next));
      } catch {
        // ignore
      }
      return next;
    });
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

    let activeFolders = [...folders];
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
          for (const p of basePrepared) {
            latestQ = enqueueOfflineWrite({kind: 'save_entry', payload: p.baseRow});
          }
          setOfflineQueueCount(latestQ.length);
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
      entryIds.map(async (id) => {
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

  async function handleSendChatMessage(prompt: string, forceCloudAssist = false) {
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
      const repoLabel = connection ? `${connection.owner}/${connection.repo}` : null;

      // Always run deterministic Built-in Rule & Fact Miner automatically when autoLearnFromChat is ON
      let autoMinedCount = 0;
      if (autoLearnFromChat && !prompt.startsWith('/')) {
        const mined = mineKnowledgeFromText(prompt, entries);
        if (mined.length > 0) {
          autoMinedCount = await handleSaveCapturedEntries(mined, 'auto_mined');
        }
      }

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
          const defaultFolder =
            folders.find((f) => f.name.toLowerCase() === 'patterns') || folders[0] || null;
          const savedOk = await handleSaveEntry({
            title: noteTitle,
            content: noteContent,
            folderId: defaultFolder?.id || null,
            tags: [],
            source: 'chat',
            status: 'trusted',
          });
          replyText = savedOk
            ? `Saved "${noteTitle}" as Trusted to ${
                defaultFolder?.name || 'Patterns'
              }. Mantis indexed it with strong retrieval priority.`
            : 'Could not save note to Supabase — tap Retry on the save status notice.';
        }
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

          if ((brainUrl.trim() || backupBrainUrl.trim()) && session.access_token) {
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
              'Open GitHub → Suggestions to inspect the line-by-line diff and Approve or Reject before any repository edits.',
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
      } else if (
        (forceCloudAssist || !preferBuiltInFirst) &&
        (brainUrl.trim() || backupBrainUrl.trim()) &&
        session.access_token
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
          pushLearningEvent('cloud_assisted', 'Cloud Assist Reply', prompt.slice(0, 75), aiRes.modelUsed);

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
          const builtIn = synthesizeBuiltInReply({
            prompt,
            entries,
            folders,
            repoFiles,
            repoLabel,
            growth: knowledgeGrowth,
          });
          replyText = `[Built-in Fallback — Cloud Assist unavailable: ${
            aiErr instanceof Error ? aiErr.message : 'Network error'
          }]\n\n${builtIn.replyText}`;
          citedEntryIds = builtIn.citedEntryIds;
          citedRepoPaths = builtIn.citedRepoPaths;
        }
      } else {
        // Built-in AI Leads! Instant deterministic synthesis grounded in Concept Graph + Memory + Repo
        const builtIn = synthesizeBuiltInReply({
          prompt,
          entries,
          folders,
          repoFiles,
          repoLabel,
          growth: knowledgeGrowth,
        });
        replyText = builtIn.replyText;
        citedEntryIds = builtIn.citedEntryIds;
        citedRepoPaths = builtIn.citedRepoPaths;
      }

      if (autoMinedCount > 0) {
        replyText = `${replyText}\n\n[Built-in AI auto-mined & saved ${autoMinedCount} new Knowledge ${
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

      setMessages((prev) => [...prev, mantisMsgData as ChatMessage]);
    } finally {
      setIsSendingChat(false);
    }
  }

  async function handleEscalateMessageToCloud(msgId: string) {
    if (!session) return;
    const msgIdx = messages.findIndex((m) => m.id === msgId);
    if (msgIdx <= 0) return;
    const userMsg = messages[msgIdx - 1];
    if (!userMsg || userMsg.role !== 'user') return;

    if (!brainUrl.trim() && !backupBrainUrl.trim()) {
      setErrorBanner('Configure your Cloudflare Worker or Chromebook Supabase Backup URL in Settings to use Cloud Assist.');
      setActiveArea('settings');
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
      existingFolders: folders,
    });
    const ensured = await ensureAutoFolderExists(
      folderGuess.folderName,
      folderGuess.description,
      folders,
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
      <div className="flex min-h-screen items-center justify-center bg-canvas text-sm text-ink-muted">
        Loading Mantis Studio...
      </div>
    );
  }

  if (!session) {
    return <AuthGate onAuthenticated={() => {}} />;
  }

  const studioGridClass =
    leftPaneOpen && rightPaneOpen
      ? 'xl:grid-cols-[252px_minmax(0,1fr)_312px]'
      : leftPaneOpen
        ? 'xl:grid-cols-[252px_minmax(0,1fr)]'
        : rightPaneOpen
          ? 'xl:grid-cols-[minmax(0,1fr)_312px]'
          : 'xl:grid-cols-1';

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <TopBar
        activeArea={activeArea}
        onSelectArea={(area) => {
          setActiveArea(area);
          setMobileDrawer('none');
        }}
        routeStatus={routeStatus}
        knowledgeCount={entries.length}
        conceptCount={knowledgeGrowth.uniqueConcepts}
        pendingOfflineCount={offlineQueueCount}
        isOnline={isOnline}
        theme={theme}
        isSyncing={isLoadingData}
        onCycleTheme={() => void handleSelectAppearance(getNextThemeMode(theme), accentColor)}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        onSync={() => {
          void flushOfflineQueue();
          void loadWorkspaceData(session);
        }}
      />

      <main className="mx-auto max-w-[1600px] space-y-5 px-4 pt-5 pb-24 sm:px-6 md:pb-12">
        {schemaMissing && (
          <SchemaSetupBanner
            isChecking={isLoadingData}
            onRetry={() => void loadWorkspaceData(session)}
          />
        )}

        {errorBanner && !schemaMissing && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/40 bg-red-950/30 px-4 py-3 text-xs text-red-200"
          >
            <span>{errorBanner}</span>
            <button
              type="button"
              onClick={() => void loadWorkspaceData(session)}
              className="min-h-[36px] rounded border border-red-400/40 px-3 py-1 font-semibold hover:bg-red-900/40"
            >
              Retry
            </button>
          </div>
        )}

        {/* STUDIO: 3-Pane Collapsible Pro IDE Workbench */}
        {activeArea === 'studio' && (
          <div className="space-y-3">
            {/* Tablet / Mobile Drawer Toggles for Left Explorer & Right Monitor */}
            <div className="flex flex-wrap items-center justify-between gap-2 xl:hidden">
              <button
                type="button"
                onClick={() =>
                  setMobileDrawer((d) => (d === 'explorer' ? 'none' : 'explorer'))
                }
                className={`inline-flex min-h-[44px] items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  mobileDrawer === 'explorer'
                    ? 'border-accent-border bg-accent-soft text-accent-text'
                    : 'border-line bg-surface text-ink-muted hover:text-ink'
                }`}
              >
                <FolderTree className="h-4 w-4" />
                <span className="tabular-nums">Explorer ({entries.length})</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setMobileDrawer((d) => (d === 'monitor' ? 'none' : 'monitor'))
                }
                className={`inline-flex min-h-[44px] items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  mobileDrawer === 'monitor'
                    ? 'border-accent-border bg-accent-soft text-accent-text'
                    : 'border-line bg-surface text-ink-muted hover:text-ink'
                }`}
              >
                <Activity className="h-4 w-4 text-accent-text" />
                <span className="tabular-nums">
                  Live Monitor ({knowledgeGrowth.uniqueConcepts} concepts)
                </span>
              </button>
            </div>

            {mobileDrawer !== 'none' && (
              <div className="space-y-2 xl:hidden">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setMobileDrawer('none')}
                    className="inline-flex min-h-[40px] items-center gap-1 rounded border border-line bg-surface px-3 text-xs text-ink-muted hover:text-ink"
                  >
                    <X className="h-3.5 w-3.5" />
                    <span>Close Drawer</span>
                  </button>
                </div>
                {mobileDrawer === 'explorer' ? (
                  <StudioExplorer
                    folders={folders}
                    entries={entries}
                    growth={knowledgeGrowth}
                    connection={connection}
                    repoFiles={repoFiles}
                    onSelectFolder={(folderId) => {
                      setSelectedKnowledgeFolderId(folderId);
                      setActiveArea('knowledge');
                      setMobileDrawer('none');
                    }}
                    onQueryConcept={(label) => {
                      setStudioSubView('console');
                      setComposerPrefill(`/search ${label}`);
                      setMobileDrawer('none');
                    }}
                    onInspectRepoFile={(repoPath) => {
                      setSelectedRepoPath(repoPath);
                      setGithubSubTab('files');
                      setActiveArea('github');
                      setMobileDrawer('none');
                    }}
                    onOpenTeach={() => {
                      setStudioSubView('teach');
                      setMobileDrawer('none');
                    }}
                    onOpenCapture={() => {
                      setActiveArea('ingest');
                      setMobileDrawer('none');
                    }}
                    onOpenGitHub={() => {
                      setActiveArea('github');
                      setMobileDrawer('none');
                    }}
                  />
                ) : (
                  <LiveMonitorPanel
                    routeStatus={routeStatus}
                    entries={entries}
                    growth={knowledgeGrowth}
                    metrics={metrics}
                    learningEvents={learningEvents}
                    preferBuiltInFirst={preferBuiltInFirst}
                    onOpenSettings={() => setActiveArea('settings')}
                    onQueryConcept={(label) => {
                      setStudioSubView('console');
                      setComposerPrefill(`/search ${label}`);
                      setMobileDrawer('none');
                    }}
                  />
                )}
              </div>
            )}

            {/* Desktop Re-Expand Strip when Explorer or Monitor is Collapsed */}
            {(!leftPaneOpen || !rightPaneOpen) && (
              <div className="hidden items-center justify-between gap-2 xl:flex">
                {!leftPaneOpen ? (
                  <button
                    type="button"
                    onClick={handleToggleLeftPane}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-muted transition-colors hover:border-accent-border hover:text-ink"
                  >
                    <PanelLeftOpen className="h-3.5 w-3.5 text-accent-text" />
                    <span>Show Explorer (Ctrl+B)</span>
                  </button>
                ) : (
                  <span />
                )}

                {!rightPaneOpen && (
                  <button
                    type="button"
                    onClick={handleToggleRightPane}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-muted transition-colors hover:border-accent-border hover:text-ink"
                  >
                    <PanelRightOpen className="h-3.5 w-3.5 text-accent-text" />
                    <span>Show Live Monitor</span>
                  </button>
                )}
              </div>
            )}

            <div className={`grid gap-4 ${studioGridClass}`}>
              {/* Left Explorer */}
              {leftPaneOpen && (
                <div className="hidden xl:block">
                  <StudioExplorer
                    folders={folders}
                    entries={entries}
                    growth={knowledgeGrowth}
                    connection={connection}
                    repoFiles={repoFiles}
                    onSelectFolder={(folderId) => {
                      setSelectedKnowledgeFolderId(folderId);
                      setActiveArea('knowledge');
                    }}
                    onQueryConcept={(label) => {
                      setStudioSubView('console');
                      setComposerPrefill(`/search ${label}`);
                    }}
                    onInspectRepoFile={(repoPath) => {
                      setSelectedRepoPath(repoPath);
                      setGithubSubTab('files');
                      setActiveArea('github');
                    }}
                    onOpenTeach={() => setStudioSubView('teach')}
                    onOpenCapture={() => setActiveArea('ingest')}
                    onOpenGitHub={() => setActiveArea('github')}
                    onCollapse={handleToggleLeftPane}
                  />
                </div>
              )}

              {/* Center Studio Workbench */}
              <div className="min-w-0 space-y-4">
                {!onboardingDismissed && studioSubView === 'console' && (
                  <OnboardingGuide
                    knowledgeCount={entries.length}
                    trustedCount={entries.filter((e) => e.status === 'trusted').length}
                    hasInteractedChat={messages.length > 0}
                    onTeachFirstRule={() => setStudioSubView('teach')}
                    onOpenKnowledge={() => setActiveArea('knowledge')}
                    onOpenCapture={() => setActiveArea('ingest')}
                    onDismiss={() => {
                      setOnboardingDismissed(true);
                      try {
                        window.localStorage.setItem('mantis_onboarding_dismissed_v1', 'true');
                      } catch {
                        // ignore
                      }
                    }}
                  />
                )}

                {studioSubView === 'teach' ? (
                  <div className="space-y-4">
                    <button
                      type="button"
                      onClick={() => setStudioSubView('console')}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      <span>Back to AI Console</span>
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
                      onOpenKnowledge={() => setActiveArea('knowledge')}
                    />
                  </div>
                ) : (
                  <ChatWorkspace
                    messages={messages}
                    entries={entries}
                    connection={connection}
                    routeStatus={routeStatus}
                    preferBuiltInFirst={preferBuiltInFirst}
                    onTogglePreferBuiltIn={(next) => void handleTogglePreferBuiltIn(next)}
                    brainModel={brainModel}
                    isLoading={isLoadingData}
                    isSending={isSendingChat}
                    escalatingMsgId={escalatingMsgId}
                    composerPrefill={composerPrefill}
                    onConsumeComposerPrefill={() => setComposerPrefill('')}
                    onSendMessage={handleSendChatMessage}
                    onEscalateMessageToCloud={handleEscalateMessageToCloud}
                    onClearChat={handleClearChat}
                    onInspectEntry={(entryId) => {
                      setHighlightedEntryId(entryId);
                      setActiveArea('knowledge');
                    }}
                    onInspectRepoFile={(repoPath) => {
                      setSelectedRepoPath(repoPath);
                      setGithubSubTab('files');
                      setActiveArea('github');
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
                    onOpenIngest={() => setActiveArea('ingest')}
                    onOpenTeach={() => setStudioSubView('teach')}
                    onOpenSuggestions={() => {
                      setGithubSubTab('suggestions');
                      setActiveArea('github');
                    }}
                    onOpenSettings={() => setActiveArea('settings')}
                  />
                )}
              </div>

              {/* Right Live Monitor */}
              {rightPaneOpen && (
                <div className="hidden xl:block">
                  <LiveMonitorPanel
                    routeStatus={routeStatus}
                    entries={entries}
                    growth={knowledgeGrowth}
                    metrics={metrics}
                    learningEvents={learningEvents}
                    preferBuiltInFirst={preferBuiltInFirst}
                    onOpenSettings={() => setActiveArea('settings')}
                    onQueryConcept={(label) => {
                      setStudioSubView('console');
                      setComposerPrefill(`/search ${label}`);
                    }}
                    onCollapse={handleToggleRightPane}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        <Suspense fallback={<PanelLoadingSkeleton />}>
          {activeArea === 'knowledge' && (
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
                setActiveArea('studio');
              }}
            />
          )}

          {activeArea === 'ingest' && (
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
              onOpenKnowledge={() => setActiveArea('knowledge')}
            />
          )}

          {activeArea === 'github' && (
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
                setActiveArea('studio');
              }}
              onSaveLessonToTeach={(title, content, tags) => {
                setTeachPrefill({
                  key: Date.now(),
                  title,
                  content,
                  tags,
                });
                setStudioSubView('teach');
                setActiveArea('studio');
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

          {activeArea === 'settings' && (
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
              onFlushOfflineQueue={() => void flushOfflineQueue()}
              brainUrl={brainUrl}
              backupBrainUrl={backupBrainUrl}
              brainModel={brainModel}
              autoLearnFromChat={autoLearnFromChat}
              preferBuiltInFirst={preferBuiltInFirst}
              accessToken={session.access_token}
              connection={connection}
              onSaveBrainConfig={handleSaveBrainConfig}
              onSignOut={handleSignOut}
            />
          )}
        </Suspense>
      </main>

      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        entries={entries}
        folders={folders}
        repoFiles={repoFiles}
        onNavigateArea={(area) => {
          setActiveArea(area);
          setMobileDrawer('none');
        }}
        onOpenTeach={() => {
          setStudioSubView('teach');
          setActiveArea('studio');
        }}
        onSync={() => {
          void flushOfflineQueue();
          void loadWorkspaceData(session);
        }}
        onSelectTheme={(nextTheme) => void handleSelectAppearance(nextTheme, accentColor)}
        onToggleLeftPane={handleToggleLeftPane}
        onToggleRightPane={handleToggleRightPane}
        onInspectKnowledge={(entry) => {
          setHighlightedEntryId(entry.id);
          setActiveArea('knowledge');
        }}
        onInspectRepoFile={(filePath) => {
          setSelectedRepoPath(filePath);
          setGithubSubTab('files');
          setActiveArea('github');
        }}
      />

      {/* Non-blocking Global Save & Sync Feedback */}
      {saveFeedback.state !== 'idle' && (
        <div
          role="status"
          aria-live="polite"
          className={`mantis-slide-up fixed right-4 bottom-20 z-40 flex items-center gap-2.5 rounded-md border px-3.5 py-2 text-xs font-medium shadow-lg md:bottom-5 ${
            saveFeedback.state === 'failed'
              ? 'border-red-500/50 bg-red-950/95 text-red-100'
              : saveFeedback.state === 'queued'
                ? 'border-amber-500/50 bg-amber-950/95 text-amber-100'
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
            <WifiOff className="h-3.5 w-3.5 text-amber-300" />
          )}
          {saveFeedback.state === 'failed' && (
            <AlertCircle className="h-3.5 w-3.5 text-red-300" />
          )}

          <span>{saveFeedback.message}</span>

          {saveFeedback.state === 'failed' && retrySaveFnRef.current && (
            <button
              type="button"
              onClick={() => void retrySaveFnRef.current?.()}
              className="inline-flex min-h-[36px] items-center gap-1 rounded bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-500"
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
