import type {DistilledKnowledgeItem} from './aiBrain';

const NOISE_LINE_PATTERNS = [
  /^\d{1,2}:\d{2}(:\d{2})?$/,
  /^(subscribe|share|save|clip|download|skip ad|autoplay|up next|cc|hd|settings)$/i,
  /^[^a-zA-Z0-9]{2,}$/,
];

export function cleanOcrText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[|¦~`]{2,}/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((line) => {
      if (line.length < 3) return false;
      if (NOISE_LINE_PATTERNS.some((re) => re.test(line))) return false;
      const alnumCount = (line.match(/[a-zA-Z0-9]/g) || []).length;
      return alnumCount >= 3 && alnumCount / line.length >= 0.45;
    })
    .join('\n');
}

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

export function computeWordOverlap(a: string, b: string): number {
  const wordsA = new Set(normalizeWords(a));
  const wordsB = new Set(normalizeWords(b));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let shared = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) shared += 1;
  }
  return shared / Math.min(wordsA.size, wordsB.size);
}

/**
 * Deduplicates scrolling YouTube captions / live screen frames so rolling lines
 * extend cleanly without storing repetitive duplicates.
 */
export function mergeIncrementalCaption(
  existingLines: string[],
  incomingRaw: string,
): {mergedLines: string[]; addedText: string} {
  const cleaned = cleanOcrText(incomingRaw);
  if (!cleaned) {
    return {mergedLines: existingLines, addedText: ''};
  }

  const incomingLines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const next = [...existingLines];
  const addedParts: string[] = [];

  for (const line of incomingLines) {
    const recentWindow = next.slice(-6);
    const exactMatch = recentWindow.some((prev) => prev.toLowerCase() === line.toLowerCase());
    if (exactMatch) continue;

    // If incoming line extends the very last line (common in YouTube live captions), replace it
    const lastIdx = next.length - 1;
    if (lastIdx >= 0) {
      const last = next[lastIdx];
      const overlap = computeWordOverlap(last, line);
      if (
        line.toLowerCase().startsWith(last.toLowerCase().slice(0, Math.min(18, last.length))) &&
        line.length >= last.length
      ) {
        next[lastIdx] = line;
        addedParts.push(line);
        continue;
      }
      if (overlap >= 0.8 && line.length <= last.length + 6) {
        continue;
      }
    }

    // Skip lines that overlap >80% with anything in the recent window
    if (recentWindow.some((prev) => computeWordOverlap(prev, line) >= 0.82)) {
      continue;
    }

    next.push(line);
    addedParts.push(line);
  }

  return {
    mergedLines: next,
    addedText: addedParts.join('\n'),
  };
}

/**
 * Offline / fallback text distiller: turns long articles, transcripts, or OCR captures
 * into clean topical Knowledge chunks with extracted keywords as tags.
 */
export function distillTextLocally(
  rawText: string,
  sourceTitle: string,
  sourceType: string,
): {summary: string; entries: DistilledKnowledgeItem[]} {
  const cleanedLines = rawText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 2);

  const joined = cleanedLines.join('\n');
  if (!joined) {
    return {summary: '', entries: []};
  }

  // Extract frequent meaningful words as tags
  const wordCounts = new Map<string, number>();
  const skip = new Set([
    'this',
    'that',
    'with',
    'from',
    'have',
    'they',
    'will',
    'what',
    'when',
    'where',
    'which',
    'about',
    'there',
    'their',
    'your',
    'just',
    'like',
    'then',
    'than',
    'also',
    'some',
    'more',
    'very',
    'into',
    'only',
    'been',
    'were',
    'here',
  ]);
  for (const w of normalizeWords(joined)) {
    if (w.length >= 4 && !skip.has(w)) {
      wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
    }
  }
  const topKeywords = Array.from(wordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([word]) => word);

  const tags = Array.from(new Set([sourceType.toLowerCase(), ...topKeywords])).slice(0, 5);

  // Split into ~900-char knowledge chunks at line boundaries
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentLen = 0;

  for (const line of cleanedLines) {
    if (currentLen + line.length > 900 && currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n'));
      currentChunk = [line];
      currentLen = line.length;
    } else {
      currentChunk.push(line);
      currentLen += line.length + 1;
    }
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n'));
  }

  const limitedChunks = chunks.slice(0, 8);
  const cleanTitle = sourceTitle.trim() || 'Captured Learning';
  const entries: DistilledKnowledgeItem[] = limitedChunks.map((chunk, idx) => ({
    title:
      limitedChunks.length === 1
        ? cleanTitle.slice(0, 90)
        : `${cleanTitle.slice(0, 72)} (${idx + 1}/${limitedChunks.length})`,
    folder: 'Captured Learning',
    tags,
    content: chunk,
  }));

  const firstLines = cleanedLines.slice(0, 2).join(' ');
  const summary =
    firstLines.length > 220 ? `${firstLines.slice(0, 220).trim()}...` : firstLines;

  return {summary, entries};
}
