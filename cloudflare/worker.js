/**
 * Mantis AI Brain — Cloudflare Worker Proxy (Free Tier: 100,000 requests/day)
 *
 * Security model:
 * - Your Hugging Face token (HF_TOKEN) is stored ONLY as a Cloudflare Worker Secret.
 * - Never put HF_TOKEN or sb_secret_ into GitHub or frontend code.
 * - Every request must include your signed-in Supabase JWT (Authorization: Bearer <token>),
 *   verified against Supabase Auth before any Hugging Face model call runs.
 *
 * Cloudflare Environment Variables / Secrets to add in Dashboard -> Settings -> Variables:
 * - HF_TOKEN (Secret): your rotated Hugging Face Access Token
 * - ALLOWED_EMAIL (Variable, optional): e.g. studiosmobile092@gmail.com (locks Worker to your account)
 * - HF_MODEL (Variable, optional): e.g. Qwen/Qwen2.5-Coder-32B-Instruct
 * - SUPABASE_URL (Variable, optional): defaults to https://ncbtoawlltxukzzdyvhc.supabase.co
 * - SUPABASE_PUBLISHABLE_KEY (Variable, optional): defaults to Mantis public publishable key
 */

const DEFAULT_SUPABASE_URL = 'https://ncbtoawlltxukzzdyvhc.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_wCDq_uAfoddEBuNLYeLcmQ_WqkXHnpx';

const FALLBACK_MODELS = [
  'Qwen/Qwen2.5-Coder-32B-Instruct',
  'Qwen/Qwen3-Coder-30B-A3B-Instruct',
  'meta-llama/Llama-3.3-70B-Instruct',
  'Qwen/Qwen2.5-72B-Instruct',
  'meta-llama/Llama-3.1-8B-Instruct',
];

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
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

  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token}`,
    },
  });

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

async function callHuggingFaceChat(env, messages, preferredModel, maxTokens = 1400, temperature = 0.25) {
  const hfToken = (env.HF_TOKEN || '').trim();
  if (!hfToken) {
    throw new Error('HF_TOKEN secret is not configured in Cloudflare Worker Variables & Secrets.');
  }

  const candidates = Array.from(
    new Set([preferredModel, env.HF_MODEL, ...FALLBACK_MODELS].filter(Boolean)),
  );

  let lastError = 'No model responded.';
  for (const model of candidates) {
    const res = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${hfToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
    });

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
        throw new Error(
          'Hugging Face rejected HF_TOKEN (401 Unauthorized). Create a fresh token at huggingface.co/settings/tokens and update HF_TOKEN in Cloudflare Variables & Secrets.',
        );
      }
      if (res.status === 403) {
        throw new Error(
          'Hugging Face token lacks "Make calls to Inference Providers" permission (403 Forbidden). Edit your token permissions at huggingface.co/settings/tokens or create a new Inference token.',
        );
      }
      if (res.status === 402) {
        throw new Error(
          'Hugging Face monthly free Inference Providers credit limit reached (402 Payment Required).',
        );
      }
      lastError = `${model} (${res.status}): ${errText.slice(0, 200)}`;
    }
  }

  throw new Error(`Hugging Face inference failed: ${lastError}`);
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
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

async function extractYouTubeTranscript(url, videoId) {
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!pageRes.ok) {
    throw new Error(`YouTube returned status ${pageRes.status}.`);
  }
  const html = await pageRes.text();
  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  const title = titleMatch
    ? decodeHtmlEntities(titleMatch[1].replace(/\s*-\s*YouTube\s*$/i, '').trim())
    : `YouTube Video ${videoId}`;

  const captionsMarker = '"captionTracks":';
  const idx = html.indexOf(captionsMarker);
  if (idx === -1) {
    throw new Error(
      'No public caption track found on this YouTube video (captions may be disabled or blocked). Try Live Screen Capture or Mic/Paste mode instead.',
    );
  }

  const arrayStart = html.indexOf('[', idx + captionsMarker.length);
  const jsonSlice = arrayStart !== -1 ? extractBalancedJsonArray(html, arrayStart) : null;
  if (!jsonSlice) {
    throw new Error('Could not parse YouTube caption track list.');
  }
  const tracks = JSON.parse(jsonSlice);
  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new Error('Caption track list is empty.');
  }

  const chosen =
    tracks.find((t) => (t.languageCode || '').startsWith('en') && t.kind !== 'asr') ||
    tracks.find((t) => (t.languageCode || '').startsWith('en')) ||
    tracks[0];

  if (!chosen?.baseUrl) {
    throw new Error('Missing caption track URL.');
  }

  const capRes = await fetch(chosen.baseUrl);
  if (!capRes.ok) {
    throw new Error(`Failed to fetch caption track (${capRes.status}).`);
  }
  const xml = await capRes.text();
  const lines = [];
  const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const cleaned = decodeHtmlEntities(match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (cleaned) lines.push(cleaned);
  }

  if (lines.length === 0) {
    throw new Error('YouTube caption track returned empty text.');
  }

  return {
    kind: 'youtube',
    url,
    title,
    text: lines.join('\n'),
  };
}

async function extractWebArticle(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'MantisWebReader/1.0 (+https://studiosmobile092-code.github.io/Mantis/)',
      Accept: 'text/html,text/plain,application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`Target site returned HTTP ${res.status}.`);
  }
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

  return {
    kind: 'article',
    url,
    title,
    text,
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '*';

    if (request.method === 'OPTIONS') {
      return new Response(null, {status: 204, headers: corsHeaders(origin)});
    }

    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') {
      return jsonResponse(
        {
          ok: true,
          service: 'mantis-ai-brain',
          hasHfToken: Boolean((env.HF_TOKEN || '').trim()),
          defaultModel: env.HF_MODEL || FALLBACK_MODELS[0],
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
