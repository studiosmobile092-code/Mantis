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
import {type FormEvent, useState} from 'react';
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
        <section className="rounded-lg border border-amber-500/40 bg-slate-900 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
                <Database className="h-4 w-4 shrink-0" />
                <span>Optional Phase 4 SQL Migration (Audit History)</span>
              </div>
              <p className="max-w-2xl text-xs leading-relaxed text-slate-300">
                You can run a live Self-Audit and stage diffs right now. To also persist
                Self-Audit run history in Supabase (<code className="font-mono">self_audit_runs</code>
                ), run Phase 4 SQL once in your Supabase SQL Editor and tap{' '}
                <strong>Verify Phase 4 Tables</strong>.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCopySql}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700"
              >
                {copiedSql ? (
                  <Check className="h-4 w-4 text-emerald-400" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                <span>{copiedSql ? 'Phase 4 SQL Copied' : 'Copy Phase 4 SQL'}</span>
              </button>
              <button
                type="button"
                onClick={onVerifyPhase4Tables}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-md bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Verify Phase 4 Tables</span>
              </button>
            </div>
          </div>
          <pre className="mt-4 max-h-48 overflow-auto rounded-md border border-slate-800 bg-[#0B1120] p-3 font-mono text-[11px] leading-relaxed text-slate-300">
            {MANTIS_PHASE4_SCHEMA_SQL}
          </pre>
        </section>
      )}

      {/* Hard Guardrails Policy */}
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
              <Lock className="h-4 w-4 shrink-0" />
              <span>Phase 4 Guarded Self-Improvement Policy</span>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Mantis can inspect its own codebase and propose fixes, with unrestricted
              self-modification permanently disabled.
            </p>
          </div>
          <span className="font-mono text-xs text-slate-400">Approval + PR Required</span>
        </div>

        <div className="mt-4 grid gap-3 border-t border-slate-800 pt-4 text-xs text-slate-300 sm:grid-cols-3">
          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-3">
            <div className="font-semibold text-slate-100">1. Read-Only Self-Scan</div>
            <p className="mt-1 leading-relaxed text-slate-400">
              Inspects Mantis source, workflows, and SQL files for security, tablet UX, and build
              reliability without writing any code automatically.
            </p>
          </div>
          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-3">
            <div className="font-semibold text-slate-100">2. Staged Diff &amp; Review</div>
            <p className="mt-1 leading-relaxed text-slate-400">
              Every finding enters the Suggestions Queue as a line-by-line diff marked{' '}
              <code className="font-mono text-slate-200">Pending Review</code>.
            </p>
          </div>
          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-3">
            <div className="font-semibold text-slate-100">3. PR-Only Branching</div>
            <p className="mt-1 leading-relaxed text-slate-400">
              Direct commits to <code className="font-mono text-slate-200">main</code> are blocked.
              Approved changes export as patches or open a Pull Request on a{' '}
              <code className="font-mono text-slate-200">mantis/*</code> branch.
            </p>
          </div>
        </div>
      </section>

      {/* Run Self-Audit Form */}
      <form
        onSubmit={handleSubmitAudit}
        className="space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-5"
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1">
            <label htmlFor="self-audit-repo" className="block text-xs font-medium text-slate-300">
              Mantis Project Repository to Inspect (Read-Only)
            </label>
            <input
              id="self-audit-repo"
              type="text"
              value={repoTarget}
              onChange={(e) => setRepoTarget(e.target.value)}
              placeholder={DEFAULT_MANTIS_REPO}
              className="min-h-[44px] w-full rounded-md border border-slate-700 bg-[#0B1120] px-3.5 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={isAuditing}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60 sm:w-auto"
            >
              <Sparkles className="h-4 w-4" />
              <span>{isAuditing ? 'Auditing Mantis Code...' : 'Run Mantis Self-Audit'}</span>
            </button>
          </div>
        </div>

        {auditProgressText && (
          <div className="rounded-md border border-slate-700 bg-[#0B1120] px-3.5 py-2 font-mono text-xs text-emerald-300">
            {auditProgressText}
          </div>
        )}

        {auditError && (
          <div
            role="alert"
            className="rounded-md border border-red-500/40 bg-red-950/30 px-3.5 py-2.5 text-xs text-red-200"
          >
            {auditError}
          </div>
        )}
      </form>

      {/* Latest Scan Report */}
      {latestReport && (
        <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-slate-400">
                <span className="font-semibold text-slate-100">{latestReport.repoLabel}</span>
                <span aria-hidden="true">·</span>
                <span>branch: {latestReport.branch}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{latestReport.filesScanned} files scanned</span>
              </div>
              {latestReport.matchedKnowledgeTitles.length > 0 && (
                <p className="text-xs text-slate-400">
                  Cross-checked with Knowledge:{' '}
                  <span className="text-slate-200">
                    {latestReport.matchedKnowledgeTitles.join(', ')}
                  </span>
                </p>
              )}
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-[11px] text-slate-400">Code Health</div>
                <div
                  className={`font-mono text-xl font-bold tabular-nums ${
                    latestReport.healthScore >= 85
                      ? 'text-emerald-400'
                      : latestReport.healthScore >= 60
                        ? 'text-amber-300'
                        : 'text-red-400'
                  }`}
                >
                  {latestReport.healthScore} / 100
                </div>
              </div>
            </div>
          </div>

          {latestReport.findings.length === 0 ? (
            <div className="flex items-center gap-3 rounded-md border border-emerald-500/30 bg-[#0B1120] p-4 text-xs text-emerald-200">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
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
                    ? 'text-red-400'
                    : finding.severity === 'medium'
                      ? 'text-amber-300'
                      : 'text-sky-300';

                return (
                  <article
                    key={finding.id}
                    className="space-y-2.5 rounded-md border border-slate-800 bg-[#0B1120] p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                          <span className={`font-semibold uppercase ${severityClass}`}>
                            {finding.severity}
                          </span>
                          <span aria-hidden="true" className="text-slate-600">
                            ·
                          </span>
                          <span className="text-slate-400">{finding.category}</span>
                          <span aria-hidden="true" className="text-slate-600">
                            ·
                          </span>
                          <span className="text-slate-200">{finding.filePath}</span>
                          {finding.highGuard && (
                            <>
                              <span aria-hidden="true" className="text-slate-600">
                                ·
                              </span>
                              <span className="inline-flex items-center gap-1 text-amber-300">
                                <AlertTriangle className="h-3 w-3" />
                                <span>HIGH-GUARD</span>
                              </span>
                            </>
                          )}
                        </div>
                        <h3 className="text-sm font-semibold text-slate-100">{finding.title}</h3>
                        <p className="text-xs leading-relaxed text-slate-400">
                          {finding.description}
                        </p>
                      </div>

                      <div className="shrink-0">
                        {alreadyStaged ? (
                          <button
                            type="button"
                            onClick={onOpenSuggestionsQueue}
                            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-950/30 px-3.5 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-900/40"
                          >
                            <span>Open in Suggestions</span>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={stagingId === finding.id}
                            onClick={() => void handleStage(finding)}
                            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                          >
                            <FileWarning className="h-3.5 w-3.5" />
                            <span>
                              {stagingId === finding.id
                                ? 'Staging...'
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
        <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <span>Self-Audit Run History</span>
            </div>
            <span className="font-mono text-xs tabular-nums text-slate-400">
              {auditRuns.length} saved runs
            </span>
          </div>

          {auditRuns.length === 0 ? (
            <p className="text-xs text-slate-400">
              No saved self-audits yet. Tap <strong>Run Mantis Self-Audit</strong> above to record
              your first guarded inspection.
            </p>
          ) : (
            <div className="divide-y divide-slate-800 rounded-md border border-slate-800 bg-[#0B1120]">
              {auditRuns.slice(0, 6).map((run) => (
                <div
                  key={run.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="font-mono font-medium text-slate-200">
                      {run.repo_label} ({run.branch})
                    </div>
                    <div className="text-slate-400">{run.summary}</div>
                  </div>
                  <div className="flex items-center gap-3 font-mono tabular-nums">
                    <span className="text-slate-400">{run.files_scanned} files</span>
                    <span className="text-amber-300">{run.findings_count} findings</span>
                    <span className="font-semibold text-emerald-400">{run.health_score}/100</span>
                    <span className="text-slate-500">
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
