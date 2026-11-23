export interface SpeechTurnSegment {
  id: string;
  rawText: string;
  acousticSpeaker: string;
  centroidHz: number;
  pauseBeforeMs: number;
  timestampMs: number;
}

interface SpeakerVoiceProfile {
  label: string;
  avgCentroidHz: number;
  avgLowBandRatio: number;
  sampleCount: number;
}

/**
 * Lightweight browser acoustic analyzer that measures Web Audio spectral centroid
 * and vocal low-vs-mid frequency balance while recording so rapid voice switches
 * across multiple speakers can be detected and labeled alongside AI refinement.
 */
export class SpeakerAcousticTracker {
  private profiles: SpeakerVoiceProfile[] = [];
  private activeSpeaker = 'Speaker 1';
  private lastSpeechTimestampMs = 0;
  private recentCentroids: number[] = [];
  private recentLowRatios: number[] = [];
  private manualOverrideSpeaker: string | null = null;
  private manualSwitchUsed = false;

  public reset(): void {
    this.profiles = [];
    this.activeSpeaker = 'Speaker 1';
    this.lastSpeechTimestampMs = 0;
    this.recentCentroids = [];
    this.recentLowRatios = [];
    this.manualOverrideSpeaker = null;
    this.manualSwitchUsed = false;
  }

  public setActiveSpeaker(label: string): string {
    const clean = label.trim() || 'Speaker 1';
    this.activeSpeaker = clean;
    this.manualOverrideSpeaker = clean;
    this.manualSwitchUsed = true;
    if (!this.profiles.some((p) => p.label.toLowerCase() === clean.toLowerCase())) {
      this.profiles.push({
        label: clean,
        avgCentroidHz: 650,
        avgLowBandRatio: 0.35,
        sampleCount: 0,
      });
    }
    return clean;
  }

  public addNextSpeaker(): string {
    const nextNum = Math.min(6, Math.max(2, this.profiles.length + 1));
    const label = `Speaker ${nextNum}`;
    return this.setActiveSpeaker(label);
  }

  public hasManualSwitch(): boolean {
    return this.manualSwitchUsed;
  }

  public clearManualSpeaker(): void {
    this.manualOverrideSpeaker = null;
  }

  public sampleFrequencyData(bins: Uint8Array, sampleRate = 48000): number {
    if (bins.length === 0) return 0;

    const nyquist = sampleRate / 2;
    const binHz = nyquist / bins.length;

    let totalEnergy = 0;
    let weightedHz = 0;
    let lowBandEnergy = 0;
    let midHighEnergy = 0;

    for (let i = 1; i < bins.length; i += 1) {
      const mag = bins[i];
      if (mag < 12) continue;
      const freq = i * binHz;
      // Focus strictly on human voice spectrum (85 Hz - 4200 Hz)
      if (freq < 85 || freq > 4200) continue;

      totalEnergy += mag;
      weightedHz += freq * mag;
      if (freq < 340) {
        lowBandEnergy += mag;
      } else {
        midHighEnergy += mag;
      }
    }

    const avgLevel = totalEnergy / Math.max(1, bins.length * 0.45);
    const normalizedLevel = Math.min(100, Math.round((avgLevel / 72) * 100));

    if (normalizedLevel >= 12 && totalEnergy > 45) {
      const centroidHz = Math.round(weightedHz / totalEnergy);
      const lowRatio = lowBandEnergy / Math.max(1, lowBandEnergy + midHighEnergy);

      this.recentCentroids.push(centroidHz);
      this.recentLowRatios.push(lowRatio);
      if (this.recentCentroids.length > 16) this.recentCentroids.shift();
      if (this.recentLowRatios.length > 16) this.recentLowRatios.shift();
    }

    return normalizedLevel;
  }

  public registerUtterance(
    nowMs = Date.now(),
    rawText = '',
  ): {
    speaker: string;
    centroidHz: number;
    pauseBeforeMs: number;
  } {
    const pauseBeforeMs =
      this.lastSpeechTimestampMs > 0 ? Math.max(0, nowMs - this.lastSpeechTimestampMs) : 0;
    this.lastSpeechTimestampMs = nowMs;

    const hasAcousticSamples = this.recentCentroids.length > 0;
    const centroidHz = hasAcousticSamples
      ? Math.round(
          this.recentCentroids.reduce((a, b) => a + b, 0) / this.recentCentroids.length,
        )
      : 650;
    const lowRatio =
      this.recentLowRatios.length > 0
        ? this.recentLowRatios.reduce((a, b) => a + b, 0) / this.recentLowRatios.length
        : 0.35;

    // Reset rolling window for next speaker turn
    this.recentCentroids = [];
    this.recentLowRatios = [];

    if (this.manualOverrideSpeaker) {
      const chosen = this.manualOverrideSpeaker;
      const existing = this.profiles.find((p) => p.label === chosen);
      if (existing) {
        if (hasAcousticSamples) {
          const alpha = Math.max(0.15, 1 / (existing.sampleCount + 1));
          existing.avgCentroidHz = Math.round(existing.avgCentroidHz * (1 - alpha) + centroidHz * alpha);
          existing.avgLowBandRatio = existing.avgLowBandRatio * (1 - alpha) + lowRatio * alpha;
          existing.sampleCount += 1;
        }
      } else {
        this.profiles.push({
          label: chosen,
          avgCentroidHz: centroidHz,
          avgLowBandRatio: lowRatio,
          sampleCount: hasAcousticSamples ? 1 : 0,
        });
      }
      this.activeSpeaker = chosen;
      return {speaker: chosen, centroidHz, pauseBeforeMs};
    }

    if (this.profiles.length === 0) {
      this.profiles.push({
        label: 'Speaker 1',
        avgCentroidHz: centroidHz,
        avgLowBandRatio: lowRatio,
        sampleCount: 1,
      });
      this.activeSpeaker = 'Speaker 1';
      return {speaker: 'Speaker 1', centroidHz, pauseBeforeMs};
    }

    if (!hasAcousticSamples) {
      const trimmed = rawText.trim();
      const startsConversationalReply =
        /^(hi|hey|hello|yes|yeah|yep|no|nope|sure|okay|ok|well|actually|wait|oh|thanks|thank you|sorry|excuse me)\b/i.test(
          trimmed,
        );
      const isTurnBreak =
        (pauseBeforeMs >= 1650 && trimmed.length >= 4) ||
        (pauseBeforeMs >= 850 && startsConversationalReply);

      if (isTurnBreak) {
        if (this.profiles.length < 2) {
          this.profiles.push({
            label: 'Speaker 2',
            avgCentroidHz: centroidHz,
            avgLowBandRatio: lowRatio,
            sampleCount: 1,
          });
          this.activeSpeaker = 'Speaker 2';
        } else {
          this.activeSpeaker =
            this.activeSpeaker === 'Speaker 1' ? 'Speaker 2' : 'Speaker 1';
        }
      }
      return {speaker: this.activeSpeaker, centroidHz, pauseBeforeMs};
    }

    // Score distance against all known acoustic profiles
    let bestProfile = this.profiles[0];
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const profile of this.profiles) {
      const centroidDelta = Math.abs(centroidHz - profile.avgCentroidHz) / 360;
      const ratioDelta = Math.abs(lowRatio - profile.avgLowBandRatio) / 0.16;
      const distance = centroidDelta * 0.65 + ratioDelta * 0.35;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestProfile = profile;
      }
    }

    // Only spawn a new speaker when acoustic timbre shifts cleanly after >=420ms turn gap (or huge pitch jump)
    const shouldSpawnNewSpeaker =
      this.profiles.length < 4 &&
      ((pauseBeforeMs >= 420 && bestDistance > 1.05) || bestDistance > 1.65);

    if (shouldSpawnNewSpeaker) {
      const nextLabel = `Speaker ${this.profiles.length + 1}`;
      this.profiles.push({
        label: nextLabel,
        avgCentroidHz: centroidHz,
        avgLowBandRatio: lowRatio,
        sampleCount: 1,
      });
      this.activeSpeaker = nextLabel;
      return {speaker: nextLabel, centroidHz, pauseBeforeMs};
    }

    // Exponentially adapt best matching profile
    const alpha = Math.max(0.15, 1 / (bestProfile.sampleCount + 1));
    bestProfile.avgCentroidHz = Math.round(
      bestProfile.avgCentroidHz * (1 - alpha) + centroidHz * alpha,
    );
    bestProfile.avgLowBandRatio =
      bestProfile.avgLowBandRatio * (1 - alpha) + lowRatio * alpha;
    bestProfile.sampleCount += 1;
    this.activeSpeaker = bestProfile.label;

    return {speaker: this.activeSpeaker, centroidHz, pauseBeforeMs};
  }

  public getDetectedSpeakerCount(): number {
    return Math.max(1, this.profiles.length);
  }

  public getActiveSpeaker(): string {
    return this.activeSpeaker;
  }
}

export function normalizeSpeechCompareKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^[a-z][a-z0-9 _-]{0,22}:\s*/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Safely appends finalized speech turns while avoiding duplicate echoes from
 * Web Speech API restarts, without truncating distinct spoken sentences.
 */
export function appendDedupedSpeechTurn(
  existingLines: string[],
  formattedLine: string,
): {mergedLines: string[]; appended: boolean} {
  const cleanLine = formattedLine.replace(/\s+/g, ' ').trim();
  const nextKey = normalizeSpeechCompareKey(cleanLine);
  if (!cleanLine || !nextKey) {
    return {mergedLines: existingLines, appended: false};
  }

  const tailSlice = existingLines.slice(-2);
  const wordCount = nextKey.split(' ').filter(Boolean).length;
  for (const prev of tailSlice) {
    const prevKey = normalizeSpeechCompareKey(prev);
    if (!prevKey) continue;
    if (
      prevKey === nextKey ||
      ((nextKey.length >= 12 || wordCount >= 3) && prevKey.endsWith(nextKey))
    ) {
      return {mergedLines: existingLines, appended: false};
    }
    // If browser expanded an interrupted interim line into a longer final line, replace tail
    if (nextKey.startsWith(prevKey) && nextKey.length > prevKey.length && prev === existingLines[existingLines.length - 1]) {
      return {
        mergedLines: [...existingLines.slice(0, -1), cleanLine],
        appended: true,
      };
    }
  }

  return {mergedLines: [...existingLines, cleanLine], appended: true};
}

const DEFAULT_TECH_GLOSSARY = [
  'mantis',
  'supabase',
  'cloudflare',
  'typescript',
  'javascript',
  'react',
  'webgpu',
  'vulkan',
  'indexeddb',
  'ollama',
  'deepseek',
  'github',
  'postgres',
  'postgresql',
  'tailwindcss',
  'vite',
  'oauth',
  'lora',
  'dpo',
  'sft',
  'eval',
  'api',
  'json',
  'sql',
  'rag',
];

/**
 * Scores multiple Web Speech recognition alternatives against the user's Knowledge base
 * lexicon + engineering glossary so domain terms win over homophone guesswork.
 */
export function rerankSpeechAlternatives(
  alternatives: Array<{transcript: string; confidence?: number}>,
  lexiconTerms: string[] = [],
): string {
  const cleanAlts = alternatives
    .map((a) => ({
      transcript: String(a.transcript || '').trim(),
      confidence: typeof a.confidence === 'number' && a.confidence > 0 ? a.confidence : 0.7,
    }))
    .filter((a) => a.transcript.length > 0);

  if (cleanAlts.length === 0) return '';
  if (cleanAlts.length === 1) return cleanAlts[0].transcript;

  const vocab = new Set<string>(DEFAULT_TECH_GLOSSARY);
  for (const term of lexiconTerms) {
    for (const tok of term.toLowerCase().replace(/[^a-z0-9_.\-/+#\s]/g, ' ').split(/\s+/)) {
      if (tok.length >= 3) vocab.add(tok);
    }
  }

  let bestText = cleanAlts[0].transcript;
  let bestScore = -1;

  for (let i = 0; i < cleanAlts.length; i += 1) {
    const alt = cleanAlts[i];
    const words = alt.transcript.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    let hits = 0;
    for (const w of words) {
      if (vocab.has(w)) hits += 1;
    }
    const rankBias = (cleanAlts.length - i) * 0.04;
    const score = alt.confidence + hits * 0.28 + rankBias;
    if (score > bestScore) {
      bestScore = score;
      bestText = alt.transcript;
    }
  }

  return bestText;
}

export function extractSpeakerLabels(transcript: string): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const lines = transcript.split('\n');

  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z0-9 _-]{0,22}):\s+/);
    if (!match) continue;
    const label = match[1].trim();
    if (!seen.has(label.toLowerCase())) {
      seen.add(label.toLowerCase());
      labels.push(label);
    }
  }
  return labels;
}

export function renameSpeakerInTranscript(
  transcript: string,
  oldLabel: string,
  newLabel: string,
): string {
  const cleanNew = newLabel.trim().replace(/:/g, '');
  if (!cleanNew || cleanNew === oldLabel) return transcript;

  const escapedOld = oldLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const linePrefixRe = new RegExp(`^(\\s*)${escapedOld}(:\\s+)`, 'gm');
  return transcript.replace(linePrefixRe, `$1${cleanNew}$2`);
}

export function cleanSentencePunctuation(raw: string): string {
  let trimmed = raw.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';

  // Fix common STT lowercase pronoun and dropped-apostrophe contractions
  trimmed = trimmed
    .replace(/\bi\b/g, 'I')
    .replace(/\bim\b/gi, (m) => (m[0] === 'I' ? "I'm" : "I'm"))
    .replace(/\bdont\b/gi, (m) => (m[0] === 'D' ? "Don't" : "don't"))
    .replace(/\bcant\b/gi, (m) => (m[0] === 'C' ? "Can't" : "can't"))
    .replace(/\bwont\b/gi, (m) => (m[0] === 'W' ? "Won't" : "won't"))
    .replace(/\bdidnt\b/gi, (m) => (m[0] === 'D' ? "Didn't" : "didn't"))
    .replace(/\bisnt\b/gi, (m) => (m[0] === 'I' ? "Isn't" : "isn't"));

  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  if (/[.!?]$/.test(capitalized)) return capitalized;
  if (/^(who|what|where|when|why|how|is|are|can|could|do|does|did|should|would)\b/i.test(capitalized)) {
    return `${capitalized}?`;
  }
  return `${capitalized}.`;
}

export const MAX_SPEECH_BUFFER_TURNS = 240;
export const MAX_SPEECH_BUFFER_BYTES = 160_000;

export function capSpeechBuffers(
  lines: string[],
  turns: SpeechTurnSegment[],
  maxTurns = MAX_SPEECH_BUFFER_TURNS,
  maxBytes = MAX_SPEECH_BUFFER_BYTES,
): {lines: string[]; turns: SpeechTurnSegment[]; trimmedCount: number} {
  let nextLines = [...lines];
  let nextTurns = [...turns];
  let trimmedCount = 0;

  while (nextTurns.length > maxTurns) {
    nextTurns.shift();
    if (nextLines.length > maxTurns) nextLines.shift();
    trimmedCount += 1;
  }

  let totalBytes = nextLines.reduce((sum, l) => sum + l.length * 2, 0);
  while (totalBytes > maxBytes && nextLines.length > 2) {
    const removed = nextLines.shift() || '';
    totalBytes -= removed.length * 2;
    if (nextTurns.length > 1) nextTurns.shift();
    trimmedCount += 1;
  }

  return {lines: nextLines, turns: nextTurns, trimmedCount};
}

export interface VoiceTrainingSftPair {
  prompt: string;
  response: string;
  speakerLabel?: string;
}

/**
 * Voice-to-Training Pipeline:
 * Converts multi-speaker Q&A dialogues or structured monologue segments
 * into clean supervised fine-tuning (SFT) prompt/response pairs.
 */
export function extractSftPairsFromTranscript(
  transcript: string,
  sessionTitle = 'Voice Session',
): VoiceTrainingSftPair[] {
  const lines = transcript
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const parsedTurns = lines.map((line) => {
    const match = line.match(/^([A-Za-z][A-Za-z0-9 _-]{0,22}):\s+(.+)$/);
    if (match) {
      return {speaker: match[1].trim(), text: cleanSentencePunctuation(match[2])};
    }
    return {speaker: 'Speaker', text: cleanSentencePunctuation(line)};
  });

  const pairs: VoiceTrainingSftPair[] = [];
  const distinctSpeakers = new Set(parsedTurns.map((t) => t.speaker.toLowerCase()));

  if (distinctSpeakers.size >= 2) {
    for (let i = 0; i < parsedTurns.length - 1; i += 1) {
      const current = parsedTurns[i];
      const next = parsedTurns[i + 1];
      if (
        current.speaker.toLowerCase() !== next.speaker.toLowerCase() &&
        current.text.length >= 6 &&
        next.text.length >= 8
      ) {
        pairs.push({
          prompt: current.text,
          response: next.text,
          speakerLabel: `${current.speaker} → ${next.speaker}`,
        });
      }
    }
  }

  // Fallback for monologue or single-speaker teaching dictation:
  // convert topic paragraphs / explicit rule statements into instruction -> explanation pairs
  if (pairs.length === 0) {
    const chunkSize = parsedTurns.length > 4 ? 2 : parsedTurns.length;
    for (let i = 0; i < parsedTurns.length; i += chunkSize) {
      const sliceText = parsedTurns
        .slice(i, i + chunkSize)
        .map((t) => t.text)
        .join(' ')
        .trim();
      if (sliceText.length < 18) continue;
      const firstSentence = sliceText.split(/(?<=[.!?])\s+/)[0] || sliceText.slice(0, 72);
      const topicPrompt =
        /\?$/.test(firstSentence)
          ? firstSentence
          : `Explain the rule or note captured in "${sessionTitle}": ${firstSentence.slice(0, 88)}`;
      pairs.push({
        prompt: topicPrompt,
        response: sliceText,
        speakerLabel: parsedTurns[i]?.speaker,
      });
    }
  }

  return pairs.slice(0, 12);
}

export function formatTranscriptLocally(
  turns: SpeechTurnSegment[],
  rawFallbackLines: string[],
): {
  cleanedTranscript: string;
  detectedSpeakers: string[];
  suggestedTitle: string;
} {
  if (turns.length === 0) {
    const fallbackText = rawFallbackLines
      .map((line) => cleanSentencePunctuation(line))
      .filter(Boolean)
      .join('\n');
    return {
      cleanedTranscript: fallbackText,
      detectedSpeakers: [],
      suggestedTitle: '',
    };
  }

  const distinctAcoustic = Array.from(new Set(turns.map((t) => t.acousticSpeaker)));
  const hasMultiSpeaker = distinctAcoustic.length > 1;

  // Merge adjacent turns spoken by the same speaker unless pause is long (> 2.2s)
  const grouped: Array<{speaker: string; textParts: string[]}> = [];

  for (const turn of turns) {
    const sentence = cleanSentencePunctuation(turn.rawText);
    if (!sentence) continue;
    const last = grouped[grouped.length - 1];
    if (last && last.speaker === turn.acousticSpeaker && turn.pauseBeforeMs < 2200) {
      last.textParts.push(sentence);
    } else {
      grouped.push({speaker: turn.acousticSpeaker, textParts: [sentence]});
    }
  }

  const formattedLines = grouped.map((g) =>
    hasMultiSpeaker ? `${g.speaker}: ${g.textParts.join(' ')}` : g.textParts.join(' '),
  );

  return {
    cleanedTranscript: formattedLines.join('\n'),
    detectedSpeakers: hasMultiSpeaker ? distinctAcoustic : ['Speaker 1'],
    suggestedTitle: '',
  };
}
