/**
 * Mantis AI Brain — Supabase Edge Function Mirror (Non-.dev Chromebook Safe!)
 *
 * URL once deployed:
 *   https://ncbtoawlltxukzzdyvhc.supabase.co/functions/v1/mantis-brain
 *
 * Setup in Supabase Dashboard (zero CLI needed):
 * 1) Open Edge Functions -> Deploy a new function -> Via Editor
 * 2) Name it exactly: mantis-brain
 * 3) Paste this file, turn OFF "Enforce JWT Verification" in Details (our code verifies user JWTs internally for AI routes while letting /health report cleanly)
 * 4) Add Edge Function Secrets: GROQ_API_KEY (free at console.groq.com) or OPENROUTER_API_KEY or HF_TOKEN, plus optional ALLOWED_EMAIL
 */

const DEFAULT_SUPABASE_URL = 'https://ncbtoawlltxukzzdyvhc.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_wCDq_uAfoddEBuNLYeLcmQ_WqkXHnpx';

const HF_FALLBACK_MODELS = [
  'Qwen/Qwen2.5-Coder-32B-Instruct',
  'Qwen/Qwen3-Coder-30B-A3B-Instruct',
  'meta-llama/Llama-3.3-70B-Instruct',
  'Qwen/Qwen2.5-72B-Instruct',
  'meta-llama/Llama-3.1-8B-Instruct',
];

const GROQ_FALLBACK_MODELS = [
  'llama-3.3-70b-versatile',
  'qwen-qwq-32b',
  'llama-3.1-8b-instant',
];

const OPENROUTER_FALLBACK_MODELS = [
  'qwen/qwen-2.5-coder-32b-instruct:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'deepseek/deepseek-chat-v3-0324:free',
];

function corsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}

function getEnv(key: string): string {
  try {
    return (Deno.env.get(key) || '').trim();
  } catch {
    return '';
  }
}

function normalizeRoutePath(pathname: string): string {
  // Handle both /functions/v1/mantis-brain/<route> and /mantis-brain/<route>
  const stripped = pathname
    .replace(/^\/functions\/v1\/mantis-brain/i, '')
    .replace(/^\/mantis-brain/i, '');
  return stripped || '/';
}

async function verifySupabaseUser(request: Request) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return {ok: false, status: 401, error: 'Missing Supabase Bearer session token.'};
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return {ok: false, status: 401, error: 'Empty Bearer token.'};
  }

  const supabaseUrl = (getEnv('SUPABASE_URL') || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
  const publishableKey =
    getEnv('SUPABASE_ANON_KEY') ||
    getEnv('SUPABASE_PUBLISHABLE_KEY') ||
    DEFAULT_SUPABASE_PUBLISHABLE_KEY;

  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    return {ok: false, status: 401, error: 'Invalid or expired Supabase session.'};
  }

  const user = (await res.json()) as {email?: string};
  const allowedEmail = getEnv('ALLOWED_EMAIL').toLowerCase();
  if (allowedEmail && (user.email || '').toLowerCase() !== allowedEmail) {
    return {ok: false, status: 403, error: 'Account email is not authorized for this Mantis Brain.'};
  }

  return {ok: true, user};
}

async function tryOllama(
  messages: Array<{role: string; content: string}>,
  preferredModel: string,
  maxTokens: number,
  temperature: number,
) {
  const baseUrl = getEnv('OLLAMA_URL').replace(/\/+$/, '');
  if (!baseUrl) return null;

  const model = getEnv('OLLAMA_MODEL') || preferredModel || 'qwen2.5-coder:7b';
  const headers: Record<string, string> = {'Content-Type': 'application/json'};
  const ollamaKey = getEnv('OLLAMA_API_KEY');
  if (ollamaKey) {
    headers.Authorization = `Bearer ${ollamaKey}`;
  }

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({model, messages, max_tokens: maxTokens, temperature}),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama (${res.status}): ${errText.slice(0, 180)}`);
  }
  const payload = (await res.json()) as {choices?: Array<{message?: {content?: string}}>};
  const text = (payload?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new Error('Ollama returned empty response.');
  return {text, model: `ollama/${model}`};
}

async function tryOpenAiCompatible(
  endpoint: string,
  apiKey: string,
  models: string[],
  providerLabel: string,
  messages: Array<{role: string; content: string}>,
  maxTokens: number,
  temperature: number,
  extraHeaders: Record<string, string> = {},
) {
  const key = apiKey.trim();
  if (!key) return null;

  let lastErr = `${providerLabel} failed`;
  for (const model of models) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify({model, messages, max_tokens: maxTokens, temperature}),
    });

    if (res.ok) {
      const payload = (await res.json()) as {
        choices?: Array<{message?: {content?: string; reasoning_content?: string}}>;
      };
      const msg = payload?.choices?.[0]?.message;
      const text = (msg?.content || msg?.reasoning_content || '').trim();
      if (text) return {text, model};
    } else {
      const errText = await res.text();
      if (res.status === 401) {
        lastErr = `${providerLabel} key rejected (401 Unauthorized)`;
        break;
      }
      if (res.status === 402) {
        lastErr = `${providerLabel} credit limit reached (402 Payment Required)`;
        break;
      }
      if (res.status === 403) {
        lastErr = `${providerLabel} token lacks permission (403 Forbidden)`;
        break;
      }
      lastErr = `${providerLabel} ${model} (${res.status}): ${errText.slice(0, 140)}`;
    }
  }
  throw new Error(lastErr);
}

async function callProviderCascade(
  messages: Array<{role: string; content: string}>,
  preferredModel: string,
  maxTokens = 1400,
  temperature = 0.25,
) {
  const errors: string[] = [];

  if (getEnv('OLLAMA_URL')) {
    try {
      const res = await tryOllama(messages, preferredModel, maxTokens, temperature);
      if (res) return res;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const groqKey = getEnv('GROQ_API_KEY');
  if (groqKey) {
    try {
      const res = await tryOpenAiCompatible(
        'https://api.groq.com/openai/v1/chat/completions',
        groqKey,
        GROQ_FALLBACK_MODELS,
        'Groq',
        messages,
        maxTokens,
        temperature,
      );
      if (res) return res;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const openRouterKey = getEnv('OPENROUTER_API_KEY');
  if (openRouterKey) {
    try {
      const res = await tryOpenAiCompatible(
        'https://openrouter.ai/api/v1/chat/completions',
        openRouterKey,
        OPENROUTER_FALLBACK_MODELS,
        'OpenRouter',
        messages,
        maxTokens,
        temperature,
        {
          'HTTP-Referer': 'https://studiosmobile092-code.github.io/Mantis/',
          'X-Title': 'Mantis Studio',
        },
      );
      if (res) return res;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const hfToken = getEnv('HF_TOKEN');
  if (hfToken) {
    const hfModels = Array.from(
      new Set([preferredModel, getEnv('HF_MODEL'), ...HF_FALLBACK_MODELS].filter(Boolean)),
    );
    try {
      const res = await tryOpenAiCompatible(
        'https://router.huggingface.co/v1/chat/completions',
        hfToken,
        hfModels,
        'Hugging Face',
        messages,
        maxTokens,
        temperature,
      );
      if (res) return res;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (errors.length === 0) {
    throw new Error(
      'No AI provider secret configured in Supabase Edge Function Secrets. Add GROQ_API_KEY (free at console.groq.com), OPENROUTER_API_KEY, OLLAMA_URL, or HF_TOKEN.',
    );
  }
  throw new Error(errors.join(' | '));
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function extractYouTubeVideoId(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.replace(/^\/+/, '').split('/')[0] || null;
    }
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') {
        return parts[1] || null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function extractBalancedJsonArray(source: string, startIndex: number): string | null {
  if (source[startIndex] !== '[') return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(startIndex, i + 1);
    }
  }
  return null;
}

async function fetchCaptionTrackLines(trackUrl: string): Promise<string[]> {
  const capRes = await fetch(trackUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    },
  });
  if (!capRes.ok) return [];
  const raw = await capRes.text();

  if (raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as {events?: Array<{segs?: Array<{utf8?: string}>}>};
      const out: string[] = [];
      for (const ev of parsed.events || []) {
        if (!Array.isArray(ev.segs)) continue;
        const line = ev.segs
          .map((s) => String(s.utf8 || ''))
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        if (line) out.push(line);
      }
      if (out.length > 0) return out;
    } catch {
      // fall through
    }
  }

  const lines: string[] = [];
  const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    const cleaned = decodeHtmlEntities(match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (cleaned) lines.push(cleaned);
  }
  return lines;
}

async function fetchYouTubeInnerTube(videoId: string) {
  const clients = [
    {
      clientName: 'ANDROID',
      clientVersion: '19.29.37',
      androidSdkVersion: 30,
      userAgent: 'com.google.android.youtube/19.29.37 (Linux; U; Android 11) gzip',
    },
    {
      clientName: 'WEB',
      clientVersion: '2.20240801.01.00',
      androidSdkVersion: undefined,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    },
  ];

  for (const client of clients) {
    try {
      const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': client.userAgent,
          'Accept-Language': 'en-US,en;q=0.9',
        },
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: client.clientName,
              clientVersion: client.clientVersion,
              ...(client.androidSdkVersion ? {androidSdkVersion: client.androidSdkVersion} : {}),
              hl: 'en',
              gl: 'US',
            },
          },
        }),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        videoDetails?: {title?: string; author?: string; shortDescription?: string};
        captions?: {
          playerCaptionsTracklistRenderer?: {
            captionTracks?: Array<{baseUrl?: string; languageCode?: string; kind?: string}>;
          };
        };
      };
      const title = String(data?.videoDetails?.title || '').trim();
      const author = String(data?.videoDetails?.author || '').trim();
      const description = String(data?.videoDetails?.shortDescription || '').trim();
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      if (tracks.length > 0 || title || description) {
        return {title, author, description, tracks};
      }
    } catch {
      // try next client
    }
  }
  return null;
}

async function extractYouTubeTranscript(url: string, videoId: string) {
  let title = `YouTube Video ${videoId}`;
  let author = '';
  let description = '';
  let tracks: Array<{baseUrl?: string; languageCode?: string; kind?: string}> = [];

  const inner = await fetchYouTubeInnerTube(videoId);
  if (inner) {
    if (inner.title) title = inner.title;
    if (inner.author) author = inner.author;
    if (inner.description) description = inner.description;
    if (inner.tracks.length > 0) tracks = inner.tracks;
  }

  if (tracks.length === 0) {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (pageRes.ok) {
      const html = await pageRes.text();
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      if (titleMatch && !inner?.title) {
        title = decodeHtmlEntities(titleMatch[1].replace(/\s*-\s*YouTube\s*$/i, '').trim());
      }
      const captionsMarker = '"captionTracks":';
      const idx = html.indexOf(captionsMarker);
      if (idx !== -1) {
        const arrayStart = html.indexOf('[', idx + captionsMarker.length);
        const jsonSlice = arrayStart !== -1 ? extractBalancedJsonArray(html, arrayStart) : null;
        if (jsonSlice) {
          try {
            const parsed = JSON.parse(jsonSlice);
            if (Array.isArray(parsed)) tracks = parsed;
          } catch {
            // ignore
          }
        }
      }
    }
  }

  if (tracks.length > 0) {
    const chosen =
      tracks.find((t) => (t.languageCode || '').startsWith('en') && t.kind !== 'asr') ||
      tracks.find((t) => (t.languageCode || '').startsWith('en')) ||
      tracks[0];
    if (chosen?.baseUrl) {
      const lines = await fetchCaptionTrackLines(chosen.baseUrl);
      if (lines.length > 0) {
        const header = author ? `Channel: ${author}\n` : '';
        return {
          kind: 'youtube' as const,
          url,
          title,
          text: `${header}${lines.join('\n')}`,
        };
      }
    }
  }

  if (!description) {
    try {
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      );
      if (oembedRes.ok) {
        const oembed = (await oembedRes.json()) as {title?: string; author_name?: string};
        if (oembed.title) title = oembed.title;
        if (oembed.author_name) author = oembed.author_name;
      }
    } catch {
      // ignore
    }
  }

  if (description.trim().length >= 40) {
    return {
      kind: 'youtube' as const,
      url,
      title,
      text: [
        `Video Title: ${title}`,
        author ? `Channel: ${author}` : '',
        'Note: Public captions were disabled on this video, extracted full video description:',
        '',
        description.trim(),
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  throw new Error(
    `Found "${title}", but public captions are disabled or blocked on this video. Use Screenshots & Live Mic or paste the transcript below.`,
  );
}

async function fetchJinaMarkdownFallback(url: string) {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: {
      Accept: 'text/plain, text/markdown',
      'X-Return-Format': 'markdown',
    },
  });
  if (!res.ok) return null;
  const raw = await res.text();
  if (!raw || raw.trim().length < 80) return null;

  const titleMatch = raw.match(/^Title:\s*(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : url;
  const body = raw
    .replace(/^Title:.*$/m, '')
    .replace(/^URL Source:.*$/m, '')
    .replace(/^Markdown Content:\s*$/m, '')
    .trim();

  if (body.length < 80) return null;
  return {
    kind: 'article' as const,
    url,
    title,
    text: body.slice(0, 35000),
  };
}

async function extractWebArticle(url: string) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,text/plain,application/json,text/markdown',
      },
    });
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      const raw = await res.text();
      if (!contentType.includes('html')) {
        return {
          kind: 'article' as const,
          url,
          title: url,
          text: raw.slice(0, 35000),
        };
      }

      const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title = titleMatch
        ? decodeHtmlEntities(titleMatch[1].replace(/\s+/g, ' ').trim())
        : url;

      const articleMatch =
        raw.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
        raw.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
      const bodyHtml = articleMatch ? articleMatch[1] : raw;

      const cleaned = bodyHtml
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
        .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
        .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
        .replace(/<\/(p|div|h1|h2|h3|h4|li|tr|section|article|pre|code|br)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ');

      const text = decodeHtmlEntities(cleaned)
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter((line) => line.length >= 3)
        .join('\n')
        .slice(0, 35000);

      if (text.length >= 260) {
        return {
          kind: 'article' as const,
          url,
          title,
          text,
        };
      }
    }
  } catch {
    // Fall through to markdown reader fallback
  }

  const readerResult = await fetchJinaMarkdownFallback(url);
  if (readerResult) {
    return readerResult;
  }

  throw new Error(
    'Could not read clean article text from that URL (the site may require login or block automated readers). Copy-paste the text into the box below.',
  );
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('Origin');

  if (request.method === 'OPTIONS') {
    return new Response(null, {status: 204, headers: corsHeaders(origin)});
  }

  const url = new URL(request.url);
  const routePath = normalizeRoutePath(url.pathname);

  if (routePath === '/' || routePath === '/health') {
    const hasOllamaUrl = Boolean(getEnv('OLLAMA_URL'));
    const hasGroqKey = Boolean(getEnv('GROQ_API_KEY'));
    const hasOpenRouterKey = Boolean(getEnv('OPENROUTER_API_KEY'));
    const hasHfToken = Boolean(getEnv('HF_TOKEN'));
    const activeProviders = [
      hasOllamaUrl ? 'ollama' : null,
      hasGroqKey ? 'groq' : null,
      hasOpenRouterKey ? 'openrouter' : null,
      hasHfToken ? 'huggingface' : null,
    ].filter(Boolean);

    return jsonResponse(
      {
        ok: true,
        service: 'mantis-ai-brain',
        runtime: 'supabase-edge-backup',
        hasWorkersAi: false,
        hasOllamaUrl,
        hasGroqKey,
        hasOpenRouterKey,
        hasHfToken,
        hasAnyProvider: activeProviders.length > 0,
        activeProviders,
        defaultModel: getEnv('HF_MODEL') || HF_FALLBACK_MODELS[0],
      },
      200,
      origin,
    );
  }

  const auth = await verifySupabaseUser(request);
  if (!auth.ok) {
    return jsonResponse({error: auth.error}, auth.status, origin);
  }

  if (request.method !== 'POST') {
    return jsonResponse({error: 'Method not allowed'}, 405, origin);
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({error: 'Invalid JSON request body.'}, 400, origin);
  }

  try {
    if (routePath === '/ai/verify') {
      const {text, model} = await callProviderCascade(
        [
          {role: 'system', content: 'Respond with only the word READY.'},
          {role: 'user', content: 'Ping'},
        ],
        String(body.model || ''),
        16,
        0.1,
      );
      return jsonResponse({ok: true, model, sample: text.slice(0, 40)}, 200, origin);
    }

    if (routePath === '/ai/chat') {
      const prompt = String(body.prompt || '').trim();
      const knowledgeContext = Array.isArray(body.knowledgeContext)
        ? (body.knowledgeContext as Array<{folder?: string; title?: string; content?: string}>)
        : [];
      const repoContext = Array.isArray(body.repoContext)
        ? (body.repoContext as Array<{path?: string; content?: string}>)
        : [];
      const history = Array.isArray(body.history)
        ? (body.history as Array<{role?: string; content?: string}>)
        : [];

      const systemPrompt = [
        'You are Mantis Cloud Assist, helping the built-in Mantis Studio engine for a single developer.',
        'Ground your technical answers in the provided Knowledge and Repo snippets.',
        'If there is a reusable coding rule, preference, or fix worth remembering, include 1-2 lines at the end:',
        '[LEARN: Short Title | FolderName (Architecture/Patterns/Debugging/Preferences) | tag1, tag2 | Concise reusable note]',
        '',
        knowledgeContext.length > 0
          ? `RELEVANT USER KNOWLEDGE:\n${knowledgeContext
              .map((k, i) => `(${i + 1}) [${k.folder || 'General'}] ${k.title}: ${k.content}`)
              .join('\n\n')}`
          : '',
        repoContext.length > 0
          ? `INDEXED GITHUB REPOSITORY FILES:\n${repoContext
              .map((r) => `--- ${r.path} ---\n${String(r.content || '').slice(0, 2500)}`)
              .join('\n\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');

      const messages = [
        {role: 'system', content: systemPrompt},
        ...history.slice(-8).map((m) => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: String(m.content || '').slice(0, 2000),
        })),
        {role: 'user', content: prompt},
      ];

      const {text, model} = await callProviderCascade(
        messages,
        String(body.model || ''),
        1400,
        0.25,
      );
      return jsonResponse({reply: text, model}, 200, origin);
    }

    if (routePath === '/ai/distill') {
      const rawText = String(body.text || '').trim().slice(0, 18000);
      const sourceTitle = String(body.sourceTitle || 'Captured Screen / Transcript').trim();
      const sourceType = String(body.sourceType || 'capture').trim();
      if (!rawText) {
        return jsonResponse({error: 'No text provided to distill.'}, 400, origin);
      }

      const systemPrompt = [
        'You are Mantis Knowledge Distiller.',
        'Convert raw screen OCR text, YouTube captions, or article excerpts into crisp Knowledge entries.',
        'Respond strictly with valid JSON:',
        '{"summary":"...","entries":[{"title":"...","folder":"Patterns|Architecture|Debugging|Preferences","tags":["..."],"content":"..."}]}',
      ].join('\n');

      const {text, model} = await callProviderCascade(
        [
          {role: 'system', content: systemPrompt},
          {role: 'user', content: `Source (${sourceType}): ${sourceTitle}\n\nRAW CAPTURED TEXT:\n${rawText}`},
        ],
        String(body.model || ''),
        1400,
        0.15,
      );

      let parsed: Record<string, unknown>;
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text) as Record<string, unknown>;
      } catch {
        parsed = {
          summary: text.slice(0, 300),
          entries: [
            {
              title: sourceTitle.slice(0, 80),
              folder: 'Patterns',
              tags: [sourceType, 'distilled'],
              content: text,
            },
          ],
        };
      }

      return jsonResponse({model, ...parsed}, 200, origin);
    }

    if (routePath === '/ai/suggest') {
      const filePath = String(body.filePath || 'src/newFile.ts');
      const originalContent = String(body.originalContent || '');
      const goal = String(body.goal || 'Improve reliability, clarity, accessibility, and safety');
      const knowledgeContext = Array.isArray(body.knowledgeContext)
        ? (body.knowledgeContext as Array<{title?: string; content?: string}>)
        : [];

      const systemPrompt = [
        'You are Mantis Code Engineer proposing a concrete code improvement.',
        'Respond strictly with valid JSON: {"title":"...","rationale":"...","proposedContent":"..."}',
        'Never include secret keys or blocking window.alert/confirm calls.',
        knowledgeContext.length > 0
          ? `FOLLOW THESE USER RULES:\n${knowledgeContext
              .map((k) => `- ${k.title}: ${k.content}`)
              .join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');

      const {text, model} = await callProviderCascade(
        [
          {role: 'system', content: systemPrompt},
          {
            role: 'user',
            content: originalContent
              ? `Target File: ${filePath}\nGoal: ${goal}\n\nCURRENT CODE:\n${originalContent.slice(0, 14000)}`
              : `Create new file: ${filePath}\nGoal: ${goal}`,
          },
        ],
        String(body.model || ''),
        2400,
        0.2,
      );

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text) as {
        title?: string;
        rationale?: string;
        proposedContent?: string;
      };
      return jsonResponse(
        {
          model,
          title: parsed.title || `AI Proposal for ${filePath}`,
          rationale: parsed.rationale || `Generated by ${model}`,
          proposedContent: parsed.proposedContent || originalContent,
        },
        200,
        origin,
      );
    }

    if (routePath === '/extract-url') {
      const targetUrl = String(body.url || '').trim();
      if (!/^https?:\/\//i.test(targetUrl)) {
        return jsonResponse({error: 'Enter a valid http:// or https:// URL.'}, 400, origin);
      }
      const ytId = extractYouTubeVideoId(targetUrl);
      const extracted = ytId
        ? await extractYouTubeTranscript(targetUrl, ytId)
        : await extractWebArticle(targetUrl);
      return jsonResponse(extracted, 200, origin);
    }

    return jsonResponse({error: `Unknown endpoint: ${routePath}`}, 404, origin);
  } catch (err) {
    return jsonResponse(
      {error: err instanceof Error ? err.message : 'Edge function execution error'},
      500,
      origin,
    );
  }
});
