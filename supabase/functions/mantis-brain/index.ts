// Optional Supabase Edge Function mirror for Mantis AI Brain.
// Note: For Galaxy Tab A9+ / browser-only setup, Cloudflare Workers (cloudflare/worker.js)
// can be deployed directly from your browser without installing a CLI.
// If you prefer Supabase Edge Functions:
//   supabase secrets set HF_TOKEN=your_rotated_hf_token
//   supabase functions deploy mantis-brain

const FALLBACK_MODELS = [
  'Qwen/Qwen2.5-Coder-32B-Instruct',
  'Qwen/Qwen2.5-72B-Instruct',
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {status: 204, headers: CORS_HEADERS});
  }

  const hfToken = Deno.env.get('HF_TOKEN') || '';
  if (!hfToken) {
    return new Response(JSON.stringify({error: 'HF_TOKEN secret is missing.'}), {
      status: 500,
      headers: {...CORS_HEADERS, 'Content-Type': 'application/json'},
    });
  }

  const body = await req.json().catch(() => ({}));
  const messages = Array.isArray(body.messages) ? body.messages : [{role: 'user', content: String(body.prompt || '')}];
  const model = String(body.model || Deno.env.get('HF_MODEL') || FALLBACK_MODELS[0]);

  const res = await fetch('https://router.huggingface.co/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${hfToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 1400,
      temperature: 0.25,
    }),
  });

  const payload = await res.json();
  return new Response(JSON.stringify({reply: payload?.choices?.[0]?.message?.content || '', model}), {
    status: res.status,
    headers: {...CORS_HEADERS, 'Content-Type': 'application/json'},
  });
});
