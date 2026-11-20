import {
  Camera,
  CheckCircle2,
  ClipboardPaste,
  FileText,
  Globe,
  Link2,
  Mic,
  MicOff,
  Monitor,
  Play,
  Sparkles,
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

interface CapturePanelProps {
  brainUrl: string;
  backupBrainUrl: string;
  brainModel: string;
  accessToken: string;
  onSaveCapturedEntries: (
    items: DistilledKnowledgeItem[],
    sourceType: string,
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

export function CapturePanel({
  brainUrl,
  backupBrainUrl,
  brainModel,
  accessToken,
  onSaveCapturedEntries,
  onOpenKnowledge,
}: CapturePanelProps) {
  const hasDisplayApi = supportsDisplayCapture();
  const hasMicApi = supportsSpeechRecognition();

  // Default to URL / Text or Live Mic so both Tablet & Chromebook work immediately on open
  const [activeTab, setActiveTab] = useState<CaptureTab>('url_text');

  // Shared rolling capture buffer
  const [sourceTitle, setSourceTitle] = useState('Ingested Learning Session');
  const [capturedLines, setCapturedLines] = useState<string[]>([]);
  const [framesScanned, setFramesScanned] = useState(0);
  const [framesSkipped, setFramesSkipped] = useState(0);
  const [notesLearned, setNotesLearned] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDistilling, setIsDistilling] = useState(false);

  // Live Screen OCR state
  const [isRecordingScreen, setIsRecordingScreen] = useState(false);
  const [captureZone, setCaptureZone] = useState<CaptureZone>('bottom_captions');
  const [scanIntervalMs, setScanIntervalMs] = useState(2000);
  const [autoLearnEnabled, setAutoLearnEnabled] = useState(true);
  const [lastConfidence, setLastConfidence] = useState<number | null>(null);
  const [cropPreviewUrl, setCropPreviewUrl] = useState<string | null>(null);

  // URL / Paste state
  const [targetUrl, setTargetUrl] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [isExtractingUrl, setIsExtractingUrl] = useState(false);
  const [extractStepText, setExtractStepText] = useState<string | null>(null);
  const [linkHistory, setLinkHistory] = useState<LinkIngestRecord[]>([]);

  // Image / Live Mic state
  const [isOcrImageBusy, setIsOcrImageBusy] = useState(false);
  const [isListeningMic, setIsListeningMic] = useState(false);
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

  const linesRef = useRef<string[]>([]);
  const unlearnedLineStartRef = useRef(0);

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

  async function distillAndStoreLines(
    linesToLearn: string[],
    title: string,
    sourceType: string,
  ): Promise<number> {
    const rawText = linesToLearn.join('\n').trim();
    if (!rawText) return 0;

    setIsDistilling(true);
    setErrorMessage(null);
    try {
      let items: DistilledKnowledgeItem[] = [];
      let summary = '';

      if ((brainUrl.trim() || backupBrainUrl.trim()) && accessToken) {
        try {
          const distilled = await distillWithAiBrain({
            brainUrl,
            backupBrainUrl,
            accessToken,
            model: brainModel,
            text: rawText,
            sourceTitle: title,
            sourceType,
          });
          items = distilled.entries;
          summary = distilled.summary;
        } catch {
          const local = distillTextLocally(rawText, title, sourceType);
          items = local.entries;
          summary = local.summary;
        }
      } else {
        const local = distillTextLocally(rawText, title, sourceType);
        items = local.entries;
        summary = local.summary;
      }

      if (items.length === 0) return 0;
      const savedCount = await onSaveCapturedEntries(items, sourceType);
      setNotesLearned((prev) => prev + savedCount);
      setStatusMessage(
        savedCount > 0
          ? `Stored ${savedCount} Knowledge ${savedCount === 1 ? 'entry' : 'entries'} from ${sourceType}${
              summary ? ` — ${summary}` : ''
            }`
          : 'Entries matched existing knowledge (no duplicate rows added).',
      );
      return savedCount;
    } finally {
      setIsDistilling(false);
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

          const pendingCount = mergedLines.length - unlearnedLineStartRef.current;
          if (autoLearnEnabled && pendingCount >= 5) {
            const batch = mergedLines.slice(unlearnedLineStartRef.current);
            unlearnedLineStartRef.current = mergedLines.length;
            void distillAndStoreLines(batch, sourceTitle, 'screen_ocr');
          }
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
        }). Diff-gated OCR active...`,
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

  async function handleStopAndLearn() {
    stopScreenCapture();
    const unlearned = linesRef.current.slice(unlearnedLineStartRef.current);
    if (unlearned.length > 0) {
      unlearnedLineStartRef.current = linesRef.current.length;
      await distillAndStoreLines(unlearned, sourceTitle, 'screen_ocr');
    } else {
      setStatusMessage('Screen recording stopped. All captured lines are already saved.');
    }
  }

  async function handleLearnAllBuffer() {
    const all = linesRef.current.slice(unlearnedLineStartRef.current);
    const target = all.length > 0 ? all : linesRef.current;
    if (target.length === 0) return;
    unlearnedLineStartRef.current = linesRef.current.length;
    await distillAndStoreLines(target, sourceTitle, 'capture_buffer');
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
    setExtractStepText('1/3 Fetching source transcript or article body...');

    try {
      const extracted = await extractUrlViaBrain({
        brainUrl,
        backupBrainUrl,
        accessToken,
        url: clean,
      });

      setSourceTitle(extracted.title);
      setExtractStepText('2/3 Deduplicating and mining concepts...');
      const {mergedLines} = mergeIncrementalCaption(linesRef.current, extracted.text);
      linesRef.current = mergedLines;
      setCapturedLines(mergedLines);
      unlearnedLineStartRef.current = mergedLines.length;

      const sourceType = extracted.kind === 'youtube' ? 'youtube_transcript' : 'article_ingest';
      setExtractStepText('3/3 Saving distilled knowledge to Supabase...');
      const savedCount = await distillAndStoreLines(
        extracted.text.split('\n'),
        extracted.title,
        sourceType,
      );

      setLinkHistory((prev) => [
        {
          id: `${Date.now()}`,
          url: clean,
          title: extracted.title,
          kind: extracted.kind,
          savedCount,
          createdAt: new Date().toISOString(),
        },
        ...prev.slice(0, 5),
      ]);
      setTargetUrl('');
      setExtractStepText(null);
    } catch (err) {
      setExtractStepText(null);
      setErrorMessage(err instanceof Error ? err.message : 'Could not extract URL text.');
    } finally {
      setIsExtractingUrl(false);
    }
  }

  async function handleLearnPastedText(event: FormEvent) {
    event.preventDefault();
    const clean = pastedText.trim();
    if (!clean) return;
    setErrorMessage(null);
    const title = sourceTitle.trim() || 'Pasted Article / Transcript';
    const {mergedLines} = mergeIncrementalCaption(linesRef.current, clean);
    linesRef.current = mergedLines;
    setCapturedLines(mergedLines);
    unlearnedLineStartRef.current = mergedLines.length;
    await distillAndStoreLines(clean.split('\n'), title, 'article_ingest');
    setPastedText('');
  }

  async function processImageFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setIsOcrImageBusy(true);
    setErrorMessage(null);
    setStatusMessage(`Running on-device OCR across ${list.length} image(s)...`);

    try {
      let totalNewLines = 0;
      for (const file of list) {
        const {text, confidence} = await recognizeImageBlob(file);
        setFramesScanned((n) => n + 1);
        setLastConfidence(confidence);
        const {mergedLines, addedText} = mergeIncrementalCaption(linesRef.current, text);
        if (addedText) {
          linesRef.current = mergedLines;
          setCapturedLines(mergedLines);
          totalNewLines += addedText.split('\n').length;
        }
      }

      if (totalNewLines > 0) {
        const batch = linesRef.current.slice(unlearnedLineStartRef.current);
        unlearnedLineStartRef.current = linesRef.current.length;
        await distillAndStoreLines(
          batch,
          sourceTitle || list[0].name || 'Screenshot OCR',
          'screenshot_ocr',
        );
      } else {
        setStatusMessage('OCR finished, but no clear new readable words were detected.');
      }
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

      setInterimTranscript(liveInterim);

      if (finals.length > 0) {
        const {mergedLines, addedText} = mergeIncrementalCaption(
          linesRef.current,
          finals.join('\n'),
        );
        if (addedText) {
          linesRef.current = mergedLines;
          setCapturedLines(mergedLines);
          const pending = mergedLines.length - unlearnedLineStartRef.current;
          if (autoLearnEnabled && pending >= 4) {
            const batch = mergedLines.slice(unlearnedLineStartRef.current);
            unlearnedLineStartRef.current = mergedLines.length;
            void distillAndStoreLines(batch, sourceTitle || 'Live Audio Capture', 'mic_transcript');
          }
        }
      }
    };

    recognition.onerror = (ev) => {
      const errCode = ev.error || '';
      if (errCode === 'no-speech' || errCode === 'aborted') {
        // Benign silence on Android Chrome — let onend auto-restart cleanly
        return;
      }
      if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
        setErrorMessage('Microphone access was denied by browser settings. Allow microphone access and retry.');
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

  async function handleToggleMic() {
    setErrorMessage(null);
    if (isListeningMic) {
      stopMicCapture();
      const unlearned = linesRef.current.slice(unlearnedLineStartRef.current);
      if (unlearned.length > 0) {
        unlearnedLineStartRef.current = linesRef.current.length;
        await distillAndStoreLines(unlearned, sourceTitle || 'Voice / Audio Capture', 'mic_transcript');
      } else {
        setStatusMessage('Mic stopped. Buffer saved.');
      }
      return;
    }

    if (!supportsSpeechRecognition()) {
      setErrorMessage('Speech recognition is unavailable in this browser.');
      return;
    }

    isMicWantedRef.current = true;
    setIsListeningMic(true);
    setStatusMessage('Continuous live listener active — speak or play nearby audio; auto-saves continuously.');
    void startWebAudioMeter();
    spawnRecognitionSession();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5" onPaste={handlePasteClipboard}>
      <div className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">
            Ingest &amp; Live Capture Lab
          </h1>
          <p className="text-sm text-slate-400">
            Ingest YouTube videos, web articles, continuous mic speech, or screen OCR into Supabase Knowledge.
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
          <span>{capturedLines.length} lines</span>
          <span aria-hidden="true">·</span>
          <span className="text-emerald-400">{notesLearned} learned</span>
        </div>
      </div>

      {/* Mode Selector */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0F172A] p-1.5">
        <button
          type="button"
          onClick={() => setActiveTab('url_text')}
          className={`inline-flex min-h-[42px] items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-colors ${
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
          className={`inline-flex min-h-[42px] items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-colors ${
            activeTab === 'image_mic'
              ? 'bg-slate-800 text-slate-100'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Mic className="h-4 w-4" />
          <span>Live Mic &amp; Screenshots</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('screen')}
          className={`inline-flex min-h-[42px] items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-colors ${
            activeTab === 'screen'
              ? 'bg-slate-800 text-slate-100'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Monitor className="h-4 w-4" />
          <span>Screen OCR (Chromebook / Desktop)</span>
        </button>
      </div>

      {/* Shared Session Title */}
      <div className="grid gap-3 rounded-lg border border-slate-800 bg-[#0F172A] p-4 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1">
          <label htmlFor="capture-topic" className="block text-xs font-medium text-slate-300">
            Knowledge Title Prefix
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

        <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 self-end rounded-md border border-slate-800 bg-[#0B1120] px-3.5 py-2 text-xs text-slate-200">
          <input
            type="checkbox"
            checked={autoLearnEnabled}
            onChange={(e) => setAutoLearnEnabled(e.target.checked)}
            className="h-4 w-4 accent-emerald-500"
          />
          <span>Auto-Distill &amp; Save Live</span>
        </label>
      </div>

      {/* Tab 1: YouTube / Article URL + Bulk Paste */}
      {activeTab === 'url_text' && (
        <div className="space-y-4">
          <form
            onSubmit={handleExtractUrlSubmit}
            className="space-y-3 rounded-lg border border-slate-800 bg-[#0F172A] p-5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <Link2 className="h-4 w-4 text-emerald-400" />
                <span>Read &amp; Learn from YouTube or Web Article URL</span>
              </div>
              {!(brainUrl.trim() || backupBrainUrl.trim()) && (
                <span className="font-mono text-[11px] text-amber-300">
                  Browser reader fallback (add Cloud Backup in Settings for YouTube captions)
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
                disabled={isExtractingUrl || isDistilling}
                className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-md bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                <Sparkles className="h-4 w-4" />
                <span>{isExtractingUrl ? 'Extracting...' : 'Read & Learn Link'}</span>
              </button>
            </div>

            {extractStepText && (
              <div className="rounded-md border border-slate-700 bg-[#0B1120] px-3.5 py-2 font-mono text-xs text-sky-300">
                {extractStepText}
              </div>
            )}

            {linkHistory.length > 0 && (
              <div className="space-y-1.5 border-t border-slate-800 pt-3">
                <div className="text-[11px] font-medium text-slate-400">Ingested Links (Session)</div>
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
            onSubmit={handleLearnPastedText}
            className="space-y-3 rounded-lg border border-slate-800 bg-[#0F172A] p-5"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <FileText className="h-4 w-4 text-sky-400" />
              <span>Paste Any Article, Docs Page, or Transcript</span>
            </div>
            <textarea
              rows={5}
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Paste any article, notes, or transcript here — Mantis splits concepts and stores them automatically..."
              className="w-full rounded-md border border-slate-700 bg-[#0B1120] p-3.5 font-mono text-xs leading-relaxed text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!pastedText.trim() || isDistilling}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4 text-emerald-400" />
                <span>{isDistilling ? 'Distilling...' : 'Distill & Store Text'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tab 2: Live Mic & Screenshot OCR */}
      {activeTab === 'image_mic' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3 rounded-lg border border-slate-800 bg-[#0F172A] p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <Mic className="h-4 w-4 text-sky-400" />
                <span>Continuous Live Mic &amp; Audio Listener</span>
              </div>
              <span className="font-mono text-[11px] tabular-nums text-slate-400">
                {isListeningMic ? `Signal ${micLevel}%` : 'Idle'}
              </span>
            </div>

            <p className="text-xs leading-relaxed text-slate-400">
              Auto-restarts cleanly on Android Chrome pauses and streams live spoken words below
              until you tap Stop.
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

            {isListeningMic && (
              <div className="min-h-[44px] rounded-md border border-slate-800 bg-[#0B1120] px-3 py-2 font-mono text-xs text-emerald-300">
                {interimTranscript || 'Listening for speech or nearby video audio...'}
              </div>
            )}

            <button
              type="button"
              disabled={!hasMicApi}
              onClick={() => void handleToggleMic()}
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
                    ? 'Stop Listening & Save'
                    : 'Start Live Mic Listener'}
              </span>
            </button>
          </div>

          <div className="space-y-3 rounded-lg border border-slate-800 bg-[#0F172A] p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Camera className="h-4 w-4 text-emerald-400" />
              <span>Screenshot / Photo Batch OCR</span>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Upload screenshots on tablet or Chromebook (or press Ctrl+V to paste directly).
              On-device OCR reads the text and stores concepts automatically.
            </p>
            <label className="flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-700 bg-[#0B1120] px-4 py-3 text-xs font-semibold text-slate-200 hover:border-emerald-500/60 hover:bg-slate-800/60">
              <ClipboardPaste className="h-4 w-4 text-emerald-400" />
              <span>
                {isOcrImageBusy ? 'Reading Image Text...' : 'Choose Screenshot(s) or Photo'}
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
              <strong>YouTube &amp; Article Links</strong> or <strong>Live Mic &amp; Screenshots</strong>. On Chromebook,{' '}
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
                  onClick={() => void handleStopAndLearn()}
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500"
                >
                  <Square className="h-4 w-4" />
                  <span>Stop &amp; Save Remaining</span>
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
                  to save CPU.
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
              View Learned Knowledge
            </button>
          )}
        </div>
      )}

      {/* Deduplicated Buffer */}
      <section className="space-y-3 rounded-lg border border-slate-800 bg-[#0F172A] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-mono text-xs text-slate-300">
            <span className="font-semibold text-slate-100">Deduplicated Capture Buffer</span>
            {lastConfidence !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums text-slate-400">OCR conf: {lastConfidence}%</span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={capturedLines.length === 0 || isDistilling}
              onClick={() => void handleLearnAllBuffer()}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>{isDistilling ? 'Learning...' : 'Distill & Save Buffer'}</span>
            </button>
            <button
              type="button"
              disabled={capturedLines.length === 0}
              onClick={() => {
                setCapturedLines([]);
                linesRef.current = [];
                unlearnedLineStartRef.current = 0;
              }}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Clear</span>
            </button>
          </div>
        </div>

        <pre className="max-h-60 min-h-[110px] overflow-auto whitespace-pre-wrap rounded-md border border-slate-800 bg-[#0B1120] p-3.5 font-mono text-xs leading-relaxed text-slate-200">
          {capturedLines.length > 0
            ? capturedLines.join('\n')
            : 'Captured YouTube captions, articles, voice transcripts, and OCR lines collect here automatically.'}
        </pre>
      </section>
    </div>
  );
}
