import type {
  CurriculumTopicGap,
  EvalCase,
  KnowledgeEntry,
  KnowledgeFolder,
  KnowledgeGrowthStats,
  NeuralCheckpoint,
  NeuralPredictResult,
  RepoFile,
  RetrievalMatch,
  ScratchSkillRule,
} from '../types/mantis';
import {getEntryStatus} from './knowledgeSync';
import {matchTokenStrength, retrieveRelevantRepoFiles, tokenizeQuery} from './memory';
import {inferNeuralCore} from './neuralStudent';

const SCRATCH_SKILLS_KEY = 'mantis_scratch_skills_v1';

const WORD_TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const WORD_UNITS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

function replaceSpokenNumbers(text: string): string {
  let out = text.replace(
    /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]+(one|two|three|four|five|six|seven|eight|nine)\b/gi,
    (_, tens: string, unit: string) =>
      String((WORD_TENS[tens.toLowerCase()] || 0) + (WORD_UNITS[unit.toLowerCase()] || 0)),
  );
  out = out.replace(
    /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/gi,
    (tok) => {
      const low = tok.toLowerCase();
      if (low in WORD_TENS) return String(WORD_TENS[low]);
      if (low in WORD_UNITS) return String(WORD_UNITS[low]);
      return tok;
    },
  );
  return out;
}

/**
 * Safe recursive-descent mathematical expression evaluator (ZERO eval / ZERO new Function).
 * Handles natural phrasing ("what is 1+1", "two plus three", "15% of 80", "2^10", "sqrt(144)").
 */
export function tryEvaluateMathExpression(input: string): {
  expression: string;
  result: number;
  formatted: string;
} | null {
  const preNormalized = replaceSpokenNumbers(
    input
      .trim()
      .replace(/^(what is|what's|calculate|compute|solve|eval|evaluate)\s+/i, '')
      .replace(/[?=]+$/g, ''),
  );

  const cleaned = preNormalized
    .replace(/(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?|\([^)]+\))/gi, '($1 / 100) * $2')
    .replace(/\bplus\b|\band\b/gi, '+')
    .replace(/\bminus\b/gi, '-')
    .replace(/\btimes\b|\bmultiplied by\b/gi, '*')
    .replace(/\bdivided by\b|\bover\b/gi, '/')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .trim();

  const strippedFns = cleaned.replace(/\b(?:sqrt|abs|round)\(/gi, '(');
  if (!cleaned || !/^[0-9+\-*/%^().\s]+$/.test(strippedFns)) {
    return null;
  }
  if (!/\d/.test(cleaned) || !/[+\-*/%^]|(?:sqrt|abs|round)\(/i.test(cleaned)) {
    return null;
  }

  let pos = 0;
  const src = cleaned.replace(/\s+/g, '');

  function peek(): string {
    return src[pos] || '';
  }

  function consume(ch?: string): string {
    const c = src[pos] || '';
    if (ch && c !== ch) throw new Error('Unexpected character');
    pos += 1;
    return c;
  }

  function parseExpression(): number {
    let left = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parsePower();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = consume();
      const right = parsePower();
      if (op === '*') left *= right;
      else if (op === '/') {
        if (right === 0) throw new Error('Division by zero');
        left /= right;
      } else {
        if (right === 0) throw new Error('Modulo by zero');
        left %= right;
      }
    }
    return left;
  }

  function parsePower(): number {
    const base = parseUnary();
    if (peek() === '^') {
      consume('^');
      const exp = parsePower();
      return Math.pow(base, exp);
    }
    return base;
  }

  function parseUnary(): number {
    if (peek() === '+') {
      consume('+');
      return parseUnary();
    }
    if (peek() === '-') {
      consume('-');
      return -parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    if (src.slice(pos, pos + 5).toLowerCase() === 'sqrt(') {
      pos += 4;
      consume('(');
      const val = parseExpression();
      consume(')');
      if (val < 0) throw new Error('Negative sqrt');
      return Math.sqrt(val);
    }
    if (src.slice(pos, pos + 4).toLowerCase() === 'abs(') {
      pos += 3;
      consume('(');
      const val = parseExpression();
      consume(')');
      return Math.abs(val);
    }
    if (src.slice(pos, pos + 6).toLowerCase() === 'round(') {
      pos += 5;
      consume('(');
      const val = parseExpression();
      consume(')');
      return Math.round(val);
    }
    if (peek() === '(') {
      consume('(');
      const val = parseExpression();
      consume(')');
      return val;
    }

    const numMatch = src.slice(pos).match(/^(?:\d+\.?\d*|\.\d+)/);
    if (!numMatch) throw new Error('Invalid number');
    pos += numMatch[0].length;
    const parsed = Number(numMatch[0]);
    if (!Number.isFinite(parsed)) throw new Error('Non-finite');
    return parsed;
  }

  try {
    const val = parseExpression();
    if (pos !== src.length || !Number.isFinite(val)) return null;
    const rounded = Math.abs(val - Math.round(val)) < 1e-9 ? Math.round(val) : Number(val.toFixed(6));
    return {
      expression: cleaned,
      result: rounded,
      formatted: `${cleaned} = ${rounded}`,
    };
  } catch {
    return null;
  }
}

export function loadScratchSkills(): ScratchSkillRule[] {
  try {
    const raw = window.localStorage.getItem(SCRATCH_SKILLS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ScratchSkillRule[]) : [];
  } catch {
    return [];
  }
}

export function saveScratchSkills(skills: ScratchSkillRule[]): void {
  try {
    window.localStorage.setItem(SCRATCH_SKILLS_KEY, JSON.stringify(skills.slice(0, 400)));
  } catch {
    // ignore quota issues cleanly
  }
}

export function upsertScratchSkill(skill: Omit<ScratchSkillRule, 'id' | 'createdAt'>): ScratchSkillRule[] {
  const existing = loadScratchSkills();
  const normalizedTriggers = Array.from(
    new Set(skill.triggers.map((t) => t.trim().toLowerCase()).filter(Boolean)),
  );
  if (normalizedTriggers.length === 0 || skill.responses.length === 0) return existing;

  const matchIdx = existing.findIndex((item) =>
    item.triggers.some((t) => normalizedTriggers.includes(t.toLowerCase())),
  );

  let next: ScratchSkillRule[];
  if (matchIdx >= 0) {
    const current = existing[matchIdx];
    const mergedTriggers = Array.from(new Set([...current.triggers, ...normalizedTriggers])).slice(0, 12);
    const mergedResponses = Array.from(
      new Set([...skill.responses, ...current.responses].map((r) => r.trim()).filter(Boolean)),
    ).slice(0, 8);
    const updated: ScratchSkillRule = {
      ...current,
      triggers: mergedTriggers,
      responses: mergedResponses,
      folderName: skill.folderName || current.folderName,
      tags: Array.from(new Set([...current.tags, ...skill.tags])).slice(0, 8),
      confidence: Math.min(5, Math.max(current.confidence, skill.confidence) + 0.25),
      learnedFrom: skill.learnedFrom,
    };
    next = [updated, ...existing.filter((_, i) => i !== matchIdx)];
  } else {
    const created: ScratchSkillRule = {
      ...skill,
      id: `skill-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      triggers: normalizedTriggers.slice(0, 12),
      responses: skill.responses.map((r) => r.trim()).filter(Boolean).slice(0, 8),
      createdAt: new Date().toISOString(),
    };
    next = [created, ...existing];
  }

  saveScratchSkills(next);
  return next;
}

export function deleteScratchSkill(skillId: string): ScratchSkillRule[] {
  const next = loadScratchSkills().filter((s) => s.id !== skillId);
  saveScratchSkills(next);
  return next;
}

export function updateScratchSkill(
  skillId: string,
  patch: Partial<Pick<ScratchSkillRule, 'triggers' | 'responses' | 'folderName' | 'confidence'>>,
): ScratchSkillRule[] {
  const next = loadScratchSkills().map((s) => {
    if (s.id !== skillId) return s;
    const triggers = patch.triggers
      ? Array.from(new Set(patch.triggers.map((t) => t.trim().toLowerCase()).filter(Boolean))).slice(0, 12)
      : s.triggers;
    const responses = patch.responses
      ? Array.from(new Set(patch.responses.map((r) => r.trim()).filter(Boolean))).slice(0, 8)
      : s.responses;
    return {
      ...s,
      triggers: triggers.length > 0 ? triggers : s.triggers,
      responses: responses.length > 0 ? responses : s.responses,
      folderName: patch.folderName?.trim() || s.folderName,
      confidence: patch.confidence ?? s.confidence,
    };
  });
  saveScratchSkills(next);
  return next;
}

export function analyzeCurriculumCoverage(
  entries: KnowledgeEntry[],
  folders: KnowledgeFolder[],
  skills: ScratchSkillRule[],
  evalCases: EvalCase[] = [],
): {
  totalActiveEntries: number;
  coveredEntries: number;
  coveragePercent: number;
  gaps: CurriculumTopicGap[];
} {
  const folderMap = new Map(folders.map((f) => [f.id, f.name]));
  const activeEntries = entries.filter((e) => getEntryStatus(e) !== 'raw');
  const gaps: CurriculumTopicGap[] = [];
  let coveredEntries = 0;

  for (const entry of activeEntries) {
    const titleLower = entry.title.toLowerCase();
    const hit = matchScratchSkill(entry.title, skills);
    const tokenSet = new Set(tokenizeQuery(`${entry.title} ${entry.tags.join(' ')}`));
    const hasSkillByToken = skills.some((sk) =>
      sk.triggers.some((t) => {
        const clean = t.toLowerCase().trim();
        return clean === titleLower || matchTokenStrength(titleLower, tokenSet, clean) !== 'none';
      }),
    );

    if ((hit && hit.score >= 0.65) || hasSkillByToken) {
      coveredEntries += 1;
    } else {
      const folderName = (entry.folder_id && folderMap.get(entry.folder_id)) || 'Patterns';
      gaps.push({
        id: `gap-entry-${entry.id}`,
        title: entry.title,
        folderName,
        reason: 'uncovered',
        suggestedPrompt: `Explain and apply our rule for: ${entry.title}`,
        sourceEntryId: entry.id,
        sourceContent: entry.content,
      });
    }
  }

  for (const sk of skills) {
    if (sk.usageCount === 0 && sk.confidence < 2.2 && gaps.length < 18) {
      gaps.push({
        id: `gap-skill-${sk.id}`,
        title: `Reinforce skill: ${sk.triggers[0] || sk.folderName}`,
        folderName: sk.folderName,
        reason: 'low-usage',
        suggestedPrompt: sk.triggers[0] || sk.folderName,
      });
    }
  }

  for (const ec of evalCases) {
    const hit = matchScratchSkill(ec.prompt, skills);
    if (!hit && gaps.length < 22) {
      gaps.push({
        id: `gap-eval-${ec.id}`,
        title: `Eval readiness: ${ec.title}`,
        folderName: 'Eval Readiness',
        reason: 'eval-gap',
        suggestedPrompt: ec.prompt,
      });
    }
  }

  const totalActiveEntries = activeEntries.length;
  const coveragePercent =
    totalActiveEntries > 0 ? Math.round((coveredEntries / totalActiveEntries) * 100) : 0;

  return {
    totalActiveEntries,
    coveredEntries,
    coveragePercent,
    gaps: gaps.slice(0, 16),
  };
}

export function matchScratchSkill(
  prompt: string,
  skills: ScratchSkillRule[],
): {skill: ScratchSkillRule; score: number} | null {
  const clean = prompt.trim().toLowerCase().replace(/[!?.,]+$/g, '').trim();
  if (!clean || skills.length === 0) return null;

  const promptTokens = new Set(tokenizeQuery(clean));
  let best: {skill: ScratchSkillRule; score: number} | null = null;

  for (const skill of skills) {
    let score = 0;
    for (const trig of skill.triggers) {
      const t = trig.toLowerCase().trim();
      if (!t) continue;
      if (t === clean) {
        score = Math.max(score, 1.0);
      } else if (clean.length >= 4 && (t.includes(clean) || clean.includes(t))) {
        score = Math.max(score, 0.78);
      } else if (promptTokens.size > 0) {
        const trigTokens = tokenizeQuery(t);
        if (trigTokens.length > 0) {
          const overlap = trigTokens.filter((tok) => promptTokens.has(tok)).length;
          const jaccard = overlap / Math.max(trigTokens.length, promptTokens.size);
          if (jaccard >= 0.5) {
            score = Math.max(score, jaccard * 0.85);
          }
        }
      }
    }
    if (score >= 0.52 && (!best || score > best.score)) {
      best = {skill, score};
    }
  }

  return best;
}

export function recordSkillUsage(skillId: string): void {
  const skills = loadScratchSkills();
  const next = skills.map((s) => (s.id === skillId ? {...s, usageCount: s.usageCount + 1} : s));
  saveScratchSkills(next);
}

export interface ScratchSynthesisResult {
  replyText: string;
  citedEntryIds: string[];
  citedRepoPaths: string[];
  confidence: number;
  needsTeacherDistill: boolean;
  matchedSkillId?: string;
  usedSkillId?: string;
  nearMissSkillTrigger?: string;
  neuralResult?: NeuralPredictResult;
  isUntrained?: boolean;
}

/**
 * Confidence-aware Local Student AI responder powered by:
 * 1) Safe deterministic expression parser (arithmetic tool),
 * 2) Trainable BPE + MLP/LoRA Neural Student weights (zero hardcoded greetings),
 * 3) Explicitly taught Skill rules, and
 * 4) Hybrid BM25 + Int8 Dense RRF + Repo recall.
 */
export function synthesizeScratchWithHybrid(params: {
  prompt: string;
  hybridMatches: RetrievalMatch[];
  entries: KnowledgeEntry[];
  folders: KnowledgeFolder[];
  repoFiles: RepoFile[];
  repoLabel: string | null;
  growth: KnowledgeGrowthStats;
  recordUsage?: boolean;
  activeCheckpoint?: NeuralCheckpoint;
  neuralPrediction?: NeuralPredictResult;
}): ScratchSynthesisResult {
  const {
    prompt,
    hybridMatches,
    entries,
    folders,
    repoFiles,
    repoLabel,
    growth,
    activeCheckpoint,
  } = params;
  const trimmed = prompt.trim();
  const lower = trimmed.toLowerCase();
  const folderMap = new Map<string, string>(folders.map((f) => [f.id, f.name]));
  const isCommandQuery = lower.startsWith('/search ') || lower.startsWith('/repo ');

  const neuralPred =
    params.neuralPrediction ??
    (activeCheckpoint ? inferNeuralCore(trimmed, activeCheckpoint) : undefined);

  // 1. Safe Math / Logic Tool (pure operator parser — zero pre-baked facts)
  const mathEval = tryEvaluateMathExpression(trimmed);
  if (mathEval) {
    return {
      replyText: `${mathEval.formatted}\n\nComputed by built-in expression parser tool.`,
      citedEntryIds: [],
      citedRepoPaths: [],
      confidence: 0.96,
      needsTeacherDistill: false,
      neuralResult: neuralPred,
      isUntrained: false,
    };
  }

  // 2. Neural Student Core Forward Pass (trained BPE + MLP/LoRA logits)
  if (!isCommandQuery && neuralPred && !neuralPred.isUntrained && neuralPred.confidence >= 0.42) {
    return {
      replyText: neuralPred.replyText,
      citedEntryIds: hybridMatches.slice(0, 2).map((m) => m.entry.id),
      citedRepoPaths: [],
      confidence: neuralPred.confidence,
      needsTeacherDistill: false,
      neuralResult: neuralPred,
      isUntrained: false,
    };
  }

  // 3. Learned Explicit Skills (from Teacher Distillation or operator corrections — never hardcoded)
  const skills = loadScratchSkills();
  const skillHit = isCommandQuery ? null : matchScratchSkill(trimmed, skills);
  if (skillHit && skillHit.score >= 0.72) {
    let usedSkillId: string | undefined;
    if (params.recordUsage !== false) {
      recordSkillUsage(skillHit.skill.id);
      usedSkillId = skillHit.skill.id;
    }
    const variants = skillHit.skill.responses;
    const picked = variants[skillHit.skill.usageCount % variants.length] || variants[0];
    return {
      replyText: picked,
      citedEntryIds: hybridMatches.slice(0, 2).map((m) => m.entry.id),
      citedRepoPaths: [],
      confidence: Math.max(neuralPred?.confidence || 0, Math.min(0.95, skillHit.score)),
      needsTeacherDistill: false,
      matchedSkillId: skillHit.skill.id,
      usedSkillId,
      neuralResult: neuralPred,
      isUntrained: false,
    };
  }
  const nearMissSkillTrigger =
    skillHit && skillHit.score >= 0.52 && skillHit.score < 0.72
      ? skillHit.skill.triggers[0]
      : undefined;

  // 4. Honest Memory & Weight Inspection Queries
  if (
    lower.includes('what have i taught') ||
    lower.includes('what do you know') ||
    lower.includes('list memory') ||
    lower.includes('show knowledge')
  ) {
    const trusted = entries.filter((e) => getEntryStatus(e) === 'trusted');
    const sample = (trusted.length > 0 ? trusted : entries).slice(0, 6);
    const steps = activeCheckpoint?.metrics.stepCount || 0;
    const vocab = activeCheckpoint?.metrics.vocabSize || 0;

    if (sample.length === 0 && skills.length === 0 && steps === 0 && repoFiles.length === 0) {
      return {
        replyText:
          'Untrained baseline (0 steps · 0 BPE tokens · 0 stored memories). Teach a rule, distill from Teacher, or step-train your first turn below.',
        citedEntryIds: [],
        citedRepoPaths: [],
        confidence: 0,
        needsTeacherDistill: true,
        neuralResult: neuralPred,
        isUntrained: true,
      };
    }

    return {
      replyText: [
        `Student State (${activeCheckpoint?.id || 'ckpt-000'}): ${steps} gradient steps · ${vocab} BPE tokens · ${entries.length} memories (${trusted.length} trusted) · ${skills.length} skills · ${growth.uniqueConcepts} concepts.`,
        '',
        ...sample.map((e) => {
          const fname = (e.folder_id && folderMap.get(e.folder_id)) || 'Uncategorized';
          return `- [${fname}] ${e.title}`;
        }),
      ].join('\n'),
      citedEntryIds: sample.map((s) => s.id),
      citedRepoPaths: [],
      confidence: 0.88,
      needsTeacherDistill: false,
      neuralResult: neuralPred,
      isUntrained: false,
    };
  }

  // 5. Hybrid RAG + Repo Recall
  const isRepoOnly = lower.startsWith('/repo ');
  const isMemoryOnly = lower.startsWith('/search ');
  const searchTerm = isRepoOnly
    ? trimmed.slice(6).trim()
    : isMemoryOnly
      ? trimmed.slice(8).trim()
      : trimmed;

  const repoMatches = isMemoryOnly ? [] : retrieveRelevantRepoFiles(searchTerm, repoFiles, 3);
  const topScore = hybridMatches[0]?.score || 0;
  const hasStrongMatch = topScore >= 3.2 || repoMatches.length > 0;

  if (hybridMatches.length === 0 && repoMatches.length === 0) {
    const isZeroKnowledge =
      (!activeCheckpoint || activeCheckpoint.metrics.stepCount === 0) && skills.length === 0;

    if (isZeroKnowledge) {
      return {
        replyText: `Untrained student (${activeCheckpoint?.id || 'ckpt-000'} · 0 steps · 0 BPE tokens): I have no learned weights or memories matching "${searchTerm}". Correct & Step-Train this turn or use Teacher Distill to begin training.`,
        citedEntryIds: [],
        citedRepoPaths: [],
        confidence: 0,
        needsTeacherDistill: true,
        neuralResult: neuralPred,
        isUntrained: true,
      };
    }

    const nearMissHint = nearMissSkillTrigger
      ? `\n\nPartial skill candidate ("${nearMissSkillTrigger}"), confidence below threshold.`
      : '';
    return {
      replyText:
        neuralPred && neuralPred.replyText
          ? `${neuralPred.replyText}${nearMissHint}`
          : `Local student (${activeCheckpoint?.id || 'ckpt'}) found no high-confidence match for "${searchTerm}".${nearMissHint}`,
      citedEntryIds: [],
      citedRepoPaths: [],
      confidence: Math.max(neuralPred?.confidence ?? 0, nearMissSkillTrigger ? 0.34 : 0.12),
      needsTeacherDistill: true,
      nearMissSkillTrigger,
      neuralResult: neuralPred,
      isUntrained: Boolean(neuralPred?.isUntrained),
    };
  }

  const lines: string[] = [];
  if (hybridMatches.length > 0) {
    lines.push(
      `Hybrid Memory Recall (${hybridMatches.length} ranked via BM25 + Int8 Dense RRF):`,
      ...hybridMatches.map((m, idx) => {
        const why = m.reasons.length > 0 ? ` · ${m.reasons.join(' · ')}` : '';
        const body =
          m.entry.content.length > 340
            ? `${m.entry.content.slice(0, 340).trim()}…`
            : m.entry.content.trim();
        return `${idx + 1}. **${m.entry.title}** [${m.folderName}${why}]\n${body}`;
      }),
    );
  }

  if (repoMatches.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(
      `Indexed Repo Context (${repoLabel || 'GitHub'}):`,
      ...repoMatches.map((r, idx) => {
        const snippet = r.file.content.slice(0, 320).trim();
        return `${idx + 1}. \`${r.file.path}\` (${r.reasons.join(', ')})\n\`\`\`\n${snippet}\n\`\`\``;
      }),
    );
  }

  return {
    replyText: lines.join('\n'),
    citedEntryIds: hybridMatches.map((m) => m.entry.id),
    citedRepoPaths: repoMatches.map((r) => r.file.path),
    confidence: Math.max(
      neuralPred?.confidence || 0,
      hasStrongMatch ? Math.min(0.88, 0.5 + topScore * 0.05) : 0.36,
    ),
    needsTeacherDistill: !hasStrongMatch,
    neuralResult: neuralPred,
    isUntrained: false,
  };
}

