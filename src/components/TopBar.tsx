import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  GitBranch,
  Moon,
  Radio,
  RefreshCw,
  Search,
  Settings,
  Sun,
  Terminal,
  WifiOff,
} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import type {AreaId, BrainRouteStatus, ThemeMode} from '../types/mantis';

interface TopBarProps {
  activeArea: AreaId;
  onSelectArea: (area: AreaId) => void;
  routeStatus: BrainRouteStatus;
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

const NAV_ITEMS: Array<{id: AreaId; label: string; icon: typeof Terminal}> = [
  {id: 'studio', label: 'Studio', icon: Terminal},
  {id: 'knowledge', label: 'Knowledge', icon: BookOpen},
  {id: 'ingest', label: 'Ingest', icon: Radio},
  {id: 'github', label: 'GitHub', icon: GitBranch},
  {id: 'settings', label: 'Settings', icon: Settings},
];

function formatRouteLabel(routeStatus: BrainRouteStatus): string {
  switch (routeStatus.activeKind) {
    case 'primary-worker':
      return 'Worker Connected';
    case 'backup-supabase':
      return 'Chromebook Backup';
    case 'ollama-direct':
      return 'Ollama Local';
    default:
      return 'Built-in Engine';
  }
}

export function TopBar({
  activeArea,
  onSelectArea,
  routeStatus,
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
        : 'Connected';

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur-xs">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6 lg:gap-6">
          {/* Zone 1: Wordmark */}
          <button
            type="button"
            onClick={() => onSelectArea('studio')}
            className="shrink-0 whitespace-nowrap text-left text-base font-bold tracking-tight text-ink transition-colors hover:text-accent-text"
          >
            Mantis Studio
          </button>

          {/* Zone 2: 5 concise single-line navigation links */}
          <nav aria-label="Primary navigation" className="hidden items-center gap-5 md:flex">
            {NAV_ITEMS.map((item) => {
              const isActive = activeArea === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectArea(item.id)}
                  className={`relative shrink-0 whitespace-nowrap py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-accent'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Calm Status Popover + Search + Theme + Sync */}
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <div ref={popoverRef} className="relative">
              <button
                type="button"
                onClick={() => setStatusOpen((prev) => !prev)}
                aria-expanded={statusOpen}
                aria-label="Connection status details"
                className="inline-flex min-h-[38px] items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:border-line-strong"
              >
                {connectionState === 'offline' ? (
                  <WifiOff className="h-3.5 w-3.5 text-red-400" />
                ) : connectionState === 'degraded' ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-accent-text" />
                )}
                <span className="hidden sm:inline">{statusLabel}</span>
                <span aria-hidden="true" className="hidden text-ink-subtle lg:inline">
                  ·
                </span>
                <span className="hidden font-mono text-[11px] text-ink-muted lg:inline">
                  {formatRouteLabel(routeStatus)}
                </span>
              </button>

              {statusOpen && (
                <div className="mantis-modal-in absolute right-0 mt-2 w-72 rounded-lg border border-line-strong bg-surface p-3.5 shadow-2xl">
                  <div className="space-y-2.5 text-xs">
                    <div className="flex items-center justify-between border-b border-line pb-2">
                      <span className="font-semibold text-ink">System Connection</span>
                      <span className="font-mono text-[11px] text-accent-text">
                        {statusLabel}
                      </span>
                    </div>

                    <div className="space-y-1.5 font-mono text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-ink-muted">Supabase Sync:</span>
                        <span className="text-ink">
                          {!isOnline
                            ? 'Offline Queue Active'
                            : pendingOfflineCount > 0
                              ? `${pendingOfflineCount} queued`
                              : 'Synced'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-ink-muted">AI Route:</span>
                        <span className="text-ink">{formatRouteLabel(routeStatus)}</span>
                      </div>
                      {routeStatus.latencyMs !== null && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-ink-muted">Latency:</span>
                          <span className="tabular-nums text-ink">
                            {routeStatus.latencyMs} ms
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-ink-muted">Memory:</span>
                        <span className="tabular-nums text-ink">
                          {knowledgeCount} notes · {conceptCount} concepts
                        </span>
                      </div>
                    </div>

                    {routeStatus.failoverReason && (
                      <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-amber-400">
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
              title="Command Palette (Ctrl+K)"
              aria-label="Open Command Palette"
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="hidden font-mono text-[11px] sm:inline">Ctrl+K</span>
            </button>

            <button
              type="button"
              onClick={onCycleTheme}
              title={`Theme: ${theme} (tap to switch)`}
              aria-label={`Current theme ${theme}, switch theme`}
              className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              {theme === 'light' ? (
                <Sun className="h-3.5 w-3.5" />
              ) : (
                <Moon className="h-3.5 w-3.5" />
              )}
            </button>

            <button
              type="button"
              onClick={onSync}
              disabled={isSyncing}
              className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{isSyncing ? 'Syncing' : 'Sync'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Tablet / mobile navigation bar with >= 48px touch targets */}
      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-canvas/95 backdrop-blur-xs md:hidden"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeArea === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectArea(item.id)}
              className={`flex min-h-[50px] flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-medium transition-colors ${
                isActive ? 'text-accent-text' : 'text-ink-muted hover:text-ink'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate whitespace-nowrap">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
