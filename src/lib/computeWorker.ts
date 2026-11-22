import type {
  ContradictionAlert,
  DiffLine,
  KnowledgeEntry,
  KnowledgeFolder,
  NeuralCheckpoint,
  NeuralPredictResult,
  NeuralTrainingExample,
  RepoFile,
  ResourceProfile,
  ResourceWasteItem,
  RetrievalMatch,
} from '../types/mantis';
import {computeLineDiff} from './diff';
import {getEntryStatus} from './knowledgeSync';
import {tokenizeQuery} from './memory';
import {inferNeuralCore, trainNeuralBatchCore} from './neuralStudent';
import {
  EMBEDDING_DIMS,
  computeContentHash,
  cosineQueryVsInt8,
  dequantizeInt8,
  encodeDenseVector384,
  quantizeInt8,
  type QuantizedVectorRecord,
} from './vectorStore';

export type WorkerRequest =
  | {
      id: string;
      type: 'HYBRID_SEARCH';
      payload: {
        query: string;
        entries: KnowledgeEntry[];
        folders: KnowledgeFolder[];
        vectorDeltas?: QuantizedVectorRecord[];
        pruneIds?: string[];
        cachedVectors?: Array<[string, QuantizedVectorRecord]>;
        includeMatrixForGpu?: boolean;
        limit: number;
        includeRaw: boolean;
      };
    }
  | {
      id: string;
      type: 'DETECT_CONTRADICTIONS';
      payload: {
        candidateTitle: string;
        candidateContent: string;
        newEntryId?: string;
        excludeEntryId?: string;
        entries: KnowledgeEntry[];
        folders: KnowledgeFolder[];
      };
    }
  | {
      id: string;
      type: 'COMPUTE_DIFF';
      payload: {
        original: string;
        proposed: string;
      };
    }
    | {
        id: string;
        type: 'PROFILE_RESOURCES';
        payload: {
          entries: KnowledgeEntry[];
          repoFiles: RepoFile[];
          messagesBytes: number;
          vectorCount: number;
          jsHeapUsedBytes: number | null;
          jsHeapLimitBytes: number | null;
        };
      }
    | {
        id: string;
        type: 'NEURAL_TRAIN_BATCH';
        payload: {
          checkpoint: NeuralCheckpoint;
          examples: NeuralTrainingExample[];
          epochs?: number;
          learningRate?: number;
          label?: string;
          nextCheckpointId?: string;
        };
      }
    | {
        id: string;
        type: 'NEURAL_INFER';
        payload: {
          prompt: string;
          checkpoint: NeuralCheckpoint;
        };
      };

export type WorkerResponse =
  | {
      id: string;
      ok: true;
      type: 'HYBRID_SEARCH';
      matches: RetrievalMatch[];
      candidatePool?: RetrievalMatch[];
      newVectors: QuantizedVectorRecord[];
      matrixBuffer?: Float32Array;
      usedEntryIds: string[];
    }
  | {
      id: string;
      ok: true;
      type: 'DETECT_CONTRADICTIONS';
      alerts: ContradictionAlert[];
    }
  | {
      id: string;
      ok: true;
      type: 'COMPUTE_DIFF';
      diffLines: DiffLine[];
    }
  | {
      id: string;
      ok: true;
      type: 'PROFILE_RESOURCES';
      profile: ResourceProfile;
    }
  | {
      id: string;
      ok: true;
      type: 'NEURAL_TRAIN_BATCH';
      checkpoint: NeuralCheckpoint;
      firstLoss: number;
      lastLoss: number;
      gradNorm: number;
      stepsAdded: number;
    }
  | {
      id: string;
      ok: true;
      type: 'NEURAL_INFER';
      prediction: NeuralPredictResult;
    }
  | {
      id: string;
      ok: false;
      error: string;
    };

export function runHybridSearchCore(payload: {
  query: string;
  entries: KnowledgeEntry[];
  folders: KnowledgeFolder[];
  cachedVectors: Map<string, QuantizedVectorRecord>;
  limit: number;
  includeRaw: boolean;
  includeMatrixForGpu?: boolean;
}): {
  matches: RetrievalMatch[];
  candidatePool: RetrievalMatch[];
  newVectors: QuantizedVectorRecord[];
  matrixBuffer: Float32Array;
  usedEntryIds: string[];
} {
  const {
    query,
    entries,
    folders,
    cachedVectors,
    limit,
    includeRaw,
    includeMatrixForGpu = false,
  } = payload;
  const folderMap = new Map<string, string>(folders.map((f) => [f.id, f.name]));
  const queryClean = query.trim().toLowerCase();
  const tokens = tokenizeQuery(query);
  const queryVec = encodeDenseVector384(query);

  const activeEntries = entries.filter((e) => {
    const status = getEntryStatus(e);
    return status !== 'raw' || includeRaw;
  });

  if (!queryClean || activeEntries.length === 0) {
    return {
      matches: [],
      candidatePool: [],
      newVectors: [],
      matrixBuffer: new Float32Array(0),
      usedEntryIds: [],
    };
  }

  // Document frequency map for genuine BM25 IDF weighting
  const docCount = activeEntries.length;
  const df = new Map<string, number>();
  const entryDocs = activeEntries.map((entry) => {
    const text = `${entry.title} ${entry.tags.join(' ')} ${entry.content}`.toLowerCase();
    const docTokens = tokenizeQuery(text);
    const unique = new Set(docTokens);
    for (const t of unique) {
      df.set(t, (df.get(t) || 0) + 1);
    }
    return {entry, text, docTokens};
  });

  const avgDocLen =
    entryDocs.reduce((sum, d) => sum + Math.max(1, d.docTokens.length), 0) / Math.max(1, docCount);

  const newVectors: QuantizedVectorRecord[] = [];
  const candidates: Array<{
    entry: KnowledgeEntry;
    folderName: string;
    bm25: number;
    vectorCosine: number;
    vec: Float32Array;
    reasons: string[];
  }> = [];

  const shouldBuildMatrix = includeMatrixForGpu && activeEntries.length >= 64;
  const matrixBuffer = shouldBuildMatrix
    ? new Float32Array(activeEntries.length * EMBEDDING_DIMS)
    : new Float32Array(0);
  const usedEntryIds: string[] = [];

  const k1 = 1.4;
  const b = 0.72;

  for (let i = 0; i < entryDocs.length; i += 1) {
    const {entry, text, docTokens} = entryDocs[i];
    const hash = computeContentHash(entry.title, entry.content, entry.tags);
    let vecRecord = cachedVectors.get(entry.id);
    if (!vecRecord || vecRecord.contentHash !== hash) {
      const floatVec = encodeDenseVector384(
        `${entry.title} ${entry.tags.join(' ')} ${entry.content.slice(0, 1200)}`,
      );
      const q = quantizeInt8(floatVec);
      vecRecord = {
        id: entry.id,
        contentHash: hash,
        int8: q.int8,
        scale: q.scale,
        updatedAt: Date.now(),
      };
      newVectors.push(vecRecord);
      cachedVectors.set(entry.id, vecRecord);
    }

    const deq = dequantizeInt8(vecRecord.int8, vecRecord.scale);
    if (shouldBuildMatrix) {
      matrixBuffer.set(deq, i * EMBEDDING_DIMS);
      usedEntryIds.push(entry.id);
    }

    const vectorCosine = cosineQueryVsInt8(queryVec, vecRecord.int8, vecRecord.scale);

    // Compute genuine BM25 score
    let bm25 = 0;
    const reasons: string[] = [];
    const tfMap = new Map<string, number>();
    for (const dt of docTokens) {
      tfMap.set(dt, (tfMap.get(dt) || 0) + 1);
    }

    for (const qTok of tokens) {
      const tf = tfMap.get(qTok) || 0;
      if (tf > 0) {
        const nq = df.get(qTok) || 1;
        const idf = Math.log(1 + (docCount - nq + 0.5) / (nq + 0.5));
        const normLen = Math.max(1, docTokens.length) / Math.max(1, avgDocLen);
        bm25 += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * normLen)));
      }
    }

    if (queryClean.length >= 3 && entry.title.toLowerCase().includes(queryClean)) {
      bm25 += 4.5;
      reasons.push('Exact title match');
    } else if (queryClean.length >= 4 && text.includes(queryClean)) {
      bm25 += 2.2;
      reasons.push('Phrase match');
    }

    if (vectorCosine >= 0.22) {
      reasons.push(`Semantic ${(vectorCosine * 100).toFixed(0)}%`);
    }

    const folderName = (entry.folder_id && folderMap.get(entry.folder_id)) || 'Uncategorized';
    candidates.push({
      entry,
      folderName,
      bm25,
      vectorCosine,
      vec: deq,
      reasons,
    });
  }

  // Stage 1: Reciprocal Rank Fusion (RRF) across BM25 ranking and Dense Vector ranking
  const byBm25 = [...candidates].sort((a, b2) => b2.bm25 - a.bm25);
  const byVec = [...candidates].sort((a, b2) => b2.vectorCosine - a.vectorCosine);

  const bm25Rank = new Map<string, number>();
  const vecRank = new Map<string, number>();
  byBm25.forEach((c, idx) => bm25Rank.set(c.entry.id, idx + 1));
  byVec.forEach((c, idx) => vecRank.set(c.entry.id, idx + 1));

  const rrfK = 28;
  const fused = candidates
    .map((c) => {
      const rBm25 = c.bm25 > 0 ? 1 / (rrfK + (bm25Rank.get(c.entry.id) || 999)) : 0;
      const rVec = c.vectorCosine > 0.14 ? 1 / (rrfK + (vecRank.get(c.entry.id) || 999)) : 0;
      const baseRrf = (rBm25 + rVec) * 100;

      const status = getEntryStatus(c.entry);
      const trustMult = status === 'trusted' ? 1.48 : status === 'reviewed' ? 0.92 : 0.45;
      const confBoost = 1 + Math.min(0.4, Math.max(0, (c.entry.confidence_score || 1) - 1) * 0.08);
      const finalScore = baseRrf * trustMult * confBoost + (c.bm25 > 0 ? c.bm25 * 0.35 : 0);

      if (status === 'trusted' && !c.reasons.includes('Trusted')) {
        c.reasons.unshift('Trusted');
      }

      return {
        ...c,
        rrfScore: baseRrf,
        finalScore,
      };
    })
    .filter((c) => c.bm25 > 0 || c.vectorCosine >= 0.24)
    .sort((a, b2) => b2.finalScore - a.finalScore);

  // Stage 2: Maximal Marginal Relevance (MMR) diversity reranking to avoid redundant chunks
  const selected: typeof fused = [];
  const pool = [...fused.slice(0, Math.max(limit * 4, 16))];
  const lambda = 0.78;

  while (selected.length < limit && pool.length > 0) {
    let bestIdx = 0;
    let bestMmr = -Infinity;

    for (let i = 0; i < pool.length; i += 1) {
      const cand = pool[i];
      let maxSimToSelected = 0;
      for (const chosen of selected) {
        let sim = 0;
        for (let d = 0; d < EMBEDDING_DIMS; d += 1) {
          sim += cand.vec[d] * chosen.vec[d];
        }
        if (sim > maxSimToSelected) maxSimToSelected = sim;
      }
      const mmr = lambda * cand.finalScore - (1 - lambda) * maxSimToSelected * 10;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }

    selected.push(pool.splice(bestIdx, 1)[0]);
  }

  const toMatch = (s: (typeof fused)[number]): RetrievalMatch => ({
    entry: s.entry,
    folderName: s.folderName,
    score: Math.round(s.finalScore * 100) / 100,
    reasons: s.reasons.slice(0, 3),
    bm25Score: Math.round(s.bm25 * 100) / 100,
    vectorScore: Math.round(s.vectorCosine * 100) / 100,
    rrfScore: Math.round(s.rrfScore * 100) / 100,
  });

  return {
    matches: selected.map(toMatch),
    candidatePool: shouldBuildMatrix ? fused.slice(0, Math.max(limit * 4, 24)).map(toMatch) : [],
    newVectors,
    matrixBuffer,
    usedEntryIds,
  };
}

/**
 * Re-ranks hybrid search candidate pool using real WebGPU batch cosine scores
 * BEFORE truncating down to `limit`, so GPU similarity genuinely affects ranking.
 */
export function rerankHybridWithGpuScores(
  pool: RetrievalMatch[],
  gpuScores: Float32Array,
  usedEntryIds: string[],
  limit: number,
): RetrievalMatch[] {
  if (pool.length === 0 || gpuScores.length === 0 || usedEntryIds.length === 0) {
    return pool.slice(0, limit);
  }
  const gpuScoreMap = new Map<string, number>();
  for (let i = 0; i < usedEntryIds.length; i += 1) {
    gpuScoreMap.set(usedEntryIds[i], gpuScores[i]);
  }

  const enriched = pool.map((m) => {
    const gpuSim = gpuScoreMap.get(m.entry.id);
    const vectorCosine = typeof gpuSim === 'number' && Number.isFinite(gpuSim)
      ? gpuSim
      : (m.vectorScore ?? 0);
    return {
      match: m,
      bm25: m.bm25Score ?? 0,
      vectorCosine,
    };
  });

  const byBm25 = [...enriched].sort((a, b) => b.bm25 - a.bm25);
  const byVec = [...enriched].sort((a, b) => b.vectorCosine - a.vectorCosine);
  const bm25Rank = new Map<string, number>();
  const vecRank = new Map<string, number>();
  byBm25.forEach((c, idx) => bm25Rank.set(c.match.entry.id, idx + 1));
  byVec.forEach((c, idx) => vecRank.set(c.match.entry.id, idx + 1));

  const rrfK = 28;
  return enriched
    .map((c) => {
      const rBm25 = c.bm25 > 0 ? 1 / (rrfK + (bm25Rank.get(c.match.entry.id) || 999)) : 0;
      const rVec = c.vectorCosine > 0.14 ? 1 / (rrfK + (vecRank.get(c.match.entry.id) || 999)) : 0;
      const baseRrf = (rBm25 + rVec) * 100;
      const status = getEntryStatus(c.match.entry);
      const trustMult = status === 'trusted' ? 1.48 : status === 'reviewed' ? 0.92 : 0.45;
      const confBoost =
        1 + Math.min(0.4, Math.max(0, (c.match.entry.confidence_score || 1) - 1) * 0.08);
      const finalScore = baseRrf * trustMult * confBoost + (c.bm25 > 0 ? c.bm25 * 0.35 : 0);

      return {
        ...c.match,
        score: Math.round(finalScore * 100) / 100,
        vectorScore: Math.round(c.vectorCosine * 100) / 100,
        rrfScore: Math.round(baseRrf * 100) / 100,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function classifyRulePolarity(text: string): {hasNeg: boolean; hasPos: boolean} {
  const lower = text.toLowerCase();
  const hasNeg = /\b(never|do not|don't|avoid|disable|must not|prohibit|deprecated)\b/i.test(lower);
  const strippedNegations = lower.replace(
    /\b(never|do not|don't|avoid|disable|must not|prohibit)\s+[a-z0-9_.\-/]*\b/gi,
    ' ',
  );
  const hasPos = /\b(always|must|prefer|enable|require|use|recommend)\b/i.test(strippedNegations);
  return {hasNeg, hasPos};
}

export function detectContradictionsCore(payload: {
  candidateTitle: string;
  candidateContent: string;
  newEntryId?: string;
  excludeEntryId?: string;
  entries: KnowledgeEntry[];
  folders: KnowledgeFolder[];
}): ContradictionAlert[] {
  const {candidateTitle, candidateContent, newEntryId, excludeEntryId, entries, folders} = payload;
  const folderMap = new Map(folders.map((f) => [f.id, f.name]));
  const alerts: ContradictionAlert[] = [];

  const candCombined = `${candidateTitle} ${candidateContent}`.toLowerCase();
  const candTokens = new Set(tokenizeQuery(candCombined));
  const candPol = classifyRulePolarity(candCombined);

  if (!candPol.hasNeg && !candPol.hasPos) return alerts;

  for (const existing of entries) {
    if (excludeEntryId && existing.id === excludeEntryId) continue;
    const status = getEntryStatus(existing);
    if (status !== 'trusted' && status !== 'reviewed') continue;

    const exCombined = `${existing.title} ${existing.content}`.toLowerCase();
    const exTokens = tokenizeQuery(exCombined);
    const shared = exTokens.filter((t) => candTokens.has(t));
    if (shared.length < 2) continue;

    const exPol = classifyRulePolarity(exCombined);

    if ((candPol.hasNeg && exPol.hasPos && !exPol.hasNeg) || (candPol.hasPos && exPol.hasNeg && !exPol.hasPos)) {
      alerts.push({
        newEntryId,
        newTitle: candidateTitle,
        newContent: candidateContent.slice(0, 260),
        existingEntryId: existing.id,
        existingTitle: existing.title,
        existingContent: existing.content.slice(0, 260),
        existingFolder: (existing.folder_id && folderMap.get(existing.folder_id)) || 'Uncategorized',
        existingStatus: status,
        reason: `Opposite polarity ("always/use" vs "never/avoid") on shared topic: ${shared.slice(0, 3).join(', ')}`,
      });
    }
  }

  return alerts.sort((a, b) => {
    const rankA = a.existingStatus === 'trusted' ? 0 : 1;
    const rankB = b.existingStatus === 'trusted' ? 0 : 1;
    return rankA - rankB;
  }).slice(0, 4);
}

export function profileResourcesCore(payload: {
  entries: KnowledgeEntry[];
  repoFiles: RepoFile[];
  messagesBytes: number;
  vectorCount: number;
  jsHeapUsedBytes: number | null;
  jsHeapLimitBytes: number | null;
}): ResourceProfile {
  const {entries, repoFiles, messagesBytes, vectorCount, jsHeapUsedBytes, jsHeapLimitBytes} =
    payload;

  let knowledgeBytes = 0;
  let staleRawCount = 0;
  const prefixMap = new Map<string, KnowledgeEntry[]>();

  for (const e of entries) {
    knowledgeBytes += (e.title.length + e.content.length + e.tags.join(',').length) * 2;
    if (getEntryStatus(e) === 'raw') {
      staleRawCount += 1;
    }
    const sig = e.content.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 72);
    if (sig.length >= 16) {
      const bucket = prefixMap.get(sig) || [];
      bucket.push(e);
      prefixMap.set(sig, bucket);
    }
  }

  let duplicateClusterCount = 0;
  let duplicateBytes = 0;
  for (const bucket of prefixMap.values()) {
    if (bucket.length > 1) {
      duplicateClusterCount += bucket.length - 1;
      for (let i = 1; i < bucket.length; i += 1) {
        duplicateBytes += (bucket[i].title.length + bucket[i].content.length) * 2;
      }
    }
  }

  let repoBytes = 0;
  let largeRepoFiles = 0;
  for (const f of repoFiles) {
    repoBytes += f.content.length * 2;
    if (f.content.length > 45_000) largeRepoFiles += 1;
  }

  const float32EquivalentBytes = vectorCount * EMBEDDING_DIMS * 4;
  const vectorInt8Bytes = vectorCount * EMBEDDING_DIMS;

  const wasteItems: ResourceWasteItem[] = [];
  if (duplicateClusterCount > 0) {
    wasteItems.push({
      id: 'waste-duplicates',
      category: 'duplicates',
      severity: duplicateClusterCount >= 5 ? 'high' : 'medium',
      title: `${duplicateClusterCount} duplicate or near-identical memories found`,
      detail: 'Pruning duplicate notes tightens RAG context windows and trims IndexedDB/Supabase storage.',
      estimatedBytesSaved: duplicateBytes,
      autoFixKind: 'prune-duplicates',
    });
  }
  if (staleRawCount >= 5) {
    wasteItems.push({
      id: 'waste-raw',
      category: 'storage',
      severity: 'low',
      title: `${staleRawCount} unreviewed Raw captures queued`,
      detail: 'Reviewing or compacting old Raw captures improves signal-to-noise ratio and reduces memory scans.',
      estimatedBytesSaved: staleRawCount * 420,
      autoFixKind: 'compact-raw',
    });
  }
  if (messagesBytes > 180_000) {
    wasteItems.push({
      id: 'waste-chat',
      category: 'ram',
      severity: 'medium',
      title: `Large conversation history (${Math.round(messagesBytes / 1024)} KB in state)`,
      detail: 'Archiving old turns or keeping virtualized DOM windows saves RAM on Galaxy Tab A9+.',
      estimatedBytesSaved: Math.round(messagesBytes * 0.45),
      autoFixKind: 'trim-chat-cache',
    });
  }
  if (largeRepoFiles > 0) {
    wasteItems.push({
      id: 'waste-repo-chunks',
      category: 'bundle',
      severity: 'low',
      title: `${largeRepoFiles} oversized repo files (>45 KB) indexed in RAM`,
      detail: 'Splitting large source modules cuts peak memory and accelerates AST/diff passes.',
      estimatedBytesSaved: largeRepoFiles * 24_000,
      autoFixKind: 'stage-code-opt',
    });
  }

  return {
    measuredAt: new Date().toISOString(),
    jsHeapUsedBytes,
    jsHeapLimitBytes,
    knowledgeBytes,
    vectorInt8Bytes,
    float32EquivalentBytes,
    repoBytes,
    duplicateClusterCount,
    staleRawCount,
    wasteItems,
  };
}

// Persistent worker-side vector cache avoids re-cloning all Int8 vectors per query
const workerVectors = new Map<string, QuantizedVectorRecord>();

// Worker runtime listener (only executes inside a Web Worker context)
if (typeof self !== 'undefined' && typeof (self as unknown as {document?: unknown}).document === 'undefined') {
  self.onmessage = (event: MessageEvent<WorkerRequest>) => {
    const req = event.data;
    try {
      if (req.type === 'HYBRID_SEARCH') {
        if (req.payload.cachedVectors) {
          for (const [id, rec] of req.payload.cachedVectors) {
            workerVectors.set(id, rec);
          }
        }
        if (req.payload.vectorDeltas) {
          for (const rec of req.payload.vectorDeltas) {
            workerVectors.set(rec.id, rec);
          }
        }
        if (req.payload.pruneIds) {
          for (const id of req.payload.pruneIds) {
            workerVectors.delete(id);
          }
        }

        const includeMatrix = Boolean(req.payload.includeMatrixForGpu && req.payload.entries.length >= 64);
        const res = runHybridSearchCore({
          query: req.payload.query,
          entries: req.payload.entries,
          folders: req.payload.folders,
          cachedVectors: workerVectors,
          limit: req.payload.limit,
          includeRaw: req.payload.includeRaw,
          includeMatrixForGpu: includeMatrix,
        });
        const hasTransferMatrix = includeMatrix && res.usedEntryIds.length >= 64;
        const response: WorkerResponse = {
          id: req.id,
          ok: true,
          type: 'HYBRID_SEARCH',
          matches: res.matches,
          candidatePool: hasTransferMatrix ? res.candidatePool : undefined,
          newVectors: res.newVectors,
          matrixBuffer: hasTransferMatrix ? res.matrixBuffer : undefined,
          usedEntryIds: res.usedEntryIds,
        };
        const post = (self as unknown as {postMessage: (msg: WorkerResponse, transfer?: Transferable[]) => void})
          .postMessage;
        if (hasTransferMatrix) {
          post(response, [res.matrixBuffer.buffer]);
        } else {
          post(response);
        }
      } else if (req.type === 'DETECT_CONTRADICTIONS') {
        const alerts = detectContradictionsCore(req.payload);
        (self as unknown as {postMessage: (msg: WorkerResponse) => void}).postMessage({
          id: req.id,
          ok: true,
          type: 'DETECT_CONTRADICTIONS',
          alerts,
        });
      } else if (req.type === 'COMPUTE_DIFF') {
        const diffLines = computeLineDiff(req.payload.original, req.payload.proposed);
        (self as unknown as {postMessage: (msg: WorkerResponse) => void}).postMessage({
          id: req.id,
          ok: true,
          type: 'COMPUTE_DIFF',
          diffLines,
        });
      } else if (req.type === 'PROFILE_RESOURCES') {
        const profile = profileResourcesCore(req.payload);
        (self as unknown as {postMessage: (msg: WorkerResponse) => void}).postMessage({
          id: req.id,
          ok: true,
          type: 'PROFILE_RESOURCES',
          profile,
        });
      } else if (req.type === 'NEURAL_TRAIN_BATCH') {
        const trained = trainNeuralBatchCore(req.payload);
        (self as unknown as {postMessage: (msg: WorkerResponse) => void}).postMessage({
          id: req.id,
          ok: true,
          type: 'NEURAL_TRAIN_BATCH',
          ...trained,
        });
      } else if (req.type === 'NEURAL_INFER') {
        const prediction = inferNeuralCore(req.payload.prompt, req.payload.checkpoint);
        (self as unknown as {postMessage: (msg: WorkerResponse) => void}).postMessage({
          id: req.id,
          ok: true,
          type: 'NEURAL_INFER',
          prediction,
        });
      }
    } catch (err) {
      (self as unknown as {postMessage: (msg: WorkerResponse) => void}).postMessage({
        id: req.id,
        ok: false,
        error: err instanceof Error ? err.message : 'Compute worker error',
      });
    }
  };
}
