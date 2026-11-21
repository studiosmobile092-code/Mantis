import type {KnowledgeFolder} from '../types/mantis';

export const AUTO_FOLDER_OPTION = '__auto__';

interface TopicRule {
  folderName: string;
  description: string;
  keywords: RegExp[];
  suggestedTags: string[];
}

const TOPIC_RULES: TopicRule[] = [
  {
    folderName: 'Food',
    description: 'Ingredients, definitions of foods, cooking techniques, recipes, and nutrition notes.',
    keywords: [
      /\b(turkey|chicken|beef|pork|salmon|steak|bread|pasta|cheese|butter|olive oil|garlic|onion|spice|seasoning|recipe|bake|roast|simmer|grill|kitchen|meal|breakfast|lunch|dinner|snack|fruit|vegetable|culinary|ingredient|flavor|cook(ing)?|food|nutrition|calorie|protein)\b/i,
    ],
    suggestedTags: ['food', 'culinary'],
  },
  {
    folderName: 'Greetings',
    description: 'Greetings, polite introductions, farewells, and everyday social phrases.',
    keywords: [
      /\b(greet(ing|ings)?|hello|hi there|good morning|good afternoon|good evening|nice to meet|how are you|farewell|goodbye|salutation|welcome|polite phrase|introduction|etiquette)\b/i,
    ],
    suggestedTags: ['greetings', 'conversation'],
  },
  {
    folderName: 'Language & Speech',
    description: 'Word definitions, vocabulary, grammar, pronunciation, and how phrases are used in speech.',
    keywords: [
      /\b(definition of|meaning of|etymology|synonym|antonym|pronunciation|grammar|vocabulary|slang|idiom|phrase|used in speech|part of speech|noun|verb|adjective|translation|slang term)\b/i,
    ],
    suggestedTags: ['language', 'vocabulary'],
  },
  {
    folderName: 'Debugging',
    description: 'Bug root causes, error traces, troubleshooting steps, and verified fixes.',
    keywords: [
      /\b(error|bug|exception|stack trace|401|404|500|cors|timeout|crash|fix|debug|broken|failed|troubleshoot|workaround)\b/i,
    ],
    suggestedTags: ['debugging', 'fix'],
  },
  {
    folderName: 'Architecture',
    description: 'System design, APIs, database schemas, auth flows, deployment, and hosting notes.',
    keywords: [
      /\b(architecture|schema|supabase|postgres|rls|oauth|jwt|cloudflare|worker|edge function|api route|endpoint|deploy|database|latency|cache|sync)\b/i,
    ],
    suggestedTags: ['architecture', 'system'],
  },
  {
    folderName: 'Patterns',
    description: 'Reusable coding conventions, UI patterns, hooks, and best practices.',
    keywords: [
      /\b(react|typescript|tailwind|hook|component|pattern|refactor|memo|lazy|accessibility|aria|best practice|clean code|eslint|vite|css)\b/i,
    ],
    suggestedTags: ['patterns', 'code'],
  },
  {
    folderName: 'Science',
    description: 'Physics, biology, chemistry, astronomy, and scientific explanations.',
    keywords: [
      /\b(physics|biology|chemistry|atom|molecule|gravity|cell|dna|planet|ecosystem|species|evolution|experiment|hypothesis|energy|quantum)\b/i,
    ],
    suggestedTags: ['science'],
  },
  {
    folderName: 'Health',
    description: 'Fitness, sleep, wellness, anatomy, and medical definitions.',
    keywords: [
      /\b(health|workout|exercise|sleep|hydration|muscle|vitamin|recovery|cardio|stretch|wellness|symptom|breathing)\b/i,
    ],
    suggestedTags: ['health'],
  },
  {
    folderName: 'Finance',
    description: 'Budgeting, taxes, saving, investing, and financial terms.',
    keywords: [
      /\b(budget|tax|interest rate|savings|invest|stock|etf|credit|loan|invoice|expense|profit|revenue|accounting)\b/i,
    ],
    suggestedTags: ['finance'],
  },
  {
    folderName: 'History',
    description: 'Historical events, timelines, people, and cultural context.',
    keywords: [
      /\b(history|century|war|empire|revolution|ancient|historical|treaty|dynasty|era|museum|founded in)\b/i,
    ],
    suggestedTags: ['history'],
  },
  {
    folderName: 'Travel',
    description: 'Destinations, transit, packing checklists, and navigation tips.',
    keywords: [
      /\b(travel|flight|hotel|airport|passport|itinerary|luggage|train|road trip|destination|transit)\b/i,
    ],
    suggestedTags: ['travel'],
  },
  {
    folderName: 'Preferences',
    description: 'Personal workflow preferences, rules, and communication style.',
    keywords: [
      /\b(always prefer|never use|my rule|i prefer|don't ask|style rule|workflow preference|personal preference)\b/i,
    ],
    suggestedTags: ['preference', 'rule'],
  },
];

const REJECTED_GENERIC_FOLDERS = new Set([
  '',
  'general',
  'other',
  'misc',
  'miscellaneous',
  'notes',
  'unknown',
  'none',
  'default',
  'auto',
]);

export function normalizeFolderName(raw: string): string {
  const cleaned = raw
    .replace(/[`"'*_#[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 28);

  if (!cleaned) return '';

  return cleaned
    .split(' ')
    .map((word) => {
      if (!word) return '';
      if (word === '&' || word.toLowerCase() === 'and') return '&';
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .filter(Boolean)
    .join(' ');
}

export function findMatchingFolder(
  candidateName: string,
  existingFolders: KnowledgeFolder[],
): KnowledgeFolder | null {
  const normalized = normalizeFolderName(candidateName).toLowerCase();
  if (!normalized) return null;

  const exact = existingFolders.find(
    (f) => f.name.trim().toLowerCase() === normalized,
  );
  if (exact) return exact;

  // Singular/plural soft match (e.g. "Greeting" -> "Greetings", "Pattern" -> "Patterns")
  return (
    existingFolders.find((f) => {
      const existing = f.name.trim().toLowerCase();
      return (
        existing === `${normalized}s` ||
        `${existing}s` === normalized ||
        existing.replace(/\s+/g, '') === normalized.replace(/\s+/g, '')
      );
    }) || null
  );
}

export interface FolderInferenceResult {
  folderName: string;
  description: string;
  isNew: boolean;
  matchedFolderId: string | null;
  suggestedTags: string[];
}

export function inferFolderDeterministically(
  title: string,
  content: string,
  existingFolders: KnowledgeFolder[],
  preferredHint?: string,
): FolderInferenceResult {
  const cleanHint = normalizeFolderName(preferredHint || '');
  if (cleanHint && !REJECTED_GENERIC_FOLDERS.has(cleanHint.toLowerCase())) {
    const matched = findMatchingFolder(cleanHint, existingFolders);
    return {
      folderName: matched ? matched.name : cleanHint,
      description: matched?.description || `Notes and concepts related to ${cleanHint}.`,
      isNew: !matched,
      matchedFolderId: matched?.id || null,
      suggestedTags: [cleanHint.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')].filter(Boolean),
    };
  }

  const combined = `${title}\n${content}`;

  // Score each topic rule by keyword hits; pick strongest match
  let bestRule: TopicRule | null = null;
  let bestHits = 0;

  for (const rule of TOPIC_RULES) {
    let hits = 0;
    for (const pattern of rule.keywords) {
      const globalPattern = new RegExp(pattern.source, 'gi');
      const matches = combined.match(globalPattern);
      if (matches) hits += matches.length;
    }
    if (hits > bestHits) {
      bestHits = hits;
      bestRule = rule;
    }
  }

  if (bestRule && bestHits > 0) {
    const matched = findMatchingFolder(bestRule.folderName, existingFolders);
    return {
      folderName: matched ? matched.name : bestRule.folderName,
      description: matched?.description || bestRule.description,
      isNew: !matched,
      matchedFolderId: matched?.id || null,
      suggestedTags: bestRule.suggestedTags,
    };
  }

  // Fallback to existing Captured Learning or General folder
  const fallbackFolder =
    existingFolders.find((f) => f.name.toLowerCase() === 'captured learning') ||
    existingFolders[0] ||
    null;

  return {
    folderName: fallbackFolder?.name || 'Captured Learning',
    description:
      fallbackFolder?.description || 'Captured links, voice transcripts, and learning notes.',
    isNew: !fallbackFolder,
    matchedFolderId: fallbackFolder?.id || null,
    suggestedTags: [],
  };
}

export async function ensureAutoFolderExists(
  folderName: string,
  description: string,
  currentFolders: KnowledgeFolder[],
  createFolderFn: (name: string, description: string) => Promise<KnowledgeFolder | null>,
): Promise<{
  folder: KnowledgeFolder | null;
  updatedFolders: KnowledgeFolder[];
  createdNew: boolean;
}> {
  const normalized = normalizeFolderName(folderName);
  if (!normalized || REJECTED_GENERIC_FOLDERS.has(normalized.toLowerCase())) {
    const fallback = currentFolders[0] || null;
    return {folder: fallback, updatedFolders: currentFolders, createdNew: false};
  }

  const existing = findMatchingFolder(normalized, currentFolders);
  if (existing) {
    return {folder: existing, updatedFolders: currentFolders, createdNew: false};
  }

  const created = await createFolderFn(
    normalized,
    description.trim() || `Auto-created folder for ${normalized} knowledge.`,
  );
  if (!created) {
    return {
      folder: currentFolders[0] || null,
      updatedFolders: currentFolders,
      createdNew: false,
    };
  }

  return {
    folder: created,
    updatedFolders: [...currentFolders, created],
    createdNew: true,
  };
}
