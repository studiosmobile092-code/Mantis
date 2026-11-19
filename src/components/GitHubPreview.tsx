import {GitBranch, Lock} from 'lucide-react';

export function GitHubPreview() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1 border-b border-slate-800 pb-4">
        <h1 className="text-xl font-semibold tracking-tight text-slate-100">
          GitHub Repository Integration
        </h1>
        <p className="text-sm text-slate-400">
          Read-only repository browsing and guarded pull-request proposals are scheduled for Phase
          2–3.
        </p>
      </div>

      <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-md border border-slate-700 bg-[#0B1120] p-2.5 text-slate-300">
            <GitBranch className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-100">
              Scheduled for Phase 2 — Teaching &amp; GitHub Awareness
            </h2>
            <p className="text-sm leading-relaxed text-slate-300">
              Phase 1 focuses strictly on your persistent Supabase memory, single-user Auth, and
              GitHub Pages deployment (<code className="font-mono text-xs text-emerald-300">mantis-ai</code>).
              Once Phase 1 is verified on your Galaxy Tab A9/A9+, Phase 2 will add read-only
              repository awareness here.
            </p>
          </div>
        </div>

        <div className="grid gap-3 border-t border-slate-800 pt-4 sm:grid-cols-2">
          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
              <Lock className="h-3.5 w-3.5 text-slate-400" />
              <span>Phase 2 Scope</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              Connect a repository with read access so Mantis can reference real project files
              alongside your Knowledge folders.
            </p>
          </div>

          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
              <Lock className="h-3.5 w-3.5 text-slate-400" />
              <span>Phase 3–4 Guardrails</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              Clear diff previews and pull requests only—direct unreviewed commits are never
              allowed.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
