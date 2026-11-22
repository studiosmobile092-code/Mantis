import type {
  ChatMessage,
  CodeSuggestion,
  KnowledgeEntry,
  KnowledgeFolder,
  MemoryReadinessMetrics,
  RepoFile,
  RepoMatch,
  RetrievalMatch,
} from '../types/mantis';
import {getEntryStatus} from './knowledgeSync';

export const STARTER_FOLDERS: Array<{name: string; description: string}> = [
  {
    name: 'Architecture',
    description: 'System structure, stack decisions, and deployment rules',
  },
  {
    name: 'Patterns',
    description: 'Reusable coding idioms, snippets, and API conventions',
  },
  {
    name: 'Debugging',
    description: 'Root causes, fixes, and environment gotchas you solved',
  },
  {
    name: 'Preferences',
    description: 'Your personal coding style, naming, and UI defaults',
  },
  {
    name: 'Captured Learning',
    description: 'Auto-distilled knowledge from screen captures, YouTube captions, and articles',
  },
];

const STOPWORDS = new Set([
  'a',
  'ah',
  'am',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'do',
  'for',
  'from',
  'have',
  'he',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'me',
  'my',
  'no',
  'of',
  'oh',
  'ok',
  'on',
  'or',
  'repo',
  'so',
  'that',
  'the',
  'this',
  'to',
  'um',
  'up',
  'us',
  'use',
  'we',
  'what',
  'when',
  'where',
  'which',
  'with',
  'you',
  'your',
]);

const GREETINGS = new Set([
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
]);

export function tokenizeQuery(input: string): string[] {
  const raw = input
    .toLowerCase()
    .replace(/[^a-z0-9_.\-/+#\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t) && !GREETINGS.has(t));
  return Array.from(new Set(raw));
}

function buildTrigrams(text: string): Set<string> {
  const padded = `  ${text.toLowerCase().replace(/[^a-z0-9]/g, ' ')}  `;
  const grams = new Set<string>();
  for (let i = 0; i <= padded.length - 3; i += 1) {
    const g = padded.slice(i, i + 3);
    if (g.trim().length >= 2) grams.add(g);
  }
  return grams;
}

function trigramSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const g of a) {
    if (b.has(g)) shared += 1;
  }
  return shared / Math.max(1, Math.min(a.size, b.size));
}

function splitSearchTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9_.\-/+#]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0),
  );
}

/**
 * Prevents 2-3 letter technical tokens ("ai", "ui", "db", "ts") from falsely matching
 * inside unrelated English words ("maintain", "build", "components").
 */
export function matchTokenStrength(
  textLower: string,
  tokenSet: Set<string>,
  token: string,
): 'exact' | 'substring' | 'none' {
  if (tokenSet.has(token)) return 'exact';
  if (token.length <= 3) {
    // Also match compound code identifiers like "aiBrain" or "ui_panel" via delimiter boundaries
    for (const word of tokenSet) {
      if (word === token) return 'exact';
      if (
        (word.startsWith(`${token}.`) ||
          word.startsWith(`${token}/`) ||
          word.startsWith(`${token}_`) ||
          word.endsWith(`/${token}`) ||
          word.endsWith(`.${token}`)) &&
        word.length > token.length
      ) {
        return 'exact';
      }
    }
    return 'none';
  }
  return textLower.includes(token) ? 'substring' : 'none';
}

export function retrieveRelevantKnowledge(
  query: string,
  entries: KnowledgeEntry[],
  folders: KnowledgeFolder[],
  limit = 4,
  options?: {includeRaw?: boolean},
): RetrievalMatch[] {
  const folderMap = new Map<string, string>(folders.map((f) => [f.id, f.name]));
  const normalizedQuery = query.trim().toLowerCase();
  const tokens = tokenizeQuery(query);
  const queryGrams = buildTrigrams(normalizedQuery);
  const includeRaw = options?.includeRaw ?? false;

  if (!normalizedQuery || entries.length === 0) {
    return [];
  }

  const scored: RetrievalMatch[] = [];

  for (const entry of entries) {
    const status = getEntryStatus(entry);
    if (status === 'raw' && !includeRaw) {
      continue;
    }

    const titleLower = entry.title.toLowerCase();
    const contentLower = entry.content.toLowerCase();
    const folderName = (entry.folder_id && folderMap.get(entry.folder_id)) || 'Uncategorized';
    const folderLower = folderName.toLowerCase();
    const tagsLower = entry.tags.map((t) => t.toLowerCase());

    const titleTokenSet = splitSearchTokens(titleLower);
    const contentTokenSet = splitSearchTokens(contentLower);
    const folderTokenSet = splitSearchTokens(folderLower);
    const tagTokenSet = splitSearchTokens(tagsLower.join(' '));

    let score = 0;
    const reasons: string[] = [];

    if (normalizedQuery.length >= 4 && titleLower.includes(normalizedQuery)) {
      score += 8;
      reasons.push('Exact phrase in title');
    } else if (normalizedQuery.length >= 5 && contentLower.includes(normalizedQuery)) {
      score += 5;
      reasons.push('Exact phrase in body');
    }

    const matchedTitleTokens: string[] = [];
    const matchedTagTokens: string[] = [];
    const matchedContentTokens: string[] = [];

    for (const token of tokens) {
      const titleHit = matchTokenStrength(titleLower, titleTokenSet, token);
      if (titleHit === 'exact') {
        score += 3.2;
        matchedTitleTokens.push(token);
      } else if (titleHit === 'substring') {
        score += 1.6;
        matchedTitleTokens.push(token);
      }

      const tagHit = matchTokenStrength(tagsLower.join(' '), tagTokenSet, token);
      if (tagHit === 'exact') {
        score += 3.0;
        matchedTagTokens.push(token);
      } else if (tagHit === 'substring') {
        score += 1.5;
        matchedTagTokens.push(token);
      }

      const folderHit = matchTokenStrength(folderLower, folderTokenSet, token);
      if (folderHit === 'exact') {
        score += 2.0;
      } else if (folderHit === 'substring') {
        score += 1.0;
      }

      const bodyHit = matchTokenStrength(contentLower, contentTokenSet, token);
      if (bodyHit === 'exact') {
        score += 1.6;
        matchedContentTokens.push(token);
      } else if (bodyHit === 'substring') {
        score += 0.65;
        matchedContentTokens.push(token);
      }
    }

    // Fuzzy trigram similarity fallback so partial or slightly misspelled terms match
    if (tokens.length > 0 && score < 3 && normalizedQuery.length >= 4) {
      const sim = trigramSimilarity(queryGrams, buildTrigrams(`${titleLower} ${tagsLower.join(' ')}`));
      if (sim >= 0.42) {
        score += sim * 4;
        reasons.push('Fuzzy similarity');
      }
    }

    // Apply reinforcement boost + trust tier weighting (Trusted strong, Reviewed medium)
    if (score > 0) {
      const confidence = Math.max(1, entry.confidence_score || 1);
      score += Math.min(3, (confidence - 1) * 0.6);
      if (status === 'trusted') {
        score = score * 1.45 + 2.5;
        reasons.unshift('Trusted');
      } else if (status === 'reviewed') {
        score *= 0.85;
      } else {
        score *= 0.45;
      }
    }

    if (matchedTitleTokens.length > 0) {
      reasons.push(`Title match (${matchedTitleTokens.slice(0, 3).join(', ')})`);
    }
    if (matchedTagTokens.length > 0) {
      reasons.push(`Tag match (${matchedTagTokens.slice(0, 3).join(', ')})`);
    }
    if (matchedContentTokens.length > 0 && reasons.length === 0) {
      reasons.push(`Content match (${matchedContentTokens.slice(0, 3).join(', ')})`);
    }

    if (score > 0) {
      scored.push({
        entry,
        folderName,
        score,
        reasons,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || b.entry.updated_at.localeCompare(a.entry.updated_at));
  return scored.slice(0, limit);
}

export function retrieveRelevantRepoFiles(
  query: string,
  repoFiles: RepoFile[] = [],
  limit = 3,
): RepoMatch[] {
  const normalizedQuery = query.trim().toLowerCase();
  const tokens = tokenizeQuery(query);
  if (!normalizedQuery || !Array.isArray(repoFiles) || repoFiles.length === 0) return [];

  const scored: RepoMatch[] = [];

  for (const file of repoFiles) {
    const pathLower = file.path.toLowerCase();
    const contentLower = file.content.toLowerCase();
    const pathTokenSet = splitSearchTokens(pathLower.replace(/[/.]/g, ' '));
    const contentTokenSet = splitSearchTokens(contentLower.slice(0, 14000));
    let score = 0;
    const reasons: string[] = [];

    if (normalizedQuery.length >= 4 && pathLower.includes(normalizedQuery)) {
      score += 8;
      reasons.push('Exact path match');
    }

    const matchedPathTokens: string[] = [];
    const matchedCodeTokens: string[] = [];

    for (const token of tokens) {
      const pathHit = matchTokenStrength(pathLower, pathTokenSet, token);
      if (pathHit === 'exact') {
        score += 3.8;
        matchedPathTokens.push(token);
      } else if (pathHit === 'substring') {
        score += 2.0;
        matchedPathTokens.push(token);
      }

      const codeHit = matchTokenStrength(contentLower, contentTokenSet, token);
      if (codeHit === 'exact') {
        score += 1.6;
        matchedCodeTokens.push(token);
      } else if (codeHit === 'substring') {
        score += 0.65;
        matchedCodeTokens.push(token);
      }
    }

    if (matchedPathTokens.length > 0) {
      reasons.push(`Path (${matchedPathTokens.slice(0, 3).join(', ')})`);
    }
    if (matchedCodeTokens.length > 0 && reasons.length === 0) {
      reasons.push(`Code (${matchedCodeTokens.slice(0, 3).join(', ')})`);
    }

    if (score > 0) {
      scored.push({file, score, reasons});
    }
  }

  scored.sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));
  return scored.slice(0, limit);
}

function extractMatchingSnippet(content: string, tokens: string[]): string {
  const lines = content.split('\n');
  if (tokens.length > 0) {
    const idx = lines.findIndex((line) => {
      const lower = line.toLowerCase();
      const lineSet = splitSearchTokens(lower);
      return tokens.some((tok) => matchTokenStrength(lower, lineSet, tok) !== 'none');
    });
    if (idx !== -1) {
      const start = Math.max(0, idx - 2);
      const end = Math.min(lines.length, idx + 6);
      return lines.slice(start, end).join('\n').trim();
    }
  }
  return lines.slice(0, 8).join('\n').trim();
}

export function buildMemoryReply(
  prompt: string,
  entries: KnowledgeEntry[],
  folders: KnowledgeFolder[],
  repoFiles: RepoFile[] = [],
  connectedRepoLabel: string | null = null,
): {replyText: string; citedEntryIds: string[]; citedRepoPaths: string[]} {
  const trimmed = prompt.trim();
  const lower = trimmed.toLowerCase();
  const folderMap = new Map<string, string>(folders.map((f) => [f.id, f.name]));

  const cleanedGreeting = lower.replace(/[!?.]+$/g, '').trim();
  if (GREETINGS.has(cleanedGreeting)) {
    return {
      replyText: [
        `Hey! Mantis is online${
          connectedRepoLabel ? ` with ${connectedRepoLabel} (${repoFiles.length} files)` : ''
        } and ${entries.length} saved Knowledge ${entries.length === 1 ? 'entry' : 'entries'}.`,
        '',
        'Ask a coding question, share something to remember, paste a YouTube/article link in Capture, or run `/self-audit`.',
      ].join('\n'),
      citedEntryIds: [],
      citedRepoPaths: [],
    };
  }

  // Overview / summary intent
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
          'My persistent memory in Supabase is empty and no GitHub repository is indexed yet. Use Teach (or `/teach Title :: Details`) to save knowledge, or connect a repo in the GitHub tab.',
        citedEntryIds: [],
        citedRepoPaths: [],
      };
    }

    const recent = entries.slice(0, 5);
    const knowledgeLines = recent.map((item) => {
      const folderName = (item.folder_id && folderMap.get(item.folder_id)) || 'Uncategorized';
      return `- [${folderName}] ${item.title}`;
    });

    const parts = [
      `I hold ${entries.length} knowledge ${entries.length === 1 ? 'entry' : 'entries'} across ${folders.length} folders${
        connectedRepoLabel
          ? ` and ${repoFiles.length} indexed files from ${connectedRepoLabel}`
          : ''
      }.`,
    ];

    if (knowledgeLines.length > 0) {
      parts.push('', 'Recent knowledge entries:', ...knowledgeLines);
    }
    if (repoFiles.length > 0) {
      parts.push(
        '',
        'Sample indexed repo files:',
        ...repoFiles.slice(0, 5).map((f) => `- ${f.path}`),
      );
    }
    parts.push(
      '',
      'Commands: `/search <topic>`, `/repo <file>`, `/teach Title :: Details`, `/suggest <file_path>`, or `/self-audit`.',
    );

    return {
      replyText: parts.join('\n'),
      citedEntryIds: recent.map((r) => r.id),
      citedRepoPaths: repoFiles.slice(0, 3).map((f) => f.path),
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
    : retrieveRelevantKnowledge(searchTerm, entries, folders, 3);
  const repoMatches = isMemoryOnly ? [] : retrieveRelevantRepoFiles(searchTerm, repoFiles, 3);

  if (knowledgeMatches.length === 0 && repoMatches.length === 0) {
    return {
      replyText: [
        `I searched ${entries.length} knowledge entries${
          repoFiles.length > 0 ? ` and ${repoFiles.length} indexed repo files` : ''
        } for "${searchTerm}", and did not find a match yet.`,
        '',
        'Save a new rule with `/teach Title :: Details`, propose code with `/suggest <file_path>`, or run `/self-audit`.',
      ].join('\n'),
      citedEntryIds: [],
      citedRepoPaths: [],
    };
  }

  const tokens = tokenizeQuery(searchTerm);
  const output: string[] = [];

  if (knowledgeMatches.length > 0) {
    output.push(
      `Knowledge memory matches (${knowledgeMatches.length}):`,
      ...knowledgeMatches.map((match, idx) => {
        const snippet =
          match.entry.content.length > 320
            ? `${match.entry.content.slice(0, 320).trim()}...`
            : match.entry.content.trim();
        const tagsText =
          match.entry.tags.length > 0 ? ` · Tags: ${match.entry.tags.join(', ')}` : '';
        return `${idx + 1}. ${match.entry.title} [${match.folderName}${tagsText}]\n${snippet}`;
      }),
    );
  }

  if (repoMatches.length > 0) {
    if (output.length > 0) output.push('');
    output.push(
      `GitHub repository references${connectedRepoLabel ? ` (${connectedRepoLabel})` : ''}:`,
      ...repoMatches.map((match, idx) => {
        const excerpt = extractMatchingSnippet(match.file.content, tokens);
        const clipped = excerpt.length > 340 ? `${excerpt.slice(0, 340)}...` : excerpt;
        return `${idx + 1}. ${match.file.path} (${match.reasons.join(', ')})\n${clipped}`;
      }),
    );
  }

  output.push('', 'Tap any source chip below to inspect the full Knowledge note or GitHub file.');

  return {
    replyText: output.join('\n'),
    citedEntryIds: knowledgeMatches.map((m) => m.entry.id),
    citedRepoPaths: repoMatches.map((r) => r.file.path),
  };
}

export function computeMemoryReadiness(
  entries: KnowledgeEntry[],
  folders: KnowledgeFolder[],
  messages: ChatMessage[],
  repoFiles: RepoFile[] = [],
  suggestions: CodeSuggestion[] = [],
  selfAuditCount = 0,
): MemoryReadinessMetrics {
  const entryCount = entries.length;
  const folderCount = folders.length;
  const substantiveCount = entries.filter((e) => e.content.trim().length >= 25).length;
  const taggedCount = entries.filter((e) => e.tags.length > 0).length;
  const conversationTurns = messages.filter((m) => m.role === 'user').length;
  const repoFileCount = repoFiles.length;
  const approvedSuggestions = suggestions.filter((s) => s.status === 'approved').length;
  const reviewedSuggestions = suggestions.filter((s) => s.status !== 'pending').length;

  const usedFolderIds = new Set(entries.map((e) => e.folder_id).filter(Boolean));
  const entryPoints = Math.min(38, substantiveCount * 2);
  const folderPoints = Math.min(12, usedFolderIds.size * 3);
  const tagPoints = Math.min(12, taggedCount);
  const chatPoints = Math.min(10, conversationTurns);
  const repoPoints = Math.min(14, Math.floor(repoFileCount / 2));
  const suggestionPoints = Math.min(10, approvedSuggestions * 3 + Math.min(4, reviewedSuggestions));
  const selfAuditPoints = Math.min(4, selfAuditCount * 2);

  return {
    entryCount,
    folderCount,
    substantiveCount,
    taggedCount,
    conversationTurns,
    repoFileCount,
    approvedSuggestions,
    reviewedSuggestions,
    selfAuditCount,
    readinessScore: Math.round(
      entryPoints +
        folderPoints +
        tagPoints +
        chatPoints +
        repoPoints +
        suggestionPoints +
        selfAuditPoints,
    ),
  };
}

export function parseTagsInput(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0),
    ),
  );
}
