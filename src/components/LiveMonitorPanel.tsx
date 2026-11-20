import {Activity, Cpu, Database, Network, ShieldCheck} from 'lucide-react';
import type {
  BrainRouteStatus,
  KnowledgeGrowthStats,
  LearningEvent,
  MemoryReadinessMetrics,
} from '../types/mantis';

interface LiveMonitorPanelProps {
  routeStatus: BrainRouteStatus;
  growth: KnowledgeGrowthStats;
  metrics: MemoryReadinessMetrics;
  learningEvents: LearningEvent[];
  preferBuiltInFirst: boolean;
  onOpenSettings: () => void;
  onQueryConcept: (conceptLabel: string) => void;
}

function describeRoute(routeStatus: BrainRouteStatus): {label: string; tone: string} {
  switch (routeStatus.activeKind) {
    case 'primary-worker':
      return {label: 'Cloudflare Worker Active', tone: 'text-emerald-400'};
    case 'backup-supabase':
      return {label: 'Chromebook Backup (.supabase.co)', tone: 'text-emerald-400'};
    case 'ollama-direct':
      return {label: 'Local Ollama Hardware', tone: 'text-emerald-400'};
    default:
      return {label: 'Built-in Local Engine Only', tone: 'text-slate-200'};
  }
}

function formatEventKind(kind: LearningEvent['kind']): string {
  switch (kind) {
    case 'auto_mined':
      return 'Mined';
    case 'url_ingested':
      return 'Link';
    case 'voice_captured':
      return 'Voice';
    case 'ocr_distilled':
      return 'OCR';
    case 'reinforced':
      return 'Boost';
    case 'cloud_assisted':
      return 'Assist';
    case 'repo_indexed':
      return 'Repo';
    default:
      return 'Taught';
  }
}

export function LiveMonitorPanel({
  routeStatus,
  growth,
  metrics,
  learningEvents,
  preferBuiltInFirst,
  onOpenSettings,
  onQueryConcept,
}: LiveMonitorPanelProps) {
  const routeDisplay = describeRoute(routeStatus);

  return (
    <aside
      aria-label="Live Training Monitor"
      className="flex h-full flex-col gap-5 rounded-lg border border-slate-800 bg-[#0F172A] p-3.5"
    >
      {/* Monitor Header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-300 uppercase">
          <Activity className="h-3.5 w-3.5 text-emerald-400" />
          <span>Live Monitor</span>
        </span>
        <span className="font-mono text-xs tabular-nums text-emerald-400">
          Readiness {metrics.readinessScore}/100
        </span>
      </div>

      {/* Active Route & Built-in Mode */}
      <section className="space-y-2 rounded-md border border-slate-800 bg-[#0B1120] p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
            <Cpu className="h-3.5 w-3.5 text-slate-400" />
            <span>Engine Route</span>
          </span>
          <button
            type="button"
            onClick={onOpenSettings}
            className="text-[11px] font-medium text-slate-400 underline underline-offset-2 hover:text-slate-200"
          >
            Configure
          </button>
        </div>

        <div className={`font-mono text-xs font-medium ${routeDisplay.tone}`}>
          {routeDisplay.label}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-slate-400">
          <span>{preferBuiltInFirst ? 'Built-in leads' : 'Cloud auto-assist'}</span>
          {routeStatus.latencyMs !== null && (
            <>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{routeStatus.latencyMs} ms</span>
            </>
          )}
          {routeStatus.activeProviders.length > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>{routeStatus.activeProviders.join(', ')}</span>
            </>
          )}
        </div>

        {routeStatus.failoverReason && (
          <p className="text-[11px] leading-snug text-amber-300">{routeStatus.failoverReason}</p>
        )}
      </section>

      {/* Real Knowledge Velocity Metrics (100% live counts, zero mock data) */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
          <Database className="h-3.5 w-3.5" />
          <span>Knowledge Growth (Live)</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-2.5">
            <div className="text-[11px] text-slate-400">Entries</div>
            <div className="mt-0.5 font-mono text-base font-semibold tabular-nums text-slate-100">
              {growth.totalEntries}
            </div>
            <div className="font-mono text-[11px] tabular-nums text-slate-500">
              {growth.autoMinedCount} auto-mined
            </div>
          </div>

          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-2.5">
            <div className="text-[11px] text-slate-400">Concepts</div>
            <div className="mt-0.5 font-mono text-base font-semibold tabular-nums text-slate-100">
              {growth.uniqueConcepts}
            </div>
            <div className="font-mono text-[11px] tabular-nums text-slate-500">
              {growth.capturedCount} captured
            </div>
          </div>

          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-2.5">
            <div className="text-[11px] text-slate-400">Recalls</div>
            <div className="mt-0.5 font-mono text-base font-semibold tabular-nums text-slate-100">
              {growth.totalRecalls}
            </div>
            <div className="font-mono text-[11px] tabular-nums text-slate-500">
              avg conf {growth.avgConfidence}
            </div>
          </div>

          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-2.5">
            <div className="text-[11px] text-slate-400">Manual Rules</div>
            <div className="mt-0.5 font-mono text-base font-semibold tabular-nums text-slate-100">
              {growth.manualTeachCount}
            </div>
            <div className="font-mono text-[11px] tabular-nums text-slate-500">
              {metrics.approvedSuggestions} approved diffs
            </div>
          </div>
        </div>
      </section>

      {/* Concept Graph Links */}
      <section className="space-y-2 border-t border-slate-800 pt-3.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
          <Network className="h-3.5 w-3.5" />
          <span>Concept Cluster Links</span>
        </div>

        {growth.topConcepts.length === 0 ? (
          <p className="text-xs leading-relaxed text-slate-500">
            Teach rules or ingest links to build concept associations.
          </p>
        ) : (
          <div className="space-y-1.5">
            {growth.topConcepts.slice(0, 4).map((node) => (
              <div
                key={node.label}
                className="rounded-md border border-slate-800 bg-[#0B1120] px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onQueryConcept(node.label)}
                    className="font-mono text-xs font-medium text-emerald-300 hover:underline"
                  >
                    {node.label}
                  </button>
                  <span className="font-mono text-[11px] tabular-nums text-slate-400">
                    {node.count} {node.count === 1 ? 'note' : 'notes'}
                  </span>
                </div>
                {node.related.length > 0 && (
                  <div className="mt-1 truncate font-mono text-[11px] text-slate-500">
                    Links: {node.related.join(' · ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Live Learning Stream */}
      <section className="space-y-2 border-t border-slate-800 pt-3.5">
        <div className="flex items-center justify-between text-[11px] font-medium text-slate-400">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Learning Activity Feed</span>
          </span>
          <span className="font-mono tabular-nums">{learningEvents.length}</span>
        </div>

        {learningEvents.length === 0 ? (
          <p className="text-xs leading-relaxed text-slate-500">
            Session learning events appear here in real time as Mantis stores new rules, links, voice, and OCR notes.
          </p>
        ) : (
          <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {learningEvents.slice(0, 12).map((ev) => (
              <div
                key={ev.id}
                className="rounded-md border border-slate-800 bg-[#0B1120] px-2.5 py-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                  <span className="text-emerald-400">{formatEventKind(ev.kind)}</span>
                  <span className="tabular-nums text-slate-500">
                    {new Date(ev.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <div className="mt-0.5 truncate font-medium text-slate-200">{ev.title}</div>
                {ev.detail && (
                  <div className="mt-0.5 truncate text-[11px] text-slate-400">{ev.detail}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
