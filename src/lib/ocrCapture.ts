import {createWorker, type Worker} from 'tesseract.js';
import {cleanOcrText} from './textDistiller';

export type CaptureZone = 'bottom_captions' | 'center_article' | 'full';
export type OcrResolutionMode = 'fast' | 'high_res';
export type OcrConfidenceLevel = 'Good' | 'Fair' | 'Low';

export interface OcrImageResult {
  text: string;
  confidence: number;
  previewDataUrl: string;
  width: number;
  height: number;
  mode: OcrResolutionMode;
  zone: CaptureZone;
}

let ocrWorkerPromise: Promise<Worker> | null = null;

async function getOcrWorker(): Promise<Worker> {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker('eng').catch((err) => {
      ocrWorkerPromise = null;
      throw err;
    });
  }
  return ocrWorkerPromise;
}

export async function terminateOcrWorker(): Promise<void> {
  if (ocrWorkerPromise) {
    try {
      const worker = await ocrWorkerPromise;
      await worker.terminate();
    } catch {
      // ignore termination errors
    } finally {
      ocrWorkerPromise = null;
    }
  }
}

export function supportsDisplayCapture(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices) &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function'
  );
}

export function supportsSpeechRecognition(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return Boolean(win.SpeechRecognition || win.webkitSpeechRecognition);
}

export function getOcrConfidenceLevel(confidence: number): OcrConfidenceLevel {
  if (confidence >= 80) return 'Good';
  if (confidence >= 60) return 'Fair';
  return 'Low';
}

function computeZoneRect(
  sourceWidth: number,
  sourceHeight: number,
  zone: CaptureZone,
): {sx: number; sy: number; sw: number; sh: number} {
  if (zone === 'bottom_captions') {
    return {
      sx: Math.round(sourceWidth * 0.08),
      sw: Math.max(1, Math.round(sourceWidth * 0.84)),
      sy: Math.round(sourceHeight * 0.68),
      sh: Math.max(1, Math.round(sourceHeight * 0.28)),
    };
  }
  if (zone === 'center_article') {
    return {
      sx: Math.round(sourceWidth * 0.06),
      sw: Math.max(1, Math.round(sourceWidth * 0.88)),
      sy: Math.round(sourceHeight * 0.1),
      sh: Math.max(1, Math.round(sourceHeight * 0.8)),
    };
  }
  return {
    sx: 0,
    sy: 0,
    sw: Math.max(1, sourceWidth),
    sh: Math.max(1, sourceHeight),
  };
}

/**
 * Computes a tiny 16x9 grayscale grid from the cropped canvas so unchanged frames
 * skip expensive Tesseract OCR passes completely.
 */
function computeLuminanceGrid(sourceCanvas: HTMLCanvasElement): number[] {
  const sampleW = 16;
  const sampleH = 9;
  const tiny = document.createElement('canvas');
  tiny.width = sampleW;
  tiny.height = sampleH;
  const tctx = tiny.getContext('2d');
  if (!tctx) return [];
  tctx.drawImage(sourceCanvas, 0, 0, sampleW, sampleH);
  const {data} = tctx.getImageData(0, 0, sampleW, sampleH);
  const grid: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    grid.push(Math.round(lum));
  }
  return grid;
}

function hasSignificantFrameChange(
  prev: number[] | null,
  next: number[],
  threshold = 4.5,
): boolean {
  if (!prev || prev.length === 0 || prev.length !== next.length) return true;
  let diffSum = 0;
  for (let i = 0; i < next.length; i += 1) {
    diffSum += Math.abs(next[i] - prev[i]);
  }
  return diffSum / next.length >= threshold;
}

function loadImageElementFromBlob(blob: Blob): Promise<{
  image: HTMLImageElement;
  cleanup: () => void;
}> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve({
        image: img,
        cleanup: () => URL.revokeObjectURL(objectUrl),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not decode image for OCR.'));
    };
    img.src = objectUrl;
  });
}

export async function captureVideoFrameText(
  video: HTMLVideoElement,
  zone: CaptureZone,
  prevGrid?: number[] | null,
): Promise<{
  text: string;
  confidence: number;
  grid: number[];
  skippedUnchanged: boolean;
  previewDataUrl: string | null;
}> {
  if (video.videoWidth === 0 || video.videoHeight === 0) {
    return {
      text: '',
      confidence: 0,
      grid: prevGrid || [],
      skippedUnchanged: true,
      previewDataUrl: null,
    };
  }

  const {sx, sy, sw, sh} = computeZoneRect(video.videoWidth, video.videoHeight, zone);

  // Fast lower-res cap for responsive live screen OCR on Chromebook
  const maxLiveWidth = 960;
  const scale =
    sw > maxLiveWidth
      ? maxLiveWidth / sw
      : zone === 'bottom_captions' && sw < 640
        ? Math.min(1.35, maxLiveWidth / sw)
        : 1;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      text: '',
      confidence: 0,
      grid: prevGrid || [],
      skippedUnchanged: true,
      previewDataUrl: null,
    };
  }

  ctx.filter = 'grayscale(1) contrast(1.25)';
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  const nextGrid = computeLuminanceGrid(canvas);
  const previewDataUrl = canvas.toDataURL('image/jpeg', 0.68);

  if (prevGrid && !hasSignificantFrameChange(prevGrid, nextGrid)) {
    return {
      text: '',
      confidence: 0,
      grid: nextGrid,
      skippedUnchanged: true,
      previewDataUrl,
    };
  }

  const worker = await getOcrWorker();
  const result = await worker.recognize(canvas);
  const rawText = result.data.text || '';
  return {
    text: cleanOcrText(rawText) || rawText.trim(),
    confidence: Math.round(result.data.confidence || 0),
    grid: nextGrid,
    skippedUnchanged: false,
    previewDataUrl,
  };
}

export async function recognizeImageBlob(
  fileOrBlob: Blob,
  options?: {
    zone?: CaptureZone;
    mode?: OcrResolutionMode;
  },
): Promise<OcrImageResult> {
  const zone: CaptureZone = options?.zone ?? 'full';
  const mode: OcrResolutionMode = options?.mode ?? 'fast';

  const {image, cleanup} = await loadImageElementFromBlob(fileOrBlob);
  try {
    const naturalW = Math.max(1, image.naturalWidth || image.width);
    const naturalH = Math.max(1, image.naturalHeight || image.height);
    const {sx, sy, sw, sh} = computeZoneRect(naturalW, naturalH, zone);

    // Process cropped ROI at lower resolution first (~900px max) for speed,
    // or run high-res contrast-boosted pass when user clicks Refine High-Res.
    const maxEdge = mode === 'high_res' ? 2000 : 900;
    let scale = 1;
    if (sw > maxEdge || sh > maxEdge) {
      scale = Math.min(maxEdge / sw, maxEdge / sh);
    } else if (mode === 'high_res' && sw < 900) {
      scale = Math.min(1.45, maxEdge / sw);
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable for OCR.');
    }

    ctx.filter =
      mode === 'high_res'
        ? 'grayscale(1) contrast(1.48) brightness(1.04)'
        : 'grayscale(1) contrast(1.25)';
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    const previewDataUrl = canvas.toDataURL('image/jpeg', mode === 'high_res' ? 0.85 : 0.72);
    const worker = await getOcrWorker();
    const result = await worker.recognize(canvas);
    const rawText = result.data.text || '';

    return {
      text: cleanOcrText(rawText) || rawText.trim(),
      confidence: Math.round(result.data.confidence || 0),
      previewDataUrl,
      width: canvas.width,
      height: canvas.height,
      mode,
      zone,
    };
  } finally {
    cleanup();
  }
}
