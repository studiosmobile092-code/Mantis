/**
 * Mantis AI Brain — Cloudflare Worker Proxy (Free Tier: 100,000 requests/day)
 *
 * Security model:
 * - Never put API tokens or sb_secret_ into GitHub or frontend code.
 * - Every AI/extract request must include your signed-in Supabase JWT (Authorization: Bearer <token>),
 *   verified against Supabase Auth before any model or URL fetch runs.
 *
 * Supported AI Providers (automatic fallback cascade — add ANY one or multiple):
 * 1) Cloudflare Workers AI (FREE 10,000 Neurons/day, resets daily, NO API key needed!):
 *    Cloudflare Worker -> Settings -> Bindings -> Add -> Workers AI -> Variable name: AI
 * 2) Your Own Ollama Server (ZERO cloud limits):
 *    Add Variable OLLAMA_URL (e.g. https://your-ollama-tunnel.trycloudflare.com) + optional OLLAMA_MODEL
 * 3) Groq Free API (console.groq.com, generous daily free tier, no credit card):
 *    Add Secret GROQ_API_KEY
 * 4) OpenRouter Free Models (openrouter.ai):
 *    Add Secret OPENROUTER_API_KEY
 * 5) Hugging Face Router (optional fallback):
 *    Add Secret HF_TOKEN
 *
 * Access Lock (recommended):
 * - ALLOWED_EMAIL (Variable): e.g. studiosmobile092@gmail.com
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
  'openrouter/free',
  'qwen/qwen3-coder:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-3-27b-it:free',
];

const ALLOWED_ORIGIN_EXACT = new Set([
  'https://studiosmobile092-code.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

const ALLOWED_ORIGIN_RE =
  /^https:\/\/[a-z0-9-]+\.(aistudio\.google\.com|run\.app|googleusercontent\.com|github\.io)$/i;

function resolveAllowedOrigin(origin) {
  if (!origin || origin === '*') return 'https://studiosmobile092-code.github.io';
  const clean = String(origin).trim();
  if (ALLOWED_ORIGIN_EXACT.has(clean) || ALLOWED_ORIGIN_RE.test(clean)) {
    return clean;
  }
  return 'https://studiosmobile092-code.github.io';
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': resolveAllowedOrigin(origin),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}

async function fetchWithAbortTimeout(url, init = {}, timeoutMs = 8500) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Upstream request timed out after ${Math.round(timeoutMs / 1000)}s`));
  }, timeoutMs);
  try {
    return await fetch(url, {...init, signal: controller.signal});
  } finally {
    clearTimeout(timer);
  }
}

function isPrivateOrDisallowedHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localdomain') ||
    host === 'metadata'
  ) {
    return true;
  }

  // Block IPv6 loopback, link-local, unique-local, unspecified, and IPv4-mapped ranges
  if (host.includes(':')) {
    if (
      host === '::1' ||
      host === '::' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80') ||
      host.startsWith('::ffff:')
    ) {
      return true;
    }
    return false;
  }

  // Block integer/hex/octal obfuscated IPv4 literals
  if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) {
    return true;
  }

  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    const c = Number(ipv4Match[3]);
    const d = Number(ipv4Match[4]);
    if (a > 255 || b > 255 || c > 255 || d > 255) return true;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && c === 0) return true;
    if (a >= 224) return true;
  }

  return false;
}

function isSafePublicHttpUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    if (isPrivateOrDisallowedHost(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

async function safePublicFetch(rawUrl, init = {}, timeoutMs = 9500) {
  let current = rawUrl;
  for (let hop = 0; hop < 4; hop += 1) {
    if (!isSafePublicHttpUrl(current)) {
      throw new Error('Blocked unsafe or private network URL target.');
    }
    const res = await fetchWithAbortTimeout(current, {...init, redirect: 'manual'}, timeoutMs);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects while fetching external URL.');
}

async function discoverLiveOpenRouterFreeModels() {
  try {
    const res = await fetchWithAbortTimeout('https://openrouter.ai/api/v1/models', {}, 4500);
    if (!res.ok) return [];
    const payload = await res.json();
    const freeIds = (payload.data || [])
      .map((m) => String(m.id || '').trim())
      .filter((id) => id.endsWith(':free') || id === 'openrouter/free');
    const preferred = freeIds.filter((id) => /coder|qwen|llama|deepseek|gemma/i.test(id));
    return Array.from(new Set(['openrouter/free', ...preferred, ...freeIds])).slice(0, 4);
  } catch {
    return [];
  }
}

function getWorkersAiCandidates(preferredModel) {
  const pref = String(preferredModel || '').toLowerCase();
  if (pref.includes('deepseek')) {
    return [
      '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
      '@cf/qwen/qwen2.5-coder-32b-instruct',
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/meta/llama-3.1-8b-instruct-fast',
    ];
  }
  if (pref.includes('llama') || pref.includes('72b')) {
    return [
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/qwen/qwen2.5-coder-32b-instruct',
      '@cf/meta/llama-3.1-8b-instruct-fast',
    ];
  }
  return [
    '@cf/qwen/qwen2.5-coder-32b-instruct',
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    '@cf/meta/llama-3.1-8b-instruct-fast',
  ];
}

async function verifySupabaseUser(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return {ok: false, status: 401, error: 'Missing Supabase Bearer session token.'};
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return {ok: false, status: 401, error: 'Empty Bearer token.'};
  }

  const supabaseUrl = (env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY;

  const res = await fetchWithAbortTimeout(
    `${supabaseUrl}/auth/v1/user`,
    {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${token}`,
      },
    },
    6000,
  );

  if (!res.ok) {
    return {ok: false, status: 401, error: 'Invalid or expired Supabase session.'};
  }

  const user = await res.json();
  const allowedEmail = (env.ALLOWED_EMAIL || '').trim().toLowerCase();
  if (allowedEmail && (user.email || '').toLowerCase() !== allowedEmail) {
    return {ok: false, status: 403, error: 'Account email is not authorized for this Mantis Brain.'};
  }

  return {ok: true, user};
}

async function tryOllama(env, messages, preferredModel, maxTokens, temperature) {
  const baseUrl = (env.OLLAMA_URL || '').trim().replace(/\/+$/, '');
  if (!baseUrl) return null;

  const model = (env.OLLAMA_MODEL || preferredModel || 'qwen2.5-coder:7b').trim();
  const headers = {'Content-Type': 'application/json'};
  if ((env.OLLAMA_API_KEY || '').trim()) {
    headers.Authorization = `Bearer ${env.OLLAMA_API_KEY.trim()}`;
  }

  const res = await fetchWithAbortTimeout(
    `${baseUrl}/v1/chat/completions`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
    },
    9000,
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama (${res.status}): ${errText.slice(0, 180)}`);
  }
  const payload = await res.json();
  const text = (payload?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new Error('Ollama returned empty response.');
  return {text, model: `ollama/${model}`};
}

async function tryWorkersAi(env, messages, preferredModel, maxTokens, temperature) {
  if (!env.AI || typeof env.AI.run !== 'function') return null;

  let lastErr = 'Workers AI failed';
  for (const cfModel of getWorkersAiCandidates(preferredModel)) {
    try {
      const result = await env.AI.run(cfModel, {
        messages,
        max_tokens: maxTokens,
        temperature,
      });
      const text = (
        result?.response ||
        result?.choices?.[0]?.message?.content ||
        ''
      ).trim();
      if (text) {
        return {text, model: cfModel};
      }
    } catch (err) {
      lastErr = `${cfModel}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  throw new Error(`Cloudflare Workers AI: ${lastErr}`);
}

async function tryOpenAiCompatible(endpoint, apiKey, models, providerLabel, messages, maxTokens, temperature, extraHeaders = {}) {
  const key = (apiKey || '').trim();
  if (!key) return null;

  let lastErr = `${providerLabel} failed`;
  for (const model of models.slice(0, 3)) {
    try {
      const res = await fetchWithAbortTimeout(
        endpoint,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            ...extraHeaders,
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: maxTokens,
            temperature,
          }),
        },
        8500,
      );

      if (res.ok) {
        const payload = await res.json();
        const msg = payload?.choices?.[0]?.message;
        const text = (msg?.content || msg?.reasoning_content || '').trim();
        if (text) {
          return {text, model};
        }
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
          lastErr = `${providerLabel} token lacks Inference permission (403 Forbidden)`;
          break;
        }
        lastErr = `${providerLabel} ${model} (${res.status}): ${errText.slice(0, 140)}`;
      }
    } catch (err) {
      lastErr = `${providerLabel} ${model}: ${err instanceof Error ? err.message : 'Request timed out'}`;
    }
  }
  throw new Error(lastErr);
}

async function callHuggingFaceChat(env, messages, preferredModel, maxTokens = 1400, temperature = 0.25) {
  const errors = [];

  // 1. User's own Ollama server (0 external limits)
  if ((env.OLLAMA_URL || '').trim()) {
    try {
      const res = await tryOllama(env, messages, preferredModel, maxTokens, temperature);
      if (res) return res;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  // 2. Cloudflare Workers AI binding (10,000 free Neurons/day, resets daily, no token required!)
  if (env.AI) {
    try {
      const res = await tryWorkersAi(env, messages, preferredModel, maxTokens, temperature);
      if (res) return res;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  // 3. Groq Free API
  if ((env.GROQ_API_KEY || '').trim()) {
    try {
      const res = await tryOpenAiCompatible(
        'https://api.groq.com/openai/v1/chat/completions',
        env.GROQ_API_KEY,
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

  // 4. OpenRouter Free API
  if ((env.OPENROUTER_API_KEY || '').trim()) {
    const openRouterHeaders = {
      'HTTP-Referer': 'https://studiosmobile092-code.github.io/Mantis/',
      'X-Title': 'Mantis AI',
    };
    try {
      const res = await tryOpenAiCompatible(
        'https://openrouter.ai/api/v1/chat/completions',
        env.OPENROUTER_API_KEY,
        OPENROUTER_FALLBACK_MODELS,
        'OpenRouter',
        messages,
        maxTokens,
        temperature,
        openRouterHeaders,
      );
      if (res) return res;
    } catch (firstErr) {
      const liveModels = await discoverLiveOpenRouterFreeModels();
      const extraModels = liveModels
        .filter((id) => !OPENROUTER_FALLBACK_MODELS.includes(id))
        .slice(0, 2);
      if (extraModels.length > 0) {
        try {
          const retryRes = await tryOpenAiCompatible(
            'https://openrouter.ai/api/v1/chat/completions',
            env.OPENROUTER_API_KEY,
            extraModels,
            'OpenRouter',
            messages,
            maxTokens,
            temperature,
            openRouterHeaders,
          );
          if (retryRes) return retryRes;
        } catch (retryErr) {
          errors.push(retryErr instanceof Error ? retryErr.message : String(retryErr));
        }
      } else {
        errors.push(firstErr instanceof Error ? firstErr.message : String(firstErr));
      }
    }
  }

  // 5. Hugging Face Router fallback
  if ((env.HF_TOKEN || '').trim()) {
    const hfModels = Array.from(
      new Set([preferredModel, env.HF_MODEL, ...HF_FALLBACK_MODELS].filter(Boolean)),
    );
    try {
      const res = await tryOpenAiCompatible(
        'https://router.huggingface.co/v1/chat/completions',
        env.HF_TOKEN,
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
      'No AI provider configured in Cloudflare. Add the free Workers AI binding named "AI" (10,000 Neurons/day, zero keys needed), or add OLLAMA_URL / GROQ_API_KEY / OPENROUTER_API_KEY.',
    );
  }

  throw new Error(errors.join(' | '));
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function extractYouTubeVideoId(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.replace(/^\/+/, '').split('/')[0] || null;
    }
    if (u.hostname.includes('youtube.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
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

function extractBalancedJsonArray(source, startIndex) {
  if (source[startIndex] !== '[') return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '[') {
      depth += 1;
    } else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }
  return null;
}

function isAllowedYouTubeCaptionUrl(trackUrl) {
  try {
    const parsed = new URL(trackUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'www.youtube.com' || host.endsWith('.youtube.com') || host.endsWith('.googlevideo.com');
  } catch {
    return false;
  }
}

async function fetchCaptionTrackLines(trackUrl) {
  if (!isAllowedYouTubeCaptionUrl(trackUrl)) return [];
  const capRes = await fetchWithAbortTimeout(
    trackUrl,
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
    },
    7000,
  );
  if (!capRes.ok) return [];
  const raw = await capRes.text();

  // Support json3 caption format if returned
  if (raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      const events = Array.isArray(parsed.events) ? parsed.events : [];
      const out = [];
      for (const ev of events) {
        if (!Array.isArray(ev.segs)) continue;
        const line = ev.segs
          .map((s) => String(s.utf8 || ''))
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        if (line && line !== '\n') out.push(line);
      }
      if (out.length > 0) return out;
    } catch {
      // fall through to XML parser
    }
  }

  const lines = [];
  const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    const cleaned = decodeHtmlEntities(match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (cleaned) lines.push(cleaned);
  }
  return lines;
}

async function fetchYouTubeInnerTube(videoId) {
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
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    },
  ];

  for (const client of clients) {
    try {
      const res = await fetchWithAbortTimeout(
        'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
        {
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
                androidSdkVersion: client.androidSdkVersion,
                hl: 'en',
                gl: 'US',
              },
            },
          }),
        },
        7000,
      );
      if (!res.ok) continue;
      const data = await res.json();
      const title = String(data?.videoDetails?.title || '').trim();
      const author = String(data?.videoDetails?.author || '').trim();
      const description = String(data?.videoDetails?.shortDescription || '').trim();
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(tracks) && tracks.length > 0) {
        return {title, author, description, tracks};
      }
      if (title || description) {
        return {title, author, description, tracks: []};
      }
    } catch {
      // try next client
    }
  }
  return null;
}

async function extractYouTubeTranscript(url, videoId) {
  let title = `YouTube Video ${videoId}`;
  let author = '';
  let description = '';
  let tracks = [];

  // Strategy 1: YouTube InnerTube player API (returns clean captionTracks + metadata)
  const inner = await fetchYouTubeInnerTube(videoId);
  if (inner) {
    if (inner.title) title = inner.title;
    if (inner.author) author = inner.author;
    if (inner.description) description = inner.description;
    if (Array.isArray(inner.tracks) && inner.tracks.length > 0) {
      tracks = inner.tracks;
    }
  }

  // Strategy 2: Desktop watch HTML page parsing fallback
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
      if (!description) {
        const descMatch = html.match(/"shortDescription":"((?:\\.|[^"\\])*)"/);
        if (descMatch) {
          try {
            description = JSON.parse(`"${descMatch[1]}"`);
          } catch {
            // ignore
          }
        }
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
          kind: 'youtube',
          url,
          title,
          text: `${header}${lines.join('\n')}`,
        };
      }
    }
  }

  // Strategy 3: oEmbed + video description fallback when captions are disabled
  if (!description) {
    try {
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      );
      if (oembedRes.ok) {
        const oembed = await oembedRes.json();
        if (oembed?.title) title = String(oembed.title);
        if (oembed?.author_name) author = String(oembed.author_name);
      }
    } catch {
      // ignore
    }
  }

  if (description.trim().length >= 40) {
    return {
      kind: 'youtube',
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

async function fetchJinaMarkdownFallback(url) {
  if (!isSafePublicHttpUrl(url)) return null;
  const jinaUrl = `https://r.jina.ai/${url}`;
  const res = await fetchWithAbortTimeout(
    jinaUrl,
    {
      headers: {
        Accept: 'text/plain, text/markdown',
        'X-Return-Format': 'markdown',
      },
    },
    9500,
  );
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
    kind: 'article',
    url,
    title,
    text: body.slice(0, 35000),
  };
}

async function extractWebArticle(url) {
  if (!isSafePublicHttpUrl(url)) {
    throw new Error('Blocked unsafe or private network URL target.');
  }
  try {
    const res = await safePublicFetch(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Accept: 'text/html,text/plain,application/json,text/markdown',
        },
      },
      9500,
    );
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      const raw = await res.text();
      if (!contentType.includes('html')) {
        return {
          kind: 'article',
          url,
          title: url,
          text: raw.slice(0, 35000),
        };
      }

      const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/\s+/g, ' ').trim()) : url;

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
          kind: 'article',
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

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '*';

    if (request.method === 'OPTIONS') {
      return new Response(null, {status: 204, headers: corsHeaders(origin)});
    }

    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') {
      const hasWorkersAi = Boolean(env.AI);
      const hasOllamaUrl = Boolean((env.OLLAMA_URL || '').trim());
      const hasGroqKey = Boolean((env.GROQ_API_KEY || '').trim());
      const hasOpenRouterKey = Boolean((env.OPENROUTER_API_KEY || '').trim());
      const hasHfToken = Boolean((env.HF_TOKEN || '').trim());
      const activeProviders = [
        hasOllamaUrl ? 'ollama' : null,
        hasWorkersAi ? 'workers-ai' : null,
        hasGroqKey ? 'groq' : null,
        hasOpenRouterKey ? 'openrouter' : null,
        hasHfToken ? 'huggingface' : null,
      ].filter(Boolean);

      return jsonResponse(
        {
          ok: true,
          service: 'mantis-ai-brain',
          hasWorkersAi,
          hasOllamaUrl,
          hasGroqKey,
          hasOpenRouterKey,
          hasHfToken,
          hasAnyProvider: activeProviders.length > 0,
          activeProviders,
          defaultModel: env.HF_MODEL || HF_FALLBACK_MODELS[0],
        },
        200,
        origin,
      );
    }

    const auth = await verifySupabaseUser(request, env);
    if (!auth.ok) {
      return jsonResponse({error: auth.error}, auth.status, origin);
    }

    if (request.method !== 'POST') {
      return jsonResponse({error: 'Method not allowed'}, 405, origin);
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      return jsonResponse({error: 'Invalid JSON request body.'}, 400, origin);
    }

    try {
      if (url.pathname === '/ai/verify') {
        const {text, model} = await callHuggingFaceChat(
          env,
          [
            {role: 'system', content: 'Respond with only the word READY.'},
            {role: 'user', content: 'Ping'},
          ],
          body.model,
          16,
          0.1,
        );
        return jsonResponse({ok: true, model, sample: text.slice(0, 40)}, 200, origin);
      }

      if (url.pathname === '/ai/chat') {
        const prompt = String(body.prompt || '').trim();
        const knowledgeContext = Array.isArray(body.knowledgeContext) ? body.knowledgeContext : [];
        const repoContext = Array.isArray(body.repoContext) ? body.repoContext : [];
        const history = Array.isArray(body.history) ? body.history : [];

        const systemPrompt = [
          'You are Mantis, a sharp, practical personal coding AI companion running for a single developer.',
          'You remember everything the user has taught you in Knowledge and what they captured from screen/YouTube/articles.',
          'Think like an autonomous engineering agent: give concrete, accurate, step-by-step technical answers grounded in the provided Knowledge and Repo snippets.',
          'If the user teaches you a new fact, preference, rule, or fix during chat (or if there is a clear reusable takeaway worth remembering permanently), include 1-2 lines at the very end using this exact tag format:',
          '[LEARN: Short Title | FolderName (Architecture/Patterns/Debugging/Preferences) | tag1, tag2 | Concise reusable note]',
          '',
          knowledgeContext.length > 0
            ? `RELEVANT USER KNOWLEDGE:\n${knowledgeContext
                .map((k, i) => `(${i + 1}) [${k.folder || 'General'}] ${k.title}: ${k.content}`)
                .join('\n\n')}`
            : 'RELEVANT USER KNOWLEDGE: (none matched yet)',
          '',
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

        const {text, model} = await callHuggingFaceChat(env, messages, body.model, 1400, 0.25);
        return jsonResponse({reply: text, model}, 200, origin);
      }

      if (url.pathname === '/ai/distill') {
        const rawText = String(body.text || '').trim().slice(0, 18000);
        const sourceTitle = String(body.sourceTitle || 'Captured Screen / Transcript').trim();
        const sourceType = String(body.sourceType || 'capture').trim();
        if (!rawText) {
          return jsonResponse({error: 'No text provided to distill.'}, 400, origin);
        }

        const systemPrompt = [
          'You are Mantis Knowledge Distiller.',
          'Convert raw screen OCR text, YouTube captions, or article excerpts into clean, high-signal Knowledge entries the AI can reuse later.',
          'Respond strictly with valid JSON matching this schema:',
          '{"summary":"...","entries":[{"title":"...","folder":"Patterns|Architecture|Debugging|Preferences","tags":["..."],"content":"..."}]}',
          'Produce 1 to 5 crisp, non-repetitive entries. Strip OCR noise/timestamps/UI chrome. Do not wrap JSON in markdown fences.',
        ].join('\n');

        const {text, model} = await callHuggingFaceChat(
          env,
          [
            {role: 'system', content: systemPrompt},
            {
              role: 'user',
              content: `Source (${sourceType}): ${sourceTitle}\n\nRAW CAPTURED TEXT:\n${rawText}`,
            },
          ],
          body.model,
          1400,
          0.15,
        );

        let parsed = null;
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
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

      if (url.pathname === '/ai/suggest') {
        const filePath = String(body.filePath || 'src/newFile.ts');
        const originalContent = String(body.originalContent || '');
        const goal = String(body.goal || 'Improve reliability, clarity, accessibility, and safety');
        const knowledgeContext = Array.isArray(body.knowledgeContext) ? body.knowledgeContext : [];

        const systemPrompt = [
          'You are Mantis Code Engineer proposing a concrete code improvement or new module.',
          'Respond strictly with valid JSON: {"title":"...","rationale":"...","proposedContent":"..."}',
          'proposedContent MUST be the complete updated file text ready for line-by-line diffing (no markdown fences inside JSON values).',
          'Never include secret keys or blocking window.alert/confirm calls.',
          knowledgeContext.length > 0
            ? `FOLLOW THESE USER RULES:\n${knowledgeContext
                .map((k) => `- ${k.title}: ${k.content}`)
                .join('\n')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n');

        const {text, model} = await callHuggingFaceChat(
          env,
          [
            {role: 'system', content: systemPrompt},
            {
              role: 'user',
              content: originalContent
                ? `Target File: ${filePath}\nGoal: ${goal}\n\nCURRENT CODE:\n${originalContent.slice(0, 14000)}`
                : `Create new file: ${filePath}\nGoal: ${goal}`,
            },
          ],
          body.model,
          2400,
          0.2,
        );

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
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

      if (url.pathname === '/extract-url') {
        const targetUrl = String(body.url || '').trim();
        if (!/^https?:\/\//i.test(targetUrl)) {
          return jsonResponse({error: 'Enter a valid http:// or https:// URL.'}, 400, origin);
        }
        if (!isSafePublicHttpUrl(targetUrl)) {
          return jsonResponse(
            {error: 'Blocked unsafe or private network URL target.'},
            400,
            origin,
          );
        }
        const ytId = extractYouTubeVideoId(targetUrl);
        const extracted = ytId
          ? await extractYouTubeTranscript(targetUrl, ytId)
          : await extractWebArticle(targetUrl);
        return jsonResponse(extracted, 200, origin);
      }

      return jsonResponse({error: `Unknown endpoint: ${url.pathname}`}, 404, origin);
    } catch (err) {
      return jsonResponse(
        {error: err instanceof Error ? err.message : 'Worker execution error'},
        500,
        origin,
      );
    }
  },
};
