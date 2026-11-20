import {FileCode2, Folder, GitBranch, Hash, PlusCircle} from 'lucide-react';
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
  onOpenGitHub: () => void;
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
  onOpenGitHub,
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
      className="flex h-full flex-col gap-5 rounded-lg border border-slate-800 bg-[#0F172A] p-3.5"
    >
      {/* Explorer Header + Quick Teach */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <span className="text-xs font-semibold tracking-wide text-slate-300 uppercase">
          Explorer
        </span>
        <button
          type="button"
          onClick={onOpenTeach}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-emerald-500"
        >
          <PlusCircle className="h-3.5 w-3.5" />
          <span>Teach Rule</span>
        </button>
      </div>

      {/* Knowledge Folders */}
      <section className="space-y-1.5">
        <div className="flex items-center justify-between px-1 text-[11px] font-medium text-slate-400">
          <span>Knowledge Folders</span>
          <span className="font-mono tabular-nums">{entries.length}</span>
        </div>
        <div className="space-y-0.5">
          {folders.map((folder) => {
            const count = folderCounts.get(folder.id) || 0;
            return (
              <button
                key={folder.id}
                type="button"
                onClick={() => onSelectFolder(folder.id)}
                className="flex min-h-[38px] w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-300 transition-colors hover:bg-slate-800/70 hover:text-slate-100"
              >
                <span className="flex items-center gap-2 truncate">
                  <Folder className="h-3.5 w-3.5 shrink-0 text-emerald-400/80" />
                  <span className="truncate">{folder.name}</span>
                </span>
                <span className="font-mono text-[11px] tabular-nums text-slate-400">{count}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Concept Index */}
      <section className="space-y-2 border-t border-slate-800 pt-3.5">
        <div className="flex items-center justify-between px-1 text-[11px] font-medium text-slate-400">
          <span>Indexed Concepts</span>
          <span className="font-mono tabular-nums">{growth.uniqueConcepts}</span>
        </div>
        {growth.topConcepts.length === 0 ? (
          <p className="px-1 text-xs leading-relaxed text-slate-500">
            Concepts appear here automatically as Mantis mines rules and ingests links.
          </p>
        ) : (
          <div className="space-y-0.5">
            {growth.topConcepts.slice(0, 8).map((concept) => (
              <button
                key={concept.label}
                type="button"
                onClick={() => onQueryConcept(concept.label)}
                className="flex min-h-[34px] w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left font-mono text-xs text-slate-300 transition-colors hover:bg-slate-800/70 hover:text-emerald-300"
              >
                <span className="flex items-center gap-1.5 truncate">
                  <Hash className="h-3 w-3 shrink-0 text-slate-500" />
                  <span className="truncate">{concept.label}</span>
                </span>
                <span className="text-[11px] tabular-nums text-slate-500">{concept.count}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Connected GitHub Repo Quick Tree */}
      <section className="space-y-2 border-t border-slate-800 pt-3.5">
        <div className="flex items-center justify-between px-1 text-[11px] font-medium text-slate-400">
          <span className="flex items-center gap-1.5">
            <GitBranch className="h-3.5 w-3.5 text-slate-400" />
            <span>Repository</span>
          </span>
          <span className="font-mono tabular-nums">{repoFiles.length}</span>
        </div>

        {connection && repoFiles.length > 0 ? (
          <div className="space-y-1">
            <div className="truncate px-1 font-mono text-[11px] text-emerald-400">
              {connection.owner}/{connection.repo}
            </div>
            <div className="max-h-44 space-y-0.5 overflow-y-auto pr-1">
              {repoFiles.slice(0, 14).map((file) => (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => onInspectRepoFile(file.path)}
                  className="flex min-h-[34px] w-full items-center gap-1.5 rounded-md px-2 py-1 text-left font-mono text-[11px] text-slate-300 transition-colors hover:bg-slate-800/70 hover:text-sky-300"
                >
                  <FileCode2 className="h-3 w-3 shrink-0 text-slate-500" />
                  <span className="truncate">{file.path}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenGitHub}
            className="flex min-h-[38px] w-full items-center justify-center rounded-md border border-slate-800 bg-[#0B1120] px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-700 hover:text-slate-100"
          >
            Connect GitHub Repo
          </button>
        )}
      </section>
    </aside>
  );
}
