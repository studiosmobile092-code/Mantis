import type {ChatMessage, KnowledgeEntry, KnowledgeFolder, RepoFile} from '../types/mantis';
import {retrieveRelevantKnowledge, retrieveRelevantRepoFiles} from './memory';

export const DEFAULT_BRAIN_MODEL = 'Qwen/Qwen2.5-Coder-32B-Instruct';

export const BRAIN_MODEL_OPTIONS: Array<{id: string; label: string}> = [
  {id: 'Qwen/Qwen2.5-Coder-32B-Instruct', label: 'Qwen 2.5 Coder 32B (Best for Code)'},
  {id: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen 2.5 72B Instruct (General + Deep Reasoning)'},
  {id: 'meta-llama/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B Instruct'},
  {id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B', label: 'DeepSeek R1 Distill Qwen 32B'},
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

export function normalizeBrainUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

export async function testBrainConnection(
  brainUrl: string,
): Promise<{ok: boolean; hasHfToken: boolean; defaultModel: string; latencyMs: number}> {
  const cleanUrl = normalizeBrainUrl(brainUrl);
  if (!/^https?:\/\//i.test(cleanUrl)) {
    throw new Error('Enter a valid https:// Cloudflare Worker URL.');
  }
  const start = performance.now();
  const res = await fetch(`${cleanUrl}/health`);
  const latencyMs = Math.round(performance.now() - start);
  if (!res.ok) {
    throw new Error(`Worker health check returned HTTP ${res.status}.`);
  }
  const data = (await res.json()) as {
    ok?: boolean;
    hasHfToken?: boolean;
    defaultModel?: string;
  };
  return {
    ok: Boolean(data.ok),
    hasHfToken: Boolean(data.hasHfToken),
    defaultModel: data.defaultModel || DEFAULT_BRAIN_MODEL,
    latencyMs,
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
