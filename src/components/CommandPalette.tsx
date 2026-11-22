import {
  BookOpen,
  Compass,
  Crosshair,
  Download,
  FileCode2,
  FlaskConical,
  GitBranch,
  Palette,
  PanelRight,
  PlusCircle,
  Radio,
  RefreshCw,
  Search,
  Settings,
  Terminal,
  X,
} from 'lucide-react';
import {useEffect, useMemo, useRef, useState} from 'react';
import type {
  AreaId,
  KnowledgeEntry,
  KnowledgeFolder,
  RepoFile,
  ThemeMode,
} from '../types/mantis';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  entries: KnowledgeEntry[];
  folders: KnowledgeFolder[];
  repoFiles: RepoFile[];
  onNavigateArea: (area: AreaId) => void;
  onOpenGraph: () => void;
  onPrefillExecute: () => void;
  onOpenTeach: () => void;
  onSync: () => void;
  onSelectTheme: (theme: ThemeMode) => void;
  onToggleInspector: () => void;
  onInspectKnowledge: (entry: KnowledgeEntry) => void;
  onInspectRepoFile: (filePath: string) => void;
}

interface PaletteCommandItem {
  id: string;
  group: string;
  label: string;
  subtitle?: string;
  icon: typeof Terminal;
  run: () => void;
}

export function CommandPalette({
  isOpen,
  onClose,
  entries,
  folders,
  repoFiles,
  onNavigateArea,
  onOpenGraph,
  onPrefillExecute,
  onOpenTeach,
  onSync,
  onSelectTheme,
  onToggleInspector,
  onInspectKnowledge,
  onInspectRepoFile,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setActiveIndex(0);
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 20);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  const folderMap = useMemo(
    () => new Map(folders.map((f) => [f.id, f.name])),
    [folders],
  );

  const items = useMemo<PaletteCommandItem[]>(() => {
    const baseActions: PaletteCommandItem[] = [
      {
        id: 'nav-studio',
        group: 'Navigate',
        label: 'Train & Chat Workbench',
        subtitle: 'Student stream, teacher distillation, and parallel patch composer',
        icon: Terminal,
        run: () => onNavigateArea('studio'),
      },
      {
        id: 'nav-graph',
        group: 'Navigate',
        label: 'Concept Graph',
        subtitle: 'Interactive memory folders and repository graph',
        icon: Compass,
        run: onOpenGraph,
      },
      {
        id: 'nav-knowledge',
        group: 'Navigate',
        label: 'Memory & Data · Memories',
        subtitle: `${entries.length} stored entries`,
        icon: BookOpen,
        run: () => onNavigateArea('knowledge'),
      },
      {
        id: 'nav-ingest',
        group: 'Navigate',
        label: 'Memory & Data · Capture',
        subtitle: 'URL extraction, multi-speaker mic, OCR',
        icon: Radio,
        run: () => onNavigateArea('ingest'),
      },
      {
        id: 'nav-github',
        group: 'Navigate',
        label: 'Memory & Data · Code & Diffs',
        subtitle: `${repoFiles.length} synced repository files`,
        icon: GitBranch,
        run: () => onNavigateArea('github'),
      },
      {
        id: 'nav-training',
        group: 'Navigate',
        label: 'Eval & Export · Training & Evals',
        subtitle: 'Preference pairs, curriculum drills, eval suite, RAM profiler',
        icon: FlaskConical,
        run: () => onNavigateArea('training'),
      },
      {
        id: 'nav-export',
        group: 'Navigate',
        label: 'Eval & Export · Model Export',
        subtitle: 'Model naming, bundle verifier, HTML runtime & Colab QLoRA',
        icon: Download,
        run: () => onNavigateArea('export'),
      },
      {
        id: 'nav-settings',
        group: 'Navigate',
        label: 'Settings & Diagnostics',
        subtitle: 'Routes, themes, SQL migrations, offline sync queue',
        icon: Settings,
        run: () => onNavigateArea('settings'),
      },
      {
        id: 'act-execute',
        group: 'Actions',
        label: 'Parallel Patch Prep (/execute)',
        subtitle: 'Prefill parallel memory + repo diff brief',
        icon: Crosshair,
        run: onPrefillExecute,
      },
      {
        id: 'act-teach',
        group: 'Actions',
        label: 'Teach New Knowledge Rule',
        subtitle: 'Add rule, pattern, or Auto-Folder entry (Alt+N)',
        icon: PlusCircle,
        run: onOpenTeach,
      },
      {
        id: 'act-sync',
        group: 'Actions',
        label: 'Sync Cloud Memory',
        subtitle: 'Pull latest Supabase entries and flush offline queue',
        icon: RefreshCw,
        run: onSync,
      },
      {
        id: 'act-inspector',
        group: 'Workspace',
        label: 'Toggle Workspace Inspector Drawer',
        subtitle: 'Runtime stats, folders, concepts, session feed (Ctrl+I)',
        icon: PanelRight,
        run: onToggleInspector,
      },
      {
        id: 'theme-dark',
        group: 'Theme',
        label: 'Switch Theme to Obsidian Dark',
        subtitle: 'Anthropic Workbench monochrome contrast',
        icon: Palette,
        run: () => onSelectTheme('dark'),
      },
      {
        id: 'theme-dim',
        group: 'Theme',
        label: 'Switch Theme to Dim Slate',
        subtitle: 'Soft low-glare neutral charcoal',
        icon: Palette,
        run: () => onSelectTheme('dim'),
      },
      {
        id: 'theme-light',
        group: 'Theme',
        label: 'Switch Theme to Paper Light',
        subtitle: 'High-legibility daylight canvas',
        icon: Palette,
        run: () => onSelectTheme('light'),
      },
    ];

    const knowledgeItems: PaletteCommandItem[] = entries.slice(0, 60).map((entry) => ({
      id: `know-${entry.id}`,
      group: 'Memories',
      label: entry.title,
      subtitle: `${folderMap.get(entry.folder_id || '') || 'General'} · ${entry.status || 'reviewed'}`,
      icon: BookOpen,
      run: () => onInspectKnowledge(entry),
    }));

    const fileItems: PaletteCommandItem[] = repoFiles.slice(0, 40).map((file) => ({
      id: `repo-${file.id}`,
      group: 'Repo Files',
      label: file.path,
      subtitle: 'Inspect file in Code & Diffs',
      icon: FileCode2,
      run: () => onInspectRepoFile(file.path),
    }));

    const all = [...baseActions, ...knowledgeItems, ...fileItems];
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 14);

    return all
      .filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          (item.subtitle || '').toLowerCase().includes(q) ||
          item.group.toLowerCase().includes(q),
      )
      .slice(0, 16);
  }, [
    entries,
    repoFiles,
    folderMap,
    query,
    onNavigateArea,
    onOpenGraph,
    onPrefillExecute,
    onOpenTeach,
    onSync,
    onToggleInspector,
    onSelectTheme,
    onInspectKnowledge,
    onInspectRepoFile,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((idx) => (items.length === 0 ? 0 : (idx + 1) % items.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((idx) =>
          items.length === 0 ? 0 : (idx - 1 + items.length) % items.length,
        );
      } else if (e.key === 'Enter' && items[activeIndex]) {
        e.preventDefault();
        items[activeIndex].run();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, items, activeIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Mantis Command Palette"
      className="mantis-fade-in fixed inset-0 z-50 flex items-start justify-center bg-slate-950/70 p-4 pt-16 backdrop-blur-xs sm:pt-24"
      onClick={onClose}
    >
      <div
        className="mantis-modal-in w-full max-w-xl overflow-hidden rounded-xl border border-line-strong bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-accent-text" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder="Search commands, memories, repo files, or themes…"
            className="min-h-[40px] flex-1 bg-transparent text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close command palette"
            className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-md text-ink-muted hover:bg-elevated hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-ink-muted">
              No matching commands, memories, or repository files.
            </div>
          ) : (
            <div className="space-y-0.5">
              {items.map((item, index) => {
                const Icon = item.icon;
                const isSelected = index === activeIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => {
                      item.run();
                      onClose();
                    }}
                    className={`flex min-h-[44px] w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                      isSelected
                        ? 'bg-accent-soft text-ink'
                        : 'text-ink-muted hover:bg-elevated/60 hover:text-ink'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          isSelected ? 'text-accent-text' : 'text-ink-subtle'
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-ink">
                          {item.label}
                        </div>
                        {item.subtitle && (
                          <div className="truncate text-[11px] text-ink-muted">
                            {item.subtitle}
                          </div>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] tracking-wide text-ink-subtle uppercase">
                      {item.group}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-inset px-4 py-2 font-mono text-[11px] text-ink-subtle">
          <span>↑↓ navigate · Enter select · Esc close</span>
          <span>Ctrl+K · Ctrl+I · Alt+N</span>
        </div>
      </div>
    </div>
  );
}
