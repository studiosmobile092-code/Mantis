import type {
  BrainRouteKind,
  BrainRouteStatus,
  ChatMessage,
  CurriculumDrillPacket,
  KnowledgeEntry,
  KnowledgeFolder,
  RepoFile,
} from '../types/mantis';
import {inferFolderDeterministically, normalizeFolderName} from './autoFolders';
import {retrieveRelevantKnowledge, retrieveRelevantRepoFiles, tokenizeQuery} from './memory';
import {
  extractSpeakerLabels,
  formatTranscriptLocally,
  type SpeechTurnSegment,
} from './speechEngine';
import {SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase} from './supabase';

export const DEFAULT_BRAIN_MODEL = 'Qwen/Qwen2.5-Coder-32B-Instruct';
export const DEFAULT_BACKUP_EDGE_URL = `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/mantis-brain`;

export const BRAIN_MODEL_OPTIONS: Array<{id: string; label: string}> = [
  {id: 'Qwen/Qwen2.5-Coder-32B-Instruct', label: 'Qwen 2.5 Coder 32B (Best for Code)'},
  {id: 'Qwen/Qwen3-Coder-30B-A3B-Instruct', label: 'Qwen 3 Coder 30B (Fast Coding Model)'},
  {id: 'meta-llama/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B Instruct (All-Rounder)'},
  {id: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen 2.5 72B Instruct (Deep Reasoning)'},
  {id: 'deepseek-ai/DeepSeek-V3.2', label: 'DeepSeek V3.2 (Reasoning + Code)'},
];

const STORAGE_BRAIN_URL_KEY = 'mantis_brain_worker_url';
const STORAGE_BACKUP_URL_KEY = 'mantis_brain_backup_url';
const STORAGE_BRAIN_MODEL_KEY = 'mantis_brain_model';
const STORAGE_BRAIN_MODE_KEY = 'mantis_brain_provider_mode';
const STORAGE_PREFER_BUILT_IN_KEY = 'mantis_prefer_built_in_first';

let currentRouteStatus: BrainRouteStatus = {
  activeKind: 'built-in-only',
  activeEndpoint: '',
  failoverReason: null,
  latencyMs: null,
  activeProviders: [],
  lastCheckedAt: null,
};

const routeListeners = new Set<(status: BrainRouteStatus) => void>();

let studentIsolationLocked = false;

export function setStudentIsolationLock(locked: boolean): void {
  studentIsolationLocked = locked;
}

export function isStudentIsolationLocked(): boolean {
  return studentIsolationLocked;
}

function assertNotStudentIsolated(operation: string): void {
  if (studentIsolationLocked) {
    throw new Error(
      `Blocked by Student-Only Isolation (${operation}): 0 outbound Teacher/Cloud calls permitted.`,
    );
  }
}

export function getRouteStatus(): BrainRouteStatus {
  return currentRouteStatus;
}

export function subscribeRouteStatus(listener: (status: BrainRouteStatus) => void): () => void {
  routeListeners.add(listener);
  listener(currentRouteStatus);
  return () => {
    routeListeners.delete(listener);
  };
}

function updateRouteStatus(patch: Partial<BrainRouteStatus>) {
  currentRouteStatus = {
    ...currentRouteStatus,
    ...patch,
    lastCheckedAt: new Date().toISOString(),
  };
  for (const listener of routeListeners) {
    listener(currentRouteStatus);
  }
}

export function getLocalBrainConfig(): {
  brainUrl: string;
  backupBrainUrl: string;
  model: string;
  preferBuiltInFirst: boolean;
} {
  try {
    const preferRaw = window.localStorage.getItem(STORAGE_PREFER_BUILT_IN_KEY);
    return {
      brainUrl: window.localStorage.getItem(STORAGE_BRAIN_URL_KEY) || '',
      backupBrainUrl: window.localStorage.getItem(STORAGE_BACKUP_URL_KEY) || '',
      model: window.localStorage.getItem(STORAGE_BRAIN_MODEL_KEY) || DEFAULT_BRAIN_MODEL,
      preferBuiltInFirst: preferRaw === null ? true : preferRaw === 'true',
    };
  } catch {
    return {
      brainUrl: '',
      backupBrainUrl: '',
      model: DEFAULT_BRAIN_MODEL,
      preferBuiltInFirst: true,
    };
  }
}

export function setLocalBrainConfig(
  brainUrl: string,
  model: string,
  backupBrainUrl?: string,
  preferBuiltInFirst?: boolean,
): void {
  try {
    const cleanUrl = brainUrl.trim().replace(/\/+$/, '');
    if (cleanUrl) {
      window.localStorage.setItem(STORAGE_BRAIN_URL_KEY, cleanUrl);
    } else {
      window.localStorage.removeItem(STORAGE_BRAIN_URL_KEY);
    }
    if (backupBrainUrl !== undefined) {
      const cleanBackup = backupBrainUrl.trim().replace(/\/+$/, '');
      if (cleanBackup) {
        window.localStorage.setItem(STORAGE_BACKUP_URL_KEY, cleanBackup);
      } else {
        window.localStorage.removeItem(STORAGE_BACKUP_URL_KEY);
      }
    }
    window.localStorage.setItem(STORAGE_BRAIN_MODEL_KEY, model.trim() || DEFAULT_BRAIN_MODEL);
    if (preferBuiltInFirst !== undefined) {
      window.localStorage.setItem(STORAGE_PREFER_BUILT_IN_KEY, String(preferBuiltInFirst));
    }
  } catch {
    // ignore storage errors
  }
}

export function normalizeExternalUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
}

export function normalizeBrainUrl(raw: string): string {
  let normalized = normalizeExternalUrl(raw).replace(/\/+$/, '');
  if (!normalized) return '';
  normalized = normalized.replace(
    /\/(health|ai\/verify|ai\/chat|ai\/distill|ai\/suggest|extract-url)$/i,
    '',
  );
  try {
    const parsed = new URL(normalized);
    if (
      parsed.hostname.endsWith('.supabase.co') &&
      (parsed.pathname === '' || parsed.pathname === '/')
    ) {
      return `${parsed.origin}/functions/v1/mantis-brain`;
    }
  } catch {
    // return normalized string so caller validation surfaces URL error
  }
  return normalized.replace(/\/+$/, '');
}

export function getLocalBrainMode(): 'worker' | 'ollama' {
  try {
    return window.localStorage.getItem(STORAGE_BRAIN_MODE_KEY) === 'ollama' ? 'ollama' : 'worker';
  } catch {
    return 'worker';
  }
}

function setLocalBrainMode(mode: 'worker' | 'ollama'): void {
  try {
    window.localStorage.setItem(STORAGE_BRAIN_MODE_KEY, mode);
  } catch {
    // ignore storage errors
  }
}

function isSupabaseEdgeUrl(url: string): boolean {
  return url.toLowerCase().includes('.supabase.co/functions/v1/');
}

async function resolveFreshAccessToken(
  fallbackToken?: string,
  forceRefresh = false,
): Promise<string> {
  try {
    if (forceRefresh) {
      const {data} = await supabase.auth.refreshSession();
      if (data.session?.access_token) return data.session.access_token;
    }
    const {data} = await supabase.auth.getSession();
    const session = data.session;
    if (session?.access_token) {
      const expiresAtMs = (session.expires_at ?? 0) * 1000;
      if (expiresAtMs > 0 && expiresAtMs - Date.now() < 60_000) {
        const refreshed = await supabase.auth.refreshSession();
        if (refreshed.data.session?.access_token) {
          return refreshed.data.session.access_token;
        }
      }
      return session.access_token;
    }
  } catch {
    // fall back to caller-supplied token
  }
  return fallbackToken || '';
}

function buildEndpointHeaders(endpointUrl: string, accessToken?: string): Record<string, string> {
  const headers: Record<string, string> = {'Content-Type': 'application/json'};
  if (isSupabaseEdgeUrl(endpointUrl)) {
    headers.apikey = SUPABASE_PUBLISHABLE_KEY;
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
  } else if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return headers;
}

export function isSafePublicTargetUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      !host ||
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.endsWith('.localdomain') ||
      host === 'metadata'
    ) {
      return false;
    }
    if (host.includes(':')) {
      if (
        host === '::1' ||
        host === '::' ||
        host.startsWith('fc') ||
        host.startsWith('fd') ||
        host.startsWith('fe80') ||
        host.startsWith('::ffff:')
      ) {
        return false;
      }
    }
    if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) return false;
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const a = Number(ipv4[1]);
      const b = Number(ipv4[2]);
      const c = Number(ipv4[3]);
      if (a === 0 || a === 10 || a === 127) return false;
      if (a === 100 && b >= 64 && b <= 127) return false;
      if (a === 169 && b === 254) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
      if (a === 192 && b === 0 && c === 0) return false;
      if (a >= 224) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function normalizeFetchError(err: unknown, timeoutMs: number, endpointLabel?: string): Error {
  const secs = Math.max(1, Math.round(timeoutMs / 1000));
  const rawMsg = err instanceof Error ? err.message : String(err || '');
  const lower = rawMsg.toLowerCase();
  const isDomAbort =
    typeof DOMException !== 'undefined' &&
    err instanceof DOMException &&
    err.name === 'AbortError';
  if (
    isDomAbort ||
    (err instanceof Error && err.name === 'AbortError') ||
    lower.includes('signal is aborted') ||
    lower.includes('aborted') ||
    lower.includes('timed out')
  ) {
    return new Error(
      endpointLabel
        ? `Timed out after ${secs}s waiting for ${endpointLabel}. Upstream AI provider may be slow or blocked on this network.`
        : `Request timed out after ${secs}s while waiting for AI response.`,
    );
  }
  return err instanceof Error ? err : new Error(rawMsg || 'Network request failed.');
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 7500,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutReason = new Error(
    `Request timed out after ${Math.max(1, Math.round(timeoutMs / 1000))}s`,
  );
  const timer = window.setTimeout(() => controller.abort(timeoutReason), timeoutMs);
  try {
    return await fetch(url, {...init, signal: controller.signal});
  } catch (err) {
    throw normalizeFetchError(err, timeoutMs);
  } finally {
    window.clearTimeout(timer);
  }
}

export interface EndpointTestResult {
  ok: boolean;
  endpointUrl: string;
  routeKind: BrainRouteKind;
  hasHfToken: boolean;
  hasAnyProvider: boolean;
  activeProviders: string[];
  defaultModel: string;
  inferenceVerified: boolean;
  verifiedModel?: string;
  latencyMs: number;
}

export async function testBrainConnection(
  brainUrl: string,
  accessToken?: string,
  preferredModel?: string,
  routeKindHint?: BrainRouteKind,
): Promise<EndpointTestResult> {
  const cleanUrl = normalizeBrainUrl(brainUrl);
  if (!cleanUrl) {
    throw new Error('Enter your Cloudflare Worker, Supabase Edge Function, or Ollama URL.');
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(cleanUrl);
    if (!parsedUrl.hostname.includes('.') && parsedUrl.hostname !== 'localhost') {
      throw new Error('Invalid host');
    }
  } catch {
    throw new Error('Enter a valid URL (e.g. mantis-brain.garrettwins3.workers.dev or https://...supabase.co/functions/v1/mantis-brain).');
  }

  const isBackup = routeKindHint === 'backup-supabase' || isSupabaseEdgeUrl(cleanUrl);
  const healthTimeoutMs = parsedUrl.hostname.endsWith('.workers.dev') ? 5000 : 7500;
  const start = performance.now();
  let res: Response;
  try {
    // Keep /health headerless (matching a direct browser GET) so expired JWTs or apikey headers never trigger gateway 401s.
    res = await fetchWithTimeout(`${cleanUrl}/health`, {}, healthTimeoutMs);
  } catch (networkErr) {
    const normalized = normalizeFetchError(networkErr, healthTimeoutMs, parsedUrl.hostname);
    throw new Error(`Could not reach ${cleanUrl}: ${normalized.message}`);
  }

  const latencyMs = Math.round(performance.now() - start);
  const contentType = res.headers.get('content-type') || '';

  if (res.status === 404 && !isBackup) {
    const ollamaTagsRes = await fetchWithTimeout(`${cleanUrl}/api/tags`, {}, 4000).catch(() => null);
    if (ollamaTagsRes && ollamaTagsRes.ok) {
      const tagsData = (await ollamaTagsRes.json().catch(() => ({}))) as {
        models?: Array<{name?: string}>;
      };
      const installed = (tagsData.models || []).map((m) => m.name).filter((n): n is string => Boolean(n));
      if (installed.length === 0) {
        throw new Error('Connected to Ollama, but no models are installed yet (run e.g. `ollama pull qwen2.5-coder:7b`).');
      }
      const chosenOllamaModel = installed[0];
      let pingRes: Response;
      try {
        pingRes = await fetchWithTimeout(
          `${cleanUrl}/v1/chat/completions`,
          {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              model: chosenOllamaModel,
              messages: [{role: 'user', content: 'Reply with only READY.'}],
              max_tokens: 16,
            }),
          },
          15000,
        );
      } catch (err) {
        throw normalizeFetchError(err, 15000, 'local Ollama');
      }
      if (!pingRes.ok) {
        throw new Error(`Ollama chat test returned HTTP ${pingRes.status}.`);
      }
      setLocalBrainMode('ollama');
      return {
        ok: true,
        endpointUrl: cleanUrl,
        routeKind: 'ollama-direct',
        hasHfToken: false,
        hasAnyProvider: true,
        activeProviders: ['ollama-direct'],
        defaultModel: chosenOllamaModel,
        inferenceVerified: true,
        verifiedModel: `ollama/${chosenOllamaModel}`,
        latencyMs: Math.round(performance.now() - start),
      };
    }
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      errText
        ? `Health check returned HTTP ${res.status}: ${errText.slice(0, 140)}`
        : `Health check returned HTTP ${res.status}.`,
    );
  }
  if (!contentType.includes('application/json')) {
    throw new Error(
      'This URL returned HTML instead of Mantis AI Brain JSON. Verify the Worker or Edge Function deployment.',
    );
  }

  const data = (await res.json()) as {
    ok?: boolean;
    service?: string;
    hasHfToken?: boolean;
    hasAnyProvider?: boolean;
    activeProviders?: string[];
    defaultModel?: string;
  };
  if (data.service !== 'mantis-ai-brain') {
    throw new Error('URL responded, but it is not running Mantis AI Brain.');
  }

  if (!isBackup) setLocalBrainMode('worker');
  const hasHfToken = Boolean(data.hasHfToken);
  const activeProviders = Array.isArray(data.activeProviders)
    ? data.activeProviders
    : hasHfToken
      ? ['huggingface']
      : [];
  const hasAnyProvider =
    typeof data.hasAnyProvider === 'boolean' ? data.hasAnyProvider : activeProviders.length > 0;
  const resolvedKind: BrainRouteKind = isBackup ? 'backup-supabase' : 'primary-worker';

  let liveToken = await resolveFreshAccessToken(accessToken);
  if (!hasAnyProvider || !liveToken) {
    return {
      ok: Boolean(data.ok),
      endpointUrl: cleanUrl,
      routeKind: resolvedKind,
      hasHfToken,
      hasAnyProvider,
      activeProviders,
      defaultModel: data.defaultModel || DEFAULT_BRAIN_MODEL,
      inferenceVerified: false,
      latencyMs,
    };
  }

  const verifyTimeoutMs = 22000;
  let verifyRes: Response;
  try {
    verifyRes = await fetchWithTimeout(
      `${cleanUrl}/ai/verify`,
      {
        method: 'POST',
        headers: buildEndpointHeaders(cleanUrl, liveToken),
        body: JSON.stringify({model: preferredModel || data.defaultModel || DEFAULT_BRAIN_MODEL}),
      },
      verifyTimeoutMs,
    );

    if (verifyRes.status === 401) {
      liveToken = await resolveFreshAccessToken(liveToken, true);
      verifyRes = await fetchWithTimeout(
        `${cleanUrl}/ai/verify`,
        {
          method: 'POST',
          headers: buildEndpointHeaders(cleanUrl, liveToken),
          body: JSON.stringify({model: preferredModel || data.defaultModel || DEFAULT_BRAIN_MODEL}),
        },
        verifyTimeoutMs,
      );
    }

    if (verifyRes.status === 404) {
      verifyRes = await fetchWithTimeout(
        `${cleanUrl}/ai/chat`,
        {
          method: 'POST',
          headers: buildEndpointHeaders(cleanUrl, liveToken),
          body: JSON.stringify({
            prompt: 'Reply with only the word READY.',
            model: preferredModel || data.defaultModel || DEFAULT_BRAIN_MODEL,
            knowledgeContext: [],
            repoContext: [],
            history: [],
          }),
        },
        verifyTimeoutMs,
      );
    }
  } catch (err) {
    throw normalizeFetchError(err, verifyTimeoutMs, `${parsedUrl.hostname} AI verification`);
  }

  const totalLatencyMs = Math.round(performance.now() - start);
  const verifyPayload = (await verifyRes.json().catch(() => ({}))) as {
    ok?: boolean;
    reply?: string;
    model?: string;
    error?: string;
  };
  if (!verifyRes.ok) {
    throw new Error(
      verifyPayload.error || `AI inference check failed with HTTP ${verifyRes.status}.`,
    );
  }

  return {
    ok: Boolean(data.ok),
    endpointUrl: cleanUrl,
    routeKind: resolvedKind,
    hasHfToken,
    hasAnyProvider: true,
    activeProviders,
    defaultModel: data.defaultModel || DEFAULT_BRAIN_MODEL,
    inferenceVerified: true,
    verifiedModel: verifyPayload.model || preferredModel || data.defaultModel || DEFAULT_BRAIN_MODEL,
    latencyMs: totalLatencyMs,
  };
}

/**
 * Probes Primary (Cloudflare .workers.dev) and automatically fails over to
 * Chromebook-safe Backup (.supabase.co/functions/v1/mantis-brain) if Primary is blocked.
 */
export async function probeActiveBrainRoute(params: {
  brainUrl: string;
  backupBrainUrl: string;
  accessToken?: string;
  preferredModel?: string;
}): Promise<BrainRouteStatus> {
  const primary = normalizeBrainUrl(params.brainUrl);
  const backup = normalizeBrainUrl(params.backupBrainUrl);

  if (!primary && !backup) {
    const status: BrainRouteStatus = {
      activeKind: 'built-in-only',
      activeEndpoint: '',
      failoverReason: null,
      latencyMs: null,
      activeProviders: [],
      lastCheckedAt: new Date().toISOString(),
    };
    updateRouteStatus(status);
    return status;
  }

  let primaryFailureReason: string | null = null;

  if (primary) {
    try {
      const res = await testBrainConnection(
        primary,
        params.accessToken,
        params.preferredModel,
        primary.includes('localhost:11434') || primary.includes('127.0.0.1:11434')
          ? 'ollama-direct'
          : 'primary-worker',
      );
      const status: BrainRouteStatus = {
        activeKind: res.routeKind,
        activeEndpoint: res.endpointUrl,
        failoverReason: null,
        latencyMs: res.latencyMs,
        activeProviders: res.activeProviders,
        lastCheckedAt: new Date().toISOString(),
      };
      updateRouteStatus(status);
      return status;
    } catch (err) {
      primaryFailureReason =
        err instanceof Error ? err.message : 'Primary endpoint unreachable';
    }
  }

  if (backup) {
    try {
      const backupRes = await testBrainConnection(
        backup,
        params.accessToken,
        params.preferredModel,
        'backup-supabase',
      );
      const status: BrainRouteStatus = {
        activeKind: 'backup-supabase',
        activeEndpoint: backupRes.endpointUrl,
        failoverReason: primaryFailureReason
          ? `Primary blocked/unreachable -> auto-routed via Chromebook Backup`
          : null,
        latencyMs: backupRes.latencyMs,
        activeProviders: backupRes.activeProviders,
        lastCheckedAt: new Date().toISOString(),
      };
      updateRouteStatus(status);
      return status;
    } catch (backupErr) {
      updateRouteStatus({
        activeKind: 'built-in-only',
        activeEndpoint: '',
        failoverReason: backupErr instanceof Error ? backupErr.message : primaryFailureReason,
        latencyMs: null,
        activeProviders: [],
      });
      return currentRouteStatus;
    }
  }

  updateRouteStatus({
    activeKind: 'built-in-only',
    activeEndpoint: '',
    failoverReason: primaryFailureReason,
    latencyMs: null,
    activeProviders: [],
  });
  return currentRouteStatus;
}

function getOrderedCandidateEndpoints(brainUrl: string, backupBrainUrl?: string): string[] {
  const candidates: string[] = [];
  const active = currentRouteStatus.activeEndpoint;
  const primary = normalizeBrainUrl(brainUrl);
  const backup = normalizeBrainUrl(backupBrainUrl || '');

  // If failover already discovered backup works on this Chromebook session, try active first!
  if (active && (active === primary || active === backup)) {
    candidates.push(active);
  }
  if (primary && !candidates.includes(primary)) {
    candidates.push(primary);
  }
  if (backup && !candidates.includes(backup)) {
    candidates.push(backup);
  }
  return candidates;
}

async function postBrainEndpointWithFailover<T>(params: {
  brainUrl: string;
  backupBrainUrl?: string;
  accessToken: string;
  path: string;
  body: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<{payload: T; endpointUsed: string}> {
  assertNotStudentIsolated(params.path);
  const candidates = getOrderedCandidateEndpoints(params.brainUrl, params.backupBrainUrl);
  if (candidates.length === 0) {
    throw new Error('No Cloud Assist endpoint configured. Add Worker or Supabase Backup URL in Settings.');
  }

  let liveToken = await resolveFreshAccessToken(params.accessToken);
  let lastError = 'Cloud endpoint unreachable';
  for (let i = 0; i < candidates.length; i += 1) {
    const endpoint = candidates[i];
    const start = performance.now();
    try {
      let res = await fetchWithTimeout(
        `${endpoint}${params.path}`,
        {
          method: 'POST',
          headers: buildEndpointHeaders(endpoint, liveToken),
          body: JSON.stringify(params.body),
        },
        params.timeoutMs ?? 20000,
      );

      if (res.status === 401) {
        liveToken = await resolveFreshAccessToken(liveToken, true);
        res = await fetchWithTimeout(
          `${endpoint}${params.path}`,
          {
            method: 'POST',
            headers: buildEndpointHeaders(endpoint, liveToken),
            body: JSON.stringify(params.body),
          },
          params.timeoutMs ?? 20000,
        );
      }

      const json = (await res.json().catch(() => ({}))) as T & {error?: string; message?: string};
      if (!res.ok) {
        lastError = json.error || json.message || `HTTP ${res.status} from ${endpoint}`;
        continue;
      }

      const kind: BrainRouteKind = isSupabaseEdgeUrl(endpoint)
        ? 'backup-supabase'
        : endpoint.includes('11434')
          ? 'ollama-direct'
          : 'primary-worker';
      updateRouteStatus({
        activeKind: kind,
        activeEndpoint: endpoint,
        failoverReason: i > 0 ? 'Auto-switched to Chromebook Backup (.supabase.co)' : currentRouteStatus.failoverReason,
        latencyMs: Math.round(performance.now() - start),
      });
      return {payload: json, endpointUsed: endpoint};
    } catch (err) {
      lastError = normalizeFetchError(err, params.timeoutMs ?? 20000, endpoint).message;
    }
  }

  throw new Error(lastError);
}

export interface ParsedLearnDirective {
  title: string;
  folderName: string;
  tags: string[];
  content: string;
}

export function parseLearnDirectives(replyText: string): {
  cleanReply: string;
  learnedItems: ParsedLearnDirective[];
} {
  const learnedItems: ParsedLearnDirective[] = [];
  const lines = replyText.split('\n');
  const keptLines: string[] = [];

  for (const line of lines) {
    const match = line.trim().match(/^\[LEARN:\s*([^|]+)\|([^|]+)\|([^|]*)\|([^\]]+)\]$/i);
    if (match) {
      const title = match[1].trim();
      const folderName = match[2].trim();
      const tags = match[3]
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      const content = match[4].trim();
      if (title && content) {
        learnedItems.push({title, folderName, tags, content});
        continue;
      }
    }
    keptLines.push(line);
  }

  return {
    cleanReply: keptLines.join('\n').trim(),
    learnedItems,
  };
}

async function callDirectOllamaChat(
  ollamaUrl: string,
  messages: Array<{role: string; content: string}>,
  maxTokens = 1400,
): Promise<{text: string; model: string}> {
  assertNotStudentIsolated('ollama/chat');
  let chosenModel = 'qwen2.5-coder:7b';
  try {
    const tagsRes = await fetchWithTimeout(`${ollamaUrl}/api/tags`, {}, 3000);
    if (tagsRes.ok) {
      const tagsData = (await tagsRes.json()) as {models?: Array<{name?: string}>};
      const first = (tagsData.models || []).find((m) => Boolean(m.name))?.name;
      if (first) chosenModel = first;
    }
  } catch {
    // use fallback model name
  }

  const res = await fetchWithTimeout(
    `${ollamaUrl}/v1/chat/completions`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: chosenModel,
        messages,
        max_tokens: maxTokens,
        temperature: 0.25,
      }),
    },
    30000,
  );
  const payload = (await res.json().catch(() => ({}))) as {
    choices?: Array<{message?: {content?: string}}>;
    error?: {message?: string} | string;
  };
  const text = payload?.choices?.[0]?.message?.content?.trim();
  if (!res.ok || !text) {
    const errMsg =
      typeof payload.error === 'string' ? payload.error : payload.error?.message || `HTTP ${res.status}`;
    throw new Error(`Ollama inference error: ${errMsg}`);
  }
  return {text, model: `ollama/${chosenModel}`};
}

export async function askAiBrainChat(params: {
  brainUrl: string;
  backupBrainUrl?: string;
  accessToken: string;
  model: string;
  prompt: string;
  entries: KnowledgeEntry[];
  folders: KnowledgeFolder[];
  repoFiles: RepoFile[];
  history: ChatMessage[];
}): Promise<{
  replyText: string;
  modelUsed: string;
  citedEntryIds: string[];
  citedRepoPaths: string[];
  learnedItems: ParsedLearnDirective[];
}> {
  assertNotStudentIsolated('askAiBrainChat');
  const cleanUrl = normalizeBrainUrl(params.brainUrl);
  const folderMap = new Map(params.folders.map((f) => [f.id, f.name]));

  const knowledgeMatches = retrieveRelevantKnowledge(
    params.prompt,
    params.entries,
    params.folders,
    6,
  );
  const repoMatches = retrieveRelevantRepoFiles(params.prompt, params.repoFiles, 4);

  if (
    getLocalBrainMode() === 'ollama' ||
    cleanUrl.includes('localhost:11434') ||
    cleanUrl.includes('127.0.0.1:11434')
  ) {
    const systemPrompt = [
      'You are Mantis Cloud Assist, helping the built-in Mantis Studio engine. Ground your answers in the user Knowledge and Repo snippets below.',
      'If the user teaches a reusable preference, fact, or fix, end with: [LEARN: Short Title | Folder | tag1, tag2 | Concise note]',
      knowledgeMatches.length > 0
        ? `KNOWLEDGE:\n${knowledgeMatches
            .map((m) => `- [${m.folderName}] ${m.entry.title}: ${m.entry.content}`)
            .join('\n')}`
        : '',
      repoMatches.length > 0
        ? `REPO FILES:\n${repoMatches
            .map((r) => `--- ${r.file.path} ---\n${r.file.content.slice(0, 2200)}`)
            .join('\n\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const direct = await callDirectOllamaChat(cleanUrl, [
      {role: 'system', content: systemPrompt},
      ...params.history.slice(-6).map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
      {role: 'user', content: params.prompt},
    ]);
    const {cleanReply, learnedItems} = parseLearnDirectives(direct.text);
    return {
      replyText: cleanReply,
      modelUsed: direct.model,
      citedEntryIds: knowledgeMatches.map((m) => m.entry.id),
      citedRepoPaths: repoMatches.map((r) => r.file.path),
      learnedItems,
    };
  }

  const {payload} = await postBrainEndpointWithFailover<{
    reply?: string;
    model?: string;
    error?: string;
  }>({
    brainUrl: params.brainUrl,
    backupBrainUrl: params.backupBrainUrl,
    accessToken: params.accessToken,
    path: '/ai/chat',
    body: {
      prompt: params.prompt,
      model: params.model,
      knowledgeContext: knowledgeMatches.map((m) => ({
        title: m.entry.title,
        folder: m.folderName || (m.entry.folder_id ? folderMap.get(m.entry.folder_id) : 'General'),
        content: m.entry.content,
      })),
      repoContext: repoMatches.map((r) => ({
        path: r.file.path,
        content: r.file.content,
      })),
      history: params.history.slice(-8).map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
    },
  });

  if (!payload.reply) {
    throw new Error(payload.error || 'AI Brain returned an empty reply.');
  }

  const {cleanReply, learnedItems} = parseLearnDirectives(payload.reply);
  return {
    replyText: cleanReply,
    modelUsed: payload.model || params.model,
    citedEntryIds: knowledgeMatches.map((m) => m.entry.id),
    citedRepoPaths: repoMatches.map((r) => r.file.path),
    learnedItems,
  };
}

export interface DistilledKnowledgeItem {
  title: string;
  folder: string;
  tags: string[];
  content: string;
}

export async function distillWithAiBrain(params: {
  brainUrl: string;
  backupBrainUrl?: string;
  accessToken: string;
  model: string;
  text: string;
  sourceTitle: string;
  sourceType: string;
}): Promise<{summary: string; entries: DistilledKnowledgeItem[]; model: string}> {
  assertNotStudentIsolated('distillWithAiBrain');
  const cleanUrl = normalizeBrainUrl(params.brainUrl);

  if (getLocalBrainMode() === 'ollama') {
    const direct = await callDirectOllamaChat(cleanUrl, [
      {
        role: 'system',
        content:
          'Convert the raw text into JSON: {"summary":"...","entries":[{"title":"...","folder":"Patterns","tags":["..."],"content":"..."}]}.',
      },
      {role: 'user', content: `Source: ${params.sourceTitle}\n\n${params.text.slice(0, 12000)}`},
    ]);
    const parsed = parseJsonObjectFromAiReply<{
      summary?: string;
      entries?: DistilledKnowledgeItem[];
    }>(direct.text);
    if (!parsed) {
      throw new Error('Ollama returned non-JSON output during distillation.');
    }
    return {
      summary: parsed.summary || '',
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      model: direct.model,
    };
  }

  const {payload} = await postBrainEndpointWithFailover<{
    summary?: string;
    entries?: DistilledKnowledgeItem[];
    model?: string;
    error?: string;
  }>({
    brainUrl: params.brainUrl,
    backupBrainUrl: params.backupBrainUrl,
    accessToken: params.accessToken,
    path: '/ai/distill',
    body: {
      text: params.text,
      sourceTitle: params.sourceTitle,
      sourceType: params.sourceType,
      model: params.model,
    },
  });

  if (!Array.isArray(payload.entries)) {
    throw new Error(payload.error || 'AI Distillation failed.');
  }
  return {
    summary: payload.summary || '',
    entries: payload.entries,
    model: payload.model || params.model,
  };
}

export async function suggestCodeWithAiBrain(params: {
  brainUrl: string;
  backupBrainUrl?: string;
  accessToken: string;
  model: string;
  filePath: string;
  originalContent: string;
  goal: string;
  entries: KnowledgeEntry[];
  folders: KnowledgeFolder[];
}): Promise<{title: string; rationale: string; proposedContent: string; model: string}> {
  assertNotStudentIsolated('suggestCodeWithAiBrain');
  const cleanUrl = normalizeBrainUrl(params.brainUrl);
  const matches = retrieveRelevantKnowledge(
    `${params.filePath} ${params.goal}`,
    params.entries,
    params.folders,
    4,
  );

  if (getLocalBrainMode() === 'ollama') {
    const direct = await callDirectOllamaChat(
      cleanUrl,
      [
        {
          role: 'system',
          content:
            'Respond strictly with JSON {"title":"...","rationale":"...","proposedContent":"..."} where proposedContent is complete updated file text.',
        },
        {
          role: 'user',
          content: `File: ${params.filePath}\nGoal: ${params.goal}\n\n${params.originalContent.slice(0, 12000)}`,
        },
      ],
      2200,
    );
    const parsed = parseJsonObjectFromAiReply<{
      title?: string;
      rationale?: string;
      proposedContent?: string;
    }>(direct.text);
    if (!parsed) {
      throw new Error('Ollama returned non-JSON code suggestion output.');
    }
    return {
      title: parsed.title || `Ollama Proposal: ${params.filePath}`,
      rationale: parsed.rationale || `Generated by ${direct.model}`,
      proposedContent: parsed.proposedContent || params.originalContent,
      model: direct.model,
    };
  }

  const {payload} = await postBrainEndpointWithFailover<{
    title?: string;
    rationale?: string;
    proposedContent?: string;
    model?: string;
    error?: string;
  }>({
    brainUrl: params.brainUrl,
    backupBrainUrl: params.backupBrainUrl,
    accessToken: params.accessToken,
    path: '/ai/suggest',
    body: {
      filePath: params.filePath,
      originalContent: params.originalContent,
      goal: params.goal,
      model: params.model,
      knowledgeContext: matches.map((m) => ({
        title: m.entry.title,
        content: m.entry.content,
      })),
    },
  });

  if (!payload.proposedContent) {
    throw new Error(payload.error || 'AI suggestion failed.');
  }
  return {
    title: payload.title || `AI Proposal: ${params.filePath}`,
    rationale: payload.rationale || `Generated with ${payload.model || params.model}`,
    proposedContent: payload.proposedContent,
    model: payload.model || params.model,
  };
}

const READABILITY_NOISE_LINE_RE =
  /^(skip to (main )?content|menu|navigation|search|sign in|sign up|log in|log out|subscribe|subscribe to our newsletter|cookie policy|accept all( cookies)?|reject all|manage cookies|privacy policy|terms of service|terms of use|share on (twitter|x|linkedin|facebook|reddit|email)|table of contents|back to top|was this page helpful\??|edit this page on github|advertisement|sponsored)$/i;

/**
 * Strips web chrome, cookie/nav boilerplate, and inline link noise from extracted article text
 * while keeping headings, lists, and fenced code blocks intact.
 */
export function cleanExtractedArticleText(
  raw: string,
  fallbackTitle = '',
): {title: string; text: string} {
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  const titleMatch = normalized.match(/^Title:\s*(.+)$/m);
  const headerTitle = titleMatch ? titleMatch[1].trim() : '';

  const withoutMetaHeaders = normalized
    .replace(/^Title:.*$/gm, '')
    .replace(/^URL Source:.*$/gm, '')
    .replace(/^Published Time:.*$/gm, '')
    .replace(/^Markdown Content:\s*$/gm, '')
    .replace(/^Warning:.*$/gm, '')
    .trim();

  // Split by fenced code blocks so code snippets are never altered
  const segments = withoutMetaHeaders.split(/(```[\s\S]*?```)/g);
  const cleanedSegments = segments.map((segment, index) => {
    if (index % 2 === 1) {
      return segment.trim();
    }

    const lines = segment
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return '';
        if (READABILITY_NOISE_LINE_RE.test(trimmed)) return '';
        if (/^!\[[^\]]{0,24}\]\([^)]+\)$/.test(trimmed)) return '';
        if (/^\[\]\([^)]+\)$/.test(trimmed)) return '';
        if (/^[-*_]{3,}$/.test(trimmed)) return '';
        // Strip distracting inline URL targets outside code blocks while keeping link labels
        return trimmed.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_m, label: string) =>
          label.trim(),
        );
      })
      .filter((line, idx, arr) => {
        if (line !== '') return true;
        // Collapse consecutive blank lines
        return idx > 0 && arr[idx - 1] !== '';
      });

    return lines.join('\n').trim();
  });

  const body = cleanedSegments
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 35000);

  const headingMatch = body.match(/^#{1,2}\s+(.+)$/m);
  const resolvedTitle =
    headerTitle && !/^(just a moment|404|access denied)/i.test(headerTitle)
      ? headerTitle
      : headingMatch?.[1]?.trim() || fallbackTitle;

  return {
    title: resolvedTitle,
    text: body,
  };
}

function htmlToReadableText(html: string, url: string): {title: string; text: string} | null {
  try {
    if (typeof DOMParser === 'undefined') return null;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const title = doc.querySelector('title')?.textContent?.trim() || url;

    const removeSelectors = [
      'script',
      'style',
      'noscript',
      'svg',
      'nav',
      'header',
      'footer',
      'aside',
      '[role="navigation"]',
      '[role="banner"]',
      '[role="contentinfo"]',
    ];
    for (const sel of removeSelectors) {
      doc.querySelectorAll(sel).forEach((el) => el.remove());
    }

    const mainEl = doc.querySelector('article, main, [role="main"]') || doc.body;
    if (!mainEl) return null;

    const blocks: string[] = [];
    mainEl.querySelectorAll('h1, h2, h3, h4, p, li, pre').forEach((node) => {
      const tag = node.tagName.toLowerCase();
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length < 3 || READABILITY_NOISE_LINE_RE.test(text)) return;
      if (tag === 'h1') blocks.push(`# ${text}`);
      else if (tag === 'h2') blocks.push(`## ${text}`);
      else if (tag === 'h3' || tag === 'h4') blocks.push(`### ${text}`);
      else if (tag === 'li') blocks.push(`- ${text}`);
      else if (tag === 'pre') blocks.push(`\`\`\`\n${(node.textContent || '').trim()}\n\`\`\``);
      else blocks.push(text);
    });

    const combined = blocks.join('\n\n').trim().slice(0, 35000);
    if (combined.length < 90) return null;
    return {title, text: combined};
  } catch {
    return null;
  }
}

/**
 * Browser fallback reader when neither Worker nor Backup Edge Function is available yet:
 * Tries CORS-friendly Markdown reader (r.jina.ai) and direct readable HTML/plain-text fetch.
 */
async function extractUrlClientFallback(
  url: string,
): Promise<{
  kind: 'youtube' | 'article';
  url: string;
  title: string;
  text: string;
  extractedAt: string;
} | null> {
  const isYt = /youtube\.com|youtu\.be/i.test(url);
  const extractedAt = new Date().toISOString();
  if (!isSafePublicTargetUrl(url)) {
    return null;
  }

  try {
    const readerRes = await fetchWithTimeout(
      `https://r.jina.ai/${url}`,
      {headers: {Accept: 'text/plain, text/markdown'}},
      12000,
    );
    if (readerRes.ok) {
      const raw = await readerRes.text();
      if (raw.trim().length >= 90) {
        const cleaned = cleanExtractedArticleText(raw, url);
        if (cleaned.text.length >= 90) {
          return {
            kind: isYt ? 'youtube' : 'article',
            url,
            title: cleaned.title || url,
            text: cleaned.text,
            extractedAt,
          };
        }
      }
    }
  } catch {
    // ignore CORS or network errors on fallback reader
  }

  if (!isYt) {
    try {
      const directRes = await fetchWithTimeout(url, {}, 9000);
      if (directRes.ok) {
        const contentType = (directRes.headers.get('content-type') || '').toLowerCase();
        const body = await directRes.text();
        if (contentType.includes('text/html')) {
          const parsed = htmlToReadableText(body, url);
          if (parsed) {
            return {
              kind: 'article',
              url,
              title: parsed.title,
              text: parsed.text,
              extractedAt,
            };
          }
        } else if (body.trim().length >= 90) {
          const cleaned = cleanExtractedArticleText(body, url);
          if (cleaned.text.length >= 90) {
            return {
              kind: 'article',
              url,
              title: cleaned.title || url,
              text: cleaned.text,
              extractedAt,
            };
          }
        }
      }
    } catch {
      // ignore CORS restrictions on direct fetch
    }
  }

  return null;
}

export async function extractUrlViaBrain(params: {
  brainUrl: string;
  backupBrainUrl?: string;
  accessToken: string;
  url: string;
}): Promise<{
  kind: 'youtube' | 'article';
  url: string;
  title: string;
  text: string;
  extractedAt: string;
}> {
  if (!isSafePublicTargetUrl(params.url)) {
    throw new Error('Enter a valid public http:// or https:// website or YouTube URL.');
  }
  const candidates = getOrderedCandidateEndpoints(params.brainUrl, params.backupBrainUrl);
  const extractedAt = new Date().toISOString();

  if (candidates.length > 0) {
    try {
      const {payload} = await postBrainEndpointWithFailover<{
        kind?: 'youtube' | 'article';
        url?: string;
        title?: string;
        text?: string;
        error?: string;
      }>({
        brainUrl: params.brainUrl,
        backupBrainUrl: params.backupBrainUrl,
        accessToken: params.accessToken,
        path: '/extract-url',
        body: {url: params.url},
        timeoutMs: 22000,
      });

      if (payload.text) {
        const kind = payload.kind || (/youtube\.com|youtu\.be/i.test(params.url) ? 'youtube' : 'article');
        if (kind === 'article') {
          const cleaned = cleanExtractedArticleText(payload.text, payload.title || params.url);
          return {
            kind,
            url: payload.url || params.url,
            title: cleaned.title || payload.title || params.url,
            text: cleaned.text || payload.text,
            extractedAt,
          };
        }
        return {
          kind,
          url: payload.url || params.url,
          title: payload.title || params.url,
          text: payload.text.trim(),
          extractedAt,
        };
      }
    } catch (backendErr) {
      // Try browser CORS-safe reader fallback for articles before failing
      const fallback = await extractUrlClientFallback(params.url);
      if (fallback) {
        return fallback;
      }
      throw backendErr;
    }
  }

  const fallback = await extractUrlClientFallback(params.url);
  if (fallback) {
    return fallback;
  }

  throw new Error(
    'Could not fetch that link directly from the browser. Add your Chromebook Supabase Backup URL in Settings (non-.dev) so Mantis can extract YouTube transcripts & protected articles.',
  );
}

function parseJsonObjectFromAiReply<T>(raw: string): T | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

async function runLightweightAiJsonPrompt(params: {
  brainUrl: string;
  backupBrainUrl?: string;
  accessToken: string;
  model: string;
  prompt: string;
  knowledgeContext?: Array<{title: string; folder: string; content: string}>;
  timeoutMs?: number;
}): Promise<{text: string; modelUsed: string}> {
  const cleanUrl = normalizeBrainUrl(params.brainUrl);
  if (
    getLocalBrainMode() === 'ollama' ||
    cleanUrl.includes('localhost:11434') ||
    cleanUrl.includes('127.0.0.1:11434')
  ) {
    const direct = await callDirectOllamaChat(
      cleanUrl,
      [
        {
          role: 'system',
          content:
            'You are Mantis Studio structured JSON engine. Return ONLY valid raw JSON with no markdown commentary.',
        },
        {role: 'user', content: params.prompt},
      ],
      1100,
    );
    return {text: direct.text, modelUsed: direct.model};
  }

  const {payload} = await postBrainEndpointWithFailover<{
    reply?: string;
    model?: string;
    error?: string;
  }>({
    brainUrl: params.brainUrl,
    backupBrainUrl: params.backupBrainUrl,
    accessToken: params.accessToken,
    path: '/ai/chat',
    body: {
      prompt: params.prompt,
      model: params.model,
      knowledgeContext: params.knowledgeContext || [],
      repoContext: [],
      history: [],
    },
    timeoutMs: params.timeoutMs ?? 9500,
  });

  if (!payload.reply) {
    throw new Error(payload.error || 'AI helper returned empty response.');
  }
  return {text: payload.reply, modelUsed: payload.model || params.model};
}

export interface SpeechEnhancementResult {
  cleanedTranscript: string;
  detectedSpeakers: string[];
  speakerCount: number;
  suggestedTitle: string;
  suggestedFolder: string;
  folderDescription: string;
  tags: string[];
  aiEnhanced: boolean;
  modelUsed: string;
}

/**
 * Cleans rapid live speech, fixes STT homophones using user knowledge context,
 * segments multiple speakers using acoustic hints + conversational turn shifts,
 * and suggests a semantic Auto-Folder (e.g. Food, Greetings, Debugging).
 */
export async function enhanceSpeechTranscriptWithAi(params: {
  brainUrl: string;
  backupBrainUrl?: string;
  accessToken: string;
  model: string;
  turns: SpeechTurnSegment[];
  rawLines: string[];
  entries: KnowledgeEntry[];
  existingFolders: KnowledgeFolder[];
}): Promise<SpeechEnhancementResult> {
  const localFormatted = formatTranscriptLocally(params.turns, params.rawLines);
  const rawCombined = localFormatted.cleanedTranscript || params.rawLines.join('\n').trim();
  const deterministicFolder = inferFolderDeterministically(
    '',
    rawCombined,
    params.existingFolders,
  );

  const candidates = studentIsolationLocked
    ? []
    : getOrderedCandidateEndpoints(params.brainUrl, params.backupBrainUrl);
  if (candidates.length === 0 || !rawCombined) {
    return {
      cleanedTranscript: rawCombined,
      detectedSpeakers: localFormatted.detectedSpeakers,
      speakerCount: Math.max(1, localFormatted.detectedSpeakers.length),
      suggestedTitle: localFormatted.suggestedTitle,
      suggestedFolder: deterministicFolder.folderName,
      folderDescription: deterministicFolder.description,
      tags: ['voice', 'conversation', ...deterministicFolder.suggestedTags].slice(0, 5),
      aiEnhanced: false,
      modelUsed: 'built-in-speech',
    };
  }

  const folderNames = params.existingFolders.map((f) => f.name).join(', ') || 'Captured Learning';
  const relevantKnowledge = retrieveRelevantKnowledge(
    rawCombined.slice(0, 400),
    params.entries,
    params.existingFolders,
    4,
  );

  const acousticTimeline =
    params.turns.length > 0
      ? params.turns
          .slice(0, 60)
          .map(
            (t, idx) =>
              `${idx + 1}. [${t.acousticSpeaker} | ${t.centroidHz}Hz | pause=${t.pauseBeforeMs}ms] ${t.rawText}`,
          )
          .join('\n')
      : rawCombined;

  const prompt = [
    'Clean and format this live speech transcript into valid JSON ONLY.',
    'Tasks:',
    '1. Fix broken fast-speech fragments, run-on sentences, punctuation, and obvious speech-to-text homophones without inventing facts.',
    '2. Detect whether 1 person or 2+ different speakers are talking using BOTH acoustic speaker hints and conversational switches (questions/answers, topic handoffs, greetings/replies).',
    '3. If 2+ speakers exist, prefix each turn cleanly with "Speaker 1:", "Speaker 2:", etc. (or real speaker names if explicitly spoken in the conversation). If clearly only 1 speaker, keep clean paragraphs or prefix with "Speaker 1:".',
    '4. Suggest a concise topic folder name (1-2 words Title Case, e.g. "Food", "Greetings", "Architecture", "Debugging", "Language & Speech", or pick an existing folder if it fits well) and a 1-sentence folder description.',
    `Existing folders: ${folderNames}`,
    '',
    'Return strictly this JSON schema (no markdown fences):',
    '{"cleanedTranscript":"...","detectedSpeakers":["Speaker 1"],"suggestedTitle":"...","suggestedFolder":"...","folderDescription":"...","tags":["tag1","tag2"]}',
    '',
    'Acoustic & Speech Timeline:',
    acousticTimeline.slice(0, 7000),
  ].join('\n');

  try {
    const aiRes = await runLightweightAiJsonPrompt({
      brainUrl: params.brainUrl,
      backupBrainUrl: params.backupBrainUrl,
      accessToken: params.accessToken,
      model: params.model,
      prompt,
      knowledgeContext: relevantKnowledge.map((m) => ({
        title: m.entry.title,
        folder: m.folderName,
        content: m.entry.content.slice(0, 450),
      })),
      timeoutMs: 9500,
    });

    const parsed = parseJsonObjectFromAiReply<{
      cleanedTranscript?: string;
      detectedSpeakers?: string[];
      suggestedTitle?: string;
      suggestedFolder?: string;
      folderDescription?: string;
      tags?: string[];
    }>(aiRes.text);

    if (parsed?.cleanedTranscript && parsed.cleanedTranscript.trim().length > 2) {
      const cleanedTranscript = parsed.cleanedTranscript.trim();
      const extractedLabels = extractSpeakerLabels(cleanedTranscript);
      const detectedSpeakers =
        extractedLabels.length > 0
          ? extractedLabels
          : Array.isArray(parsed.detectedSpeakers) && parsed.detectedSpeakers.length > 0
            ? parsed.detectedSpeakers.map((s) => String(s).trim()).filter(Boolean)
            : localFormatted.detectedSpeakers;

      const folderGuess = inferFolderDeterministically(
        parsed.suggestedTitle || '',
        cleanedTranscript,
        params.existingFolders,
        parsed.suggestedFolder,
      );

      return {
        cleanedTranscript,
        detectedSpeakers,
        speakerCount: Math.max(1, detectedSpeakers.length),
        suggestedTitle: (parsed.suggestedTitle || '').trim(),
        suggestedFolder: normalizeFolderName(folderGuess.folderName) || deterministicFolder.folderName,
        folderDescription:
          (parsed.folderDescription || '').trim() || folderGuess.description,
        tags: Array.isArray(parsed.tags)
          ? parsed.tags
              .map((t) => String(t).trim().toLowerCase())
              .filter(Boolean)
              .slice(0, 5)
          : ['voice', 'conversation'],
        aiEnhanced: true,
        modelUsed: aiRes.modelUsed,
      };
    }
  } catch {
    // Graceful fallback to local acoustic + punctuation formatter
  }

  return {
    cleanedTranscript: rawCombined,
    detectedSpeakers: localFormatted.detectedSpeakers,
    speakerCount: Math.max(1, localFormatted.detectedSpeakers.length),
    suggestedTitle: localFormatted.suggestedTitle,
    suggestedFolder: deterministicFolder.folderName,
    folderDescription: deterministicFolder.description,
    tags: ['voice', 'conversation', ...deterministicFolder.suggestedTags].slice(0, 5),
    aiEnhanced: false,
    modelUsed: 'built-in-speech',
  };
}

export async function suggestSemanticFolderWithAi(params: {
  brainUrl: string;
  backupBrainUrl?: string;
  accessToken: string;
  model: string;
  title: string;
  content: string;
  existingFolders: KnowledgeFolder[];
}): Promise<{
  folderName: string;
  description: string;
  tags: string[];
  usedAi: boolean;
}> {
  const deterministic = inferFolderDeterministically(
    params.title,
    params.content,
    params.existingFolders,
  );

  const candidates = studentIsolationLocked
    ? []
    : getOrderedCandidateEndpoints(params.brainUrl, params.backupBrainUrl);
  if (candidates.length === 0 || !params.content.trim()) {
    return {
      folderName: deterministic.folderName,
      description: deterministic.description,
      tags: deterministic.suggestedTags,
      usedAi: false,
    };
  }

  const existingList = params.existingFolders.map((f) => f.name).join(', ') || 'None yet';
  const prompt = [
    'Classify this knowledge note into the clearest 1-2 word semantic folder name in Title Case.',
    'Examples: "Definition of turkey" -> "Food", "How to say hello formally" -> "Greetings", "React hook race condition" -> "Patterns" or "Debugging".',
    'Reuse one of the existing folders if it is a clean topic fit; otherwise invent a clear concise topic folder name.',
    `Existing folders: ${existingList}`,
    'Return ONLY JSON: {"folderName":"...","description":"...","tags":["..."]}',
    `Title: ${params.title}`,
    `Content: ${params.content.slice(0, 2200)}`,
  ].join('\n');

  try {
    const res = await runLightweightAiJsonPrompt({
      brainUrl: params.brainUrl,
      backupBrainUrl: params.backupBrainUrl,
      accessToken: params.accessToken,
      model: params.model,
      prompt,
      timeoutMs: 6500,
    });
    const parsed = parseJsonObjectFromAiReply<{
      folderName?: string;
      description?: string;
      tags?: string[];
    }>(res.text);

    const candidateFolder = normalizeFolderName(parsed?.folderName || '');
    if (candidateFolder) {
      const resolved = inferFolderDeterministically(
        params.title,
        params.content,
        params.existingFolders,
        candidateFolder,
      );
      return {
        folderName: resolved.folderName,
        description: (parsed?.description || '').trim() || resolved.description,
        tags: Array.isArray(parsed?.tags)
          ? parsed.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 4)
          : resolved.suggestedTags,
        usedAi: true,
      };
    }
  } catch {
    // Fall back to deterministic semantic classifier
  }

  return {
    folderName: deterministic.folderName,
    description: deterministic.description,
    tags: deterministic.suggestedTags,
    usedAi: false,
  };
}

export interface TeacherLessonPacket {
  answer: string;
  triggers: string[];
  responseVariants: string[];
  knowledgeTitle: string;
  knowledgeContent: string;
  folderName: string;
  tags: string[];
  modelUsed: string;
  usedTeacher: boolean;
}

/**
 * Teacher-to-Scratch Distillation:
 * When the local Scratch AI doesn't know how to respond (e.g. "hi", "1+1", or a new coding topic),
 * the connected AI Brain answers AND generates multi-variant triggers + responses so Scratch handles it offline forever after.
 */
export async function distillLessonWithTeacher(params: {
  brainUrl: string;
  backupBrainUrl?: string;
  accessToken: string;
  model: string;
  prompt: string;
  entries: KnowledgeEntry[];
  folders: KnowledgeFolder[];
}): Promise<TeacherLessonPacket> {
  const cleanPrompt = params.prompt.trim();
  const deterministic = inferFolderDeterministically(cleanPrompt, cleanPrompt, params.folders);
  const candidates = studentIsolationLocked
    ? []
    : getOrderedCandidateEndpoints(params.brainUrl, params.backupBrainUrl);

  if (candidates.length === 0) {
    return {
      answer: `Student-Only Isolation active or no Teacher route configured — saved "${cleanPrompt}" locally.`,
      triggers: [cleanPrompt.toLowerCase()],
      responseVariants: [cleanPrompt],
      knowledgeTitle: cleanPrompt.slice(0, 68),
      knowledgeContent: cleanPrompt,
      folderName: deterministic.folderName,
      tags: deterministic.suggestedTags,
      modelUsed: 'student-isolated',
      usedTeacher: false,
    };
  }

  const folderNames = params.folders.map((f) => f.name).join(', ') || 'Patterns, Architecture, Greetings';
  const relevant = retrieveRelevantKnowledge(cleanPrompt, params.entries, params.folders, 3);

  const teacherPrompt = [
    'You are the Mantis AI Brain Teacher training a smaller local Scratch AI.',
    'The user just sent a prompt that the Scratch AI could not confidently answer on its own.',
    'Produce TWO things inside strict valid JSON (no markdown fences):',
    '1. "answer": The direct, crisp, helpful answer to show the user right now.',
    '2. A compact reusable lesson so the Scratch AI can answer similar prompts offline next time:',
    '   - "triggers": 3-6 lowercase phrase variants or keywords that should activate this skill (e.g. for "hi": ["hi", "hello", "hey", "hey mantis", "good morning"]).',
    '   - "responseVariants": 2-4 varied, natural responses Scratch AI can rotate through cleanly.',
    '   - "knowledgeTitle": Concise title (max 70 chars).',
    '   - "knowledgeContent": Clear durable rule/fact/pattern summary.',
    `   - "folderName": Best 1-2 word folder (${folderNames} — or new clear category like Greetings, Math, Patterns).`,
    '   - "tags": 2-4 lowercase tags.',
    '',
    'Schema:',
    '{"answer":"...","triggers":["..."],"responseVariants":["..."],"knowledgeTitle":"...","knowledgeContent":"...","folderName":"...","tags":["..."]}',
    '',
    `User Prompt: ${cleanPrompt}`,
  ].join('\n');

  try {
    const res = await runLightweightAiJsonPrompt({
      brainUrl: params.brainUrl,
      backupBrainUrl: params.backupBrainUrl,
      accessToken: params.accessToken,
      model: params.model,
      prompt: teacherPrompt,
      knowledgeContext: relevant.map((m) => ({
        title: m.entry.title,
        folder: m.folderName,
        content: m.entry.content.slice(0, 400),
      })),
      timeoutMs: 11000,
    });

    const parsed = parseJsonObjectFromAiReply<{
      answer?: string;
      triggers?: string[];
      responseVariants?: string[];
      knowledgeTitle?: string;
      knowledgeContent?: string;
      folderName?: string;
      tags?: string[];
    }>(res.text);

    if (parsed?.answer && parsed.answer.trim()) {
      const folderGuess = inferFolderDeterministically(
        parsed.knowledgeTitle || cleanPrompt,
        parsed.knowledgeContent || parsed.answer,
        params.folders,
        parsed.folderName,
      );
      const triggers = Array.isArray(parsed.triggers) && parsed.triggers.length > 0
        ? parsed.triggers.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
        : [cleanPrompt.toLowerCase()];
      const variants =
        Array.isArray(parsed.responseVariants) && parsed.responseVariants.length > 0
          ? parsed.responseVariants.map((r) => String(r).trim()).filter(Boolean)
          : [parsed.answer.trim()];

      return {
        answer: parsed.answer.trim(),
        triggers,
        responseVariants: variants,
        knowledgeTitle: (parsed.knowledgeTitle || cleanPrompt).trim().slice(0, 80),
        knowledgeContent: (parsed.knowledgeContent || parsed.answer).trim(),
        folderName: normalizeFolderName(folderGuess.folderName) || deterministic.folderName,
        tags: Array.isArray(parsed.tags)
          ? parsed.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 5)
          : folderGuess.suggestedTags,
        modelUsed: res.modelUsed,
        usedTeacher: true,
      };
    }
  } catch {
    // Graceful fallback to standard AI chat if JSON distillation times out
  }

  const chatFallback = await askAiBrainChat({
    brainUrl: params.brainUrl,
    backupBrainUrl: params.backupBrainUrl,
    accessToken: params.accessToken,
    model: params.model,
    prompt: cleanPrompt,
    entries: params.entries,
    folders: params.folders,
    repoFiles: [],
    history: [],
  });

  return {
    answer: chatFallback.replyText,
    triggers: [cleanPrompt.toLowerCase()],
    responseVariants: [chatFallback.replyText],
    knowledgeTitle: cleanPrompt.slice(0, 72),
    knowledgeContent: chatFallback.replyText.slice(0, 1200),
    folderName: deterministic.folderName,
    tags: deterministic.suggestedTags,
    modelUsed: chatFallback.modelUsed,
    usedTeacher: true,
  };
}

/**
 * Generates two distinct candidate answers for DPO Side-by-Side Arena ranking.
 */
export async function runArenaDuelWithBrain(params: {
  brainUrl: string;
  backupBrainUrl?: string;
  accessToken: string;
  model: string;
  prompt: string;
  scratchCandidate: string;
  entries: KnowledgeEntry[];
  folders: KnowledgeFolder[];
  repoFiles: RepoFile[];
}): Promise<{
  candidateA: {label: string; text: string};
  candidateB: {label: string; text: string};
  citedEntryIds: string[];
}> {
  const hasCloud =
    !studentIsolationLocked &&
    getOrderedCandidateEndpoints(params.brainUrl, params.backupBrainUrl).length > 0;
  if (!hasCloud) {
    return {
      candidateA: {label: 'Scratch Hybrid RAG', text: params.scratchCandidate},
      candidateB: {
        label: 'Concise Rule Summary',
        text: `${params.scratchCandidate}\n\n(Connect a Cloud Assist route in Settings to compare Scratch vs. Cloud LLM reasoning in Arena mode.)`,
      },
      citedEntryIds: [],
    };
  }

  try {
    const cloudRes = await askAiBrainChat({
      brainUrl: params.brainUrl,
      backupBrainUrl: params.backupBrainUrl,
      accessToken: params.accessToken,
      model: params.model,
      prompt: params.prompt,
      entries: params.entries,
      folders: params.folders,
      repoFiles: params.repoFiles,
      history: [],
    });
    return {
      candidateA: {label: 'Scratch Hybrid AI', text: params.scratchCandidate},
      candidateB: {label: `Cloud Teacher (${cloudRes.modelUsed})`, text: cloudRes.replyText},
      citedEntryIds: cloudRes.citedEntryIds,
    };
  } catch (err) {
    return {
      candidateA: {label: 'Scratch Hybrid AI', text: params.scratchCandidate},
      candidateB: {
        label: 'Cloud Assist Unavailable',
        text: err instanceof Error ? err.message : 'Cloud route unavailable right now.',
      },
      citedEntryIds: [],
    };
  }
}

/**
 * Generates a structured 3-turn Teacher-Student curriculum drill packet for a Knowledge topic
 * or skill gap, minting triggers, response variants, SFT turns, and an Eval test case.
 */
export async function generateCurriculumDrillWithTeacher(params: {
  brainUrl: string;
  backupBrainUrl?: string;
  accessToken: string;
  model: string;
  topicTitle: string;
  folderName: string;
  sourceContent?: string;
  entries: KnowledgeEntry[];
  folders: KnowledgeFolder[];
}): Promise<CurriculumDrillPacket> {
  const cleanTopic = params.topicTitle.trim();
  const baseKeywords = tokenizeQuery(`${cleanTopic} ${params.sourceContent || ''}`).slice(0, 4);
  const fallbackSummary = params.sourceContent?.trim()
    ? params.sourceContent.trim().slice(0, 420)
    : `Apply our verified workspace rule for ${cleanTopic}.`;

  const deterministicFallback: CurriculumDrillPacket = {
    topicTitle: cleanTopic,
    folderName: params.folderName || 'Patterns',
    triggers: Array.from(
      new Set([
        cleanTopic.toLowerCase(),
        `how do we handle ${cleanTopic.toLowerCase()}`,
        ...baseKeywords.slice(0, 3),
      ]),
    ).slice(0, 5),
    responseVariants: [
      fallbackSummary,
      `${cleanTopic}: ${fallbackSummary}`,
    ],
    turns: [
      {
        userPrompt: `What is our standard rule for ${cleanTopic}?`,
        idealResponse: fallbackSummary,
        takeaway: `Direct recall on ${cleanTopic}`,
      },
      {
        userPrompt: `When writing or reviewing code involving ${baseKeywords[0] || cleanTopic}, what should Mantis enforce?`,
        idealResponse: fallbackSummary,
        takeaway: 'Practical enforcement cue',
      },
      {
        userPrompt: `Summarize ${cleanTopic} in one concise verification checklist.`,
        idealResponse: `- Verify: ${fallbackSummary.slice(0, 220)}`,
        takeaway: 'Checklist compression',
      },
    ],
    evalPrompt: `What should Mantis follow for ${cleanTopic}?`,
    evalRequiredTerms: baseKeywords.slice(0, 2),
    modelUsed: 'built-in-curriculum-drill',
    usedTeacher: false,
  };

  const candidates = studentIsolationLocked
    ? []
    : getOrderedCandidateEndpoints(params.brainUrl, params.backupBrainUrl);
  if (candidates.length === 0) {
    return deterministicFallback;
  }

  const relevant = retrieveRelevantKnowledge(cleanTopic, params.entries, params.folders, 3);
  const drillPrompt = [
    'You are training Mantis Scratch AI via a structured 3-turn Teacher-Student Curriculum Drill.',
    'Generate strict valid JSON ONLY (no markdown fences) for this topic:',
    `Topic: ${cleanTopic}`,
    `Folder: ${params.folderName}`,
    params.sourceContent ? `Source Knowledge:\n${params.sourceContent.slice(0, 1200)}` : '',
    '',
    'JSON Schema:',
    '{"triggers":["3-5 lowercase phrases/keywords"],"responseVariants":["2-3 crisp offline answers"],"turns":[{"userPrompt":"Turn 1 question","idealResponse":"Crisp grounded answer","takeaway":"short skill takeaway"},{"userPrompt":"Turn 2 scenario/code question","idealResponse":"...","takeaway":"..."},{"userPrompt":"Turn 3 edge-case check","idealResponse":"...","takeaway":"..."}],"evalPrompt":"Single verification prompt","evalRequiredTerms":["1-2 key terms required in answer"]}',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const res = await runLightweightAiJsonPrompt({
      brainUrl: params.brainUrl,
      backupBrainUrl: params.backupBrainUrl,
      accessToken: params.accessToken,
      model: params.model,
      prompt: drillPrompt,
      knowledgeContext: relevant.map((m) => ({
        title: m.entry.title,
        folder: m.folderName,
        content: m.entry.content.slice(0, 350),
      })),
      timeoutMs: 12000,
    });

    const parsed = parseJsonObjectFromAiReply<{
      triggers?: string[];
      responseVariants?: string[];
      turns?: Array<{userPrompt?: string; idealResponse?: string; takeaway?: string}>;
      evalPrompt?: string;
      evalRequiredTerms?: string[];
    }>(res.text);

    if (parsed && Array.isArray(parsed.turns) && parsed.turns.length > 0) {
      const validTurns = parsed.turns
        .filter((t) => t.userPrompt?.trim() && t.idealResponse?.trim())
        .slice(0, 4)
        .map((t) => ({
          userPrompt: t.userPrompt!.trim(),
          idealResponse: t.idealResponse!.trim(),
          takeaway: (t.takeaway || 'Teacher drill').trim(),
        }));

      if (validTurns.length > 0) {
        const triggers = Array.isArray(parsed.triggers) && parsed.triggers.length > 0
          ? parsed.triggers.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 6)
          : deterministicFallback.triggers;
        const responseVariants =
          Array.isArray(parsed.responseVariants) && parsed.responseVariants.length > 0
            ? parsed.responseVariants.map((r) => String(r).trim()).filter(Boolean).slice(0, 4)
            : validTurns.map((t) => t.idealResponse).slice(0, 3);

        return {
          topicTitle: cleanTopic,
          folderName: params.folderName || 'Patterns',
          triggers,
          responseVariants,
          turns: validTurns,
          evalPrompt: (parsed.evalPrompt || validTurns[0].userPrompt).trim(),
          evalRequiredTerms: Array.isArray(parsed.evalRequiredTerms)
            ? parsed.evalRequiredTerms.map((k) => String(k).trim()).filter(Boolean).slice(0, 4)
            : deterministicFallback.evalRequiredTerms,
          modelUsed: res.modelUsed,
          usedTeacher: true,
        };
      }
    }
  } catch {
    // Graceful fallback to deterministic curriculum packet
  }

  return deterministicFallback;
}


