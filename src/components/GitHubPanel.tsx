import {
  BookmarkPlus,
  Check,
  Copy,
  Database,
  FileCode2,
  GitBranch,
  KeyRound,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {type FormEvent, useEffect, useMemo, useState} from 'react';
import {
  getSessionGitHubToken,
  parseGitHubRepoInput,
  setSessionGitHubToken,
} from '../lib/github';
import {MANTIS_PHASE2_SCHEMA_SQL} from '../lib/schemaText';
import type {
  CodeSuggestion,
  GitHubConnection,
  RepoFile,
  SelfAuditFinding,
  SelfAuditReport,
  SelfAuditRun,
  SuggestionStatus,
} from '../types/mantis';
import {SelfImprovePanel} from './SelfImprovePanel';
import {SuggestionsPanel} from './SuggestionsPanel';

interface GitHubPanelProps {
  connection: GitHubConnection | null;
  repoFiles: RepoFile[];
  suggestions: CodeSuggestion[];
  auditRuns: SelfAuditRun[];
  latestAuditReport: SelfAuditReport | null;
  activeSubTab: 'files' | 'suggestions' | 'self-improve';
  onChangeSubTab: (tab: 'files' | 'suggestions' | 'self-improve') => void;
  phase2SchemaMissing: boolean;
  phase3SchemaMissing: boolean;
  phase4SchemaMissing: boolean;
  isSyncingRepo: boolean;
  syncProgressText: string | null;
  isAuditingSelf: boolean;
  auditProgressText: string | null;
  selectedFilePath: string | null;
  onSelectFilePath: (path: string | null) => void;
  onVerifyTables: () => void;
  onConnectRepo: (owner: string, repo: string, branch?: string, token?: string) => Promise<void>;
  onResyncRepo: (token?: string) => Promise<void>;
  onDisconnectRepo: () => Promise<void>;
  onSaveFileToTeach: (file: RepoFile) => void;
  onSaveLessonToTeach: (title: string, content: string, tags: string) => void;
  onGenerateFromFile: (file: RepoFile, goal: string) => Promise<void>;
  onGenerateNewFile: (targetPath: string, goal: string) => Promise<void>;
  onUpdateProposedContent: (id: string, proposedContent: string) => Promise<boolean>;
  onReviewSuggestion: (
    id: string,
    status: SuggestionStatus,
    feedback: string,
    prUrl?: string,
  ) => Promise<boolean>;
  onDeleteSuggestion: (id: string) => Promise<boolean>;
  onRunSelfAudit: (repoInput: string) => Promise<void>;
  onStageAuditFinding: (finding: SelfAuditFinding) => Promise<void>;
}

export function GitHubPanel({
  connection,
  repoFiles,
  suggestions,
  auditRuns,
  latestAuditReport,
  activeSubTab,
  onChangeSubTab,
  phase2SchemaMissing,
  phase3SchemaMissing,
  phase4SchemaMissing,
  isSyncingRepo,
  syncProgressText,
  isAuditingSelf,
  auditProgressText,
  selectedFilePath,
  onSelectFilePath,
  onVerifyTables,
  onConnectRepo,
  onResyncRepo,
  onDisconnectRepo,
  onSaveFileToTeach,
  onSaveLessonToTeach,
  onGenerateFromFile,
  onGenerateNewFile,
  onUpdateProposedContent,
  onReviewSuggestion,
  onDeleteSuggestion,
  onRunSelfAudit,
  onStageAuditFinding,
}: GitHubPanelProps) {
  const [repoInput, setRepoInput] = useState(
    connection ? `${connection.owner}/${connection.repo}` : 'studiosmobile092-code/Mantis',
  );
  const [branchInput, setBranchInput] = useState(connection?.branch || '');
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [tokenInput, setTokenInput] = useState(() => getSessionGitHubToken());
  const [formError, setFormError] = useState<string | null>(null);
  const [fileSearch, setFileSearch] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [isAnalyzingFile, setIsAnalyzingFile] = useState(false);

  useEffect(() => {
    if (connection) {
      setRepoInput(`${connection.owner}/${connection.repo}`);
      setBranchInput(connection.branch);
    }
  }, [connection]);

  useEffect(() => {
    if (
      repoFiles.length > 0 &&
      (!selectedFilePath || !repoFiles.some((f) => f.path === selectedFilePath))
    ) {
      onSelectFilePath(repoFiles[0].path);
    }
  }, [repoFiles, selectedFilePath, onSelectFilePath]);

  const filteredFiles = useMemo(() => {
    const q = fileSearch.trim().toLowerCase();
    if (!q) return repoFiles;
    return repoFiles.filter(
      (f) => f.path.toLowerCase().includes(q) || f.content.toLowerCase().includes(q),
    );
  }, [repoFiles, fileSearch]);

  const activeFile = useMemo(
    () => repoFiles.find((f) => f.path === selectedFilePath) || filteredFiles[0] || null,
    [repoFiles, filteredFiles, selectedFilePath],
  );

  const pendingSuggestionsCount = useMemo(
    () => suggestions.filter((s) => s.status === 'pending').length,
    [suggestions],
  );

  async function handleConnectSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const parsed = parseGitHubRepoInput(repoInput);
    if (!parsed) {
      setFormError(
        'Enter a repository as owner/repo (e.g. studiosmobile092-code/Mantis) or a GitHub URL.',
      );
      return;
    }
    setSessionGitHubToken(tokenInput);
    try {
      await onConnectRepo(
        parsed.owner,
        parsed.repo,
        branchInput.trim() || undefined,
        tokenInput.trim() || undefined,
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to connect repository.');
    }
  }

  async function handleCopySql() {
    try {
      await navigator.clipboard.writeText(MANTIS_PHASE2_SCHEMA_SQL);
      setCopiedSql(true);
      window.setTimeout(() => setCopiedSql(false), 2500);
    } catch {
      setCopiedSql(false);
    }
  }

  async function handleQuickPropose(file: RepoFile) {
    setIsAnalyzingFile(true);
    try {
      await onGenerateFromFile(file, '');
      onChangeSubTab('suggestions');
    } finally {
      setIsAnalyzingFile(false);
    }
  }

  return (
    <div className="mantis-fade-in space-y-6">
      <div className="flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            GitHub &amp; Code Suggestions
          </h1>
          <p className="text-sm text-ink-muted">
            Read-only repository awareness, approval-gated diffs, and guarded self-improvement (Propose-Only).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 rounded-md border border-line bg-surface p-1">
            <button
              type="button"
              onClick={() => onChangeSubTab('files')}
              className={`min-h-[40px] rounded px-3 text-xs font-medium tabular-nums transition-colors ${
                activeSubTab === 'files'
                  ? 'bg-elevated text-ink'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              Repository ({repoFiles.length})
            </button>
            <button
              type="button"
              onClick={() => onChangeSubTab('suggestions')}
              className={`min-h-[40px] rounded px-3 text-xs font-medium tabular-nums transition-colors ${
                activeSubTab === 'suggestions'
                  ? 'bg-elevated text-ink'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              Suggestions ({pendingSuggestionsCount} pending)
            </button>
            <button
              type="button"
              onClick={() => onChangeSubTab('self-improve')}
              className={`min-h-[40px] rounded px-3 text-xs font-medium tabular-nums transition-colors ${
                activeSubTab === 'self-improve'
                  ? 'bg-elevated text-ink'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              Self-Improve
            </button>
          </div>
        </div>
      </div>

      {activeSubTab === 'self-improve' ? (
        <SelfImprovePanel
          connection={connection}
          suggestions={suggestions}
          auditRuns={auditRuns}
          latestReport={latestAuditReport}
          phase4SchemaMissing={phase4SchemaMissing}
          isAuditing={isAuditingSelf}
          auditProgressText={auditProgressText}
          onVerifyPhase4Tables={onVerifyTables}
          onRunSelfAudit={onRunSelfAudit}
          onStageFinding={onStageAuditFinding}
          onOpenSuggestionsQueue={() => onChangeSubTab('suggestions')}
        />
      ) : activeSubTab === 'suggestions' ? (
        <SuggestionsPanel
          connection={connection}
          repoFiles={repoFiles}
          suggestions={suggestions}
          phase3SchemaMissing={phase3SchemaMissing}
          onVerifyPhase3Tables={onVerifyTables}
          onGenerateFromFile={onGenerateFromFile}
          onGenerateNewFile={onGenerateNewFile}
          onUpdateProposedContent={onUpdateProposedContent}
          onReviewSuggestion={onReviewSuggestion}
          onDeleteSuggestion={onDeleteSuggestion}
          onSaveLessonToTeach={onSaveLessonToTeach}
        />
      ) : phase2SchemaMissing ? (
        <section className="rounded-lg border border-warn-border bg-surface p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-warn">
                <Database className="h-4 w-4 shrink-0" />
                <span>One-Time Phase 2 SQL Migration Needed</span>
              </div>
              <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">
                To store connected GitHub repositories and indexed source files safely in Supabase,
                run the Phase 2 SQL migration once in your Supabase SQL Editor, then tap{' '}
                <strong>Verify Phase 2 Tables</strong>.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCopySql}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-line-strong bg-inset px-4 py-2 text-xs font-medium text-ink hover:bg-elevated"
              >
                {copiedSql ? (
                  <Check className="h-4 w-4 text-accent-text" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                <span>{copiedSql ? 'Phase 2 SQL Copied' : 'Copy Phase 2 SQL'}</span>
              </button>
              <button
                type="button"
                onClick={onVerifyTables}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Verify Phase 2 Tables</span>
              </button>
            </div>
          </div>
          <pre className="mt-4 max-h-56 overflow-auto rounded-md border border-line bg-inset p-3 font-mono text-xs leading-relaxed text-ink">
            {MANTIS_PHASE2_SCHEMA_SQL}
          </pre>
        </section>
      ) : (
        <>
          {/* Connect / Change Repository Form */}
          <form
            onSubmit={handleConnectSubmit}
            className="space-y-4 rounded-lg border border-line bg-surface p-5"
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
              <div className="space-y-1">
                <label htmlFor="gh-repo" className="block text-xs font-medium text-ink-muted">
                  GitHub Repository (owner/repo or URL)
                </label>
                <input
                  id="gh-repo"
                  type="text"
                  required
                  value={repoInput}
                  onChange={(e) => setRepoInput(e.target.value)}
                  placeholder="studiosmobile092-code/Mantis"
                  className="min-h-[44px] w-full rounded-md border border-line-strong bg-inset px-3.5 py-2 font-mono text-xs text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="gh-branch" className="block text-xs font-medium text-ink-muted">
                  Branch (optional)
                </label>
                <input
                  id="gh-branch"
                  type="text"
                  value={branchInput}
                  onChange={(e) => setBranchInput(e.target.value)}
                  placeholder="main"
                  className="min-h-[44px] w-full rounded-md border border-line-strong bg-inset px-3.5 py-2 font-mono text-xs text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
                />
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={isSyncingRepo}
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-accent px-5 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-60 sm:w-auto"
                >
                  <GitBranch className="h-4 w-4" />
                  <span>
                    {isSyncingRepo
                      ? 'Indexing…'
                      : connection
                        ? 'Update Repo'
                        : 'Connect Read-Only'}
                  </span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
              <span>
                Public repositories require no token. Read-only indexing (up to 40 key source
                files).
              </span>
              <button
                type="button"
                onClick={() => setShowTokenInput((v) => !v)}
                className="inline-flex items-center gap-1.5 font-medium text-ink hover:underline"
              >
                <KeyRound className="h-3.5 w-3.5" />
                <span>
                  {showTokenInput ? 'Hide Session Token' : 'Private Repo Token (Session Only)'}
                </span>
              </button>
            </div>

            {showTokenInput && (
              <div className="space-y-1.5 border-t border-line pt-3">
                <label htmlFor="gh-pat" className="block text-xs font-medium text-ink-muted">
                  Optional Read-Only GitHub Token (browser sessionStorage only)
                </label>
                <input
                  id="gh-pat"
                  type="password"
                  value={tokenInput}
                  onChange={(e) => {
                    setTokenInput(e.target.value);
                    setSessionGitHubToken(e.target.value);
                  }}
                  placeholder="github_pat_... (leave blank for public repos)"
                  className="min-h-[44px] w-full rounded-md border border-line-strong bg-inset px-3.5 py-2 font-mono text-xs text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
                />
              </div>
            )}

            {syncProgressText && (
              <div className="rounded-md border border-line bg-inset px-3.5 py-2 font-mono text-xs text-accent-text">
                {syncProgressText}
              </div>
            )}

            {formError && (
              <div
                role="alert"
                className="rounded-md border border-danger-border bg-danger-soft px-3.5 py-2.5 text-xs text-danger"
              >
                {formError}
              </div>
            )}
          </form>

          {/* Indexed Repository Explorer */}
          {connection && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface px-4 py-3 font-mono text-xs text-ink-muted">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-accent-text">
                    {connection.owner}/{connection.repo}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>branch: {connection.branch}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{repoFiles.length} files indexed</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums text-ink-subtle">
                    Synced {new Date(connection.last_synced_at).toLocaleString()}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isSyncingRepo}
                    onClick={() => void onResyncRepo(tokenInput.trim() || undefined)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded border border-line-strong bg-inset px-3 py-1 text-xs font-medium text-ink hover:bg-elevated disabled:opacity-60"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isSyncingRepo ? 'animate-spin' : ''}`} />
                    <span>Re-sync</span>
                  </button>

                  {confirmDisconnect ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isSyncingRepo}
                        onClick={async () => {
                          await onDisconnectRepo();
                          setConfirmDisconnect(false);
                        }}
                        className="min-h-[40px] rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDisconnect(false)}
                        className="min-h-[40px] rounded border border-line-strong px-2.5 py-1 text-xs text-ink-muted hover:bg-elevated"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDisconnect(true)}
                      className="inline-flex min-h-[40px] items-center gap-1 rounded border border-line bg-inset px-2.5 py-1 text-xs text-ink-muted hover:border-danger-border hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Disconnect</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
                {/* File Tree List */}
                <aside className="space-y-2 rounded-lg border border-line bg-surface p-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
                    <input
                      type="search"
                      value={fileSearch}
                      onChange={(e) => setFileSearch(e.target.value)}
                      placeholder="Filter repo files..."
                      className="min-h-[42px] w-full rounded-md border border-line-strong bg-inset py-1.5 pr-3 pl-8 font-mono text-xs text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
                    />
                  </div>

                  <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
                    {filteredFiles.length === 0 ? (
                      <p className="px-2 py-4 text-center text-xs text-ink-muted">
                        No indexed files match that filter.
                      </p>
                    ) : (
                      filteredFiles.map((file) => {
                        const isSelected = activeFile?.path === file.path;
                        return (
                          <button
                            key={file.id}
                            type="button"
                            onClick={() => onSelectFilePath(file.path)}
                            className={`flex min-h-[40px] w-full items-center gap-2 rounded px-2.5 py-1.5 text-left font-mono text-xs transition-colors ${
                              isSelected
                                ? 'bg-accent-soft font-medium text-accent-text'
                                : 'text-ink-muted hover:bg-elevated/60 hover:text-ink'
                            }`}
                          >
                            <FileCode2 className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                            <span className="truncate">{file.path}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </aside>

                {/* Read-Only Code Viewer */}
                <section className="rounded-lg border border-line bg-surface p-4">
                  {activeFile ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                        <div className="space-y-0.5">
                          <div className="font-mono text-sm font-semibold text-ink">
                            {activeFile.path}
                          </div>
                          <div className="font-mono text-xs tabular-nums text-ink-muted">
                            {activeFile.size_bytes} bytes · Read-only snapshot
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={isAnalyzingFile}
                            onClick={() => void handleQuickPropose(activeFile)}
                            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                            <span>{isAnalyzingFile ? 'Analyzing…' : 'Propose Improvement'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => onSaveFileToTeach(activeFile)}
                            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-md border border-line-strong bg-inset px-3 py-1.5 text-xs font-medium text-ink hover:bg-elevated"
                          >
                            <BookmarkPlus className="h-3.5 w-3.5" />
                            <span>Save to Teach</span>
                          </button>
                        </div>
                      </div>
                      <pre className="max-h-[420px] overflow-auto rounded-md border border-line bg-inset p-3.5 font-mono text-xs leading-relaxed text-ink">
                        {activeFile.content}
                      </pre>
                    </div>
                  ) : (
                    <p className="py-12 text-center text-xs text-ink-muted">
                      Select an indexed file to inspect its contents.
                    </p>
                  )}
                </section>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
