import {
  BookOpen,
  Check,
  Edit3,
  Folder,
  FolderPlus,
  PlusCircle,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {type FormEvent, useEffect, useMemo, useState} from 'react';
import {parseTagsInput} from '../lib/memory';
import type {KnowledgeEntry, KnowledgeFolder} from '../types/mantis';

interface KnowledgeBrowserProps {
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
  isLoading: boolean;
  highlightedEntryId: string | null;
  onClearHighlight: () => void;
  onCreateFolder: (name: string, description: string) => Promise<KnowledgeFolder | null>;
  onDeleteFolder: (folderId: string) => Promise<boolean>;
  onUpdateEntry: (
    id: string,
    payload: {title: string; content: string; folderId: string | null; tags: string[]},
  ) => Promise<boolean>;
  onDeleteEntry: (id: string) => Promise<boolean>;
  onOpenTeach: () => void;
}

export function KnowledgeBrowser({
  folders,
  entries,
  isLoading,
  highlightedEntryId,
  onClearHighlight,
  onCreateFolder,
  onDeleteFolder,
  onUpdateEntry,
  onDeleteEntry,
  onOpenTeach,
}: KnowledgeBrowserProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string>('all');
  const [selectedTag, setSelectedTag] = useState<string>('all');
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
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (highlightedEntryId) {
      setSelectedFolderId('all');
      setSelectedTag('all');
      setSearchQuery('');
    }
  }, [highlightedEntryId]);

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
      if (!q) return true;
      return (
        entry.title.toLowerCase().includes(q) ||
        entry.content.toLowerCase().includes(q) ||
        entry.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [entries, selectedFolderId, selectedTag, searchQuery, folderMap]);

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
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">Knowledge Browser</h1>
          <p className="text-sm text-slate-400">
            Organized folders and persistent memory stored in Supabase.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowNewFolderForm((v) => !v)}
            className="inline-flex min-h-[42px] items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            <FolderPlus className="h-4 w-4" />
            <span>{showNewFolderForm ? 'Close Folder Form' : 'New Folder'}</span>
          </button>
          <button
            type="button"
            onClick={onOpenTeach}
            className="inline-flex min-h-[42px] items-center gap-2 rounded-md bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            <PlusCircle className="h-4 w-4" />
            <span>Teach Entry</span>
          </button>
        </div>
      </div>

      {showNewFolderForm && (
        <form
          onSubmit={handleCreateFolder}
          className="grid gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4 sm:grid-cols-[1fr_1fr_auto]"
        >
          <input
            type="text"
            required
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Folder name (e.g. React Native)"
            className="min-h-[44px] rounded-md border border-slate-700 bg-[#0B1120] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
          />
          <input
            type="text"
            value={newFolderDesc}
            onChange={(e) => setNewFolderDesc(e.target.value)}
            placeholder="Short description (optional)"
            className="min-h-[44px] rounded-md border border-slate-700 bg-[#0B1120] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={isCreatingFolder || !newFolderName.trim()}
            className="min-h-[44px] rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {isCreatingFolder ? 'Creating...' : 'Create Folder'}
          </button>
        </form>
      )}

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        {/* Folders Column */}
        <aside className="space-y-1.5">
          <h2 className="px-2 pb-1 text-xs font-semibold text-slate-400">Folders</h2>

          <button
            type="button"
            onClick={() => {
              setSelectedFolderId('all');
              onClearHighlight();
            }}
            className={`flex min-h-[44px] w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
              selectedFolderId === 'all'
                ? 'bg-slate-800 font-medium text-slate-100'
                : 'text-slate-300 hover:bg-slate-900'
            }`}
          >
            <span className="flex items-center gap-2.5 truncate">
              <BookOpen className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="truncate">All Entries</span>
            </span>
            <span className="font-mono text-xs tabular-nums text-slate-400">{entries.length}</span>
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
                      ? 'bg-slate-800 font-medium text-slate-100'
                      : 'text-slate-300 hover:bg-slate-900'
                  }`}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Folder className="h-4 w-4 shrink-0 text-emerald-400/80" />
                    <span className="truncate">{folder.name}</span>
                  </span>
                  <span className="font-mono text-xs tabular-nums text-slate-400">{count}</span>
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
                          className="min-h-[34px] rounded bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-500"
                        >
                          Remove Folder
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteFolderId(null)}
                          className="min-h-[34px] rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteFolderId(folder.id)}
                        className="text-[11px] text-slate-500 hover:text-red-300"
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
                  ? 'bg-slate-800 font-medium text-slate-100'
                  : 'text-slate-300 hover:bg-slate-900'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Folder className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="truncate">Uncategorized</span>
              </span>
              <span className="font-mono text-xs tabular-nums text-slate-400">
                {folderCounts.uncategorized}
              </span>
            </button>
          )}
        </aside>

        {/* Entries List Column */}
        <div className="space-y-4">
          <div className={`grid gap-2.5 ${allTags.length > 0 ? 'sm:grid-cols-[1fr_180px]' : ''}`}>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search titles, tags, or snippets..."
                className="min-h-[44px] w-full rounded-md border border-slate-800 bg-slate-900 py-2 pr-4 pl-10 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            {allTags.length > 0 && (
              <select
                aria-label="Filter by tag"
                value={selectedTag}
                onChange={(e) => setSelectedTag(e.target.value)}
                className="min-h-[44px] rounded-md border border-slate-800 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
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
                  className="h-28 animate-pulse rounded-lg border border-slate-800 bg-slate-900/60"
                />
              ))}
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-8 text-center">
              <h3 className="text-sm font-semibold text-slate-200">
                {entries.length === 0 ? 'No knowledge saved yet' : 'No matching entries'}
              </h3>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-400">
                {entries.length === 0
                  ? 'Teach Mantis your first coding pattern, architecture decision, or debugging fix so it persists across sessions.'
                  : 'Try clearing your search filter or selecting All Entries.'}
              </p>
              <div className="mt-4 flex justify-center gap-2">
                {entries.length === 0 ? (
                  <button
                    type="button"
                    onClick={onOpenTeach}
                    className="inline-flex min-h-[42px] items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
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
                      setSearchQuery('');
                    }}
                    className="inline-flex min-h-[42px] items-center rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
              {filteredEntries.map((entry) => {
                const folderName =
                  (entry.folder_id && folderMap.get(entry.folder_id)?.name) || 'Uncategorized';
                const isEditing = editingId === entry.id;
                const isHighlighted = highlightedEntryId === entry.id;

                return (
                  <article
                    key={entry.id}
                    className={`p-4 sm:p-5 ${
                      isHighlighted ? 'bg-emerald-950/20' : ''
                    }`}
                  >
                    {isEditing ? (
                      <div className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="min-h-[42px] rounded-md border border-slate-700 bg-[#0B1120] px-3 py-2 text-sm font-medium text-slate-100 focus:border-emerald-500 focus:outline-none"
                          />
                          <select
                            value={editFolderId}
                            onChange={(e) => setEditFolderId(e.target.value)}
                            className="min-h-[42px] rounded-md border border-slate-700 bg-[#0B1120] px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                          >
                            <option value="">Uncategorized</option>
                            {folders.map((folder) => (
                              <option key={folder.id} value={folder.id}>
                                {folder.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <input
                          type="text"
                          value={editTagsRaw}
                          onChange={(e) => setEditTagsRaw(e.target.value)}
                          placeholder="Tags separated by commas"
                          className="min-h-[40px] w-full rounded-md border border-slate-700 bg-[#0B1120] px-3 py-2 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                        />

                        <textarea
                          rows={5}
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="w-full rounded-md border border-slate-700 bg-[#0B1120] p-3 font-mono text-xs leading-relaxed text-slate-100 focus:border-emerald-500 focus:outline-none"
                        />

                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
                          >
                            <X className="h-3.5 w-3.5" />
                            <span>Cancel</span>
                          </button>
                          <button
                            type="button"
                            disabled={isSavingEdit}
                            onClick={() => saveEdit(entry.id)}
                            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                          >
                            <Check className="h-3.5 w-3.5" />
                            <span>{isSavingEdit ? 'Saving...' : 'Save Changes'}</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <h3 className="text-base font-semibold text-slate-100">
                              {entry.title}
                            </h3>
                            <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-slate-400">
                              <span className="text-emerald-400">{folderName}</span>
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
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => startEdit(entry)}
                              aria-label={`Edit ${entry.title}`}
                              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-slate-800 bg-[#0B1120] px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-slate-100"
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
                                  {isDeletingId === entry.id ? 'Deleting...' : 'Confirm Delete'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="min-h-[40px] rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(entry.id)}
                                aria-label={`Delete ${entry.title}`}
                                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-slate-800 bg-[#0B1120] px-3 py-1.5 text-xs font-medium text-slate-400 hover:border-red-500/40 hover:text-red-300"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span>Delete</span>
                              </button>
                            )}
                          </div>
                        </div>

                        <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-slate-800 bg-[#0B1120] p-3 font-mono text-xs leading-relaxed text-slate-200">
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
}
