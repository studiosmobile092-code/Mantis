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

  public reset(): void {
    this.profiles = [];
    this.activeSpeaker = 'Speaker 1';
    this.lastSpeechTimestampMs = 0;
    this.recentCentroids = [];
    this.recentLowRatios = [];
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

  public registerUtterance(nowMs = Date.now()): {
    speaker: string;
    centroidHz: number;
    pauseBeforeMs: number;
  } {
    const pauseBeforeMs =
      this.lastSpeechTimestampMs > 0 ? Math.max(0, nowMs - this.lastSpeechTimestampMs) : 0;
    this.lastSpeechTimestampMs = nowMs;

    const centroidHz =
      this.recentCentroids.length > 0
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

function cleanSentencePunctuation(raw: string): string {
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  if (/[.!?]$/.test(capitalized)) return capitalized;
  if (/^(who|what|where|when|why|how|is|are|can|could|do|does|did|should|would)\b/i.test(capitalized)) {
    return `${capitalized}?`;
  }
  return `${capitalized}.`;
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
