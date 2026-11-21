import {
  BookOpen,
  Download,
  FlaskConical,
  GitBranch,
  Radio,
  Settings,
  Terminal,
} from 'lucide-react';
import type {AreaId} from '../types/mantis';

interface ActivityRailProps {
  activeArea: AreaId;
  onSelectArea: (area: AreaId) => void;
  pendingSuggestionsCount: number;
}

const RAIL_ITEMS: Array<{id: AreaId; label: string; icon: typeof Terminal}> = [
  {id: 'studio', label: 'Workbench', icon: Terminal},
  {id: 'knowledge', label: 'Memory', icon: BookOpen},
  {id: 'ingest', label: 'Capture', icon: Radio},
  {id: 'github', label: 'Code', icon: GitBranch},
  {id: 'training', label: 'Training', icon: FlaskConical},
  {id: 'export', label: 'Export', icon: Download},
];

export function ActivityRail({
  activeArea,
  onSelectArea,
  pendingSuggestionsCount,
}: ActivityRailProps) {
  return (
    <>
      {/* VS Code-style Vertical Activity Rail (md and above) */}
      <aside
        aria-label="Primary workspace rail"
        className="hidden w-12 shrink-0 flex-col items-center justify-between border-r border-line bg-inset py-2 md:flex"
      >
        <div className="flex w-full flex-col items-center gap-1">
          {RAIL_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeArea === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectArea(item.id)}
                title={item.label}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex h-11 w-full items-center justify-center transition-colors ${
                  isActive
                    ? 'text-ink before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:bg-accent'
                    : 'text-ink-subtle hover:text-ink-muted'
                }`}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                {item.id === 'github' && pendingSuggestionsCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 rounded bg-accent px-1 font-mono text-[9px] font-semibold tabular-nums text-white">
                    {pendingSuggestionsCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => onSelectArea('settings')}
          title="Settings"
          aria-label="Settings"
          aria-current={activeArea === 'settings' ? 'page' : undefined}
          className={`relative flex h-11 w-full items-center justify-center transition-colors ${
            activeArea === 'settings'
              ? 'text-ink before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:bg-accent'
              : 'text-ink-subtle hover:text-ink-muted'
          }`}
        >
          <Settings className="h-[18px] w-[18px] shrink-0" />
        </button>
      </aside>

      {/* Mobile / Phone Bottom Thumb Dock (<= 15% viewport cap, >= 48px touch targets) */}
      <nav
        aria-label="Mobile workspace navigation"
        className="fixed inset-x-0 bottom-0 z-30 flex min-h-[52px] items-center justify-around border-t border-line bg-canvas/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-xs md:hidden"
      >
        {[...RAIL_ITEMS, {id: 'settings' as AreaId, label: 'Config', icon: Settings}].map((item) => {
          const Icon = item.icon;
          const isActive = activeArea === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectArea(item.id)}
              aria-label={item.label}
              className={`relative flex min-h-[48px] min-w-[44px] flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-[10px] font-medium transition-colors ${
                isActive ? 'text-accent-text' : 'text-ink-muted hover:text-ink'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="max-w-[52px] truncate whitespace-nowrap">{item.label}</span>
              {item.id === 'github' && pendingSuggestionsCount > 0 && (
                <span className="absolute top-1 right-1.5 rounded bg-accent px-1 font-mono text-[9px] font-semibold tabular-nums text-white">
                  {pendingSuggestionsCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </>
  );
}
