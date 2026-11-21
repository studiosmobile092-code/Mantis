import {
  corsHeaders,
  extractWebArticle,
  extractYouTubeTranscript,
  extractYouTubeVideoId,
  getEnv,
  isSafePublicHttpUrl,
  jsonResponse,
  verifySupabaseUser,
} from './helpers.ts';
import {HF_FALLBACK_MODELS, callProviderCascade} from './providers.ts';

function normalizeRoutePath(pathname: string): string {
  const stripped = pathname
    .replace(/^\/functions\/v1\/mantis-brain/i, '')
    .replace(/^\/mantis-brain/i, '');
  return stripped || '/';
}

export async function handleMantisRequest(request: Request): Promise<Response> {
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
  if (!auth.ok) return jsonResponse({error: auth.error}, auth.status, origin);
  if (request.method !== 'POST') return jsonResponse({error: 'Method not allowed'}, 405, origin);

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

      const {text, model} = await callProviderCascade(messages, String(body.model || ''), 1400, 0.25);
      return jsonResponse({reply: text, model}, 200, origin);
    }

    if (routePath === '/ai/distill') {
      const rawText = String(body.text || '').trim().slice(0, 18000);
      const sourceTitle = String(body.sourceTitle || 'Captured Screen / Transcript').trim();
      const sourceType = String(body.sourceType || 'capture').trim();
      if (!rawText) return jsonResponse({error: 'No text provided to distill.'}, 400, origin);

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
          ? `FOLLOW THESE USER RULES:\n${knowledgeContext.map((k) => `- ${k.title}: ${k.content}`).join('\n')}`
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

    return jsonResponse({error: `Unknown endpoint: ${routePath}`}, 404, origin);
  } catch (err) {
    return jsonResponse(
      {error: err instanceof Error ? err.message : 'Edge function execution error'},
      500,
      origin,
    );
  }
}
