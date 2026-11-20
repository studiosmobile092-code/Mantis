import {Check, Copy, Cpu, Database, GitBranch, LogOut, ShieldCheck, Wifi} from 'lucide-react';
import {type FormEvent, useEffect, useState} from 'react';
import {BRAIN_MODEL_OPTIONS, normalizeBrainUrl, testBrainConnection} from '../lib/aiBrain';
import {
  MANTIS_CLOUDFLARE_WORKER_JS,
  MANTIS_PHASE1_SCHEMA_SQL,
  MANTIS_PHASE2_SCHEMA_SQL,
  MANTIS_PHASE3_SCHEMA_SQL,
  MANTIS_PHASE4_SCHEMA_SQL,
  MANTIS_PHASE5_SCHEMA_SQL,
} from '../lib/schemaText';
import {SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase} from '../lib/supabase';
import type {GitHubConnection, MemoryReadinessMetrics} from '../types/mantis';

interface SettingsPanelProps {
  userEmail: string;
  metrics: MemoryReadinessMetrics;
  schemaMissing: boolean;
  phase2SchemaMissing: boolean;
  phase3SchemaMissing: boolean;
  phase4SchemaMissing: boolean;
  phase5SchemaMissing: boolean;
  brainUrl: string;
  brainModel: string;
  autoLearnFromChat: boolean;
  connection: GitHubConnection | null;
  onSaveBrainConfig: (url: string, model: string, autoLearn: boolean) => Promise<void>;
  onSignOut: () => Promise<void>;
}

export function SettingsPanel({
  userEmail,
  metrics,
  schemaMissing,
  phase2SchemaMissing,
  phase3SchemaMissing,
  phase4SchemaMissing,
  phase5SchemaMissing,
  brainUrl,
  brainModel,
  autoLearnFromChat,
  connection,
  onSaveBrainConfig,
  onSignOut,
}: SettingsPanelProps) {
  const [pingStatus, setPingStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [pingMessage, setPingMessage] = useState<string | null>(null);
  const [copiedWhich, setCopiedWhich] = useState<1 | 2 | 3 | 4 | 5 | 'worker' | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const [urlDraft, setUrlDraft] = useState(brainUrl);
  const [modelDraft, setModelDraft] = useState(brainModel);
  const [autoLearnDraft, setAutoLearnDraft] = useState(autoLearnFromChat);
  const [brainStatus, setBrainStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [brainMessage, setBrainMessage] = useState<string | null>(null);
  const [showWorkerCode, setShowWorkerCode] = useState(false);

  useEffect(() => {
    setUrlDraft(brainUrl);
  }, [brainUrl]);

  useEffect(() => {
    setModelDraft(brainModel);
  }, [brainModel]);

  useEffect(() => {
    setAutoLearnDraft(autoLearnFromChat);
  }, [autoLearnFromChat]);

  const maskedKey = `${SUPABASE_PUBLISHABLE_KEY.slice(0, 18)}...${SUPABASE_PUBLISHABLE_KEY.slice(-6)}`;

  async function handleTestConnection() {
    setPingStatus('testing');
    setPingMessage(null);
    const start = performance.now();
    try {
      const {error} = await supabase.from('knowledge_folders').select('id').limit(1);
      const elapsed = Math.round(performance.now() - start);
      if (error) {
        setPingStatus('error');
        setPingMessage(`${error.message} (${elapsed} ms)`);
      } else {
        setPingStatus('ok');
        setPingMessage(`Supabase Postgres & RLS responded in ${elapsed} ms.`);
      }
    } catch (err) {
      setPingStatus('error');
      setPingMessage(err instanceof Error ? err.message : 'Connection failed');
    }
  }

  async function handleCopyText(text: string, which: 1 | 2 | 3 | 4 | 5 | 'worker') {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedWhich(which);
      window.setTimeout(() => setCopiedWhich(null), 2500);
    } catch {
      // ignore clipboard errors
    }
  }

  async function handleSaveAndTestBrain(event: FormEvent) {
    event.preventDefault();
    setBrainStatus('testing');
    setBrainMessage(null);
    const cleanUrl = normalizeBrainUrl(urlDraft);
    setUrlDraft(cleanUrl);
    try {
      await onSaveBrainConfig(cleanUrl, modelDraft, autoLearnDraft);
      if (!cleanUrl) {
        setBrainStatus('ok');
        setBrainMessage('Cleared AI Brain URL. Mantis will run in local Memory Retrieval mode.');
        return;
      }
      const health = await testBrainConnection(cleanUrl);
      if (!health.hasHfToken) {
        setBrainStatus('error');
        setBrainMessage(
          `Worker responded in ${health.latencyMs} ms, but HF_TOKEN secret is not set in Cloudflare yet.`,
        );
      } else {
        setBrainStatus('ok');
        setBrainMessage(
          `Connected to AI Brain in ${health.latencyMs} ms (HF_TOKEN active, default ${health.defaultModel}).`,
        );
      }
    } catch (err) {
      setBrainStatus('error');
      setBrainMessage(err instanceof Error ? err.message : 'Unable to reach Cloudflare Worker.');
    }
  }

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1 border-b border-slate-800 pb-4">
        <h1 className="text-xl font-semibold tracking-tight text-slate-100">Settings &amp; Status</h1>
        <p className="text-sm text-slate-400">
          AI Brain (Cloudflare + Hugging Face), Supabase sync, readiness score, and SQL migrations.
        </p>
      </div>

      {/* Real AI Brain Setup (Cloudflare Worker + Hugging Face) */}
      <form
        onSubmit={handleSaveAndTestBrain}
        className="space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-base font-semibold text-slate-100">
              <Cpu className="h-4 w-4 text-emerald-400" />
              <span>Real AI Brain (Cloudflare Worker + Hugging Face)</span>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Connect your free Cloudflare Worker proxy so Mantis runs real coding LLMs, distills
              screen/article captures automatically, and extracts YouTube captions — while keeping
              your Hugging Face token out of GitHub and the browser.
            </p>
          </div>
          <span className="font-mono text-xs text-slate-400">
            {brainUrl ? 'Configured' : 'Memory Mode'}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="brain-url" className="block text-xs font-medium text-slate-300">
              Cloudflare Worker URL
            </label>
            <input
              id="brain-url"
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              placeholder="mantis.garrettwins3.workers.dev or https://..."
              className="min-h-[44px] w-full rounded-md border border-slate-700 bg-[#0B1120] px-3.5 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="brain-model" className="block text-xs font-medium text-slate-300">
              Hugging Face Model
            </label>
            <select
              id="brain-model"
              value={modelDraft}
              onChange={(e) => setModelDraft(e.target.value)}
              className="min-h-[44px] w-full rounded-md border border-slate-700 bg-[#0B1120] px-3 py-2 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
            >
              {BRAIN_MODEL_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={autoLearnDraft}
              onChange={(e) => setAutoLearnDraft(e.target.checked)}
              className="h-4 w-4 accent-emerald-500"
            />
            <span>Auto-save reusable facts &amp; rules learned during AI chats</span>
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleCopyText(MANTIS_CLOUDFLARE_WORKER_JS, 'worker')}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700"
            >
              {copiedWhich === 'worker' ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>{copiedWhich === 'worker' ? 'Worker Code Copied' : 'Copy Worker Code'}</span>
            </button>

            <button
              type="submit"
              disabled={brainStatus === 'testing'}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              <span>{brainStatus === 'testing' ? 'Testing...' : 'Save & Test AI Brain'}</span>
            </button>
          </div>
        </div>

        {brainMessage && (
          <div
            role="status"
            className={`rounded-md border px-3.5 py-2.5 font-mono text-xs ${
              brainStatus === 'ok'
                ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
                : 'border-red-500/40 bg-red-950/30 text-red-200'
            }`}
          >
            {brainMessage}
          </div>
        )}

        <div className="border-t border-slate-800 pt-3">
          <button
            type="button"
            onClick={() => setShowWorkerCode((v) => !v)}
            className="text-xs font-medium text-slate-300 underline underline-offset-2 hover:text-slate-100"
          >
            {showWorkerCode
              ? 'Hide Cloudflare Worker setup & code'
              : 'Show 3-minute Cloudflare Worker setup & code'}
          </button>

          {showWorkerCode && (
            <div className="mt-3 space-y-2.5 text-xs text-slate-300">
              <ol className="list-inside list-decimal space-y-1 leading-relaxed text-slate-400">
                <li>
                  Open <code className="font-mono text-slate-200">dash.cloudflare.com</code> →
                  Workers &amp; Pages → <strong>Create application</strong> →{' '}
                  <strong>Start with Hello World!</strong> (do <em>not</em> import the GitHub repo)
                  → name it <code className="font-mono text-slate-200">mantis-brain</code> → Deploy.
                </li>
                <li>
                  Tap <strong>Edit code</strong>, replace everything with the copied Worker code
                  below, and tap <strong>Deploy</strong>.
                </li>
                <li>
                  Go to Worker <strong>Settings → Variables and Secrets → Add</strong>: add Secret{' '}
                  <code className="font-mono text-slate-200">HF_TOKEN</code> (your rotated Hugging
                  Face token) and optional Variable{' '}
                  <code className="font-mono text-slate-200">ALLOWED_EMAIL</code> ={' '}
                  <code className="font-mono text-slate-200">{userEmail}</code>.
                </li>
                <li>Paste your Worker URL above and tap Save &amp; Test AI Brain.</li>
              </ol>
              <pre className="max-h-48 overflow-auto rounded-md border border-slate-800 bg-[#0B1120] p-3 font-mono text-[11px] leading-relaxed text-slate-300">
                {MANTIS_CLOUDFLARE_WORKER_JS}
              </pre>
            </div>
          )}
        </div>
      </form>

      {/* Honest Memory, Repo & Suggestion Readiness Breakdown */}
      <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Memory &amp; Code Help Readiness
            </h2>
            <p className="text-xs text-slate-400">
              Measured strictly from saved entries, folders, tags, repo files, chat turns, and
              reviewed suggestions.
            </p>
          </div>
          <div className="font-mono text-2xl font-bold tabular-nums text-emerald-400">
            {metrics.readinessScore} / 100
          </div>
        </div>

        <div className="grid gap-3 border-t border-slate-800 pt-4 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-3.5">
            <div className="text-xs text-slate-400">Knowledge</div>
            <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-100">
              {metrics.entryCount}
            </div>
            <div className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500">
              {metrics.substantiveCount} substantive
            </div>
          </div>

          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-3.5">
            <div className="text-xs text-slate-400">Folders</div>
            <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-100">
              {metrics.folderCount}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-slate-500">Categories</div>
          </div>

          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-3.5">
            <div className="text-xs text-slate-400">Tagged</div>
            <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-100">
              {metrics.taggedCount}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-slate-500">Indexed notes</div>
          </div>

          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-3.5">
            <div className="text-xs text-slate-400">Repo Files</div>
            <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-100">
              {metrics.repoFileCount}
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
              {connection ? `${connection.owner}/${connection.repo}` : 'Not connected'}
            </div>
          </div>

          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-3.5">
            <div className="text-xs text-slate-400">Suggestions</div>
            <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-100">
              {metrics.approvedSuggestions}
            </div>
            <div className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500">
              {metrics.reviewedSuggestions} reviewed
            </div>
          </div>

          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-3.5">
            <div className="text-xs text-slate-400">Self-Audits</div>
            <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-100">
              {metrics.selfAuditCount}
            </div>
            <div className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500">
              {metrics.conversationTurns} chat turns
            </div>
          </div>
        </div>
      </section>

      {/* GitHub Pages Deployment Checklist */}
      <section className="space-y-2.5 rounded-lg border border-slate-800 bg-slate-900 p-5 sm:p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <GitBranch className="h-4 w-4 text-emerald-400" />
          <span>GitHub Pages Static Deployment Note</span>
        </div>
        <p className="text-xs leading-relaxed text-slate-300">
          Set your GitHub repository&apos;s <strong>Settings → Pages → Source</strong> to{' '}
          <strong>GitHub Actions</strong> (never <em>Deploy from a branch</em> on{' '}
          <code className="font-mono text-slate-100">main</code>, which serves raw unbuilt{' '}
          <code className="font-mono text-slate-100">.tsx</code> files and renders a white screen).
          The workflow uses Node 22 and{' '}
          <code className="font-mono text-slate-100">npm install --legacy-peer-deps</code> with
          relative <code className="font-mono text-slate-100">./</code> asset paths so{' '}
          <code className="font-mono text-slate-100">/Mantis/</code> builds cleanly.
        </p>
      </section>

      {/* Supabase Connection & Security */}
      <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Supabase Connection</h2>
            <p className="text-xs text-slate-400">
              Frontend uses the Publishable key only with authenticated RLS sessions.
            </p>
          </div>
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={pingStatus === 'testing'}
            className="inline-flex min-h-[42px] items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700 disabled:opacity-60"
          >
            <Wifi className="h-4 w-4" />
            <span>{pingStatus === 'testing' ? 'Testing...' : 'Test Connection'}</span>
          </button>
        </div>

        <div className="grid gap-3 border-t border-slate-800 pt-4 text-xs sm:grid-cols-2">
          <div className="space-y-1 rounded-md border border-slate-800 bg-[#0B1120] p-3.5">
            <div className="text-slate-400">Project URL</div>
            <div className="truncate font-mono text-slate-200">{SUPABASE_URL}</div>
          </div>
          <div className="space-y-1 rounded-md border border-slate-800 bg-[#0B1120] p-3.5">
            <div className="text-slate-400">Publishable Key (Safe for GitHub Pages)</div>
            <div className="truncate font-mono text-slate-200">{maskedKey}</div>
          </div>
        </div>

        {pingMessage && (
          <div
            role="status"
            className={`rounded-md border px-3.5 py-2.5 font-mono text-xs ${
              pingStatus === 'ok'
                ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
                : 'border-red-500/40 bg-red-950/30 text-red-200'
            }`}
          >
            {pingMessage}
          </div>
        )}

        <div className="flex items-start gap-2.5 rounded-md border border-slate-800 bg-[#0B1120] p-3.5 text-xs text-slate-300">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <span>
            Security verified: Neither your Supabase Secret key nor your Hugging Face token is
            included in this website or repository.
          </span>
        </div>
      </section>

      {/* Phase 1–5 SQL References */}
      <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              Phase 5 SQL Migration ({phase5SchemaMissing ? 'Setup Required' : 'Active'})
            </h2>
          </div>
          <button
            type="button"
            onClick={() => void handleCopyText(MANTIS_PHASE5_SCHEMA_SQL, 5)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700"
          >
            {copiedWhich === 5 ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            <span>{copiedWhich === 5 ? 'Phase 5 SQL Copied' : 'Copy Phase 5 SQL'}</span>
          </button>
        </div>
        <pre className="max-h-40 overflow-auto rounded-md border border-slate-800 bg-[#0B1120] p-3 font-mono text-[11px] leading-relaxed text-slate-300">
          {MANTIS_PHASE5_SCHEMA_SQL}
        </pre>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-4">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              Phase 4 SQL Migration ({phase4SchemaMissing ? 'Setup Required' : 'Active'})
            </h2>
          </div>
          <button
            type="button"
            onClick={() => void handleCopyText(MANTIS_PHASE4_SCHEMA_SQL, 4)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700"
          >
            {copiedWhich === 4 ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            <span>{copiedWhich === 4 ? 'Phase 4 SQL Copied' : 'Copy Phase 4 SQL'}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-4">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              Phase 3 SQL Migration ({phase3SchemaMissing ? 'Setup Required' : 'Active'})
            </h2>
          </div>
          <button
            type="button"
            onClick={() => void handleCopyText(MANTIS_PHASE3_SCHEMA_SQL, 3)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700"
          >
            {copiedWhich === 3 ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            <span>{copiedWhich === 3 ? 'Phase 3 SQL Copied' : 'Copy Phase 3 SQL'}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-4">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              Phase 2 SQL Migration ({phase2SchemaMissing ? 'Setup Required' : 'Active'})
            </h2>
          </div>
          <button
            type="button"
            onClick={() => void handleCopyText(MANTIS_PHASE2_SCHEMA_SQL, 2)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700"
          >
            {copiedWhich === 2 ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            <span>{copiedWhich === 2 ? 'Phase 2 SQL Copied' : 'Copy Phase 2 SQL'}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-4">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              Phase 1 Base Schema ({schemaMissing ? 'Setup Required' : 'Active'})
            </h2>
          </div>
          <button
            type="button"
            onClick={() => void handleCopyText(MANTIS_PHASE1_SCHEMA_SQL, 1)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700"
          >
            {copiedWhich === 1 ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            <span>{copiedWhich === 1 ? 'Phase 1 SQL Copied' : 'Copy Phase 1 SQL'}</span>
          </button>
        </div>
      </section>

      {/* Account Session */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-5">
        <div className="space-y-0.5">
          <div className="text-xs text-slate-400">Signed-in Single-User Session</div>
          <div className="font-mono text-sm text-slate-100">{userEmail}</div>
        </div>
        <button
          type="button"
          disabled={isSigningOut}
          onClick={handleSignOut}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-60"
        >
          <LogOut className="h-4 w-4" />
          <span>{isSigningOut ? 'Signing out...' : 'Sign Out'}</span>
        </button>
      </section>
    </div>
  );
}
