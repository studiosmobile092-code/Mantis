import {createWorker, type Worker} from 'tesseract.js';

export type CaptureZone = 'bottom_captions' | 'center_article' | 'full';

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

/**
 * Computes a tiny 16x9 grayscale grid from the cropped canvas so unchanged frames
 * skip expensive Tesseract OCR passes completely.
 */
function computeLuminanceGrid(
  sourceCanvas: HTMLCanvasElement,
): number[] {
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

function hasSignificantFrameChange(prev: number[] | null, next: number[], threshold = 4.5): boolean {
  if (!prev || prev.length === 0 || prev.length !== next.length) return true;
  let diffSum = 0;
  for (let i = 0; i < next.length; i += 1) {
    diffSum += Math.abs(next[i] - prev[i]);
  }
  return diffSum / next.length >= threshold;
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
    return {text: '', confidence: 0, grid: prevGrid || [], skippedUnchanged: true, previewDataUrl: null};
  }

  const vw = video.videoWidth;
  const vh = video.videoHeight;

  let sx = 0;
  let sy = 0;
  let sw = vw;
  let sh = vh;

  if (zone === 'bottom_captions') {
    sx = Math.round(vw * 0.08);
    sw = Math.round(vw * 0.84);
    sy = Math.round(vh * 0.68);
    sh = Math.round(vh * 0.28);
  } else if (zone === 'center_article') {
    sx = Math.round(vw * 0.06);
    sw = Math.round(vw * 0.88);
    sy = Math.round(vh * 0.12);
    sh = Math.round(vh * 0.78);
  }

  const canvas = document.createElement('canvas');
  const scale = zone === 'bottom_captions' ? 1.5 : 1;
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {text: '', confidence: 0, grid: prevGrid || [], skippedUnchanged: true, previewDataUrl: null};
  }

  ctx.filter = 'contrast(1.25)';
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  const nextGrid = computeLuminanceGrid(canvas);
  const previewDataUrl = canvas.toDataURL('image/jpeg', 0.65);

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
  return {
    text: result.data.text || '',
    confidence: Math.round(result.data.confidence || 0),
    grid: nextGrid,
    skippedUnchanged: false,
    previewDataUrl,
  };
}

export async function recognizeImageBlob(
  fileOrBlob: Blob,
): Promise<{text: string; confidence: number}> {
  const worker = await getOcrWorker();
  const result = await worker.recognize(fileOrBlob);
  return {
    text: result.data.text || '',
    confidence: Math.round(result.data.confidence || 0),
  };
}
