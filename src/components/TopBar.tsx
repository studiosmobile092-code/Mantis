import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Moon,
  RefreshCw,
  Search,
  Sun,
  WifiOff,
} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import type {
  AreaId,
  BrainRouteStatus,
  ComputeEngineStatus,
  ThemeMode,
} from '../types/mantis';

interface TopBarProps {
  activeArea: AreaId;
  onSelectArea: (area: AreaId) => void;
  routeStatus: BrainRouteStatus;
  computeStatus: ComputeEngineStatus;
  modelName: string;
  knowledgeCount: number;
  conceptCount: number;
  pendingOfflineCount: number;
  isOnline: boolean;
  theme: ThemeMode;
  isSyncing: boolean;
  onCycleTheme: () => void;
  onOpenCommandPalette: () => void;
  onSync: () => void;
}

const AREA_LABELS: Record<AreaId, string> = {
  studio: 'Workbench',
  knowledge: 'Memory Explorer',
  ingest: 'Capture Studio',
  github: 'Code & Diffs',
  training: 'Training & Evals',
  export: 'Model Export',
  settings: 'Settings',
};

function formatRouteLabel(routeStatus: BrainRouteStatus): string {
  switch (routeStatus.activeKind) {
    case 'primary-worker':
      return 'Worker Connected';
    case 'backup-supabase':
      return 'Edge Backup';
    case 'ollama-direct':
      return 'Ollama Local';
    default:
      return 'Scratch Only';
  }
}

export function TopBar({
  activeArea,
  onSelectArea,
  routeStatus,
  computeStatus,
  modelName,
  knowledgeCount,
  conceptCount,
  pendingOfflineCount,
  isOnline,
  theme,
  isSyncing,
  onCycleTheme,
  onOpenCommandPalette,
  onSync,
}: TopBarProps) {
  const [statusOpen, setStatusOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!statusOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setStatusOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStatusOpen(false);
    };
    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [statusOpen]);

  const connectionState: 'connected' | 'degraded' | 'offline' = !isOnline
    ? 'offline'
    : pendingOfflineCount > 0 || Boolean(routeStatus.failoverReason)
      ? 'degraded'
      : 'connected';

  const statusLabel =
    connectionState === 'offline'
      ? 'Offline'
      : connectionState === 'degraded'
        ? 'Degraded'
        : 'Ready';

  return (
    <header className="sticky top-0 z-30 h-12 shrink-0 border-b border-line bg-canvas/95 backdrop-blur-xs">
      <div className="flex h-full items-center justify-between gap-4 px-4">
        {/* Zone 1: Brand + Clean Contextual Breadcrumb */}
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => onSelectArea('studio')}
            className="shrink-0 whitespace-nowrap font-bold tracking-tight text-ink transition-colors hover:text-accent-text"
          >
            Mantis
          </button>
          <span aria-hidden="true" className="text-ink-subtle">
            /
          </span>
          <span className="truncate font-medium text-ink-muted">{AREA_LABELS[activeArea]}</span>
          <span aria-hidden="true" className="hidden text-ink-subtle sm:inline">
            ·
          </span>
          <span className="hidden truncate font-mono text-xs text-ink-subtle sm:inline">
            {modelName}
          </span>
        </div>

        {/* Zone 2: VS Code-style Center Omnibar Trigger */}
        <button
          type="button"
          onClick={onOpenCommandPalette}
          aria-label="Open Command Bar (Ctrl+K)"
          className="hidden h-8 w-full max-w-sm items-center justify-between rounded-md border border-line bg-inset px-3 text-xs text-ink-muted transition-colors hover:border-line-strong hover:text-ink lg:flex"
        >
          <span className="flex items-center gap-2 truncate">
            <Search className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
            <span className="truncate">Search commands, knowledge, repo files…</span>
          </span>
          <span className="shrink-0 font-mono text-[11px] text-ink-subtle">Ctrl+K</span>
        </button>

        {/* Zone 3: Hardware & Route Popover + Theme + Sync */}
        <div className="flex shrink-0 items-center gap-2">
          <div ref={popoverRef} className="relative">
            <button
              type="button"
              onClick={() => setStatusOpen((prev) => !prev)}
              aria-expanded={statusOpen}
              aria-label="System and compute details"
              className="inline-flex min-h-[40px] items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:border-line-strong"
            >
              {connectionState === 'offline' ? (
                <WifiOff className="h-3.5 w-3.5 text-danger" />
              ) : connectionState === 'degraded' ? (
                <AlertTriangle className="h-3.5 w-3.5 text-warn" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 text-accent-text" />
              )}
              <span className="hidden whitespace-nowrap sm:inline">{statusLabel}</span>
              <span aria-hidden="true" className="hidden text-ink-subtle lg:inline">
                ·
              </span>
              <span className="hidden whitespace-nowrap font-mono text-[11px] text-ink-muted lg:inline">
                {formatRouteLabel(routeStatus)}
              </span>
            </button>

            {statusOpen && (
              <div className="mantis-modal-in absolute right-0 mt-2 w-80 rounded-lg border border-line-strong bg-elevated p-3.5 shadow-2xl">
                <div className="space-y-2.5 text-xs">
                  <div className="flex items-center justify-between border-b border-line pb-2">
                    <span className="font-semibold text-ink">Engine & Compute</span>
                    <span className="font-mono text-[11px] text-accent-text">{statusLabel}</span>
                  </div>

                  <div className="space-y-1.5 font-mono text-[11px] tabular-nums">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink-muted">Compute Backend:</span>
                      <span className="flex items-center gap-1 text-ink">
                        <Cpu className="h-3 w-3 text-accent-text" />
                        <span>{computeStatus.adapterLabel}</span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink-muted">Int8 Vector Cache:</span>
                      <span className="text-ink">
                        {computeStatus.indexedVectorsCount} vecs ·{' '}
                        {Math.round(computeStatus.vectorBytesUsed / 1024)} KB
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink-muted">AI Brain Route:</span>
                      <span className="text-ink">{formatRouteLabel(routeStatus)}</span>
                    </div>
                    {routeStatus.latencyMs !== null && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-ink-muted">Route Latency:</span>
                        <span className="text-ink">{routeStatus.latencyMs} ms</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink-muted">Memory Index:</span>
                      <span className="text-ink">
                        {knowledgeCount} notes · {conceptCount} concepts
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink-muted">Sync Queue:</span>
                      <span className="text-ink">
                        {!isOnline
                          ? 'Offline Queue Active'
                          : pendingOfflineCount > 0
                            ? `${pendingOfflineCount} pending`
                            : 'Synced'}
                      </span>
                    </div>
                  </div>

                  {routeStatus.failoverReason && (
                    <p className="rounded border border-warn-border bg-warn-soft px-2.5 py-1.5 text-[11px] leading-snug text-warn">
                      {routeStatus.failoverReason}
                    </p>
                  )}

                  <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setStatusOpen(false);
                        onSelectArea('settings');
                      }}
                      className="text-xs font-medium text-accent-text hover:underline"
                    >
                      Open Diagnostics
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setStatusOpen(false);
                        onSync();
                      }}
                      className="text-xs font-medium text-ink-muted hover:text-ink"
                    >
                      Refresh Now
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onOpenCommandPalette}
            aria-label="Open Command Palette"
            className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-md border border-line bg-surface px-2 text-xs text-ink-muted transition-colors hover:border-line-strong hover:text-ink lg:hidden"
          >
            <Search className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={onCycleTheme}
            title={`Theme: ${theme}`}
            aria-label={`Switch theme from ${theme}`}
            className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-md border border-line bg-surface text-xs text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            {theme === 'light' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>

          <button
            type="button"
            onClick={onSync}
            disabled={isSyncing}
            className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-line-strong bg-surface px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{isSyncing ? 'Syncing' : 'Sync'}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
