import type {
  ComputeEngineStatus,
  ContradictionAlert,
  DiffLine,
  KnowledgeEntry,
  KnowledgeFolder,
  RepoFile,
  ResourceProfile,
  RetrievalMatch,
} from '../types/mantis';
import {
  detectContradictionsCore,
  profileResourcesCore,
  rerankHybridWithGpuScores,
  runHybridSearchCore,
  type WorkerRequest,
  type WorkerResponse,
} from './computeWorker';
import {computeLineDiff} from './diff';
import {probeWebGpuHardware, webGpuBatchCosine} from './gpuCompute';
import {
  EMBEDDING_DIMS,
  encodeDenseVector384,
  loadCachedVectors,
  upsertCachedVectors,
  type QuantizedVectorRecord,
} from './vectorStore';

let workerInstance: Worker | null = null;
let workerFailed = false;
let vectorMapCache: Map<string, QuantizedVectorRecord> | null = null;
const workerSyncedHashes = new Map<string, string>();
const pendingCallbacks = new Map<
  string,
  {resolve: (res: WorkerResponse) => void; reject: (err: Error) => void; timer: number}
>();

let currentComputeStatus: ComputeEngineStatus = {
  backend: typeof Worker !== 'undefined' ? 'worker-wasm' : 'main-thread',
  adapterLabel: 'Initializing Compute…',
  workerActive: false,
  indexedVectorsCount: 0,
  vectorBytesUsed: 0,
  float32BytesSaved: 0,
  lastComputeMs: null,
};

const listeners = new Set<(status: ComputeEngineStatus) => void>();

function notifyStatus(patch: Partial<ComputeEngineStatus>) {
  currentComputeStatus = {...currentComputeStatus, ...patch};
  for (const fn of listeners) fn(currentComputeStatus);
}

export function getComputeStatus(): ComputeEngineStatus {
  return currentComputeStatus;
}

export function subscribeComputeStatus(fn: (status: ComputeEngineStatus) => void): () => void {
  listeners.add(fn);
  fn(currentComputeStatus);
  return () => {
    listeners.delete(fn);
  };
}

export async function initComputeEngine(): Promise<ComputeEngineStatus> {
  const [gpu, vectors] = await Promise.all([
    probeWebGpuHardware(),
    vectorMapCache ? Promise.resolve(vectorMapCache) : loadCachedVectors(),
  ]);
  vectorMapCache = vectors;
  const count = vectors.size;
  const int8Bytes = count * EMBEDDING_DIMS;
  const float32Bytes = count * EMBEDDING_DIMS * 4;
  notifyStatus({
    backend: gpu.backend,
    adapterLabel: gpu.adapterLabel,
    workerActive: typeof Worker !== 'undefined' && !workerFailed,
    indexedVectorsCount: count,
    vectorBytesUsed: int8Bytes,
    float32BytesSaved: Math.max(0, float32Bytes - int8Bytes),
  });
  return currentComputeStatus;
}

function getOrCreateWorker(): Worker | null {
  if (workerFailed || typeof Worker === 'undefined') return null;
  if (workerInstance) return workerInstance;
  try {
    const worker = new Worker(new URL('./computeWorker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const res = event.data;
      const entry = pendingCallbacks.get(res.id);
      if (!entry) return;
      window.clearTimeout(entry.timer);
      pendingCallbacks.delete(res.id);
      entry.resolve(res);
    };
    worker.onerror = () => {
      workerFailed = true;
      workerInstance = null;
      workerSyncedHashes.clear();
      notifyStatus({workerActive: false});
      for (const [, cb] of pendingCallbacks) {
        window.clearTimeout(cb.timer);
        cb.reject(new Error('Compute worker unavailable — switched to fallback'));
      }
      pendingCallbacks.clear();
    };
    workerInstance = worker;
    notifyStatus({workerActive: true});
    return worker;
  } catch {
    workerFailed = true;
    notifyStatus({workerActive: false});
    return null;
  }
}

function dispatchWorker(req: WorkerRequest, timeoutMs = 4500): Promise<WorkerResponse> {
  const worker = getOrCreateWorker();
  if (!worker) {
    return Promise.reject(new Error('Worker unavailable'));
  }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pendingCallbacks.delete(req.id);
      reject(new Error(`Compute worker timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pendingCallbacks.set(req.id, {resolve, reject, timer});
    worker.postMessage(req);
  });
}

export async function runHybridRetrievalAsync(params: {
  query: string;
  entries: KnowledgeEntry[];
  folders: KnowledgeFolder[];
  limit?: number;
  includeRaw?: boolean;
}): Promise<RetrievalMatch[]> {
  const start = performance.now();
  if (!vectorMapCache) {
    vectorMapCache = await loadCachedVectors();
  }

  const limit = params.limit ?? 5;
  const includeRaw = params.includeRaw ?? false;
  const reqId = `hs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const activeEntryIds = new Set(params.entries.map((e) => e.id));
  const pruneIds: string[] = [];
  for (const cachedId of workerSyncedHashes.keys()) {
    if (!activeEntryIds.has(cachedId)) {
      pruneIds.push(cachedId);
      workerSyncedHashes.delete(cachedId);
    }
  }
  const vectorDeltas: QuantizedVectorRecord[] = [];
  for (const [id, rec] of vectorMapCache.entries()) {
    if (workerSyncedHashes.get(id) !== rec.contentHash) {
      vectorDeltas.push(rec);
    }
  }

  const wantsGpu =
    currentComputeStatus.backend.startsWith('webgpu') && params.entries.length >= 64;

  let result: {matches: RetrievalMatch[]; newVectors: QuantizedVectorRecord[]};
  try {
    const res = await dispatchWorker({
      id: reqId,
      type: 'HYBRID_SEARCH',
      payload: {
        query: params.query,
        entries: params.entries,
        folders: params.folders,
        vectorDeltas,
        pruneIds,
        includeMatrixForGpu: wantsGpu,
        limit,
        includeRaw,
      },
    });
    if (res.ok && res.type === 'HYBRID_SEARCH') {
      for (const delta of vectorDeltas) {
        workerSyncedHashes.set(delta.id, delta.contentHash);
      }
      for (const rec of res.newVectors) {
        workerSyncedHashes.set(rec.id, rec.contentHash);
      }
      let finalMatches = res.matches;
      if (res.matrixBuffer && res.usedEntryIds.length >= 64) {
        const qVec = encodeDenseVector384(params.query);
        const gpuScores = await webGpuBatchCosine(
          qVec,
          res.matrixBuffer,
          res.usedEntryIds.length,
          EMBEDDING_DIMS,
        );
        if (gpuScores) {
          finalMatches = rerankHybridWithGpuScores(
            res.candidatePool && res.candidatePool.length > 0 ? res.candidatePool : res.matches,
            gpuScores,
            res.usedEntryIds,
            limit,
          );
        }
      }
      result = {matches: finalMatches, newVectors: res.newVectors};
    } else {
      throw new Error('Fallback');
    }
  } catch {
    const core = runHybridSearchCore({
      query: params.query,
      entries: params.entries,
      folders: params.folders,
      cachedVectors: vectorMapCache,
      limit,
      includeRaw,
      includeMatrixForGpu: wantsGpu,
    });
    let finalMatches = core.matches;
    // Optional WebGPU compute pass boost on large corpora (>=64 notes)
    if (wantsGpu && core.usedEntryIds.length >= 64) {
      const qVec = encodeDenseVector384(params.query);
      const gpuScores = await webGpuBatchCosine(
        qVec,
        core.matrixBuffer,
        core.usedEntryIds.length,
        EMBEDDING_DIMS,
      );
      if (gpuScores) {
        finalMatches = rerankHybridWithGpuScores(
          core.candidatePool.length > 0 ? core.candidatePool : core.matches,
          gpuScores,
          core.usedEntryIds,
          limit,
        );
      }
    }
    result = {matches: finalMatches, newVectors: core.newVectors};
  }

  if (result.newVectors.length > 0) {
    for (const r of result.newVectors) {
      vectorMapCache.set(r.id, r);
    }
    void upsertCachedVectors(result.newVectors);
  }

  const elapsed = Math.round((performance.now() - start) * 10) / 10;
  const count = vectorMapCache.size;
  notifyStatus({
    indexedVectorsCount: count,
    vectorBytesUsed: count * EMBEDDING_DIMS,
    float32BytesSaved: Math.max(0, count * EMBEDDING_DIMS * 3),
    lastComputeMs: elapsed,
  });

  return result.matches;
}

export async function detectContradictionsAsync(params: {
  candidateTitle: string;
  candidateContent: string;
  newEntryId?: string;
  excludeEntryId?: string;
  entries: KnowledgeEntry[];
  folders: KnowledgeFolder[];
}): Promise<ContradictionAlert[]> {
  try {
    const res = await dispatchWorker({
      id: `ct-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'DETECT_CONTRADICTIONS',
      payload: params,
    });
    if (res.ok && res.type === 'DETECT_CONTRADICTIONS') {
      return res.alerts;
    }
  } catch {
    // fallback
  }
  return detectContradictionsCore(params);
}

export async function computeLineDiffAsync(
  original: string,
  proposed: string,
): Promise<DiffLine[]> {
  try {
    const res = await dispatchWorker({
      id: `df-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'COMPUTE_DIFF',
      payload: {original, proposed},
    });
    if (res.ok && res.type === 'COMPUTE_DIFF') {
      return res.diffLines;
    }
  } catch {
    // fallback
  }
  return computeLineDiff(original, proposed);
}

export async function profileWorkspaceResourcesAsync(params: {
  entries: KnowledgeEntry[];
  repoFiles: RepoFile[];
  messagesCountBytes: number;
}): Promise<ResourceProfile> {
  if (!vectorMapCache) {
    vectorMapCache = await loadCachedVectors();
  }
  const perfMem = (
    performance as unknown as {
      memory?: {usedJSHeapSize?: number; jsHeapSizeLimit?: number};
    }
  ).memory;

  const payload = {
    entries: params.entries,
    repoFiles: params.repoFiles,
    messagesBytes: params.messagesCountBytes,
    vectorCount: vectorMapCache.size,
    jsHeapUsedBytes: perfMem?.usedJSHeapSize ?? null,
    jsHeapLimitBytes: perfMem?.jsHeapSizeLimit ?? null,
  };

  try {
    const res = await dispatchWorker({
      id: `pr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'PROFILE_RESOURCES',
      payload,
    });
    if (res.ok && res.type === 'PROFILE_RESOURCES') {
      return res.profile;
    }
  } catch {
    // fallback
  }
  return profileResourcesCore(payload);
}
