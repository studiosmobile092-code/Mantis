import {
  Camera,
  CheckCircle2,
  ClipboardPaste,
  Eye,
  FileText,
  Globe,
  Link2,
  Loader2,
  Mic,
  MicOff,
  Monitor,
  Pause,
  Play,
  Square,
  Trash2,
  Users,
} from 'lucide-react';
import {type ClipboardEvent, type FormEvent, useEffect, useMemo, useRef, useState} from 'react';
import {
  distillWithAiBrain,
  enhanceSpeechTranscriptWithAi,
  extractUrlViaBrain,
  normalizeExternalUrl,
  suggestSemanticFolderWithAi,
  type DistilledKnowledgeItem,
} from '../lib/aiBrain';
import {
  AUTO_FOLDER_OPTION,
  ensureAutoFolderExists,
  inferFolderDeterministically,
} from '../lib/autoFolders';
import {
  captureVideoFrameText,
  recognizeImageBlob,
  supportsDisplayCapture,
  supportsSpeechRecognition,
  terminateOcrWorker,
  type CaptureZone,
} from '../lib/ocrCapture';
import {
  appendDedupedSpeechTurn,
  formatTranscriptLocally,
  normalizeSpeechCompareKey,
  rerankSpeechAlternatives,
  SpeakerAcousticTracker,
  type SpeechTurnSegment,
} from '../lib/speechEngine';
import {distillTextLocally, mergeIncrementalCaption} from '../lib/textDistiller';
import type {KnowledgeEntry, KnowledgeFolder, KnowledgeStatus} from '../types/mantis';
import {CaptureReviewModal, type CaptureReviewDraft} from './CaptureReviewModal';

interface CapturePanelProps {
  brainUrl: string;
  backupBrainUrl: string;
  brainModel: string;
  accessToken: string;
  folders: KnowledgeFolder[];
  entries?: KnowledgeEntry[];
  onCreateFolder?: (name: string, description: string) => Promise<KnowledgeFolder | null>;
  onSaveEntry: (payload: {
    folderId: string | null;
    title: string;
    content: string;
    tags: string[];
    source: string;
    status?: KnowledgeStatus;
    sourceUrl?: string | null;
    extractedAt?: string | null;
  }) => Promise<boolean>;
  onSaveCapturedEntries: (
    items: DistilledKnowledgeItem[],
    sourceType: string,
    meta?: {status?: KnowledgeStatus; sourceUrl?: string | null; extractedAt?: string | null},
  ) => Promise<number>;
  onBeforeHeavyTask?: (taskLabel: string) => Promise<void>;
  onOpenKnowledge: () => void;
}

type CaptureTab = 'url_text' | 'image_mic' | 'screen';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence?: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  lang: string;
  onaudiostart?: (() => void) | null;
  onsoundstart?: (() => void) | null;
  onspeechstart?: (() => void) | null;
  onspeechend?: (() => void) | null;
  onsoundend?: (() => void) | null;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: {error?: string; message?: string}) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

const MIC_RECOVERY_KEY = 'mantis_mic_recovery_v1';

const SPEECH_LANG_OPTIONS = [
  {code: 'en-US', label: 'English (US)'},
  {code: 'en-GB', label: 'English (UK)'},
  {code: 'en-AU', label: 'English (AU)'},
  {code: 'en-IN', label: 'English (India)'},
  {code: 'es-ES', label: 'Spanish (Spain)'},
  {code: 'es-MX', label: 'Spanish (Mexico)'},
  {code: 'fr-FR', label: 'French'},
  {code: 'de-DE', label: 'German'},
  {code: 'it-IT', label: 'Italian'},
  {code: 'pt-BR', label: 'Portuguese (Brazil)'},
  {code: 'ja-JP', label: 'Japanese'},
  {code: 'ko-KR', label: 'Korean'},
  {code: 'zh-CN', label: 'Chinese (Simplified)'},
];

function resolveInitialSpeechLang(): string {
  if (typeof navigator === 'undefined') return 'en-US';
  const navLang = (navigator.language || '').trim();
  const exact = SPEECH_LANG_OPTIONS.find((o) => o.code.toLowerCase() === navLang.toLowerCase());
  if (exact) return exact.code;
  const prefix = navLang.split('-')[0]?.toLowerCase();
  const byPrefix = SPEECH_LANG_OPTIONS.find((o) => o.code.toLowerCase().startsWith(`${prefix}-`));
  return byPrefix?.code || 'en-US';
}

function formatDurationClock(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

interface StoredMicRecovery {
  lines: string[];
  turns: SpeechTurnSegment[];
  title: string;
  savedAt: string;
}

function readMicRecoveryDraft(): StoredMicRecovery | null {
  try {
    const raw = window.localStorage.getItem(MIC_RECOVERY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredMicRecovery>;
    if (!Array.isArray(parsed.lines) || parsed.lines.length === 0) return null;
    return {
      lines: parsed.lines.map((l) => String(l)),
      turns: Array.isArray(parsed.turns) ? (parsed.turns as SpeechTurnSegment[]) : [],
      title: typeof parsed.title === 'string' ? parsed.title : '',
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function writeMicRecoveryDraft(draft: StoredMicRecovery | null): void {
  try {
    if (!draft || draft.lines.length === 0) {
      window.localStorage.removeItem(MIC_RECOVERY_KEY);
    } else {
      window.localStorage.setItem(MIC_RECOVERY_KEY, JSON.stringify(draft));
    }
  } catch {
    // ignore storage quota errors
  }
}

interface LinkIngestRecord {
  id: string;
  url: string;
  title: string;
  kind: 'youtube' | 'article';
  savedCount: number;
  createdAt: string;
}

function formatConversationTitle(date = new Date()): string {
  const formatted = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
  return `Conversation – ${formatted}`;
}

function parseTagsText(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function resolveInitialFolderSelection(
  title: string,
  content: string,
  folders: KnowledgeFolder[],
  canAutoCreate: boolean,
): {folderId: string | null; suggestion: string; description: string} {
  const inferred = inferFolderDeterministically(title, content, folders);
  if (inferred.matchedFolderId) {
    return {
      folderId: canAutoCreate ? AUTO_FOLDER_OPTION : inferred.matchedFolderId,
      suggestion: inferred.folderName,
      description: inferred.description,
    };
  }
  return {
    folderId: canAutoCreate ? AUTO_FOLDER_OPTION : folders[0]?.id || null,
    suggestion: inferred.folderName,
    description: inferred.description,
  };
}

export function CapturePanel({
  brainUrl,
  backupBrainUrl,
  brainModel,
  accessToken,
  folders,
  entries = [],
  onCreateFolder,
  onSaveEntry,
  onSaveCapturedEntries,
  onBeforeHeavyTask,
  onOpenKnowledge,
}: CapturePanelProps) {
  const hasDisplayApi = supportsDisplayCapture();
  const hasMicApi = supportsSpeechRecognition();

  const [activeTab, setActiveTab] = useState<CaptureTab>('url_text');

  // Shared capture & buffer state (never auto-saved without user confirmation)
  const [sourceTitle, setSourceTitle] = useState('Ingested Learning Session');
  const [capturedLines, setCapturedLines] = useState<string[]>([]);
  const [framesScanned, setFramesScanned] = useState(0);
  const [framesSkipped, setFramesSkipped] = useState(0);
  const [notesLearned, setNotesLearned] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Review & Confirm modal state
  const [reviewDraft, setReviewDraft] = useState<CaptureReviewDraft | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [isSavingReview, setIsSavingReview] = useState(false);
  const [isRefiningOcr, setIsRefiningOcr] = useState(false);
  const [isCategorizingFolder, setIsCategorizingFolder] = useState(false);

  // Live Screen OCR state
  const [isRecordingScreen, setIsRecordingScreen] = useState(false);
  const [captureZone, setCaptureZone] = useState<CaptureZone>('bottom_captions');
  const [scanIntervalMs, setScanIntervalMs] = useState(2000);
  const [lastConfidence, setLastConfidence] = useState<number | null>(null);
  const [cropPreviewUrl, setCropPreviewUrl] = useState<string | null>(null);

  // URL / Paste state
  const [targetUrl, setTargetUrl] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [isExtractingUrl, setIsExtractingUrl] = useState(false);
  const [extractStepText, setExtractStepText] = useState<string | null>(null);
  const [linkHistory, setLinkHistory] = useState<LinkIngestRecord[]>([]);

  // Image OCR & Reliable Multi-Voice Live Mic state
  const [imageOcrZone, setImageOcrZone] = useState<CaptureZone>('full');
  const [isOcrImageBusy, setIsOcrImageBusy] = useState(false);
  const [isListeningMic, setIsListeningMic] = useState(false);
  const [isMicPaused, setIsMicPaused] = useState(false);
  const [micLang, setMicLang] = useState<string>(() => resolveInitialSpeechLang());
  const [isPolishingMic, setIsPolishingMic] = useState(false);
  const [micLines, setMicLines] = useState<string[]>([]);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [detectedSpeakersCount, setDetectedSpeakersCount] = useState(1);
  const [activeSpeakerLabel, setActiveSpeakerLabel] = useState('Speaker 1');
  const [isManualSpeakerMode, setIsManualSpeakerMode] = useState(false);
  const [acousticMode, setAcousticMode] = useState<'acoustic' | 'cadence'>('cadence');
  const [micElapsedSeconds, setMicElapsedSeconds] = useState(0);
  const [recoverableMicDraft, setRecoverableMicDraft] = useState<StoredMicRecovery | null>(() =>
    readMicRecoveryDraft(),
  );

  const speechLexicon = useMemo(() => {
    const terms: string[] = [];
    for (const e of entries.slice(0, 180)) {
      terms.push(e.title, ...e.tags);
    }
    return terms;
  }, [entries]);
  const speechLexiconRef = useRef<string[]>(speechLexicon);
  useEffect(() => {
    speechLexiconRef.current = speechLexicon;
  }, [speechLexicon]);

  const spokenWordCount = useMemo(() => {
    const combined = `${micLines.join(' ')} ${interimTranscript}`.trim();
    return combined ? combined.split(/\s+/).length : 0;
  }, [micLines, interimTranscript]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const prevLuminanceGridRef = useRef<number[] | null>(null);
  const isScanningFrameRef = useRef(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const isMicWantedRef = useRef(false);
  const isMicPausedRef = useRef(false);
  const micRestartTimerRef = useRef<number | null>(null);
  const micWatchdogTimerRef = useRef<number | null>(null);
  const micDecayTimerRef = useRef<number | null>(null);
  const micClockTimerRef = useRef<number | null>(null);
  const micActivityAtRef = useRef<number>(0);
  const micRetryCountRef = useRef(0);
  const micLevelTargetRef = useRef(0);
  const micLinesRef = useRef<string[]>([]);
  const micTurnsRef = useRef<SpeechTurnSegment[]>([]);
  const latestInterimRef = useRef('');
  const lastFinalNormalizedRef = useRef('');
  const acousticTrackerRef = useRef(new SpeakerAcousticTracker());

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micAudioStreamRef = useRef<MediaStream | null>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveformRafRef = useRef<number | null>(null);
  const waveformBinsRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const acousticProbeActiveRef = useRef(false);

  const linesRef = useRef<string[]>([]);

  useEffect(() => {
    linesRef.current = capturedLines;
  }, [capturedLines]);

  const stopScreenCapture = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    prevLuminanceGridRef.current = null;
    setIsRecordingScreen(false);
  };

  const teardownAcousticProbe = () => {
    acousticProbeActiveRef.current = false;
    if (waveformRafRef.current !== null) {
      window.cancelAnimationFrame(waveformRafRef.current);
      waveformRafRef.current = null;
    }
    if (micAudioStreamRef.current) {
      for (const track of micAudioStreamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
      micAudioStreamRef.current = null;
    }
    analyserRef.current = null;
    waveformBinsRef.current = null;
    if (audioCtxRef.current) {
      const ctx = audioCtxRef.current;
      audioCtxRef.current = null;
      void ctx.close().catch(() => {});
    }
    setAcousticMode('cadence');
  };

  const stopMicTimers = () => {
    if (micRestartTimerRef.current !== null) {
      window.clearTimeout(micRestartTimerRef.current);
      micRestartTimerRef.current = null;
    }
    if (micWatchdogTimerRef.current !== null) {
      window.clearInterval(micWatchdogTimerRef.current);
      micWatchdogTimerRef.current = null;
    }
    if (micDecayTimerRef.current !== null) {
      window.clearInterval(micDecayTimerRef.current);
      micDecayTimerRef.current = null;
    }
    if (micClockTimerRef.current !== null) {
      window.clearInterval(micClockTimerRef.current);
      micClockTimerRef.current = null;
    }
    micLevelTargetRef.current = 0;
  };

  const tearDownRecognitionInstance = () => {
    if (!recognitionRef.current) return;
    recognitionRef.current.onaudiostart = null;
    recognitionRef.current.onsoundstart = null;
    recognitionRef.current.onspeechstart = null;
    recognitionRef.current.onspeechend = null;
    recognitionRef.current.onsoundend = null;
    recognitionRef.current.onresult = null;
    recognitionRef.current.onerror = null;
    recognitionRef.current.onend = null;
    try {
      recognitionRef.current.stop();
    } catch {
      try {
        recognitionRef.current.abort?.();
      } catch {
        // ignore abort errors
      }
    }
    recognitionRef.current = null;
  };

  const stopMicCapture = () => {
    isMicWantedRef.current = false;
    isMicPausedRef.current = false;
    setIsMicPaused(false);
    stopMicTimers();
    teardownAcousticProbe();
    tearDownRecognitionInstance();
    setInterimTranscript('');
    latestInterimRef.current = '';
    setIsListeningMic(false);
  };

  useEffect(() => {
    return () => {
      stopScreenCapture();
      stopMicCapture();
      void terminateOcrWorker();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) return;
    let raf = 0;

    const drawWaveform = () => {
      raf = window.requestAnimationFrame(drawWaveform);
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetW = Math.floor(rect.width * dpr);
      const targetH = Math.floor(rect.height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const cs = getComputedStyle(document.documentElement);
      const accent = cs.getPropertyValue('--m-accent').trim() || '#059669';
      const elevated = cs.getPropertyValue('--m-elevated').trim() || '#141c2c';
      const barCount = 24;
      const gap = 3;
      const barW = Math.max(2, (rect.width - gap * (barCount - 1)) / barCount);

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const analyser = analyserRef.current;
      const bins = waveformBinsRef.current;
      const audioCtx = audioCtxRef.current;
      const hasLiveAcoustic =
        isListeningMic && !isMicPaused && analyser && bins && audioCtx && acousticProbeActiveRef.current;

      if (hasLiveAcoustic) {
        analyser.getByteFrequencyData(bins);
        const liveLvl = acousticTrackerRef.current.sampleFrequencyData(bins, audioCtx.sampleRate);
        micLevelTargetRef.current = Math.max(micLevelTargetRef.current, liveLvl);
      }

      const now = performance.now() / 160;
      const currentEnergy = isListeningMic && !isMicPaused ? micLevelTargetRef.current : 0;

      for (let i = 0; i < barCount; i += 1) {
        let ratio = 0.14;
        if (hasLiveAcoustic && bins) {
          const binIdx = Math.min(bins.length - 1, Math.floor(((i + 1) / (barCount + 2)) * (bins.length * 0.42)));
          ratio = Math.max(0.14, Math.min(1, bins[binIdx] / 195));
        } else if (currentEnergy > 0) {
          const wave = 0.55 + 0.45 * Math.sin(now + i * 0.55);
          ratio = Math.max(0.14, Math.min(1, (currentEnergy / 100) * wave));
        }

        const barH = Math.max(3, ratio * (rect.height - 4));
        const x = i * (barW + gap);
        const y = (rect.height - barH) / 2;

        ctx.fillStyle =
          isListeningMic && !isMicPaused && (ratio > 0.24 || currentEnergy >= 18) ? accent : elevated;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, 2);
        ctx.fill();
      }
      ctx.restore();
    };

    raf = window.requestAnimationFrame(drawWaveform);
    waveformRafRef.current = raf;
    return () => {
      window.cancelAnimationFrame(raf);
      if (waveformRafRef.current === raf) waveformRafRef.current = null;
    };
  }, [isListeningMic, isMicPaused, activeTab]);

  function commitSpeechSegment(rawText: string) {
    const cleaned = rawText.replace(/\s+/g, ' ').trim();
    if (!cleaned) return;
    const normKey = normalizeSpeechCompareKey(cleaned);
    if (!normKey) return;

    const nowMs = Date.now();
    const acoustic = acousticTrackerRef.current.registerUtterance(nowMs, cleaned);
    const totalVoices = acousticTrackerRef.current.getDetectedSpeakerCount();
    setDetectedSpeakersCount(totalVoices);
    setActiveSpeakerLabel(acoustic.speaker);

    const shouldPrefixSpeaker =
      totalVoices > 1 || acousticTrackerRef.current.hasManualSwitch();
    const formattedLine = shouldPrefixSpeaker ? `${acoustic.speaker}: ${cleaned}` : cleaned;
    const {mergedLines, appended} = appendDedupedSpeechTurn(micLinesRef.current, formattedLine);
    if (!appended) return;

    lastFinalNormalizedRef.current = normKey;
    const nextTurns: SpeechTurnSegment[] = [
      ...micTurnsRef.current,
      {
        id: `turn_${nowMs}_${micTurnsRef.current.length}`,
        rawText: cleaned,
        acousticSpeaker: acoustic.speaker,
        centroidHz: acoustic.centroidHz,
        pauseBeforeMs: acoustic.pauseBeforeMs,
        timestampMs: nowMs,
      },
    ];
    micTurnsRef.current = nextTurns;
    micLinesRef.current = mergedLines;
    setMicLines(mergedLines);

    writeMicRecoveryDraft({
      lines: mergedLines,
      turns: nextTurns,
      title: sourceTitle,
      savedAt: new Date().toISOString(),
    });
  }

  async function handleAutoCategorizeReviewFolder() {
    if (!reviewDraft) return;
    setIsCategorizingFolder(true);
    try {
      const suggestion = await suggestSemanticFolderWithAi({
        brainUrl,
        backupBrainUrl,
        accessToken,
        model: brainModel,
        title: reviewDraft.title,
        content: reviewDraft.content,
        existingFolders: folders,
      });

      const mergedTags = Array.from(
        new Set([...parseTagsText(reviewDraft.tagsText), ...suggestion.tags]),
      ).join(', ');

      setReviewDraft((prev) =>
        prev
          ? {
              ...prev,
              folderId: onCreateFolder ? AUTO_FOLDER_OPTION : prev.folderId,
              autoFolderSuggestion: suggestion.folderName,
              autoFolderDescription: suggestion.description,
              tagsText: mergedTags,
            }
          : null,
      );
    } finally {
      setIsCategorizingFolder(false);
    }
  }

  async function handleConfirmReviewSave() {
    if (!reviewDraft) return;
    const cleanTitle = reviewDraft.title.trim();
    const cleanContent = reviewDraft.content.trim();
    if (!cleanTitle || !cleanContent) {
      setReviewError('Provide both a title and content before saving.');
      return;
    }

    setIsSavingReview(true);
    setReviewError(null);
    setErrorMessage(null);

    try {
      const tags = parseTagsText(reviewDraft.tagsText);
      let resolvedFolderId = reviewDraft.folderId;
      let autoFolderCreatedLabel = '';

      if (resolvedFolderId === AUTO_FOLDER_OPTION) {
        let folderName = reviewDraft.autoFolderSuggestion || '';
        let folderDesc = reviewDraft.autoFolderDescription || '';

        if (!folderName) {
          const classified = await suggestSemanticFolderWithAi({
            brainUrl,
            backupBrainUrl,
            accessToken,
            model: brainModel,
            title: cleanTitle,
            content: cleanContent,
            existingFolders: folders,
          });
          folderName = classified.folderName;
          folderDesc = classified.description;
        }

        if (onCreateFolder) {
          const ensured = await ensureAutoFolderExists(
            folderName,
            folderDesc,
            folders,
            onCreateFolder,
          );
          resolvedFolderId = ensured.folder?.id || folders[0]?.id || null;
          if (ensured.createdNew && ensured.folder) {
            autoFolderCreatedLabel = ` (auto-created "${ensured.folder.name}" folder)`;
          } else if (ensured.folder) {
            autoFolderCreatedLabel = ` in "${ensured.folder.name}"`;
          }
        } else {
          const fallback = inferFolderDeterministically(cleanTitle, cleanContent, folders);
          resolvedFolderId = fallback.matchedFolderId || folders[0]?.id || null;
        }
      }

      let savedCount = 0;

      if (reviewDraft.saveMode === 'single') {
        const ok = await onSaveEntry({
          folderId: resolvedFolderId,
          title: cleanTitle,
          content: cleanContent,
          tags: tags.length > 0 ? tags : [reviewDraft.sourceType.replace(/_/g, '-')],
          source: reviewDraft.sourceType,
          status: reviewDraft.status,
          sourceUrl: reviewDraft.sourceUrl ?? null,
          extractedAt: reviewDraft.extractedAt ?? null,
        });
        if (!ok) {
          setReviewError(
            'Could not save entry right now. Check the error banner or your connection and try again.',
          );
          return;
        }
        savedCount = 1;
      } else {
        let items: DistilledKnowledgeItem[] = [];
        if ((brainUrl.trim() || backupBrainUrl.trim()) && accessToken) {
          try {
            const distilled = await distillWithAiBrain({
              brainUrl,
              backupBrainUrl,
              accessToken,
              model: brainModel,
              text: cleanContent,
              sourceTitle: cleanTitle,
              sourceType: reviewDraft.sourceType,
            });
            items = distilled.entries;
          } catch {
            items = distillTextLocally(cleanContent, cleanTitle, reviewDraft.sourceType).entries;
          }
        } else {
          items = distillTextLocally(cleanContent, cleanTitle, reviewDraft.sourceType).entries;
        }

        if (items.length === 0) {
          setReviewError(
            'No split concepts could be extracted — switch Storage Format to Single Entry and save directly.',
          );
          return;
        }

        const chosenFolderName =
          reviewDraft.folderId === AUTO_FOLDER_OPTION
            ? reviewDraft.autoFolderSuggestion
            : folders.find((f) => f.id === resolvedFolderId)?.name;

        const preparedItems = items.map((item) => ({
          ...item,
          folder: chosenFolderName || item.folder,
          tags: Array.from(new Set([...item.tags, ...tags])),
        }));

        savedCount = await onSaveCapturedEntries(preparedItems, reviewDraft.sourceType, {
          status: reviewDraft.status,
          sourceUrl: reviewDraft.sourceUrl ?? null,
          extractedAt: reviewDraft.extractedAt ?? null,
        });
      }

      if (savedCount > 0) {
        setNotesLearned((prev) => prev + savedCount);
        setStatusMessage(
          `Saved ${savedCount} ${reviewDraft.status} Knowledge ${
            savedCount === 1 ? 'entry' : 'entries'
          }: "${cleanTitle}"${autoFolderCreatedLabel}`,
        );

        if (reviewDraft.kind === 'url' && reviewDraft.sourceUrl) {
          const urlKind =
            reviewDraft.sourceType === 'youtube_transcript' ? 'youtube' : 'article';
          setLinkHistory((prev) => [
            {
              id: `${Date.now()}`,
              url: reviewDraft.sourceUrl || '',
              title: cleanTitle,
              kind: urlKind,
              savedCount,
              createdAt: new Date().toISOString(),
            },
            ...prev.slice(0, 5),
          ]);
          setTargetUrl('');
        } else if (reviewDraft.kind === 'paste') {
          setPastedText('');
        } else if (reviewDraft.kind === 'mic') {
          micLinesRef.current = [];
          micTurnsRef.current = [];
          setMicLines([]);
          writeMicRecoveryDraft(null);
          setRecoverableMicDraft(null);
        }
      } else {
        setStatusMessage('Entries matched existing knowledge (no duplicate rows added).');
      }

      setReviewDraft(null);
      setReviewError(null);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Failed to save reviewed capture.');
    } finally {
      setIsSavingReview(false);
    }
  }

  function handleDiscardReview() {
    if (reviewDraft?.kind === 'mic') {
      micLinesRef.current = [];
      micTurnsRef.current = [];
      setMicLines([]);
      writeMicRecoveryDraft(null);
      setRecoverableMicDraft(null);
    }
    setReviewDraft(null);
    setReviewError(null);
    setStatusMessage('Capture discarded — nothing was saved to Knowledge.');
  }

  async function handleRefineOcrHighRes(zone: CaptureZone) {
    if (!reviewDraft?.sourceFiles || reviewDraft.sourceFiles.length === 0) return;
    setIsRefiningOcr(true);
    setReviewError(null);

    try {
      await onBeforeHeavyTask?.('High-Res OCR Refinement');
      let mergedLines: string[] = [];
      let confTotal = 0;
      let firstPreview: string | null = reviewDraft.previewDataUrl || null;

      for (let i = 0; i < reviewDraft.sourceFiles.length; i += 1) {
        const res = await recognizeImageBlob(reviewDraft.sourceFiles[i], {
          zone,
          mode: 'high_res',
        });
        if (i === 0 && res.previewDataUrl) {
          firstPreview = res.previewDataUrl;
        }
        confTotal += res.confidence;
        if (res.text.trim()) {
          mergedLines = mergeIncrementalCaption(mergedLines, res.text).mergedLines;
        }
      }

      const avgConf = Math.round(confTotal / reviewDraft.sourceFiles.length);
      const refinedText = mergedLines.join('\n').trim();

      setLastConfidence(avgConf);
      setReviewDraft((prev) =>
        prev
          ? {
              ...prev,
              content: refinedText || prev.content,
              previewDataUrl: firstPreview,
              ocrConfidence: avgConf,
              ocrZone: zone,
              ocrMode: 'high_res',
              ocrNotice: refinedText
                ? 'High-resolution OCR refinement complete. Verify text below before saving.'
                : 'No clear text detected at high resolution — you can still type or edit notes manually below.',
            }
          : null,
      );
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'High-res OCR refinement failed.');
    } finally {
      setIsRefiningOcr(false);
    }
  }

  async function scanSingleVideoFrame() {
    const video = videoRef.current;
    if (!video || isScanningFrameRef.current || video.readyState < 2) return;
    isScanningFrameRef.current = true;
    try {
      const result = await captureVideoFrameText(video, captureZone, prevLuminanceGridRef.current);
      prevLuminanceGridRef.current = result.grid;
      if (result.previewDataUrl) {
        setCropPreviewUrl(result.previewDataUrl);
      }

      if (result.skippedUnchanged) {
        setFramesSkipped((n) => n + 1);
        return;
      }

      setFramesScanned((n) => n + 1);
      setLastConfidence(result.confidence);

      if (result.text.trim()) {
        const {mergedLines, addedText} = mergeIncrementalCaption(linesRef.current, result.text);
        if (addedText) {
          linesRef.current = mergedLines;
          setCapturedLines(mergedLines);
        }
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'OCR frame scan error.');
    } finally {
      isScanningFrameRef.current = false;
    }
  }

  async function handleStartScreenCapture() {
    setErrorMessage(null);
    setStatusMessage(null);
    if (!supportsDisplayCapture()) {
      setErrorMessage(
        'Screen recording via browser tab is blocked on Android Chrome. Use YouTube / Article URL or Screenshots & Live Mic tabs on this tablet.',
      );
      return;
    }

    try {
      await onBeforeHeavyTask?.('Live Screen OCR');
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {frameRate: {ideal: 5, max: 10}},
        audio: false,
      });
      streamRef.current = stream;
      prevLuminanceGridRef.current = null;

      const [videoTrack] = stream.getVideoTracks();
      if (videoTrack) {
        videoTrack.onended = () => {
          stopScreenCapture();
        };
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setIsRecordingScreen(true);
      setStatusMessage(
        `Recording live (${
          captureZone === 'bottom_captions'
            ? 'YouTube Captions Strip'
            : captureZone === 'center_article'
              ? 'Center Article'
              : 'Full Screen'
        }). Lines collect in your review buffer without auto-saving.`,
      );

      window.setTimeout(() => void scanSingleVideoFrame(), 650);
      timerRef.current = window.setInterval(() => {
        void scanSingleVideoFrame();
      }, scanIntervalMs);
    } catch (err) {
      stopScreenCapture();
      setErrorMessage(
        err instanceof Error ? err.message : 'Screen capture permission was cancelled or denied.',
      );
    }
  }

  function handleStopAndReviewScreen() {
    stopScreenCapture();
    const collected = linesRef.current.join('\n').trim();
    if (!collected) {
      setStatusMessage('Screen recording stopped — no readable text lines were captured.');
      return;
    }
    const title = sourceTitle.trim() || `Screen OCR – ${new Date().toLocaleDateString()}`;
    const folderInit = resolveInitialFolderSelection(
      title,
      collected,
      folders,
      Boolean(onCreateFolder),
    );
    setReviewDraft({
      kind: 'ocr',
      sourceType: 'screen_ocr',
      title,
      content: collected,
      folderId: folderInit.folderId,
      autoFolderSuggestion: folderInit.suggestion,
      autoFolderDescription: folderInit.description,
      tagsText: 'screen, ocr',
      status: 'reviewed',
      saveMode: collected.length > 2200 ? 'distill' : 'single',
      previewDataUrl: cropPreviewUrl,
      ocrConfidence: lastConfidence,
      ocrZone: captureZone,
      ocrMode: 'fast',
      ocrNotice: 'Review and clean up captured screen text before saving to Knowledge.',
    });
  }

  function handleOpenBufferReview() {
    const collected = linesRef.current.join('\n').trim();
    if (!collected) return;
    const title = sourceTitle.trim() || 'Captured Buffer Note';
    const folderInit = resolveInitialFolderSelection(
      title,
      collected,
      folders,
      Boolean(onCreateFolder),
    );
    setReviewDraft({
      kind: 'paste',
      sourceType: 'capture_buffer',
      title,
      content: collected,
      folderId: folderInit.folderId,
      autoFolderSuggestion: folderInit.suggestion,
      autoFolderDescription: folderInit.description,
      tagsText: 'captured, notes',
      status: 'reviewed',
      saveMode: collected.length > 2200 ? 'distill' : 'single',
    });
  }

  async function handleExtractUrlSubmit(event: FormEvent) {
    event.preventDefault();
    const clean = normalizeExternalUrl(targetUrl);
    if (!clean) {
      setErrorMessage('Paste a YouTube video URL or web article link first.');
      return;
    }
    setTargetUrl(clean);
    setErrorMessage(null);
    setStatusMessage(null);
    setIsExtractingUrl(true);
    setExtractStepText('1/2 Fetching clean article body or video transcript...');

    try {
      const extracted = await extractUrlViaBrain({
        brainUrl,
        backupBrainUrl,
        accessToken,
        url: clean,
      });

      setExtractStepText('2/2 Classifying topic folder & preparing preview...');
      const sourceType = extracted.kind === 'youtube' ? 'youtube_transcript' : 'article_ingest';
      const folderGuess = await suggestSemanticFolderWithAi({
        brainUrl,
        backupBrainUrl,
        accessToken,
        model: brainModel,
        title: extracted.title,
        content: extracted.text,
        existingFolders: folders,
      }).catch(() => {
        const local = inferFolderDeterministically(extracted.title, extracted.text, folders);
        return {folderName: local.folderName, description: local.description, tags: local.suggestedTags};
      });

      setReviewDraft({
        kind: 'url',
        sourceType,
        title: extracted.title,
        content: extracted.text,
        folderId: onCreateFolder ? AUTO_FOLDER_OPTION : folders[0]?.id || null,
        autoFolderSuggestion: folderGuess.folderName,
        autoFolderDescription: folderGuess.description,
        tagsText: Array.from(
          new Set([
            extracted.kind === 'youtube' ? 'youtube' : 'article',
            extracted.kind === 'youtube' ? 'transcript' : 'web',
            ...folderGuess.tags,
          ]),
        ).join(', '),
        status: 'reviewed',
        saveMode: extracted.text.length > 2600 ? 'distill' : 'single',
        sourceUrl: extracted.url,
        extractedAt: extracted.extractedAt,
      });
      setExtractStepText(null);
    } catch (err) {
      setExtractStepText(null);
      setErrorMessage(err instanceof Error ? err.message : 'Could not extract URL text.');
    } finally {
      setIsExtractingUrl(false);
    }
  }

  function handleOpenPastedReview(event: FormEvent) {
    event.preventDefault();
    const clean = pastedText.trim();
    if (!clean) return;
    setErrorMessage(null);
    const defaultTitle =
      sourceTitle.trim() && sourceTitle.trim() !== 'Ingested Learning Session'
        ? sourceTitle.trim()
        : 'Pasted Article / Notes';
    const folderInit = resolveInitialFolderSelection(
      defaultTitle,
      clean,
      folders,
      Boolean(onCreateFolder),
    );

    setReviewDraft({
      kind: 'paste',
      sourceType: 'article_ingest',
      title: defaultTitle,
      content: clean,
      folderId: folderInit.folderId,
      autoFolderSuggestion: folderInit.suggestion,
      autoFolderDescription: folderInit.description,
      tagsText: 'article, notes',
      status: 'reviewed',
      saveMode: clean.length > 2600 ? 'distill' : 'single',
      extractedAt: new Date().toISOString(),
    });
  }

  async function processImageFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setIsOcrImageBusy(true);
    setErrorMessage(null);
    setStatusMessage(`Running fast low-res OCR across ${list.length} image(s)...`);

    try {
      await onBeforeHeavyTask?.('Screenshot OCR');
      let mergedLines: string[] = [];
      let confTotal = 0;
      let firstPreview: string | null = null;

      for (let i = 0; i < list.length; i += 1) {
        const res = await recognizeImageBlob(list[i], {
          zone: imageOcrZone,
          mode: 'fast',
        });
        setFramesScanned((n) => n + 1);
        confTotal += res.confidence;
        if (i === 0) {
          firstPreview = res.previewDataUrl;
        }
        if (res.text.trim()) {
          mergedLines = mergeIncrementalCaption(mergedLines, res.text).mergedLines;
        }
      }

      const avgConfidence = Math.round(confTotal / list.length);
      setLastConfidence(avgConfidence);
      if (firstPreview) {
        setCropPreviewUrl(firstPreview);
      }

      const recognizedText = mergedLines.join('\n').trim();
      const baseTitle =
        sourceTitle.trim() && sourceTitle.trim() !== 'Ingested Learning Session'
          ? sourceTitle.trim()
          : list[0]?.name
            ? `Screenshot – ${list[0].name.replace(/\.[^.]+$/, '')}`
            : 'Screenshot OCR Capture';
      const folderInit = resolveInitialFolderSelection(
        baseTitle,
        recognizedText,
        folders,
        Boolean(onCreateFolder),
      );

      setStatusMessage(null);
      setReviewDraft({
        kind: 'ocr',
        sourceType: 'screenshot_ocr',
        title: baseTitle,
        content: recognizedText,
        folderId: folderInit.folderId,
        autoFolderSuggestion: folderInit.suggestion,
        autoFolderDescription: folderInit.description,
        tagsText: 'screenshot, ocr',
        status: 'reviewed',
        saveMode: 'single',
        previewDataUrl: firstPreview,
        ocrConfidence: avgConfidence,
        ocrZone: imageOcrZone,
        ocrMode: 'fast',
        sourceFiles: list,
        ocrNotice: recognizedText
          ? avgConfidence < 60
            ? 'OCR confidence is low on the fast pass. Try switching crop region or tapping Refine High-Res before saving.'
            : null
          : 'No clear words detected on the fast pass. Try switching OCR Region or tapping Refine High-Res.',
      });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Image OCR failed.');
    } finally {
      setIsOcrImageBusy(false);
    }
  }

  function handlePasteClipboard(event: ClipboardEvent<HTMLDivElement>) {
    const items = event.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      event.preventDefault();
      void processImageFiles(imageFiles);
    }
  }

  function startMicActivityMonitor() {
    if (micDecayTimerRef.current !== null) {
      window.clearInterval(micDecayTimerRef.current);
    }
    if (micClockTimerRef.current !== null) {
      window.clearInterval(micClockTimerRef.current);
    }
    micClockTimerRef.current = window.setInterval(() => {
      if (isMicWantedRef.current && !isMicPausedRef.current) {
        setMicElapsedSeconds((s) => s + 1);
      }
    }, 1000);

    // Smooth signal envelope monitor + Web Audio fallback
    micDecayTimerRef.current = window.setInterval(() => {
      if (!isMicWantedRef.current || isMicPausedRef.current) {
        micLevelTargetRef.current = 0;
        return;
      }
      micLevelTargetRef.current = Math.max(12, Math.round(micLevelTargetRef.current * 0.78));
    }, 95);

    // Watchdog prevents silent Web Speech freezes on Chromebook & Android Chrome
    micWatchdogTimerRef.current = window.setInterval(() => {
      if (!isMicWantedRef.current || isMicPausedRef.current) return;
      const idleMs = Date.now() - micActivityAtRef.current;
      if (idleMs > 12000 && !latestInterimRef.current.trim()) {
        micActivityAtRef.current = Date.now();
        tearDownRecognitionInstance();
        spawnRecognitionSession();
      }
    }, 4000);
  }

  async function tryAttachAcousticProbe() {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof AudioContext === 'undefined'
    ) {
      setAcousticMode('cadence');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!isMicWantedRef.current) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      const ctx = new AudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      src.connect(analyser);

      micAudioStreamRef.current = stream;
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      waveformBinsRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      acousticProbeActiveRef.current = true;
      setAcousticMode('acoustic');
    } catch {
      teardownAcousticProbe();
    }
  }

  function scheduleMicRestart(delayMs: number) {
    if (micRestartTimerRef.current !== null) {
      window.clearTimeout(micRestartTimerRef.current);
    }
    micRestartTimerRef.current = window.setTimeout(() => {
      micRestartTimerRef.current = null;
      if (isMicWantedRef.current && !isMicPausedRef.current) {
        spawnRecognitionSession();
      }
    }, delayMs);
  }

  function spawnRecognitionSession() {
    if (!isMicWantedRef.current || isMicPausedRef.current) return;
    tearDownRecognitionInstance();

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechCtor = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechCtor) return;

    const recognition = new SpeechCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    recognition.lang = micLang || 'en-US';

    const markPulse = (boost: number) => {
      micActivityAtRef.current = Date.now();
      micLevelTargetRef.current = Math.min(100, Math.max(micLevelTargetRef.current, boost));
    };

    recognition.onaudiostart = () => {
      micRetryCountRef.current = 0;
      markPulse(28);
    };
    recognition.onsoundstart = () => markPulse(48);
    recognition.onspeechstart = () => markPulse(78);
    recognition.onspeechend = () => {
      micLevelTargetRef.current = 20;
    };
    recognition.onsoundend = () => {
      micLevelTargetRef.current = 14;
    };

    recognition.onresult = (event) => {
      micRetryCountRef.current = 0;
      markPulse(88);

      const finals: string[] = [];
      let liveInterim = '';

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const res = event.results[i];
        const alternatives: Array<{transcript: string; confidence?: number}> = [];
        for (let alt = 0; alt < res.length; alt += 1) {
          const cand = res[alt];
          if (cand?.transcript?.trim()) {
            alternatives.push({transcript: cand.transcript.trim(), confidence: cand.confidence});
          }
        }
        const bestTranscript = res.isFinal
          ? rerankSpeechAlternatives(alternatives, speechLexiconRef.current)
          : alternatives[0]?.transcript || '';
        if (!bestTranscript) continue;

        if (res.isFinal) {
          finals.push(bestTranscript);
        } else {
          liveInterim = liveInterim ? `${liveInterim} ${bestTranscript}` : bestTranscript;
        }
      }

      latestInterimRef.current = liveInterim;
      setInterimTranscript(liveInterim);

      for (const finalPhrase of finals) {
        commitSpeechSegment(finalPhrase);
      }
      if (finals.length > 0 && !liveInterim) {
        latestInterimRef.current = '';
        setInterimTranscript('');
      }
    };

    recognition.onerror = (ev) => {
      const errCode = ev.error || '';
      if (errCode === 'no-speech' || errCode === 'aborted') {
        return;
      }
      if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
        setErrorMessage(
          'Microphone permission blocked. Tap the lock/site icon in your browser address bar, set Microphone to Allow, and retry.',
        );
        stopMicCapture();
        return;
      }
      if (errCode === 'audio-capture') {
        // On Android/Chromebook devices that enforce exclusive mic locks, drop the secondary acoustic probe automatically and keep dictation running
        if (acousticProbeActiveRef.current) {
          teardownAcousticProbe();
          setStatusMessage('Switched automatically to Pause & Tap Cadence mode to avoid hardware mic conflict.');
          scheduleMicRestart(250);
          return;
        }
        setErrorMessage(
          'No active microphone device found or another app/tab holds exclusive mic control. Close other mic tabs and tap Start Recording.',
        );
        stopMicCapture();
        return;
      }
      if (errCode === 'network') {
        setStatusMessage('Speech network hiccup — reconnecting live listener automatically…');
        return;
      }
      setStatusMessage(`Mic listener notice (${errCode || 'reconnecting'}) — keeping recording alive…`);
    };

    recognition.onend = () => {
      const pendingInterim = latestInterimRef.current.trim();
      if (pendingInterim && isMicWantedRef.current) {
        const interimKey = normalizeSpeechCompareKey(pendingInterim);
        if (
          interimKey &&
          interimKey !== lastFinalNormalizedRef.current &&
          !lastFinalNormalizedRef.current.endsWith(interimKey)
        ) {
          commitSpeechSegment(pendingInterim);
        }
        latestInterimRef.current = '';
        setInterimTranscript('');
      }

      if (isMicWantedRef.current && !isMicPausedRef.current) {
        const attempt = micRetryCountRef.current;
        micRetryCountRef.current = Math.min(attempt + 1, 5);
        const delayMs = attempt === 0 ? 180 : attempt === 1 ? 380 : 750;
        scheduleMicRestart(delayMs);
      } else if (!isMicWantedRef.current) {
        setIsListeningMic(false);
      }
    };

    recognitionRef.current = recognition;
    micActivityAtRef.current = Date.now();
    try {
      recognition.start();
    } catch {
      if (isMicWantedRef.current && !isMicPausedRef.current) {
        scheduleMicRestart(350);
      }
    }
  }

  function handleTogglePauseMic() {
    if (!isListeningMic) return;
    if (isMicPaused) {
      isMicPausedRef.current = false;
      setIsMicPaused(false);
      setStatusMessage('Recording resumed — speak naturally.');
      spawnRecognitionSession();
    } else {
      const pending = latestInterimRef.current.trim();
      if (pending) {
        commitSpeechSegment(pending);
        latestInterimRef.current = '';
        setInterimTranscript('');
      }
      isMicPausedRef.current = true;
      setIsMicPaused(true);
      tearDownRecognitionInstance();
      setStatusMessage('Recording paused — tap Resume to continue or Stop & Review.');
    }
  }

  async function handleToggleMic() {
    setErrorMessage(null);
    if (isListeningMic) {
      const trailing = latestInterimRef.current.trim();
      if (trailing) {
        const trailingKey = normalizeSpeechCompareKey(trailing);
        if (trailingKey && trailingKey !== lastFinalNormalizedRef.current) {
          commitSpeechSegment(trailing);
        }
      }

      stopMicCapture();
      const capturedTurns = [...micTurnsRef.current];
      const combinedLines = [...micLinesRef.current];
      const rawText = combinedLines.join('\n').trim();

      if (!rawText && capturedTurns.length === 0) {
        setStatusMessage(
          'Recording stopped — no speech detected. Check your microphone input and tap Start Recording to retry.',
        );
        micLinesRef.current = [];
        micTurnsRef.current = [];
        setMicLines([]);
        return;
      }

      setIsPolishingMic(true);
      setStatusMessage(
        'Connected AI is polishing fast speech, labeling voices, and detecting topic folder…',
      );

      try {
        const enhanced = await enhanceSpeechTranscriptWithAi({
          brainUrl,
          backupBrainUrl,
          accessToken,
          model: brainModel,
          turns: capturedTurns,
          rawLines: combinedLines,
          entries,
          existingFolders: folders,
        });

        const baseTitle = formatConversationTitle();
        const customSuffix =
          sourceTitle.trim() && sourceTitle.trim() !== 'Ingested Learning Session'
            ? sourceTitle.trim()
            : enhanced.suggestedTitle;
        const finalTitle = customSuffix ? `${baseTitle} · ${customSuffix}` : baseTitle;

        setStatusMessage(null);
        setReviewDraft({
          kind: 'mic',
          sourceType: 'mic_transcript',
          title: finalTitle,
          content: enhanced.cleanedTranscript,
          folderId: onCreateFolder ? AUTO_FOLDER_OPTION : folders[0]?.id || null,
          autoFolderSuggestion: enhanced.suggestedFolder,
          autoFolderDescription: enhanced.folderDescription,
          tagsText: enhanced.tags.join(', '),
          status: 'reviewed',
          saveMode: enhanced.cleanedTranscript.length > 2800 ? 'distill' : 'single',
          extractedAt: new Date().toISOString(),
          micAiPolished: enhanced.aiEnhanced,
          micModelUsed: enhanced.modelUsed,
          micSpeakerCount: enhanced.speakerCount,
        });
      } finally {
        setIsPolishingMic(false);
      }
      return;
    }

    if (!supportsSpeechRecognition()) {
      setErrorMessage('Speech recognition is unavailable in this browser.');
      return;
    }

    acousticTrackerRef.current.reset();
    micLinesRef.current = [];
    micTurnsRef.current = [];
    lastFinalNormalizedRef.current = '';
    micRetryCountRef.current = 0;
    writeMicRecoveryDraft(null);
    setRecoverableMicDraft(null);
    setMicLines([]);
    setDetectedSpeakersCount(1);
    setActiveSpeakerLabel('Speaker 1');
    setIsManualSpeakerMode(false);
    setMicElapsedSeconds(0);
    latestInterimRef.current = '';
    setInterimTranscript('');

    isMicWantedRef.current = true;
    isMicPausedRef.current = false;
    setIsMicPaused(false);
    setIsListeningMic(true);
    setStatusMessage(
      'Recording live speech with domain lexicon reranking & multi-voice tracking. Tap Pause or Stop anytime.',
    );
    startMicActivityMonitor();
    spawnRecognitionSession();
    void tryAttachAcousticProbe();
  }

  function handleRestoreRecoverableDraft() {
    if (!recoverableMicDraft) return;
    const formatted = formatTranscriptLocally(recoverableMicDraft.turns, recoverableMicDraft.lines);
    const baseTitle = formatConversationTitle();
    const customSuffix = recoverableMicDraft.title && recoverableMicDraft.title !== 'Ingested Learning Session'
      ? recoverableMicDraft.title
      : '';
    const inferred = inferFolderDeterministically(customSuffix || baseTitle, formatted.cleanedTranscript, folders);
    setReviewDraft({
      kind: 'mic',
      sourceType: 'mic_transcript',
      title: customSuffix ? `${baseTitle} · ${customSuffix}` : baseTitle,
      content: formatted.cleanedTranscript || recoverableMicDraft.lines.join('\n'),
      folderId: onCreateFolder ? AUTO_FOLDER_OPTION : folders[0]?.id || null,
      autoFolderSuggestion: inferred.folderName,
      autoFolderDescription: inferred.description,
      tagsText: inferred.suggestedTags.join(', ') || 'voice, transcript',
      status: 'reviewed',
      saveMode: formatted.cleanedTranscript.length > 2800 ? 'distill' : 'single',
      extractedAt: recoverableMicDraft.savedAt,
      micAiPolished: false,
      micSpeakerCount: Math.max(1, formatted.detectedSpeakers.length),
    });
  }

  function handleSelectManualSpeaker(label: string | 'auto') {
    if (label === 'auto') {
      acousticTrackerRef.current.clearManualSpeaker();
      setIsManualSpeakerMode(false);
      setActiveSpeakerLabel(acousticTrackerRef.current.getActiveSpeaker());
      return;
    }
    const chosen = acousticTrackerRef.current.setActiveSpeaker(label);
    setIsManualSpeakerMode(true);
    setActiveSpeakerLabel(chosen);
    setDetectedSpeakersCount(acousticTrackerRef.current.getDetectedSpeakerCount());
  }

  function handleAddSpeakerVoice() {
    const chosen = acousticTrackerRef.current.addNextSpeaker();
    setIsManualSpeakerMode(true);
    setActiveSpeakerLabel(chosen);
    setDetectedSpeakersCount(acousticTrackerRef.current.getDetectedSpeakerCount());
  }

  return (
    <div className="mantis-fade-in mx-auto max-w-5xl space-y-5" onPaste={handlePasteClipboard}>
      <div className="flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            Ingest &amp; Review Capture Lab
          </h1>
          <p className="text-sm text-ink-muted">
            Extract links, run fast OCR on screenshots, or capture multi-voice speech with AI cleanup and Auto-Folder filing.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums text-ink-muted">
          <span>{framesScanned} OCR scans</span>
          {framesSkipped > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>{framesSkipped} skipped static</span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span>{capturedLines.length} buffer lines</span>
          <span aria-hidden="true">·</span>
          <span className="text-accent-text">{notesLearned} saved</span>
        </div>
      </div>

      {/* Mode Selector */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface p-1.5">
        <button
          type="button"
          onClick={() => setActiveTab('url_text')}
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-colors ${
            activeTab === 'url_text'
              ? 'bg-elevated text-ink'
              : 'text-ink-muted hover:text-ink'
          }`}
        >
          <Globe className="h-4 w-4" />
          <span>YouTube &amp; Article Links</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('image_mic')}
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-colors ${
            activeTab === 'image_mic'
              ? 'bg-elevated text-ink'
              : 'text-ink-muted hover:text-ink'
          }`}
        >
          <Mic className="h-4 w-4" />
          <span>AI Mic &amp; Screenshot OCR</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('screen')}
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-colors ${
            activeTab === 'screen'
              ? 'bg-elevated text-ink'
              : 'text-ink-muted hover:text-ink'
          }`}
        >
          <Monitor className="h-4 w-4" />
          <span>Screen OCR (Chromebook / Desktop)</span>
        </button>
      </div>

      {/* Shared Session Title Prefix */}
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="space-y-1">
          <label htmlFor="capture-topic" className="block text-xs font-medium text-ink-muted">
            Optional Session Label (editable again in Preview before saving)
          </label>
          <input
            id="capture-topic"
            type="text"
            value={sourceTitle}
            onChange={(e) => setSourceTitle(e.target.value)}
            placeholder="e.g. TypeScript Patterns or Kitchen Definitions"
            className="min-h-[44px] w-full rounded-md border border-line-strong bg-inset px-3.5 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      {/* Tab 1: YouTube / Article URL + Bulk Paste */}
      {activeTab === 'url_text' && (
        <div className="space-y-4">
          <form
            onSubmit={handleExtractUrlSubmit}
            className="space-y-3 rounded-lg border border-line bg-surface p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Link2 className="h-4 w-4 text-accent-text" />
                <span>Extract &amp; Preview from YouTube or Web Article URL</span>
              </div>
              {!(brainUrl.trim() || backupBrainUrl.trim()) && (
                <span className="font-mono text-[11px] text-warn">
                  Browser readability fallback (add Cloud Backup in Settings for YouTube captions)
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2.5 sm:flex-row">
              <input
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="Paste youtube.com/watch?v=... or any documentation URL"
                className="min-h-[44px] flex-1 rounded-md border border-line-strong bg-inset px-3.5 py-2 font-mono text-xs text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
              />
              <button
                type="submit"
                disabled={isExtractingUrl}
                className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-md bg-accent px-5 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
              >
                <Eye className="h-4 w-4" />
                <span>{isExtractingUrl ? 'Extracting…' : 'Extract & Preview'}</span>
              </button>
            </div>

            {extractStepText && (
              <div className="rounded-md border border-line bg-inset px-3.5 py-2 font-mono text-xs text-accent-text">
                {extractStepText}
              </div>
            )}

            {linkHistory.length > 0 && (
              <div className="space-y-1.5 border-t border-line pt-3">
                <div className="text-[11px] font-medium text-ink-muted">Saved Links (Session)</div>
                <div className="space-y-1">
                  {linkHistory.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-line bg-inset px-3 py-1.5 text-xs"
                    >
                      <span className="truncate font-medium text-ink">{item.title}</span>
                      <span className="font-mono text-[11px] tabular-nums text-accent-text">
                        {item.kind} · {item.savedCount} saved
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </form>

          <form
            onSubmit={handleOpenPastedReview}
            className="space-y-3 rounded-lg border border-line bg-surface p-5"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <FileText className="h-4 w-4 text-accent-text" />
              <span>Paste Article, Docs Page, or Transcript</span>
            </div>
            <textarea
              rows={5}
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Paste any article, notes, or transcript here — opens an editable preview before saving..."
              className="w-full rounded-md border border-line-strong bg-inset p-3.5 font-mono text-xs leading-relaxed text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!pastedText.trim()}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-line-strong bg-elevated px-4 py-2 text-xs font-semibold text-ink hover:opacity-90 disabled:opacity-50"
              >
                <Eye className="h-4 w-4 text-accent-text" />
                <span>Preview &amp; Save Text</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tab 2: AI Multi-Voice Live Mic & Screenshot OCR */}
      {activeTab === 'image_mic' && (
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Mic Record -> AI Clean & Multi-Speaker Diarize -> Review -> Auto-Folder Save */}
          <div className="space-y-3 rounded-lg border border-line bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Mic className="h-4 w-4 text-accent-text" />
                <span>AI Multi-Voice Studio</span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-ink-muted">
                {isListeningMic && (
                  <span className="inline-flex items-center gap-1 text-accent-text">
                    <Users className="h-3 w-3" />
                    <span>
                      {isMicPaused
                        ? 'Paused'
                        : detectedSpeakersCount > 1 || isManualSpeakerMode
                          ? `${detectedSpeakersCount} voices (${activeSpeakerLabel})`
                          : activeSpeakerLabel}
                    </span>
                  </span>
                )}
                <span>
                  {isListeningMic
                    ? `${formatDurationClock(micElapsedSeconds)} · ${spokenWordCount}w`
                    : 'Ready'}
                </span>
              </div>
            </div>

            <p className="text-xs leading-relaxed text-ink-muted">
              Domain-lexicon speech reranker with live spectrum visualizer, turn auto-recovery, and multi-voice switching.
            </p>

            {recoverableMicDraft && !isListeningMic && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warn-border bg-warn-soft px-3 py-2 text-xs">
                <span className="text-ink">
                  Recovered unsaved transcript ({recoverableMicDraft.lines.length} turns)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleRestoreRecoverableDraft}
                    className="min-h-[40px] rounded bg-accent px-3 py-1 text-xs font-semibold text-white hover:bg-accent-hover"
                  >
                    Open &amp; Polish
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      writeMicRecoveryDraft(null);
                      setRecoverableMicDraft(null);
                    }}
                    className="min-h-[40px] rounded border border-line-strong bg-surface px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}

            {/* Speech Language Selector */}
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="mic-lang-select" className="block text-xs font-medium text-ink-muted">
                  Recognition Language
                </label>
                <span className="font-mono text-[10px] text-ink-subtle">
                  {acousticMode === 'acoustic' ? 'Acoustic FFT + Cadence' : 'Pause + Tap Cadence'}
                </span>
              </div>
              <select
                id="mic-lang-select"
                value={micLang}
                disabled={isListeningMic || isPolishingMic}
                onChange={(e) => setMicLang(e.target.value)}
                className="min-h-[44px] w-full rounded-md border border-line-strong bg-inset px-3 py-2 text-xs text-ink focus:border-accent focus:outline-none disabled:opacity-60"
              >
                {SPEECH_LANG_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Live Spectrum / Cadence Canvas Visualizer */}
            <div className="rounded-md border border-line bg-inset px-2.5 py-1.5">
              <canvas
                ref={waveformCanvasRef}
                aria-label="Live microphone waveform visualizer"
                className="h-9 w-full block"
              />
            </div>

            {/* Live Multi-Voice Switcher (Active while recording) */}
            {isListeningMic && (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleSelectManualSpeaker('auto')}
                  className={`min-h-[40px] rounded border px-2.5 text-[11px] font-medium transition-colors ${
                    !isManualSpeakerMode
                      ? 'border-accent-border bg-accent-soft text-accent-text'
                      : 'border-line bg-inset text-ink-muted hover:text-ink'
                  }`}
                >
                  Auto Detect
                </button>
                {Array.from({length: Math.max(2, detectedSpeakersCount)}).map((_, idx) => {
                  const lbl = `Speaker ${idx + 1}`;
                  const active = isManualSpeakerMode && activeSpeakerLabel === lbl;
                  return (
                    <button
                      key={lbl}
                      type="button"
                      onClick={() => handleSelectManualSpeaker(lbl)}
                      className={`min-h-[40px] rounded border px-2.5 text-[11px] font-medium transition-colors ${
                        active
                          ? 'border-accent-border bg-accent-soft text-accent-text'
                          : 'border-line bg-inset text-ink-muted hover:text-ink'
                      }`}
                    >
                      {lbl}
                    </button>
                  );
                })}
                {detectedSpeakersCount < 6 && (
                  <button
                    type="button"
                    onClick={handleAddSpeakerVoice}
                    className="min-h-[40px] rounded border border-dashed border-line-strong bg-inset px-2.5 text-[11px] font-medium text-ink-muted hover:text-ink"
                  >
                    + Voice
                  </button>
                )}
              </div>
            )}

            {(isListeningMic || micLines.length > 0 || isPolishingMic) && (
              <div className="max-h-40 min-h-[60px] space-y-1 overflow-auto rounded-md border border-line bg-inset px-3 py-2 font-mono text-xs">
                {micLines.length > 0 && (
                  <div className="whitespace-pre-wrap text-ink">{micLines.join('\n')}</div>
                )}
                {isListeningMic && (
                  <div className="text-accent-text">
                    {isMicPaused
                      ? 'Paused — tap Resume to continue capturing.'
                      : interimTranscript || 'Listening for speech…'}
                  </div>
                )}
                {isPolishingMic && (
                  <div className="flex items-center gap-2 text-accent-text">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Polishing fast speech &amp; labeling speakers…</span>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {isListeningMic && (
                <button
                  type="button"
                  disabled={isPolishingMic}
                  onClick={handleTogglePauseMic}
                  className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-md border border-line-strong bg-inset px-3.5 py-2 text-xs font-semibold text-ink hover:bg-elevated disabled:opacity-50"
                >
                  {isMicPaused ? (
                    <>
                      <Play className="h-4 w-4 text-accent-text" />
                      <span>Resume</span>
                    </>
                  ) : (
                    <>
                      <Pause className="h-4 w-4 text-warn" />
                      <span>Pause</span>
                    </>
                  )}
                </button>
              )}

              <button
                type="button"
                disabled={!hasMicApi || isPolishingMic}
                onClick={() => void handleToggleMic()}
                className={`inline-flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-50 ${
                  isListeningMic
                    ? 'bg-red-600 hover:bg-red-500'
                    : 'bg-accent hover:bg-accent-hover'
                }`}
              >
                {isPolishingMic ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isListeningMic ? (
                  <MicOff className="h-4 w-4" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
                <span>
                  {!hasMicApi
                    ? 'Speech API Unsupported Here'
                    : isPolishingMic
                      ? 'Polishing Transcript…'
                      : isListeningMic
                        ? 'Stop & AI Review'
                        : 'Start Recording'}
                </span>
              </button>
            </div>
          </div>

          {/* Screenshot OCR with ROI Crop + Fast Pass -> Preview Modal */}
          <div className="space-y-3 rounded-lg border border-line bg-surface p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Camera className="h-4 w-4 text-accent-text" />
              <span>Screenshot / Image OCR</span>
            </div>
            <p className="text-xs leading-relaxed text-ink-muted">
              Runs a fast lower-res OCR pass on your selected crop region, then opens an editable preview with confidence score and High-Res refinement.
            </p>

            <div className="space-y-1">
              <label htmlFor="image-ocr-zone" className="block text-xs font-medium text-ink-muted">
                Crop Focus Region
              </label>
              <select
                id="image-ocr-zone"
                value={imageOcrZone}
                disabled={isOcrImageBusy}
                onChange={(e) => setImageOcrZone(e.target.value as CaptureZone)}
                className="min-h-[44px] w-full rounded-md border border-line-strong bg-inset px-3 py-2 text-xs text-ink focus:border-accent focus:outline-none disabled:opacity-60"
              >
                <option value="full">Full Image</option>
                <option value="center_article">Center Article / Code Region</option>
                <option value="bottom_captions">Bottom Captions Strip</option>
              </select>
            </div>

            <label className="flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-line-strong bg-inset px-4 py-3 text-xs font-semibold text-ink hover:border-accent-border hover:bg-elevated/60">
              <ClipboardPaste className="h-4 w-4 text-accent-text" />
              <span>
                {isOcrImageBusy
                  ? 'Running Fast OCR Pass…'
                  : 'Choose Screenshot(s) or Ctrl+V Paste'}
              </span>
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={isOcrImageBusy}
                onChange={(e) => {
                  if (e.target.files) {
                    void processImageFiles(e.target.files);
                    e.target.value = '';
                  }
                }}
                className="sr-only"
              />
            </label>
          </div>
        </div>
      )}

      {/* Tab 3: Diff-Gated Screen OCR */}
      {activeTab === 'screen' && (
        <section className="space-y-4 rounded-lg border border-line bg-surface p-5">
          {!hasDisplayApi && (
            <div className="rounded-md border border-warn-border bg-warn-soft p-4 text-xs leading-relaxed text-warn">
              <strong>Android Browser Notice:</strong> Chrome on Android blocks{' '}
              <code className="font-mono">getDisplayMedia</code>. On your Galaxy Tab A9+, use{' '}
              <strong>YouTube &amp; Article Links</strong> or <strong>AI Mic &amp; Screenshot OCR</strong>. On Chromebook,{' '}
              <strong>Record Screen &amp; Read</strong> works natively.
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label htmlFor="ocr-zone" className="block text-xs font-medium text-ink-muted">
                OCR Focus Zone
              </label>
              <select
                id="ocr-zone"
                disabled={isRecordingScreen}
                value={captureZone}
                onChange={(e) => setCaptureZone(e.target.value as CaptureZone)}
                className="min-h-[44px] w-full rounded-md border border-line-strong bg-inset px-3 py-2 text-xs text-ink focus:border-accent focus:outline-none disabled:opacity-60"
              >
                <option value="bottom_captions">YouTube Captions (Bottom 28%)</option>
                <option value="center_article">Article Content (Center)</option>
                <option value="full">Full Screen</option>
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="ocr-interval" className="block text-xs font-medium text-ink-muted">
                Scan Speed
              </label>
              <select
                id="ocr-interval"
                disabled={isRecordingScreen}
                value={scanIntervalMs}
                onChange={(e) => setScanIntervalMs(Number(e.target.value))}
                className="min-h-[44px] w-full rounded-md border border-line-strong bg-inset px-3 py-2 text-xs text-ink focus:border-accent focus:outline-none disabled:opacity-60"
              >
                <option value={1500}>Fast (1.5s)</option>
                <option value={2000}>Balanced (2.0s)</option>
                <option value={3500}>Battery Saver (3.5s)</option>
              </select>
            </div>

            <div className="flex items-end">
              {isRecordingScreen ? (
                <button
                  type="button"
                  onClick={handleStopAndReviewScreen}
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500"
                >
                  <Square className="h-4 w-4" />
                  <span>Stop &amp; Review OCR</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!hasDisplayApi}
                  onClick={() => void handleStartScreenCapture()}
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  <Play className="h-4 w-4" />
                  <span>Record Screen &amp; Read</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="overflow-hidden rounded-md border border-line bg-inset">
              <video
                ref={videoRef}
                muted
                playsInline
                className={`w-full object-contain ${isRecordingScreen ? 'max-h-52' : 'hidden'}`}
              />
              {!isRecordingScreen && (
                <div className="p-6 text-center text-xs text-ink-muted">
                  Start recording a browser tab on Chromebook; static frames are skipped automatically
                  and lines wait in the review buffer until you confirm.
                </div>
              )}
            </div>

            {cropPreviewUrl && isRecordingScreen && (
              <div className="space-y-1.5 rounded-md border border-line bg-inset p-2.5">
                <div className="font-mono text-[11px] text-ink-muted">
                  OCR Crop Target ({captureZone})
                </div>
                <img
                  src={cropPreviewUrl}
                  alt="Cropped OCR preview"
                  className="max-h-40 w-full rounded border border-line object-contain"
                />
              </div>
            )}
          </div>
        </section>
      )}

      {/* Alerts */}
      {errorMessage && (
        <div
          role="alert"
          className="rounded-md border border-danger-border bg-danger-soft px-4 py-3 text-xs text-danger"
        >
          {errorMessage}
        </div>
      )}

      {statusMessage && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent-border bg-accent-soft px-4 py-3 text-xs text-ink"
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-accent-text" />
            <span>{statusMessage}</span>
          </span>
          {notesLearned > 0 && (
            <button
              type="button"
              onClick={onOpenKnowledge}
              className="font-semibold text-accent-text underline underline-offset-2 hover:opacity-90"
            >
              View Saved Knowledge
            </button>
          )}
        </div>
      )}

      {/* Screen Capture Review Buffer */}
      <section className="space-y-3 rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-mono text-xs text-ink-muted">
            <span className="font-semibold text-ink">Screen Capture Review Buffer</span>
            {lastConfidence !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">Last OCR conf: {lastConfidence}%</span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={capturedLines.length === 0}
              onClick={handleOpenBufferReview}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
            >
              <Eye className="h-3.5 w-3.5" />
              <span>Review &amp; Save Buffer</span>
            </button>
            <button
              type="button"
              disabled={capturedLines.length === 0}
              onClick={() => {
                setCapturedLines([]);
                linesRef.current = [];
              }}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-line-strong bg-inset px-3 py-2 text-xs text-ink-muted hover:bg-elevated disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Clear</span>
            </button>
          </div>
        </div>

        <pre className="max-h-56 min-h-[96px] overflow-auto whitespace-pre-wrap rounded-md border border-line bg-inset p-3.5 font-mono text-xs leading-relaxed text-ink">
          {capturedLines.length > 0
            ? capturedLines.join('\n')
            : 'Live Screen OCR lines collect here for review before saving.'}
        </pre>
      </section>

      {/* Mandatory Preview-and-Confirm Modal for URL, Paste, OCR, and Mic */}
      <CaptureReviewModal
        draft={reviewDraft}
        folders={folders}
        isSaving={isSavingReview}
        isRefiningOcr={isRefiningOcr}
        isCategorizingFolder={isCategorizingFolder}
        errorMessage={reviewError}
        onChangeDraft={(updater) => setReviewDraft((prev) => (prev ? updater(prev) : null))}
        onRefineOcrHighRes={handleRefineOcrHighRes}
        onAutoCategorizeFolder={handleAutoCategorizeReviewFolder}
        onConfirmSave={handleConfirmReviewSave}
        onDiscard={handleDiscardReview}
      />
    </div>
  );
}
