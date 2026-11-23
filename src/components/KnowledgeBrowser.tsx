import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Check,
  CheckSquare,
  Edit3,
  ExternalLink,
  FileText,
  Folder,
  FolderPlus,
  GitMerge,
  PlusCircle,
  Search,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {type FormEvent, memo, useEffect, useMemo, useRef, useState} from 'react';
import {getEntryStatus, sanitizeExternalHttpUrl} from '../lib/knowledgeSync';
import {
  analyzeMemoryConsolidation,
  buildMergedClusterContent,
  parseTagsInput,
} from '../lib/memory';
import type {
  KnowledgeEntry,
  KnowledgeFolder,
  KnowledgeStatus,
  MemoryDuplicateCluster,
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
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(
    highlightedEntryId || entries[0]?.id || null,
  );
  const [mobilePane, setMobilePane] = useState<'list' | 'reader'>(
    highlightedEntryId ? 'reader' : 'list',
  );
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Bulk select & action state
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [bulkTargetFolderId, setBulkTargetFolderId] = useState<string>(folders[0]?.id || '');
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [isBulkBusy, setIsBulkBusy] = useState(false);

  // Semantic Memory Consolidation drawer state
  const [showConsolidator, setShowConsolidator] = useState(false);
  const [consolidateBusyId, setConsolidateBusyId] = useState<string | null>(null);
  const [consolidateNotice, setConsolidateNotice] = useState<string | null>(null);

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
      setSelectedEntryId(highlightedEntryId);
      setMobilePane('reader');
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

  const consolidationReport = useMemo(
    () => analyzeMemoryConsolidation(entries, folders),
    [entries, folders],
  );
  const consolidationIssuesCount =
    consolidationReport.duplicateClusters.length + consolidationReport.contradictions.length;

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

  const activeEntry = useMemo(() => {
    if (filteredEntries.length === 0) return null;
    if (selectedEntryId) {
      const match = filteredEntries.find((e) => e.id === selectedEntryId);
      if (match) return match;
    }
    return filteredEntries[0];
  }, [filteredEntries, selectedEntryId]);

  useEffect(() => {
    if (filteredEntries.length === 0) {
      if (mobilePane === 'reader') setMobilePane('list');
      return;
    }
    if (!selectedEntryId || !filteredEntries.some((e) => e.id === selectedEntryId)) {
      setSelectedEntryId(filteredEntries[0].id);
    }
  }, [filteredEntries, selectedEntryId, mobilePane]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isInputFocused =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT';

      if (event.key === '/' && !isInputFocused) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (isInputFocused || editingId || filteredEntries.length === 0) return;

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const curIdx = activeEntry
          ? filteredEntries.findIndex((e) => e.id === activeEntry.id)
          : 0;
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const nextIdx =
          (curIdx + delta + filteredEntries.length) % filteredEntries.length;
        setSelectedEntryId(filteredEntries[nextIdx].id);
        setConfirmDeleteId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredEntries, activeEntry, editingId]);

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
          <h1 className="text-lg font-semibold tracking-tight text-ink">Knowledge Memory</h1>
          <p className="text-xs text-ink-muted">
            Organized memory folders with trust weighting and inline editing.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setShowConsolidator((v) => !v);
              setConsolidateNotice(null);
            }}
            className={`inline-flex min-h-[44px] items-center gap-2 rounded-md border px-3.5 py-2 text-xs font-medium transition-colors ${
              showConsolidator
                ? 'border-accent-border bg-accent-soft text-accent-text'
                : consolidationIssuesCount > 0
                  ? 'border-warn-border bg-warn-soft text-warn'
                  : 'border-line-strong bg-surface text-ink hover:bg-elevated'
            }`}
          >
            <GitMerge className="h-4 w-4" />
            <span>
              Consolidate{consolidationIssuesCount > 0 ? ` (${consolidationIssuesCount})` : ''}
            </span>
          </button>

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

      {showConsolidator && (
        <section
          aria-label="Semantic Memory Consolidation"
          className="mantis-slide-up space-y-4 rounded-lg border border-line-strong bg-surface p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
            <div className="space-y-0.5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-ink">
                Semantic Memory Consolidation &amp; Conflict Resolver
              </h2>
              <p className="font-mono text-[11px] tabular-nums text-ink-muted">
                {consolidationReport.duplicateClusters.length} near-duplicate cluster(s) ·{' '}
                {consolidationReport.contradictions.length} conflict(s) ·{' '}
                {consolidationReport.staleRawEntries.length} Raw · reclaim ~
                {Math.max(0, Math.round(consolidationReport.totalReclaimableBytes / 1024))} KB
              </p>
            </div>
            <div className="flex items-center gap-2">
              {consolidationReport.staleRawEntries.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter('raw');
                    setShowConsolidator(false);
                  }}
                  className="min-h-[40px] rounded border border-line-strong bg-inset px-3 text-xs font-medium text-ink hover:bg-elevated"
                >
                  Triage {consolidationReport.staleRawEntries.length} Raw
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowConsolidator(false)}
                aria-label="Close memory consolidator"
                className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded text-ink-muted hover:bg-elevated hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {consolidateNotice && (
            <div className="rounded border border-accent-border bg-accent-soft px-3 py-2 text-xs text-accent-text">
              {consolidateNotice}
            </div>
          )}

          {consolidationReport.duplicateClusters.length === 0 &&
          consolidationReport.contradictions.length === 0 ? (
            <div className="rounded border border-line bg-inset p-4 text-xs text-ink-muted">
              Memory index is clean — no near-duplicate clusters (cosine &ge; 0.86) or opposing rule directives found.
            </div>
          ) : (
            <div className="space-y-4">
              {consolidationReport.duplicateClusters.map((cluster: MemoryDuplicateCluster) => {
                const isBusy = consolidateBusyId === cluster.id;
                const redundant = cluster.entries.slice(1);
                return (
                  <div
                    key={cluster.id}
                    className="space-y-2.5 rounded-md border border-line bg-inset p-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-semibold text-ink">
                            Cluster: {cluster.canonicalTitle}
                          </span>
                          <span className="font-mono text-[11px] tabular-nums text-accent-text">
                            {Math.round(cluster.similarity * 100)}% similarity · {cluster.entries.length} entries
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-ink-muted">
                          Keeps canonical ({cluster.canonicalStatus}) &amp; merges {redundant.length} copy/copies (~
                          {Math.max(1, Math.round(cluster.estimatedBytesSaved / 1024))} KB saved)
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={async () => {
                          setConsolidateBusyId(cluster.id);
                          try {
                            const merged = buildMergedClusterContent(cluster);
                            const ok = await onUpdateEntry(cluster.canonicalEntryId, {
                              ...merged,
                              status: 'trusted',
                            });
                            if (ok) {
                              let deleted = 0;
                              for (const dup of redundant) {
                                if (await onDeleteEntry(dup.id)) deleted += 1;
                              }
                              setConsolidateNotice(
                                `Merged cluster into "${cluster.canonicalTitle}" (Trusted) and pruned ${deleted} duplicate(s).`,
                              );
                            }
                          } finally {
                            setConsolidateBusyId(null);
                          }
                        }}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded bg-accent px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                      >
                        <GitMerge className="h-3.5 w-3.5" />
                        <span>{isBusy ? 'Merging…' : 'Merge & Mark Trusted'}</span>
                      </button>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      {cluster.entries.slice(0, 4).map((item, idx) => (
                        <div
                          key={item.id}
                          className="rounded border border-line bg-surface p-2 text-[11px]"
                        >
                          <div className="flex items-center justify-between gap-2 font-mono">
                            <span className="truncate font-semibold text-ink">
                              {idx === 0 ? '★ Canonical: ' : 'Duplicate: '}
                              {item.title}
                            </span>
                            <span className="shrink-0 uppercase text-ink-subtle">
                              {getEntryStatus(item)}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-ink-muted">{item.content}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {consolidationReport.contradictions.map((c) => {
                const pairId = `c-${c.existingEntryId}-${c.newEntryId}`;
                const isBusy = consolidateBusyId === pairId;
                return (
                  <div
                    key={pairId}
                    className="space-y-2.5 rounded-md border border-warn-border bg-warn-soft p-3.5"
                  >
                    <div className="flex items-center gap-2 text-xs font-semibold text-ink">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-warn" />
                      <span>Rule Conflict: {c.reason}</span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded border border-line bg-surface p-2.5 text-[11px]">
                        <div className="font-mono font-semibold text-ink">
                          Rule A ({c.existingStatus || 'trusted'} · {c.existingFolder}): {c.existingTitle}
                        </div>
                        <p className="mt-1 line-clamp-3 text-ink-muted">{c.existingContent}</p>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={async () => {
                              setConsolidateBusyId(pairId);
                              try {
                                await onUpdateEntryStatus(c.existingEntryId, 'raw');
                                setConsolidateNotice(`Demoted "${c.existingTitle}" to Raw.`);
                              } finally {
                                setConsolidateBusyId(null);
                              }
                            }}
                            className="min-h-[40px] rounded border border-line-strong bg-inset px-2.5 text-[11px] font-medium text-ink hover:bg-elevated disabled:opacity-50"
                          >
                            Demote Rule A to Raw
                          </button>
                        </div>
                      </div>

                      <div className="rounded border border-line bg-surface p-2.5 text-[11px]">
                        <div className="font-mono font-semibold text-ink">
                          Rule B: {c.newTitle}
                        </div>
                        <p className="mt-1 line-clamp-3 text-ink-muted">{c.newContent}</p>
                        <div className="mt-2 flex gap-2">
                          {c.newEntryId && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={async () => {
                                setConsolidateBusyId(pairId);
                                try {
                                  await onUpdateEntryStatus(c.newEntryId!, 'raw');
                                  setConsolidateNotice(`Demoted "${c.newTitle}" to Raw.`);
                                } finally {
                                  setConsolidateBusyId(null);
                                }
                              }}
                              className="min-h-[40px] rounded border border-line-strong bg-inset px-2.5 text-[11px] font-medium text-ink hover:bg-elevated disabled:opacity-50"
                            >
                              Demote Rule B to Raw
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedEntryId(c.existingEntryId);
                              setMobilePane('reader');
                              setShowConsolidator(false);
                            }}
                            className="min-h-[40px] rounded border border-accent-border bg-accent-soft px-2.5 text-[11px] font-semibold text-accent-text"
                          >
                            Inspect in Reader
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

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
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-line-strong bg-inset px-3 py-1.5 text-xs font-medium text-ink-muted hover:border-danger-border hover:text-danger disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Delete Selected</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[220px_300px_1fr]">
        {/* Column 1: Folders Tree (Hidden on < lg when inspecting a note) */}
        <aside
          className={`space-y-2 rounded-lg border border-line bg-surface p-3 ${
            mobilePane === 'reader' ? 'hidden lg:block' : 'block'
          }`}
        >
          <h2 className="px-1 text-xs font-semibold tracking-wide text-ink-muted uppercase lg:px-2 lg:pb-1">
            Folders
          </h2>

          <div className="flex flex-wrap gap-1.5 lg:block lg:space-y-1.5">
            <button
              type="button"
              onClick={() => {
                setSelectedFolderId('all');
                onClearHighlight();
              }}
              className={`flex min-h-[40px] items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left text-xs transition-colors lg:w-full lg:py-2 ${
                selectedFolderId === 'all'
                  ? 'bg-elevated font-semibold text-ink'
                  : 'border border-line text-ink-muted hover:bg-inset hover:text-ink lg:border-0'
              }`}
            >
              <span className="flex items-center gap-2 truncate">
                <BookOpen className="h-4 w-4 shrink-0 text-ink-subtle" />
                <span className="truncate">All Entries</span>
              </span>
              <span className="font-mono text-xs tabular-nums text-ink-subtle">{entries.length}</span>
            </button>

            {folders.map((folder) => {
              const count = folderCounts.counts.get(folder.id) || 0;
              const isSelected = selectedFolderId === folder.id;
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => {
                    setSelectedFolderId(folder.id);
                    setConfirmDeleteFolderId(null);
                    onClearHighlight();
                  }}
                  className={`flex min-h-[40px] items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left text-xs transition-colors lg:w-full lg:py-2 ${
                    isSelected
                      ? 'bg-elevated font-semibold text-ink'
                      : 'border border-line text-ink-muted hover:bg-inset hover:text-ink lg:border-0'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Folder className="h-4 w-4 shrink-0 text-accent-text" />
                    <span className="truncate">{folder.name}</span>
                  </span>
                  <span className="font-mono text-xs tabular-nums text-ink-subtle">{count}</span>
                </button>
              );
            })}

            {folderCounts.uncategorized > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSelectedFolderId('uncategorized');
                  onClearHighlight();
                }}
                className={`flex min-h-[40px] items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left text-xs transition-colors lg:w-full lg:py-2 ${
                  selectedFolderId === 'uncategorized'
                    ? 'bg-elevated font-semibold text-ink'
                    : 'border border-line text-ink-muted hover:bg-inset hover:text-ink lg:border-0'
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <Folder className="h-4 w-4 shrink-0 text-ink-subtle" />
                  <span className="truncate">Uncategorized</span>
                </span>
                <span className="font-mono text-xs tabular-nums text-ink-subtle">
                  {folderCounts.uncategorized}
                </span>
              </button>
            )}
          </div>

          {selectedFolderId !== 'all' &&
            selectedFolderId !== 'uncategorized' &&
            folders.length > 1 && (
              <div className="border-t border-line pt-2">
                {confirmDeleteFolderId === selectedFolderId ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await onDeleteFolder(selectedFolderId);
                        if (ok) {
                          setConfirmDeleteFolderId(null);
                          setSelectedFolderId('all');
                        }
                      }}
                      className="min-h-[40px] rounded bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-500"
                    >
                      Remove Folder
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteFolderId(null)}
                      className="min-h-[40px] rounded border border-line-strong px-2 py-1 text-[11px] text-ink-muted hover:bg-elevated"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteFolderId(selectedFolderId)}
                    className="inline-flex min-h-[40px] items-center px-1 text-[11px] text-ink-subtle hover:text-danger"
                  >
                    Remove folder (keeps notes)
                  </button>
                )}
              </div>
            )}
        </aside>

        {/* Column 2: Searchable Compact Note List */}
        <section
          aria-label="Knowledge entries list"
          className={`flex-col gap-3 rounded-lg border border-line bg-surface p-3 ${
            mobilePane === 'reader' ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notes… (press /)"
              className="min-h-[42px] w-full rounded-md border border-line-strong bg-inset py-2 pr-3 pl-9 text-xs text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-1 rounded-md border border-line bg-inset p-1">
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
                className={`min-h-[40px] rounded px-2 text-[11px] font-medium tabular-nums transition-colors ${
                  statusFilter === tab.id
                    ? 'bg-elevated text-ink'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {allTags.length > 0 && (
            <select
              aria-label="Filter by tag"
              value={selectedTag}
              onChange={(e) => setSelectedTag(e.target.value)}
              className="min-h-[40px] rounded-md border border-line-strong bg-inset px-2.5 py-1.5 font-mono text-xs text-ink focus:border-accent focus:outline-none"
            >
              <option value="all">All Tags ({allTags.length})</option>
              {allTags.map((tag) => (
                <option key={tag} value={tag}>
                  #{tag}
                </option>
              ))}
            </select>
          )}

          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="space-y-2 rounded-md border border-line bg-inset p-3">
                  <div className="h-3.5 w-3/4 animate-pulse rounded bg-elevated" />
                  <div className="h-2.5 w-1/2 animate-pulse rounded bg-elevated" />
                </div>
              ))}
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="rounded-md border border-line bg-inset p-5 text-center">
              <p className="text-xs font-medium text-ink">
                {entries.length === 0 ? 'No knowledge saved yet' : 'No matching notes'}
              </p>
              <button
                type="button"
                onClick={() => {
                  if (entries.length === 0) {
                    onOpenTeach();
                  } else {
                    setSelectedFolderId('all');
                    setSelectedTag('all');
                    setStatusFilter('all');
                    setSearchQuery('');
                  }
                }}
                className="mt-3 inline-flex min-h-[40px] items-center rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-accent-text hover:bg-elevated"
              >
                {entries.length === 0 ? 'Teach First Entry' : 'Reset Filters'}
              </button>
            </div>
          ) : (
            <div className="divide-y divide-line rounded-md border border-line bg-inset lg:max-h-[60vh] lg:overflow-y-auto">
              {filteredEntries.map((entry) => {
                const entryStatus = getEntryStatus(entry);
                const isSelected = activeEntry?.id === entry.id;
                const isChecked = Boolean(selectedIds[entry.id]);
                const folderName =
                  (entry.folder_id && folderMap.get(entry.folder_id)?.name) || 'Uncategorized';

                return (
                  <div
                    key={entry.id}
                    className={`flex items-start gap-2 p-2.5 transition-colors ${
                      isSelected ? 'bg-accent-soft' : 'hover:bg-elevated/45'
                    }`}
                  >
                    {bulkMode && (
                      <button
                        type="button"
                        aria-label={`Select ${entry.title}`}
                        onClick={() => toggleSelectEntry(entry.id)}
                        className="mt-0.5 inline-flex min-h-[40px] min-w-[40px] shrink-0 items-center justify-center rounded border border-line-strong bg-surface text-accent-text hover:border-accent-border"
                      >
                        {isChecked ? (
                          <CheckSquare className="h-4 w-4" />
                        ) : (
                          <Square className="h-4 w-4 text-ink-muted" />
                        )}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedEntryId(entry.id);
                        setEditingId(null);
                        setConfirmDeleteId(null);
                        setMobilePane('reader');
                        if (highlightedEntryId && highlightedEntryId !== entry.id) {
                          onClearHighlight();
                        }
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-ink">
                          {entry.title}
                        </span>
                        <span
                          className={`shrink-0 font-mono text-[10px] font-semibold uppercase ${
                            entryStatus === 'trusted'
                              ? 'text-accent-text'
                              : entryStatus === 'raw'
                                ? 'text-warn'
                                : 'text-ink-subtle'
                          }`}
                        >
                          {entryStatus}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[11px] text-ink-muted">
                        <span className="truncate">{folderName}</span>
                        <span aria-hidden="true">·</span>
                        <span className="shrink-0 tabular-nums">
                          {new Date(entry.updated_at).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-ink-subtle">
                        {entry.content}
                      </p>
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-auto flex items-center justify-between border-t border-line pt-2 font-mono text-[11px] text-ink-subtle">
            <span>↑↓ select note · / search</span>
            {saveFeedback && saveFeedback.state !== 'idle' && (
              <span
                className={
                  saveFeedback.state === 'failed'
                    ? 'text-danger'
                    : saveFeedback.state === 'saved'
                      ? 'text-accent-text'
                      : 'text-ink-muted'
                }
              >
                {saveFeedback.message}
              </span>
            )}
          </div>
        </section>

        {/* Column 3: Focused Note Reader & Inline Editor */}
        <section
          aria-label="Note reader and editor"
          className={`rounded-lg border border-line bg-surface p-4 sm:p-5 ${
            mobilePane === 'list' ? 'hidden lg:block' : 'block'
          }`}
        >
          <div className="mb-3 flex items-center justify-between border-b border-line pb-2.5 lg:hidden">
            <button
              type="button"
              onClick={() => setMobilePane('list')}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-line bg-inset px-3 text-xs font-medium text-ink hover:border-line-strong"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Notes ({filteredEntries.length})</span>
            </button>
            {activeEntry && (
              <span className="truncate pl-2 font-mono text-[11px] text-ink-muted">
                {getEntryStatus(activeEntry)}
              </span>
            )}
          </div>
          {isLoading ? (
            <div className="space-y-4">
              <div className="h-6 w-2/3 animate-pulse rounded bg-elevated" />
              <div className="h-4 w-1/3 animate-pulse rounded bg-elevated" />
              <div className="h-44 w-full animate-pulse rounded bg-inset" />
            </div>
          ) : !activeEntry ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center space-y-3 text-center">
              <FileText className="h-8 w-8 text-ink-subtle" />
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-ink">
                  {entries.length === 0 ? 'Knowledge Explorer Ready' : 'Select a note to read'}
                </h3>
                <p className="max-w-sm text-xs leading-relaxed text-ink-muted">
                  {entries.length === 0
                    ? 'Teach Mantis your first rule, coding convention, or ingested link so it stays synced across devices.'
                    : 'Choose any note on the left or press ↑ / ↓ to inspect, mark Trusted, or edit inline.'}
                </p>
              </div>
              {entries.length === 0 && (
                <button
                  type="button"
                  onClick={onOpenTeach}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover"
                >
                  <PlusCircle className="h-4 w-4" />
                  <span>Teach First Entry</span>
                </button>
              )}
            </div>
          ) : editingId === activeEntry.id ? (
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
                rows={12}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full rounded-md border border-line-strong bg-inset p-3.5 font-mono text-xs leading-relaxed text-ink focus:border-accent focus:outline-none"
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
                  onClick={() => saveEdit(activeEntry.id)}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>{isSavingEdit ? 'Saving…' : 'Save Changes'}</span>
                </button>
              </div>
            </div>
          ) : (
            (() => {
              const entry = activeEntry;
              const folderName =
                (entry.folder_id && folderMap.get(entry.folder_id)?.name) || 'Uncategorized';
              const entryStatus = getEntryStatus(entry);
              const safeSourceUrl = sanitizeExternalHttpUrl(entry.source_url);

              return (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
                    <div className="space-y-1.5">
                      <h2 className="text-lg font-semibold text-ink">{entry.title}</h2>
                      <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-ink-muted">
                        <span
                          className={
                            entryStatus === 'trusted'
                              ? 'font-semibold text-accent-text'
                              : entryStatus === 'raw'
                                ? 'font-semibold text-warn'
                                : 'text-ink'
                          }
                        >
                          {entryStatus === 'trusted'
                            ? 'Trusted'
                            : entryStatus === 'raw'
                              ? 'Raw (Excluded from AI)'
                              : 'Reviewed'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="text-ink">{folderName}</span>
                        {entry.tags.length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{entry.tags.map((t) => `#${t}`).join(' ')}</span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          Updated {new Date(entry.updated_at).toLocaleDateString()}
                        </span>
                        {safeSourceUrl && (
                          <>
                            <span aria-hidden="true">·</span>
                            <a
                              href={safeSourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-accent-text underline underline-offset-2 hover:opacity-85"
                            >
                              <ExternalLink className="h-3 w-3" />
                              <span>Source Link</span>
                            </a>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {entryStatus !== 'trusted' && (
                        <button
                          type="button"
                          onClick={() => void onUpdateEntryStatus(entry.id, 'trusted')}
                          className="inline-flex min-h-[42px] items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-3.5 py-1.5 text-xs font-semibold text-accent-text hover:opacity-90"
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                          <span>Mark as Trusted</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => startEdit(entry)}
                        aria-label={`Edit ${entry.title}`}
                        className="inline-flex min-h-[42px] items-center gap-1.5 rounded-md border border-line-strong bg-inset px-3.5 py-1.5 text-xs font-medium text-ink hover:bg-elevated"
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
                            className="min-h-[42px] rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                          >
                            {isDeletingId === entry.id ? 'Deleting…' : 'Confirm Delete'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="min-h-[42px] rounded-md border border-line-strong px-2.5 py-1.5 text-xs text-ink-muted hover:bg-elevated"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(entry.id)}
                          aria-label={`Delete ${entry.title}`}
                          className="inline-flex min-h-[42px] items-center gap-1.5 rounded-md border border-line bg-inset px-3 py-1.5 text-xs font-medium text-ink-muted hover:border-danger-border hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Delete</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="whitespace-pre-wrap rounded-md border border-line bg-inset p-4 font-sans text-sm leading-relaxed text-ink lg:max-h-[58vh] lg:overflow-y-auto">
                    {entry.content}
                  </div>
                </div>
              );
            })()
          )}
        </section>
      </div>
    </div>
  );
});
