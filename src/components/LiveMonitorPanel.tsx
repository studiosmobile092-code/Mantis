import {
  Activity,
  Cpu,
  Database,
  Network,
  PanelRightClose,
  ShieldCheck,
} from 'lucide-react';
import {useMemo} from 'react';
import type {
  BrainRouteStatus,
  KnowledgeEntry,
  KnowledgeGrowthStats,
  LearningEvent,
  MemoryReadinessMetrics,
} from '../types/mantis';

interface LiveMonitorPanelProps {
  routeStatus: BrainRouteStatus;
  entries: KnowledgeEntry[];
  growth: KnowledgeGrowthStats;
  metrics: MemoryReadinessMetrics;
  learningEvents: LearningEvent[];
  preferBuiltInFirst: boolean;
  onOpenSettings: () => void;
  onQueryConcept: (conceptLabel: string) => void;
  onCollapse?: () => void;
}

function describeRoute(routeStatus: BrainRouteStatus): {label: string; isCloud: boolean} {
  switch (routeStatus.activeKind) {
    case 'primary-worker':
      return {label: 'Cloudflare Worker Active', isCloud: true};
    case 'backup-supabase':
      return {label: 'Chromebook Backup (.supabase.co)', isCloud: true};
    case 'ollama-direct':
      return {label: 'Local Ollama Hardware', isCloud: true};
    default:
      return {label: 'Built-in Local Engine', isCloud: false};
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
  entries,
  growth,
  metrics,
  learningEvents,
  preferBuiltInFirst,
  onOpenSettings,
  onQueryConcept,
  onCollapse,
}: LiveMonitorPanelProps) {
  const routeDisplay = describeRoute(routeStatus);

  const trustCounts = useMemo(() => {
    let trusted = 0;
    let reviewed = 0;
    let raw = 0;
    for (const entry of entries) {
      const status = entry.status || 'reviewed';
      if (status === 'trusted') trusted += 1;
      else if (status === 'raw') raw += 1;
      else reviewed += 1;
    }
    return {trusted, reviewed, raw};
  }, [entries]);

  return (
    <aside
      aria-label="Live Training Monitor"
      className="flex h-full flex-col gap-4 rounded-lg border border-line bg-surface p-3.5"
    >
      {/* Monitor Header */}
      <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
        <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-ink-muted uppercase">
          <Activity className="h-3.5 w-3.5 text-accent-text" />
          <span>Context Monitor</span>
        </span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs tabular-nums text-accent-text">
            {metrics.readinessScore}/100
          </span>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              title="Collapse Context Monitor (Ctrl+Shift+M)"
              aria-label="Collapse Context Monitor pane"
              className="hidden min-h-[40px] min-w-[40px] items-center justify-center rounded-md text-ink-muted hover:bg-elevated hover:text-ink xl:inline-flex"
            >
              <PanelRightClose className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Active Route & Built-in Mode */}
      <section className="space-y-2 rounded-md border border-line bg-inset p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
            <Cpu className="h-3.5 w-3.5 text-ink-subtle" />
            <span>Engine Route</span>
          </span>
          <button
            type="button"
            onClick={onOpenSettings}
            className="text-[11px] font-medium text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            Configure
          </button>
        </div>

        <div
          className={`font-mono text-xs font-medium ${
            routeDisplay.isCloud ? 'text-accent-text' : 'text-ink'
          }`}
        >
          {routeDisplay.label}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-ink-muted">
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
          <p className="text-[11px] leading-snug text-amber-400">{routeStatus.failoverReason}</p>
        )}
      </section>

      {/* Memory Trust Breakdown */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
          <Database className="h-3.5 w-3.5" />
          <span>Memory Trust &amp; Growth</span>
        </div>

        <div className="grid grid-cols-3 gap-1.5 rounded-md border border-line bg-inset p-2.5 text-center font-mono">
          <div>
            <div className="text-[10px] text-accent-text">Trusted</div>
            <div className="text-sm font-semibold tabular-nums text-ink">
              {trustCounts.trusted}
            </div>
          </div>
          <div className="border-x border-line">
            <div className="text-[10px] text-ink-muted">Reviewed</div>
            <div className="text-sm font-semibold tabular-nums text-ink">
              {trustCounts.reviewed}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-ink-subtle">Raw (Muted)</div>
            <div className="text-sm font-semibold tabular-nums text-ink-muted">
              {trustCounts.raw}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md border border-line bg-inset p-2.5">
            <div className="text-[11px] text-ink-muted">Entries</div>
            <div className="mt-0.5 font-mono text-base font-semibold tabular-nums text-ink">
              {growth.totalEntries}
            </div>
            <div className="font-mono text-[11px] tabular-nums text-ink-subtle">
              {growth.autoMinedCount} auto-mined
            </div>
          </div>

          <div className="rounded-md border border-line bg-inset p-2.5">
            <div className="text-[11px] text-ink-muted">Recalls</div>
            <div className="mt-0.5 font-mono text-base font-semibold tabular-nums text-ink">
              {growth.totalRecalls}
            </div>
            <div className="font-mono text-[11px] tabular-nums text-ink-subtle">
              avg conf {growth.avgConfidence}
            </div>
          </div>
        </div>
      </section>

      {/* Concept Graph Links */}
      <section className="space-y-2 border-t border-line pt-3">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
          <Network className="h-3.5 w-3.5" />
          <span>Concept Cluster Links</span>
        </div>

        {growth.topConcepts.length === 0 ? (
          <p className="text-xs leading-relaxed text-ink-subtle">
            Teach rules or ingest links to build concept associations.
          </p>
        ) : (
          <div className="space-y-1.5">
            {growth.topConcepts.slice(0, 4).map((node) => (
              <div
                key={node.label}
                className="rounded-md border border-line bg-inset px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onQueryConcept(node.label)}
                    className="font-mono text-xs font-medium text-accent-text hover:underline"
                  >
                    {node.label}
                  </button>
                  <span className="font-mono text-[11px] tabular-nums text-ink-muted">
                    {node.count} {node.count === 1 ? 'note' : 'notes'}
                  </span>
                </div>
                {node.related.length > 0 && (
                  <div className="mt-1 truncate font-mono text-[11px] text-ink-subtle">
                    Links: {node.related.join(' · ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Live Learning Stream */}
      <section className="space-y-2 border-t border-line pt-3">
        <div className="flex items-center justify-between text-[11px] font-medium text-ink-muted">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Learning Activity Feed</span>
          </span>
          <span className="font-mono tabular-nums">{learningEvents.length}</span>
        </div>

        {learningEvents.length === 0 ? (
          <p className="text-xs leading-relaxed text-ink-subtle">
            Session learning events appear here in real time as Mantis stores new rules, links, voice, and OCR notes.
          </p>
        ) : (
          <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
            {learningEvents.slice(0, 12).map((ev) => (
              <div
                key={ev.id}
                className="rounded-md border border-line bg-inset px-2.5 py-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                  <span className="text-accent-text">{formatEventKind(ev.kind)}</span>
                  <span className="tabular-nums text-ink-subtle">
                    {new Date(ev.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <div className="mt-0.5 truncate font-medium text-ink">{ev.title}</div>
                {ev.detail && (
                  <div className="mt-0.5 truncate text-[11px] text-ink-muted">{ev.detail}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
