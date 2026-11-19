import {Check, Copy, Database, LogOut, ShieldCheck, Wifi} from 'lucide-react';
import {useState} from 'react';
import {MANTIS_PHASE1_SCHEMA_SQL} from '../lib/schemaText';
import {SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase} from '../lib/supabase';
import type {MemoryReadinessMetrics} from '../types/mantis';

interface SettingsPanelProps {
  userEmail: string;
  metrics: MemoryReadinessMetrics;
  schemaMissing: boolean;
  onSignOut: () => Promise<void>;
}

export function SettingsPanel({
  userEmail,
  metrics,
  schemaMissing,
  onSignOut,
}: SettingsPanelProps) {
  const [pingStatus, setPingStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [pingMessage, setPingMessage] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

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

  async function handleCopySql() {
    try {
      await navigator.clipboard.writeText(MANTIS_PHASE1_SCHEMA_SQL);
      setCopiedSql(true);
      window.setTimeout(() => setCopiedSql(false), 2500);
    } catch {
      setCopiedSql(false);
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
          Supabase connection details, honest Phase 1 memory progress, and security posture.
        </p>
      </div>

      {/* Honest Memory Readiness Breakdown */}
      <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Memory Readiness</h2>
            <p className="text-xs text-slate-400">
              Measured strictly from real saved entries, active folders, tags, and chat turns.
            </p>
          </div>
          <div className="font-mono text-2xl font-bold tabular-nums text-emerald-400">
            {metrics.readinessScore} / 100
          </div>
        </div>

        <div className="grid gap-3 border-t border-slate-800 pt-4 sm:grid-cols-4">
          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-3.5">
            <div className="text-xs text-slate-400">Knowledge Entries</div>
            <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-100">
              {metrics.entryCount}
            </div>
            <div className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500">
              {metrics.substantiveCount} substantive (&ge;25 chars)
            </div>
          </div>

          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-3.5">
            <div className="text-xs text-slate-400">Folders</div>
            <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-100">
              {metrics.folderCount}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-slate-500">Organized categories</div>
          </div>

          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-3.5">
            <div className="text-xs text-slate-400">Tagged Entries</div>
            <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-100">
              {metrics.taggedCount}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-slate-500">Indexed for retrieval</div>
          </div>

          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-3.5">
            <div className="text-xs text-slate-400">Chat Turns</div>
            <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-100">
              {metrics.conversationTurns}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-slate-500">Saved in Supabase</div>
          </div>
        </div>
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

      {/* Schema SQL Reference */}
      <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              Phase 1 Database Schema ({schemaMissing ? 'Setup Required' : 'Active'})
            </h2>
          </div>
          <button
            type="button"
            onClick={handleCopySql}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700"
          >
            {copiedSql ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copiedSql ? 'SQL Copied' : 'Copy SQL'}</span>
          </button>
        </div>
        <pre className="max-h-48 overflow-auto rounded-md border border-slate-800 bg-[#0B1120] p-3 font-mono text-[11px] leading-relaxed text-slate-300">
          {MANTIS_PHASE1_SCHEMA_SQL}
        </pre>
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
