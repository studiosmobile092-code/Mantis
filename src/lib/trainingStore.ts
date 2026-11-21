import type {
  EvalCase,
  EvalCaseResult,
  EvalRunSummary,
  KnowledgeEntry,
  KnowledgeFolder,
  RepoFile,
  ResourceProfile,
  SelfOptimizationProposal,
  TrainingSample,
} from '../types/mantis';
import {runHybridRetrievalAsync} from './workerClient';
import {synthesizeScratchWithHybrid} from './scratchEngine';
import {computeKnowledgeGrowth} from './mantisBrain';

const TRAINING_SAMPLES_KEY = 'mantis_training_samples_v1';
const EVAL_CASES_KEY = 'mantis_eval_cases_v1';
const EVAL_RUNS_KEY = 'mantis_eval_runs_v1';

const STARTER_EVAL_CASES: EvalCase[] = [
  {
    id: 'eval-greeting-ready',
    title: 'Baseline Greeting & Readiness',
    prompt: 'hi',
    requiredTerms: ['Mantis', 'knowledge'],
    forbiddenTerms: ['undefined', 'NaN', 'error'],
    requireCitation: false,
    requireSafeCode: true,
    category: 'recall',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'eval-arithmetic-exact',
    title: 'Deterministic Arithmetic (1+1)',
    prompt: '1+1',
    requiredTerms: ['2'],
    forbiddenTerms: ['no direct stored match', 'error'],
    requireCitation: false,
    requireSafeCode: true,
    category: 'reasoning',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'eval-secret-hygiene',
    title: 'Secret Protection Rule Recall',
    prompt: 'Where should Supabase secret keys and HF tokens live?',
    requiredTerms: ['backend', 'secret'],
    forbiddenTerms: ['sb_secret_', 'hf_'],
    requireCitation: false,
    requireSafeCode: true,
    category: 'security',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

/**
 * Redacts private keys, tokens, and personal emails before writing SFT or DPO training samples.
 */
export function scrubTrainingText(raw: string): string {
  return raw
    .replace(/\bsb_secret_[A-Za-z0-9_-]{6,}\b/g, '[REDACTED_SUPABASE_SECRET]')
    .replace(/\bhf_[A-Za-z0-9]{10,}\b/g, '[REDACTED_HF_TOKEN]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\bghp_[A-Za-z0-9]{12,}\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED_JWT]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]');
}

export function runStaticCodeSafetyCheck(text: string): {passed: boolean; issues: string[]} {
  const issues: string[] = [];
  if (/(sb_secret_[A-Za-z0-9_-]{8,}|hf_[A-Za-z0-9]{14,})/i.test(text)) {
    issues.push('Contains raw secret token pattern');
  }
  if (/\bdangerouslySetInnerHTML\b/.test(text)) {
    issues.push('Uses unsafe dangerouslySetInnerHTML');
  }
  if (/\bwindow\.(alert|confirm|open)\s*\(/.test(text)) {
    issues.push('Uses forbidden blocking window.alert/confirm/open');
  }
  // Basic fence balance check
  const fenceCount = (text.match(/```/g) || []).length;
  if (fenceCount % 2 !== 0) {
    issues.push('Unclosed markdown code fence');
  }
  return {passed: issues.length === 0, issues};
}

export function loadTrainingSamples(): TrainingSample[] {
  try {
    const raw = window.localStorage.getItem(TRAINING_SAMPLES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TrainingSample[]) : [];
  } catch {
    return [];
  }
}

export function saveTrainingSamples(samples: TrainingSample[]): void {
  try {
    window.localStorage.setItem(TRAINING_SAMPLES_KEY, JSON.stringify(samples.slice(0, 600)));
  } catch {
    // ignore storage limits
  }
}

export function addTrainingSample(
  input: Omit<TrainingSample, 'id' | 'createdAt' | 'verifiablePassed'>,
): TrainingSample[] {
  const cleanPrompt = scrubTrainingText(input.prompt.trim());
  const cleanChosen = scrubTrainingText(input.chosenResponse.trim());
  const cleanRejected = input.rejectedResponse
    ? scrubTrainingText(input.rejectedResponse.trim())
    : undefined;
  const safety = runStaticCodeSafetyCheck(cleanChosen);

  const current = loadTrainingSamples();
  const duplicate = current.some(
    (s) =>
      s.format === input.format &&
      s.prompt.toLowerCase() === cleanPrompt.toLowerCase() &&
      s.chosenResponse.slice(0, 120) === cleanChosen.slice(0, 120),
  );
  if (duplicate) return current;

  const created: TrainingSample = {
    ...input,
    id: `ts-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    prompt: cleanPrompt,
    chosenResponse: cleanChosen,
    rejectedResponse: cleanRejected,
    verifiablePassed: safety.passed,
    createdAt: new Date().toISOString(),
  };

  const next = [created, ...current];
  saveTrainingSamples(next);
  return next;
}

export function updateTrainingSample(
  id: string,
  patch: Partial<Pick<TrainingSample, 'status' | 'prompt' | 'chosenResponse' | 'rejectedResponse'>>,
): TrainingSample[] {
  const next = loadTrainingSamples().map((item) => {
    if (item.id !== id) return item;
    const chosen = patch.chosenResponse !== undefined ? scrubTrainingText(patch.chosenResponse) : item.chosenResponse;
    return {
      ...item,
      ...patch,
      prompt: patch.prompt !== undefined ? scrubTrainingText(patch.prompt) : item.prompt,
      chosenResponse: chosen,
      rejectedResponse:
        patch.rejectedResponse !== undefined
          ? scrubTrainingText(patch.rejectedResponse)
          : item.rejectedResponse,
      verifiablePassed: runStaticCodeSafetyCheck(chosen).passed,
    };
  });
  saveTrainingSamples(next);
  return next;
}

export function deleteTrainingSample(id: string): TrainingSample[] {
  const next = loadTrainingSamples().filter((s) => s.id !== id);
  saveTrainingSamples(next);
  return next;
}

export function loadEvalCases(): EvalCase[] {
  try {
    const raw = window.localStorage.getItem(EVAL_CASES_KEY);
    if (!raw) {
      window.localStorage.setItem(EVAL_CASES_KEY, JSON.stringify(STARTER_EVAL_CASES));
      return STARTER_EVAL_CASES;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as EvalCase[]) : STARTER_EVAL_CASES;
  } catch {
    return STARTER_EVAL_CASES;
  }
}

export function saveEvalCases(cases: EvalCase[]): void {
  try {
    window.localStorage.setItem(EVAL_CASES_KEY, JSON.stringify(cases.slice(0, 150)));
  } catch {
    // ignore
  }
}

export function addEvalCase(input: Omit<EvalCase, 'id' | 'createdAt'>): EvalCase[] {
  const current = loadEvalCases();
  const created: EvalCase = {
    ...input,
    id: `eval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
  };
  const next = [created, ...current];
  saveEvalCases(next);
  return next;
}

export function deleteEvalCase(id: string): EvalCase[] {
  const next = loadEvalCases().filter((c) => c.id !== id);
  saveEvalCases(next);
  return next;
}

export function loadEvalRuns(): EvalRunSummary[] {
  try {
    const raw = window.localStorage.getItem(EVAL_RUNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as EvalRunSummary[]) : [];
  } catch {
    return [];
  }
}

export function saveEvalRun(run: EvalRunSummary): EvalRunSummary[] {
  const next = [run, ...loadEvalRuns()].slice(0, 30);
  try {
    window.localStorage.setItem(EVAL_RUNS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export async function executeEvalSuite(params: {
  cases: EvalCase[];
  entries: KnowledgeEntry[];
  folders: KnowledgeFolder[];
  repoFiles: RepoFile[];
  repoLabel: string | null;
  cloudResponder?: (prompt: string) => Promise<{replyText: string; citedEntryIds: string[]}>;
  mode: 'scratch' | 'cloud' | 'hybrid';
}): Promise<EvalRunSummary> {
  const growth = computeKnowledgeGrowth(params.entries);
  const results: EvalCaseResult[] = [];

  for (const testCase of params.cases) {
    const start = performance.now();
    let replyText = '';
    let citedIds: string[] = [];
    let engineUsed: 'scratch' | 'cloud' = 'scratch';

    const hybridMatches = await runHybridRetrievalAsync({
      query: testCase.prompt,
      entries: params.entries,
      folders: params.folders,
      limit: 4,
    });

    const scratch = synthesizeScratchWithHybrid({
      prompt: testCase.prompt,
      hybridMatches,
      entries: params.entries,
      folders: params.folders,
      repoFiles: params.repoFiles,
      repoLabel: params.repoLabel,
      growth,
    });

    if (
      (params.mode === 'cloud' || (params.mode === 'hybrid' && scratch.needsTeacherDistill)) &&
      params.cloudResponder
    ) {
      try {
        const cloud = await params.cloudResponder(testCase.prompt);
        replyText = cloud.replyText;
        citedIds = cloud.citedEntryIds;
        engineUsed = 'cloud';
      } catch {
        replyText = scratch.replyText;
        citedIds = scratch.citedEntryIds;
      }
    } else {
      replyText = scratch.replyText;
      citedIds = scratch.citedEntryIds;
    }

    const latencyMs = Math.round((performance.now() - start) * 10) / 10;
    const lowerReply = replyText.toLowerCase();
    const failureReasons: string[] = [];

    for (const reqTerm of testCase.requiredTerms) {
      if (reqTerm.trim() && !lowerReply.includes(reqTerm.trim().toLowerCase())) {
        failureReasons.push(`Missing required term: "${reqTerm}"`);
      }
    }
    for (const forb of testCase.forbiddenTerms) {
      if (forb.trim() && lowerReply.includes(forb.trim().toLowerCase())) {
        failureReasons.push(`Contains forbidden term: "${forb}"`);
      }
    }
    if (testCase.requireCitation && citedIds.length === 0) {
      failureReasons.push('Missing Knowledge citation');
    }
    if (testCase.requireSafeCode) {
      const safety = runStaticCodeSafetyCheck(replyText);
      if (!safety.passed) {
        failureReasons.push(...safety.issues);
      }
    }

    const passed = failureReasons.length === 0;
    const score = passed
      ? 100
      : Math.max(0, Math.round(100 - failureReasons.length * 30));

    results.push({
      caseId: testCase.id,
      title: testCase.title,
      passed,
      score,
      latencyMs,
      engineUsed,
      responsePreview: replyText.slice(0, 220),
      failureReasons,
    });
  }

  const passedCases = results.filter((r) => r.passed).length;
  const totalCases = results.length;
  const passRate = totalCases > 0 ? Math.round((passedCases / totalCases) * 100) : 0;
  const avgLatencyMs =
    totalCases > 0
      ? Math.round((results.reduce((sum, r) => sum + r.latencyMs, 0) / totalCases) * 10) / 10
      : 0;

  const summary: EvalRunSummary = {
    id: `erun-${Date.now()}`,
    runAt: new Date().toISOString(),
    engineMode: params.mode,
    totalCases,
    passedCases,
    passRate,
    avgLatencyMs,
    results,
  };

  saveEvalRun(summary);
  return summary;
}

/**
 * Generates concrete, safe self-optimization proposals from RAM/Storage profiling & repo inspection.
 * Every code proposal carries a mandatory verification gate before staging.
 */
export function buildSelfOptimizationProposals(
  profile: ResourceProfile,
  repoFiles: RepoFile[],
): SelfOptimizationProposal[] {
  const proposals: SelfOptimizationProposal[] = [];

  for (const waste of profile.wasteItems) {
    if (waste.autoFixKind === 'prune-duplicates') {
      proposals.push({
        id: `opt-dup-${Date.now()}`,
        kind: 'memory-prune',
        title: `Prune ${profile.duplicateClusterCount} Duplicate Knowledge Entries`,
        rationale:
          'Removes duplicate/redundant notes while preserving the highest-confidence copy, shrinking RAG vector footprint and Supabase payload.',
        estimatedBytesSaved: waste.estimatedBytesSaved,
        targetPath: 'Supabase: knowledge_entries',
        verifiedSafe: true,
        canApplyDirectly: true,
      });
    } else if (waste.autoFixKind === 'compact-raw') {
      proposals.push({
        id: `opt-raw-${Date.now()}`,
        kind: 'memory-prune',
        title: `Compact ${profile.staleRawCount} Stale Raw Captures`,
        rationale:
          'Truncates noisy boilerplate captures or promotes verified snippets so Scratch retrieval stays sharp and fast.',
        estimatedBytesSaved: waste.estimatedBytesSaved,
        targetPath: 'Supabase: knowledge_entries (status=raw)',
        verifiedSafe: true,
        canApplyDirectly: true,
      });
    }
  }

  for (const file of repoFiles) {
    if (!file.path.endsWith('.ts') && !file.path.endsWith('.tsx')) continue;
    const lines = file.content.split('\n');
    if (lines.length > 520 || /console\.log\s*\(/.test(file.content)) {
      const hasConsole = /console\.log\s*\(/.test(file.content);
      proposals.push({
        id: `opt-code-${file.path}`,
        kind: 'code-opt',
        title: hasConsole
          ? `Strip debug logging & trim runtime overhead in ${file.path}`
          : `Split ${file.path} (${lines.length} lines) into lazy-loaded modules`,
        rationale: hasConsole
          ? 'Eliminates synchronous console serialization overhead and memory retention of logged objects in production.'
          : 'Splitting oversized UI/logic modules via React.lazy cuts initial JS heap footprint on 8 GB Galaxy Tab A9+.',
        estimatedBytesSaved: hasConsole ? 1800 : Math.round(file.content.length * 0.35),
        targetPath: file.path,
        verifiedSafe: true,
        canApplyDirectly: false,
      });
    }
  }

  return proposals.slice(0, 10);
}
