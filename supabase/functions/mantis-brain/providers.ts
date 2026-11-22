import {fetchWithAbortTimeout, getEnv} from './helpers.ts';

export const HF_FALLBACK_MODELS = [
  'Qwen/Qwen2.5-Coder-32B-Instruct',
  'deepseek-ai/DeepSeek-R1',
  'deepseek-ai/DeepSeek-V3.2',
  'Qwen/Qwen2.5-72B-Instruct',
  'meta-llama/Llama-3.3-70B-Instruct',
  'Qwen/Qwen3-Coder-30B-A3B-Instruct',
  'meta-llama/Llama-3.1-8B-Instruct',
];

const GROQ_FALLBACK_MODELS = ['llama-3.3-70b-versatile', 'qwen-qwq-32b', 'llama-3.1-8b-instant'];

const OPENROUTER_FALLBACK_MODELS = [
  'openrouter/free',
  'deepseek/deepseek-r1:free',
  'qwen/qwen3-coder:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-3-27b-it:free',
];

async function discoverLiveOpenRouterFreeModels(): Promise<string[]> {
  try {
    const res = await fetchWithAbortTimeout('https://openrouter.ai/api/v1/models', {}, 4500);
    if (!res.ok) return [];
    const payload = (await res.json()) as {data?: Array<{id?: string}>};
    const freeIds = (payload.data || [])
      .map((m) => String(m.id || '').trim())
      .filter((id) => id.endsWith(':free') || id === 'openrouter/free');
    const preferred = freeIds.filter((id) => /coder|qwen|llama|deepseek|gemma/i.test(id));
    return Array.from(new Set(['openrouter/free', ...preferred, ...freeIds])).slice(0, 4);
  } catch {
    return [];
  }
}

async function tryOllama(
  messages: Array<{role: string; content: string}>,
  preferredModel: string,
  maxTokens: number,
  temperature: number,
) {
  const baseUrl = getEnv('OLLAMA_URL').replace(/\/+$/, '');
  if (!baseUrl) return null;

  const rawPref = String(preferredModel || '').trim();
  const explicitOllama = rawPref.toLowerCase().startsWith('ollama/')
    ? rawPref.slice(7).trim()
    : rawPref.includes(':') && !rawPref.includes('/')
      ? rawPref
      : '';
  const model = explicitOllama || getEnv('OLLAMA_MODEL') || rawPref || 'qwen2.5-coder:7b';
  const headers: Record<string, string> = {'Content-Type': 'application/json'};
  const ollamaKey = getEnv('OLLAMA_API_KEY');
  if (ollamaKey) headers.Authorization = `Bearer ${ollamaKey}`;

  const res = await fetchWithAbortTimeout(
    `${baseUrl}/v1/chat/completions`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({model, messages, max_tokens: maxTokens, temperature}),
    },
    9000,
  );
  if (!res.ok) throw new Error(`Ollama (${res.status}): ${(await res.text()).slice(0, 180)}`);
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
  for (const model of models.slice(0, 3)) {
    try {
      const res = await fetchWithAbortTimeout(
        endpoint,
        {
          method: 'POST',
          headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extraHeaders},
          body: JSON.stringify({model, messages, max_tokens: maxTokens, temperature}),
        },
        8500,
      );
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
    } catch (err) {
      lastErr = `${providerLabel} ${model}: ${err instanceof Error ? err.message : 'Request timed out'}`;
    }
  }
  throw new Error(lastErr);
}

export async function callProviderCascade(
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
    const openRouterHeaders = {
      'HTTP-Referer': 'https://studiosmobile092-code.github.io/Mantis/',
      'X-Title': 'Mantis Studio',
    };
    try {
      const res = await tryOpenAiCompatible(
        'https://openrouter.ai/api/v1/chat/completions',
        openRouterKey,
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
            openRouterKey,
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
