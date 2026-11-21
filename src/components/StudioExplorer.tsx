import {
  FileCode2,
  Folder,
  GitBranch,
  Hash,
  PanelLeftClose,
  PlusCircle,
  Radio,
} from 'lucide-react';
import {useMemo} from 'react';
import type {
  GitHubConnection,
  KnowledgeEntry,
  KnowledgeFolder,
  KnowledgeGrowthStats,
  RepoFile,
} from '../types/mantis';

interface StudioExplorerProps {
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
  growth: KnowledgeGrowthStats;
  connection: GitHubConnection | null;
  repoFiles: RepoFile[];
  onSelectFolder: (folderId: string) => void;
  onQueryConcept: (conceptLabel: string) => void;
  onInspectRepoFile: (filePath: string) => void;
  onOpenTeach: () => void;
  onOpenCapture: () => void;
  onOpenGitHub: () => void;
  onCollapse?: () => void;
}

export function StudioExplorer({
  folders,
  entries,
  growth,
  connection,
  repoFiles,
  onSelectFolder,
  onQueryConcept,
  onInspectRepoFile,
  onOpenTeach,
  onOpenCapture,
  onOpenGitHub,
  onCollapse,
}: StudioExplorerProps) {
  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) {
      if (e.folder_id) {
        counts.set(e.folder_id, (counts.get(e.folder_id) || 0) + 1);
      }
    }
    return counts;
  }, [entries]);

  return (
    <aside
      aria-label="Workspace Explorer"
      className="flex h-full flex-col gap-4 rounded-lg border border-line bg-surface p-3.5"
    >
      {/* Explorer Header + Collapse + Quick Teach */}
      <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
        <div className="flex items-center gap-1.5">
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              title="Collapse Explorer (Ctrl+B)"
              aria-label="Collapse Explorer pane"
              className="hidden min-h-[36px] min-w-[36px] items-center justify-center rounded-md text-ink-muted hover:bg-elevated hover:text-ink xl:inline-flex"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}
          <span className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
            Explorer
          </span>
        </div>
        <button
          type="button"
          onClick={onOpenTeach}
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          <PlusCircle className="h-3.5 w-3.5" />
          <span>Teach Rule</span>
        </button>
      </div>

      {/* Knowledge Folders */}
      <section className="space-y-1.5">
        <div className="flex items-center justify-between px-1 text-[11px] font-medium text-ink-muted">
          <span>Knowledge Folders</span>
          <span className="font-mono tabular-nums">{entries.length}</span>
        </div>
        <div className="max-h-52 space-y-0.5 overflow-y-auto pr-0.5">
          {folders.map((folder) => {
            const count = folderCounts.get(folder.id) || 0;
            return (
              <button
                key={folder.id}
                type="button"
                onClick={() => onSelectFolder(folder.id)}
                className="flex min-h-[38px] w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-ink-muted transition-colors hover:bg-elevated/70 hover:text-ink"
              >
                <span className="flex items-center gap-2 truncate">
                  <Folder className="h-3.5 w-3.5 shrink-0 text-accent-text" />
                  <span className="truncate">{folder.name}</span>
                </span>
                <span className="font-mono text-[11px] tabular-nums text-ink-subtle">{count}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Concept Index */}
      <section className="space-y-2 border-t border-line pt-3">
        <div className="flex items-center justify-between px-1 text-[11px] font-medium text-ink-muted">
          <span>Indexed Concepts</span>
          <span className="font-mono tabular-nums">{growth.uniqueConcepts}</span>
        </div>
        {growth.topConcepts.length === 0 ? (
          <p className="px-1 text-xs leading-relaxed text-ink-subtle">
            Concepts appear automatically as Mantis stores rules and ingests links.
          </p>
        ) : (
          <div className="space-y-0.5">
            {growth.topConcepts.slice(0, 7).map((concept) => (
              <button
                key={concept.label}
                type="button"
                onClick={() => onQueryConcept(concept.label)}
                className="flex min-h-[36px] w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left font-mono text-xs text-ink-muted transition-colors hover:bg-elevated/70 hover:text-accent-text"
              >
                <span className="flex items-center gap-1.5 truncate">
                  <Hash className="h-3 w-3 shrink-0 text-ink-subtle" />
                  <span className="truncate">{concept.label}</span>
                </span>
                <span className="text-[11px] tabular-nums text-ink-subtle">{concept.count}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Connected GitHub Repo Quick Tree */}
      <section className="space-y-2 border-t border-line pt-3">
        <div className="flex items-center justify-between px-1 text-[11px] font-medium text-ink-muted">
          <span className="flex items-center gap-1.5">
            <GitBranch className="h-3.5 w-3.5 text-ink-subtle" />
            <span>Repository</span>
          </span>
          <span className="font-mono tabular-nums">{repoFiles.length}</span>
        </div>

        {connection && repoFiles.length > 0 ? (
          <div className="space-y-1">
            <div className="truncate px-1 font-mono text-[11px] text-accent-text">
              {connection.owner}/{connection.repo}
            </div>
            <div className="max-h-40 space-y-0.5 overflow-y-auto pr-1">
              {repoFiles.slice(0, 14).map((file) => (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => onInspectRepoFile(file.path)}
                  className="flex min-h-[34px] w-full items-center gap-1.5 rounded-md px-2 py-1 text-left font-mono text-[11px] text-ink-muted transition-colors hover:bg-elevated/70 hover:text-ink"
                >
                  <FileCode2 className="h-3 w-3 shrink-0 text-ink-subtle" />
                  <span className="truncate">{file.path}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenGitHub}
            className="flex min-h-[40px] w-full items-center justify-center rounded-md border border-line bg-inset px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            Connect GitHub Repo
          </button>
        )}
      </section>

      {/* Capture Source Shortcuts */}
      <section className="mt-auto border-t border-line pt-3">
        <button
          type="button"
          onClick={onOpenCapture}
          className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-md border border-line bg-inset px-3 py-2 text-xs font-medium text-ink-muted transition-colors hover:border-accent-border hover:text-ink"
        >
          <Radio className="h-3.5 w-3.5 text-accent-text" />
          <span>Capture URL / Voice / OCR</span>
        </button>
      </section>
    </aside>
  );
}
