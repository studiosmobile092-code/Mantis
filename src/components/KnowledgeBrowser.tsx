import {
  BookOpen,
  Check,
  CheckSquare,
  Edit3,
  ExternalLink,
  Folder,
  FolderPlus,
  PlusCircle,
  Search,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {type FormEvent, memo, useEffect, useMemo, useState} from 'react';
import {getEntryStatus} from '../lib/knowledgeSync';
import {parseTagsInput} from '../lib/memory';
import type {
  KnowledgeEntry,
  KnowledgeFolder,
  KnowledgeStatus,
  SaveFeedbackInfo,
} from '../types/mantis';

interface KnowledgeBrowserProps {
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
  isLoading: boolean;
  highlightedEntryId: string | null;
  initialFolderId?: string;
  saveFeedback?: SaveFeedbackInfo;
  onClearHighlight: () => void;
  onCreateFolder: (name: string, description: string) => Promise<KnowledgeFolder | null>;
  onDeleteFolder: (folderId: string) => Promise<boolean>;
  onUpdateEntry: (
    id: string,
    payload: {
      title: string;
      content: string;
      folderId: string | null;
      tags: string[];
      status?: KnowledgeStatus;
    },
  ) => Promise<boolean>;
  onUpdateEntryStatus: (id: string, status: KnowledgeStatus) => Promise<boolean>;
  onDeleteEntry: (id: string) => Promise<boolean>;
  onOpenTeach: () => void;
}

export const KnowledgeBrowser = memo(function KnowledgeBrowser({
  folders,
  entries,
  isLoading,
  highlightedEntryId,
  initialFolderId,
  saveFeedback,
  onClearHighlight,
  onCreateFolder,
  onDeleteFolder,
  onUpdateEntry,
  onUpdateEntryStatus,
  onDeleteEntry,
  onOpenTeach,
}: KnowledgeBrowserProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string>(initialFolderId || 'all');
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | KnowledgeStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewFolderForm, setShowNewFolderForm] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderDesc, setNewFolderDesc] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [confirmDeleteFolderId, setConfirmDeleteFolderId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editFolderId, setEditFolderId] = useState<string>('');
  const [editTagsRaw, setEditTagsRaw] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editStatus, setEditStatus] = useState<KnowledgeStatus>('reviewed');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);

  // Bulk select & action state
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [bulkTargetFolderId, setBulkTargetFolderId] = useState<string>(folders[0]?.id || '');
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [isBulkBusy, setIsBulkBusy] = useState(false);

  useEffect(() => {
    if (initialFolderId) {
      setSelectedFolderId(initialFolderId);
    }
  }, [initialFolderId]);

  useEffect(() => {
    if (highlightedEntryId) {
      setSelectedFolderId('all');
      setSelectedTag('all');
      setSearchQuery('');
    }
  }, [highlightedEntryId]);

  useEffect(() => {
    if (!bulkTargetFolderId && folders[0]?.id) {
      setBulkTargetFolderId(folders[0].id);
    }
  }, [folders, bulkTargetFolderId]);

  const folderMap = useMemo(
    () => new Map<string, KnowledgeFolder>(folders.map((f) => [f.id, f])),
    [folders],
  );

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let uncategorized = 0;
    for (const entry of entries) {
      if (entry.folder_id && folderMap.has(entry.folder_id)) {
        counts.set(entry.folder_id, (counts.get(entry.folder_id) || 0) + 1);
      } else {
        uncategorized += 1;
      }
    }
    return {counts, uncategorized};
  }, [entries, folderMap]);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const entry of entries) {
      for (const tag of entry.tags) {
        tagSet.add(tag);
      }
    }
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
  }, [entries]);

  const statusCounts = useMemo(() => {
    let trusted = 0;
    let reviewed = 0;
    let raw = 0;
    for (const entry of entries) {
      const s = getEntryStatus(entry);
      if (s === 'trusted') trusted += 1;
      else if (s === 'raw') raw += 1;
      else reviewed += 1;
    }
    return {trusted, reviewed, raw};
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return entries.filter((entry) => {
      if (selectedFolderId === 'uncategorized') {
        if (entry.folder_id && folderMap.has(entry.folder_id)) return false;
      } else if (selectedFolderId !== 'all') {
        if (entry.folder_id !== selectedFolderId) return false;
      }
      if (selectedTag !== 'all' && !entry.tags.includes(selectedTag)) {
        return false;
      }
      if (statusFilter !== 'all' && getEntryStatus(entry) !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        entry.title.toLowerCase().includes(q) ||
        entry.content.toLowerCase().includes(q) ||
        entry.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [entries, selectedFolderId, selectedTag, statusFilter, searchQuery, folderMap]);

  const selectedEntryIds = useMemo(
    () =>
      filteredEntries
        .filter((e) => selectedIds[e.id])
        .map((e) => e.id),
    [filteredEntries, selectedIds],
  );

  function toggleSelectEntry(id: string) {
    setSelectedIds((prev) => ({...prev, [id]: !prev[id]}));
    setConfirmBulkDelete(false);
  }

  function clearBulkSelection() {
    setSelectedIds({});
    setConfirmBulkDelete(false);
    setBulkMode(false);
  }

  async function handleBulkMarkTrusted() {
    if (selectedEntryIds.length === 0) return;
    setIsBulkBusy(true);
    try {
      for (const id of selectedEntryIds) {
        await onUpdateEntryStatus(id, 'trusted');
      }
      setSelectedIds({});
    } finally {
      setIsBulkBusy(false);
    }
  }

  async function handleBulkMoveFolder() {
    if (selectedEntryIds.length === 0) return;
    setIsBulkBusy(true);
    try {
      for (const id of selectedEntryIds) {
        const entry = entries.find((e) => e.id === id);
        if (!entry) continue;
        await onUpdateEntry(id, {
          title: entry.title,
          content: entry.content,
          folderId: bulkTargetFolderId || null,
          tags: entry.tags,
          status: getEntryStatus(entry),
        });
      }
      setSelectedIds({});
    } finally {
      setIsBulkBusy(false);
    }
  }

  async function handleBulkDelete() {
    if (selectedEntryIds.length === 0) return;
    setIsBulkBusy(true);
    try {
      for (const id of selectedEntryIds) {
        await onDeleteEntry(id);
      }
      clearBulkSelection();
    } finally {
      setIsBulkBusy(false);
    }
  }

  async function handleCreateFolder(event: FormEvent) {
    event.preventDefault();
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    setIsCreatingFolder(true);
    try {
      const created = await onCreateFolder(trimmed, newFolderDesc.trim());
      if (created) {
        setSelectedFolderId(created.id);
        setNewFolderName('');
        setNewFolderDesc('');
        setShowNewFolderForm(false);
      }
    } finally {
      setIsCreatingFolder(false);
    }
  }

  function startEdit(entry: KnowledgeEntry) {
    setEditingId(entry.id);
    setEditTitle(entry.title);
    setEditFolderId(entry.folder_id || '');
    setEditTagsRaw(entry.tags.join(', '));
    setEditContent(entry.content);
    setEditStatus(getEntryStatus(entry));
    setConfirmDeleteId(null);
  }

  async function saveEdit(id: string) {
    if (!editTitle.trim() || !editContent.trim()) return;
    setIsSavingEdit(true);
    try {
      const ok = await onUpdateEntry(id, {
        title: editTitle.trim(),
        content: editContent.trim(),
        folderId: editFolderId || null,
        tags: parseTagsInput(editTagsRaw),
        status: editStatus,
      });
      if (ok) {
        setEditingId(null);
      }
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function confirmDelete(id: string) {
    setIsDeletingId(id);
    try {
      const ok = await onDeleteEntry(id);
      if (ok) {
        setConfirmDeleteId(null);
        if (highlightedEntryId === id) {
          onClearHighlight();
        }
      }
    } finally {
      setIsDeletingId(null);
    }
  }

  return (
    <div className="mantis-fade-in space-y-6">
      <div className="flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Knowledge Browser</h1>
          <p className="text-sm text-ink-muted">
            Organized semantic folders and persistent memory stored in Supabase.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (bulkMode) {
                clearBulkSelection();
              } else {
                setBulkMode(true);
              }
            }}
            className={`inline-flex min-h-[44px] items-center gap-2 rounded-md border px-3.5 py-2 text-xs font-medium transition-colors ${
              bulkMode
                ? 'border-accent-border bg-accent-soft text-accent-text'
                : 'border-line-strong bg-surface text-ink hover:bg-elevated'
            }`}
          >
            <CheckSquare className="h-4 w-4" />
            <span>{bulkMode ? 'Exit Select' : 'Bulk Select'}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowNewFolderForm((v) => !v)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-line-strong bg-surface px-3.5 py-2 text-xs font-medium text-ink hover:bg-elevated"
          >
            <FolderPlus className="h-4 w-4" />
            <span>{showNewFolderForm ? 'Close Folder Form' : 'New Folder'}</span>
          </button>
          <button
            type="button"
            onClick={onOpenTeach}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-xs font-semibold text-white hover:bg-accent-hover"
          >
            <PlusCircle className="h-4 w-4" />
            <span>Teach Entry</span>
          </button>
        </div>
      </div>

      {showNewFolderForm && (
        <form
          onSubmit={handleCreateFolder}
          className="mantis-slide-up grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-[1fr_1fr_auto]"
        >
          <input
            type="text"
            required
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Folder name (e.g. Food, Greetings, React Native)"
            className="min-h-[44px] rounded-md border border-line-strong bg-inset px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
          />
          <input
            type="text"
            value={newFolderDesc}
            onChange={(e) => setNewFolderDesc(e.target.value)}
            placeholder="Short description (optional)"
            className="min-h-[44px] rounded-md border border-line-strong bg-inset px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={isCreatingFolder || !newFolderName.trim()}
            className="min-h-[44px] rounded-md bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {isCreatingFolder ? 'Creating…' : 'Create Folder'}
          </button>
        </form>
      )}

      {/* Bulk Action Toolbar */}
      {bulkMode && (
        <div className="mantis-slide-up flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent-border bg-surface p-3.5">
          <div className="flex items-center gap-3 text-xs">
            <span className="font-mono font-semibold tabular-nums text-accent-text">
              {selectedEntryIds.length} selected
            </span>
            <button
              type="button"
              onClick={() => {
                const next: Record<string, boolean> = {};
                const allSelected =
                  filteredEntries.length > 0 &&
                  selectedEntryIds.length === filteredEntries.length;
                if (!allSelected) {
                  for (const e of filteredEntries) next[e.id] = true;
                }
                setSelectedIds(next);
              }}
              className="text-xs font-medium text-ink-muted underline underline-offset-2 hover:text-ink"
            >
              {selectedEntryIds.length === filteredEntries.length && filteredEntries.length > 0
                ? 'Unselect All'
                : `Select All (${filteredEntries.length})`}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isBulkBusy || selectedEntryIds.length === 0}
              onClick={() => void handleBulkMarkTrusted()}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent-text disabled:opacity-50"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Mark Trusted</span>
            </button>

            <div className="flex items-center gap-1.5">
              <select
                aria-label="Move selected entries to folder"
                value={bulkTargetFolderId}
                onChange={(e) => setBulkTargetFolderId(e.target.value)}
                className="min-h-[40px] rounded-md border border-line-strong bg-inset px-2.5 py-1.5 text-xs text-ink focus:border-accent focus:outline-none"
              >
                <option value="">Uncategorized</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={isBulkBusy || selectedEntryIds.length === 0}
                onClick={() => void handleBulkMoveFolder()}
                className="min-h-[40px] rounded-md border border-line-strong bg-inset px-3 py-1.5 text-xs font-medium text-ink hover:bg-elevated disabled:opacity-50"
              >
                Move
              </button>
            </div>

            {confirmBulkDelete ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={isBulkBusy}
                  onClick={() => void handleBulkDelete()}
                  className="min-h-[40px] rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                >
                  Confirm Delete ({selectedEntryIds.length})
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmBulkDelete(false)}
                  className="min-h-[40px] rounded-md border border-line-strong px-2.5 py-1.5 text-xs text-ink-muted hover:bg-elevated"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={isBulkBusy || selectedEntryIds.length === 0}
                onClick={() => setConfirmBulkDelete(true)}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-line-strong bg-inset px-3 py-1.5 text-xs font-medium text-ink-muted hover:border-red-500/40 hover:text-red-400 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Delete Selected</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        {/* Folders Column */}
        <aside className="space-y-1.5">
          <h2 className="px-2 pb-1 text-xs font-semibold text-ink-muted">Folders</h2>

          <button
            type="button"
            onClick={() => {
              setSelectedFolderId('all');
              onClearHighlight();
            }}
            className={`flex min-h-[44px] w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
              selectedFolderId === 'all'
                ? 'bg-elevated font-medium text-ink'
                : 'text-ink-muted hover:bg-surface hover:text-ink'
            }`}
          >
            <span className="flex items-center gap-2.5 truncate">
              <BookOpen className="h-4 w-4 shrink-0 text-ink-subtle" />
              <span className="truncate">All Entries</span>
            </span>
            <span className="font-mono text-xs tabular-nums text-ink-subtle">{entries.length}</span>
          </button>

          {folders.map((folder) => {
            const count = folderCounts.counts.get(folder.id) || 0;
            const isSelected = selectedFolderId === folder.id;
            return (
              <div key={folder.id} className="space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFolderId(folder.id);
                    setConfirmDeleteFolderId(null);
                    onClearHighlight();
                  }}
                  className={`flex min-h-[44px] w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    isSelected
                      ? 'bg-elevated font-medium text-ink'
                      : 'text-ink-muted hover:bg-surface hover:text-ink'
                  }`}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Folder className="h-4 w-4 shrink-0 text-accent-text" />
                    <span className="truncate">{folder.name}</span>
                  </span>
                  <span className="font-mono text-xs tabular-nums text-ink-subtle">{count}</span>
                </button>

                {isSelected && folders.length > 1 && (
                  <div className="px-2 pb-1">
                    {confirmDeleteFolderId === folder.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={async () => {
                            const ok = await onDeleteFolder(folder.id);
                            if (ok) {
                              setConfirmDeleteFolderId(null);
                              setSelectedFolderId('all');
                            }
                          }}
                          className="min-h-[36px] rounded bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-500"
                        >
                          Remove Folder
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteFolderId(null)}
                          className="min-h-[36px] rounded border border-line-strong px-2 py-1 text-[11px] text-ink-muted hover:bg-elevated"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteFolderId(folder.id)}
                        className="text-[11px] text-ink-subtle hover:text-red-400"
                      >
                        Remove folder (keeps notes)
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {folderCounts.uncategorized > 0 && (
            <button
              type="button"
              onClick={() => {
                setSelectedFolderId('uncategorized');
                onClearHighlight();
              }}
              className={`flex min-h-[44px] w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                selectedFolderId === 'uncategorized'
                  ? 'bg-elevated font-medium text-ink'
                  : 'text-ink-muted hover:bg-surface hover:text-ink'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Folder className="h-4 w-4 shrink-0 text-ink-subtle" />
                <span className="truncate">Uncategorized</span>
              </span>
              <span className="font-mono text-xs tabular-nums text-ink-subtle">
                {folderCounts.uncategorized}
              </span>
            </button>
          )}
        </aside>

        {/* Entries List Column */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1 rounded-md border border-line bg-surface p-1">
              {(
                [
                  {id: 'all', label: `All (${entries.length})`},
                  {id: 'trusted', label: `Trusted (${statusCounts.trusted})`},
                  {id: 'reviewed', label: `Reviewed (${statusCounts.reviewed})`},
                  {id: 'raw', label: `Raw (${statusCounts.raw})`},
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`min-h-[38px] rounded px-3 text-xs font-medium tabular-nums transition-colors ${
                    statusFilter === tab.id
                      ? 'bg-elevated text-ink'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {saveFeedback && saveFeedback.state !== 'idle' ? (
              <span
                className={`font-mono text-xs ${
                  saveFeedback.state === 'failed'
                    ? 'text-red-400'
                    : saveFeedback.state === 'saved'
                      ? 'text-accent-text'
                      : 'text-ink-muted'
                }`}
              >
                {saveFeedback.message}
              </span>
            ) : (
              <span className="font-mono text-[11px] text-ink-subtle">
                AI uses Trusted (strong) &gt; Reviewed; Raw excluded by default
              </span>
            )}
          </div>

          <div className={`grid gap-2.5 ${allTags.length > 0 ? 'sm:grid-cols-[1fr_180px]' : ''}`}>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search titles, tags, or snippets..."
                className="min-h-[44px] w-full rounded-md border border-line bg-surface py-2 pr-4 pl-10 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
              />
            </div>

            {allTags.length > 0 && (
              <select
                aria-label="Filter by tag"
                value={selectedTag}
                onChange={(e) => setSelectedTag(e.target.value)}
                className="min-h-[44px] rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs text-ink focus:border-accent focus:outline-none"
              >
                <option value="all">All Tags ({allTags.length})</option>
                {allTags.map((tag) => (
                  <option key={tag} value={tag}>
                    #{tag}
                  </option>
                ))}
              </select>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="space-y-3 rounded-lg border border-line bg-surface p-5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="h-4 w-48 animate-pulse rounded bg-elevated" />
                    <div className="h-7 w-24 animate-pulse rounded bg-elevated" />
                  </div>
                  <div className="h-3 w-64 animate-pulse rounded bg-elevated" />
                  <div className="h-14 w-full animate-pulse rounded bg-inset" />
                </div>
              ))}
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="rounded-lg border border-line bg-surface p-8 text-center">
              <h3 className="text-sm font-semibold text-ink">
                {entries.length === 0 ? 'No knowledge saved yet' : 'No matching entries'}
              </h3>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-muted">
                {entries.length === 0
                  ? 'Teach Mantis your first pattern, fact, or definition so it persists across devices.'
                  : 'Try clearing your search filter or selecting All Entries.'}
              </p>
              <div className="mt-4 flex justify-center gap-2">
                {entries.length === 0 ? (
                  <button
                    type="button"
                    onClick={onOpenTeach}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover"
                  >
                    <PlusCircle className="h-4 w-4" />
                    <span>Teach First Entry</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFolderId('all');
                      setSelectedTag('all');
                      setStatusFilter('all');
                      setSearchQuery('');
                    }}
                    className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-elevated px-4 py-2 text-xs font-medium text-ink hover:opacity-90"
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="divide-y divide-line rounded-lg border border-line bg-surface">
              {filteredEntries.map((entry) => {
                const folderName =
                  (entry.folder_id && folderMap.get(entry.folder_id)?.name) || 'Uncategorized';
                const entryStatus = getEntryStatus(entry);
                const isEditing = editingId === entry.id;
                const isHighlighted = highlightedEntryId === entry.id;
                const isChecked = Boolean(selectedIds[entry.id]);

                return (
                  <article
                    key={entry.id}
                    className={`p-4 sm:p-5 ${
                      isHighlighted || isChecked ? 'bg-accent-soft' : ''
                    }`}
                  >
                    {isEditing ? (
                      <div className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-3">
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="min-h-[44px] rounded-md border border-line-strong bg-inset px-3 py-2 text-sm font-medium text-ink focus:border-accent focus:outline-none"
                          />
                          <select
                            value={editFolderId}
                            onChange={(e) => setEditFolderId(e.target.value)}
                            className="min-h-[44px] rounded-md border border-line-strong bg-inset px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                          >
                            <option value="">Uncategorized</option>
                            {folders.map((folder) => (
                              <option key={folder.id} value={folder.id}>
                                {folder.name}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label="Entry trust status"
                            value={editStatus}
                            onChange={(e) => setEditStatus(e.target.value as KnowledgeStatus)}
                            className="min-h-[44px] rounded-md border border-line-strong bg-inset px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                          >
                            <option value="trusted">Trusted (Strong AI Weight)</option>
                            <option value="reviewed">Reviewed (Medium Weight)</option>
                            <option value="raw">Raw (Excluded by Default)</option>
                          </select>
                        </div>

                        <input
                          type="text"
                          value={editTagsRaw}
                          onChange={(e) => setEditTagsRaw(e.target.value)}
                          placeholder="Tags separated by commas"
                          className="min-h-[44px] w-full rounded-md border border-line-strong bg-inset px-3 py-2 font-mono text-xs text-ink focus:border-accent focus:outline-none"
                        />

                        <textarea
                          rows={5}
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="w-full rounded-md border border-line-strong bg-inset p-3 font-mono text-xs leading-relaxed text-ink focus:border-accent focus:outline-none"
                        />

                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-md border border-line-strong bg-inset px-3.5 py-2 text-xs font-medium text-ink hover:bg-elevated"
                          >
                            <X className="h-3.5 w-3.5" />
                            <span>Cancel</span>
                          </button>
                          <button
                            type="button"
                            disabled={isSavingEdit}
                            onClick={() => saveEdit(entry.id)}
                            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                          >
                            <Check className="h-3.5 w-3.5" />
                            <span>{isSavingEdit ? 'Saving…' : 'Save Changes'}</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex items-start gap-2.5">
                            {bulkMode && (
                              <button
                                type="button"
                                aria-label={`Select ${entry.title}`}
                                onClick={() => toggleSelectEntry(entry.id)}
                                className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-md border border-line-strong bg-inset text-accent-text hover:border-accent-border"
                              >
                                {isChecked ? (
                                  <CheckSquare className="h-4 w-4" />
                                ) : (
                                  <Square className="h-4 w-4 text-ink-muted" />
                                )}
                              </button>
                            )}
                            <div className="space-y-1">
                              <h3 className="text-base font-semibold text-ink">
                                {entry.title}
                              </h3>
                              <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-ink-muted">
                                <span
                                  className={
                                    entryStatus === 'trusted'
                                      ? 'font-semibold text-accent-text'
                                      : entryStatus === 'raw'
                                        ? 'font-semibold text-amber-400'
                                        : 'text-ink'
                                  }
                                >
                                  {entryStatus === 'trusted'
                                    ? 'Trusted'
                                    : entryStatus === 'raw'
                                      ? 'Raw'
                                      : 'Reviewed'}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="text-ink">{folderName}</span>
                                {entry.tags.length > 0 && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>{entry.tags.join(', ')}</span>
                                  </>
                                )}
                                <span aria-hidden="true">·</span>
                                <span className="tabular-nums">
                                  Updated {new Date(entry.updated_at).toLocaleDateString()}
                                </span>
                                {entry.source_url && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <a
                                      href={entry.source_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-accent-text underline underline-offset-2 hover:opacity-85"
                                    >
                                      <ExternalLink className="h-3 w-3" />
                                      <span>Source</span>
                                    </a>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            {entryStatus !== 'trusted' && (
                              <button
                                type="button"
                                onClick={() => void onUpdateEntryStatus(entry.id, 'trusted')}
                                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent-text hover:opacity-90"
                              >
                                <ShieldCheck className="h-3.5 w-3.5" />
                                <span>Mark as Trusted</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => startEdit(entry)}
                              aria-label={`Edit ${entry.title}`}
                              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-line bg-inset px-3 py-1.5 text-xs font-medium text-ink hover:border-line-strong"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                              <span>Edit</span>
                            </button>

                            {confirmDeleteId === entry.id ? (
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={isDeletingId === entry.id}
                                  onClick={() => confirmDelete(entry.id)}
                                  className="min-h-[40px] rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                                >
                                  {isDeletingId === entry.id ? 'Deleting…' : 'Confirm Delete'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="min-h-[40px] rounded-md border border-line-strong px-2.5 py-1.5 text-xs text-ink-muted hover:bg-elevated"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(entry.id)}
                                aria-label={`Delete ${entry.title}`}
                                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-line bg-inset px-3 py-1.5 text-xs font-medium text-ink-muted hover:border-red-500/40 hover:text-red-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span>Delete</span>
                              </button>
                            )}
                          </div>
                        </div>

                        <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-line bg-inset p-3 font-mono text-xs leading-relaxed text-ink">
                          {entry.content}
                        </pre>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
