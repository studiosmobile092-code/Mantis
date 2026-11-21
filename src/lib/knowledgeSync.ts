import type {KnowledgeEntry, KnowledgeFolder, KnowledgeStatus} from '../types/mantis';

const META_FALLBACK_KEY = 'mantis_entry_meta_fallback_v1';
const OFFLINE_QUEUE_KEY = 'mantis_offline_write_queue_v1';
const DEDUPE_WINDOW_MS = 30_000;

interface FallbackEntryMeta {
  status?: KnowledgeStatus;
  source_url?: string | null;
  extracted_at?: string | null;
}

export interface OfflineQueuedWrite {
  id: string;
  kind: 'save_entry' | 'update_entry' | 'update_status';
  payload: Record<string, unknown>;
  createdAt: string;
  optimisticId?: string;
  baseUpdatedAt?: string;
  retryCount?: number;
  lastError?: string | null;
  hasConflict?: boolean;
  conflictServerTitle?: string;
  conflictServerUpdatedAt?: string;
  forceOverwrite?: boolean;
}

const recentSaveHashes = new Map<string, number>();

/**
 * Deterministic fast hash for title + content deduplication within short save windows.
 */
export function hashEntryTitleContent(title: string, content: string): string {
  const normalized = `${title.trim().toLowerCase()}::${content.trim().replace(/\s+/g, ' ').toLowerCase()}`;
  let h = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${normalized.length}:${(h >>> 0).toString(36)}`;
}

export function isDuplicateWithinWindow(
  title: string,
  content: string,
  existingEntries: KnowledgeEntry[],
  windowMs = DEDUPE_WINDOW_MS,
): {isDuplicate: boolean; existingEntry?: KnowledgeEntry; hash: string} {
  const hash = hashEntryTitleContent(title, content);
  const now = Date.now();

  for (const [k, ts] of recentSaveHashes.entries()) {
    if (now - ts > windowMs) {
      recentSaveHashes.delete(k);
    }
  }

  const normalizedTitle = title.trim().toLowerCase();
  const normalizedContent = content.trim().replace(/\s+/g, ' ').toLowerCase();

  const matchingEntry = existingEntries.find(
    (entry) =>
      entry.title.trim().toLowerCase() === normalizedTitle &&
      entry.content.trim().replace(/\s+/g, ' ').toLowerCase() === normalizedContent,
  );

  if (matchingEntry) {
    return {isDuplicate: true, existingEntry: matchingEntry, hash};
  }

  const lastTs = recentSaveHashes.get(hash);
  if (lastTs !== undefined && now - lastTs < windowMs) {
    return {isDuplicate: true, hash};
  }

  return {isDuplicate: false, hash};
}

export function markHashSaved(hash: string): void {
  recentSaveHashes.set(hash, Date.now());
}

export function unmarkHashSaved(hash: string): void {
  recentSaveHashes.delete(hash);
}

/**
 * Resolves the effective trust status of an entry across DB Phase 6 and local fallback storage.
 */
export function getEntryStatus(entry: KnowledgeEntry): KnowledgeStatus {
  if (entry.status === 'raw' || entry.status === 'reviewed' || entry.status === 'trusted') {
    return entry.status;
  }
  const fallback = readMetaFallbackMap()[entry.id];
  if (fallback?.status) {
    return fallback.status;
  }
  const src = (entry.source || '').toLowerCase();
  if (src === 'teach' || src === 'chat') {
    return 'trusted';
  }
  if (
    src.includes('ocr') ||
    src.includes('mic') ||
    src.includes('auto_mined') ||
    src.includes('youtube') ||
    src.includes('article') ||
    src.includes('capture')
  ) {
    return 'reviewed';
  }
  return 'reviewed';
}

export function getDefaultStatusForSource(source: string): KnowledgeStatus {
  const src = source.toLowerCase();
  if (src === 'teach' || src === 'chat') {
    return 'trusted';
  }
  if (src === 'auto_mined' || src === 'ai_chat') {
    return 'raw';
  }
  return 'reviewed';
}

function readMetaFallbackMap(): Record<string, FallbackEntryMeta> {
  try {
    const raw = window.localStorage.getItem(META_FALLBACK_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveEntryMetaFallback(entryId: string, meta: FallbackEntryMeta): void {
  try {
    const map = readMetaFallbackMap();
    map[entryId] = {...(map[entryId] || {}), ...meta};
    window.localStorage.setItem(META_FALLBACK_KEY, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

export function migrateEntryMetaFallback(fromId: string, toId: string): void {
  if (!fromId || !toId || fromId === toId) return;
  try {
    const map = readMetaFallbackMap();
    if (!map[fromId]) return;
    map[toId] = {...map[fromId], ...(map[toId] || {})};
    delete map[fromId];
    window.localStorage.setItem(META_FALLBACK_KEY, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

export function applyEntryMetaFallbacks(entries: KnowledgeEntry[]): KnowledgeEntry[] {
  const map = readMetaFallbackMap();
  return entries.map((entry) => {
    const fallback = map[entry.id];
    const resolvedStatus =
      entry.status || fallback?.status || getEntryStatus(entry);
    return {
      ...entry,
      status: resolvedStatus,
      source_url: entry.source_url ?? fallback?.source_url ?? null,
      extracted_at: entry.extracted_at ?? fallback?.extracted_at ?? null,
    };
  });
}

export function resolveGuaranteedFolderId(
  requestedFolderId: string | null | undefined,
  folders: KnowledgeFolder[],
  preferredNames: string[] = ['Patterns', 'Captured Learning', 'Architecture'],
): string | null {
  if (requestedFolderId && folders.some((f) => f.id === requestedFolderId)) {
    return requestedFolderId;
  }
  for (const name of preferredNames) {
    const matched = folders.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (matched) return matched.id;
  }
  return folders[0]?.id ?? null;
}

export function isMissingPhase6ColumnError(error: {code?: string; message?: string} | null): boolean {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  return (
    error.code === 'PGRST204' ||
    error.code === '42703' ||
    ((msg.includes('status') ||
      msg.includes('source_url') ||
      msg.includes('extracted_at') ||
      msg.includes('theme') ||
      msg.includes('accent_color')) &&
      (msg.includes('column') || msg.includes('schema cache')))
  );
}

export function isLikelyOfflineError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true;
  }
  const msg =
    error instanceof Error
      ? error.message.toLowerCase()
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as {message?: unknown}).message || '').toLowerCase()
        : String(error || '').toLowerCase();

  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('timeout') ||
    msg.includes('aborted') ||
    msg.includes('err_internet_disconnected')
  );
}

export function formatActionableError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as {message?: unknown}).message || '')
        : String(error || 'Unexpected error');

  const lower = raw.toLowerCase();
  if (isLikelyOfflineError(raw)) {
    return 'Offline or unreachable — changes queued locally and will retry automatically.';
  }
  if (lower.includes('42501') || lower.includes('permission denied') || lower.includes('row-level security')) {
    return 'Permission denied by Supabase RLS. Verify you are signed in and run the schema SQL grants.';
  }
  if (lower.includes('429') || lower.includes('rate limit')) {
    return 'Rate limit reached — pause briefly and tap Retry.';
  }
  if (lower.includes('jwt') || lower.includes('401') || lower.includes('not authenticated')) {
    return 'Session expired — refresh or sign back in to continue syncing.';
  }
  if (lower.includes('pgrst205') || lower.includes('does not exist')) {
    return 'Database table missing — run the setup SQL in Settings and tap Verify.';
  }
  return raw.length > 140 ? `${raw.slice(0, 137)}...` : raw;
}

const ALLOWED_OFFLINE_ENTRY_COLUMNS = new Set([
  'id',
  'user_id',
  'folder_id',
  'title',
  'content',
  'tags',
  'source',
  'status',
  'source_url',
  'extracted_at',
]);

/**
 * Ensures any user-supplied or extracted URL uses only safe http: or https: schemes,
 * blocking javascript:, data:, vbscript:, or malformed URIs before rendering href attributes.
 */
export function sanitizeExternalHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function sanitizeOfflinePayload(
  kind: OfflineQueuedWrite['kind'],
  rawPayload: unknown,
): Record<string, unknown> | null {
  if (typeof rawPayload !== 'object' || rawPayload === null || Array.isArray(rawPayload)) {
    return null;
  }
  const sourceObj = rawPayload as Record<string, unknown>;
  const safePayload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sourceObj)) {
    if (!ALLOWED_OFFLINE_ENTRY_COLUMNS.has(key)) continue;
    if (key === 'tags') {
      safePayload.tags = Array.isArray(value)
        ? value.map((t) => String(t).trim()).filter(Boolean).slice(0, 12)
        : [];
    } else if (key === 'status') {
      if (value === 'raw' || value === 'reviewed' || value === 'trusted') {
        safePayload.status = value;
      }
    } else if (key === 'source_url') {
      safePayload.source_url = sanitizeExternalHttpUrl(typeof value === 'string' ? value : null);
    } else if (key === 'folder_id' || key === 'extracted_at') {
      safePayload[key] = value === null ? null : String(value);
    } else if (typeof value === 'string') {
      safePayload[key] = value;
    }
  }

  if (kind === 'update_status') {
    if (typeof safePayload.id !== 'string' || !safePayload.status) return null;
  } else if (kind === 'update_entry') {
    if (typeof safePayload.id !== 'string') return null;
  } else if (kind === 'save_entry') {
    if (typeof safePayload.title !== 'string' || typeof safePayload.content !== 'string') {
      return null;
    }
  }
  return safePayload;
}

export function loadOfflineWriteQueue(): OfflineQueuedWrite[] {
  try {
    const raw = window.localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid: OfflineQueuedWrite[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue;
      const candidate = item as Record<string, unknown>;
      const kind = candidate.kind;
      if (kind !== 'save_entry' && kind !== 'update_entry' && kind !== 'update_status') {
        continue;
      }
      if (typeof candidate.id !== 'string' || typeof candidate.createdAt !== 'string') {
        continue;
      }
      const safePayload = sanitizeOfflinePayload(kind, candidate.payload);
      if (!safePayload) continue;
      valid.push({
        id: candidate.id,
        kind,
        payload: safePayload,
        createdAt: candidate.createdAt,
        optimisticId: typeof candidate.optimisticId === 'string' ? candidate.optimisticId : undefined,
        baseUpdatedAt:
          typeof candidate.baseUpdatedAt === 'string' ? candidate.baseUpdatedAt : undefined,
        retryCount:
          typeof candidate.retryCount === 'number' && Number.isFinite(candidate.retryCount)
            ? candidate.retryCount
            : 0,
        lastError: typeof candidate.lastError === 'string' ? candidate.lastError : null,
        hasConflict: Boolean(candidate.hasConflict),
        conflictServerTitle:
          typeof candidate.conflictServerTitle === 'string'
            ? candidate.conflictServerTitle
            : undefined,
        conflictServerUpdatedAt:
          typeof candidate.conflictServerUpdatedAt === 'string'
            ? candidate.conflictServerUpdatedAt
            : undefined,
        forceOverwrite: Boolean(candidate.forceOverwrite),
      });
    }
    return valid;
  } catch {
    return [];
  }
}

export function enqueueOfflineWrite(
  item: Omit<OfflineQueuedWrite, 'id' | 'createdAt'>,
): OfflineQueuedWrite[] {
  const queue = loadOfflineWriteQueue();
  const safePayload = sanitizeOfflinePayload(item.kind, item.payload);
  if (!safePayload) return queue;

  const targetId = typeof safePayload.id === 'string' ? safePayload.id : null;
  const nowIso = new Date().toISOString();

  // Coalesce edits/status changes on an offline-created optimistic entry directly into its save_entry write
  if (targetId && (item.kind === 'update_entry' || item.kind === 'update_status')) {
    const optimisticIdx = queue.findIndex(
      (q) => q.kind === 'save_entry' && q.optimisticId === targetId,
    );
    if (optimisticIdx >= 0) {
      const target = queue[optimisticIdx];
      const mergedPayload = {...target.payload};
      if (item.kind === 'update_status') {
        mergedPayload.status = safePayload.status;
      } else {
        if (typeof safePayload.title === 'string') mergedPayload.title = safePayload.title;
        if (typeof safePayload.content === 'string') mergedPayload.content = safePayload.content;
        if ('folder_id' in safePayload) mergedPayload.folder_id = safePayload.folder_id;
        if (Array.isArray(safePayload.tags)) mergedPayload.tags = safePayload.tags;
        if (safePayload.status) mergedPayload.status = safePayload.status;
      }
      const next = queue.map((q, idx) =>
        idx === optimisticIdx
          ? {...q, payload: mergedPayload, lastError: null, hasConflict: false}
          : q,
      );
      saveOfflineWriteQueue(next);
      return next;
    }

    // Coalesce repeated update_entry / update_status on the same real DB row
    const existingIdx = queue.findIndex(
      (q) =>
        (q.kind === 'update_entry' || q.kind === 'update_status') &&
        q.payload.id === targetId &&
        q.kind === item.kind,
    );
    if (existingIdx >= 0) {
      const existing = queue[existingIdx];
      const next = queue.map((q, idx) =>
        idx === existingIdx
          ? {
              ...existing,
              payload: {...existing.payload, ...safePayload},
              baseUpdatedAt: existing.baseUpdatedAt || item.baseUpdatedAt,
              lastError: null,
              hasConflict: false,
              createdAt: nowIso,
            }
          : q,
      );
      saveOfflineWriteQueue(next);
      return next;
    }
  }

  const next: OfflineQueuedWrite[] = [
    ...queue,
    {
      kind: item.kind,
      payload: safePayload,
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: nowIso,
      optimisticId: item.optimisticId,
      baseUpdatedAt: item.baseUpdatedAt,
      retryCount: 0,
      lastError: null,
      hasConflict: false,
      forceOverwrite: false,
    },
  ].slice(-40);
  saveOfflineWriteQueue(next);
  return next;
}

export function removeOfflineWriteById(queueId: string): OfflineQueuedWrite[] {
  const next = loadOfflineWriteQueue().filter((item) => item.id !== queueId);
  saveOfflineWriteQueue(next);
  return next;
}

export function removeOfflineWritesForEntry(entryId: string): OfflineQueuedWrite[] {
  const next = loadOfflineWriteQueue().filter(
    (item) => item.optimisticId !== entryId && item.payload.id !== entryId,
  );
  saveOfflineWriteQueue(next);
  return next;
}

export function markOfflineWriteForceOverwrite(queueId: string): OfflineQueuedWrite[] {
  const next = loadOfflineWriteQueue().map((item) =>
    item.id === queueId
      ? {...item, forceOverwrite: true, hasConflict: false, lastError: null}
      : item,
  );
  saveOfflineWriteQueue(next);
  return next;
}

export function describeOfflineWrite(item: OfflineQueuedWrite): {
  kindLabel: string;
  label: string;
} {
  if (item.kind === 'save_entry') {
    return {
      kindLabel: 'New Note',
      label: String(item.payload.title || 'Untitled offline note'),
    };
  }
  if (item.kind === 'update_entry') {
    return {
      kindLabel: 'Edit Note',
      label: String(item.payload.title || `Entry ${String(item.payload.id || '').slice(0, 8)}`),
    };
  }
  return {
    kindLabel: 'Trust Status',
    label: `Set status "${String(item.payload.status || 'reviewed')}" on entry ${String(item.payload.id || '').slice(0, 8)}`,
  };
}

export function saveOfflineWriteQueue(queue: OfflineQueuedWrite[]): void {
  try {
    if (queue.length === 0) {
      window.localStorage.removeItem(OFFLINE_QUEUE_KEY);
    } else {
      window.localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    }
  } catch {
    // ignore storage errors
  }
}
