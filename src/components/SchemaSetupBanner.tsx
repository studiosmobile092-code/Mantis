import {Check, Copy, Database, RefreshCw} from 'lucide-react';
import {useState} from 'react';
import {MANTIS_PHASE1_SCHEMA_SQL} from '../lib/schemaText';

interface SchemaSetupBannerProps {
  onRetry: () => void;
  isChecking: boolean;
}

export function SchemaSetupBanner({onRetry, isChecking}: SchemaSetupBannerProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopySql() {
    try {
      await navigator.clipboard.writeText(MANTIS_PHASE1_SCHEMA_SQL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="rounded-lg border border-amber-500/40 bg-slate-900 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
            <Database className="h-4 w-4 shrink-0" />
            <span>Supabase Table Setup or Permission Grant Needed</span>
          </div>
          <p className="max-w-2xl text-sm leading-relaxed text-slate-300">
            Your Supabase account connected, but the Phase 1 tables (
            <code className="font-mono text-xs text-slate-100">knowledge_folders</code>,{' '}
            <code className="font-mono text-xs text-slate-100">knowledge_entries</code>,{' '}
            <code className="font-mono text-xs text-slate-100">chat_messages</code>) either do not
            exist yet or are missing <code className="font-mono text-xs text-slate-100">GRANT</code>{' '}
            privileges for the <code className="font-mono text-xs text-slate-100">authenticated</code>{' '}
            role. Copy and run the updated SQL below once in Supabase SQL Editor, then tap{' '}
            <strong>Verify Tables</strong>.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopySql}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-100 transition-colors hover:bg-slate-700"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            <span>{copied ? 'SQL Copied' : 'Copy SQL'}</span>
          </button>

          <button
            type="button"
            onClick={onRetry}
            disabled={isChecking}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${isChecking ? 'animate-spin' : ''}`} />
            <span>{isChecking ? 'Checking...' : 'Verify Tables'}</span>
          </button>
        </div>
      </div>

      <pre className="mt-4 max-h-56 overflow-auto rounded-md border border-slate-800 bg-[#0B1120] p-3 font-mono text-xs leading-relaxed text-slate-300">
        {MANTIS_PHASE1_SCHEMA_SQL}
      </pre>
    </section>
  );
}
