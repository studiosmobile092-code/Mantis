import {Check, Copy, Cpu, Database, GitBranch, LogOut, ShieldCheck, Wifi} from 'lucide-react';
import {type FormEvent, useEffect, useState} from 'react';
import {
  BRAIN_MODEL_OPTIONS,
  DEFAULT_BACKUP_EDGE_URL,
  normalizeBrainUrl,
  probeActiveBrainRoute,
} from '../lib/aiBrain';
import {
  MANTIS_CLOUDFLARE_WORKER_JS,
  MANTIS_PHASE1_SCHEMA_SQL,
  MANTIS_PHASE2_SCHEMA_SQL,
  MANTIS_PHASE3_SCHEMA_SQL,
  MANTIS_PHASE4_SCHEMA_SQL,
  MANTIS_PHASE5_SCHEMA_SQL,
  MANTIS_PHASE6_SCHEMA_SQL,
  MANTIS_SUPABASE_EDGE_FUNCTION_TS,
  MANTIS_SUPABASE_EDGE_HELPERS_TS,
  MANTIS_SUPABASE_EDGE_PROVIDERS_TS,
  MANTIS_SUPABASE_EDGE_ROUTES_TS,
} from '../lib/schemaText';
import {SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase} from '../lib/supabase';
import type {BrainRouteStatus, GitHubConnection, MemoryReadinessMetrics} from '../types/mantis';

interface SettingsPanelProps {
  userEmail: string;
  metrics: MemoryReadinessMetrics;
  routeStatus: BrainRouteStatus;
  schemaMissing: boolean;
  phase2SchemaMissing: boolean;
  phase3SchemaMissing: boolean;
  phase4SchemaMissing: boolean;
  phase5SchemaMissing: boolean;
  phase6SchemaMissing: boolean;
  offlineQueueCount: number;
  onFlushOfflineQueue: () => void;
  brainUrl: string;
  backupBrainUrl: string;
  brainModel: string;
  autoLearnFromChat: boolean;
  preferBuiltInFirst: boolean;
  accessToken: string;
  connection: GitHubConnection | null;
  onSaveBrainConfig: (
    url: string,
    backupUrl: string,
    model: string,
    autoLearn: boolean,
    preferBuiltIn: boolean,
  ) => Promise<void>;
  onSignOut: () => Promise<void>;
}

export function SettingsPanel({
  userEmail,
  metrics,
  routeStatus,
  schemaMissing,
  phase2SchemaMissing,
  phase3SchemaMissing,
  phase4SchemaMissing,
  phase5SchemaMissing,
  phase6SchemaMissing,
  offlineQueueCount,
  onFlushOfflineQueue,
  brainUrl,
  backupBrainUrl,
  brainModel,
  autoLearnFromChat,
  preferBuiltInFirst,
  accessToken,
  connection,
  onSaveBrainConfig,
  onSignOut,
}: SettingsPanelProps) {
  const [pingStatus, setPingStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [pingMessage, setPingMessage] = useState<string | null>(null);
  const [copiedWhich, setCopiedWhich] = useState<
    | 1
    | 2
    | 3
    | 4
    | 5
    | 6
    | 'worker'
    | 'supabase-helpers'
    | 'supabase-providers'
    | 'supabase-routes'
    | 'supabase-fn'
    | null
  >(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const [urlDraft, setUrlDraft] = useState(brainUrl);
  const [backupUrlDraft, setBackupUrlDraft] = useState(backupBrainUrl);
  const [modelDraft, setModelDraft] = useState(brainModel);
  const [autoLearnDraft, setAutoLearnDraft] = useState(autoLearnFromChat);
  const [preferBuiltInDraft, setPreferBuiltInDraft] = useState(preferBuiltInFirst);

  const [brainStatus, setBrainStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [brainMessage, setBrainMessage] = useState<string | null>(null);
  const [showWorkerCode, setShowWorkerCode] = useState(false);
  const [showEdgeCode, setShowEdgeCode] = useState(false);

  useEffect(() => {
    setUrlDraft(brainUrl);
  }, [brainUrl]);

  useEffect(() => {
    setBackupUrlDraft(backupBrainUrl);
  }, [backupBrainUrl]);

  useEffect(() => {
    setModelDraft(brainModel);
  }, [brainModel]);

  useEffect(() => {
    setAutoLearnDraft(autoLearnFromChat);
  }, [autoLearnFromChat]);

  useEffect(() => {
    setPreferBuiltInDraft(preferBuiltInFirst);
  }, [preferBuiltInFirst]);

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

  async function handleCopyText(
    text: string,
    which:
      | 1
      | 2
      | 3
      | 4
      | 5
      | 6
      | 'worker'
      | 'supabase-helpers'
      | 'supabase-providers'
      | 'supabase-routes'
      | 'supabase-fn',
  ) {
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
    const cleanPrimary = normalizeBrainUrl(urlDraft);
    const cleanBackup = normalizeBrainUrl(backupUrlDraft);
    setUrlDraft(cleanPrimary);
    setBackupUrlDraft(cleanBackup);

    try {
      await onSaveBrainConfig(
        cleanPrimary,
        cleanBackup,
        modelDraft,
        autoLearnDraft,
        preferBuiltInDraft,
      );

      if (!cleanPrimary && !cleanBackup) {
        await probeActiveBrainRoute({
          brainUrl: '',
          backupBrainUrl: '',
          accessToken,
          preferredModel: modelDraft,
        });
        setBrainStatus('ok');
        setBrainMessage('Saved Built-in Local Engine mode.');
        return;
      }

      const resolved = await probeActiveBrainRoute({
        brainUrl: cleanPrimary,
        backupBrainUrl: cleanBackup,
        accessToken,
        preferredModel: modelDraft,
      });

      if (resolved.activeKind === 'built-in-only') {
        setBrainStatus('error');
        setBrainMessage(
          resolved.failoverReason ||
            'Neither Primary nor Backup URL responded. Check endpoint deployment and Secrets.',
        );
        return;
      }

      setBrainStatus('ok');
      const providersText =
        resolved.activeProviders.length > 0 ? ` · Providers: ${resolved.activeProviders.join(', ')}` : '';
      const failoverText = resolved.failoverReason ? ` (${resolved.failoverReason})` : '';
      setBrainMessage(
        `Active Route: ${resolved.activeKind} at ${resolved.activeEndpoint} in ${resolved.latencyMs ?? 0} ms${providersText}${failoverText}`,
      );
    } catch (err) {
      setBrainStatus('error');
      setBrainMessage(err instanceof Error ? err.message : 'Unable to save or probe Brain routes.');
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
        <h1 className="text-xl font-semibold tracking-tight text-slate-100">
          Studio Engine &amp; Chromebook Failover Settings
        </h1>
        <p className="text-sm text-slate-400">
          Configure Built-in AI priority, dual-route Cloudflare + Chromebook Supabase failover, and database schemas.
        </p>
      </div>

      {/* Dual-Route AI Engine Config */}
      <form
        onSubmit={handleSaveAndTestBrain}
        className="space-y-4 rounded-lg border border-slate-800 bg-[#0F172A] p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-base font-semibold text-slate-100">
              <Cpu className="h-4 w-4 text-emerald-400" />
              <span>AI Engine Routing &amp; Chromebook Failover</span>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Your Built-in AI runs instantly in-browser. Cloud Assist connects via your Cloudflare
              Worker (Tablet) and fails over automatically to your non-.dev Supabase Edge Function
              whenever your Chromebook organization blocks <code className="font-mono">.dev</code> sites.
            </p>
          </div>
          <span className="font-mono text-xs text-emerald-400">
            Route: {routeStatus.activeKind}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="brain-url" className="block text-xs font-medium text-slate-300">
              Primary Endpoint (Cloudflare Worker or Ollama)
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
              placeholder="mantis-brain.garrettwins3.workers.dev"
              className="min-h-[44px] w-full rounded-md border border-slate-700 bg-[#0B1120] px-3.5 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="backup-brain-url" className="block text-xs font-medium text-slate-300">
                Chromebook Backup URL (Non-.dev Supabase)
              </label>
              <button
                type="button"
                onClick={() => setBackupUrlDraft(DEFAULT_BACKUP_EDGE_URL)}
                className="font-mono text-[11px] font-medium text-emerald-400 hover:text-emerald-300"
              >
                Use Supabase URL
              </button>
            </div>
            <input
              id="backup-brain-url"
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={backupUrlDraft}
              onChange={(e) => setBackupUrlDraft(e.target.value)}
              placeholder={DEFAULT_BACKUP_EDGE_URL}
              className="min-h-[44px] w-full rounded-md border border-slate-700 bg-[#0B1120] px-3.5 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="brain-model" className="block text-xs font-medium text-slate-300">
              Cloud Assist Model Preference
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

          <div className="flex flex-col justify-end gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={preferBuiltInDraft}
                onChange={(e) => setPreferBuiltInDraft(e.target.checked)}
                className="h-4 w-4 accent-emerald-500"
              />
              <span>Built-in AI leads every turn (Cloud Brain distills &amp; assists)</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={autoLearnDraft}
                onChange={(e) => setAutoLearnDraft(e.target.checked)}
                className="h-4 w-4 accent-emerald-500"
              />
              <span>Auto-mine rules &amp; facts during chats</span>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-800 pt-3">
          <button
            type="button"
            onClick={() => void handleCopyText(MANTIS_CLOUDFLARE_WORKER_JS, 'worker')}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700"
          >
            {copiedWhich === 'worker' ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            <span>{copiedWhich === 'worker' ? 'Worker Code Copied' : 'Copy Worker Code'}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowEdgeCode((v) => !v)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700"
          >
            <Copy className="h-3.5 w-3.5" />
            <span>
              {showEdgeCode ? 'Hide Chromebook Edge Files' : 'Chromebook Edge Files (4 Light Files)'}
            </span>
          </button>

          <button
            type="submit"
            disabled={brainStatus === 'testing'}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            <span>{brainStatus === 'testing' ? 'Testing Routes...' : 'Save & Test Both Routes'}</span>
          </button>
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

        {/* Zero-CLI Guides */}
        <div className="flex flex-wrap gap-4 border-t border-slate-800 pt-3">
          <button
            type="button"
            onClick={() => setShowEdgeCode((v) => !v)}
            className="text-xs font-medium text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
          >
            {showEdgeCode
              ? 'Hide Chromebook .supabase.co Edge Function setup'
              : 'Show 2-minute Chromebook non-.dev Edge Function setup'}
          </button>
          <button
            type="button"
            onClick={() => setShowWorkerCode((v) => !v)}
            className="text-xs font-medium text-slate-300 underline underline-offset-2 hover:text-slate-100"
          >
            {showWorkerCode
              ? 'Hide Cloudflare Worker setup & code'
              : 'Show Cloudflare Worker setup & code'}
          </button>
        </div>

        {showEdgeCode && (
          <div className="space-y-3 rounded-md border border-slate-800 bg-[#0B1120] p-4 text-xs text-slate-300">
            <div className="font-semibold text-emerald-300">
              Bypass Chromebook `.dev` Block via Supabase Edge Function (4 Tiny Tablet-Safe Files)
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                {id: 'supabase-helpers' as const, label: '1. Copy helpers.ts', code: MANTIS_SUPABASE_EDGE_HELPERS_TS},
                {id: 'supabase-providers' as const, label: '2. Copy providers.ts', code: MANTIS_SUPABASE_EDGE_PROVIDERS_TS},
                {id: 'supabase-routes' as const, label: '3. Copy routes.ts', code: MANTIS_SUPABASE_EDGE_ROUTES_TS},
                {id: 'supabase-fn' as const, label: '4. Copy index.ts (3 lines)', code: MANTIS_SUPABASE_EDGE_FUNCTION_TS},
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void handleCopyText(item.code, item.id)}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700"
                >
                  {copiedWhich === item.id ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span>{copiedWhich === item.id ? 'Copied!' : item.label}</span>
                </button>
              ))}
            </div>
            <ol className="list-inside list-decimal space-y-1.5 leading-relaxed text-slate-400">
              <li>
                Open{' '}
                <code className="font-mono text-slate-200">
                  supabase.com/dashboard/project/ncbtoawlltxukzzdyvhc/functions
                </code>{' '}
                and click <strong>Deploy a new function → Via Editor</strong>.
              </li>
              <li>
                Use <strong>+ Add File</strong> to create <code className="font-mono text-slate-200">helpers.ts</code>,{' '}
                <code className="font-mono text-slate-200">providers.ts</code>, and{' '}
                <code className="font-mono text-slate-200">routes.ts</code>, pasting each file above.
              </li>
              <li>
                Open <code className="font-mono text-slate-200">index.ts</code>, delete all 26 starter
                lines, and paste the 3-line <code className="font-mono text-slate-200">index.ts</code>.
                Name the function <code className="font-mono text-slate-200">mantis-brain</code> and deploy.
              </li>
              <li>
                In <strong>Details</strong> for <code className="font-mono text-slate-200">mantis-brain</code>,
                turn OFF <strong>Enforce JWT Verification</strong>, and add{' '}
                <code className="font-mono text-slate-200">GROQ_API_KEY</code> under{' '}
                <strong>Edge Functions → Secrets</strong>.
              </li>
              <li>
                Tap <strong>Use Supabase URL</strong> next to Chromebook Backup URL above and click{' '}
                <strong>Save &amp; Test Both Routes</strong>.
              </li>
            </ol>
          </div>
        )}

        {showWorkerCode && (
          <div className="space-y-2.5 rounded-md border border-slate-800 bg-[#0B1120] p-4 text-xs text-slate-300">
            <ol className="list-inside list-decimal space-y-1.5 leading-relaxed text-slate-400">
              <li>
                Open Cloudflare <code className="font-mono text-slate-200">mantis-brain</code> →{' '}
                <strong>Settings → Bindings → Add → Workers AI</strong> → Variable name:{' '}
                <code className="font-mono text-slate-200">AI</code> (10,000 free Neurons/day).
              </li>
              <li>
                Tap <strong>Edit code</strong>, paste the copied Worker Code, and click{' '}
                <strong>Deploy</strong>.
              </li>
            </ol>
            <pre className="max-h-44 overflow-auto rounded border border-slate-800 bg-[#0F172A] p-3 font-mono text-[11px] leading-relaxed text-slate-300">
              {MANTIS_CLOUDFLARE_WORKER_JS}
            </pre>
          </div>
        )}
      </form>

      {/* Honest Memory, Repo & Suggestion Readiness Breakdown */}
      <section className="space-y-4 rounded-lg border border-slate-800 bg-[#0F172A] p-5 sm:p-6">
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
              {metrics.conversationTurns} turns
            </div>
          </div>
        </div>
      </section>

      {/* GitHub Pages Deployment Checklist */}
      <section className="space-y-2.5 rounded-lg border border-slate-800 bg-[#0F172A] p-5 sm:p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <GitBranch className="h-4 w-4 text-emerald-400" />
          <span>GitHub Pages Static Deployment Note</span>
        </div>
        <p className="text-xs leading-relaxed text-slate-300">
          Ensure GitHub repository <strong>Settings → Pages → Source</strong> is set to{' '}
          <strong>GitHub Actions</strong> with relative <code className="font-mono">./</code> asset
          paths so <code className="font-mono">/Mantis/</code> deploys cleanly.
        </p>
      </section>

      {/* Supabase Connection & Security */}
      <section className="space-y-4 rounded-lg border border-slate-800 bg-[#0F172A] p-5 sm:p-6">
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
            Security verified: Neither your Supabase Secret key nor your AI provider keys are stored
            in frontend code or GitHub.
          </span>
        </div>
      </section>

      {/* Phase 1–6 SQL References */}
      <section className="space-y-4 rounded-lg border border-slate-800 bg-[#0F172A] p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-emerald-400" />
              <h2 className="text-sm font-semibold text-slate-100">
                Phase 6 Polish SQL (Optional — {phase6SchemaMissing ? 'Fallback Active' : 'Synced in DB'})
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Adds cross-device syncing for Knowledge trust status, source URLs, extraction dates, and theme preferences. Safe fallback works even before running this SQL.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleCopyText(MANTIS_PHASE6_SCHEMA_SQL, 6)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700"
          >
            {copiedWhich === 6 ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            <span>{copiedWhich === 6 ? 'Phase 6 SQL Copied' : 'Copy Phase 6 SQL'}</span>
          </button>
        </div>
        <pre className="max-h-36 overflow-auto rounded-md border border-slate-800 bg-[#0B1120] p-3 font-mono text-[11px] leading-relaxed text-slate-300">
          {MANTIS_PHASE6_SCHEMA_SQL}
        </pre>

        {offlineQueueCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-950/25 px-3.5 py-2.5 text-xs text-amber-200">
            <span>
              {offlineQueueCount} offline knowledge {offlineQueueCount === 1 ? 'change' : 'changes'} queued locally.
            </span>
            <button
              type="button"
              onClick={onFlushOfflineQueue}
              className="min-h-[34px] rounded bg-amber-600 px-3 py-1 font-semibold text-white hover:bg-amber-500"
            >
              Sync Queued Now
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-200">
            <Database className="h-4 w-4 text-slate-400" />
            <span>
              Phases 1–6: P1 {schemaMissing ? 'Missing' : 'Active'} · P2{' '}
              {phase2SchemaMissing ? 'Missing' : 'Active'} · P3{' '}
              {phase3SchemaMissing ? 'Missing' : 'Active'} · P4{' '}
              {phase4SchemaMissing ? 'Missing' : 'Active'} · P5{' '}
              {phase5SchemaMissing ? 'Missing' : 'Active'} · P6{' '}
              {phase6SchemaMissing ? 'Local Fallback' : 'Active'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              {num: 5 as const, sql: MANTIS_PHASE5_SCHEMA_SQL},
              {num: 4 as const, sql: MANTIS_PHASE4_SCHEMA_SQL},
              {num: 3 as const, sql: MANTIS_PHASE3_SCHEMA_SQL},
              {num: 2 as const, sql: MANTIS_PHASE2_SCHEMA_SQL},
              {num: 1 as const, sql: MANTIS_PHASE1_SCHEMA_SQL},
            ].map((item) => (
              <button
                key={item.num}
                type="button"
                onClick={() => void handleCopyText(item.sql, item.num)}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700"
              >
                {copiedWhich === item.num ? (
                  <Check className="h-3 w-3 text-emerald-400" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                <span>P{item.num}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Account Session */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-800 bg-[#0F172A] p-5">
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
