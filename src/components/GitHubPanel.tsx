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
  Trash2,
} from 'lucide-react';
import {type FormEvent, useEffect, useMemo, useState} from 'react';
import {
  getSessionGitHubToken,
  parseGitHubRepoInput,
  setSessionGitHubToken,
} from '../lib/github';
import {MANTIS_PHASE2_SCHEMA_SQL} from '../lib/schemaText';
import type {GitHubConnection, RepoFile} from '../types/mantis';

interface GitHubPanelProps {
  connection: GitHubConnection | null;
  repoFiles: RepoFile[];
  phase2SchemaMissing: boolean;
  isSyncingRepo: boolean;
  syncProgressText: string | null;
  selectedFilePath: string | null;
  onSelectFilePath: (path: string | null) => void;
  onVerifyPhase2Tables: () => void;
  onConnectRepo: (owner: string, repo: string, branch?: string, token?: string) => Promise<void>;
  onResyncRepo: (token?: string) => Promise<void>;
  onDisconnectRepo: () => Promise<void>;
  onSaveFileToTeach: (file: RepoFile) => void;
}

export function GitHubPanel({
  connection,
  repoFiles,
  phase2SchemaMissing,
  isSyncingRepo,
  syncProgressText,
  selectedFilePath,
  onSelectFilePath,
  onVerifyPhase2Tables,
  onConnectRepo,
  onResyncRepo,
  onDisconnectRepo,
  onSaveFileToTeach,
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

  useEffect(() => {
    if (repoFiles.length > 0 && (!selectedFilePath || !repoFiles.some((f) => f.path === selectedFilePath))) {
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

  async function handleConnectSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const parsed = parseGitHubRepoInput(repoInput);
    if (!parsed) {
      setFormError('Enter a repository as owner/repo (e.g. studiosmobile092-code/Mantis) or a GitHub URL.');
      return;
    }
    setSessionGitHubToken(tokenInput);
    try {
      await onConnectRepo(parsed.owner, parsed.repo, branchInput.trim() || undefined, tokenInput.trim() || undefined);
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 border-b border-slate-800 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">
            GitHub Repository Awareness
          </h1>
          <p className="text-sm text-slate-400">
            Read-only Phase 2 connection. Mantis indexes source files into Supabase so Chat can
            reference real project code.
          </p>
        </div>

        {connection && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isSyncingRepo}
              onClick={() => void onResyncRepo(tokenInput.trim() || undefined)}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-100 hover:bg-slate-800 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncingRepo ? 'animate-spin' : ''}`} />
              <span>{isSyncingRepo ? 'Syncing Repo...' : 'Re-sync Files'}</span>
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
                  className="min-h-[42px] rounded-md bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-500"
                >
                  Confirm Disconnect
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDisconnect(false)}
                  className="min-h-[42px] rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDisconnect(true)}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-400 hover:border-red-500/40 hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Disconnect</span>
              </button>
            )}
          </div>
        )}
      </div>

      {phase2SchemaMissing ? (
        <section className="rounded-lg border border-amber-500/40 bg-slate-900 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
                <Database className="h-4 w-4 shrink-0" />
                <span>One-Time Phase 2 SQL Migration Needed</span>
              </div>
              <p className="max-w-2xl text-sm leading-relaxed text-slate-300">
                To store connected GitHub repositories and indexed source files safely in Supabase,
                run the Phase 2 SQL migration once in your Supabase SQL Editor, then tap{' '}
                <strong>Verify Phase 2 Tables</strong>.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCopySql}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700"
              >
                {copiedSql ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                <span>{copiedSql ? 'Phase 2 SQL Copied' : 'Copy Phase 2 SQL'}</span>
              </button>
              <button
                type="button"
                onClick={onVerifyPhase2Tables}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Verify Phase 2 Tables</span>
              </button>
            </div>
          </div>
          <pre className="mt-4 max-h-56 overflow-auto rounded-md border border-slate-800 bg-[#0B1120] p-3 font-mono text-xs leading-relaxed text-slate-300">
            {MANTIS_PHASE2_SCHEMA_SQL}
          </pre>
        </section>
      ) : (
        <>
          {/* Connect / Change Repository Form */}
          <form
            onSubmit={handleConnectSubmit}
            className="space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-5"
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
              <div className="space-y-1">
                <label htmlFor="gh-repo" className="block text-xs font-medium text-slate-300">
                  GitHub Repository (owner/repo or URL)
                </label>
                <input
                  id="gh-repo"
                  type="text"
                  required
                  value={repoInput}
                  onChange={(e) => setRepoInput(e.target.value)}
                  placeholder="studiosmobile092-code/Mantis"
                  className="min-h-[44px] w-full rounded-md border border-slate-700 bg-[#0B1120] px-3.5 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="gh-branch" className="block text-xs font-medium text-slate-300">
                  Branch (optional)
                </label>
                <input
                  id="gh-branch"
                  type="text"
                  value={branchInput}
                  onChange={(e) => setBranchInput(e.target.value)}
                  placeholder="main"
                  className="min-h-[44px] w-full rounded-md border border-slate-700 bg-[#0B1120] px-3.5 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={isSyncingRepo}
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60 sm:w-auto"
                >
                  <GitBranch className="h-4 w-4" />
                  <span>{isSyncingRepo ? 'Indexing...' : connection ? 'Update Repo' : 'Connect Read-Only'}</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              <span>
                Public repositories require no token. Read-only access only — direct commits are
                disabled.
              </span>
              <button
                type="button"
                onClick={() => setShowTokenInput((v) => !v)}
                className="inline-flex items-center gap-1.5 font-medium text-slate-300 hover:text-slate-100"
              >
                <KeyRound className="h-3.5 w-3.5" />
                <span>{showTokenInput ? 'Hide Session Token' : 'Private Repo Token (Session Only)'}</span>
              </button>
            </div>

            {showTokenInput && (
              <div className="space-y-1.5 border-t border-slate-800 pt-3">
                <label htmlFor="gh-pat" className="block text-xs font-medium text-slate-300">
                  Optional Read-Only GitHub Token (stored in browser sessionStorage only, never saved to Supabase)
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
                  className="min-h-[42px] w-full rounded-md border border-slate-700 bg-[#0B1120] px-3.5 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            )}

            {syncProgressText && (
              <div className="rounded-md border border-slate-700 bg-[#0B1120] px-3.5 py-2 font-mono text-xs text-emerald-300">
                {syncProgressText}
              </div>
            )}

            {formError && (
              <div
                role="alert"
                className="rounded-md border border-red-500/40 bg-red-950/30 px-3.5 py-2.5 text-xs text-red-200"
              >
                {formError}
              </div>
            )}
          </form>

          {/* Indexed Repository Explorer */}
          {connection && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/70 px-4 py-3 font-mono text-xs text-slate-300">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-emerald-400">
                    {connection.owner}/{connection.repo}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>branch: {connection.branch}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{repoFiles.length} files indexed</span>
                </div>
                <span className="tabular-nums text-slate-400">
                  Synced {new Date(connection.last_synced_at).toLocaleString()}
                </span>
              </div>

              <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
                {/* File Tree List */}
                <aside className="space-y-2 rounded-lg border border-slate-800 bg-slate-900 p-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                    <input
                      type="search"
                      value={fileSearch}
                      onChange={(e) => setFileSearch(e.target.value)}
                      placeholder="Filter repo files..."
                      className="min-h-[40px] w-full rounded-md border border-slate-700 bg-[#0B1120] py-1.5 pr-3 pl-8 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>

                  <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
                    {filteredFiles.length === 0 ? (
                      <p className="px-2 py-4 text-center text-xs text-slate-400">
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
                                ? 'bg-slate-800 font-medium text-emerald-300'
                                : 'text-slate-300 hover:bg-slate-800/60'
                            }`}
                          >
                            <FileCode2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <span className="truncate">{file.path}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </aside>

                {/* Read-Only Code Viewer */}
                <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                  {activeFile ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                        <div className="space-y-0.5">
                          <div className="font-mono text-sm font-semibold text-slate-100">
                            {activeFile.path}
                          </div>
                          <div className="font-mono text-xs tabular-nums text-slate-400">
                            {activeFile.size_bytes} bytes · Read-only snapshot
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onSaveFileToTeach(activeFile)}
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs font-medium text-emerald-300 hover:border-emerald-500/50 hover:bg-slate-800"
                        >
                          <BookmarkPlus className="h-3.5 w-3.5" />
                          <span>Save File Note to Teach</span>
                        </button>
                      </div>
                      <pre className="max-h-[420px] overflow-auto rounded-md border border-slate-800 bg-[#0B1120] p-3.5 font-mono text-xs leading-relaxed text-slate-200">
                        {activeFile.content}
                      </pre>
                    </div>
                  ) : (
                    <p className="py-12 text-center text-xs text-slate-400">
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
