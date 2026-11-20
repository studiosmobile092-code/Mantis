import type {DistilledKnowledgeItem} from './aiBrain';

const NOISE_LINE_PATTERNS = [
  /^\d{1,2}:\d{2}(:\d{2})?$/,
  /^(subscribe|share|save|clip|download|skip ad|autoplay|up next|cc|hd|settings|advertisement|cookie|accept all)$/i,
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
      return alnumCount >= 3 && alnumCount / line.length >= 0.42;
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
 * Deduplicates scrolling YouTube captions, voice transcripts, or live OCR frames
 * so rolling lines extend cleanly without storing repetitive duplicates.
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

function classifyFolderForChunk(chunk: string, sourceType: string): string {
  const lower = chunk.toLowerCase();
  if (/\b(error|bug|fix|exception|fail|failed|debug|issue|workaround)\b/.test(lower)) {
    return 'Debugging';
  }
  if (/\b(architecture|schema|database|supabase|deploy|api|endpoint|server)\b/.test(lower)) {
    return 'Architecture';
  }
  if (sourceType.includes('youtube') || sourceType.includes('article') || sourceType.includes('ocr')) {
    return 'Captured Learning';
  }
  return 'Patterns';
}

/**
 * Built-in concept distiller: turns long articles, transcripts, voice captures, or OCR text
 * into topical Knowledge chunks split cleanly at markdown headings or ~900-char boundaries.
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
    .filter((l) => l.length >= 2 && !NOISE_LINE_PATTERNS.some((re) => re.test(l)));

  const joined = cleanedLines.join('\n');
  if (!joined) {
    return {summary: '', entries: []};
  }

  const wordCounts = new Map<string, number>();
  const skip = new Set([
    'this', 'that', 'with', 'from', 'have', 'they', 'will', 'what',
    'when', 'where', 'which', 'about', 'there', 'their', 'your', 'just',
    'like', 'then', 'than', 'also', 'some', 'more', 'very', 'into',
    'only', 'been', 'were', 'here', 'http', 'https', 'www', 'youtube',
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

  const baseTags = Array.from(new Set([sourceType.toLowerCase(), ...topKeywords])).slice(0, 5);

  const chunks: Array<{heading?: string; body: string}> = [];
  let currentHeading: string | undefined;
  let currentChunk: string[] = [];
  let currentLen = 0;

  for (const line of cleanedLines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch && currentChunk.length > 0 && currentLen > 180) {
      chunks.push({heading: currentHeading, body: currentChunk.join('\n')});
      currentHeading = headingMatch[1].trim();
      currentChunk = [];
      currentLen = 0;
      continue;
    }

    if (headingMatch && !currentHeading && currentChunk.length === 0) {
      currentHeading = headingMatch[1].trim();
      continue;
    }

    if (currentLen + line.length > 900 && currentChunk.length > 0) {
      chunks.push({heading: currentHeading, body: currentChunk.join('\n')});
      currentHeading = undefined;
      currentChunk = [line];
      currentLen = line.length;
    } else {
      currentChunk.push(line);
      currentLen += line.length + 1;
    }
  }
  if (currentChunk.length > 0) {
    chunks.push({heading: currentHeading, body: currentChunk.join('\n')});
  }

  const limitedChunks = chunks.slice(0, 8);
  const cleanTitle = sourceTitle.trim() || 'Captured Learning';
  const entries: DistilledKnowledgeItem[] = limitedChunks.map((chunk, idx) => {
    const derivedTitle = chunk.heading
      ? `${cleanTitle.slice(0, 36)} — ${chunk.heading.slice(0, 48)}`
      : limitedChunks.length === 1
        ? cleanTitle.slice(0, 90)
        : `${cleanTitle.slice(0, 72)} (${idx + 1}/${limitedChunks.length})`;

    return {
      title: derivedTitle,
      folder: classifyFolderForChunk(chunk.body, sourceType),
      tags: baseTags,
      content: chunk.body,
    };
  });

  const firstLines = cleanedLines.slice(0, 2).join(' ');
  const summary =
    firstLines.length > 220 ? `${firstLines.slice(0, 220).trim()}...` : firstLines;

  return {summary, entries};
}
