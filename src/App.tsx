import type {Session} from '@supabase/supabase-js';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {AuthGate} from './components/AuthGate';
import {ChatWorkspace} from './components/ChatWorkspace';
import {GitHubPanel} from './components/GitHubPanel';
import {KnowledgeBrowser} from './components/KnowledgeBrowser';
import {SchemaSetupBanner} from './components/SchemaSetupBanner';
import {SettingsPanel} from './components/SettingsPanel';
import {TeachPanel} from './components/TeachPanel';
import {TopBar} from './components/TopBar';
import {
  fetchGitHubFileContent,
  fetchGitHubRepoMetadata,
  fetchGitHubTreeFiles,
  getSessionGitHubToken,
  parseGitHubRepoInput,
} from './lib/github';
import {STARTER_FOLDERS, buildMemoryReply, computeMemoryReadiness} from './lib/memory';
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
import type {
  AreaId,
  ChatMessage,
  CodeSuggestion,
  GitHubConnection,
  KnowledgeEntry,
  KnowledgeFolder,
  RepoFile,
  SelfAuditFinding,
  SelfAuditReport,
  SelfAuditRun,
  SuggestionKind,
  SuggestionStatus,
} from './types/mantis';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [activeArea, setActiveArea] = useState<AreaId>('chat');
  const [githubSubTab, setGithubSubTab] = useState<'files' | 'suggestions' | 'self-improve'>('files');

  const [folders, setFolders] = useState<KnowledgeFolder[]>([]);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connection, setConnection] = useState<GitHubConnection | null>(null);
  const [repoFiles, setRepoFiles] = useState<RepoFile[]>([]);
  const [suggestions, setSuggestions] = useState<CodeSuggestion[]>([]);
  const [auditRuns, setAuditRuns] = useState<SelfAuditRun[]>([]);
  const [latestAuditReport, setLatestAuditReport] = useState<SelfAuditReport | null>(null);

  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [isSyncingRepo, setIsSyncingRepo] = useState(false);
  const [syncProgressText, setSyncProgressText] = useState<string | null>(null);
  const [isAuditingSelf, setIsAuditingSelf] = useState(false);
  const [auditProgressText, setAuditProgressText] = useState<string | null>(null);

  const [schemaMissing, setSchemaMissing] = useState(false);
  const [phase2SchemaMissing, setPhase2SchemaMissing] = useState(false);
  const [phase3SchemaMissing, setPhase3SchemaMissing] = useState(false);
  const [phase4SchemaMissing, setPhase4SchemaMissing] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [highlightedEntryId, setHighlightedEntryId] = useState<string | null>(null);
  const [selectedRepoPath, setSelectedRepoPath] = useState<string | null>(null);
  const [teachPrefill, setTeachPrefill] = useState<{
    key: number;
    title: string;
    content: string;
    tags: string;
  }>({key: 0, title: '', content: '', tags: ''});

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
      const [foldersRes, entriesRes, messagesRes, connRes, filesRes, suggestionsRes, auditRunsRes] =
        await Promise.all([
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
      setEntries((entriesRes.data as KnowledgeEntry[]) || []);
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
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to reach Supabase');
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (session) {
      void loadWorkspaceData(session);
    } else {
      setFolders([]);
      setEntries([]);
      setMessages([]);
      setConnection(null);
      setRepoFiles([]);
      setSuggestions([]);
      setAuditRuns([]);
      setLatestAuditReport(null);
      setSchemaMissing(false);
      setPhase2SchemaMissing(false);
      setPhase3SchemaMissing(false);
      setPhase4SchemaMissing(false);
      setErrorBanner(null);
    }
  }, [session, loadWorkspaceData]);

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
  }): Promise<boolean> {
    if (!session) return false;
    setErrorBanner(null);

    const {data, error} = await supabase
      .from('knowledge_entries')
      .insert({
        user_id: session.user.id,
        folder_id: payload.folderId,
        title: payload.title,
        content: payload.content,
        tags: payload.tags,
        source: payload.source,
      })
      .select('*')
      .single();

    if (error) {
      setErrorBanner(error.message);
      return false;
    }

    const created = data as KnowledgeEntry;
    setEntries((prev) => [created, ...prev]);
    return true;
  }

  async function handleUpdateEntry(
    id: string,
    payload: {title: string; content: string; folderId: string | null; tags: string[]},
  ): Promise<boolean> {
    if (!session) return false;
    setErrorBanner(null);

    const {data, error} = await supabase
      .from('knowledge_entries')
      .update({
        title: payload.title,
        content: payload.content,
        folder_id: payload.folderId,
        tags: payload.tags,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      setErrorBanner(error.message);
      return false;
    }

    const updated = data as KnowledgeEntry;
    setEntries((prev) => prev.map((item) => (item.id === id ? updated : item)));
    return true;
  }

  async function handleDeleteEntry(id: string): Promise<boolean> {
    if (!session) return false;
    setErrorBanner(null);

    const {error} = await supabase.from('knowledge_entries').delete().eq('id', id);
    if (error) {
      setErrorBanner(error.message);
      return false;
    }

    setEntries((prev) => prev.filter((item) => item.id !== id));
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

  async function handleGenerateFromFile(file: RepoFile, goal: string) {
    const draft = generateImprovementSuggestion(file, goal, entries, folders);
    await persistSuggestionDraft(draft, 'code_help');
  }

  async function handleGenerateNewFile(targetPath: string, goal: string) {
    const draft = generateNewCodeSuggestion(targetPath, goal, entries, folders);
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

  async function handleSendChatMessage(prompt: string) {
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
          const {data: savedNote, error: noteErr} = await supabase
            .from('knowledge_entries')
            .insert({
              user_id: session.user.id,
              folder_id: defaultFolder?.id || null,
              title: noteTitle,
              content: noteContent,
              tags: [],
              source: 'chat',
            })
            .select('*')
            .single();

          if (noteErr) {
            replyText = `Could not save note to Supabase: ${noteErr.message}`;
          } else {
            const createdNote = savedNote as KnowledgeEntry;
            setEntries((prev) => [createdNote, ...prev]);
            citedEntryIds = [createdNote.id];
            replyText = `Saved "${createdNote.title}" to ${
              defaultFolder?.name || 'Uncategorized'
            }. I will retrieve and cite this entry when relevant.`;
          }
        }
      } else if (prompt.toLowerCase().startsWith('/suggest ')) {
        const targetQuery = prompt.slice(9).trim();
        if (phase3SchemaMissing) {
          replyText =
            'Phase 3 SQL migration is required before saving code suggestions. Open GitHub → Suggestions or Settings to copy and run `supabase/schema_phase3.sql`.';
        } else {
          const matchedFile = repoFiles.find((f) =>
            f.path.toLowerCase().includes(targetQuery.toLowerCase()),
          );
          const draft = matchedFile
            ? generateImprovementSuggestion(matchedFile, '', entries, folders)
            : generateNewCodeSuggestion(
                targetQuery.includes('.') ? targetQuery : 'src/lib/proposedHelper.ts',
                targetQuery,
                entries,
                folders,
              );
          const created = await persistSuggestionDraft(draft);
          if (created) {
            if (matchedFile) {
              citedRepoPaths = [matchedFile.path];
            }
            replyText = [
              `Created code suggestion "${created.title}" (status: pending review).`,
              `Rationale: ${created.rationale}`,
              '',
              'Open GitHub → Suggestions to inspect the line-by-line diff and explicitly Approve or Reject it before any write actions unlock.',
            ].join('\n');
          } else {
            replyText = 'Could not save code suggestion to Supabase. Check Settings for schema status.';
          }
        }
      } else if (prompt.toLowerCase().trim() === '/self-audit' || prompt.toLowerCase().startsWith('/self-audit ')) {
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
            '',
            'Open GitHub → Self-Improve to inspect findings and stage diffs for your approval. No files are ever modified automatically.',
          ].join('\n');
          citedRepoPaths = report.findings.slice(0, 3).map((f) => f.filePath);
        } catch (err) {
          replyText = `Self-Audit could not complete: ${
            err instanceof Error ? err.message : 'Unable to fetch repository'
          }`;
        }
      } else {
        const repoLabel = connection ? `${connection.owner}/${connection.repo}` : null;
        const result = buildMemoryReply(prompt, entries, folders, repoFiles, repoLabel);
        replyText = result.replyText;
        citedEntryIds = result.citedEntryIds;
        citedRepoPaths = result.citedRepoPaths;
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

  async function handleSignOut() {
    await supabase.auth.signOut();
    setSession(null);
  }

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0B1120] text-sm text-slate-400">
        Loading Mantis...
      </div>
    );
  }

  if (!session) {
    return <AuthGate onAuthenticated={() => {}} />;
  }

  const statusLabel = schemaMissing
    ? 'Setup Required'
    : errorBanner
      ? 'Check Connection'
      : 'Connected';

  return (
    <div className="min-h-screen bg-[#0B1120] text-slate-100">
      <TopBar
        activeArea={activeArea}
        onSelectArea={setActiveArea}
        statusLabel={statusLabel}
        knowledgeCount={entries.length}
        repoFileCount={repoFiles.length}
        readinessScore={metrics.readinessScore}
        isSyncing={isLoadingData}
        onSync={() => void loadWorkspaceData(session)}
      />

      <main className="mx-auto max-w-6xl space-y-6 px-4 pt-6 pb-24 sm:px-6 md:pb-12">
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
              className="rounded border border-red-400/40 px-3 py-1 font-semibold hover:bg-red-900/40"
            >
              Retry
            </button>
          </div>
        )}

        {activeArea === 'chat' && (
          <ChatWorkspace
            messages={messages}
            entries={entries}
            connection={connection}
            isLoading={isLoadingData}
            isSending={isSendingChat}
            onSendMessage={handleSendChatMessage}
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
              setActiveArea('teach');
            }}
          />
        )}

        {activeArea === 'knowledge' && (
          <KnowledgeBrowser
            folders={folders}
            entries={entries}
            isLoading={isLoadingData}
            highlightedEntryId={highlightedEntryId}
            onClearHighlight={() => setHighlightedEntryId(null)}
            onCreateFolder={handleCreateFolder}
            onDeleteFolder={handleDeleteFolder}
            onUpdateEntry={handleUpdateEntry}
            onDeleteEntry={handleDeleteEntry}
            onOpenTeach={() => setActiveArea('teach')}
          />
        )}

        {activeArea === 'teach' && (
          <TeachPanel
            key={teachPrefill.key}
            folders={folders}
            entries={entries}
            initialTitle={teachPrefill.title}
            initialContent={teachPrefill.content}
            initialTags={teachPrefill.tags}
            onSaveEntry={handleSaveEntry}
            onCreateFolder={handleCreateFolder}
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
              setActiveArea('teach');
            }}
            onSaveLessonToTeach={(title, content, tags) => {
              setTeachPrefill({
                key: Date.now(),
                title,
                content,
                tags,
              });
              setActiveArea('teach');
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
            schemaMissing={schemaMissing}
            phase2SchemaMissing={phase2SchemaMissing}
            phase3SchemaMissing={phase3SchemaMissing}
            phase4SchemaMissing={phase4SchemaMissing}
            connection={connection}
            onSignOut={handleSignOut}
          />
        )}
      </main>
    </div>
  );
}
