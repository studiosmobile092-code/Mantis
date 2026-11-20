const DEFAULT_SUPABASE_URL = 'https://ncbtoawlltxukzzdyvhc.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_wCDq_uAfoddEBuNLYeLcmQ_WqkXHnpx';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export function corsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
    'Access-Control-Max-Age': '86400',
  };
}

export function jsonResponse(data: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {'Content-Type': 'application/json', ...corsHeaders(origin)},
  });
}

export function getEnv(key: string): string {
  try {
    return (Deno.env.get(key) || '').trim();
  } catch {
    return '';
  }
}

export async function verifySupabaseUser(request: Request) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return {ok: false as const, status: 401, error: 'Missing Supabase Bearer session token.'};
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return {ok: false as const, status: 401, error: 'Empty Bearer token.'};
  }

  const supabaseUrl = (getEnv('SUPABASE_URL') || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
  const publishableKey =
    getEnv('SUPABASE_ANON_KEY') ||
    getEnv('SUPABASE_PUBLISHABLE_KEY') ||
    DEFAULT_SUPABASE_PUBLISHABLE_KEY;

  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {apikey: publishableKey, Authorization: `Bearer ${token}`},
  });
  if (!res.ok) {
    return {ok: false as const, status: 401, error: 'Invalid or expired Supabase session.'};
  }

  const user = (await res.json()) as {email?: string};
  const allowedEmail = getEnv('ALLOWED_EMAIL').toLowerCase();
  if (allowedEmail && (user.email || '').toLowerCase() !== allowedEmail) {
    return {ok: false as const, status: 403, error: 'Account email is not authorized for this Mantis Brain.'};
  }
  return {ok: true as const, user};
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

export function extractYouTubeVideoId(rawUrl: string): string | null {
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
  const capRes = await fetch(trackUrl, {headers: {'User-Agent': BROWSER_UA}});
  if (!capRes.ok) return [];
  const raw = await capRes.text();

  if (raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as {events?: Array<{segs?: Array<{utf8?: string}>}>};
      const out: string[] = [];
      for (const ev of parsed.events || []) {
        if (!Array.isArray(ev.segs)) continue;
        const line = ev.segs.map((s) => String(s.utf8 || '')).join('').replace(/\s+/g, ' ').trim();
        if (line) out.push(line);
      }
      if (out.length > 0) return out;
    } catch {
      // fall through to XML
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
    {clientName: 'WEB', clientVersion: '2.20240801.01.00', userAgent: BROWSER_UA},
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
      if (tracks.length > 0 || title || description) return {title, author, description, tracks};
    } catch {
      // try next client
    }
  }
  return null;
}

export async function extractYouTubeTranscript(url: string, videoId: string) {
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
      headers: {'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9'},
    });
    if (pageRes.ok) {
      const html = await pageRes.text();
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      if (titleMatch && !inner?.title) {
        title = decodeHtmlEntities(titleMatch[1].replace(/\s*-\s*YouTube\s*$/i, '').trim());
      }
      const idx = html.indexOf('"captionTracks":');
      if (idx !== -1) {
        const arrayStart = html.indexOf('[', idx + 16);
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
        return {kind: 'youtube' as const, url, title, text: `${header}${lines.join('\n')}`};
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
        'Note: Public captions were disabled; extracted video description:',
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
    headers: {Accept: 'text/plain, text/markdown', 'X-Return-Format': 'markdown'},
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
  return {kind: 'article' as const, url, title, text: body.slice(0, 35000)};
}

export async function extractWebArticle(url: string) {
  try {
    const res = await fetch(url, {
      headers: {'User-Agent': BROWSER_UA, Accept: 'text/html,text/plain,application/json,text/markdown'},
    });
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      const raw = await res.text();
      if (!contentType.includes('html')) {
        return {kind: 'article' as const, url, title: url, text: raw.slice(0, 35000)};
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
      if (text.length >= 260) return {kind: 'article' as const, url, title, text};
    }
  } catch {
    // Fall through to markdown reader fallback
  }

  const readerResult = await fetchJinaMarkdownFallback(url);
  if (readerResult) return readerResult;

  throw new Error(
    'Could not read clean article text from that URL (the site may require login or block automated readers). Copy-paste the text into the box below.',
  );
}
