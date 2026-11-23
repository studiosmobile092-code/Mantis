import type {
  ConstitutionalPrinciple,
  EvalRunSummary,
  KnowledgeEntry,
  KnowledgeFolder,
  ModelCardConfig,
  ModelReleaseEntry,
  NeuralCheckpoint,
  PortableBrainBundle,
  ScratchSkillRule,
  TrainingSample,
} from '../types/mantis';
import {getEntryStatus} from './knowledgeSync';
import {loadScratchSkills} from './scratchEngine';
import {scrubTrainingText} from './trainingStore';
import {computeContentHash, encodeDenseVector384, quantizeInt8} from './vectorStore';

const MODEL_CARD_KEY = 'mantis_model_card_v1';
const RELEASE_LEDGER_KEY = 'mantis_release_ledger_v1';

export const COLAB_BASE_MODEL_PRESETS: Array<{
  id: string;
  label: string;
  ramProfile: string;
}> = [
  {
    id: 'HuggingFaceTB/SmolLM2-360M-Instruct',
    label: 'SmolLM2-360M Instruct (Ultra-Light 8 GB Tablet / Chromebook GGUF)',
    ramProfile: '~540 MB Q4',
  },
  {
    id: 'unsloth/Qwen2.5-0.5B-Instruct',
    label: 'Qwen2.5-0.5B Instruct (Fast 8 GB Safe Code & Logic)',
    ramProfile: '~820 MB Q4',
  },
  {
    id: 'unsloth/Qwen2.5-1.5B-Instruct',
    label: 'Qwen2.5-1.5B Instruct (Strong Balanced 8-12 GB Laptop)',
    ramProfile: '~1.6 GB Q4',
  },
  {
    id: 'unsloth/Qwen2.5-Coder-7B-Instruct-bnb-4bit',
    label: 'Qwen2.5-Coder-7B Instruct (Workstation / Colab T4 Flagship)',
    ramProfile: '~4.8 GB Q4_K_M',
  },
];

const DEFAULT_MODEL_CARD: ModelCardConfig = {
  modelName: 'Mantis-Coder-v1',
  version: '1.0.0',
  author: 'Mantis Studio Builder',
  baseArchitecture: 'unsloth/Qwen2.5-0.5B-Instruct',
  personaPrompt:
    'You are Mantis, a precise engineering assistant that recalls verified knowledge first, writes clean TypeScript, refuses untrained hallucinations honestly, and protects secrets.',
  tagline: 'Execute work efficiently with verified memory, neural checkpoint weights, and grounded reasoning.',
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

function escapeHtml(raw: string): string {
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

export function computeBundleFingerprint(bundle: PortableBrainBundle): string {
  const stepCount = bundle.checkpoint?.stepCount ?? 0;
  const vocabSize = bundle.checkpoint?.vocabSize ?? 0;
  const targetSig = (bundle.neuralCore?.targets || [])
    .slice(0, 6)
    .map((t) => t.promptPattern.slice(0, 18))
    .join('|');
  const ruleSig = (bundle.constitutionalRules || []).map((r) => r.id).join(',');
  return computeContentHash(
    `${bundle.modelCard.modelName}:${bundle.modelCard.version}:${bundle.checkpoint?.id || 'ckpt'}`,
    `${bundle.knowledge.length}-${bundle.skills.length}-${stepCount}-${vocabSize}-${targetSig}`,
    [bundle.modelCard.author, ruleSig],
  );
}

export function buildPortableBrainBundle(params: {
  modelCard: ModelCardConfig;
  entries: KnowledgeEntry[];
  folders: KnowledgeFolder[];
  skills?: ScratchSkillRule[];
  latestEval?: EvalRunSummary | null;
  activeCheckpoint?: NeuralCheckpoint | null;
  principles?: ConstitutionalPrinciple[];
}): PortableBrainBundle {
  const folderMap = new Map(params.folders.map((f) => [f.id, f.name]));
  const rawSkills = params.skills ?? loadScratchSkills();
  const skills: ScratchSkillRule[] = rawSkills.map((skill) => ({
    ...skill,
    triggers: skill.triggers.map((t) => scrubTrainingText(t)),
    responses: skill.responses.map((r) => scrubTrainingText(r)),
  }));

  const safeCard: ModelCardConfig = {
    ...params.modelCard,
    modelName: sanitizeModelSlug(params.modelCard.modelName),
    personaPrompt: scrubTrainingText(params.modelCard.personaPrompt),
    tagline: scrubTrainingText(params.modelCard.tagline),
    author: scrubTrainingText(params.modelCard.author),
  };

  const filteredEntries = params.entries.filter((e) => {
    const st = getEntryStatus(e);
    return safeCard.includeOnlyTrusted ? st === 'trusted' : st !== 'raw';
  });

  const knowledge = filteredEntries.map((entry) => {
    const safeTitle = scrubTrainingText(entry.title);
    const safeContent = scrubTrainingText(entry.content);
    const vec = encodeDenseVector384(
      `${safeTitle} ${entry.tags.join(' ')} ${safeContent.slice(0, 1200)}`,
    );
    const q = quantizeInt8(vec);
    return {
      id: entry.id,
      title: safeTitle,
      content: safeContent,
      folder: (entry.folder_id && folderMap.get(entry.folder_id)) || 'General',
      tags: entry.tags,
      status: getEntryStatus(entry),
      confidence: entry.confidence_score || 1,
      vectorInt8: q.int8,
      vectorScale: q.scale,
    };
  });

  const ckpt = params.activeCheckpoint || null;
  const checkpoint = ckpt
    ? {
        id: ckpt.id,
        profileName: scrubTrainingText(ckpt.profileName || safeCard.modelName),
        stepCount: ckpt.metrics.stepCount,
        vocabSize: ckpt.metrics.vocabSize,
        lastLoss: ckpt.metrics.lastLoss,
        firstLoss: ckpt.metrics.firstLoss,
        avgGradNorm: ckpt.metrics.avgGradNorm,
        memoryBytes: ckpt.metrics.memoryBytes,
        createdAt: ckpt.createdAt,
      }
    : undefined;

  const neuralCore = ckpt
    ? {
        bpeMerges: (ckpt.tokenizer.merges || []).slice(0, 160),
        vocabSample: (ckpt.tokenizer.vocab || []).slice(0, 256),
        targets: (ckpt.targets || []).slice(0, 80).map((t) => {
          const safePrompt = scrubTrainingText(t.promptPattern);
          const safeResponse = scrubTrainingText(t.responseText);
          const q = quantizeInt8(encodeDenseVector384(`${safePrompt} ${t.folderName}`));
          return {
            id: t.id,
            promptPattern: safePrompt,
            responseText: safeResponse,
            folderName: scrubTrainingText(t.folderName || 'General'),
            trainedSteps: t.trainedSteps,
            vectorInt8: q.int8,
            vectorScale: q.scale,
          };
        }),
      }
    : undefined;

  const constitutionalRules = (params.principles || [])
    .filter((p) => p.enabled)
    .map((p) => ({
      id: p.id,
      title: scrubTrainingText(p.title),
      category: p.category,
      rule: scrubTrainingText(p.rule),
      weight: p.weight,
    }));

  const evalSummary = {
    passRate: params.latestEval?.passRate ?? null,
    totalCases: params.latestEval?.totalCases ?? 0,
  };

  const evalScorecard = {
    passRate: params.latestEval?.passRate ?? null,
    blindPassRate: params.latestEval?.blindPassRate ?? params.latestEval?.passRate ?? null,
    regressionPassRate: params.latestEval?.regressionPassRate ?? null,
    totalCases: params.latestEval?.totalCases ?? 0,
    checkpointId: ckpt?.id || params.latestEval?.checkpointId,
  };

  const bundle: PortableBrainBundle = {
    schema: 'mantis-brain-bundle/v2',
    exportedAt: new Date().toISOString(),
    modelCard: safeCard,
    evalSummary,
    evalScorecard,
    checkpoint,
    neuralCore,
    constitutionalRules,
    skills,
    knowledge,
  };

  bundle.fingerprint = computeBundleFingerprint(bundle);
  return bundle;
}

export function loadReleaseLedger(): ModelReleaseEntry[] {
  try {
    const raw = window.localStorage.getItem(RELEASE_LEDGER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ModelReleaseEntry[]) : [];
  } catch {
    return [];
  }
}

export function recordModelRelease(
  bundle: PortableBrainBundle,
  changelog: string,
): ModelReleaseEntry[] {
  const entry: ModelReleaseEntry = {
    id: `rel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    modelName: bundle.modelCard.modelName,
    version: bundle.modelCard.version,
    checkpointId: bundle.checkpoint?.id || 'ckpt-base',
    blindPassRate: bundle.evalScorecard?.blindPassRate ?? bundle.evalSummary.passRate ?? null,
    stepCount: bundle.checkpoint?.stepCount ?? 0,
    vocabSize: bundle.checkpoint?.vocabSize ?? 0,
    knowledgeCount: bundle.knowledge.length,
    skillsCount: bundle.skills.length,
    fingerprint: bundle.fingerprint || computeBundleFingerprint(bundle),
    changelog: scrubTrainingText(changelog.trim() || 'Snapshot release build'),
    exportedAt: new Date().toISOString(),
  };

  const next = [entry, ...loadReleaseLedger()].slice(0, 40);
  try {
    window.localStorage.setItem(RELEASE_LEDGER_KEY, JSON.stringify(next));
  } catch {
    // ignore quota issues
  }
  return next;
}

export function deleteReleaseEntry(releaseId: string): ModelReleaseEntry[] {
  const next = loadReleaseLedger().filter((r) => r.id !== releaseId);
  try {
    window.localStorage.setItem(RELEASE_LEDGER_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

function tryEvalPortableMath(input: string): {expr: string; formatted: string} | null {
  const cleaned = input
    .trim()
    .replace(/^(what is|what's|calculate|compute|solve|eval|evaluate)\s+/i, '')
    .replace(/[?=]+$/g, '')
    .replace(/(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?|\([^)]+\))/gi, '($1 / 100) * $2')
    .replace(/\bplus\b/gi, '+')
    .replace(/\bminus\b/gi, '-')
    .replace(/\btimes\b|\bmultiplied by\b/gi, '*')
    .replace(/\bdivided by\b/gi, '/')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .trim();
  const stripped = cleaned.replace(/\b(?:sqrt|abs|round)\(/gi, '(');
  if (!cleaned || !/^[0-9+\-*/%^().\s]+$/.test(stripped)) return null;
  if (!/\d/.test(cleaned) || !/[+\-*/%^]|(?:sqrt|abs|round)\(/i.test(cleaned)) return null;

  let pos = 0;
  const src = cleaned.replace(/\s+/g, '');
  const peek = () => src[pos] || '';
  const consume = (ch?: string) => {
    const c = src[pos] || '';
    if (ch && c !== ch) throw new Error('bad');
    pos += 1;
    return c;
  };
  const parseExpr = (): number => {
    let left = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };
  const parseTerm = (): number => {
    let left = parsePower();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = consume();
      const right = parsePower();
      if (op === '*') left *= right;
      else if (op === '/') {
        if (right === 0) throw new Error('div0');
        left /= right;
      } else {
        if (right === 0) throw new Error('div0');
        left %= right;
      }
    }
    return left;
  };
  const parsePower = (): number => {
    const base = parseUnary();
    if (peek() === '^') {
      consume('^');
      return Math.pow(base, parsePower());
    }
    return base;
  };
  const parseUnary = (): number => {
    if (peek() === '+') {
      consume();
      return parseUnary();
    }
    if (peek() === '-') {
      consume();
      return -parseUnary();
    }
    return parsePrimary();
  };
  const parsePrimary = (): number => {
    const rest = src.slice(pos).toLowerCase();
    for (const fn of ['sqrt', 'abs', 'round']) {
      if (rest.startsWith(`${fn}(`)) {
        pos += fn.length;
        consume('(');
        const val = parseExpr();
        consume(')');
        if (fn === 'sqrt') return Math.sqrt(val);
        if (fn === 'abs') return Math.abs(val);
        return Math.round(val);
      }
    }
    if (peek() === '(') {
      consume('(');
      const val = parseExpr();
      consume(')');
      return val;
    }
    const start = pos;
    let dots = 0;
    while (/[\d.]/.test(peek())) {
      if (peek() === '.') dots += 1;
      if (dots > 1) throw new Error('badnum');
      pos += 1;
    }
    if (start === pos) throw new Error('nan');
    const n = Number(src.slice(start, pos));
    if (!Number.isFinite(n)) throw new Error('inf');
    return n;
  };

  try {
    const val = parseExpr();
    if (pos !== src.length || !Number.isFinite(val)) return null;
    const formatted = Number.isInteger(val) ? String(val) : String(Number(val.toFixed(6)));
    return {expr: cleaned, formatted};
  } catch {
    return null;
  }
}

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesTriggerSafely(lowerPrompt: string, triggerRaw: string): boolean {
  const trig = triggerRaw.trim().toLowerCase();
  if (!trig) return false;
  if (lowerPrompt === trig) return true;
  if (trig.length <= 4) {
    return new RegExp(`(?:^|\\b)${escapeRegExp(trig)}(?:\\b|$)`, 'i').test(lowerPrompt);
  }
  return lowerPrompt.includes(trig);
}

/**
 * Pure TypeScript equivalent of the exported chatroom runtime (`createMantisRuntime`),
 * allowing in-app verification of exact exported behavior without eval/Function.
 */
export function executePortableRuntimeQuery(
  bundle: PortableBrainBundle,
  prompt: string,
): {reply: string; sources: string[]; engine: string; confidence?: number} {
  const clean = String(prompt || '').trim();
  const lower = clean.toLowerCase().replace(/[!?.,]+$/g, '').trim();

  // 1. Exact zero-eval arithmetic reasoning
  const mathRes = tryEvalPortableMath(clean);
  if (mathRes) {
    return {
      reply: `${mathRes.expr} = ${mathRes.formatted}`,
      sources: ['Arithmetic Engine'],
      engine: 'math-parser',
      confidence: 1,
    };
  }

  // 2. Teacher-distilled conversational & domain skills with word-boundary guard
  for (const skill of bundle.skills || []) {
    if (skill.triggers.some((t) => matchesTriggerSafely(lower, t))) {
      const picked = skill.responses[0] || '';
      if (picked) {
        return {
          reply: picked,
          sources: [skill.folderName],
          engine: 'distilled-skill',
          confidence: 0.92,
        };
      }
    }
  }

  // 3. Embedded Trained Neural Checkpoint Targets (BPE/Int8 Prototype Similarity)
  const qVec = encodeDenseVector384(clean);
  const neuralTargets = bundle.neuralCore?.targets || [];
  if (neuralTargets.length > 0 && (bundle.checkpoint?.stepCount ?? 1) > 0) {
    let bestTarget: (typeof neuralTargets)[number] | null = null;
    let bestScore = 0;

    for (const target of neuralTargets) {
      let dot = 0;
      const len = Math.min(384, target.vectorInt8.length);
      for (let i = 0; i < len; i += 1) dot += qVec[i] * target.vectorInt8[i];
      const vecSim = dot * target.vectorScale;
      const patLower = target.promptPattern.toLowerCase();
      const exactBoost =
        lower === patLower
          ? 0.65
          : lower.length >= 4 && (patLower.includes(lower) || lower.includes(patLower))
            ? 0.35
            : 0;
      const score = vecSim + exactBoost;
      if (score > bestScore) {
        bestScore = score;
        bestTarget = target;
      }
    }

    if (bestTarget && bestScore >= 0.42) {
      return {
        reply: bestTarget.responseText,
        sources: [`${bundle.checkpoint?.id || 'neural-core'} (${bestTarget.folderName})`],
        engine: 'neural-core',
        confidence: Math.min(0.99, bestScore),
      };
    }
  }

  // 4. Hybrid subword + bigram cosine retrieval over Int8 quantized memory
  const ranked = (bundle.knowledge || [])
    .map((k) => {
      let dot = 0;
      const len = Math.min(384, k.vectorInt8.length);
      for (let i = 0; i < len; i += 1) dot += qVec[i] * k.vectorInt8[i];
      const vecSim = dot * k.vectorScale;
      const exactBoost =
        lower.length >= 3 && k.title.toLowerCase().includes(lower) ? 0.45 : 0;
      const trustBoost = k.status === 'trusted' ? 1.35 : 1.0;
      return {item: k, score: (vecSim + exactBoost) * trustBoost};
    })
    .filter((x) => x.score > 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (ranked.length > 0) {
    return {
      reply: ranked
        .map((r, idx) => `${idx + 1}. ${r.item.title} [${r.item.folder}]\n${r.item.content}`)
        .join('\n\n'),
      sources: ranked.map((r) => r.item.title),
      engine: 'int8-hybrid-rag',
      confidence: Math.min(0.95, ranked[0].score),
    };
  }

  // 5. Baseline starter greeting
  if (/^(hi|hello|hey|yo|greetings|good morning|good afternoon|good evening)$/i.test(lower)) {
    const stepText = bundle.checkpoint
      ? ` · ${bundle.checkpoint.stepCount} neural steps`
      : '';
    return {
      reply: `Hello! I'm ${bundle.modelCard.modelName} (v${bundle.modelCard.version}${stepText}). Loaded ${bundle.knowledge.length} memories and ${bundle.skills.length} skills offline. Ask me anything or try math like 1+1.`,
      sources: ['Starter Persona'],
      engine: 'starter-greeting',
      confidence: 0.9,
    };
  }

  // 6. Honest OOD / Constitutional Boundary
  const isZeroTrained = bundle.checkpoint && bundle.checkpoint.stepCount === 0;
  return {
    reply: isZeroTrained
      ? `[${bundle.modelCard.modelName} · Untrained Checkpoint] I have 0 neural training steps and no verified memory matching "${clean}". Teach me in Mantis Studio first — I will not guess or invent facts.`
      : `[${bundle.modelCard.modelName}] I don't have a verified rule or neural pattern for "${clean}" yet. Add Knowledge notes or step-train this topic in Mantis Studio.`,
    sources: bundle.constitutionalRules?.length ? ['Constitutional Honesty'] : [],
    engine: isZeroTrained ? 'untrained-boundary' : 'fallback',
    confidence: 0,
  };
}

function validateJsonlLines(jsonl: string): {valid: boolean; count: number} {
  if (!jsonl.trim()) return {valid: true, count: 0};
  const lines = jsonl.split('\n').filter((l) => l.trim().length > 0);
  try {
    for (const line of lines) {
      JSON.parse(line);
    }
    return {valid: true, count: lines.length};
  } catch {
    return {valid: false, count: lines.length};
  }
}

/**
 * In-app Round-Trip Smoke Test: verifies v2 schema integrity, neural checkpoint targets,
 * Int8 vectors, math & word-boundary runtime execution, unseen OOD negation boundary,
 * JSONL validity, Colab notebook validity, XSS escaping, and zero secret leakage.
 */
export function runExportedBundleSmokeTest(
  bundle: PortableBrainBundle,
  datasets?: {sftJsonl?: string; dpoJsonl?: string},
): {
  passed: boolean;
  checks: Array<{label: string; passed: boolean; detail: string}>;
} {
  const checks: Array<{label: string; passed: boolean; detail: string}> = [];

  let colabValid = false;
  try {
    const nb = JSON.parse(generateColabQloraNotebook(bundle.modelCard)) as {
      nbformat?: number;
      cells?: Array<{source?: string[]}>;
    };
    const nbSourceText = (nb.cells || [])
      .map((cell) => (Array.isArray(cell.source) ? cell.source.join('') : ''))
      .join('\n');
    colabValid =
      nb.nbformat === 4 &&
      Array.isArray(nb.cells) &&
      nb.cells.length >= 5 &&
      nbSourceText.includes('os.path.getsize("dpo_train.jsonl") > 10');
  } catch {
    colabValid = false;
  }

  checks.push({
    label: 'Schema v2, Checkpoint & Colab Notebook Valid',
    passed:
      (bundle.schema === 'mantis-brain-bundle/v2' || bundle.schema === 'mantis-brain-bundle/v1') &&
      /^[a-zA-Z0-9._-]+$/.test(bundle.modelCard.modelName) &&
      Boolean(bundle.fingerprint) &&
      colabValid,
    detail: `${bundle.modelCard.modelName} v${bundle.modelCard.version} · ${bundle.checkpoint?.stepCount ?? 0} neural steps · hash ${bundle.fingerprint || 'n/a'}`,
  });

  const neuralTargetsValid = (bundle.neuralCore?.targets || []).every(
    (t) => Array.isArray(t.vectorInt8) && t.vectorInt8.length === 384 && Number.isFinite(t.vectorScale),
  );
  checks.push({
    label: 'Int8 Quantized Vectors & Neural Core Integrity',
    passed:
      bundle.knowledge.every(
        (k) =>
          Array.isArray(k.vectorInt8) &&
          k.vectorInt8.length === 384 &&
          Number.isFinite(k.vectorScale),
      ) && neuralTargetsValid,
    detail: `${bundle.knowledge.length} memories + ${bundle.neuralCore?.targets.length ?? 0} neural targets quantized (384-d Int8)`,
  });

  // Execute portable runtime math + boundary tests
  const mathCheck = executePortableRuntimeQuery(bundle, '1+1');
  const pctCheck = executePortableRuntimeQuery(bundle, '15% of 200');
  const greetingCheck = executePortableRuntimeQuery(bundle, 'hi');
  const falseBoundaryCheck = executePortableRuntimeQuery(
    bundle,
    'this machine test ignores substring',
  );
  const mathPassed =
    mathCheck.engine === 'math-parser' &&
    mathCheck.reply.includes('2') &&
    pctCheck.engine === 'math-parser' &&
    pctCheck.reply.includes('30');
  const boundaryPassed =
    greetingCheck.reply.length > 0 &&
    falseBoundaryCheck.engine !== 'starter-greeting' &&
    (!bundle.skills.some((s) => s.triggers.some((t) => t.toLowerCase() === 'hi')) ||
      falseBoundaryCheck.engine !== 'distilled-skill');

  checks.push({
    label: 'Arithmetic Parity (1+1, 15% of 200) & Word Boundary',
    passed: mathPassed && boundaryPassed,
    detail: mathPassed
      ? `"1+1" -> "${mathCheck.reply}"; "15% of 200" -> "${pctCheck.reply}"`
      : `Math failed ("${mathCheck.reply}")`,
  });

  // Simulated isolated retrieval query on top learned neural target, skill, or note
  const sampleQuery =
    bundle.neuralCore?.targets[0]?.promptPattern ||
    bundle.skills[0]?.triggers[0] ||
    bundle.knowledge[0]?.title ||
    'hello';
  const roundTrip = executePortableRuntimeQuery(bundle, sampleQuery);
  const hasAnyLearnedContent =
    bundle.knowledge.length > 0 ||
    bundle.skills.length > 0 ||
    ((bundle.neuralCore?.targets.length ?? 0) > 0 && (bundle.checkpoint?.stepCount ?? 0) > 0);

  checks.push({
    label: 'Custom Learned Prompt & Neural Recall Round-Trip',
    passed:
      !hasAnyLearnedContent ||
      roundTrip.engine === 'neural-core' ||
      roundTrip.engine === 'distilled-skill' ||
      roundTrip.engine === 'int8-hybrid-rag',
    detail: !hasAnyLearnedContent
      ? 'Starter brain ready (greetings, math & honest boundary active)'
      : `Query "${sampleQuery.slice(0, 28)}" -> ${roundTrip.engine} (${Math.round((roundTrip.confidence || 0) * 100)}%)`,
  });

  // Unseen OOD negative probe (ensures zero hallucination on unknown gibberish)
  const oodProbe = executePortableRuntimeQuery(bundle, 'zqxw_unseen_boundary_probe_999');
  const oodSafe = oodProbe.engine === 'fallback' || oodProbe.engine === 'untrained-boundary';
  checks.push({
    label: 'Unseen OOD Negation Boundary (Zero Hallucination)',
    passed: oodSafe,
    detail: oodSafe
      ? `Safely declined unknown probe via ${oodProbe.engine}`
      : `Unexpectedly matched via ${oodProbe.engine}`,
  });

  const sftValidation = validateJsonlLines(datasets?.sftJsonl || '');
  const dpoValidation = validateJsonlLines(datasets?.dpoJsonl || '');
  const jsonlPassed = sftValidation.valid && dpoValidation.valid;

  checks.push({
    label: 'SFT & DPO Dataset JSONL Validity',
    passed: jsonlPassed,
    detail: jsonlPassed
      ? `${sftValidation.count} SFT rows · ${dpoValidation.count} DPO pairs valid JSONL`
      : 'Malformed JSONL line detected',
  });

  const htmlPreview = generateDropInChatHtml(bundle);
  const hasRawSecrets =
    /(sb_secret_[A-Za-z0-9_-]{6,}|hf_[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{10,}|Bearer\s+[A-Za-z0-9._-]{16,})/i.test(
      `${JSON.stringify(bundle)}\n${datasets?.sftJsonl || ''}\n${datasets?.dpoJsonl || ''}`,
    );
  const safeHtmlExport =
    !htmlPreview.includes('.innerHTML') &&
    !/<\/script/i.test(
      htmlPreview.slice(htmlPreview.indexOf('<script id="bundle-data"'), htmlPreview.indexOf('</script><script>')),
    );

  checks.push({
    label: 'Zero Secrets & Safe XSS-Escaped HTML Export',
    passed: !hasRawSecrets && safeHtmlExport,
    detail:
      !hasRawSecrets && safeHtmlExport
        ? 'All bundles redacted & HTML uses safe DOM text nodes'
        : 'Security or script-escape issue detected',
  });

  return {
    passed: checks.every((c) => c.passed),
    checks,
  };
}

export function generateStandaloneChatroomSdkCode(bundle: PortableBrainBundle): string {
  const safeName = sanitizeModelSlug(bundle.modelCard.modelName);
  return `// ${safeName} v${bundle.modelCard.version} — Portable Mantis Neural + Memory Runtime SDK (v2)
// Drop this module + your ${safeName}.mantisbrain.json into ANY web, React, or Node chatroom app!
// Runs 100% offline with zero API keys, zero eval(), and optional local Ollama/GGUF upgrade slot.

export function createMantisRuntime(bundle, options = {}) {
  const DIMS = 384;
  const endpointUrl = options && options.endpointUrl ? String(options.endpointUrl).replace(/\\/+$/, '') : '';
  const endpointModel = options && options.model ? String(options.model) : bundle.modelCard.modelName;

  function hashToken(str, seed = 2166136261) {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Exact bit-for-bit parity with Mantis encodeDenseVector384 (unigrams + char trigrams + token bigrams)
  function encode(text) {
    const vec = new Float32Array(DIMS);
    const clean = String(text || '').toLowerCase().replace(/[^a-z0-9_.\\-/+#\\s]/g, ' ').trim();
    if (!clean) return vec;
    const tokens = clean.split(/\\s+/).filter((t) => t.length >= 2);
    for (let tIdx = 0; tIdx < tokens.length; tIdx++) {
      const tok = tokens[tIdx];
      const h1 = hashToken(tok, 2166136261);
      const h2 = hashToken(tok, 1315423911);
      vec[h1 % DIMS] += 2.2;
      vec[h2 % DIMS] += (h2 & 1) === 0 ? 1.4 : -1.4;
      if (tok.length >= 4) {
        const padded = '_' + tok + '_';
        for (let i = 0; i <= padded.length - 3; i++) {
          const th = hashToken(padded.slice(i, i + 3), 2654435761);
          vec[th % DIMS] += (th & 1) === 0 ? 0.65 : -0.65;
        }
      }
      if (tIdx + 1 < tokens.length) {
        const bh = hashToken(tok + ' ' + tokens[tIdx + 1], 3141592653);
        vec[bh % DIMS] += 1.6;
      }
    }
    let norm = 0;
    for (let i = 0; i < DIMS; i++) norm += vec[i] * vec[i];
    const inv = norm > 1e-8 ? 1 / Math.sqrt(norm) : 0;
    if (inv > 0) for (let i = 0; i < DIMS; i++) vec[i] *= inv;
    return vec;
  }

  function tryEvalMath(input) {
    const cleaned = String(input || '')
      .trim()
      .replace(/^(what is|what's|calculate|compute|solve|eval|evaluate)\\s+/i, '')
      .replace(/[?=]+$/g, '')
      .replace(/(\\d+(?:\\.\\d+)?)\\s*%\\s*of\\s*(\\d+(?:\\.\\d+)?|\\([^)]+\\))/gi, '($1 / 100) * $2')
      .replace(/\\bplus\\b/gi, '+')
      .replace(/\\bminus\\b/gi, '-')
      .replace(/\\btimes\\b|\\bmultiplied by\\b/gi, '*')
      .replace(/\\bdivided by\\b/gi, '/')
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .trim();
    const stripped = cleaned.replace(/\\b(?:sqrt|abs|round)\\(/gi, '(');
    if (!cleaned || !/^[0-9+\\-*/%^().\\s]+$/.test(stripped)) return null;
    if (!/\\d/.test(cleaned) || !/[+\\-*/%^]|(?:sqrt|abs|round)\\(/i.test(cleaned)) return null;
    let pos = 0;
    const src = cleaned.replace(/\\s+/g, '');
    const peek = () => src[pos] || '';
    const consume = (ch) => {
      const c = src[pos] || '';
      if (ch && c !== ch) throw new Error('bad');
      pos += 1;
      return c;
    };
    const parseExpr = () => {
      let left = parseTerm();
      while (peek() === '+' || peek() === '-') {
        const op = consume();
        const right = parseTerm();
        left = op === '+' ? left + right : left - right;
      }
      return left;
    };
    const parseTerm = () => {
      let left = parsePower();
      while (peek() === '*' || peek() === '/' || peek() === '%') {
        const op = consume();
        const right = parsePower();
        if (op === '*') left *= right;
        else if (op === '/') { if (right === 0) throw new Error('div0'); left /= right; }
        else { if (right === 0) throw new Error('div0'); left %= right; }
      }
      return left;
    };
    const parsePower = () => {
      const base = parseUnary();
      if (peek() === '^') { consume('^'); return Math.pow(base, parsePower()); }
      return base;
    };
    const parseUnary = () => {
      if (peek() === '+') { consume(); return parseUnary(); }
      if (peek() === '-') { consume(); return -parseUnary(); }
      return parsePrimary();
    };
    const parsePrimary = () => {
      const rest = src.slice(pos).toLowerCase();
      for (const fn of ['sqrt', 'abs', 'round']) {
        if (rest.startsWith(fn + '(')) {
          pos += fn.length;
          consume('(');
          const v = parseExpr();
          consume(')');
          return fn === 'sqrt' ? Math.sqrt(v) : fn === 'abs' ? Math.abs(v) : Math.round(v);
        }
      }
      if (peek() === '(') { consume('('); const v = parseExpr(); consume(')'); return v; }
      const start = pos;
      let dots = 0;
      while (/[\\d.]/.test(peek())) {
        if (peek() === '.') dots += 1;
        if (dots > 1) throw new Error('badnum');
        pos += 1;
      }
      if (start === pos) throw new Error('nan');
      const n = Number(src.slice(start, pos));
      if (!Number.isFinite(n)) throw new Error('inf');
      return n;
    };
    try {
      const val = parseExpr();
      if (pos !== src.length || !Number.isFinite(val)) return null;
      const formatted = Number.isInteger(val) ? String(val) : String(Number(val.toFixed(6)));
      return { expr: cleaned, formatted };
    } catch {
      return null;
    }
  }

  function matchesTrigger(lowerPrompt, rawTrig) {
    const trig = String(rawTrig || '').trim().toLowerCase();
    if (!trig) return false;
    if (lowerPrompt === trig) return true;
    if (trig.length <= 4) {
      const esc = trig.replace(/[.*+?^$()|[\\]\\\\{}]/g, '\\\\$&');
      return new RegExp('(?:^|\\\\b)' + esc + '(?:\\\\b|$)', 'i').test(lowerPrompt);
    }
    return lowerPrompt.includes(trig);
  }

  function ask(prompt) {
    const clean = String(prompt || '').trim();
    const lower = clean.toLowerCase().replace(/[!?.,]+$/g, '').trim();

    const mathRes = tryEvalMath(clean);
    if (mathRes) {
      return { reply: mathRes.expr + ' = ' + mathRes.formatted, sources: ['Arithmetic Engine'], engine: 'math-parser', confidence: 1 };
    }

    // 1. Check Teacher-distilled conversational / domain skills
    for (const skill of bundle.skills || []) {
      if (skill.triggers.some((t) => matchesTrigger(lower, t))) {
        const picked = skill.responses[0] || '';
        if (picked) {
          return { reply: picked, sources: [skill.folderName], engine: 'distilled-skill', confidence: 0.92 };
        }
      }
    }

    // 2. Embedded Trained Neural Core targets (if checkpoint has trained steps)
    const qVec = encode(clean);
    const neuralTargets = (bundle.neuralCore && bundle.neuralCore.targets) || [];
    if (neuralTargets.length > 0 && (!bundle.checkpoint || bundle.checkpoint.stepCount > 0)) {
      let bestTarget = null;
      let bestScore = 0;
      for (const target of neuralTargets) {
        let dot = 0;
        const len = Math.min(DIMS, (target.vectorInt8 || []).length);
        for (let i = 0; i < len; i++) dot += qVec[i] * target.vectorInt8[i];
        const vecSim = dot * (target.vectorScale || 0);
        const patLower = String(target.promptPattern || '').toLowerCase();
        const exactBoost = lower === patLower ? 0.65 : (lower.length >= 4 && (patLower.includes(lower) || lower.includes(patLower)) ? 0.35 : 0);
        const score = vecSim + exactBoost;
        if (score > bestScore) { bestScore = score; bestTarget = target; }
      }
      if (bestTarget && bestScore >= 0.42) {
        return {
          reply: bestTarget.responseText,
          sources: [((bundle.checkpoint && bundle.checkpoint.id) || 'neural-core') + ' (' + bestTarget.folderName + ')'],
          engine: 'neural-core',
          confidence: Math.min(0.99, bestScore),
        };
      }
    }

    // 3. Hybrid vector + lexical retrieval over Int8 quantized memory
    const ranked = (bundle.knowledge || [])
      .map((k) => {
        let dot = 0;
        for (let i = 0; i < DIMS; i++) dot += qVec[i] * k.vectorInt8[i];
        const vecSim = dot * k.vectorScale;
        const exactBoost = lower.length >= 3 && k.title.toLowerCase().includes(lower) ? 0.45 : 0;
        const trustBoost = k.status === 'trusted' ? 1.35 : 1.0;
        return { item: k, score: (vecSim + exactBoost) * trustBoost };
      })
      .filter((x) => x.score > 0.25)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (ranked.length > 0) {
      return {
        reply: ranked.map((r, idx) => (idx + 1) + '. ' + r.item.title + ' [' + r.item.folder + ']\\n' + r.item.content).join('\\n\\n'),
        sources: ranked.map((r) => r.item.title),
        engine: 'int8-hybrid-rag',
        confidence: Math.min(0.95, ranked[0].score),
      };
    }

    if (/^(hi|hello|hey|yo|greetings|good morning|good afternoon|good evening)$/i.test(lower)) {
      const stepsNote = bundle.checkpoint ? ' · ' + bundle.checkpoint.stepCount + ' neural steps' : '';
      return {
        reply: 'Hello! I am ' + bundle.modelCard.modelName + ' (v' + bundle.modelCard.version + stepsNote + '). Ready with ' + (bundle.knowledge || []).length + ' memories & ' + (bundle.skills || []).length + ' skills offline.',
        sources: ['Starter Persona'],
        engine: 'starter-greeting',
        confidence: 0.9,
      };
    }

    const isZeroTrained = bundle.checkpoint && bundle.checkpoint.stepCount === 0;
    return {
      reply: isZeroTrained
        ? '[' + bundle.modelCard.modelName + ' · Untrained Checkpoint] 0 trained neural steps and no verified memory for "' + clean + '". Teach me in Mantis Studio first.'
        : '[' + bundle.modelCard.modelName + '] I do not have a trained rule for "' + clean + '" yet. Teach me or add more Knowledge notes in Mantis Studio.',
      sources: [],
      engine: isZeroTrained ? 'untrained-boundary' : 'fallback',
      confidence: 0,
    };
  }

  async function askWithOptionalEndpoint(prompt, customEndpointUrl) {
    const targetUrl = String(customEndpointUrl || endpointUrl || '').replace(/\\/+$/, '');
    const offline = ask(prompt);
    if (!targetUrl || offline.engine === 'math-parser' || offline.engine === 'neural-core' || offline.engine === 'distilled-skill') {
      return offline;
    }
    try {
      const res = await fetch(targetUrl + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: endpointModel,
          messages: [
            { role: 'system', content: bundle.modelCard.personaPrompt },
            { role: 'user', content: prompt },
          ],
          temperature: bundle.modelCard.temperature || 0.2,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const txt = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (txt) {
          return { reply: String(txt).trim(), sources: [targetUrl], engine: 'gguf-endpoint', confidence: 0.9 };
        }
      }
    } catch {
      // Fallback safely to offline bundle response
    }
    return offline;
  }

  return {
    name: bundle.modelCard.modelName,
    version: bundle.modelCard.version,
    fingerprint: bundle.fingerprint || '',
    ask,
    askWithOptionalEndpoint,
  };
}
`;
}

export function generateDropInChatHtml(bundle: PortableBrainBundle): string {
  const safeName = sanitizeModelSlug(bundle.modelCard.modelName);
  const safeEscName = escapeHtml(safeName);
  const safeEscVersion = escapeHtml(bundle.modelCard.version);
  const embeddedJson = JSON.stringify(bundle).replace(/<\/script/gi, '<\\/script');
  const sdkBody = generateStandaloneChatroomSdkCode(bundle)
    .replace(/export /g, '')
    .replace(/<\/script/gi, '<\\/script');
  const starterSample = escapeHtml(
    bundle.neuralCore?.targets[0]?.promptPattern ||
      bundle.skills[0]?.triggers[0] ||
      bundle.knowledge[0]?.title ||
      'hi',
  );
  const ckptText = bundle.checkpoint
    ? `${bundle.checkpoint.stepCount} neural steps`
    : 'offline runtime';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeEscName} — Portable Chatroom</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #090b0e; color: #f1f5f9; display: flex; flex-direction: column; height: 100vh; height: 100dvh; }
    header { padding: 12px 16px; border-bottom: 1px solid #1e293b; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; font-size: 13px; background: #0d1117; }
    .subbar { padding: 8px 16px; border-bottom: 1px solid #1e293b; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; background: #0b0f14; font-size: 11px; color: #94a3b8; }
    .subbar input { min-height: 34px; flex: 1; min-width: 180px; background: #090b0e; border: 1px solid #334155; border-radius: 6px; padding: 4px 10px; color: #e2e8f0; font-family: monospace; font-size: 11px; }
    main { flex: 1; overflow-y: auto; padding: 16px; max-width: 780px; width: 100%; margin: 0 auto; }
    .turn { padding: 14px 0; border-bottom: 1px solid #1e293b; line-height: 1.6; white-space: pre-wrap; font-size: 14px; word-break: break-word; }
    .role { font-size: 11px; font-family: monospace; color: #10b981; margin-bottom: 4px; text-transform: uppercase; }
    .role.user { color: #94a3b8; }
    .meta { margin-top: 6px; font-size: 11px; font-family: monospace; color: #64748b; }
    .chips { max-width: 780px; width: 100%; margin: 8px auto 0; padding: 0 16px; display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { min-height: 36px; background: #111827; border: 1px solid #1e293b; color: #cbd5e1; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
    form { max-width: 780px; width: 100%; margin: 8px auto 14px; padding: 0 16px; display: flex; gap: 8px; }
    #prompt { flex: 1; min-height: 44px; background: #111827; border: 1px solid #334155; color: #f1f5f9; border-radius: 8px; padding: 10px 14px; font-size: 14px; }
    button[type="submit"] { min-height: 44px; background: #10b981; color: #052e16; font-weight: 600; border: 0; border-radius: 8px; padding: 0 18px; cursor: pointer; }
  </style>
</head>
<body>
  <header>
    <strong>${safeEscName} <span style="color:#64748b;font-weight:400">v${safeEscVersion}</span></strong>
    <span style="color:#94a3b8;font-size:12px">${bundle.knowledge.length} memories · ${bundle.skills.length} skills · ${escapeHtml(ckptText)}</span>
  </header>
  <div class="subbar">
    <span>Optional Ollama / GGUF Endpoint:</span>
    <input id="endpoint-url" placeholder="http://localhost:11434 (leave blank for 100% offline bundle)" />
  </div>
  <main id="log"></main>
  <div class="chips">
    <button type="button" class="chip" data-q="hi">hi</button>
    <button type="button" class="chip" data-q="1+1">1+1</button>
    <button type="button" class="chip" data-q="${starterSample}">${starterSample}</button>
    <button type="button" class="chip" data-q="untrained_probe_99">Untrained Check</button>
  </div>
  <form id="chat-form">
    <input id="prompt" placeholder="Message ${safeEscName}..." autocomplete="off" />
    <button type="submit">Send</button>
  </form>
  <script id="bundle-data" type="application/json">${embeddedJson}</script><script>
    ${sdkBody}
    const bundle = JSON.parse(document.getElementById('bundle-data').textContent);
    const bot = createMantisRuntime(bundle);
    const log = document.getElementById('log');
    const form = document.getElementById('chat-form');
    const input = document.getElementById('prompt');
    const endpointInput = document.getElementById('endpoint-url');
    function appendTurn(role, text, metaText) {
      const div = document.createElement('div');
      div.className = 'turn';
      const r = document.createElement('div');
      r.className = 'role ' + role;
      r.textContent = role === 'user' ? 'You' : bundle.modelCard.modelName;
      const body = document.createElement('div');
      body.textContent = text;
      div.append(r, body);
      if (metaText) {
        const m = document.createElement('div');
        m.className = 'meta';
        m.textContent = metaText;
        div.appendChild(m);
      }
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    }
    async function sendPrompt(raw) {
      const q = String(raw || '').trim();
      if (!q) return;
      appendTurn('user', q);
      const customEndpoint = (endpointInput && endpointInput.value || '').trim();
      const res = customEndpoint ? await bot.askWithOptionalEndpoint(q, customEndpoint) : bot.ask(q);
      const meta = res.sources && res.sources.length ? res.engine + ' · ' + res.sources.join(', ') : res.engine;
      appendTurn('assistant', res.reply, meta);
    }
    appendTurn('assistant', bundle.modelCard.tagline || (bundle.modelCard.modelName + ' ready.'), 'isolated-portable-runtime · ' + (bundle.fingerprint || 'v2'));
    document.querySelectorAll('.chip').forEach((btn) => {
      btn.addEventListener('click', () => { void sendPrompt(btn.getAttribute('data-q')); });
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value;
      input.value = '';
      void sendPrompt(q);
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
  const cleanSystemPrompt = scrubTrainingText(modelCard.personaPrompt);
  const approvedSft = samples.filter((s) => s.format === 'sft' && s.status !== 'rejected');

  for (const s of approvedSft) {
    lines.push(
      JSON.stringify({
        messages: [
          {role: 'system', content: cleanSystemPrompt},
          {role: 'user', content: scrubTrainingText(s.prompt)},
          {role: 'assistant', content: scrubTrainingText(s.chosenResponse)},
        ],
      }),
    );
  }

  for (const e of entries) {
    if (getEntryStatus(e) !== 'trusted') continue;
    lines.push(
      JSON.stringify({
        messages: [
          {role: 'system', content: cleanSystemPrompt},
          {role: 'user', content: `Apply rule/knowledge: ${scrubTrainingText(e.title)}`},
          {role: 'assistant', content: scrubTrainingText(e.content)},
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
        prompt: scrubTrainingText(s.prompt),
        chosen: scrubTrainingText(s.chosenResponse),
        rejected: scrubTrainingText(s.rejectedResponse || ''),
      }),
    )
    .join('\n');
}

export function generateOllamaModelfile(modelCard: ModelCardConfig): string {
  const safeName = sanitizeModelSlug(modelCard.modelName);
  const lowerName = safeName.toLowerCase();
  const cleanPersona = scrubTrainingText(modelCard.personaPrompt);
  return `# Modelfile for ${safeName} (generated by Mantis Studio)
# Usage: ollama create ${lowerName} -f Modelfile && ollama run ${lowerName}

FROM ./${safeName}.gguf
PARAMETER temperature ${modelCard.temperature}
PARAMETER num_ctx 4096
SYSTEM """${cleanPersona.replace(/"/g, '\\"')}"""
`;
}

/**
 * Generates a complete, runnable Google Colab Free T4 GPU Unsloth + TRL QLoRA notebook (.ipynb)
 * pre-configured with the user's chosen Model Name to train SFT + optional DPO weights and export GGUF / Hugging Face Hub.
 */
export function generateColabQloraNotebook(modelCard: ModelCardConfig): string {
  const safeName = sanitizeModelSlug(modelCard.modelName);
  const baseModel =
    (modelCard.baseArchitecture || 'unsloth/Qwen2.5-0.5B-Instruct').replace(/[\r\n]/g, '').trim();

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
          'Generated by **Mantis AI Studio**. Upload your exported `sft_train.jsonl` (and optional `dpo_train.jsonl`) to Colab, set Runtime -> T4 GPU, and run all cells.\n',
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
          'assert os.path.exists("sft_train.jsonl") and os.path.getsize("sft_train.jsonl") > 10, "Upload sft_train.jsonl to Colab first!"\n',
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
          '# 2. Optional DPO Preference Optimization (handles empty or missing dpo_train.jsonl safely)\n',
          'if os.path.exists("dpo_train.jsonl") and os.path.getsize("dpo_train.jsonl") > 10:\n',
          '    dpo_ds = load_dataset("json", data_files="dpo_train.jsonl", split="train")\n',
          '    if len(dpo_ds) > 0:\n',
          '        dpo_trainer = DPOTrainer(\n',
          '            model=model, ref_model=None, tokenizer=tokenizer, train_dataset=dpo_ds,\n',
          '            args=DPOConfig(per_device_train_batch_size=1, gradient_accumulation_steps=4, max_steps=30, learning_rate=5e-5, beta=0.1, output_dir="outputs_dpo"),\n',
          '        )\n',
          '        dpo_trainer.train()\n',
          'else:\n',
          '    print("Skipping DPO stage (no dpo_train.jsonl rows provided).")\n',
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
          `print("Saved Q4_K_M GGUF weights for ${safeName}! Download from Colab sidebar or push to Hugging Face.")\n`,
          `# Optional: model.push_to_hub_gguf("your-hf-username/${safeName}", tokenizer, quantization_method="q4_k_m", token=os.environ.get("HF_TOKEN"))\n`,
        ],
      },
    ],
  };

  return JSON.stringify(notebook, null, 2).replace(/\r\n/g, '\n');
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
