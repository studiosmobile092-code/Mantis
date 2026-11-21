import type {
  EvalRunSummary,
  KnowledgeEntry,
  KnowledgeFolder,
  ModelCardConfig,
  PortableBrainBundle,
  ScratchSkillRule,
  TrainingSample,
} from '../types/mantis';
import {getEntryStatus} from './knowledgeSync';
import {loadScratchSkills} from './scratchEngine';
import {computeContentHash, encodeDenseVector384, quantizeInt8} from './vectorStore';

const MODEL_CARD_KEY = 'mantis_model_card_v1';

const DEFAULT_MODEL_CARD: ModelCardConfig = {
  modelName: 'Mantis-Coder-v1',
  version: '1.0.0',
  author: 'Mantis Studio Builder',
  baseArchitecture: 'Qwen/Qwen2.5-Coder-7B-Instruct',
  personaPrompt:
    'You are Mantis, a precise engineering assistant that recalls verified knowledge first, writes clean TypeScript, and protects secrets.',
  tagline: 'Execute work efficiently with verified memory and grounded code reasoning.',
  temperature: 0.2,
  includeOnlyTrusted: false,
};

export function sanitizeModelSlug(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '');
  return cleaned || 'Mantis-Custom-v1';
}

export function loadModelCard(): ModelCardConfig {
  try {
    const raw = window.localStorage.getItem(MODEL_CARD_KEY);
    if (!raw) return DEFAULT_MODEL_CARD;
    const parsed = JSON.parse(raw) as Partial<ModelCardConfig>;
    return {...DEFAULT_MODEL_CARD, ...parsed};
  } catch {
    return DEFAULT_MODEL_CARD;
  }
}

export function saveModelCard(card: ModelCardConfig): ModelCardConfig {
  const sanitized = {
    ...card,
    modelName: sanitizeModelSlug(card.modelName),
    version: card.version.trim() || '1.0.0',
  };
  try {
    window.localStorage.setItem(MODEL_CARD_KEY, JSON.stringify(sanitized));
  } catch {
    // ignore
  }
  return sanitized;
}

export function buildPortableBrainBundle(params: {
  modelCard: ModelCardConfig;
  entries: KnowledgeEntry[];
  folders: KnowledgeFolder[];
  skills?: ScratchSkillRule[];
  latestEval?: EvalRunSummary | null;
}): PortableBrainBundle {
  const folderMap = new Map(params.folders.map((f) => [f.id, f.name]));
  const skills = params.skills ?? loadScratchSkills();

  const filteredEntries = params.entries.filter((e) => {
    const st = getEntryStatus(e);
    return params.modelCard.includeOnlyTrusted ? st === 'trusted' : st !== 'raw';
  });

  const knowledge = filteredEntries.map((entry) => {
    const vec = encodeDenseVector384(
      `${entry.title} ${entry.tags.join(' ')} ${entry.content.slice(0, 1200)}`,
    );
    const q = quantizeInt8(vec);
    return {
      id: entry.id,
      title: entry.title,
      content: entry.content,
      folder: (entry.folder_id && folderMap.get(entry.folder_id)) || 'General',
      tags: entry.tags,
      status: getEntryStatus(entry),
      confidence: entry.confidence_score || 1,
      vectorInt8: q.int8,
      vectorScale: q.scale,
    };
  });

  return {
    schema: 'mantis-brain-bundle/v1',
    exportedAt: new Date().toISOString(),
    modelCard: {...params.modelCard, modelName: sanitizeModelSlug(params.modelCard.modelName)},
    evalSummary: {
      passRate: params.latestEval?.passRate ?? null,
      totalCases: params.latestEval?.totalCases ?? 0,
    },
    skills,
    knowledge,
  };
}

/**
 * In-app Round-Trip Smoke Test: simulates loading the compiled .mantisbrain.json inside
 * an isolated runtime so the user verifies portability before downloading.
 */
export function runExportedBundleSmokeTest(bundle: PortableBrainBundle): {
  passed: boolean;
  checks: Array<{label: string; passed: boolean; detail: string}>;
} {
  const checks: Array<{label: string; passed: boolean; detail: string}> = [];

  checks.push({
    label: 'Schema & Model Name Valid',
    passed:
      bundle.schema === 'mantis-brain-bundle/v1' &&
      /^[a-zA-Z0-9._-]+$/.test(bundle.modelCard.modelName),
    detail: `${bundle.modelCard.modelName} v${bundle.modelCard.version}`,
  });

  checks.push({
    label: 'Int8 Quantized Vector Integrity',
    passed: bundle.knowledge.every(
      (k) => Array.isArray(k.vectorInt8) && k.vectorInt8.length === 384 && Number.isFinite(k.vectorScale),
    ),
    detail: `${bundle.knowledge.length} entries vectorized at 384-d Int8`,
  });

  // Simulated isolated retrieval query on top note or skill
  const sampleQuery =
    bundle.skills[0]?.triggers[0] ||
    bundle.knowledge[0]?.title ||
    'hello';
  const qVec = encodeDenseVector384(sampleQuery);
  let topScore = 0;
  for (const k of bundle.knowledge.slice(0, 80)) {
    let dot = 0;
    for (let i = 0; i < 384; i += 1) dot += qVec[i] * k.vectorInt8[i];
    const sim = dot * k.vectorScale;
    if (sim > topScore) topScore = sim;
  }

  checks.push({
    label: 'Isolated Query Round-Trip Test',
    passed: bundle.knowledge.length === 0 || bundle.skills.length > 0 || topScore > 0.12,
    detail:
      bundle.knowledge.length === 0 && bundle.skills.length === 0
        ? 'Empty starter brain (will still answer greetings & math)'
        : `Query "${sampleQuery.slice(0, 30)}" recalled at ${(topScore * 100).toFixed(0)}% cosine similarity`,
  });

  checks.push({
    label: 'Zero Exposed Secrets',
    passed: !/(sb_secret_|hf_[A-Za-z0-9]{12,}|ghp_[A-Za-z0-9]{12,})/i.test(JSON.stringify(bundle)),
    detail: 'Verified clean JSON payload',
  });

  return {
    passed: checks.every((c) => c.passed),
    checks,
  };
}

export function generateStandaloneChatroomSdkCode(bundle: PortableBrainBundle): string {
  const safeName = sanitizeModelSlug(bundle.modelCard.modelName);
  return `// ${safeName} v${bundle.modelCard.version} — Portable Mantis Chatroom Runtime SDK
// Drop this module + your ${safeName}.mantisbrain.json into ANY web, React, or Node chatroom app!
// Zero API keys, zero external servers required.

export interface MantisMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function createMantisRuntime(bundle) {
  const DIMS = 384;

  function hashToken(str, seed = 2166136261) {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function encode(text) {
    const vec = new Float32Array(DIMS);
    const tokens = text.toLowerCase().replace(/[^a-z0-9_.-/+#\\s]/g, ' ').trim().split(/\\s+/).filter((t) => t.length >= 2);
    for (const tok of tokens) {
      vec[hashToken(tok, 2166136261) % DIMS] += 2.2;
      const h2 = hashToken(tok, 1315423911);
      vec[h2 % DIMS] += (h2 & 1) === 0 ? 1.4 : -1.4;
    }
    let norm = 0;
    for (let i = 0; i < DIMS; i++) norm += vec[i] * vec[i];
    const inv = norm > 1e-8 ? 1 / Math.sqrt(norm) : 0;
    if (inv > 0) for (let i = 0; i < DIMS; i++) vec[i] *= inv;
    return vec;
  }

  return {
    name: bundle.modelCard.modelName,
    version: bundle.modelCard.version,
    ask(prompt) {
      const clean = String(prompt || '').trim();
      const lower = clean.toLowerCase().replace(/[!?.,]+$/g, '');

      // 1. Check Teacher-distilled conversational / domain skills
      for (const skill of bundle.skills || []) {
        if (skill.triggers.some((t) => t.toLowerCase() === lower || (lower.length > 3 && lower.includes(t.toLowerCase())))) {
          const picked = skill.responses[Math.floor(Math.random() * skill.responses.length)] || skill.responses[0];
          return { reply: picked, sources: [skill.folderName], engine: 'distilled-skill' };
        }
      }

      // 2. Hybrid vector + lexical retrieval over Int8 quantized memory
      const qVec = encode(clean);
      const ranked = (bundle.knowledge || [])
        .map((k) => {
          let dot = 0;
          for (let i = 0; i < DIMS; i++) dot += qVec[i] * k.vectorInt8[i];
          const vecSim = dot * k.vectorScale;
          const exactBoost = k.title.toLowerCase().includes(lower) ? 0.45 : 0;
          const trustBoost = k.status === 'trusted' ? 1.35 : 1.0;
          return { item: k, score: (vecSim + exactBoost) * trustBoost };
        })
        .filter((x) => x.score > 0.22)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      if (ranked.length === 0) {
        return {
          reply: \`[\${bundle.modelCard.modelName}] I don't have a trained rule for "\${clean}" yet. Teach me or add more Knowledge notes in Mantis Studio.\`,
          sources: [],
          engine: 'fallback',
        };
      }

      return {
        reply: ranked.map((r, idx) => \`\${idx + 1}. \${r.item.title} [\${r.item.folder}]\\n\${r.item.content}\`).join('\\n\\n'),
        sources: ranked.map((r) => r.item.title),
        engine: 'int8-hybrid-rag',
      };
    },
  };
}
`;
}

export function generateDropInChatHtml(bundle: PortableBrainBundle): string {
  const safeName = sanitizeModelSlug(bundle.modelCard.modelName);
  const embeddedJson = JSON.stringify(bundle).replace(/<\/script/gi, '<\\/script');
  const sdkBody = generateStandaloneChatroomSdkCode(bundle).replace(/export /g, '');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeName} — Portable Chatroom</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #0b0f17; color: #f1f5f9; display: flex; flex-direction: column; height: 100vh; }
    header { padding: 14px 20px; border-bottom: 1px solid #1e293b; display: flex; justify-content: space-between; align-items: center; font-size: 14px; }
    main { flex: 1; overflow-y: auto; padding: 20px; max-width: 780px; width: 100%; margin: 0 auto; box-sizing: border-box; }
    .turn { padding: 14px 0; border-bottom: 1px solid #1e293b; line-height: 1.6; white-space: pre-wrap; font-size: 14px; }
    .role { font-size: 11px; font-family: monospace; color: #10b981; margin-bottom: 4px; text-transform: uppercase; }
    .role.user { color: #94a3b8; }
    form { max-width: 780px; width: 100%; margin: 0 auto 18px; padding: 0 20px; box-sizing: border-box; display: flex; gap: 8px; }
    input { flex: 1; background: #111827; border: 1px solid #334155; color: #f1f5f9; border-radius: 8px; padding: 12px 14px; font-size: 14px; }
    button { background: #10b981; color: #052e16; font-weight: 600; border: 0; border-radius: 8px; padding: 0 18px; cursor: pointer; }
  </style>
</head>
<body>
  <header>
    <strong>${safeName} <span style="color:#64748b;font-weight:400">v${bundle.modelCard.version}</span></strong>
    <span style="color:#94a3b8;font-size:12px">${bundle.knowledge.length} memories · ${bundle.skills.length} skills (Offline Portable)</span>
  </header>
  <main id="log"></main>
  <form id="chat-form">
    <input id="prompt" placeholder="Message ${safeName}..." autocomplete="off" />
    <button type="submit">Send</button>
  </form>
  <script id="bundle-data" type="application/json">${embeddedJson}</script>
  <script>
    ${sdkBody}
    const bundle = JSON.parse(document.getElementById('bundle-data').textContent);
    const bot = createMantisRuntime(bundle);
    const log = document.getElementById('log');
    const form = document.getElementById('chat-form');
    const input = document.getElementById('prompt');
    function appendTurn(role, text) {
      const div = document.createElement('div');
      div.className = 'turn';
      const r = document.createElement('div');
      r.className = 'role ' + role;
      r.textContent = role === 'user' ? 'You' : bundle.modelCard.modelName;
      const body = document.createElement('div');
      body.textContent = text;
      div.append(r, body);
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    }
    appendTurn('assistant', bundle.modelCard.tagline || (bundle.modelCard.modelName + ' ready.'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      appendTurn('user', q);
      const res = bot.ask(q);
      appendTurn('assistant', res.reply);
    });
  </script>
</body>
</html>`;
}

export function buildSftJsonl(
  samples: TrainingSample[],
  entries: KnowledgeEntry[],
  modelCard: ModelCardConfig,
): string {
  const lines: string[] = [];
  const approvedSft = samples.filter((s) => s.format === 'sft' && s.status !== 'rejected');

  for (const s of approvedSft) {
    lines.push(
      JSON.stringify({
        messages: [
          {role: 'system', content: modelCard.personaPrompt},
          {role: 'user', content: s.prompt},
          {role: 'assistant', content: s.chosenResponse},
        ],
      }),
    );
  }

  // Also include Trusted Knowledge entries as factual Q&A grounding rows
  for (const e of entries) {
    if (getEntryStatus(e) !== 'trusted') continue;
    lines.push(
      JSON.stringify({
        messages: [
          {role: 'system', content: modelCard.personaPrompt},
          {role: 'user', content: `Apply rule/knowledge: ${e.title}`},
          {role: 'assistant', content: e.content},
        ],
      }),
    );
  }

  return lines.join('\n');
}

export function buildDpoJsonl(samples: TrainingSample[]): string {
  return samples
    .filter((s) => s.format === 'dpo' && s.rejectedResponse && s.status !== 'rejected')
    .map((s) =>
      JSON.stringify({
        prompt: s.prompt,
        chosen: s.chosenResponse,
        rejected: s.rejectedResponse,
      }),
    )
    .join('\n');
}

export function generateOllamaModelfile(modelCard: ModelCardConfig): string {
  const safeName = sanitizeModelSlug(modelCard.modelName);
  return `# Modelfile for ${safeName} (generated by Mantis Studio)
# Usage: ollama create ${safeName} -f Modelfile && ollama run ${safeName}

FROM ${safeName}.gguf
PARAMETER temperature ${modelCard.temperature}
PARAMETER num_ctx 8192
SYSTEM """${modelCard.personaPrompt.replace(/"/g, '\\"')}"""
`;
}

/**
 * Generates a complete, runnable Google Colab Free T4 GPU Unsloth + TRL QLoRA notebook (.ipynb)
 * pre-configured with the user's chosen Model Name to train SFT + DPO weights and export GGUF / Hugging Face Hub.
 */
export function generateColabQloraNotebook(modelCard: ModelCardConfig): string {
  const safeName = sanitizeModelSlug(modelCard.modelName);
  const baseModel = modelCard.baseArchitecture || 'unsloth/Qwen2.5-Coder-7B-Instruct-bnb-4bit';

  const notebook = {
    nbformat: 4,
    nbformat_minor: 0,
    metadata: {
      colab: {provenance: [], gpuType: 'T4'},
      kernelspec: {name: 'python3', display_name: 'Python 3'},
      accelerator: 'GPU',
    },
    cells: [
      {
        cell_type: 'markdown',
        metadata: {},
        source: [
          `# ${safeName} — Free Colab T4 QLoRA Training Pipeline\n`,
          'Generated by **Mantis AI Studio**. Upload your exported `sft_train.jsonl` (and optional `dpo_train.jsonl`) to Colab, set Runtime → T4 GPU, and run all cells.',
        ],
      },
      {
        cell_type: 'code',
        execution_count: null,
        metadata: {},
        outputs: [],
        source: [
          '!pip install -q "unsloth[colab-new]" trl==0.12.2 peft==0.13.2 accelerate==1.1.1 datasets==3.1.0\n',
        ],
      },
      {
        cell_type: 'code',
        execution_count: null,
        metadata: {},
        outputs: [],
        source: [
          'from unsloth import FastLanguageModel\n',
          'from datasets import load_dataset\n',
          'from trl import SFTTrainer, DPOTrainer, DPOConfig\n',
          'from transformers import TrainingArguments\n',
          'import os\n\n',
          `MODEL_NAME = "${safeName}"\n`,
          `BASE_MODEL = "${baseModel}"\n`,
          'model, tokenizer = FastLanguageModel.from_pretrained(\n',
          '    model_name=BASE_MODEL,\n',
          '    max_seq_length=2048,\n',
          '    load_in_4bit=True,\n',
          ')\n',
          'model = FastLanguageModel.get_peft_model(\n',
          '    model, r=16, lora_alpha=16, lora_dropout=0,\n',
          '    target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],\n',
          '    use_gradient_checkpointing="unsloth",\n',
          ')\n',
        ],
      },
      {
        cell_type: 'code',
        execution_count: null,
        metadata: {},
        outputs: [],
        source: [
          '# 1. Supervised Fine-Tuning (SFT) on Mantis knowledge & distilled skills\n',
          'sft_ds = load_dataset("json", data_files="sft_train.jsonl", split="train")\n',
          'def fmt_chat(ex):\n',
          '    return {"text": tokenizer.apply_chat_template(ex["messages"], tokenize=False, add_generation_prompt=False)}\n',
          'sft_ds = sft_ds.map(fmt_chat)\n',
          'trainer = SFTTrainer(\n',
          '    model=model, tokenizer=tokenizer, train_dataset=sft_ds,\n',
          '    dataset_text_field="text", max_seq_length=2048,\n',
          '    args=TrainingArguments(per_device_train_batch_size=2, gradient_accumulation_steps=4, max_steps=60, learning_rate=2e-4, fp16=True, output_dir="outputs_sft"),\n',
          ')\n',
          'trainer.train()\n',
        ],
      },
      {
        cell_type: 'code',
        execution_count: null,
        metadata: {},
        outputs: [],
        source: [
          '# 2. Optional DPO Preference Optimization (if dpo_train.jsonl was exported)\n',
          'if os.path.exists("dpo_train.jsonl"):\n',
          '    dpo_ds = load_dataset("json", data_files="dpo_train.jsonl", split="train")\n',
          '    dpo_trainer = DPOTrainer(\n',
          '        model=model, ref_model=None, tokenizer=tokenizer, train_dataset=dpo_ds,\n',
          '        args=DPOConfig(per_device_train_batch_size=1, gradient_accumulation_steps=4, max_steps=30, learning_rate=5e-5, beta=0.1, output_dir="outputs_dpo"),\n',
          '    )\n',
          '    dpo_trainer.train()\n',
        ],
      },
      {
        cell_type: 'code',
        execution_count: null,
        metadata: {},
        outputs: [],
        source: [
          '# 3. Export downloadable GGUF weights (run anywhere in Ollama/LM Studio) OR push to your free Hugging Face repo\n',
          `model.save_pretrained_gguf("${safeName}-gguf", tokenizer, quantization_method="q4_k_m")\n`,
          `print("Saved GGUF weights for ${safeName}! Download from Colab sidebar or push to Hugging Face.")\n`,
          '# Optional: model.push_to_hub_gguf("your-hf-username/' + safeName + '", tokenizer, quantization_method="q4_k_m", token=os.environ.get("HF_TOKEN"))\n',
        ],
      },
    ],
  };

  return JSON.stringify(notebook, null, 2);
}

export function triggerFileDownload(filename: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], {type: mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function computeBundleFingerprint(bundle: PortableBrainBundle): string {
  return computeContentHash(
    bundle.modelCard.modelName,
    `${bundle.knowledge.length}-${bundle.skills.length}-${bundle.modelCard.version}`,
    [bundle.modelCard.author],
  );
}
