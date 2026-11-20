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

const STORAGE_BRAIN_MODE_KEY = 'mantis_brain_provider_mode';

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

export async function testBrainConnection(
  brainUrl: string,
  accessToken?: string,
  preferredModel?: string,
): Promise<{
  ok: boolean;
  hasHfToken: boolean;
  hasAnyProvider: boolean;
  activeProviders: string[];
  defaultModel: string;
  inferenceVerified: boolean;
  verifiedModel?: string;
  latencyMs: number;
}> {
  const cleanUrl = normalizeBrainUrl(brainUrl);
  if (!cleanUrl) {
    throw new Error('Enter your Cloudflare Worker or Ollama URL.');
  }
  try {
    const parsed = new URL(cleanUrl);
    if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost') {
      throw new Error('Invalid host');
    }
  } catch {
    throw new Error('Enter a valid URL (e.g. mantis-brain.garrettwins3.workers.dev or http://localhost:11434).');
  }

  const start = performance.now();
  let res: Response;
  try {
    res = await fetch(`${cleanUrl}/health`);
  } catch (networkErr) {
    throw new Error(
      `Could not reach ${cleanUrl}: ${
        networkErr instanceof Error ? networkErr.message : 'Network or CORS blocked'
      }.`,
    );
  }

  const latencyMs = Math.round(performance.now() - start);
  const contentType = res.headers.get('content-type') || '';

  // Direct Ollama server detection (/health is 404 on Ollama, /api/tags returns installed models)
  if (res.status === 404) {
    const ollamaTagsRes = await fetch(`${cleanUrl}/api/tags`).catch(() => null);
    if (ollamaTagsRes && ollamaTagsRes.ok) {
      const tagsData = (await ollamaTagsRes.json().catch(() => ({}))) as {
        models?: Array<{name?: string}>;
      };
      const installed = (tagsData.models || []).map((m) => m.name).filter((n): n is string => Boolean(n));
      if (installed.length === 0) {
        throw new Error('Connected to Ollama, but no models are installed yet (run e.g. `ollama pull qwen2.5-coder:7b`).');
      }
      const chosenOllamaModel = installed[0];
      const pingRes = await fetch(`${cleanUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          model: chosenOllamaModel,
          messages: [{role: 'user', content: 'Reply with only READY.'}],
          max_tokens: 16,
        }),
      });
      if (!pingRes.ok) {
        throw new Error(`Ollama chat test returned HTTP ${pingRes.status}.`);
      }
      setLocalBrainMode('ollama');
      return {
        ok: true,
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
    hasAnyProvider?: boolean;
    activeProviders?: string[];
    defaultModel?: string;
  };
  if (data.service !== 'mantis-ai-brain') {
    throw new Error('URL responded, but it is not running the Mantis AI Brain Worker code.');
  }

  setLocalBrainMode('worker');
  const hasHfToken = Boolean(data.hasHfToken);
  const activeProviders = Array.isArray(data.activeProviders)
    ? data.activeProviders
    : hasHfToken
      ? ['huggingface']
      : [];
  const hasAnyProvider =
    typeof data.hasAnyProvider === 'boolean' ? data.hasAnyProvider : activeProviders.length > 0;

  if (!hasAnyProvider || !accessToken) {
    return {
      ok: Boolean(data.ok),
      hasHfToken,
      hasAnyProvider,
      activeProviders,
      defaultModel: data.defaultModel || DEFAULT_BRAIN_MODEL,
      inferenceVerified: false,
      latencyMs,
    };
  }

  // Run an actual live inference test via the Worker
  let verifyRes = await fetch(`${cleanUrl}/ai/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({model: preferredModel || data.defaultModel || DEFAULT_BRAIN_MODEL}),
  });

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
    hasHfToken,
    hasAnyProvider: true,
    activeProviders,
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

async function callDirectOllamaChat(
  ollamaUrl: string,
  messages: Array<{role: string; content: string}>,
  maxTokens = 1400,
): Promise<{text: string; model: string}> {
  let chosenModel = 'qwen2.5-coder:7b';
  try {
    const tagsRes = await fetch(`${ollamaUrl}/api/tags`);
    if (tagsRes.ok) {
      const tagsData = (await tagsRes.json()) as {models?: Array<{name?: string}>};
      const first = (tagsData.models || []).find((m) => Boolean(m.name))?.name;
      if (first) chosenModel = first;
    }
  } catch {
    // use fallback model name
  }

  const res = await fetch(`${ollamaUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      model: chosenModel,
      messages,
      max_tokens: maxTokens,
      temperature: 0.25,
    }),
  });
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

  if (getLocalBrainMode() === 'ollama' || cleanUrl.includes('localhost:11434') || cleanUrl.includes('127.0.0.1:11434')) {
    const systemPrompt = [
      'You are Mantis, a personal coding AI companion. Ground your answers in the user Knowledge and Repo snippets below.',
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
