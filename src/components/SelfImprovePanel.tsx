import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Database,
  FileWarning,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {type FormEvent, useEffect, useState} from 'react';
import {MANTIS_PHASE4_SCHEMA_SQL} from '../lib/schemaText';
import {DEFAULT_MANTIS_REPO} from '../lib/selfImprove';
import type {
  CodeSuggestion,
  GitHubConnection,
  SelfAuditFinding,
  SelfAuditReport,
  SelfAuditRun,
} from '../types/mantis';

interface SelfImprovePanelProps {
  connection: GitHubConnection | null;
  suggestions: CodeSuggestion[];
  auditRuns: SelfAuditRun[];
  latestReport: SelfAuditReport | null;
  phase4SchemaMissing: boolean;
  isAuditing: boolean;
  auditProgressText: string | null;
  onVerifyPhase4Tables: () => void;
  onRunSelfAudit: (repoInput: string) => Promise<void>;
  onStageFinding: (finding: SelfAuditFinding) => Promise<void>;
  onOpenSuggestionsQueue: () => void;
}

export function SelfImprovePanel({
  connection,
  suggestions,
  auditRuns,
  latestReport,
  phase4SchemaMissing,
  isAuditing,
  auditProgressText,
  onVerifyPhase4Tables,
  onRunSelfAudit,
  onStageFinding,
  onOpenSuggestionsQueue,
}: SelfImprovePanelProps) {
  const [repoTarget, setRepoTarget] = useState(
    connection ? `${connection.owner}/${connection.repo}` : DEFAULT_MANTIS_REPO,
  );
  const [copiedSql, setCopiedSql] = useState(false);
  const [stagingId, setStagingId] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);

  useEffect(() => {
    if (connection) {
      setRepoTarget(`${connection.owner}/${connection.repo}`);
    }
  }, [connection]);

  async function handleCopySql() {
    try {
      await navigator.clipboard.writeText(MANTIS_PHASE4_SCHEMA_SQL);
      setCopiedSql(true);
      window.setTimeout(() => setCopiedSql(false), 2500);
    } catch {
      setCopiedSql(false);
    }
  }

  async function handleSubmitAudit(event: FormEvent) {
    event.preventDefault();
    setAuditError(null);
    try {
      await onRunSelfAudit(repoTarget.trim() || DEFAULT_MANTIS_REPO);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Unable to run self-audit.');
    }
  }

  async function handleStage(finding: SelfAuditFinding) {
    setAuditError(null);
    setStagingId(finding.id);
    try {
      await onStageFinding(finding);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Could not stage diff proposal.');
    } finally {
      setStagingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {phase4SchemaMissing && (
        <section className="rounded-lg border border-warn-border bg-surface p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-warn">
                <Database className="h-4 w-4 shrink-0" />
                <span>Optional Phase 4 SQL Migration (Audit History)</span>
              </div>
              <p className="max-w-2xl text-xs leading-relaxed text-ink-muted">
                You can run a live Self-Audit and stage diffs right now. To also persist
                Self-Audit run history in Supabase (<code className="font-mono text-ink">self_audit_runs</code>
                ), run Phase 4 SQL once in your Supabase SQL Editor and tap{' '}
                <strong>Verify Phase 4 Tables</strong>.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCopySql}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-md border border-line-strong bg-inset px-3.5 py-2 text-xs font-medium text-ink hover:bg-elevated"
              >
                {copiedSql ? (
                  <Check className="h-4 w-4 text-accent-text" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                <span>{copiedSql ? 'Phase 4 SQL Copied' : 'Copy Phase 4 SQL'}</span>
              </button>
              <button
                type="button"
                onClick={onVerifyPhase4Tables}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-xs font-semibold text-white hover:bg-accent-hover"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Verify Phase 4 Tables</span>
              </button>
            </div>
          </div>
          <pre className="mt-4 max-h-48 overflow-auto rounded-md border border-line bg-inset p-3 font-mono text-[11px] leading-relaxed text-ink">
            {MANTIS_PHASE4_SCHEMA_SQL}
          </pre>
        </section>
      )}

      {/* Hard Guardrails Policy */}
      <section className="rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-accent-text">
              <Lock className="h-4 w-4 shrink-0" />
              <span>Guarded Self-Improvement Policy (Propose-Only)</span>
            </div>
            <p className="text-xs leading-relaxed text-ink-muted">
              Mantis can inspect its own codebase and propose fixes, with unrestricted
              self-modification permanently disabled.
            </p>
          </div>
          <span className="font-mono text-xs text-ink-muted">Approval + PR Required</span>
        </div>

        <div className="mt-4 grid gap-3 border-t border-line pt-4 text-xs text-ink-muted sm:grid-cols-3">
          <div className="rounded-md border border-line bg-inset p-3">
            <div className="font-semibold text-ink">1. Read-Only Self-Scan</div>
            <p className="mt-1 leading-relaxed">
              Inspects Mantis source, workflows, and SQL files for security, tablet UX, and build
              reliability without writing any code automatically.
            </p>
          </div>
          <div className="rounded-md border border-line bg-inset p-3">
            <div className="font-semibold text-ink">2. Staged Diff &amp; Review</div>
            <p className="mt-1 leading-relaxed">
              Every finding enters the Suggestions Queue as a line-by-line diff marked{' '}
              <code className="font-mono text-ink">Pending Review</code>.
            </p>
          </div>
          <div className="rounded-md border border-line bg-inset p-3">
            <div className="font-semibold text-ink">3. PR-Only Branching</div>
            <p className="mt-1 leading-relaxed">
              Direct commits to <code className="font-mono text-ink">main</code> are blocked.
              Approved changes export as patches or open a Pull Request on a{' '}
              <code className="font-mono text-ink">mantis/*</code> branch.
            </p>
          </div>
        </div>
      </section>

      {/* Run Self-Audit Form */}
      <form
        onSubmit={handleSubmitAudit}
        className="space-y-4 rounded-lg border border-line bg-surface p-5"
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1">
            <label htmlFor="self-audit-repo" className="block text-xs font-medium text-ink-muted">
              Mantis Project Repository to Inspect (Read-Only)
            </label>
            <input
              id="self-audit-repo"
              type="text"
              value={repoTarget}
              onChange={(e) => setRepoTarget(e.target.value)}
              placeholder={DEFAULT_MANTIS_REPO}
              className="min-h-[44px] w-full rounded-md border border-line-strong bg-inset px-3.5 py-2 font-mono text-xs text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={isAuditing}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-accent px-5 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-60 sm:w-auto"
            >
              <Sparkles className="h-4 w-4" />
              <span>{isAuditing ? 'Auditing Mantis Code…' : 'Run Mantis Self-Audit'}</span>
            </button>
          </div>
        </div>

        {auditProgressText && (
          <div className="rounded-md border border-line bg-inset px-3.5 py-2 font-mono text-xs text-accent-text">
            {auditProgressText}
          </div>
        )}

        {auditError && (
          <div
            role="alert"
            className="rounded-md border border-danger-border bg-danger-soft px-3.5 py-2.5 text-xs text-danger"
          >
            {auditError}
          </div>
        )}
      </form>

      {/* Latest Scan Report */}
      {latestReport && (
        <section className="space-y-4 rounded-lg border border-line bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-ink-muted">
                <span className="font-semibold text-ink">{latestReport.repoLabel}</span>
                <span aria-hidden="true">·</span>
                <span>branch: {latestReport.branch}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{latestReport.filesScanned} files scanned</span>
              </div>
              {latestReport.matchedKnowledgeTitles.length > 0 && (
                <p className="text-xs text-ink-muted">
                  Cross-checked with Knowledge:{' '}
                  <span className="text-ink">
                    {latestReport.matchedKnowledgeTitles.join(', ')}
                  </span>
                </p>
              )}
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-[11px] text-ink-muted">Code Health</div>
                <div
                  className={`font-mono text-xl font-bold tabular-nums ${
                    latestReport.healthScore >= 85
                      ? 'text-accent-text'
                      : latestReport.healthScore >= 60
                        ? 'text-warn'
                        : 'text-danger'
                  }`}
                >
                  {latestReport.healthScore} / 100
                </div>
              </div>
            </div>
          </div>

          {latestReport.findings.length === 0 ? (
            <div className="flex items-center gap-3 rounded-md border border-accent-border bg-accent-soft p-4 text-xs text-ink">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-accent-text" />
              <span>
                No security, tablet accessibility, workflow, or SQL grant issues found across{' '}
                {latestReport.filesScanned} scanned files.
              </span>
            </div>
          ) : (
            <div className="space-y-3">
              {latestReport.findings.map((finding) => {
                const expectedTitle = `[Self-Audit] ${finding.title}`;
                const alreadyStaged = suggestions.some(
                  (s) => s.title === expectedTitle && s.file_path === finding.filePath,
                );
                const severityClass =
                  finding.severity === 'high'
                    ? 'text-danger'
                    : finding.severity === 'medium'
                      ? 'text-warn'
                      : 'text-accent-text';

                return (
                  <article
                    key={finding.id}
                    className="space-y-2.5 rounded-md border border-line bg-inset p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                          <span className={`font-semibold uppercase ${severityClass}`}>
                            {finding.severity}
                          </span>
                          <span aria-hidden="true" className="text-ink-subtle">
                            ·
                          </span>
                          <span className="text-ink-muted">{finding.category}</span>
                          <span aria-hidden="true" className="text-ink-subtle">
                            ·
                          </span>
                          <span className="text-ink">{finding.filePath}</span>
                          {finding.highGuard && (
                            <>
                              <span aria-hidden="true" className="text-ink-subtle">
                                ·
                              </span>
                              <span className="inline-flex items-center gap-1 text-warn">
                                <AlertTriangle className="h-3 w-3" />
                                <span>HIGH-GUARD</span>
                              </span>
                            </>
                          )}
                        </div>
                        <h3 className="text-sm font-semibold text-ink">{finding.title}</h3>
                        <p className="text-xs leading-relaxed text-ink-muted">
                          {finding.description}
                        </p>
                      </div>

                      <div className="shrink-0">
                        {alreadyStaged ? (
                          <button
                            type="button"
                            onClick={onOpenSuggestionsQueue}
                            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-3.5 py-2 text-xs font-semibold text-accent-text hover:opacity-90"
                          >
                            <span>Open in Suggestions</span>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={stagingId === finding.id}
                            onClick={() => void handleStage(finding)}
                            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
                          >
                            <FileWarning className="h-3.5 w-3.5" />
                            <span>
                              {stagingId === finding.id
                                ? 'Staging…'
                                : 'Stage Diff for Review'}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Persistent Self-Audit History */}
      {!phase4SchemaMissing && (
        <section className="space-y-3 rounded-lg border border-line bg-surface p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <ShieldCheck className="h-4 w-4 text-accent-text" />
              <span>Self-Audit Run History</span>
            </div>
            <span className="font-mono text-xs tabular-nums text-ink-muted">
              {auditRuns.length} saved runs
            </span>
          </div>

          {auditRuns.length === 0 ? (
            <p className="text-xs text-ink-muted">
              No saved self-audits yet. Tap <strong>Run Mantis Self-Audit</strong> above to record
              your first guarded inspection.
            </p>
          ) : (
            <div className="divide-y divide-line rounded-md border border-line bg-inset">
              {auditRuns.slice(0, 6).map((run) => (
                <div
                  key={run.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="font-mono font-medium text-ink">
                      {run.repo_label} ({run.branch})
                    </div>
                    <div className="text-ink-muted">{run.summary}</div>
                  </div>
                  <div className="flex items-center gap-3 font-mono tabular-nums">
                    <span className="text-ink-muted">{run.files_scanned} files</span>
                    <span className="text-warn">{run.findings_count} findings</span>
                    <span className="font-semibold text-accent-text">{run.health_score}/100</span>
                    <span className="text-ink-subtle">
                      {new Date(run.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
