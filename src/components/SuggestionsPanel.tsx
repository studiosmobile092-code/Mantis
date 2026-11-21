import {
  BookmarkPlus,
  Check,
  CheckCircle2,
  Copy,
  Database,
  Edit3,
  ExternalLink,
  GitPullRequest,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';
import {type FormEvent, useMemo, useState} from 'react';
import {createUnifiedPatch} from '../lib/diff';
import {
  createPullRequestForApprovedSuggestion,
  getSessionGitHubToken,
  setSessionGitHubToken,
} from '../lib/github';
import {sanitizeExternalHttpUrl} from '../lib/knowledgeSync';
import {MANTIS_PHASE3_SCHEMA_SQL} from '../lib/schemaText';
import type {
  CodeSuggestion,
  GitHubConnection,
  RepoFile,
  SuggestionStatus,
} from '../types/mantis';
import {DiffViewer} from './DiffViewer';

interface SuggestionsPanelProps {
  connection: GitHubConnection | null;
  repoFiles: RepoFile[];
  suggestions: CodeSuggestion[];
  phase3SchemaMissing: boolean;
  onVerifyPhase3Tables: () => void;
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
  onSaveLessonToTeach?: (title: string, content: string, tags: string) => void;
}

export function SuggestionsPanel({
  connection,
  repoFiles,
  suggestions,
  phase3SchemaMissing,
  onVerifyPhase3Tables,
  onGenerateFromFile,
  onGenerateNewFile,
  onUpdateProposedContent,
  onReviewSuggestion,
  onDeleteSuggestion,
  onSaveLessonToTeach,
}: SuggestionsPanelProps) {
  const [mode, setMode] = useState<'improve' | 'new'>(repoFiles.length > 0 ? 'improve' : 'new');
  const [selectedFilePath, setSelectedFilePath] = useState<string>(repoFiles[0]?.path || '');
  const [newFilePath, setNewFilePath] = useState('src/lib/newHelper.ts');
  const [goal, setGoal] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const [statusFilter, setStatusFilter] = useState<'all' | SuggestionStatus>('all');
  const [copiedSql, setCopiedSql] = useState(false);
  const [copiedPatchId, setCopiedPatchId] = useState<string | null>(null);
  const [copiedFileId, setCopiedFileId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, string>>({});
  const [prBusyId, setPrBusyId] = useState<string | null>(null);
  const [prToken, setPrToken] = useState(() => getSessionGitHubToken());
  const [actionError, setActionError] = useState<string | null>(null);

  const filteredSuggestions = useMemo(() => {
    if (statusFilter === 'all') return suggestions;
    return suggestions.filter((s) => s.status === statusFilter);
  }, [suggestions, statusFilter]);

  const counts = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    for (const s of suggestions) {
      if (s.status === 'pending') pending += 1;
      else if (s.status === 'approved') approved += 1;
      else rejected += 1;
    }
    return {pending, approved, rejected};
  }, [suggestions]);

  async function handleCopySql() {
    try {
      await navigator.clipboard.writeText(MANTIS_PHASE3_SCHEMA_SQL);
      setCopiedSql(true);
      window.setTimeout(() => setCopiedSql(false), 2500);
    } catch {
      setCopiedSql(false);
    }
  }

  async function handleGenerateSubmit(event: FormEvent) {
    event.preventDefault();
    setActionError(null);
    setIsGenerating(true);
    try {
      if (mode === 'improve') {
        const target = repoFiles.find((f) => f.path === selectedFilePath) || repoFiles[0];
        if (!target) {
          setActionError('Connect and index a GitHub repository first, or switch to New Code Proposal.');
          return;
        }
        await onGenerateFromFile(target, goal);
      } else {
        await onGenerateNewFile(newFilePath, goal);
      }
      setGoal('');
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleOpenPr(suggestion: CodeSuggestion) {
    if (suggestion.status !== 'approved' || !connection) return;
    setActionError(null);
    setPrBusyId(suggestion.id);
    try {
      const prUrl = await createPullRequestForApprovedSuggestion({
        owner: connection.owner,
        repo: connection.repo,
        baseBranch: connection.branch,
        filePath: suggestion.file_path,
        title: suggestion.title,
        rationale: suggestion.rationale,
        proposedContent: suggestion.proposed_content,
        suggestionId: suggestion.id,
        token: prToken,
      });
      await onReviewSuggestion(
        suggestion.id,
        'approved',
        feedbackDrafts[suggestion.id] ?? suggestion.user_feedback,
        prUrl,
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to open Pull Request.');
    } finally {
      setPrBusyId(null);
    }
  }

  if (phase3SchemaMissing) {
    return (
      <section className="rounded-lg border border-amber-500/40 bg-surface p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-400">
              <Database className="h-4 w-4 shrink-0" />
              <span>One-Time Phase 3 SQL Migration Needed</span>
            </div>
            <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">
              To save code suggestions, diffs, and approval status in Supabase, run the Phase 3 SQL
              migration once in your Supabase SQL Editor, then tap{' '}
              <strong>Verify Phase 3 Tables</strong>.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={handleCopySql}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-line-strong bg-inset px-4 py-2 text-xs font-medium text-ink hover:bg-elevated"
            >
              {copiedSql ? <Check className="h-4 w-4 text-accent-text" /> : <Copy className="h-4 w-4" />}
              <span>{copiedSql ? 'Phase 3 SQL Copied' : 'Copy Phase 3 SQL'}</span>
            </button>
            <button
              type="button"
              onClick={onVerifyPhase3Tables}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover"
            >
              <RefreshCw className="h-4 w-4" />
              <span>Verify Phase 3 Tables</span>
            </button>
          </div>
        </div>
        <pre className="mt-4 max-h-56 overflow-auto rounded-md border border-line bg-inset p-3 font-mono text-xs leading-relaxed text-ink">
          {MANTIS_PHASE3_SCHEMA_SQL}
        </pre>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {/* Propose Improvement / New Code Form */}
      <form
        onSubmit={handleGenerateSubmit}
        className="space-y-4 rounded-lg border border-line bg-surface p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-ink">
              Propose Code Improvement or New File
            </h2>
            <p className="text-xs text-ink-muted">
              All proposals require your explicit approval before any export or Pull Request write
              action is unlocked.
            </p>
          </div>

          <div className="flex items-center gap-1 rounded-md border border-line bg-inset p-1">
            <button
              type="button"
              onClick={() => setMode('improve')}
              className={`min-h-[38px] rounded px-3 text-xs font-medium transition-colors ${
                mode === 'improve'
                  ? 'bg-elevated text-ink'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              Improve Repo File
            </button>
            <button
              type="button"
              onClick={() => setMode('new')}
              className={`min-h-[38px] rounded px-3 text-xs font-medium transition-colors ${
                mode === 'new'
                  ? 'bg-elevated text-ink'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              New Code Proposal
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          {mode === 'improve' ? (
            <div className="space-y-1">
              <label htmlFor="suggest-file" className="block text-xs font-medium text-ink-muted">
                Indexed Repository File
              </label>
              <select
                id="suggest-file"
                value={selectedFilePath || repoFiles[0]?.path || ''}
                onChange={(e) => setSelectedFilePath(e.target.value)}
                disabled={repoFiles.length === 0}
                className="min-h-[44px] w-full rounded-md border border-line-strong bg-inset px-3 py-2 font-mono text-xs text-ink focus:border-accent focus:outline-none disabled:opacity-50"
              >
                {repoFiles.length === 0 ? (
                  <option value="">No indexed files — connect a repo first</option>
                ) : (
                  repoFiles.map((f) => (
                    <option key={f.id} value={f.path}>
                      {f.path}
                    </option>
                  ))
                )}
              </select>
            </div>
          ) : (
            <div className="space-y-1">
              <label htmlFor="suggest-new-path" className="block text-xs font-medium text-ink-muted">
                Target New File Path
              </label>
              <input
                id="suggest-new-path"
                type="text"
                required
                value={newFilePath}
                onChange={(e) => setNewFilePath(e.target.value)}
                placeholder="src/lib/newHelper.ts"
                className="min-h-[44px] w-full rounded-md border border-line-strong bg-inset px-3.5 py-2 font-mono text-xs text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
              />
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor="suggest-goal" className="block text-xs font-medium text-ink-muted">
              Goal or Focus (optional)
            </label>
            <input
              id="suggest-goal"
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Check button types, error handling, or security"
              className="min-h-[44px] w-full rounded-md border border-line-strong bg-inset px-3.5 py-2 text-xs text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={isGenerating || (mode === 'improve' && repoFiles.length === 0)}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50 sm:w-auto"
            >
              <Sparkles className="h-4 w-4" />
              <span>{isGenerating ? 'Analyzing…' : 'Analyze & Propose'}</span>
            </button>
          </div>
        </div>
      </form>

      {actionError && (
        <div
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-400"
        >
          {actionError}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 rounded-md border border-line bg-surface p-1">
          {(
            [
              {id: 'all', label: `All (${suggestions.length})`},
              {id: 'pending', label: `Pending (${counts.pending})`},
              {id: 'approved', label: `Approved (${counts.approved})`},
              {id: 'rejected', label: `Rejected (${counts.rejected})`},
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`min-h-[38px] rounded px-3 text-xs font-medium tabular-nums transition-colors ${
                statusFilter === tab.id
                  ? 'bg-elevated text-ink'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <ShieldAlert className="h-4 w-4 text-amber-400" />
          <span>Direct unreviewed commits are blocked; PRs require approval.</span>
        </div>
      </div>

      {/* Suggestion Cards */}
      {filteredSuggestions.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface p-8 text-center">
          <h3 className="text-sm font-semibold text-ink">No code suggestions yet</h3>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-muted">
            Select an indexed repository file above and tap <strong>Analyze &amp; Propose</strong>,
            or run <code className="font-mono text-ink">/suggest &lt;file&gt;</code> in Chat.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {filteredSuggestions.map((s) => {
            const isEditing = editingId === s.id;
            const statusText =
              s.status === 'approved'
                ? 'Approved'
                : s.status === 'rejected'
                  ? 'Rejected'
                  : 'Pending Review';
            const statusColor =
              s.status === 'approved'
                ? 'text-accent-text'
                : s.status === 'rejected'
                  ? 'text-red-400'
                  : 'text-amber-400';

            return (
              <article
                key={s.id}
                className="space-y-4 rounded-lg border border-line bg-surface p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h3 className="text-base font-semibold text-ink">{s.title}</h3>
                    <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-ink-muted">
                      <span className={statusColor}>{statusText}</span>
                      {(s.suggestion_kind === 'self_improvement' ||
                        s.title.startsWith('[Self-Audit]')) && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-accent-text">Self-Improvement</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>{s.file_path}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {new Date(s.updated_at).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (isEditing) {
                          setEditingId(null);
                        } else {
                          setEditingId(s.id);
                          setEditDraft(s.proposed_content);
                        }
                      }}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-line-strong bg-inset px-3 py-1.5 text-xs font-medium text-ink hover:bg-elevated"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      <span>{isEditing ? 'Close Editor' : 'Edit Proposed Code'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void onDeleteSuggestion(s.id)}
                      aria-label={`Delete ${s.title}`}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-line bg-inset px-3 py-1.5 text-xs font-medium text-ink-muted hover:border-red-500/40 hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Remove</span>
                    </button>
                  </div>
                </div>

                {s.rationale && (
                  <p className="text-xs leading-relaxed text-ink-muted">{s.rationale}</p>
                )}

                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      rows={10}
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      className="w-full rounded-md border border-line-strong bg-inset p-3 font-mono text-xs leading-relaxed text-ink focus:border-accent focus:outline-none"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await onUpdateProposedContent(s.id, editDraft);
                          if (ok) setEditingId(null);
                        }}
                        className="min-h-[42px] rounded-md bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover"
                      >
                        Save Edited Proposal
                      </button>
                    </div>
                  </div>
                ) : (
                  <DiffViewer
                    filePath={s.file_path}
                    originalContent={s.original_content}
                    proposedContent={s.proposed_content}
                  />
                )}

                {/* User Approval Gate */}
                <div className="space-y-3 border-t border-line pt-4">
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <input
                      type="text"
                      value={feedbackDrafts[s.id] ?? s.user_feedback}
                      onChange={(e) =>
                        setFeedbackDrafts((prev) => ({...prev, [s.id]: e.target.value}))
                      }
                      placeholder="Optional review feedback (helps track suggestion quality)"
                      className="min-h-[44px] rounded-md border border-line-strong bg-inset px-3.5 py-2 text-xs text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
                    />

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void onReviewSuggestion(
                            s.id,
                            'approved',
                            feedbackDrafts[s.id] ?? s.user_feedback,
                          )
                        }
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent-hover"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        <span>{s.status === 'approved' ? 'Approved' : 'Approve'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void onReviewSuggestion(
                            s.id,
                            'rejected',
                            feedbackDrafts[s.id] ?? s.user_feedback,
                          )
                        }
                        className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-md border px-4 py-2 text-xs font-semibold transition-colors ${
                          s.status === 'rejected'
                            ? 'border-red-500 bg-red-500/15 text-red-400'
                            : 'border-line-strong bg-inset text-ink hover:border-red-500/50 hover:text-red-400'
                        }`}
                      >
                        <XCircle className="h-4 w-4" />
                        <span>{s.status === 'rejected' ? 'Rejected' : 'Reject'}</span>
                      </button>

                      {s.status !== 'pending' && onSaveLessonToTeach && (
                        <button
                          type="button"
                          onClick={() => {
                            const fb = (feedbackDrafts[s.id] ?? s.user_feedback).trim();
                            onSaveLessonToTeach(
                              `Rule from ${s.file_path}`,
                              [
                                `Suggestion (${s.status}): ${s.title}`,
                                `File: ${s.file_path}`,
                                `Rationale: ${s.rationale}`,
                                fb ? `My Review Feedback: ${fb}` : '',
                              ]
                                .filter(Boolean)
                                .join('\n\n'),
                              `review, ${s.status}`,
                            );
                          }}
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-line-strong bg-inset px-3 py-2 text-xs font-medium text-ink-muted hover:bg-elevated hover:text-ink"
                        >
                          <BookmarkPlus className="h-3.5 w-3.5" />
                          <span>Save Lesson</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Write Actions Unlocked ONLY After Explicit Approval */}
                  {s.status === 'approved' && (
                    <div className="space-y-3 rounded-md border border-accent-border bg-inset p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-accent-text">
                          Approved Write Actions Unlocked
                        </span>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(
                                  createUnifiedPatch(
                                    s.file_path,
                                    s.original_content,
                                    s.proposed_content,
                                  ),
                                );
                                setCopiedPatchId(s.id);
                                window.setTimeout(() => setCopiedPatchId(null), 2000);
                              } catch {
                                setActionError(
                                  'Clipboard write blocked by browser; copy code from the editor instead.',
                                );
                              }
                            }}
                            className="inline-flex min-h-[40px] items-center gap-1.5 rounded border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-elevated"
                          >
                            {copiedPatchId === s.id ? (
                              <Check className="h-3.5 w-3.5 text-accent-text" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                            <span>
                              {copiedPatchId === s.id ? 'Patch Copied' : 'Copy Unified Patch'}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(s.proposed_content);
                                setCopiedFileId(s.id);
                                window.setTimeout(() => setCopiedFileId(null), 2000);
                              } catch {
                                setActionError(
                                  'Clipboard write blocked by browser; open Edit Proposed Code to copy.',
                                );
                              }
                            }}
                            className="inline-flex min-h-[40px] items-center gap-1.5 rounded border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-elevated"
                          >
                            {copiedFileId === s.id ? (
                              <Check className="h-3.5 w-3.5 text-accent-text" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                            <span>
                              {copiedFileId === s.id ? 'Code Copied' : 'Copy Patched File'}
                            </span>
                          </button>
                        </div>
                      </div>

                      {connection && (
                        <div className="flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-center">
                          <input
                            type="password"
                            value={prToken}
                            onChange={(e) => {
                              setPrToken(e.target.value);
                              setSessionGitHubToken(e.target.value);
                            }}
                            placeholder="Optional session GitHub PAT (Contents + PR write) to open PR"
                            className="min-h-[44px] flex-1 rounded border border-line-strong bg-surface px-3 py-1.5 font-mono text-xs text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
                          />
                          <button
                            type="button"
                            disabled={prBusyId === s.id || !prToken.trim()}
                            onClick={() => void handleOpenPr(s)}
                            className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                          >
                            <GitPullRequest className="h-3.5 w-3.5" />
                            <span>
                              {prBusyId === s.id ? 'Creating Branch & PR…' : 'Open Pull Request'}
                            </span>
                          </button>
                        </div>
                      )}

                      {(() => {
                        const safePrUrl = sanitizeExternalHttpUrl(s.pr_url);
                        if (!safePrUrl) return null;
                        return (
                          <div className="flex items-center gap-2 font-mono text-xs text-accent-text">
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                            <a
                              href={safePrUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="truncate underline underline-offset-2 hover:opacity-85"
                            >
                              Pull Request Opened: {safePrUrl}
                            </a>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
