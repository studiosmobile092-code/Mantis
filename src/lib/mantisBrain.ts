import type {
  ConceptNode,
  KnowledgeEntry,
  KnowledgeFolder,
  KnowledgeGrowthStats,
  RepoFile,
} from '../types/mantis';
import {getEntryStatus} from './knowledgeSync';
import {
  retrieveRelevantKnowledge,
  retrieveRelevantRepoFiles,
  tokenizeQuery,
} from './memory';
import type {DistilledKnowledgeItem} from './aiBrain';

const COMMON_STOPWORDS = new Set([
  'about', 'above', 'after', 'again', 'always', 'because', 'before', 'being',
  'between', 'could', 'doing', 'during', 'every', 'first', 'found', 'going',
  'great', 'having', 'issue', 'learn', 'learned', 'local', 'making', 'mantis',
  'maybe', 'never', 'notes', 'other', 'please', 'should', 'since', 'something',
  'still', 'stored', 'store', 'teach', 'their', 'there', 'these', 'thing',
  'things', 'think', 'those', 'through', 'today', 'using', 'where', 'which',
  'while', 'would', 'write', 'wrote',
]);

function extractConceptsFromEntry(entry: KnowledgeEntry): string[] {
  const concepts = new Set<string>();

  for (const tag of entry.tags) {
    const clean = tag.trim().toLowerCase();
    if (clean.length >= 2 && clean.length <= 28) {
      concepts.add(clean);
    }
  }

  for (const tok of tokenizeQuery(entry.title)) {
    if (tok.length >= 3 && tok.length <= 28 && !COMMON_STOPWORDS.has(tok)) {
      concepts.add(tok);
    }
  }

  // Also index strong repeated or identifier-like terms from content
  const codeOrTechTerms = entry.content.match(/[A-Za-z][A-Za-z0-9_.\-]{2,24}/g) || [];
  const freq = new Map<string, number>();
  for (const raw of codeOrTechTerms) {
    const lower = raw.toLowerCase();
    if (COMMON_STOPWORDS.has(lower) || lower.length < 3) continue;
    const isCodeLike = /[A-Z_.]/.test(raw);
    freq.set(lower, (freq.get(lower) || 0) + (isCodeLike ? 2 : 1));
  }

  const ranked = Array.from(freq.entries())
    .filter(([, score]) => score >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  for (const [term] of ranked) {
    concepts.add(term);
  }

  return Array.from(concepts);
}

/**
 * Builds an indexed concept graph + real knowledge growth metrics from Supabase entries.
 * Zero mock or inflated numbers — every count is computed directly from stored state.
 */
export function computeKnowledgeGrowth(
  entries: KnowledgeEntry[],
): KnowledgeGrowthStats {
  const conceptToEntries = new Map<string, Set<string>>();
  const entryConcepts = new Map<string, string[]>();

  let totalRecalls = 0;
  let confidenceSum = 0;
  let autoMinedCount = 0;
  let capturedCount = 0;
  let manualTeachCount = 0;

  for (const entry of entries) {
    const concepts = extractConceptsFromEntry(entry);
    entryConcepts.set(entry.id, concepts);

    for (const c of concepts) {
      let set = conceptToEntries.get(c);
      if (!set) {
        set = new Set<string>();
        conceptToEntries.set(c, set);
      }
      set.add(entry.id);
    }

    totalRecalls += entry.recall_count || 0;
    confidenceSum += Math.max(1, entry.confidence_score || 1);

    const src = (entry.source || '').toLowerCase();
    if (src === 'auto_mined' || src === 'ai_chat' || src === 'built_in_miner') {
      autoMinedCount += 1;
    } else if (
      src.includes('youtube') ||
      src.includes('article') ||
      src.includes('ocr') ||
      src.includes('mic') ||
      src.includes('capture')
    ) {
      capturedCount += 1;
    } else {
      manualTeachCount += 1;
    }
  }

  // Co-occurrence graph to find related concepts for each node
  const coOccurrence = new Map<string, Map<string, number>>();
  for (const concepts of entryConcepts.values()) {
    for (let i = 0; i < concepts.length; i += 1) {
      const a = concepts[i];
      let mapA = coOccurrence.get(a);
      if (!mapA) {
        mapA = new Map<string, number>();
        coOccurrence.set(a, mapA);
      }
      for (let j = 0; j < concepts.length; j += 1) {
        if (i === j) continue;
        const b = concepts[j];
        mapA.set(b, (mapA.get(b) || 0) + 1);
      }
    }
  }

  const topConcepts: ConceptNode[] = Array.from(conceptToEntries.entries())
    .map(([label, idSet]) => {
      const relatedMap = coOccurrence.get(label);
      const related = relatedMap
        ? Array.from(relatedMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([rel]) => rel)
        : [];
      return {
        label,
        count: idSet.size,
        entryIds: Array.from(idSet),
        related,
      };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 24);

  return {
    totalEntries: entries.length,
    uniqueConcepts: conceptToEntries.size,
    autoMinedCount,
    capturedCount,
    manualTeachCount,
    totalRecalls,
    avgConfidence:
      entries.length > 0 ? Math.round((confidenceSum / entries.length) * 10) / 10 : 0,
    topConcepts,
  };
}

/**
 * Deterministic Built-in Rule & Fact Miner.
 * Extracts durable rules, bug fixes, tech choices, and snippets directly from chat turns
 * without needing any external cloud API call.
 */
export function mineKnowledgeFromText(
  rawInput: string,
  existingEntries: KnowledgeEntry[],
): DistilledKnowledgeItem[] {
  const trimmed = rawInput.trim();
  if (!trimmed || trimmed.length < 18 || trimmed.startsWith('/')) {
    return [];
  }

  const lower = trimmed.toLowerCase();
  const isQuestionOnly =
    trimmed.endsWith('?') &&
    !/\b(remember|note:|rule:|fix:|always |never |prefer |we use )\b/i.test(trimmed);
  if (isQuestionOnly) {
    return [];
  }

  const hasExplicitRuleCue =
    /\b(remember|keep in mind|note:|rule:|fix:|always |never |prefer |do not use |don't use |make sure |we use |use .+ instead of)\b/i.test(
      trimmed,
    );
  const hasCodeFence = /```[\s\S]{15,}```/.test(trimmed);
  const hasFixPattern = /\b(fixed by|root cause|solution:|workaround:|solved by)\b/i.test(trimmed);

  if (!hasExplicitRuleCue && !hasCodeFence && !hasFixPattern) {
    return [];
  }

  let cleanedContent = trimmed
    .replace(/^(please\s+)?(remember\s+(that|this)?|note:|rule:|fix:)\s*/i, '')
    .trim();

  if (cleanedContent.length < 14) {
    return [];
  }

  let folder = 'Patterns';
  if (hasFixPattern || /\b(bug|error|fix|broken|crash|401|402|403|404|cors|blocked)\b/i.test(lower)) {
    folder = 'Debugging';
  } else if (/\b(always|never|prefer|style|naming|ui|tab|chromebook|tablet)\b/i.test(lower)) {
    folder = 'Preferences';
  } else if (/\b(supabase|cloudflare|database|schema|architecture|edge|worker|oauth|deploy)\b/i.test(lower)) {
    folder = 'Architecture';
  }

  const firstSentence = cleanedContent.split(/[\n.!?]/)[0].trim();
  const cleanTitle =
    firstSentence.length > 72 ? `${firstSentence.slice(0, 69).trim()}...` : firstSentence;

  const tags = tokenizeQuery(cleanedContent)
    .filter((t) => !COMMON_STOPWORDS.has(t))
    .slice(0, 4);

  const normalizedCandidate = cleanedContent.toLowerCase().slice(0, 80);
  const duplicate = existingEntries.some(
    (e) =>
      e.title.toLowerCase() === cleanTitle.toLowerCase() ||
      e.content.toLowerCase().slice(0, 80) === normalizedCandidate,
  );
  if (duplicate) {
    return [];
  }

  return [
    {
      title: cleanTitle || 'Mined Studio Rule',
      folder,
      tags: tags.length > 0 ? tags : ['auto-mined'],
      content: cleanedContent,
    },
  ];
}

function clipText(text: string, maxLen: number): string {
  const clean = text.trim();
  return clean.length > maxLen ? `${clean.slice(0, maxLen).trim()}...` : clean;
}

function findMatchingSnippet(content: string, tokens: string[]): string {
  const lines = content.split('\n');
  if (tokens.length > 0) {
    const idx = lines.findIndex((line) =>
      tokens.some((tok) => line.toLowerCase().includes(tok)),
    );
    if (idx !== -1) {
      return lines.slice(Math.max(0, idx - 2), Math.min(lines.length, idx + 7)).join('\n').trim();
    }
  }
  return lines.slice(0, 8).join('\n').trim();
}

/**
 * Built-in AI Lead Engine:
 * Always answers first using indexed Knowledge, Concept Graph links, Confidence weighting,
 * and synced GitHub Repo files — clearly indicating when Cloud Assist can deepen the answer.
 */
export function synthesizeBuiltInReply(params: {
  prompt: string;
  entries: KnowledgeEntry[];
  folders: KnowledgeFolder[];
  repoFiles: RepoFile[];
  repoLabel: string | null;
  growth: KnowledgeGrowthStats;
}): {
  replyText: string;
  citedEntryIds: string[];
  citedRepoPaths: string[];
  canEscalateToCloud: boolean;
} {
  const {prompt, entries, folders, repoFiles, repoLabel, growth} = params;
  const trimmed = prompt.trim();
  const lower = trimmed.toLowerCase();
  const cleanedGreeting = lower.replace(/[!?.]+$/g, '').trim();
  const folderMap = new Map<string, string>(folders.map((f) => [f.id, f.name]));

  const isGreeting = new Set([
    'hi',
    'hello',
    'hey',
    'yo',
    'sup',
    'howdy',
    'greetings',
    'good morning',
    'good afternoon',
    'good evening',
  ]).has(cleanedGreeting);

  if (isGreeting) {
    const topConceptNames = growth.topConcepts
      .slice(0, 5)
      .map((c) => `${c.label} (${c.count})`)
      .join(', ');
    return {
      replyText: [
        `Built-in Mantis AI ready. Tracking ${entries.length} knowledge entries across ${growth.uniqueConcepts} indexed concepts${
          repoLabel ? `, plus ${repoFiles.length} files from ${repoLabel}` : ''
        }.`,
        topConceptNames ? `Active knowledge clusters: ${topConceptNames}.` : '',
        '',
        'Tell me a rule ("remember always..."), ask about your code, ingest a YouTube/article link, or tap Ask Cloud Assist for deep code generation.',
      ]
        .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))
        .join('\n'),
      citedEntryIds: [],
      citedRepoPaths: [],
      canEscalateToCloud: false,
    };
  }

  // Overview / status query
  if (
    lower.includes('what have i taught') ||
    lower.includes('what do you know') ||
    lower.includes('list memory') ||
    lower.includes('show knowledge') ||
    lower === 'help'
  ) {
    if (entries.length === 0 && repoFiles.length === 0) {
      return {
        replyText:
          'Built-in memory in Supabase has 0 entries yet. Paste a YouTube/article link in Ingest, dictate with Live Mic, or write a rule starting with "Remember: ..." to train Mantis immediately.',
        citedEntryIds: [],
        citedRepoPaths: [],
        canEscalateToCloud: false,
      };
    }

    const trustedEntries = entries.filter((e) => getEntryStatus(e) !== 'raw');
    const rawCount = entries.length - trustedEntries.length;
    const recent = (trustedEntries.length > 0 ? trustedEntries : entries).slice(0, 6);
    const conceptSummary = growth.topConcepts
      .slice(0, 8)
      .map((c) => `${c.label} (${c.count})`)
      .join(', ');

    return {
      replyText: [
        `Built-in Knowledge Index: ${entries.length} entries (${rawCount > 0 ? `${entries.length - rawCount} active, ${rawCount} raw pending review` : 'all active'}) · ${growth.uniqueConcepts} concepts · ${growth.totalRecalls} verified recalls.`,
        conceptSummary ? `Top concepts: ${conceptSummary}` : '',
        '',
        'Most recent active entries:',
        ...recent.map((e) => {
          const fname = (e.folder_id && folderMap.get(e.folder_id)) || 'Uncategorized';
          return `- [${fname} · ${getEntryStatus(e)}] ${e.title} (conf ${e.confidence_score || 1})`;
        }),
        ...(repoFiles.length > 0
          ? ['', `Connected repo (${repoLabel || 'GitHub'}): ${repoFiles.length} indexed source files.`]
          : []),
      ]
        .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))
        .join('\n'),
      citedEntryIds: recent.map((r) => r.id),
      citedRepoPaths: repoFiles.slice(0, 3).map((f) => f.path),
      canEscalateToCloud: false,
    };
  }

  const isRepoOnly = lower.startsWith('/repo ');
  const isMemoryOnly = lower.startsWith('/search ');
  const searchTerm = isRepoOnly
    ? trimmed.slice(6).trim()
    : isMemoryOnly
      ? trimmed.slice(8).trim()
      : trimmed;

  const knowledgeMatches = isRepoOnly
    ? []
    : retrieveRelevantKnowledge(searchTerm, entries, folders, 5);
  const repoMatches = isMemoryOnly ? [] : retrieveRelevantRepoFiles(searchTerm, repoFiles, 3);
  const tokens = tokenizeQuery(searchTerm);

  // Discover connected concepts from the graph
  const matchedConceptLinks = new Set<string>();
  for (const tok of tokens) {
    const node = growth.topConcepts.find((c) => c.label.includes(tok) || tok.includes(c.label));
    if (node) {
      for (const rel of node.related) {
        matchedConceptLinks.add(rel);
      }
    }
  }

  if (knowledgeMatches.length === 0 && repoMatches.length === 0) {
    return {
      replyText: [
        `Built-in AI searched ${entries.length} knowledge entries and ${repoFiles.length} repo files for "${searchTerm}" with no direct stored match yet.`,
        '',
        'You can tap "Ask Cloud Assist" on this message to reason beyond stored memory, or teach Mantis directly by writing "Remember: <rule>".',
      ].join('\n'),
      citedEntryIds: [],
      citedRepoPaths: [],
      canEscalateToCloud: true,
    };
  }

  const sections: string[] = [];

  if (knowledgeMatches.length > 0) {
    sections.push(
      `Built-in Memory Recall (${knowledgeMatches.length} matched):`,
      ...knowledgeMatches.map((m, idx) => {
        const conf = m.entry.confidence_score || 1;
        const why = m.reasons.length > 0 ? ` · ${m.reasons[0]}` : '';
        return `${idx + 1}. [${m.folderName} · conf ${conf}${why}] ${m.entry.title}\n${clipText(m.entry.content, 320)}`;
      }),
    );
  }

  if (matchedConceptLinks.size > 0) {
    sections.push(
      '',
      `Connected concepts in graph: ${Array.from(matchedConceptLinks).slice(0, 6).join(', ')}`,
    );
  }

  if (repoMatches.length > 0) {
    sections.push(
      '',
      `Relevant Repository Files (${repoLabel || 'GitHub'}):`,
      ...repoMatches.map((r, idx) => {
        const snippet = findMatchingSnippet(r.file.content, tokens);
        return `${idx + 1}. ${r.file.path} (${r.reasons.join(', ')})\n${clipText(snippet, 340)}`;
      }),
    );
  }

  return {
    replyText: sections.join('\n'),
    citedEntryIds: knowledgeMatches.map((m) => m.entry.id),
    citedRepoPaths: repoMatches.map((r) => r.file.path),
    canEscalateToCloud: true,
  };
}
