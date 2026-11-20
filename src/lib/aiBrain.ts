import type {ChatMessage, KnowledgeEntry, KnowledgeFolder, RepoFile} from '../types/mantis';
import {retrieveRelevantKnowledge, retrieveRelevantRepoFiles} from './memory';

export const DEFAULT_BRAIN_MODEL = 'Qwen/Qwen2.5-Coder-32B-Instruct';

export const BRAIN_MODEL_OPTIONS: Array<{id: string; label: string}> = [
  {id: 'Qwen/Qwen2.5-Coder-32B-Instruct', label: 'Qwen 2.5 Coder 32B (Best for Code)'},
  {id: 'Qwen/Qwen3-Coder-30B-A3B-Instruct', label: 'Qwen 3 Coder 30B (Fast Coding Model)'},
  {id: 'meta-llama/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B Instruct (All-Rounder)'},
  {id: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen 2.5 72B Instruct (Deep Reasoning)'},
  {id: 'deepseek-ai/DeepSeek-V3.2', label: 'DeepSeek V3.2 (Reasoning + Code)'},
];

const STORAGE_BRAIN_URL_KEY = 'mantis_brain_worker_url';
const STORAGE_BRAIN_MODEL_KEY = 'mantis_brain_model';

export function getLocalBrainConfig(): {brainUrl: string; model: string} {
  try {
    return {
      brainUrl: window.localStorage.getItem(STORAGE_BRAIN_URL_KEY) || '',
      model: window.localStorage.getItem(STORAGE_BRAIN_MODEL_KEY) || DEFAULT_BRAIN_MODEL,
    };
  } catch {
    return {brainUrl: '', model: DEFAULT_BRAIN_MODEL};
  }
}

export function setLocalBrainConfig(brainUrl: string, model: string): void {
  try {
    const cleanUrl = brainUrl.trim().replace(/\/+$/, '');
    if (cleanUrl) {
      window.localStorage.setItem(STORAGE_BRAIN_URL_KEY, cleanUrl);
    } else {
      window.localStorage.removeItem(STORAGE_BRAIN_URL_KEY);
    }
    window.localStorage.setItem(STORAGE_BRAIN_MODEL_KEY, model.trim() || DEFAULT_BRAIN_MODEL);
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
  return normalizeExternalUrl(raw).replace(/\/+$/, '');
}

export async function testBrainConnection(
  brainUrl: string,
  accessToken?: string,
  preferredModel?: string,
): Promise<{
  ok: boolean;
  hasHfToken: boolean;
  defaultModel: string;
  inferenceVerified: boolean;
  verifiedModel?: string;
  latencyMs: number;
}> {
  const cleanUrl = normalizeBrainUrl(brainUrl);
  if (!cleanUrl) {
    throw new Error('Enter your Cloudflare Worker URL (e.g. https://mantis-brain.yourname.workers.dev).');
  }
  try {
    const parsed = new URL(cleanUrl);
    if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost') {
      throw new Error('Invalid host');
    }
  } catch {
    throw new Error('Enter a valid Worker domain or URL (e.g. mantis-brain.garrettwins3.workers.dev).');
  }
  const start = performance.now();
  const res = await fetch(`${cleanUrl}/health`);
  const latencyMs = Math.round(performance.now() - start);
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    throw new Error(`Worker health check returned HTTP ${res.status}.`);
  }
  if (!contentType.includes('application/json')) {
    throw new Error(
      'This URL returned a webpage instead of the Mantis AI Brain Worker JSON. In Cloudflare, create a "Hello World" Worker (do not import the GitHub repo), paste the copied Worker Code, and Deploy.',
    );
  }
  const data = (await res.json()) as {
    ok?: boolean;
    service?: string;
    hasHfToken?: boolean;
    defaultModel?: string;
  };
  if (data.service !== 'mantis-ai-brain') {
    throw new Error('URL responded, but it is not running the Mantis AI Brain Worker code.');
  }

  const hasHfToken = Boolean(data.hasHfToken);
  if (!hasHfToken || !accessToken) {
    return {
      ok: Boolean(data.ok),
      hasHfToken,
      defaultModel: data.defaultModel || DEFAULT_BRAIN_MODEL,
      inferenceVerified: false,
      latencyMs,
    };
  }

  // Run an actual live Hugging Face inference test via the Worker
  let verifyRes = await fetch(`${cleanUrl}/ai/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({model: preferredModel || data.defaultModel || DEFAULT_BRAIN_MODEL}),
  });

  // Backwards-compatibility if user hasn't re-pasted updated worker.js with /ai/verify yet
  if (verifyRes.status === 404) {
    verifyRes = await fetch(`${cleanUrl}/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        prompt: 'Reply with only the word READY.',
        model: preferredModel || data.defaultModel || DEFAULT_BRAIN_MODEL,
        knowledgeContext: [],
        repoContext: [],
        history: [],
      }),
    });
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
    hasHfToken: true,
    defaultModel: data.defaultModel || DEFAULT_BRAIN_MODEL,
    inferenceVerified: true,
    verifiedModel: verifyPayload.model || preferredModel || data.defaultModel || DEFAULT_BRAIN_MODEL,
    latencyMs: totalLatencyMs,
  };
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

export async function askAiBrainChat(params: {
  brainUrl: string;
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

  const res = await fetch(`${cleanUrl}/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    },
    body: JSON.stringify({
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
    }),
  });

  const payload = (await res.json().catch(() => ({}))) as {
    reply?: string;
    model?: string;
    error?: string;
  };
  if (!res.ok || !payload.reply) {
    throw new Error(payload.error || `AI Brain returned HTTP ${res.status}.`);
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
  accessToken: string;
  model: string;
  text: string;
  sourceTitle: string;
  sourceType: string;
}): Promise<{summary: string; entries: DistilledKnowledgeItem[]; model: string}> {
  const cleanUrl = normalizeBrainUrl(params.brainUrl);
  const res = await fetch(`${cleanUrl}/ai/distill`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    },
    body: JSON.stringify({
      text: params.text,
      sourceTitle: params.sourceTitle,
      sourceType: params.sourceType,
      model: params.model,
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    summary?: string;
    entries?: DistilledKnowledgeItem[];
    model?: string;
    error?: string;
  };
  if (!res.ok || !Array.isArray(payload.entries)) {
    throw new Error(payload.error || `AI Distillation failed (${res.status}).`);
  }
  return {
    summary: payload.summary || '',
    entries: payload.entries,
    model: payload.model || params.model,
  };
}

export async function suggestCodeWithAiBrain(params: {
  brainUrl: string;
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
  const res = await fetch(`${cleanUrl}/ai/suggest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    },
    body: JSON.stringify({
      filePath: params.filePath,
      originalContent: params.originalContent,
      goal: params.goal,
      model: params.model,
      knowledgeContext: matches.map((m) => ({
        title: m.entry.title,
        content: m.entry.content,
      })),
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    title?: string;
    rationale?: string;
    proposedContent?: string;
    model?: string;
    error?: string;
  };
  if (!res.ok || !payload.proposedContent) {
    throw new Error(payload.error || `AI suggestion failed (${res.status}).`);
  }
  return {
    title: payload.title || `AI Proposal: ${params.filePath}`,
    rationale: payload.rationale || `Generated with ${payload.model || params.model}`,
    proposedContent: payload.proposedContent,
    model: payload.model || params.model,
  };
}

export async function extractUrlViaBrain(params: {
  brainUrl: string;
  accessToken: string;
  url: string;
}): Promise<{kind: 'youtube' | 'article'; url: string; title: string; text: string}> {
  const cleanUrl = normalizeBrainUrl(params.brainUrl);
  const res = await fetch(`${cleanUrl}/extract-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    },
    body: JSON.stringify({url: params.url}),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    kind?: 'youtube' | 'article';
    url?: string;
    title?: string;
    text?: string;
    error?: string;
  };
  if (!res.ok || !payload.text) {
    throw new Error(payload.error || `URL extraction failed (${res.status}).`);
  }
  return {
    kind: payload.kind || 'article',
    url: payload.url || params.url,
    title: payload.title || params.url,
    text: payload.text,
  };
}
