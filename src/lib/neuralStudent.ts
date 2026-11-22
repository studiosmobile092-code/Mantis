import type {
  BpeMergePair,
  BpeTokenizerState,
  KnowledgeEntry,
  KnowledgeFolder,
  NeuralCheckpoint,
  NeuralPredictResult,
  NeuralPrototypeTarget,
  NeuralTokenActivation,
  NeuralTrainingExample,
  NeuralWeightMetrics,
  ScratchSkillRule,
  SerializedNeuralWeights,
  TrainingSample,
} from '../types/mantis';
import {getEntryStatus} from './knowledgeSync';

export const EMBEDDING_DIM = 32;
export const HIDDEN_DIM = 48;
export const LORA_RANK = 8;
export const MAX_VOCAB_SIZE = 768;
export const MAX_TARGETS = 192;
export const MAX_CHECKPOINTS_STORED = 24;

const DB_NAME = 'mantis_neural_ckpts_v1';
const STORE_NAME = 'checkpoints';
const META_KEY = 'mantis_neural_meta_v1';

interface NeuralStorageMeta {
  activeCheckpointId: string;
  activeProfileId: string;
  checkpointIds: string[];
  nextSeq: number;
}

// In-memory fallback store so headless Node/tsx tests and restricted private tabs stay consistent
const memoryCheckpointMap = new Map<string, NeuralCheckpoint>();
let memoryMeta: NeuralStorageMeta | null = null;

function hashString(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundWeight(val: number): number {
  return Math.round(val * 100000) / 100000;
}

function toCompactArray(arr: Float32Array): number[] {
  const out = new Array<number>(arr.length);
  for (let i = 0; i < arr.length; i += 1) {
    out[i] = roundWeight(arr[i]);
  }
  return out;
}

function normalizePromptWords(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9_.\-/+#\s]/g, ' ')
    .trim();
  if (!cleaned) return [];
  return cleaned.split(/\s+/).filter(Boolean);
}

/**
 * Splits a single word into symbols and applies learned BPE merges in exact order.
 */
function encodeWordWithMerges(word: string, merges: BpeMergePair[]): string[] {
  let symbols = [...Array.from(word), '</w>'];
  if (merges.length === 0 || symbols.length < 2) return symbols;

  for (let m = 0; m < merges.length; m += 1) {
    const [a, b] = merges[m];
    if (symbols.length < 2) break;
    const next: string[] = [];
    let i = 0;
    while (i < symbols.length) {
      if (i < symbols.length - 1 && symbols[i] === a && symbols[i + 1] === b) {
        next.push(a + b);
        i += 2;
      } else {
        next.push(symbols[i]);
        i += 1;
      }
    }
    symbols = next;
  }
  return symbols;
}

/**
 * Incrementally trains genuine Byte-Pair Encoding (BPE) subword merges on the given texts.
 * Preserves existing vocabulary indices and grows only as new concepts/subwords are taught.
 */
export function trainBpeTokenizer(
  existing: BpeTokenizerState,
  texts: string[],
  maxVocab = MAX_VOCAB_SIZE,
  newMergesLimit = 48,
): BpeTokenizerState {
  const vocab = existing.vocab.length >= 2 ? [...existing.vocab] : ['<pad>', '<unk>'];
  const vocabSet = new Set(vocab);
  const merges: BpeMergePair[] = [...existing.merges];
  const mergeKeySet = new Set(merges.map(([a, b]) => `${a}\u0000${b}`));

  const wordFreq = new Map<string, number>();
  for (const text of texts) {
    const words = normalizePromptWords(text);
    for (const w of words) {
      wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
    }
  }

  if (wordFreq.size === 0) {
    return {vocab, merges};
  }

  // Ensure all base character symbols + </w> exist in vocabulary
  const wordSymbols = new Map<string, {symbols: string[]; freq: number}>();
  for (const [word, freq] of wordFreq.entries()) {
    const encoded = encodeWordWithMerges(word, merges);
    for (const sym of encoded) {
      if (!vocabSet.has(sym) && vocab.length < maxVocab) {
        vocabSet.add(sym);
        vocab.push(sym);
      }
    }
    wordSymbols.set(word, {symbols: encoded, freq});
  }

  // Iterative BPE pair merging
  for (let step = 0; step < newMergesLimit; step += 1) {
    if (vocab.length >= maxVocab) break;

    const pairCounts = new Map<string, {a: string; b: string; count: number}>();
    for (const entry of wordSymbols.values()) {
      const syms = entry.symbols;
      for (let i = 0; i < syms.length - 1; i += 1) {
        const a = syms[i];
        const b = syms[i + 1];
        const key = `${a}\u0000${b}`;
        if (mergeKeySet.has(key)) continue;
        const cur = pairCounts.get(key);
        if (cur) {
          cur.count += entry.freq;
        } else {
          pairCounts.set(key, {a, b, count: entry.freq});
        }
      }
    }

    let bestPair: {key: string; a: string; b: string; count: number} | null = null;
    for (const [key, info] of pairCounts.entries()) {
      if (!bestPair || info.count > bestPair.count) {
        bestPair = {key, a: info.a, b: info.b, count: info.count};
      }
    }

    // Stop early if no pair repeats (keeps tiny batches crisp instead of memorizing noise)
    if (!bestPair || bestPair.count < 2) break;

    const mergedToken = bestPair.a + bestPair.b;
    mergeKeySet.add(bestPair.key);
    merges.push([bestPair.a, bestPair.b]);
    if (!vocabSet.has(mergedToken)) {
      vocabSet.add(mergedToken);
      vocab.push(mergedToken);
    }

    // Apply merge across active word table
    for (const entry of wordSymbols.values()) {
      const syms = entry.symbols;
      if (syms.length < 2) continue;
      const next: string[] = [];
      let i = 0;
      while (i < syms.length) {
        if (i < syms.length - 1 && syms[i] === bestPair.a && syms[i + 1] === bestPair.b) {
          next.push(mergedToken);
          i += 2;
        } else {
          next.push(syms[i]);
          i += 1;
        }
      }
      entry.symbols = next;
    }
  }

  return {vocab, merges};
}

export function encodeBpe(
  text: string,
  tokenizer: BpeTokenizerState,
): {tokenIds: number[]; tokenStrings: string[]; unknownRatio: number} {
  if (tokenizer.vocab.length === 0) {
    return {tokenIds: [], tokenStrings: [], unknownRatio: 1};
  }
  const tokenToId = new Map<string, number>();
  for (let i = 0; i < tokenizer.vocab.length; i += 1) {
    tokenToId.set(tokenizer.vocab[i], i);
  }
  const unkId = tokenToId.get('<unk>') ?? 1;

  const words = normalizePromptWords(text);
  const tokenIds: number[] = [];
  const tokenStrings: string[] = [];
  let unknownCount = 0;

  for (const w of words) {
    const pieces = encodeWordWithMerges(w, tokenizer.merges);
    for (const p of pieces) {
      const id = tokenToId.get(p);
      if (id !== undefined) {
        tokenIds.push(id);
        tokenStrings.push(p);
      } else {
        tokenIds.push(unkId);
        tokenStrings.push(p);
        unknownCount += 1;
      }
    }
  }

  return {
    tokenIds,
    tokenStrings,
    unknownRatio: tokenIds.length > 0 ? unknownCount / tokenIds.length : 1,
  };
}

function computeWeightStats(dims: SerializedNeuralWeights['dims']): {
  paramCount: number;
  memoryBytes: number;
} {
  const {vocabSize, embDim, hiddenDim, classCount, loraRank} = dims;
  if (vocabSize === 0 || classCount === 0) {
    return {paramCount: 0, memoryBytes: 0};
  }
  const paramCount =
    vocabSize * embDim +
    embDim * hiddenDim +
    hiddenDim +
    hiddenDim * classCount +
    classCount +
    embDim * loraRank +
    loraRank * classCount;
  return {
    paramCount,
    memoryBytes: paramCount * 4,
  };
}

export function createBlankSlateCheckpoint(
  profileName = 'Mantis Student',
  profileId = 'profile-default',
  checkpointId = 'ckpt-000',
): NeuralCheckpoint {
  return {
    id: checkpointId,
    label: 'Blank-Slate Baseline (Untrained)',
    profileId,
    profileName,
    parentCheckpointId: null,
    createdAt: new Date().toISOString(),
    metrics: {
      paramCount: 0,
      vocabSize: 0,
      hiddenDim: HIDDEN_DIM,
      classCount: 0,
      stepCount: 0,
      lastLoss: null,
      firstLoss: null,
      lossHistory: [],
      avgGradNorm: 0,
      memoryBytes: 0,
    },
    tokenizer: {
      vocab: [],
      merges: [],
    },
    targets: [],
    weights: {
      dims: {
        vocabSize: 0,
        embDim: EMBEDDING_DIM,
        hiddenDim: HIDDEN_DIM,
        classCount: 0,
        loraRank: LORA_RANK,
      },
      embWeight: [],
      w1: [],
      b1: [],
      w2: [],
      b2: [],
      loraA: [],
      loraB: [],
    },
  };
}

interface LiveTensors {
  vocabSize: number;
  embDim: number;
  hiddenDim: number;
  classCount: number;
  loraRank: number;
  embWeight: Float32Array;
  w1: Float32Array;
  b1: Float32Array;
  w2: Float32Array;
  b2: Float32Array;
  loraA: Float32Array;
  loraB: Float32Array;
}

function hydrateAndExpandTensors(
  prev: SerializedNeuralWeights,
  newVocabSize: number,
  newClassCount: number,
  seedKey: string,
): LiveTensors {
  const embDim = EMBEDDING_DIM;
  const hiddenDim = HIDDEN_DIM;
  const loraRank = LORA_RANK;
  const rng = createSeededRng(hashString(seedKey));

  const embWeight = new Float32Array(newVocabSize * embDim);
  const w1 = new Float32Array(embDim * hiddenDim);
  const b1 = new Float32Array(hiddenDim);
  const w2 = new Float32Array(hiddenDim * newClassCount);
  const b2 = new Float32Array(newClassCount);
  const loraA = new Float32Array(embDim * loraRank);
  const loraB = new Float32Array(loraRank * newClassCount);

  const hasPrior = prev.dims.vocabSize > 0 && prev.dims.classCount > 0;

  // Initialize Emb (Xavier/uniform) and copy prior rows
  const embScale = Math.sqrt(1 / embDim);
  for (let i = 0; i < embWeight.length; i += 1) {
    embWeight[i] = (rng() * 2 - 1) * embScale;
  }
  if (hasPrior) {
    const copyEmbLen = Math.min(prev.embWeight.length, embWeight.length);
    for (let i = 0; i < copyEmbLen; i += 1) embWeight[i] = prev.embWeight[i];
  }

  // W1 & b1
  const w1Scale = Math.sqrt(2 / (embDim + hiddenDim));
  if (hasPrior && prev.w1.length === w1.length) {
    w1.set(prev.w1);
    b1.set(prev.b1);
  } else {
    for (let i = 0; i < w1.length; i += 1) w1[i] = (rng() * 2 - 1) * w1Scale;
  }

  // W2 & b2 (column-preserve previous classes when new classes are appended)
  const w2Scale = Math.sqrt(2 / (hiddenDim + newClassCount));
  for (let i = 0; i < w2.length; i += 1) {
    w2[i] = (rng() * 2 - 1) * w2Scale;
  }
  if (hasPrior) {
    const oldC = Math.min(prev.dims.classCount, newClassCount);
    for (let h = 0; h < hiddenDim; h += 1) {
      for (let c = 0; c < oldC; c += 1) {
        w2[h * newClassCount + c] = prev.w2[h * prev.dims.classCount + c] ?? w2[h * newClassCount + c];
      }
    }
    for (let c = 0; c < oldC; c += 1) {
      b2[c] = prev.b2[c] ?? 0;
    }
  }

  // LoRA A & B (classic LoRA init: A small Gaussian/uniform, B zero for clean residual start)
  const loraAScale = Math.sqrt(1 / embDim) * 0.5;
  if (hasPrior && prev.loraA.length === loraA.length) {
    loraA.set(prev.loraA);
  } else {
    for (let i = 0; i < loraA.length; i += 1) {
      loraA[i] = (rng() * 2 - 1) * loraAScale;
    }
  }
  if (hasPrior) {
    const oldC = Math.min(prev.dims.classCount, newClassCount);
    for (let r = 0; r < loraRank; r += 1) {
      for (let c = 0; c < oldC; c += 1) {
        loraB[r * newClassCount + c] = prev.loraB[r * prev.dims.classCount + c] ?? 0;
      }
    }
  }

  return {
    vocabSize: newVocabSize,
    embDim,
    hiddenDim,
    classCount: newClassCount,
    loraRank,
    embWeight,
    w1,
    b1,
    w2,
    b2,
    loraA,
    loraB,
  };
}

interface ForwardBuffers {
  pooledEmb: Float32Array;
  hidden: Float32Array;
  loraHidden: Float32Array;
  logits: Float32Array;
  probs: Float32Array;
  tokenWeights: number[];
}

function forwardPass(tokenIds: number[], t: LiveTensors): ForwardBuffers {
  const {embDim, hiddenDim, classCount, loraRank} = t;
  const pooledEmb = new Float32Array(embDim);
  const tokenWeights = new Array<number>(tokenIds.length);

  if (tokenIds.length > 0) {
    // Subword salience weighting: slightly down-weight padding/unk tokens (<pad>=0, <unk>=1)
    let weightSum = 0;
    for (let k = 0; k < tokenIds.length; k += 1) {
      const id = tokenIds[k];
      const w = id <= 1 ? 0.35 : 1.0;
      tokenWeights[k] = w;
      weightSum += w;
      const offset = id * embDim;
      for (let d = 0; d < embDim; d += 1) {
        pooledEmb[d] += t.embWeight[offset + d] * w;
      }
    }
    const inv = weightSum > 1e-8 ? 1 / weightSum : 1;
    for (let d = 0; d < embDim; d += 1) {
      pooledEmb[d] *= inv;
    }
  }

  // Hidden MLP layer: h = tanh(W1^T * e + b1)
  const hidden = new Float32Array(hiddenDim);
  for (let h = 0; h < hiddenDim; h += 1) {
    let sum = t.b1[h];
    for (let d = 0; d < embDim; d += 1) {
      sum += pooledEmb[d] * t.w1[d * hiddenDim + h];
    }
    hidden[h] = Math.tanh(sum);
  }

  // Low-Rank residual adapter: loraHidden = e * loraA
  const loraHidden = new Float32Array(loraRank);
  for (let r = 0; r < loraRank; r += 1) {
    let sum = 0;
    for (let d = 0; d < embDim; d += 1) {
      sum += pooledEmb[d] * t.loraA[d * loraRank + r];
    }
    loraHidden[r] = sum;
  }

  // Logits = (hidden * W2 + b2) + (loraHidden * loraB)
  const logits = new Float32Array(classCount);
  let maxLogit = -Infinity;
  for (let c = 0; c < classCount; c += 1) {
    let z = t.b2[c];
    for (let h = 0; h < hiddenDim; h += 1) {
      z += hidden[h] * t.w2[h * classCount + c];
    }
    for (let r = 0; r < loraRank; r += 1) {
      z += loraHidden[r] * t.loraB[r * classCount + c];
    }
    logits[c] = z;
    if (z > maxLogit) maxLogit = z;
  }

  // Numerically stable Softmax
  const probs = new Float32Array(classCount);
  let expSum = 0;
  for (let c = 0; c < classCount; c += 1) {
    const eVal = Math.exp(Math.max(-30, Math.min(30, logits[c] - maxLogit)));
    probs[c] = eVal;
    expSum += eVal;
  }
  const invSum = expSum > 1e-12 ? 1 / expSum : 1 / Math.max(1, classCount);
  for (let c = 0; c < classCount; c += 1) {
    probs[c] *= invSum;
  }

  return {pooledEmb, hidden, loraHidden, logits, probs, tokenWeights};
}

function makeAdamMoments(t: LiveTensors) {
  return {
    mEmb: new Float32Array(t.embWeight.length),
    vEmb: new Float32Array(t.embWeight.length),
    mW1: new Float32Array(t.w1.length),
    vW1: new Float32Array(t.w1.length),
    mB1: new Float32Array(t.b1.length),
    vB1: new Float32Array(t.b1.length),
    mW2: new Float32Array(t.w2.length),
    vW2: new Float32Array(t.w2.length),
    mB2: new Float32Array(t.b2.length),
    vB2: new Float32Array(t.b2.length),
    mLoraA: new Float32Array(t.loraA.length),
    vLoraA: new Float32Array(t.loraA.length),
    mLoraB: new Float32Array(t.loraB.length),
    vLoraB: new Float32Array(t.loraB.length),
  };
}

function adamWStep(
  param: Float32Array,
  grad: Float32Array,
  m: Float32Array,
  v: Float32Array,
  lr: number,
  beta1: number,
  beta2: number,
  stepNum: number,
  weightDecay: number,
) {
  const b1Corr = 1 - Math.pow(beta1, stepNum);
  const b2Corr = 1 - Math.pow(beta2, stepNum);
  const eps = 1e-8;
  for (let i = 0; i < param.length; i += 1) {
    const g = grad[i];
    if (g === 0 && m[i] === 0 && v[i] === 0) continue;
    const mi = beta1 * m[i] + (1 - beta1) * g;
    const vi = beta2 * v[i] + (1 - beta2) * g * g;
    m[i] = mi;
    v[i] = vi;
    const mHat = mi / b1Corr;
    const vHat = vi / b2Corr;
    const decayed = param[i] * (1 - lr * weightDecay);
    param[i] = decayed - (lr * mHat) / (Math.sqrt(vHat) + eps);
  }
}

function buildTargetId(promptPattern: string): string {
  const slug = promptPattern
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 28);
  const h = hashString(promptPattern.toLowerCase()).toString(36).slice(0, 5);
  return `tgt-${slug || 'item'}-${h}`;
}

/**
 * Pure worker-safe neural training step using dynamic BPE + MLP/LoRA + AdamW optimization.
 * Always reserves class index 0 as the explicit OOD / Untrained Reject boundary so 1+ taught
 * skills never collapse to artificial 100% confidence on unseen prompts.
 */
export function trainNeuralBatchCore(params: {
  checkpoint: NeuralCheckpoint;
  examples: NeuralTrainingExample[];
  epochs?: number;
  learningRate?: number;
  label?: string;
  nextCheckpointId?: string;
}): {
  checkpoint: NeuralCheckpoint;
  firstLoss: number;
  lastLoss: number;
  gradNorm: number;
  stepsAdded: number;
} {
  const epochs = Math.max(1, Math.min(80, params.epochs ?? 20));
  const baseLr = params.learningRate ?? 0.032;
  const cleanedExamples = params.examples
    .map((ex) => ({
      prompt: ex.prompt.trim(),
      response: ex.response.trim(),
      folderName: ex.folderName?.trim() || 'Patterns',
      source: ex.source || 'manual',
      entryId: ex.entryId,
      skillId: ex.skillId,
      weight: typeof ex.weight === 'number' && Number.isFinite(ex.weight)
        ? Math.max(0.25, Math.min(2.5, ex.weight))
        : 1.0,
    }))
    .filter((ex) => ex.prompt.length > 0 && ex.response.length > 0);

  if (cleanedExamples.length === 0) {
    return {
      checkpoint: params.checkpoint,
      firstLoss: params.checkpoint.metrics.lastLoss ?? 0,
      lastLoss: params.checkpoint.metrics.lastLoss ?? 0,
      gradNorm: 0,
      stepsAdded: 0,
    };
  }

  // Merge new examples into prototype target table (preserving prior class indices)
  const nextTargets: NeuralPrototypeTarget[] = params.checkpoint.targets.map((t) => ({...t}));
  const targetIndexByPrompt = new Map<string, number>();
  for (let i = 0; i < nextTargets.length; i += 1) {
    targetIndexByPrompt.set(nextTargets[i].promptPattern.toLowerCase(), i);
  }

  const assignedClassByExample: number[] = [];
  for (const ex of cleanedExamples) {
    const key = ex.prompt.toLowerCase();
    const existingIdx = targetIndexByPrompt.get(key);
    if (existingIdx !== undefined) {
      nextTargets[existingIdx].responseText = ex.response;
      nextTargets[existingIdx].folderName = ex.folderName;
      nextTargets[existingIdx].source = ex.source;
      assignedClassByExample.push(existingIdx + 1); // +1 because index 0 is OOD reject
    } else if (nextTargets.length < MAX_TARGETS) {
      const created: NeuralPrototypeTarget = {
        id: buildTargetId(ex.prompt),
        promptPattern: ex.prompt,
        responseText: ex.response,
        folderName: ex.folderName,
        source: ex.source,
        entryId: ex.entryId,
        skillId: ex.skillId,
        trainedSteps: 0,
        lastLoss: 1.0,
      };
      nextTargets.push(created);
      const newIdx = nextTargets.length - 1;
      targetIndexByPrompt.set(key, newIdx);
      assignedClassByExample.push(newIdx + 1);
    }
  }

  // Train/expand dynamic BPE vocabulary on prompts + responses
  const nextTokenizer = trainBpeTokenizer(
    params.checkpoint.tokenizer,
    cleanedExamples.flatMap((ex) => [ex.prompt, ex.response.slice(0, 160)]),
    MAX_VOCAB_SIZE,
    Math.min(64, Math.max(16, cleanedExamples.length * 4)),
  );

  // Class 0 = OOD reject; Class 1..N = nextTargets[0..N-1]
  const totalClasses = nextTargets.length + 1;
  const tensors = hydrateAndExpandTensors(
    params.checkpoint.weights,
    nextTokenizer.vocab.length,
    totalClasses,
    `${params.checkpoint.id}-${cleanedExamples[0].prompt}`,
  );

  // Pre-encode training batch + explicit OOD (<unk>) negative anchor
  const encodedSamples: Array<{
    tokenIds: number[];
    targetClass: number;
    targetArrIdx: number;
    weight: number;
  }> = [];
  for (let i = 0; i < cleanedExamples.length; i += 1) {
    const enc = encodeBpe(cleanedExamples[i].prompt, nextTokenizer);
    if (enc.tokenIds.length === 0) continue;
    const classIdx = assignedClassByExample[i];
    if (classIdx !== undefined) {
      encodedSamples.push({
        tokenIds: enc.tokenIds,
        targetClass: classIdx,
        targetArrIdx: classIdx - 1,
        weight: cleanedExamples[i].weight,
      });
    }
  }

  if (encodedSamples.length === 0) {
    return {
      checkpoint: params.checkpoint,
      firstLoss: params.checkpoint.metrics.lastLoss ?? 0,
      lastLoss: params.checkpoint.metrics.lastLoss ?? 0,
      gradNorm: 0,
      stepsAdded: 0,
    };
  }

  // Add synthetic negative calibration patterns mapped to OOD class 0
  const oodAnchors: Array<{
    tokenIds: number[];
    targetClass: number;
    targetArrIdx: number;
    weight: number;
  }> = [
    {tokenIds: [1], targetClass: 0, targetArrIdx: -1, weight: 0.35},
    {tokenIds: [1, 1], targetClass: 0, targetArrIdx: -1, weight: 0.35},
  ];

  const adam = makeAdamMoments(tensors);
  const gEmb = new Float32Array(tensors.embWeight.length);
  const gW1 = new Float32Array(tensors.w1.length);
  const gB1 = new Float32Array(tensors.b1.length);
  const gW2 = new Float32Array(tensors.w2.length);
  const gB2 = new Float32Array(tensors.b2.length);
  const gLoraA = new Float32Array(tensors.loraA.length);
  const gLoraB = new Float32Array(tensors.loraB.length);

  const lossHistory = [...params.checkpoint.metrics.lossHistory];
  let firstLoss = 0;
  let lastLoss = 0;
  let totalGradNorm = 0;
  let stepSeq = 0;

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    gEmb.fill(0);
    gW1.fill(0);
    gB1.fill(0);
    gW2.fill(0);
    gB2.fill(0);
    gLoraA.fill(0);
    gLoraB.fill(0);

    const epochItems = [...encodedSamples, oodAnchors[epoch % oodAnchors.length]];
    let epochLoss = 0;

    for (let sIdx = 0; sIdx < epochItems.length; sIdx += 1) {
      const sample = epochItems[sIdx];
      const fwd = forwardPass(sample.tokenIds, tensors);
      const targetProb = Math.max(1e-7, fwd.probs[sample.targetClass] ?? 1e-7);
      const sampleWeight = sample.targetClass === 0 ? 0.35 : sample.weight;
      const loss = -Math.log(targetProb) * sampleWeight;
      epochLoss += loss;

      if (sample.targetArrIdx >= 0) {
        nextTargets[sample.targetArrIdx].lastLoss = roundWeight(-Math.log(targetProb));
        nextTargets[sample.targetArrIdx].trainedSteps += 1;
      }

      // dLogits = (probs - one_hot(y)) * sampleWeight
      const {embDim, hiddenDim, classCount, loraRank} = tensors;
      const dHidden = new Float32Array(hiddenDim);
      const dLoraHidden = new Float32Array(loraRank);

      for (let c = 0; c < classCount; c += 1) {
        const dLogit = (fwd.probs[c] - (c === sample.targetClass ? 1 : 0)) * sampleWeight;
        gB2[c] += dLogit;
        for (let h = 0; h < hiddenDim; h += 1) {
          gW2[h * classCount + c] += fwd.hidden[h] * dLogit;
          dHidden[h] += tensors.w2[h * classCount + c] * dLogit;
        }
        for (let r = 0; r < loraRank; r += 1) {
          gLoraB[r * classCount + c] += fwd.loraHidden[r] * dLogit;
          dLoraHidden[r] += tensors.loraB[r * classCount + c] * dLogit;
        }
      }

      // Backprop through tanh + W1 + LoRA A into pooledEmb
      const dPooledEmb = new Float32Array(embDim);
      for (let h = 0; h < hiddenDim; h += 1) {
        const dtanh = dHidden[h] * (1 - fwd.hidden[h] * fwd.hidden[h]);
        gB1[h] += dtanh;
        for (let d = 0; d < embDim; d += 1) {
          gW1[d * hiddenDim + h] += fwd.pooledEmb[d] * dtanh;
          dPooledEmb[d] += tensors.w1[d * hiddenDim + h] * dtanh;
        }
      }
      for (let r = 0; r < loraRank; r += 1) {
        for (let d = 0; d < embDim; d += 1) {
          gLoraA[d * loraRank + r] += fwd.pooledEmb[d] * dLoraHidden[r];
          dPooledEmb[d] += tensors.loraA[d * loraRank + r] * dLoraHidden[r];
        }
      }

      // Backprop into active token embeddings
      let weightSum = 0;
      for (let k = 0; k < fwd.tokenWeights.length; k += 1) {
        weightSum += fwd.tokenWeights[k];
      }
      const invW = weightSum > 1e-8 ? 1 / weightSum : 1;
      for (let k = 0; k < sample.tokenIds.length; k += 1) {
        const tokId = sample.tokenIds[k];
        const scale = fwd.tokenWeights[k] * invW;
        const offset = tokId * embDim;
        for (let d = 0; d < embDim; d += 1) {
          gEmb[offset + d] += dPooledEmb[d] * scale;
        }
      }
    }

    const avgEpochLoss = epochLoss / epochItems.length;
    if (epoch === 0) firstLoss = avgEpochLoss;
    lastLoss = avgEpochLoss;

    // Average + clip gradient norm
    const invBatch = 1 / epochItems.length;
    let sqNorm = 0;
    const gradArrays = [gEmb, gW1, gB1, gW2, gB2, gLoraA, gLoraB];
    for (const ga of gradArrays) {
      for (let i = 0; i < ga.length; i += 1) {
        ga[i] *= invBatch;
        sqNorm += ga[i] * ga[i];
      }
    }
    const gNorm = Math.sqrt(sqNorm);
    totalGradNorm += gNorm;
    if (gNorm > 5.0) {
      const clip = 5.0 / gNorm;
      for (const ga of gradArrays) {
        for (let i = 0; i < ga.length; i += 1) ga[i] *= clip;
      }
    }

    stepSeq += 1;
    // Gentle cosine learning rate schedule inside the batch
    const lr = baseLr * (0.65 + 0.35 * Math.cos((Math.PI * epoch) / Math.max(1, epochs)));
    adamWStep(tensors.embWeight, gEmb, adam.mEmb, adam.vEmb, lr, 0.9, 0.999, stepSeq, 1e-4);
    adamWStep(tensors.w1, gW1, adam.mW1, adam.vW1, lr, 0.9, 0.999, stepSeq, 1e-4);
    adamWStep(tensors.b1, gB1, adam.mB1, adam.vB1, lr, 0.9, 0.999, stepSeq, 0);
    adamWStep(tensors.w2, gW2, adam.mW2, adam.vW2, lr, 0.9, 0.999, stepSeq, 1e-4);
    adamWStep(tensors.b2, gB2, adam.mB2, adam.vB2, lr, 0.9, 0.999, stepSeq, 0);
    adamWStep(tensors.loraA, gLoraA, adam.mLoraA, adam.vLoraA, lr, 0.9, 0.999, stepSeq, 1e-4);
    adamWStep(tensors.loraB, gLoraB, adam.mLoraB, adam.vLoraB, lr, 0.9, 0.999, stepSeq, 1e-4);

    lossHistory.push(roundWeight(avgEpochLoss));
  }

  const trimmedHistory = lossHistory.slice(-48);
  const avgGradNorm = roundWeight(totalGradNorm / epochs);
  const dims = {
    vocabSize: tensors.vocabSize,
    embDim: tensors.embDim,
    hiddenDim: tensors.hiddenDim,
    classCount: tensors.classCount,
    loraRank: tensors.loraRank,
  };
  const stats = computeWeightStats(dims);
  const nextStepCount = params.checkpoint.metrics.stepCount + epochs;

  const updatedCheckpoint: NeuralCheckpoint = {
    id: params.nextCheckpointId || nextCheckpointIdFrom(params.checkpoint.id),
    label:
      params.label ||
      `Batch ${cleanedExamples.length} samples · ${epochs} steps`,
    profileId: params.checkpoint.profileId,
    profileName: params.checkpoint.profileName,
    parentCheckpointId: params.checkpoint.id,
    createdAt: new Date().toISOString(),
    metrics: {
      paramCount: stats.paramCount,
      vocabSize: nextTokenizer.vocab.length,
      hiddenDim: HIDDEN_DIM,
      classCount: totalClasses,
      stepCount: nextStepCount,
      firstLoss:
        params.checkpoint.metrics.firstLoss ?? roundWeight(firstLoss),
      lastLoss: roundWeight(lastLoss),
      lossHistory: trimmedHistory,
      avgGradNorm,
      memoryBytes: stats.memoryBytes,
    },
    tokenizer: nextTokenizer,
    targets: nextTargets,
    weights: {
      dims,
      embWeight: toCompactArray(tensors.embWeight),
      w1: toCompactArray(tensors.w1),
      b1: toCompactArray(tensors.b1),
      w2: toCompactArray(tensors.w2),
      b2: toCompactArray(tensors.b2),
      loraA: toCompactArray(tensors.loraA),
      loraB: toCompactArray(tensors.loraB),
    },
  };

  return {
    checkpoint: updatedCheckpoint,
    firstLoss: roundWeight(firstLoss),
    lastLoss: roundWeight(lastLoss),
    gradNorm: avgGradNorm,
    stepsAdded: epochs,
  };
}

function nextCheckpointIdFrom(currentId: string): string {
  const m = currentId.match(/^ckpt-(\d+)/);
  const nextNum = m ? Number(m[1]) + 1 : 1;
  return `ckpt-${String(nextNum).padStart(3, '0')}`;
}

/**
 * Pure worker-safe forward inference for the Neural Student Core.
 * Returns genuine zero-knowledge untrained output when stepCount === 0.
 */
export function inferNeuralCore(
  prompt: string,
  checkpoint: NeuralCheckpoint,
): NeuralPredictResult {
  if (
    checkpoint.metrics.stepCount === 0 ||
    checkpoint.targets.length === 0 ||
    checkpoint.tokenizer.vocab.length === 0
  ) {
    return {
      replyText:
        'Untrained neural baseline (0 steps · 0 subword tokens · 0 learned targets). Teach a rule, fix this reply below, or distill from your Teacher to train student weights.',
      confidence: 0,
      entropy: 1,
      lossEstimate: null,
      predictedTargetId: null,
      topTokens: [],
      isUntrained: true,
      checkpointId: checkpoint.id,
      isolationVerified: true,
    };
  }

  const enc = encodeBpe(prompt, checkpoint.tokenizer);
  if (enc.tokenIds.length === 0) {
    return {
      replyText: 'Empty input — provide text to run Neural Student forward pass.',
      confidence: 0,
      entropy: 1,
      lossEstimate: null,
      predictedTargetId: null,
      topTokens: [],
      isUntrained: false,
      checkpointId: checkpoint.id,
      isolationVerified: true,
    };
  }

  const tensors: LiveTensors = {
    vocabSize: checkpoint.weights.dims.vocabSize,
    embDim: checkpoint.weights.dims.embDim,
    hiddenDim: checkpoint.weights.dims.hiddenDim,
    classCount: checkpoint.weights.dims.classCount,
    loraRank: checkpoint.weights.dims.loraRank,
    embWeight: new Float32Array(checkpoint.weights.embWeight),
    w1: new Float32Array(checkpoint.weights.w1),
    b1: new Float32Array(checkpoint.weights.b1),
    w2: new Float32Array(checkpoint.weights.w2),
    b2: new Float32Array(checkpoint.weights.b2),
    loraA: new Float32Array(checkpoint.weights.loraA),
    loraB: new Float32Array(checkpoint.weights.loraB),
  };

  const fwd = forwardPass(enc.tokenIds, tensors);

  // Shannon entropy normalized by log(C)
  let rawEntropy = 0;
  for (let c = 0; c < tensors.classCount; c += 1) {
    const p = Math.max(1e-8, fwd.probs[c]);
    rawEntropy -= p * Math.log(p);
  }
  const maxEntropy = Math.log(Math.max(2, tensors.classCount));
  const normEntropy = roundWeight(Math.min(1, rawEntropy / maxEntropy));

  // Best non-OOD target (classes 1..N)
  let bestClassIdx = 0;
  let bestTargetProb = 0;
  for (let c = 1; c < tensors.classCount; c += 1) {
    if (fwd.probs[c] > bestTargetProb) {
      bestTargetProb = fwd.probs[c];
      bestClassIdx = c;
    }
  }

  // Compute real subword token attribution magnitudes vs pooled embedding alignment
  let pooledNormSq = 0;
  for (let d = 0; d < tensors.embDim; d += 1) {
    pooledNormSq += fwd.pooledEmb[d] * fwd.pooledEmb[d];
  }
  const pooledNorm = Math.sqrt(Math.max(1e-8, pooledNormSq));

  const tokenScoreMap = new Map<string, number>();
  for (let k = 0; k < enc.tokenIds.length; k += 1) {
    const tokId = enc.tokenIds[k];
    const tokLabel = enc.tokenStrings[k];
    const offset = tokId * tensors.embDim;
    let dot = 0;
    for (let d = 0; d < tensors.embDim; d += 1) {
      dot += tensors.embWeight[offset + d] * fwd.pooledEmb[d];
    }
    const sim = (dot / pooledNorm) * fwd.tokenWeights[k];
    const prev = tokenScoreMap.get(tokLabel) ?? -Infinity;
    if (sim > prev) tokenScoreMap.set(tokLabel, sim);
  }

  const topTokens: NeuralTokenActivation[] = Array.from(tokenScoreMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([token, weight]) => ({
      token: token.replace('</w>', ''),
      weight: roundWeight(Math.max(0, weight)),
    }));

  const oodProb = fwd.probs[0] || 0;
  const target = bestClassIdx >= 1 ? checkpoint.targets[bestClassIdx - 1] : null;
  const knownTokensRatio = 1 - enc.unknownRatio;

  // Penalty if mostly <unk> tokens or OOD boundary beats the strongest taught class
  const calibratedConfidence =
    knownTokensRatio <= 0.1
      ? Math.min(0.16, bestTargetProb * 0.25)
      : bestTargetProb < oodProb
        ? bestTargetProb * 0.55
        : bestTargetProb;

  const estLoss = roundWeight(-Math.log(Math.max(1e-5, calibratedConfidence)));

  if (!target || calibratedConfidence < 0.28 || knownTokensRatio <= 0.1) {
    return {
      replyText: target
        ? `Low neural confidence (${calibratedConfidence.toFixed(2)}) on "${prompt.trim()}" — closest learned neuron: "${target.promptPattern}", but unseen subwords prevent reliable recall. Correct or teach this turn to step-train ${checkpoint.id}.`
        : `Untrained subwords for "${prompt.trim()}" on ${checkpoint.id}. Correct or teach this turn to add weights.`,
      confidence: roundWeight(calibratedConfidence),
      entropy: normEntropy,
      lossEstimate: estLoss,
      predictedTargetId: target?.id || null,
      topTokens,
      isUntrained: false,
      checkpointId: checkpoint.id,
      isolationVerified: true,
    };
  }

  return {
    replyText: target.responseText,
    confidence: roundWeight(calibratedConfidence),
    entropy: normEntropy,
    lossEstimate: estLoss,
    predictedTargetId: target.id,
    topTokens,
    isUntrained: false,
    checkpointId: checkpoint.id,
    isolationVerified: true,
  };
}

/**
 * Converts approved SFT/DPO pairs (weighted toward DPO chosen revisions), learned skills,
 * Trusted knowledge rules, and optional 30% anti-forgetting curriculum replay anchors into
 * clean neural batch training examples.
 */
export function buildTrainingExamplesFromWorkspace(params: {
  trainingSamples: TrainingSample[];
  scratchSkills: ScratchSkillRule[];
  entries: KnowledgeEntry[];
  folders: KnowledgeFolder[];
  activeCheckpoint?: NeuralCheckpoint;
}): NeuralTrainingExample[] {
  const examples: NeuralTrainingExample[] = [];
  const seenPrompts = new Map<string, number>();
  const rejectedResponses = new Set<string>();
  const folderMap = new Map(params.folders.map((f) => [f.id, f.name]));

  // Track explicitly rejected responses so lower-priority skills cannot resurrect DPO losers
  for (const s of params.trainingSamples) {
    if (s.status !== 'rejected' && s.format === 'dpo' && s.rejectedResponse?.trim()) {
      rejectedResponses.add(s.rejectedResponse.trim().slice(0, 120).toLowerCase());
    }
  }

  const pushOrUpgrade = (ex: NeuralTrainingExample) => {
    const key = ex.prompt.trim().toLowerCase();
    if (!key || !ex.response.trim()) return;
    const existingIdx = seenPrompts.get(key);
    if (existingIdx !== undefined) {
      const prev = examples[existingIdx];
      if ((ex.weight ?? 1) > (prev.weight ?? 1)) {
        examples[existingIdx] = ex;
      }
      return;
    }
    seenPrompts.set(key, examples.length);
    examples.push(ex);
  };

  // 1. DPO preference winners receive highest gradient weight (1.75x); approved SFT gets 1.2x
  for (const s of params.trainingSamples) {
    if (s.status === 'rejected') continue;
    const weight =
      s.format === 'dpo'
        ? s.status === 'approved'
          ? 1.85
          : 1.35
        : s.status === 'approved'
          ? 1.25
          : 0.85;
    pushOrUpgrade({
      prompt: s.prompt,
      response: s.chosenResponse,
      folderName: s.format === 'dpo' ? 'Constitutional DPO' : 'Training',
      source: s.format === 'dpo' ? 'dpo' : 'sft',
      weight,
    });
  }

  // 2. Active taught skills (skipping any overwritten DPO loser phrasing)
  for (const sk of params.scratchSkills) {
    const bestReply = sk.responses[0] || '';
    if (!bestReply.trim()) continue;
    if (rejectedResponses.has(bestReply.trim().slice(0, 120).toLowerCase())) {
      continue;
    }
    for (const trig of sk.triggers.slice(0, 4)) {
      pushOrUpgrade({
        prompt: trig,
        response: bestReply,
        folderName: sk.folderName,
        source: sk.learnedFrom === 'teacher-distilled' ? 'teacher-distilled' : 'manual',
        skillId: sk.id,
        weight: sk.learnedFrom === 'teacher-distilled' ? 1.15 : 1.05,
      });
    }
  }

  // 3. Trusted Knowledge Rules (raw captures are quarantined out of neural training)
  for (const entry of params.entries) {
    if (getEntryStatus(entry) !== 'trusted') continue;
    const fName = (entry.folder_id && folderMap.get(entry.folder_id)) || 'Patterns';
    pushOrUpgrade({
      prompt: entry.title,
      response: entry.content.slice(0, 800),
      folderName: fName,
      source: 'knowledge',
      entryId: entry.id,
      weight: 1.15,
    });
  }

  // 4. Anti-Forgetting Curriculum Replay: ensure ~30% previously converged checkpoint targets stay mixed in
  if (params.activeCheckpoint && params.activeCheckpoint.targets.length > 0) {
    const replayBudget = Math.max(2, Math.ceil(examples.length * 0.3));
    const convergedTargets = [...params.activeCheckpoint.targets]
      .filter((t) => !rejectedResponses.has(t.responseText.trim().slice(0, 120).toLowerCase()))
      .sort((a, b) => a.lastLoss - b.lastLoss)
      .slice(0, replayBudget);

    for (const tgt of convergedTargets) {
      pushOrUpgrade({
        prompt: tgt.promptPattern,
        response: tgt.responseText,
        folderName: tgt.folderName,
        source: tgt.source,
        entryId: tgt.entryId,
        skillId: tgt.skillId,
        weight: 1.0,
      });
    }
  }

  return examples.slice(0, MAX_TARGETS);
}

// ---------------- IndexedDB Checkpoint Persistence ----------------

let idbPromise: Promise<IDBDatabase | null> | null = null;

function openCheckpointDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (idbPromise) return idbPromise;

  idbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, {keyPath: 'id'});
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          idbPromise = null;
        };
        db.onclose = () => {
          idbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        idbPromise = null;
        resolve(null);
      };
      req.onblocked = () => {
        idbPromise = null;
        resolve(null);
      };
    } catch {
      idbPromise = null;
      resolve(null);
    }
  });
  return idbPromise;
}

function readMeta(): NeuralStorageMeta | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(META_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as NeuralStorageMeta;
        if (parsed && parsed.activeCheckpointId) return parsed;
      }
    } catch {
      // ignore
    }
  }
  return memoryMeta;
}

function writeMeta(meta: NeuralStorageMeta): void {
  memoryMeta = meta;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch {
      // ignore
    }
  }
}

async function idbGetAllCheckpoints(): Promise<NeuralCheckpoint[]> {
  const db = await openCheckpointDb();
  if (!db) {
    return Array.from(memoryCheckpointMap.values());
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        const rows = ((req.result as NeuralCheckpoint[]) || []).filter(
          (r) => r && r.id && r.metrics,
        );
        for (const r of rows) memoryCheckpointMap.set(r.id, r);
        resolve(rows);
      };
      req.onerror = () => resolve(Array.from(memoryCheckpointMap.values()));
    } catch {
      resolve(Array.from(memoryCheckpointMap.values()));
    }
  });
}

async function idbPutCheckpoint(ckpt: NeuralCheckpoint): Promise<void> {
  memoryCheckpointMap.set(ckpt.id, ckpt);
  const db = await openCheckpointDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(ckpt);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // ignore private mode quota errors
  }
}

async function idbDeleteCheckpoint(id: string): Promise<void> {
  memoryCheckpointMap.delete(id);
  const db = await openCheckpointDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // ignore
  }
}

export async function loadNeuralCheckpointState(): Promise<{
  activeCheckpoint: NeuralCheckpoint;
  checkpoints: NeuralCheckpoint[];
}> {
  let all = await idbGetAllCheckpoints();
  const meta = readMeta();

  if (all.length === 0) {
    const baseline = createBlankSlateCheckpoint('Mantis Student', 'profile-default', 'ckpt-000');
    await idbPutCheckpoint(baseline);
    writeMeta({
      activeCheckpointId: baseline.id,
      activeProfileId: baseline.profileId,
      checkpointIds: [baseline.id],
      nextSeq: 1,
    });
    return {activeCheckpoint: baseline, checkpoints: [baseline]};
  }

  all = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const active =
    (meta?.activeCheckpointId && all.find((c) => c.id === meta.activeCheckpointId)) ||
    all[0];

  return {activeCheckpoint: active, checkpoints: all};
}

export function allocateNextCheckpointId(): string {
  const meta = readMeta();
  const seq = meta ? Math.max(1, meta.nextSeq) : 1;
  return `ckpt-${String(seq).padStart(3, '0')}`;
}

export async function persistNewNeuralCheckpoint(
  checkpoint: NeuralCheckpoint,
): Promise<{activeCheckpoint: NeuralCheckpoint; checkpoints: NeuralCheckpoint[]}> {
  await idbPutCheckpoint(checkpoint);
  let all = (await idbGetAllCheckpoints()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  // Prune oldest checkpoints beyond MAX_CHECKPOINTS_STORED while always preserving ckpt-000 baseline if present
  if (all.length > MAX_CHECKPOINTS_STORED) {
    const keepIds = new Set<string>([checkpoint.id]);
    const zeroBase = all.find((c) => c.id === 'ckpt-000');
    if (zeroBase) keepIds.add(zeroBase.id);

    for (const c of all) {
      if (keepIds.size >= MAX_CHECKPOINTS_STORED) break;
      keepIds.add(c.id);
    }

    const toRemove = all.filter((c) => !keepIds.has(c.id));
    for (const old of toRemove) {
      await idbDeleteCheckpoint(old.id);
    }
    all = all.filter((c) => keepIds.has(c.id));
  }

  const prevMeta = readMeta();
  const numericSuffix = Number(checkpoint.id.replace(/^ckpt-/, '')) || 0;
  const nextSeq = Math.max((prevMeta?.nextSeq || 1) + 1, numericSuffix + 1);

  writeMeta({
    activeCheckpointId: checkpoint.id,
    activeProfileId: checkpoint.profileId,
    checkpointIds: all.map((c) => c.id),
    nextSeq,
  });

  return {activeCheckpoint: checkpoint, checkpoints: all};
}

export async function rollbackToCheckpoint(checkpointId: string): Promise<{
  activeCheckpoint: NeuralCheckpoint;
  checkpoints: NeuralCheckpoint[];
}> {
  const all = (await idbGetAllCheckpoints()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const found = all.find((c) => c.id === checkpointId);
  if (!found) {
    throw new Error(`Checkpoint "${checkpointId}" not found.`);
  }
  const prevMeta = readMeta();
  writeMeta({
    activeCheckpointId: found.id,
    activeProfileId: found.profileId,
    checkpointIds: all.map((c) => c.id),
    nextSeq: prevMeta?.nextSeq || all.length + 1,
  });
  return {activeCheckpoint: found, checkpoints: all};
}

export async function cloneCheckpointAsProfile(
  sourceCheckpointId: string,
  newProfileName: string,
): Promise<{activeCheckpoint: NeuralCheckpoint; checkpoints: NeuralCheckpoint[]}> {
  const all = await idbGetAllCheckpoints();
  const source = all.find((c) => c.id === sourceCheckpointId);
  if (!source) {
    throw new Error(`Checkpoint "${sourceCheckpointId}" not found.`);
  }
  const cleanName = newProfileName.trim() || `${source.profileName} Fork`;
  const cloned: NeuralCheckpoint = {
    ...source,
    id: allocateNextCheckpointId(),
    label: `Cloned from ${source.id} -> ${cleanName}`,
    profileId: `profile-${Date.now().toString(36)}`,
    profileName: cleanName,
    parentCheckpointId: source.id,
    createdAt: new Date().toISOString(),
  };
  return persistNewNeuralCheckpoint(cloned);
}

export async function resetNeuralProfileToBlankSlate(
  profileName = 'Mantis Student',
): Promise<{activeCheckpoint: NeuralCheckpoint; checkpoints: NeuralCheckpoint[]}> {
  const existing = await idbGetAllCheckpoints();
  const hasCkpt000 = existing.some((c) => c.id === 'ckpt-000');
  const nextId = hasCkpt000 ? allocateNextCheckpointId() : 'ckpt-000';
  const blank = createBlankSlateCheckpoint(
    profileName,
    `profile-${Date.now().toString(36)}`,
    nextId,
  );
  return persistNewNeuralCheckpoint(blank);
}
