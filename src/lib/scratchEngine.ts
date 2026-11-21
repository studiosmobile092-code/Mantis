import type {
  KnowledgeEntry,
  KnowledgeFolder,
  KnowledgeGrowthStats,
  RepoFile,
  RetrievalMatch,
  ScratchSkillRule,
} from '../types/mantis';
import {getEntryStatus} from './knowledgeSync';
import {retrieveRelevantRepoFiles, tokenizeQuery} from './memory';

const SCRATCH_SKILLS_KEY = 'mantis_scratch_skills_v1';

/**
 * Safe recursive-descent mathematical expression evaluator (ZERO eval / ZERO new Function).
 * Handles natural phrasing ("what is 1+1", "solve (12 * 4) / 3", "2^10", "sqrt(144)").
 */
export function tryEvaluateMathExpression(input: string): {
  expression: string;
  result: number;
  formatted: string;
} | null {
  const cleaned = input
    .trim()
    .replace(/^(what is|what's|calculate|compute|solve|eval|evaluate)\s+/i, '')
    .replace(/[?=]+$/g, '')
    .replace(/\bplus\b/gi, '+')
    .replace(/\bminus\b/gi, '-')
    .replace(/\btimes\b|\bmultiplied by\b/gi, '*')
    .replace(/\bdivided by\b|\bover\b/gi, '/')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .trim();

  if (!cleaned || !/^[0-9+\-*/%^().\ssqrtabound]+$/i.test(cleaned)) {
    return null;
  }
  if (!/\d/.test(cleaned) || !/[+\-*/%^]|sqrt\(/i.test(cleaned)) {
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
}

/**
 * Confidence-aware Scratch AI responder powered by Hybrid RAG matches,
 * learned Teacher-distilled Skills, safe math evaluation, and Repo context.
 */
export function synthesizeScratchWithHybrid(params: {
  prompt: string;
  hybridMatches: RetrievalMatch[];
  entries: KnowledgeEntry[];
  folders: KnowledgeFolder[];
  repoFiles: RepoFile[];
  repoLabel: string | null;
  growth: KnowledgeGrowthStats;
}): ScratchSynthesisResult {
  const {prompt, hybridMatches, entries, folders, repoFiles, repoLabel, growth} = params;
  const trimmed = prompt.trim();
  const lower = trimmed.toLowerCase();
  const folderMap = new Map<string, string>(folders.map((f) => [f.id, f.name]));

  // 1. Safe Math / Logic Skill
  const mathEval = tryEvaluateMathExpression(trimmed);
  if (mathEval) {
    return {
      replyText: `${mathEval.formatted}\n\nComputed directly by Scratch AI's safe expression parser.`,
      citedEntryIds: [],
      citedRepoPaths: [],
      confidence: 0.96,
      needsTeacherDistill: false,
    };
  }

  // 2. Learned Scratch Skills (from Teacher Distillation or manual training)
  const skills = loadScratchSkills();
  const skillHit = matchScratchSkill(trimmed, skills);
  if (skillHit && skillHit.score >= 0.72) {
    recordSkillUsage(skillHit.skill.id);
    const variants = skillHit.skill.responses;
    const picked = variants[skillHit.skill.usageCount % variants.length] || variants[0];
    const altNote =
      variants.length > 1
        ? `\n\n_Trained Scratch Skill (${skillHit.skill.folderName} · ${variants.length} learned response variants)_`
        : '';
    return {
      replyText: `${picked}${altNote}`,
      citedEntryIds: hybridMatches.slice(0, 2).map((m) => m.entry.id),
      citedRepoPaths: [],
      confidence: Math.min(0.95, skillHit.score),
      needsTeacherDistill: false,
      matchedSkillId: skillHit.skill.id,
    };
  }

  // 3. Built-in Greeting Check (If Teacher hasn't enriched greetings yet, still respond cleanly & allow enrichment!)
  const cleanedGreeting = lower.replace(/[!?.]+$/g, '').trim();
  const baseGreetings = new Set(['hi', 'hello', 'hey', 'yo', 'sup', 'howdy', 'greetings']);
  if (baseGreetings.has(cleanedGreeting)) {
    const topConceptNames = growth.topConcepts
      .slice(0, 4)
      .map((c) => `${c.label} (${c.count})`)
      .join(', ');
    return {
      replyText: [
        `Mantis Scratch AI online — ${entries.length} knowledge entries (${growth.uniqueConcepts} concepts)${
          repoLabel ? ` and ${repoFiles.length} files in ${repoLabel}` : ''
        }.`,
        topConceptNames ? `Active clusters: ${topConceptNames}.` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      citedEntryIds: [],
      citedRepoPaths: [],
      confidence: skills.some((s) => s.triggers.includes('hi')) ? 0.92 : 0.65,
      needsTeacherDistill: !skills.some((s) => s.triggers.includes('hi')),
    };
  }

  // 4. Memory Overview Queries
  if (
    lower.includes('what have i taught') ||
    lower.includes('what do you know') ||
    lower.includes('list memory') ||
    lower.includes('show knowledge') ||
    lower === 'help'
  ) {
    const trusted = entries.filter((e) => getEntryStatus(e) === 'trusted');
    const sample = (trusted.length > 0 ? trusted : entries).slice(0, 6);
    if (sample.length === 0 && repoFiles.length === 0) {
      return {
        replyText:
          'Scratch memory is empty right now. Teach a rule with `Remember: ...`, ingest a link/mic capture, or run any question with Cloud Brain active so the Teacher distills skills into Scratch automatically.',
        citedEntryIds: [],
        citedRepoPaths: [],
        confidence: 0.75,
        needsTeacherDistill: false,
      };
    }

    return {
      replyText: [
        `Scratch Knowledge Base: ${entries.length} entries (${trusted.length} trusted) · ${skills.length} distilled skills · ${growth.uniqueConcepts} concepts.`,
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
    return {
      replyText: `Scratch AI found no stored skill or knowledge entry matching "${searchTerm}".`,
      citedEntryIds: [],
      citedRepoPaths: [],
      confidence: 0.12,
      needsTeacherDistill: true,
    };
  }

  const lines: string[] = [];
  if (hybridMatches.length > 0) {
    lines.push(
      `Hybrid Memory Recall (${hybridMatches.length} ranked via BM25 + Int8 Dense RRF):`,
      ...hybridMatches.map((m, idx) => {
        const why = m.reasons.length > 0 ? ` · ${m.reasons.join(' · ')}` : '';
        const body = m.entry.content.length > 340 ? `${m.entry.content.slice(0, 340).trim()}…` : m.entry.content.trim();
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
    confidence: hasStrongMatch ? Math.min(0.88, 0.5 + topScore * 0.05) : 0.36,
    needsTeacherDistill: !hasStrongMatch,
  };
}
