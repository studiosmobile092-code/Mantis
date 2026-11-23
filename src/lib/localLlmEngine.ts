import type {
  HardwareTelemetry,
  KnowledgeFolder,
  LocalLlmAdapterSpec,
  LocalLlmEngineState,
  LocalLlmModelSpec,
  NeuralCheckpoint,
  NeuralPredictResult,
  RetrievalMatch,
  ScratchSkillRule,
} from '../types/mantis';
import {probeHardwareCapabilities} from './gpuCompute';

const SELECTED_MODEL_STORAGE_KEY = 'mantis_local_llm_selected_v1';

export const LOCAL_LLM_CATALOG: LocalLlmModelSpec[] = [
  // Tier 1: Lightweight 8 GB Tablet / Chromebook Safe
  {
    id: 'smollm2-135m-q4',
    label: 'SmolLM2-135M Instruct (Q4)',
    shortLabel: 'SmolLM2-135M',
    hfRepoId: 'onnx-community/SmolLM2-135M-Instruct-ONNX',
    tier: 'lightweight-8gb',
    dtype: 'q4',
    estimatedRamMb: 280,
    minRecommendedRamGb: 4,
    contextWindow: 2048,
    capabilities: 'Ultra-fast on-device drafting & grounded memory phrasing (~280 MB RAM)',
    safety8Gb: 'safe',
    colabBaseModel: 'HuggingFaceTB/SmolLM2-135M-Instruct',
  },
  {
    id: 'smollm2-360m-q4',
    label: 'SmolLM2-360M Instruct (Q4)',
    shortLabel: 'SmolLM2-360M',
    hfRepoId: 'onnx-community/SmolLM2-360M-Instruct-ONNX',
    tier: 'lightweight-8gb',
    dtype: 'q4',
    estimatedRamMb: 540,
    minRecommendedRamGb: 6,
    contextWindow: 2048,
    capabilities: 'Balanced 8 GB tablet & Chromebook instruction following (~540 MB RAM)',
    safety8Gb: 'safe',
    colabBaseModel: 'HuggingFaceTB/SmolLM2-360M-Instruct',
  },
  {
    id: 'qwen2.5-0.5b-q4',
    label: 'Qwen2.5-0.5B Instruct (Q4)',
    shortLabel: 'Qwen2.5-0.5B',
    hfRepoId: 'onnx-community/Qwen2.5-0.5B-Instruct',
    tier: 'lightweight-8gb',
    dtype: 'q4',
    estimatedRamMb: 820,
    minRecommendedRamGb: 8,
    contextWindow: 4096,
    capabilities: 'Strong structured recall & concise code reasoning under 1 GB (~820 MB)',
    safety8Gb: 'safe',
    colabBaseModel: 'unsloth/Qwen2.5-0.5B-Instruct',
  },
  // Tier 2: Complex / High-Capacity Local Models (Higher RAM / Desktop / Workstation)
  {
    id: 'llama-3.2-1b-q4',
    label: 'Llama-3.2-1B Instruct (Q4)',
    shortLabel: 'Llama-3.2-1B',
    hfRepoId: 'onnx-community/Llama-3.2-1B-Instruct',
    tier: 'complex-high-ram',
    dtype: 'q4',
    estimatedRamMb: 1350,
    minRecommendedRamGb: 8,
    contextWindow: 4096,
    capabilities: 'Higher-capacity instruction synthesis; monitor heap on 8 GB tablets (~1.35 GB)',
    safety8Gb: 'caution',
    colabBaseModel: 'unsloth/Llama-3.2-1B-Instruct',
  },
  {
    id: 'qwen2.5-coder-1.5b-q4',
    label: 'Qwen2.5-Coder-1.5B Instruct (Q4)',
    shortLabel: 'QwenCoder-1.5B',
    hfRepoId: 'onnx-community/Qwen2.5-Coder-1.5B-Instruct',
    tier: 'complex-high-ram',
    dtype: 'q4',
    estimatedRamMb: 1650,
    minRecommendedRamGb: 12,
    contextWindow: 8192,
    capabilities: 'Deep local code generation, diff reasoning & technical synthesis (~1.65 GB)',
    safety8Gb: 'high-ram',
    colabBaseModel: 'unsloth/Qwen2.5-Coder-1.5B-Instruct',
  },
  {
    id: 'qwen2.5-3b-q4',
    label: 'Qwen2.5-3B Instruct (Q4)',
    shortLabel: 'Qwen2.5-3B',
    hfRepoId: 'onnx-community/Qwen2.5-3B-Instruct',
    tier: 'complex-high-ram',
    dtype: 'q4',
    estimatedRamMb: 2700,
    minRecommendedRamGb: 16,
    contextWindow: 8192,
    capabilities: 'Complex multi-step reasoning & self-teaching local flagship (16 GB+ recommended)',
    safety8Gb: 'high-ram',
    colabBaseModel: 'unsloth/Qwen2.5-3B-Instruct',
  },
];

export function getLocalLlmSpec(modelId: string): LocalLlmModelSpec {
  return (
    LOCAL_LLM_CATALOG.find((m) => m.id === modelId) ||
    LOCAL_LLM_CATALOG[1] // Default to SmolLM2-360M Q4 (balanced 8 GB safe)
  );
}

function readStoredSelectedModelId(): string {
  try {
    const raw =
      typeof window !== 'undefined' ? window.localStorage.getItem(SELECTED_MODEL_STORAGE_KEY) : null;
    if (raw && LOCAL_LLM_CATALOG.some((m) => m.id === raw)) return raw;
  } catch {
    // ignore storage failures
  }
  return 'smollm2-360m-q4';
}

function writeStoredSelectedModelId(modelId: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, modelId);
    }
  } catch {
    // ignore storage failures
  }
}

export function evaluateModelMemorySafety(
  spec: LocalLlmModelSpec,
  hardware: HardwareTelemetry | null,
  allowHighRamOverride = false,
): {
  allowed: boolean;
  severity: 'ok' | 'caution' | 'danger';
  reason: string;
} {
  const ramGb = hardware?.deviceMemoryGb ?? null;
  const heapUsed = hardware?.jsHeapUsedMb ?? null;
  const heapLimit = hardware?.jsHeapLimitMb ?? null;

  if (heapUsed !== null && heapLimit !== null && heapUsed > heapLimit * 0.8) {
    return {
      allowed: allowHighRamOverride,
      severity: 'danger',
      reason: `High browser JS heap usage (${heapUsed}/${heapLimit} MB). Unload weights or close heavy tabs before loading ${spec.shortLabel}.`,
    };
  }

  if (ramGb !== null && ramGb <= 4 && spec.estimatedRamMb > 450) {
    return {
      allowed: allowHighRamOverride,
      severity: 'danger',
      reason: `Device reports ~${ramGb} GB RAM; ${spec.shortLabel} (~${spec.estimatedRamMb} MB) risks an Android/Chrome tab reload.`,
    };
  }

  if (ramGb !== null && ramGb <= 8 && spec.safety8Gb === 'high-ram') {
    return {
      allowed: allowHighRamOverride,
      severity: 'danger',
      reason: `${spec.shortLabel} (~${(spec.estimatedRamMb / 1024).toFixed(1)} GB) exceeds the safe 8 GB tablet browser budget (${spec.minRecommendedRamGb} GB+ recommended). Override manually only if hardware has free swap/VRAM.`,
    };
  }

  if (spec.safety8Gb === 'caution' && ramGb !== null && ramGb <= 8) {
    return {
      allowed: true,
      severity: 'caution',
      reason: `${spec.shortLabel} (~${(spec.estimatedRamMb / 1024).toFixed(2)} GB) fits near the upper 8 GB browser limit. Auto-unload will protect OCR & Screen Capture tasks.`,
    };
  }

  if (hardware && !hardware.webGpuSupported && spec.estimatedRamMb > 900) {
    return {
      allowed: allowHighRamOverride,
      severity: 'caution',
      reason: `WebGPU unavailable — running ${spec.shortLabel} on CPU/WASM fallback will generate slowly.`,
    };
  }

  return {
    allowed: true,
    severity: 'ok',
    reason: `Memory guard passed (~${spec.estimatedRamMb} MB est. · ${hardware?.webGpuSupported ? 'WebGPU' : 'WASM'}).`,
  };
}

interface LoadedRuntimeHandle {
  modelId: string;
  spec: LocalLlmModelSpec;
  device: 'webgpu' | 'wasm';
  dtype: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tokenizer: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transformersModule: any;
}

let activeRuntime: LoadedRuntimeHandle | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activeStopCriteria: any = null;
let loadSessionCounter = 0;
let cachedHardware: HardwareTelemetry | null = null;

let currentState: LocalLlmEngineState = {
  status: 'idle',
  selectedModelId: readStoredSelectedModelId(),
  loadedModelId: null,
  activeDevice: null,
  activeDtype: null,
  loadProgressPercent: 0,
  loadStatusText: 'Not loaded (0 MB model RAM used)',
  downloadedBytes: 0,
  totalBytes: 0,
  lastTokensPerSec: null,
  lastGeneratedTokens: 0,
  error: null,
  memoryPressureWarning: null,
  isGenerating: false,
};

const stateListeners = new Set<(state: LocalLlmEngineState) => void>();

function updateState(patch: Partial<LocalLlmEngineState>) {
  currentState = {...currentState, ...patch};
  for (const listener of stateListeners) {
    listener(currentState);
  }
}

export function getLocalLlmState(): LocalLlmEngineState {
  return currentState;
}

export function subscribeLocalLlmState(
  listener: (state: LocalLlmEngineState) => void,
): () => void {
  stateListeners.add(listener);
  listener(currentState);
  return () => {
    stateListeners.delete(listener);
  };
}

export function selectLocalLlmModel(modelId: string): void {
  const spec = getLocalLlmSpec(modelId);
  writeStoredSelectedModelId(spec.id);
  const safety = evaluateModelMemorySafety(spec, cachedHardware, false);
  updateState({
    selectedModelId: spec.id,
    memoryPressureWarning: safety.severity === 'ok' ? null : safety.reason,
  });
}

export async function refreshHardwareTelemetry(): Promise<HardwareTelemetry> {
  const hw = await probeHardwareCapabilities();
  cachedHardware = hw;
  const spec = getLocalLlmSpec(currentState.selectedModelId);
  const safety = evaluateModelMemorySafety(spec, hw, false);
  updateState({
    memoryPressureWarning: safety.severity === 'ok' ? null : safety.reason,
  });
  return hw;
}

export function cancelLocalLlmLoad(): void {
  loadSessionCounter += 1;
  if (currentState.status === 'downloading' || currentState.status === 'loading' || currentState.status === 'probing') {
    updateState({
      status: activeRuntime ? 'ready' : 'idle',
      loadProgressPercent: activeRuntime ? 100 : 0,
      loadStatusText: activeRuntime
        ? `Ready (${activeRuntime.spec.shortLabel})`
        : 'Download cancelled',
      error: null,
    });
  }
}

async function disposeActiveRuntime(): Promise<void> {
  if (!activeRuntime) return;
  const target = activeRuntime;
  activeRuntime = null;
  try {
    if (typeof target.model?.dispose === 'function') {
      await target.model.dispose();
    }
  } catch {
    // ignore WebGPU disposal edge errors
  }
}

export async function unloadLocalLlmModel(reason?: string): Promise<void> {
  loadSessionCounter += 1;
  stopLocalLlmGeneration();
  updateState({
    status: 'unloading',
    loadStatusText: reason || 'Releasing model weights from GPU/RAM…',
  });
  await disposeActiveRuntime();
  updateState({
    status: 'idle',
    loadedModelId: null,
    activeDevice: null,
    activeDtype: null,
    loadProgressPercent: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    isGenerating: false,
    error: null,
    loadStatusText: reason ? `${reason} — 0 MB weights loaded` : 'Unloaded (0 MB weights active)',
  });
}

export async function autoUnloadBeforeHeavyTask(taskLabel: string): Promise<boolean> {
  if (!activeRuntime) return false;
  const hw = cachedHardware || (await refreshHardwareTelemetry());
  const isConstrainedDevice = (hw.deviceMemoryGb ?? 8) <= 8;
  if (isConstrainedDevice && activeRuntime.spec.estimatedRamMb >= 500) {
    await unloadLocalLlmModel(`Auto-unloaded ${activeRuntime.spec.shortLabel} to protect ${taskLabel} RAM`);
    return true;
  }
  return false;
}

export async function clearLocalLlmBrowserCache(): Promise<boolean> {
  await unloadLocalLlmModel('Cleared cached weights');
  try {
    if (typeof caches !== 'undefined') {
      await caches.delete('transformers-cache');
      return true;
    }
  } catch {
    // ignore private browsing cache restrictions
  }
  return false;
}

export async function loadLocalLlmModel(
  modelId?: string,
  options?: {allowHighRamOverride?: boolean},
): Promise<LocalLlmEngineState> {
  const targetId = modelId || currentState.selectedModelId;
  const spec = getLocalLlmSpec(targetId);
  writeStoredSelectedModelId(spec.id);

  if (activeRuntime && activeRuntime.modelId === spec.id && currentState.status === 'ready') {
    return currentState;
  }

  const runId = ++loadSessionCounter;
  updateState({
    status: 'probing',
    selectedModelId: spec.id,
    loadProgressPercent: 2,
    downloadedBytes: 0,
    totalBytes: 0,
    error: null,
    loadStatusText: `Probing WebGPU & RAM headroom for ${spec.shortLabel}…`,
  });

  const hw = await refreshHardwareTelemetry();
  if (runId !== loadSessionCounter) return currentState;

  const safety = evaluateModelMemorySafety(spec, hw, Boolean(options?.allowHighRamOverride));
  if (!safety.allowed) {
    updateState({
      status: 'error',
      error: safety.reason,
      memoryPressureWarning: safety.reason,
      loadProgressPercent: 0,
      loadStatusText: 'Blocked by 8 GB Memory Guard',
    });
    return currentState;
  }

  // Unload prior weights first so peak VRAM never doubles on swaps
  await disposeActiveRuntime();
  if (runId !== loadSessionCounter) return currentState;

  try {
    const tf = await import('@huggingface/transformers');
    if (runId !== loadSessionCounter) return currentState;

    tf.env.allowLocalModels = false;
    tf.env.useBrowserCache = true;

    const preferredDevice: 'webgpu' | 'wasm' = hw.webGpuSupported ? 'webgpu' : 'wasm';
    const preferredDtype =
      preferredDevice === 'webgpu' && hw.webGpuF16Supported && spec.dtype === 'q4'
        ? 'q4f16'
        : spec.dtype;

    updateState({
      status: 'downloading',
      loadProgressPercent: 5,
      loadStatusText: `Downloading tokenizer (${spec.shortLabel})…`,
    });

    const onProgress = (info: {
      status?: string;
      file?: string;
      progress?: number;
      loaded?: number;
      total?: number;
    }) => {
      if (runId !== loadSessionCounter) return;
      if (info.status === 'progress_total' || info.status === 'progress') {
        const pct =
          typeof info.progress === 'number' && Number.isFinite(info.progress)
            ? Math.max(5, Math.min(97, Math.round(info.progress)))
            : currentState.loadProgressPercent;
        const shortFile = info.file ? info.file.split('/').pop() : 'weights';
        updateState({
          status: 'downloading',
          loadProgressPercent: pct,
          downloadedBytes: typeof info.loaded === 'number' ? info.loaded : currentState.downloadedBytes,
          totalBytes: typeof info.total === 'number' ? info.total : currentState.totalBytes,
          loadStatusText: `Downloading ${shortFile} (${pct}%)…`,
        });
      } else if (info.status === 'initiate' || info.status === 'download') {
        const shortFile = info.file ? info.file.split('/').pop() : 'shard';
        updateState({
          status: 'downloading',
          loadStatusText: `Fetching ${shortFile}…`,
        });
      }
    };

    const tokenizer = await tf.AutoTokenizer.from_pretrained(spec.hfRepoId, {
      progress_callback: onProgress,
    });
    if (runId !== loadSessionCounter) return currentState;

    updateState({
      status: 'loading',
      loadStatusText: `Compiling ${spec.shortLabel} on ${preferredDevice.toUpperCase()} (${preferredDtype})…`,
    });

    let activeDevice: 'webgpu' | 'wasm' = preferredDevice;
    let activeDtype = preferredDtype;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let model: any;

    try {
      model = await tf.AutoModelForCausalLM.from_pretrained(spec.hfRepoId, {
        dtype: preferredDtype,
        device: preferredDevice,
        progress_callback: onProgress,
      });
    } catch (primaryErr) {
      if (runId !== loadSessionCounter) return currentState;
      if (preferredDevice === 'webgpu') {
        activeDevice = 'wasm';
        activeDtype = spec.dtype === 'q4f16' ? 'q4' : spec.dtype;
        updateState({
          status: 'loading',
          loadStatusText: `WebGPU init failed — switching ${spec.shortLabel} to WASM (${activeDtype})…`,
          memoryPressureWarning:
            primaryErr instanceof Error ? primaryErr.message : 'WebGPU fallback to WASM',
        });
        model = await tf.AutoModelForCausalLM.from_pretrained(spec.hfRepoId, {
          dtype: activeDtype as 'q4' | 'q8' | 'fp16',
          device: 'wasm',
          progress_callback: onProgress,
        });
      } else {
        throw primaryErr;
      }
    }

    if (runId !== loadSessionCounter) {
      if (typeof model?.dispose === 'function') {
        await model.dispose().catch(() => undefined);
      }
      return currentState;
    }

    activeRuntime = {
      modelId: spec.id,
      spec,
      device: activeDevice,
      dtype: activeDtype,
      tokenizer,
      model,
      transformersModule: tf,
    };

    updateState({
      status: 'ready',
      loadedModelId: spec.id,
      activeDevice,
      activeDtype,
      loadProgressPercent: 100,
      error: null,
      loadStatusText: `Ready · ${spec.shortLabel} (${activeDevice.toUpperCase()} · ${activeDtype})`,
    });
    return currentState;
  } catch (err) {
    if (runId !== loadSessionCounter) return currentState;
    const msg = err instanceof Error ? err.message : 'Failed to initialize local Q4 model weights';
    await disposeActiveRuntime();
    updateState({
      status: 'error',
      loadedModelId: null,
      activeDevice: null,
      activeDtype: null,
      loadProgressPercent: 0,
      error: msg,
      loadStatusText: `Load error: ${msg.slice(0, 90)}`,
    });
    return currentState;
  }
}

export function stopLocalLlmGeneration(): void {
  try {
    if (activeStopCriteria && typeof activeStopCriteria.interrupt === 'function') {
      activeStopCriteria.interrupt();
    }
  } catch {
    // ignore
  }
}

export function buildAdapterConditionedMessages(params: {
  prompt: string;
  checkpoint: NeuralCheckpoint;
  hybridMatches: RetrievalMatch[];
  folders: KnowledgeFolder[];
  skills: ScratchSkillRule[];
  neuralPrediction?: NeuralPredictResult;
  modelId?: string;
}): {
  messages: Array<{role: 'system' | 'user'; content: string}>;
  adapterSpec: LocalLlmAdapterSpec;
} {
  const spec = getLocalLlmSpec(params.modelId || currentState.selectedModelId);
  const biasTerms: string[] = [];

  if (params.neuralPrediction && !params.neuralPrediction.isUntrained) {
    for (const tok of params.neuralPrediction.topTokens.slice(0, 6)) {
      if (!biasTerms.includes(tok.token)) biasTerms.push(tok.token);
    }
  }

  const matchedMemoryLines = params.hybridMatches.slice(0, 4).map((m, idx) => {
    const body =
      m.entry.content.length > 360
        ? `${m.entry.content.slice(0, 360).trim()}...`
        : m.entry.content.trim();
    return `[Memory ${idx + 1} · ${m.folderName} · ${m.entry.status || 'reviewed'}] ${m.entry.title}: ${body}`;
  });

  const neuralHints: string[] = [];
  if (
    params.neuralPrediction &&
    !params.neuralPrediction.isUntrained &&
    params.neuralPrediction.confidence >= 0.35
  ) {
    neuralHints.push(
      `Student Neural Core (${params.checkpoint.id}, conf ${params.neuralPrediction.confidence.toFixed(2)}): "${params.neuralPrediction.replyText.slice(0, 260)}"`,
    );
  }

  const topTargets = params.checkpoint.targets.slice(0, 5).map((t) => {
    biasTerms.push(t.promptPattern.slice(0, 32));
    return `- "${t.promptPattern}" -> "${t.responseText.slice(0, 140)}"`;
  });

  const topSkills = params.skills.slice(0, 4).map(
    (s) => `- [${s.folderName}] ${s.triggers.slice(0, 2).join(', ')} => ${s.responses[0]?.slice(0, 120) || ''}`,
  );

  const systemParts = [
    `You are ${params.checkpoint.profileName} (${params.checkpoint.id}, ${params.checkpoint.metrics.stepCount} trained steps, ${params.checkpoint.metrics.vocabSize} BPE tokens) running strictly offline on ${spec.label}.`,
    'Adhere strictly to the operator Knowledge Rules and Student Neural Adapter context below. Do not invent APIs, credentials, or facts not supported by context or verified reasoning. Be concise and direct.',
    matchedMemoryLines.length > 0
      ? `Verified Workspace Memories:\n${matchedMemoryLines.join('\n')}`
      : 'Verified Workspace Memories: None matched this query.',
  ];

  if (neuralHints.length > 0) {
    systemParts.push(`Trained Neural Core Signal:\n${neuralHints.join('\n')}`);
  }
  if (topTargets.length > 0) {
    systemParts.push(`Student Checkpoint Adapter Targets:\n${topTargets.join('\n')}`);
  }
  if (topSkills.length > 0) {
    systemParts.push(`Active Taught Skills:\n${topSkills.join('\n')}`);
  }

  const systemPrompt = systemParts.join('\n\n');

  const adapterSpec: LocalLlmAdapterSpec = {
    checkpointId: params.checkpoint.id,
    profileName: params.checkpoint.profileName,
    modelId: spec.id,
    colabBaseModel: spec.colabBaseModel,
    stepCount: params.checkpoint.metrics.stepCount,
    vocabSize: params.checkpoint.metrics.vocabSize,
    trustedRulesUsed: matchedMemoryLines.length,
    neuralTargetsInjected: topTargets.length,
    systemPrompt,
    biasTerms: Array.from(new Set(biasTerms)).slice(0, 8),
  };

  return {
    messages: [
      {role: 'system', content: systemPrompt},
      {role: 'user', content: params.prompt.trim()},
    ],
    adapterSpec,
  };
}

export async function generateWithLocalLlmStream(params: {
  messages: Array<{role: 'system' | 'user' | 'assistant'; content: string}>;
  maxNewTokens?: number;
  temperature?: number;
  onToken?: (accumulatedText: string, tokensPerSec: number | null, generatedTokens: number) => void;
}): Promise<{
  text: string;
  generatedTokens: number;
  tokensPerSec: number | null;
  device: 'webgpu' | 'wasm';
  dtype: string;
  modelId: string;
  durationMs: number;
}> {
  if (!activeRuntime) {
    throw new Error('No Local Q4 LLM weights loaded. Load a model in Local Models or Inspector first.');
  }

  const {tokenizer, model, transformersModule, spec, device, dtype} = activeRuntime;
  const maxNewTokens = Math.max(32, Math.min(512, params.maxNewTokens ?? 220));
  const temperature = params.temperature ?? 0.25;

  const stoppingCriteria = new transformersModule.InterruptableStoppingCriteria();
  activeStopCriteria = stoppingCriteria;
  const criteriaList = new transformersModule.StoppingCriteriaList();
  criteriaList.push(stoppingCriteria);

  updateState({isGenerating: true, error: null});

  const startMs = performance.now();
  let accumulated = '';
  let generatedTokens = 0;

  try {
    const inputs = tokenizer.apply_chat_template(params.messages, {
      add_generation_prompt: true,
      return_dict: true,
    });

    const streamer = new transformersModule.TextStreamer(tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      token_callback_function: () => {
        generatedTokens += 1;
      },
      callback_function: (chunk: string) => {
        accumulated += chunk;
        const elapsedSec = Math.max(0.05, (performance.now() - startMs) / 1000);
        const tps =
          generatedTokens > 0 ? Math.round((generatedTokens / elapsedSec) * 10) / 10 : null;
        params.onToken?.(accumulated, tps, generatedTokens);
      },
    });

    const output = await model.generate({
      ...inputs,
      max_new_tokens: maxNewTokens,
      do_sample: temperature > 0.05,
      temperature: temperature > 0.05 ? temperature : undefined,
      top_p: 0.92,
      repetition_penalty: 1.08,
      streamer,
      stopping_criteria: criteriaList,
    });

    if (!accumulated.trim() && output && inputs?.input_ids?.dims) {
      const promptLen = Number(inputs.input_ids.dims[1] || 0);
      const sliced = typeof output.slice === 'function' ? output.slice(null, [promptLen, null]) : output;
      const decoded = tokenizer.batch_decode(sliced, {skip_special_tokens: true});
      accumulated = Array.isArray(decoded) ? String(decoded[0] || '') : String(decoded || '');
    }

    const durationMs = Math.round(performance.now() - startMs);
    const elapsedSec = Math.max(0.05, durationMs / 1000);
    const tokensPerSec =
      generatedTokens > 0
        ? Math.round((generatedTokens / elapsedSec) * 10) / 10
        : accumulated.trim()
          ? Math.round(((accumulated.trim().split(/\s+/).length * 1.3) / elapsedSec) * 10) / 10
          : null;

    updateState({
      isGenerating: false,
      lastTokensPerSec: tokensPerSec,
      lastGeneratedTokens: generatedTokens,
    });

    return {
      text: accumulated.trim(),
      generatedTokens,
      tokensPerSec,
      device,
      dtype,
      modelId: spec.id,
      durationMs,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Local LLM generation failed';
    updateState({isGenerating: false, error: msg});
    throw err;
  } finally {
    if (activeStopCriteria === stoppingCriteria) {
      activeStopCriteria = null;
    }
    updateState({isGenerating: false});
  }
}

export function isLocalLlmReady(): boolean {
  return Boolean(activeRuntime && currentState.status === 'ready');
}

export function pickSafeUnlimitedLocalModelId(hw?: HardwareTelemetry | null): string {
  const ramGb = hw?.deviceMemoryGb ?? null;
  if (ramGb !== null && ramGb <= 4) return 'smollm2-135m-q4';
  if (ramGb !== null && ramGb < 8) return 'smollm2-360m-q4';
  return 'qwen2.5-0.5b-q4';
}

export async function ensureUnlimitedLocalTeacherReady(): Promise<LocalLlmEngineState> {
  if (activeRuntime && currentState.status === 'ready') {
    return currentState;
  }
  const hw = cachedHardware || (await refreshHardwareTelemetry());
  const selectedSpec = getLocalLlmSpec(currentState.selectedModelId);
  const selectedSafety = evaluateModelMemorySafety(selectedSpec, hw, false);
  const targetModelId = selectedSafety.allowed
    ? selectedSpec.id
    : pickSafeUnlimitedLocalModelId(hw);

  const loaded = await loadLocalLlmModel(targetModelId, {allowHighRamOverride: false});
  if (loaded.status !== 'ready' && targetModelId !== 'smollm2-135m-q4') {
    // Ultra-safe second chance for tight tablet memory
    return loadLocalLlmModel('smollm2-135m-q4', {allowHighRamOverride: false});
  }
  return loaded;
}

export async function generateTeacherCompletionWithLocalLlm(params: {
  messages: Array<{role: 'system' | 'user' | 'assistant'; content: string}>;
  maxNewTokens?: number;
  temperature?: number;
  autoLoadIfNeeded?: boolean;
}): Promise<{
  text: string;
  modelUsed: string;
  device: 'webgpu' | 'wasm';
  tokensPerSec: number | null;
  durationMs: number;
}> {
  if (!activeRuntime || currentState.status !== 'ready') {
    if (params.autoLoadIfNeeded === false) {
      throw new Error('Local Q4 weights not loaded in RAM yet.');
    }
    const readyState = await ensureUnlimitedLocalTeacherReady();
    if (readyState.status !== 'ready' || !activeRuntime) {
      throw new Error(
        readyState.error || 'Could not initialize In-Browser Local Q4 model on this device.',
      );
    }
  }

  const res = await generateWithLocalLlmStream({
    messages: params.messages,
    maxNewTokens: params.maxNewTokens ?? 320,
    temperature: params.temperature ?? 0.2,
  });

  if (!res.text.trim()) {
    throw new Error('In-Browser Local Q4 model returned an empty completion.');
  }

  return {
    text: res.text,
    modelUsed: `local-q4/${res.modelId}`,
    device: res.device,
    tokensPerSec: res.tokensPerSec,
    durationMs: res.durationMs,
  };
}
