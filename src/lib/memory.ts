import type {
  ChatMessage,
  KnowledgeEntry,
  KnowledgeFolder,
  MemoryReadinessMetrics,
  RetrievalMatch,
} from '../types/mantis';

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
];

const STOPWORDS = new Set([
  'a',
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
  'how',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'so',
  'that',
  'the',
  'this',
  'to',
  'use',
  'what',
  'when',
  'where',
  'which',
  'with',
  'you',
  'your',
]);

export function tokenizeQuery(input: string): string[] {
  const raw = input
    .toLowerCase()
    .replace(/[^a-z0-9_.\-/+#\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  return Array.from(new Set(raw));
}

export function retrieveRelevantKnowledge(
  query: string,
  entries: KnowledgeEntry[],
  folders: KnowledgeFolder[],
  limit = 4,
): RetrievalMatch[] {
  const folderMap = new Map<string, string>(folders.map((f) => [f.id, f.name]));
  const normalizedQuery = query.trim().toLowerCase();
  const tokens = tokenizeQuery(query);

  if (!normalizedQuery || entries.length === 0) {
    return [];
  }

  const scored: RetrievalMatch[] = [];

  for (const entry of entries) {
    const titleLower = entry.title.toLowerCase();
    const contentLower = entry.content.toLowerCase();
    const folderName = (entry.folder_id && folderMap.get(entry.folder_id)) || 'Uncategorized';
    const folderLower = folderName.toLowerCase();
    const tagsLower = entry.tags.map((t) => t.toLowerCase());

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
      if (titleLower.includes(token)) {
        score += 3;
        matchedTitleTokens.push(token);
      }
      if (tagsLower.some((tag) => tag.includes(token))) {
        score += 3;
        matchedTagTokens.push(token);
      }
      if (folderLower.includes(token)) {
        score += 2;
      }
      if (contentLower.includes(token)) {
        score += 1.5;
        matchedContentTokens.push(token);
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

export function buildMemoryReply(
  prompt: string,
  entries: KnowledgeEntry[],
  folders: KnowledgeFolder[],
): {replyText: string; citedEntryIds: string[]} {
  const trimmed = prompt.trim();
  const lower = trimmed.toLowerCase();
  const folderMap = new Map<string, string>(folders.map((f) => [f.id, f.name]));

  if (entries.length === 0) {
    return {
      replyText:
        'My persistent memory in Supabase is currently empty. Use the Teach tab (or type `/teach Title :: Details` here) to save your first coding rule, preference, or snippet—once stored, I will retrieve and cite it automatically.',
      citedEntryIds: [],
    };
  }

  // Handle overview / summary intent cleanly
  if (
    lower.includes('what have i taught') ||
    lower.includes('what do you know') ||
    lower.includes('list memory') ||
    lower.includes('show knowledge') ||
    lower === 'help'
  ) {
    const recent = entries.slice(0, 5);
    const lines = recent.map((item) => {
      const folderName = (item.folder_id && folderMap.get(item.folder_id)) || 'Uncategorized';
      return `- [${folderName}] ${item.title}`;
    });
    return {
      replyText: [
        `I currently hold ${entries.length} knowledge ${entries.length === 1 ? 'entry' : 'entries'} across ${folders.length} ${folders.length === 1 ? 'folder' : 'folders'}. Most recently updated:`,
        ...lines,
        '',
        'Ask about any topic in your notes, use `/search <keyword>`, or teach something new with `/teach Title :: Notes`.',
      ].join('\n'),
      citedEntryIds: recent.map((r) => r.id),
    };
  }

  const searchTerm = lower.startsWith('/search ') ? trimmed.slice(8).trim() : trimmed;
  const matches = retrieveRelevantKnowledge(searchTerm, entries, folders, 4);

  if (matches.length === 0) {
    return {
      replyText: [
        `I searched all ${entries.length} entries in your Supabase memory for "${searchTerm}", and did not find a match yet.`,
        '',
        'Phase 1 runs in Memory-Retrieval mode (no external LLM API connected yet). If you know the answer or preference you want me to remember for next time, save it via the Teach tab or send:',
        `/teach ${searchTerm.slice(0, 48)} :: Your note or code snippet here`,
      ].join('\n'),
      citedEntryIds: [],
    };
  }

  const sections = matches.map((match, idx) => {
    const snippet =
      match.entry.content.length > 360
        ? `${match.entry.content.slice(0, 360).trim()}...`
        : match.entry.content.trim();
    const tagsText = match.entry.tags.length > 0 ? ` · Tags: ${match.entry.tags.join(', ')}` : '';
    return `${idx + 1}. ${match.entry.title} [${match.folderName}${tagsText}]\n${snippet}`;
  });

  return {
    replyText: [
      `Found ${matches.length} relevant ${matches.length === 1 ? 'entry' : 'entries'} in your Mantis memory:`,
      '',
      ...sections,
      '',
      'Tap any cited note below to open or edit it in the Knowledge browser.',
    ].join('\n'),
    citedEntryIds: matches.map((m) => m.entry.id),
  };
}

export function computeMemoryReadiness(
  entries: KnowledgeEntry[],
  folders: KnowledgeFolder[],
  messages: ChatMessage[],
): MemoryReadinessMetrics {
  const entryCount = entries.length;
  const folderCount = folders.length;
  const substantiveCount = entries.filter((e) => e.content.trim().length >= 25).length;
  const taggedCount = entries.filter((e) => e.tags.length > 0).length;
  const conversationTurns = messages.filter((m) => m.role === 'user').length;

  // Honest, bounded, non-gameable Phase 1 memory progress (0–100):
  // - Up to 50 pts for substantive knowledge entries (25 entries = 50 pts)
  // - Up to 20 pts for organized folders in use (4+ folders = 20 pts)
  // - Up to 15 pts for tagged entries (15 tagged entries = 15 pts)
  // - Up to 15 pts for memory-grounded conversations (15 turns = 15 pts)
  const usedFolderIds = new Set(entries.map((e) => e.folder_id).filter(Boolean));
  const entryPoints = Math.min(50, substantiveCount * 2);
  const folderPoints = Math.min(20, usedFolderIds.size * 5);
  const tagPoints = Math.min(15, taggedCount);
  const chatPoints = Math.min(15, conversationTurns);

  return {
    entryCount,
    folderCount,
    substantiveCount,
    taggedCount,
    conversationTurns,
    readinessScore: Math.round(entryPoints + folderPoints + tagPoints + chatPoints),
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
