import {PanelRight, Search, WifiOff} from 'lucide-react';
import type {WorkspaceMode} from '../types/mantis';

interface TopBarProps {
  activeMode: WorkspaceMode;
  onSelectMode: (mode: WorkspaceMode) => void;
  modelName: string;
  checkpointId?: string;
  localModelShortLabel?: string | null;
  isOnline: boolean;
  pendingOfflineCount: number;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  onOpenCommandPalette: () => void;
}

const MODE_TABS: Array<{id: WorkspaceMode; label: string}> = [
  {id: 'train', label: 'Train & Chat'},
  {id: 'memory', label: 'Memory & Data'},
  {id: 'evals', label: 'Eval & Export'},
];

export function TopBar({
  activeMode,
  onSelectMode,
  modelName,
  checkpointId,
  localModelShortLabel,
  isOnline,
  pendingOfflineCount,
  inspectorOpen,
  onToggleInspector,
  onOpenCommandPalette,
}: TopBarProps) {
  const needsAttention = !isOnline || pendingOfflineCount > 0;

  return (
    <header className="shrink-0 border-b border-line bg-canvas">
      {/* Row 1: Strict 3-Zone Header (48px) */}
      <div className="flex h-12 items-center justify-between gap-4 px-3 sm:px-5">
        {/* Zone 1: Brand + Active Model */}
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => onSelectMode('train')}
            className="shrink-0 whitespace-nowrap text-sm font-semibold tracking-tight text-ink transition-colors hover:text-accent-text"
          >
            Mantis
          </button>
          <span aria-hidden="true" className="text-ink-subtle">
            /
          </span>
          <span className="truncate font-mono text-xs tabular-nums text-ink-muted">
            {modelName}
            {checkpointId ? ` · ${checkpointId}` : ''}
            {localModelShortLabel ? ` · ${localModelShortLabel}` : ''}
          </span>
        </div>

        {/* Zone 2: Clean 3-Mode Navigation (Desktop & Landscape Tablet) */}
        <nav
          aria-label="Primary workspace modes"
          className="hidden items-center gap-6 md:flex"
        >
          {MODE_TABS.map((tab) => {
            const active = activeMode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectMode(tab.id)}
                aria-current={active ? 'page' : undefined}
                className={`relative inline-flex min-h-[48px] shrink-0 items-center whitespace-nowrap text-xs font-medium transition-colors ${
                  active
                    ? 'text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-accent'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Command Search + Single Inspector Trigger */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenCommandPalette}
            aria-label="Search commands and memory (Ctrl+K)"
            className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center gap-2 rounded-md border border-line bg-surface px-2.5 text-xs text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden font-mono text-[11px] text-ink-subtle lg:inline">
              Ctrl+K
            </span>
          </button>

          <button
            type="button"
            onClick={onToggleInspector}
            aria-expanded={inspectorOpen}
            aria-label="Open workspace inspector and settings drawer"
            className={`inline-flex min-h-[40px] shrink-0 items-center gap-2 whitespace-nowrap rounded-md border px-3 text-xs font-medium transition-colors ${
              inspectorOpen
                ? 'border-accent-border bg-accent-soft text-accent-text'
                : 'border-line bg-surface text-ink hover:border-line-strong'
            }`}
          >
            {!isOnline ? (
              <WifiOff className="h-3.5 w-3.5 shrink-0 text-danger" />
            ) : (
              <PanelRight className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
            )}
            <span>Inspector</span>
            {needsAttention && (
              <span className="font-mono text-[11px] tabular-nums text-warn">
                {!isOnline ? 'Offline' : pendingOfflineCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Row 2 (< md Portrait Tablet / Phone): 3 Clean Modes (40px — total sticky <= 88px / < 11% viewport) */}
      <nav
        aria-label="Mobile workspace modes"
        className="grid h-10 grid-cols-3 border-t border-line bg-inset md:hidden"
      >
        {MODE_TABS.map((tab) => {
          const active = activeMode === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectMode(tab.id)}
              aria-current={active ? 'page' : undefined}
              className={`relative flex min-h-[40px] items-center justify-center whitespace-nowrap px-2 text-xs font-medium transition-colors ${
                active
                  ? 'text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-[2px] after:bg-accent'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
