import type {
  BrainRouteKind,
  BrainRouteStatus,
  ChatMessage,
  KnowledgeEntry,
  KnowledgeFolder,
  RepoFile,
} from '../types/mantis';
import {retrieveRelevantKnowledge, retrieveRelevantRepoFiles} from './memory';
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
  const normalized = normalizeExternalUrl(raw).replace(/\/+$/, '');
  if (!normalized) return '';
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
  return normalized;
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

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 7500,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {...init, signal: controller.signal});
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
  try {
    const parsed = new URL(cleanUrl);
    if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost') {
      throw new Error('Invalid host');
    }
  } catch {
    throw new Error('Enter a valid URL (e.g. mantis-brain.garrettwins3.workers.dev or https://...supabase.co/functions/v1/mantis-brain).');
  }

  const isBackup = routeKindHint === 'backup-supabase' || isSupabaseEdgeUrl(cleanUrl);
  const start = performance.now();
  let res: Response;
  try {
    // Keep /health headerless (matching a direct browser GET) so expired JWTs or apikey headers never trigger gateway 401s.
    res = await fetchWithTimeout(`${cleanUrl}/health`, {}, 6500);
  } catch (networkErr) {
    const reason =
      networkErr instanceof Error && networkErr.name === 'AbortError'
        ? 'Timed out after 6.5s'
        : networkErr instanceof Error
          ? networkErr.message
          : 'Network or .dev domain blocked';
    throw new Error(`Could not reach ${cleanUrl}: ${reason}.`);
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
      const pingRes = await fetchWithTimeout(
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
        10000,
      );
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

  let verifyRes = await fetchWithTimeout(
    `${cleanUrl}/ai/verify`,
    {
      method: 'POST',
      headers: buildEndpointHeaders(cleanUrl, liveToken),
      body: JSON.stringify({model: preferredModel || data.defaultModel || DEFAULT_BRAIN_MODEL}),
    },
    14000,
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
      14000,
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
      14000,
    );
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
      lastError =
        err instanceof Error && err.name === 'AbortError'
          ? `Timeout reaching ${endpoint}`
          : err instanceof Error
            ? err.message
            : 'Network blocked';
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
    const match = direct.text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : direct.text) as {
      summary?: string;
      entries?: DistilledKnowledgeItem[];
    };
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
    const match = direct.text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : direct.text) as {
      title?: string;
      rationale?: string;
      proposedContent?: string;
    };
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

/**
 * Browser fallback reader when neither Worker nor Backup Edge Function is available yet:
 * Tries CORS-friendly Markdown reader (r.jina.ai) for web articles.
 */
async function extractUrlClientFallback(
  url: string,
): Promise<{kind: 'youtube' | 'article'; url: string; title: string; text: string} | null> {
  const isYt = /youtube\.com|youtu\.be/i.test(url);
  try {
    const readerRes = await fetchWithTimeout(
      `https://r.jina.ai/${url}`,
      {headers: {Accept: 'text/plain, text/markdown'}},
      12000,
    );
    if (readerRes.ok) {
      const raw = await readerRes.text();
      if (raw.trim().length >= 90) {
        const titleMatch = raw.match(/^Title:\s*(.+)$/m);
        const title = titleMatch ? titleMatch[1].trim() : url;
        const cleaned = raw
          .replace(/^Title:.*$/m, '')
          .replace(/^URL Source:.*$/m, '')
          .replace(/^Markdown Content:\s*$/m, '')
          .trim()
          .slice(0, 35000);
        if (cleaned.length >= 90) {
          return {
            kind: isYt ? 'youtube' : 'article',
            url,
            title,
            text: cleaned,
          };
        }
      }
    }
  } catch {
    // ignore CORS or network errors on fallback reader
  }
  return null;
}

export async function extractUrlViaBrain(params: {
  brainUrl: string;
  backupBrainUrl?: string;
  accessToken: string;
  url: string;
}): Promise<{kind: 'youtube' | 'article'; url: string; title: string; text: string}> {
  const candidates = getOrderedCandidateEndpoints(params.brainUrl, params.backupBrainUrl);

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
        return {
          kind: payload.kind || 'article',
          url: payload.url || params.url,
          title: payload.title || params.url,
          text: payload.text,
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
