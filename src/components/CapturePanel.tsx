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
  brainModel: string;
  accessToken: string;
  onSaveCapturedEntries: (
    items: DistilledKnowledgeItem[],
    sourceType: string,
  ) => Promise<number>;
  onOpenKnowledge: () => void;
}

type CaptureTab = 'screen' | 'url_text' | 'image_mic';

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

export function CapturePanel({
  brainUrl,
  brainModel,
  accessToken,
  onSaveCapturedEntries,
  onOpenKnowledge,
}: CapturePanelProps) {
  const hasDisplayApi = supportsDisplayCapture();
  const hasMicApi = supportsSpeechRecognition();

  const [activeTab, setActiveTab] = useState<CaptureTab>(hasDisplayApi ? 'screen' : 'url_text');

  // Shared rolling capture buffer
  const [sourceTitle, setSourceTitle] = useState('Live Screen & Caption Capture');
  const [capturedLines, setCapturedLines] = useState<string[]>([]);
  const [framesScanned, setFramesScanned] = useState(0);
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

  // URL / Paste state
  const [targetUrl, setTargetUrl] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [isExtractingUrl, setIsExtractingUrl] = useState(false);

  // Image / Mic state
  const [isOcrImageBusy, setIsOcrImageBusy] = useState(false);
  const [isListeningMic, setIsListeningMic] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const isScanningFrameRef = useRef(false);
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
    setIsRecordingScreen(false);
  };

  const stopMicCapture = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore stop errors
      }
      recognitionRef.current = null;
    }
    setIsListeningMic(false);
  };

  useEffect(() => {
    return () => {
      stopScreenCapture();
      stopMicCapture();
      void terminateOcrWorker();
    };
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

      if (brainUrl.trim() && accessToken) {
        try {
          const distilled = await distillWithAiBrain({
            brainUrl,
            accessToken,
            model: brainModel,
            text: rawText,
            sourceTitle: title,
            sourceType,
          });
          items = distilled.entries;
          summary = distilled.summary;
        } catch {
          // Graceful local fallback if AI Brain temporarily errors
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
        `Learned ${savedCount} Knowledge ${savedCount === 1 ? 'entry' : 'entries'} from ${sourceType}${
          summary ? ` — ${summary}` : ''
        }`,
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
      const {text, confidence} = await captureVideoFrameText(video, captureZone);
      setFramesScanned((n) => n + 1);
      setLastConfidence(confidence);

      if (text.trim()) {
        const {mergedLines, addedText} = mergeIncrementalCaption(linesRef.current, text);
        if (addedText) {
          linesRef.current = mergedLines;
          setCapturedLines(mergedLines);

          const pendingCount = mergedLines.length - unlearnedLineStartRef.current;
          if (autoLearnEnabled && pendingCount >= 6) {
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
        'Screen recording via browser tab is blocked on Android Chrome. Use URL / Text or Screenshot OCR / Live Mic tabs on this tablet.',
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {frameRate: {ideal: 5, max: 10}},
        audio: false,
      });
      streamRef.current = stream;

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
        `Recording live (${captureZone === 'bottom_captions' ? 'YouTube Captions Strip' : captureZone === 'center_article' ? 'Center Article' : 'Full Screen'}). OCR worker warming up...`,
      );

      // Run initial scan after 700ms and repeat on interval
      window.setTimeout(() => void scanSingleVideoFrame(), 700);
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
    const clean = targetUrl.trim();
    if (!clean) return;
    setErrorMessage(null);
    setStatusMessage(null);

    if (!brainUrl.trim()) {
      setErrorMessage(
        'Connect your free Cloudflare Worker AI Brain in Settings first to fetch external YouTube captions and web articles automatically, or paste text directly below.',
      );
      return;
    }

    setIsExtractingUrl(true);
    try {
      const extracted = await extractUrlViaBrain({
        brainUrl,
        accessToken,
        url: clean,
      });
      setSourceTitle(extracted.title);
      const {mergedLines} = mergeIncrementalCaption(linesRef.current, extracted.text);
      linesRef.current = mergedLines;
      setCapturedLines(mergedLines);
      unlearnedLineStartRef.current = mergedLines.length;

      await distillAndStoreLines(
        extracted.text.split('\n'),
        extracted.title,
        extracted.kind === 'youtube' ? 'youtube_transcript' : 'article_ingest',
      );
      setTargetUrl('');
    } catch (err) {
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

  function handleToggleMic() {
    setErrorMessage(null);
    if (isListeningMic) {
      stopMicCapture();
      const unlearned = linesRef.current.slice(unlearnedLineStartRef.current);
      if (unlearned.length > 0) {
        unlearnedLineStartRef.current = linesRef.current.length;
        void distillAndStoreLines(unlearned, sourceTitle || 'Voice / Audio Capture', 'mic_transcript');
      }
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechCtor = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechCtor) {
      setErrorMessage('Speech recognition is unavailable in this browser.');
      return;
    }

    const recognition = new SpeechCtor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      const transcripts: string[] = [];
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const res = event.results[i];
        if (res.isFinal && res[0]?.transcript) {
          transcripts.push(res[0].transcript.trim());
        }
      }
      if (transcripts.length > 0) {
        const {mergedLines, addedText} = mergeIncrementalCaption(
          linesRef.current,
          transcripts.join('\n'),
        );
        if (addedText) {
          linesRef.current = mergedLines;
          setCapturedLines(mergedLines);
          const pending = mergedLines.length - unlearnedLineStartRef.current;
          if (autoLearnEnabled && pending >= 5) {
            const batch = mergedLines.slice(unlearnedLineStartRef.current);
            unlearnedLineStartRef.current = mergedLines.length;
            void distillAndStoreLines(batch, sourceTitle || 'Live Audio Capture', 'mic_transcript');
          }
        }
      }
    };

    recognition.onerror = (ev) => {
      setErrorMessage(`Mic listener error: ${ev.error || 'unknown'}`);
      stopMicCapture();
    };

    recognition.onend = () => {
      setIsListeningMic(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListeningMic(true);
    setStatusMessage('Listening live — speak or play audio nearby to transcribe & auto-learn.');
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6" onPaste={handlePasteClipboard}>
      <div className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">
            Live Screen, Caption &amp; Article Learner
          </h1>
          <p className="text-sm text-slate-400">
            Capture live screen captions, YouTube videos, articles, or screenshots and automatically
            distill them into persistent Supabase Knowledge.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums text-slate-400">
          <span>{framesScanned} scans</span>
          <span aria-hidden="true">·</span>
          <span>{capturedLines.length} lines</span>
          <span aria-hidden="true">·</span>
          <span className="text-emerald-400">{notesLearned} learned</span>
        </div>
      </div>

      {/* Mode Selector */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 p-1.5">
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
          <span>Live Screen OCR</span>
        </button>

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
          <span>YouTube / Article URL</span>
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
          <Camera className="h-4 w-4" />
          <span>Screenshots &amp; Live Mic</span>
        </button>
      </div>

      {/* Shared Topic Title */}
      <div className="grid gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1">
          <label htmlFor="capture-topic" className="block text-xs font-medium text-slate-300">
            Session Topic / Knowledge Title Prefix
          </label>
          <input
            id="capture-topic"
            type="text"
            value={sourceTitle}
            onChange={(e) => setSourceTitle(e.target.value)}
            placeholder="e.g. React Hooks YouTube Tutorial"
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

      {/* Tab 1: Live Screen OCR */}
      {activeTab === 'screen' && (
        <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-5">
          {!hasDisplayApi && (
            <div className="rounded-md border border-amber-500/40 bg-amber-950/20 p-4 text-xs leading-relaxed text-amber-200">
              <strong>Android Tablet Browser Notice:</strong> Chrome on Android blocks web pages
              from recording other apps via <code className="font-mono">getDisplayMedia</code>. On
              your Galaxy Tab A9+, use <strong>YouTube / Article URL</strong> (reads entire video
              captions or articles in 1 tap!) or <strong>Screenshots &amp; Live Mic</strong>. On
              your Chromebook, <strong>Start Screen Record</strong> works natively.
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
                  <span>Stop &amp; Learn Remaining</span>
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

          <div className="overflow-hidden rounded-md border border-slate-800 bg-[#0B1120]">
            <video
              ref={videoRef}
              muted
              playsInline
              className={`w-full object-contain ${isRecordingScreen ? 'max-h-60' : 'hidden'}`}
            />
            {!isRecordingScreen && (
              <div className="p-6 text-center text-xs text-slate-400">
                Tap <strong>Record Screen &amp; Read</strong>, select your YouTube or article tab,
                and Mantis will crop, deduplicate rolling captions, and store what it reads.
              </div>
            )}
          </div>
        </section>
      )}

      {/* Tab 2: YouTube / Article URL + Bulk Paste */}
      {activeTab === 'url_text' && (
        <div className="space-y-4">
          <form
            onSubmit={handleExtractUrlSubmit}
            className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-5"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Link2 className="h-4 w-4 text-emerald-400" />
              <span>Auto-Read YouTube Video Captions or Web Article</span>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Works directly on your Galaxy Tab A9+. Paste any YouTube link or article URL — Mantis
              extracts every word of the transcript or article and distills it into Knowledge.
              {!brainUrl.trim() && (
                <span className="text-amber-300">
                  {' '}
                  (Requires your free Cloudflare Worker URL in Settings.)
                </span>
              )}
            </p>
            <div className="flex flex-col gap-2.5 sm:flex-row">
              <input
                type="url"
                required
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=... or https://docs..."
                className="min-h-[44px] flex-1 rounded-md border border-slate-700 bg-[#0B1120] px-3.5 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isExtractingUrl || isDistilling}
                className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-md bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                <Sparkles className="h-4 w-4" />
                <span>{isExtractingUrl ? 'Reading URL...' : 'Read & Learn All'}</span>
              </button>
            </div>
          </form>

          <form
            onSubmit={handleLearnPastedText}
            className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-5"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <FileText className="h-4 w-4 text-sky-400" />
              <span>Paste Any Article, Docs Page, or Transcript</span>
            </div>
            <textarea
              rows={5}
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Select-all & copy text from any webpage or transcript on your tablet, paste it here, and Mantis will chunk, summarize, and store every concept..."
              className="w-full rounded-md border border-slate-700 bg-[#0B1120] p-3.5 font-mono text-xs leading-relaxed text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!pastedText.trim() || isDistilling}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4 text-emerald-400" />
                <span>{isDistilling ? 'Distilling...' : 'Distill & Learn Text'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tab 3: Screenshots & Live Mic */}
      {activeTab === 'image_mic' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Camera className="h-4 w-4 text-emerald-400" />
              <span>Screenshot / Photo Batch OCR</span>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Take screenshots on your Galaxy Tab (or paste an image with Ctrl+V). Mantis runs
              on-device OCR to read every word and store it into Knowledge.
            </p>
            <label className="flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-700 bg-[#0B1120] px-4 py-3 text-xs font-semibold text-slate-200 hover:border-emerald-500/60 hover:bg-slate-800/60">
              <ClipboardPaste className="h-4 w-4 text-emerald-400" />
              <span>
                {isOcrImageBusy ? 'Reading Image Text...' : 'Choose Screenshot(s) or Camera'}
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

          <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Mic className="h-4 w-4 text-sky-400" />
              <span>Live Audio / Caption Mic Listener</span>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Uses Chrome&apos;s built-in speech recognizer on Android &amp; Chromebook to transcribe
              spoken explanations or nearby video audio in real time.
            </p>
            <button
              type="button"
              disabled={!hasMicApi}
              onClick={handleToggleMic}
              className={`inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-50 ${
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
        </div>
      )}

      {/* Feedback Alerts */}
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

      {/* Live Deduplicated Buffer */}
      <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-mono text-xs text-slate-300">
            <span className="font-semibold text-slate-100">Live Deduplicated Text Buffer</span>
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
              <span>{isDistilling ? 'Learning...' : 'Distill & Save Buffer Now'}</span>
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

        <pre className="max-h-64 min-h-[120px] overflow-auto whitespace-pre-wrap rounded-md border border-slate-800 bg-[#0B1120] p-3.5 font-mono text-xs leading-relaxed text-slate-200">
          {capturedLines.length > 0
            ? capturedLines.join('\n')
            : 'Captured captions, article paragraphs, and screenshot OCR text appear here automatically (deduplicated in real time).'}
        </pre>
      </section>
    </div>
  );
}
