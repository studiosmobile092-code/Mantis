import {BookOpen, GitBranch, MessageSquare, PlusCircle, RefreshCw, Settings} from 'lucide-react';
import type {AreaId} from '../types/mantis';

interface TopBarProps {
  activeArea: AreaId;
  onSelectArea: (area: AreaId) => void;
  statusLabel: string;
  knowledgeCount: number;
  repoFileCount: number;
  readinessScore: number;
  isSyncing: boolean;
  onSync: () => void;
}

const NAV_ITEMS: Array<{id: AreaId; label: string; icon: typeof MessageSquare}> = [
  {id: 'chat', label: 'Chat', icon: MessageSquare},
  {id: 'knowledge', label: 'Knowledge', icon: BookOpen},
  {id: 'teach', label: 'Teach', icon: PlusCircle},
  {id: 'github', label: 'GitHub', icon: GitBranch},
  {id: 'settings', label: 'Settings', icon: Settings},
];

export function TopBar({
  activeArea,
  onSelectArea,
  statusLabel,
  knowledgeCount,
  repoFileCount,
  readinessScore,
  isSyncing,
  onSync,
}: TopBarProps) {
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-[#0B1120]">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:gap-8">
          {/* Zone 1: Single text element wordmark */}
          <button
            type="button"
            onClick={() => onSelectArea('chat')}
            className="shrink-0 whitespace-nowrap text-left text-lg font-bold tracking-tight text-slate-100 transition-colors hover:text-emerald-400 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-400"
          >
            Mantis
          </button>

          {/* Zone 2: 5 concise single-line text navigation links */}
          <nav
            aria-label="Primary navigation"
            className="hidden items-center gap-6 md:flex"
          >
            {NAV_ITEMS.map((item) => {
              const isActive = activeArea === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectArea(item.id)}
                  className={`relative shrink-0 whitespace-nowrap py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-400 ${
                    isActive
                      ? 'text-slate-100 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-emerald-500'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Quiet unboxed status + 1 primary action */}
          <div className="flex shrink-0 items-center gap-4">
            <div className="hidden items-center gap-2 font-mono text-xs text-slate-400 sm:flex">
              <span className="text-slate-200">{statusLabel}</span>
              <span aria-hidden="true">/</span>
              <span className="tabular-nums">{knowledgeCount} notes</span>
              {repoFileCount > 0 && (
                <>
                  <span aria-hidden="true">/</span>
                  <span className="tabular-nums">{repoFileCount} files</span>
                </>
              )}
              <span aria-hidden="true">/</span>
              <span className="tabular-nums">Score {readinessScore}</span>
            </div>

            <button
              type="button"
              onClick={onSync}
              disabled={isSyncing}
              className="inline-flex min-h-[40px] shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-100 transition-colors hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing' : 'Sync'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Tablet / mobile navigation bar with >= 44px touch targets */}
      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-800 bg-[#0B1120] md:hidden"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeArea === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectArea(item.id)}
              className={`flex min-h-[52px] flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-medium transition-colors ${
                isActive ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
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
