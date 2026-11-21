import {
  Camera,
  CheckCircle2,
  ClipboardPaste,
  Eye,
  FileText,
  Globe,
  Link2,
  Mic,
  MicOff,
  Monitor,
  Play,
  Square,
  Trash2,
} from 'lucide-react';
import {type ClipboardEvent, type FormEvent, useEffect, useRef, useState} from 'react';
import {
  distillWithAiBrain,
  extractUrlViaBrain,
  normalizeExternalUrl,
  type DistilledKnowledgeItem,
} from '../lib/aiBrain';
import {
  captureVideoFrameText,
  recognizeImageBlob,
  supportsDisplayCapture,
  supportsSpeechRecognition,
  terminateOcrWorker,
  type CaptureZone,
} from '../lib/ocrCapture';
import {distillTextLocally, mergeIncrementalCaption} from '../lib/textDistiller';
import type {KnowledgeFolder, KnowledgeStatus} from '../types/mantis';
import {CaptureReviewModal, type CaptureReviewDraft} from './CaptureReviewModal';

interface CapturePanelProps {
  brainUrl: string;
  backupBrainUrl: string;
  brainModel: string;
  accessToken: string;
  folders: KnowledgeFolder[];
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
  onOpenKnowledge: () => void;
}

type CaptureTab = 'url_text' | 'image_mic' | 'screen';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: {error?: string}) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
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

function resolveDefaultCaptureFolderId(folders: KnowledgeFolder[]): string | null {
  const captured = folders.find(
    (f) => f.name.toLowerCase() === 'captured learning',
  );
  return captured?.id || folders[0]?.id || null;
}

export function CapturePanel({
  brainUrl,
  backupBrainUrl,
  brainModel,
  accessToken,
  folders,
  onSaveEntry,
  onSaveCapturedEntries,
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

  // Review & Confirm modal state (shared by URL, Paste, OCR, and Mic)
  const [reviewDraft, setReviewDraft] = useState<CaptureReviewDraft | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [isSavingReview, setIsSavingReview] = useState(false);
  const [isRefiningOcr, setIsRefiningOcr] = useState(false);

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

  // Image OCR & Live Mic state
  const [imageOcrZone, setImageOcrZone] = useState<CaptureZone>('full');
  const [isOcrImageBusy, setIsOcrImageBusy] = useState(false);
  const [isListeningMic, setIsListeningMic] = useState(false);
  const [micLines, setMicLines] = useState<string[]>([]);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [micLevel, setMicLevel] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const prevLuminanceGridRef = useRef<number[] | null>(null);
  const isScanningFrameRef = useRef(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const isMicWantedRef = useRef(false);
  const micRestartTimerRef = useRef<number | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioMeterRafRef = useRef<number | null>(null);
  const micLinesRef = useRef<string[]>([]);
  const latestInterimRef = useRef('');

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

  const stopAudioMeter = () => {
    if (audioMeterRafRef.current !== null) {
      window.cancelAnimationFrame(audioMeterRafRef.current);
      audioMeterRafRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (audioStreamRef.current) {
      for (const track of audioStreamRef.current.getTracks()) {
        track.stop();
      }
      audioStreamRef.current = null;
    }
    setMicLevel(0);
  };

  const stopMicCapture = () => {
    isMicWantedRef.current = false;
    if (micRestartTimerRef.current !== null) {
      window.clearTimeout(micRestartTimerRef.current);
      micRestartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore stop errors
      }
      recognitionRef.current = null;
    }
    stopAudioMeter();
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
      let savedCount = 0;

      if (reviewDraft.saveMode === 'single') {
        const ok = await onSaveEntry({
          folderId: reviewDraft.folderId,
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

        const chosenFolderName = folders.find((f) => f.id === reviewDraft.folderId)?.name;
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
          }: "${cleanTitle}"`,
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
          setMicLines([]);
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
      setMicLines([]);
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
    setReviewDraft({
      kind: 'ocr',
      sourceType: 'screen_ocr',
      title: sourceTitle.trim() || `Screen OCR – ${new Date().toLocaleDateString()}`,
      content: collected,
      folderId: resolveDefaultCaptureFolderId(folders),
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
    setReviewDraft({
      kind: 'paste',
      sourceType: 'capture_buffer',
      title: sourceTitle.trim() || 'Captured Buffer Note',
      content: collected,
      folderId: resolveDefaultCaptureFolderId(folders),
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

      setExtractStepText('2/2 Preparing editable preview...');
      const sourceType = extracted.kind === 'youtube' ? 'youtube_transcript' : 'article_ingest';

      setReviewDraft({
        kind: 'url',
        sourceType,
        title: extracted.title,
        content: extracted.text,
        folderId: resolveDefaultCaptureFolderId(folders),
        tagsText: extracted.kind === 'youtube' ? 'youtube, transcript' : 'article, web',
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

    setReviewDraft({
      kind: 'paste',
      sourceType: 'article_ingest',
      title: defaultTitle,
      content: clean,
      folderId: resolveDefaultCaptureFolderId(folders),
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

      setStatusMessage(null);
      setReviewDraft({
        kind: 'ocr',
        sourceType: 'screenshot_ocr',
        title: baseTitle,
        content: recognizedText,
        folderId: resolveDefaultCaptureFolderId(folders),
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

  async function startWebAudioMeter() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return;
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});
      audioStreamRef.current = stream;

      const AudioContextCtor =
        window.AudioContext ||
        (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
      if (!AudioContextCtor) return;

      const ctx = new AudioContextCtor();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!isMicWantedRef.current) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i += 1) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const normalized = Math.min(100, Math.round((avg / 90) * 100));
        setMicLevel(normalized);
        audioMeterRafRef.current = window.requestAnimationFrame(tick);
      };
      audioMeterRafRef.current = window.requestAnimationFrame(tick);
    } catch {
      // SpeechRecognition can still run even if AudioContext meter permission is skipped
    }
  }

  function spawnRecognitionSession() {
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechCtor = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechCtor) return;

    const recognition = new SpeechCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      const finals: string[] = [];
      let liveInterim = '';

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const res = event.results[i];
        const transcript = (res[0]?.transcript || '').trim();
        if (!transcript) continue;
        if (res.isFinal) {
          finals.push(transcript);
        } else {
          liveInterim = liveInterim ? `${liveInterim} ${transcript}` : transcript;
        }
      }

      latestInterimRef.current = liveInterim;
      setInterimTranscript(liveInterim);

      if (finals.length > 0) {
        const {mergedLines} = mergeIncrementalCaption(
          micLinesRef.current,
          finals.join('\n'),
        );
        micLinesRef.current = mergedLines;
        setMicLines(mergedLines);
      }
    };

    recognition.onerror = (ev) => {
      const errCode = ev.error || '';
      if (errCode === 'no-speech' || errCode === 'aborted') {
        // Benign silence on Android Chrome — let onend auto-restart cleanly
        return;
      }
      if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
        setErrorMessage(
          'Microphone access was denied by browser settings. Allow microphone access and retry.',
        );
        stopMicCapture();
        return;
      }
      setErrorMessage(`Mic listener notice: ${errCode || 'reconnecting...'}`);
    };

    recognition.onend = () => {
      if (isMicWantedRef.current) {
        // Auto-heal Chrome's Android continuous cutoff
        micRestartTimerRef.current = window.setTimeout(() => {
          if (isMicWantedRef.current) {
            spawnRecognitionSession();
          }
        }, 250);
      } else {
        setIsListeningMic(false);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // Ignore start race conditions
    }
  }

  function handleToggleMic() {
    setErrorMessage(null);
    if (isListeningMic) {
      // Capture any trailing interim words before stopping
      const trailing = latestInterimRef.current.trim();
      let combinedLines = [...micLinesRef.current];
      if (trailing) {
        combinedLines = mergeIncrementalCaption(combinedLines, trailing).mergedLines;
      }

      stopMicCapture();
      const transcriptText = combinedLines.join('\n').trim();
      if (!transcriptText) {
        setStatusMessage(
          'Recording stopped — no speech detected. Tap Start Recording to try again.',
        );
        micLinesRef.current = [];
        setMicLines([]);
        return;
      }

      const defaultTitle =
        sourceTitle.trim() && sourceTitle.trim() !== 'Ingested Learning Session'
          ? `${formatConversationTitle()} · ${sourceTitle.trim()}`
          : formatConversationTitle();

      setStatusMessage(null);
      setReviewDraft({
        kind: 'mic',
        sourceType: 'mic_transcript',
        title: defaultTitle,
        content: transcriptText,
        folderId: resolveDefaultCaptureFolderId(folders),
        tagsText: 'voice, conversation',
        status: 'reviewed',
        saveMode: transcriptText.length > 2800 ? 'distill' : 'single',
        extractedAt: new Date().toISOString(),
      });
      return;
    }

    if (!supportsSpeechRecognition()) {
      setErrorMessage('Speech recognition is unavailable in this browser.');
      return;
    }

    micLinesRef.current = [];
    setMicLines([]);
    latestInterimRef.current = '';
    setInterimTranscript('');

    isMicWantedRef.current = true;
    setIsListeningMic(true);
    setStatusMessage(
      'Recording audio — transcript builds live below and opens for review when you tap Stop.',
    );
    void startWebAudioMeter();
    spawnRecognitionSession();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5" onPaste={handlePasteClipboard}>
      <div className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">
            Ingest &amp; Review Capture Lab
          </h1>
          <p className="text-sm text-slate-400">
            Extract links, run fast OCR on screenshots, or record conversations — always review and edit before saving.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums text-slate-400">
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
          <span className="text-emerald-400">{notesLearned} saved</span>
        </div>
      </div>

      {/* Mode Selector */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0F172A] p-1.5">
        <button
          type="button"
          onClick={() => setActiveTab('url_text')}
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-colors ${
            activeTab === 'url_text'
              ? 'bg-slate-800 text-slate-100'
              : 'text-slate-400 hover:text-slate-200'
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
              ? 'bg-slate-800 text-slate-100'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Mic className="h-4 w-4" />
          <span>Mic &amp; Screenshot OCR</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('screen')}
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-colors ${
            activeTab === 'screen'
              ? 'bg-slate-800 text-slate-100'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Monitor className="h-4 w-4" />
          <span>Screen OCR (Chromebook / Desktop)</span>
        </button>
      </div>

      {/* Shared Session Title Prefix */}
      <div className="rounded-lg border border-slate-800 bg-[#0F172A] p-4">
        <div className="space-y-1">
          <label htmlFor="capture-topic" className="block text-xs font-medium text-slate-300">
            Optional Session Label (editable again in Preview before saving)
          </label>
          <input
            id="capture-topic"
            type="text"
            value={sourceTitle}
            onChange={(e) => setSourceTitle(e.target.value)}
            placeholder="e.g. TypeScript Patterns Tutorial"
            className="min-h-[44px] w-full rounded-md border border-slate-700 bg-[#0B1120] px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Tab 1: YouTube / Article URL + Bulk Paste */}
      {activeTab === 'url_text' && (
        <div className="space-y-4">
          <form
            onSubmit={handleExtractUrlSubmit}
            className="space-y-3 rounded-lg border border-slate-800 bg-[#0F172A] p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <Link2 className="h-4 w-4 text-emerald-400" />
                <span>Extract &amp; Preview from YouTube or Web Article URL</span>
              </div>
              {!(brainUrl.trim() || backupBrainUrl.trim()) && (
                <span className="font-mono text-[11px] text-amber-300">
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
                className="min-h-[44px] flex-1 rounded-md border border-slate-700 bg-[#0B1120] px-3.5 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isExtractingUrl}
                className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-md bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                <Eye className="h-4 w-4" />
                <span>{isExtractingUrl ? 'Extracting…' : 'Extract & Preview'}</span>
              </button>
            </div>

            {extractStepText && (
              <div className="rounded-md border border-slate-700 bg-[#0B1120] px-3.5 py-2 font-mono text-xs text-sky-300">
                {extractStepText}
              </div>
            )}

            {linkHistory.length > 0 && (
              <div className="space-y-1.5 border-t border-slate-800 pt-3">
                <div className="text-[11px] font-medium text-slate-400">Saved Links (Session)</div>
                <div className="space-y-1">
                  {linkHistory.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 bg-[#0B1120] px-3 py-1.5 text-xs"
                    >
                      <span className="truncate font-medium text-slate-200">{item.title}</span>
                      <span className="font-mono text-[11px] tabular-nums text-emerald-400">
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
            className="space-y-3 rounded-lg border border-slate-800 bg-[#0F172A] p-5"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <FileText className="h-4 w-4 text-sky-400" />
              <span>Paste Article, Docs Page, or Transcript</span>
            </div>
            <textarea
              rows={5}
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Paste any article, notes, or transcript here — opens an editable preview before saving..."
              className="w-full rounded-md border border-slate-700 bg-[#0B1120] p-3.5 font-mono text-xs leading-relaxed text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!pastedText.trim()}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-50"
              >
                <Eye className="h-4 w-4 text-emerald-400" />
                <span>Preview &amp; Save Text</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tab 2: Live Mic & Screenshot OCR */}
      {activeTab === 'image_mic' && (
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Mic Record -> Transcribe -> Review -> Save */}
          <div className="space-y-3 rounded-lg border border-slate-800 bg-[#0F172A] p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <Mic className="h-4 w-4 text-sky-400" />
                <span>Voice &amp; Conversation Recorder</span>
              </div>
              <span className="font-mono text-[11px] tabular-nums text-slate-400">
                {isListeningMic ? `Signal ${micLevel}%` : 'Ready'}
              </span>
            </div>

            <p className="text-xs leading-relaxed text-slate-400">
              Tap Start to transcribe live speech. Nothing saves automatically — tapping Stop opens an editable transcript preview.
            </p>

            {/* Real Web Audio 16-bar Level Meter */}
            <div
              aria-label="Microphone audio signal meter"
              className="flex h-8 items-end gap-1 rounded-md border border-slate-800 bg-[#0B1120] px-2.5 py-1.5"
            >
              {Array.from({length: 16}).map((_, idx) => {
                const threshold = ((idx + 1) / 16) * 100;
                const active = isListeningMic && micLevel >= threshold * 0.7;
                return (
                  <div
                    key={idx}
                    className={`flex-1 rounded-xs transition-all duration-75 ${
                      active ? 'bg-emerald-500' : 'bg-slate-800'
                    }`}
                    style={{height: `${35 + (idx % 4) * 16}%`}}
                  />
                );
              })}
            </div>

            {(isListeningMic || micLines.length > 0) && (
              <div className="max-h-36 min-h-[56px] space-y-1 overflow-auto rounded-md border border-slate-800 bg-[#0B1120] px-3 py-2 font-mono text-xs">
                {micLines.length > 0 && (
                  <div className="whitespace-pre-wrap text-slate-200">{micLines.join('\n')}</div>
                )}
                {isListeningMic && (
                  <div className="text-emerald-300">
                    {interimTranscript || 'Listening for speech…'}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              disabled={!hasMicApi}
              onClick={handleToggleMic}
              className={`inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-50 ${
                isListeningMic
                  ? 'bg-red-600 hover:bg-red-500'
                  : 'bg-emerald-600 hover:bg-emerald-500'
              }`}
            >
              {isListeningMic ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              <span>
                {!hasMicApi
                  ? 'Speech API Unsupported Here'
                  : isListeningMic
                    ? 'Stop & Review Transcript'
                    : 'Start Recording'}
              </span>
            </button>
          </div>

          {/* Screenshot OCR with ROI Crop + Fast Pass -> Preview Modal */}
          <div className="space-y-3 rounded-lg border border-slate-800 bg-[#0F172A] p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Camera className="h-4 w-4 text-emerald-400" />
              <span>Screenshot / Image OCR</span>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Runs a fast lower-res OCR pass on your selected crop region, then opens an editable preview with confidence score and High-Res refinement.
            </p>

            <div className="space-y-1">
              <label htmlFor="image-ocr-zone" className="block text-xs font-medium text-slate-300">
                Crop Focus Region
              </label>
              <select
                id="image-ocr-zone"
                value={imageOcrZone}
                disabled={isOcrImageBusy}
                onChange={(e) => setImageOcrZone(e.target.value as CaptureZone)}
                className="min-h-[44px] w-full rounded-md border border-slate-700 bg-[#0B1120] px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
              >
                <option value="full">Full Image</option>
                <option value="center_article">Center Article / Code Region</option>
                <option value="bottom_captions">Bottom Captions Strip</option>
              </select>
            </div>

            <label className="flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-700 bg-[#0B1120] px-4 py-3 text-xs font-semibold text-slate-200 hover:border-emerald-500/60 hover:bg-slate-800/60">
              <ClipboardPaste className="h-4 w-4 text-emerald-400" />
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
        <section className="space-y-4 rounded-lg border border-slate-800 bg-[#0F172A] p-5">
          {!hasDisplayApi && (
            <div className="rounded-md border border-amber-500/40 bg-amber-950/20 p-4 text-xs leading-relaxed text-amber-200">
              <strong>Android Browser Notice:</strong> Chrome on Android blocks{' '}
              <code className="font-mono">getDisplayMedia</code>. On your Galaxy Tab A9+, use{' '}
              <strong>YouTube &amp; Article Links</strong> or <strong>Mic &amp; Screenshot OCR</strong>. On Chromebook,{' '}
              <strong>Record Screen &amp; Read</strong> works natively.
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label htmlFor="ocr-zone" className="block text-xs font-medium text-slate-300">
                OCR Focus Zone
              </label>
              <select
                id="ocr-zone"
                disabled={isRecordingScreen}
                value={captureZone}
                onChange={(e) => setCaptureZone(e.target.value as CaptureZone)}
                className="min-h-[44px] w-full rounded-md border border-slate-700 bg-[#0B1120] px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
              >
                <option value="bottom_captions">YouTube Captions (Bottom 28%)</option>
                <option value="center_article">Article Content (Center)</option>
                <option value="full">Full Screen</option>
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="ocr-interval" className="block text-xs font-medium text-slate-300">
                Scan Speed
              </label>
              <select
                id="ocr-interval"
                disabled={isRecordingScreen}
                value={scanIntervalMs}
                onChange={(e) => setScanIntervalMs(Number(e.target.value))}
                className="min-h-[44px] w-full rounded-md border border-slate-700 bg-[#0B1120] px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
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
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  <Play className="h-4 w-4" />
                  <span>Record Screen &amp; Read</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="overflow-hidden rounded-md border border-slate-800 bg-[#0B1120]">
              <video
                ref={videoRef}
                muted
                playsInline
                className={`w-full object-contain ${isRecordingScreen ? 'max-h-52' : 'hidden'}`}
              />
              {!isRecordingScreen && (
                <div className="p-6 text-center text-xs text-slate-400">
                  Start recording a browser tab on Chromebook; static frames are skipped automatically
                  and lines wait in the review buffer until you confirm.
                </div>
              )}
            </div>

            {cropPreviewUrl && isRecordingScreen && (
              <div className="space-y-1.5 rounded-md border border-slate-800 bg-[#0B1120] p-2.5">
                <div className="font-mono text-[11px] text-slate-400">
                  OCR Crop Target ({captureZone})
                </div>
                <img
                  src={cropPreviewUrl}
                  alt="Cropped OCR preview"
                  className="max-h-40 w-full rounded border border-slate-800 object-contain"
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
          className="rounded-md border border-red-500/40 bg-red-950/30 px-4 py-3 text-xs text-red-200"
        >
          {errorMessage}
        </div>
      )}

      {statusMessage && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-500/40 bg-emerald-950/30 px-4 py-3 text-xs text-emerald-200"
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>{statusMessage}</span>
          </span>
          {notesLearned > 0 && (
            <button
              type="button"
              onClick={onOpenKnowledge}
              className="font-semibold text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
            >
              View Saved Knowledge
            </button>
          )}
        </div>
      )}

      {/* Screen Capture Review Buffer */}
      <section className="space-y-3 rounded-lg border border-slate-800 bg-[#0F172A] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-mono text-xs text-slate-300">
            <span className="font-semibold text-slate-100">Screen Capture Review Buffer</span>
            {lastConfidence !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums text-slate-400">Last OCR conf: {lastConfidence}%</span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={capturedLines.length === 0}
              onClick={handleOpenBufferReview}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
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
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-slate-700 bg-[#0B1120] px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Clear</span>
            </button>
          </div>
        </div>

        <pre className="max-h-56 min-h-[96px] overflow-auto whitespace-pre-wrap rounded-md border border-slate-800 bg-[#0B1120] p-3.5 font-mono text-xs leading-relaxed text-slate-200">
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
        errorMessage={reviewError}
        onChangeDraft={(updater) => setReviewDraft((prev) => (prev ? updater(prev) : null))}
        onRefineOcrHighRes={handleRefineOcrHighRes}
        onConfirmSave={handleConfirmReviewSave}
        onDiscard={handleDiscardReview}
      />
    </div>
  );
}
