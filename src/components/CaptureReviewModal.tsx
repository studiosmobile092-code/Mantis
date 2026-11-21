import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  Mic,
  ScanText,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {useEffect} from 'react';
import {
  getOcrConfidenceLevel,
  type CaptureZone,
  type OcrResolutionMode,
} from '../lib/ocrCapture';
import type {KnowledgeFolder, KnowledgeStatus} from '../types/mantis';

export type CaptureReviewKind = 'url' | 'paste' | 'ocr' | 'mic';
export type CaptureSaveMode = 'single' | 'distill';

export interface CaptureReviewDraft {
  kind: CaptureReviewKind;
  sourceType: string;
  title: string;
  content: string;
  folderId: string | null;
  tagsText: string;
  status: KnowledgeStatus;
  saveMode: CaptureSaveMode;
  sourceUrl?: string | null;
  extractedAt?: string | null;
  previewDataUrl?: string | null;
  ocrConfidence?: number | null;
  ocrZone?: CaptureZone;
  ocrMode?: OcrResolutionMode;
  sourceFiles?: File[];
  ocrNotice?: string | null;
}

interface CaptureReviewModalProps {
  draft: CaptureReviewDraft | null;
  folders: KnowledgeFolder[];
  isSaving: boolean;
  isRefiningOcr: boolean;
  errorMessage?: string | null;
  onChangeDraft: (updater: (prev: CaptureReviewDraft) => CaptureReviewDraft) => void;
  onRefineOcrHighRes?: (zone: CaptureZone) => Promise<void>;
  onConfirmSave: () => Promise<void>;
  onDiscard: () => void;
}

function formatDateTimeLabel(iso?: string | null): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(dt);
}

export function CaptureReviewModal({
  draft,
  folders,
  isSaving,
  isRefiningOcr,
  errorMessage,
  onChangeDraft,
  onRefineOcrHighRes,
  onConfirmSave,
  onDiscard,
}: CaptureReviewModalProps) {
  useEffect(() => {
    if (!draft) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSaving && !isRefiningOcr) {
        event.preventDefault();
        onDiscard();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [draft, isSaving, isRefiningOcr, onDiscard]);

  if (!draft) return null;

  const wordCount = draft.content.trim()
    ? draft.content.trim().split(/\s+/).length
    : 0;
  const confidenceLevel =
    typeof draft.ocrConfidence === 'number'
      ? getOcrConfidenceLevel(draft.ocrConfidence)
      : null;

  const modalTitle =
    draft.kind === 'url'
      ? 'Review Extracted Link'
      : draft.kind === 'ocr'
        ? 'Review OCR Capture'
        : draft.kind === 'mic'
          ? 'Review Voice Transcript'
          : 'Review Pasted Content';

  const HeaderIcon =
    draft.kind === 'url'
      ? Globe
      : draft.kind === 'ocr'
        ? ScanText
        : draft.kind === 'mic'
          ? Mic
          : FileText;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="capture-review-modal-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 p-0 backdrop-blur-xs sm:items-center sm:p-4"
      onClick={() => {
        if (!isSaving && !isRefiningOcr) onDiscard();
      }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-xl border border-slate-700 bg-[#0F172A] shadow-2xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <HeaderIcon className="h-4 w-4 shrink-0 text-emerald-400" />
            <div className="min-w-0">
              <h2
                id="capture-review-modal-title"
                className="truncate text-sm font-semibold text-slate-100"
              >
                {modalTitle}
              </h2>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                <span>Confirm &amp; edit before saving to Knowledge</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{wordCount} words</span>
                {draft.extractedAt && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>Extracted {formatDateTimeLabel(draft.extractedAt)}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={isSaving || isRefiningOcr}
            onClick={onDiscard}
            aria-label="Discard capture review"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Source URL bar for URL extractions */}
          {draft.sourceUrl && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800 bg-[#0B1120] px-3.5 py-2.5 text-xs">
              <span className="truncate font-mono text-slate-300">{draft.sourceUrl}</span>
              <a
                href={draft.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 font-medium text-emerald-400 hover:text-emerald-300"
              >
                <span>Open Source</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}

          {/* OCR Preview Image, Confidence & High-Res Refinement */}
          {draft.kind === 'ocr' && (
            <div className="space-y-3 rounded-md border border-slate-800 bg-[#0B1120] p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-slate-300">OCR Confidence</span>
                  <span aria-hidden="true" className="text-slate-600">
                    ·
                  </span>
                  {confidenceLevel && typeof draft.ocrConfidence === 'number' ? (
                    <span
                      className={`inline-flex items-center gap-1.5 font-mono font-semibold tabular-nums ${
                        confidenceLevel === 'Good'
                          ? 'text-emerald-400'
                          : confidenceLevel === 'Fair'
                            ? 'text-amber-300'
                            : 'text-red-300'
                      }`}
                    >
                      {confidenceLevel === 'Good' ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5" />
                      )}
                      <span>
                        {confidenceLevel} ({draft.ocrConfidence}%)
                      </span>
                    </span>
                  ) : (
                    <span className="text-slate-400">Screen Capture</span>
                  )}
                  {draft.ocrMode && (
                    <>
                      <span aria-hidden="true" className="text-slate-600">
                        ·
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">
                        {draft.ocrMode === 'high_res' ? 'High-Res Refined' : 'Fast Low-Res Pass'}
                      </span>
                    </>
                  )}
                </div>

                {draft.sourceFiles && draft.sourceFiles.length > 0 && onRefineOcrHighRes && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="OCR crop region"
                      value={draft.ocrZone || 'full'}
                      disabled={isRefiningOcr || isSaving}
                      onChange={(e) => {
                        const nextZone = e.target.value as CaptureZone;
                        onChangeDraft((prev) => ({...prev, ocrZone: nextZone}));
                      }}
                      className="min-h-[40px] rounded-md border border-slate-700 bg-[#0F172A] px-2.5 py-1.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="full">Full Image</option>
                      <option value="center_article">Center Region</option>
                      <option value="bottom_captions">Bottom Captions</option>
                    </select>

                    <button
                      type="button"
                      disabled={isRefiningOcr || isSaving}
                      onClick={() => void onRefineOcrHighRes(draft.ocrZone || 'full')}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-950/40 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-900/50 disabled:opacity-50"
                    >
                      {isRefiningOcr ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      <span>{isRefiningOcr ? 'Refining…' : 'Refine High-Res'}</span>
                    </button>
                  </div>
                )}
              </div>

              {draft.previewDataUrl && (
                <div className="overflow-hidden rounded border border-slate-800 bg-slate-950">
                  <img
                    src={draft.previewDataUrl}
                    alt="Cropped OCR preview"
                    className="max-h-44 w-full object-contain"
                  />
                </div>
              )}

              {draft.ocrNotice && (
                <p className="text-xs text-amber-200">{draft.ocrNotice}</p>
              )}
            </div>
          )}

          {/* Editable Title */}
          <div className="space-y-1.5">
            <label
              htmlFor="review-entry-title"
              className="block text-xs font-medium text-slate-300"
            >
              Entry Title
            </label>
            <input
              id="review-entry-title"
              type="text"
              value={draft.title}
              disabled={isSaving}
              onChange={(e) =>
                onChangeDraft((prev) => ({...prev, title: e.target.value}))
              }
              placeholder="Clear title for this note"
              className="min-h-[44px] w-full rounded-md border border-slate-700 bg-[#0B1120] px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* Editable Content */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="review-entry-content"
                className="block text-xs font-medium text-slate-300"
              >
                {draft.kind === 'mic'
                  ? 'Transcript Content (Editable)'
                  : draft.kind === 'ocr'
                    ? 'Recognized Text (Editable)'
                    : 'Extracted Content (Editable)'}
              </label>
              <span className="font-mono text-[11px] tabular-nums text-slate-400">
                {draft.content.length} chars
              </span>
            </div>
            <textarea
              id="review-entry-content"
              rows={9}
              value={draft.content}
              disabled={isSaving}
              onChange={(e) =>
                onChangeDraft((prev) => ({...prev, content: e.target.value}))
              }
              placeholder="Review and clean up extracted text before saving..."
              className="w-full rounded-md border border-slate-700 bg-[#0B1120] p-3.5 font-mono text-xs leading-relaxed text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* Folder, Status, Tags */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label
                htmlFor="review-entry-folder"
                className="block text-xs font-medium text-slate-300"
              >
                Target Folder
              </label>
              <select
                id="review-entry-folder"
                value={draft.folderId || ''}
                disabled={isSaving}
                onChange={(e) =>
                  onChangeDraft((prev) => ({
                    ...prev,
                    folderId: e.target.value || null,
                  }))
                }
                className="min-h-[44px] w-full rounded-md border border-slate-700 bg-[#0B1120] px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                {folders.length === 0 && <option value="">Captured Learning</option>}
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <span className="block text-xs font-medium text-slate-300">
                Knowledge Status
              </span>
              <div className="grid min-h-[44px] grid-cols-2 gap-1 rounded-md border border-slate-700 bg-[#0B1120] p-1">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() =>
                    onChangeDraft((prev) => ({...prev, status: 'reviewed'}))
                  }
                  className={`rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                    draft.status === 'reviewed'
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Reviewed
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() =>
                    onChangeDraft((prev) => ({...prev, status: 'trusted'}))
                  }
                  className={`rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                    draft.status === 'trusted'
                      ? 'bg-emerald-600/25 text-emerald-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Trusted
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="review-entry-tags"
                className="block text-xs font-medium text-slate-300"
              >
                Tags
              </label>
              <input
                id="review-entry-tags"
                type="text"
                value={draft.tagsText}
                disabled={isSaving}
                onChange={(e) =>
                  onChangeDraft((prev) => ({...prev, tagsText: e.target.value}))
                }
                placeholder="e.g. react, notes"
                className="min-h-[44px] w-full rounded-md border border-slate-700 bg-[#0B1120] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Save Mode Toggle for Long URL / Article / Transcripts */}
          {(draft.content.length > 600 || draft.kind === 'url' || draft.kind === 'paste') && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800 bg-[#0B1120] px-3.5 py-2.5">
              <div className="text-xs text-slate-300">
                <span className="font-medium">Storage Format:</span>{' '}
                <span className="text-slate-400">
                  {draft.saveMode === 'single'
                    ? 'Keep exact title and content as one entry'
                    : 'Auto-split long text into topical entries'}
                </span>
              </div>
              <div className="flex items-center gap-1 rounded-md border border-slate-700 bg-[#0F172A] p-1">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() =>
                    onChangeDraft((prev) => ({...prev, saveMode: 'single'}))
                  }
                  className={`min-h-[34px] rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    draft.saveMode === 'single'
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Single Entry
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() =>
                    onChangeDraft((prev) => ({...prev, saveMode: 'distill'}))
                  }
                  className={`min-h-[34px] rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    draft.saveMode === 'distill'
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Split Concepts
                </button>
              </div>
            </div>
          )}
          {errorMessage && (
            <div
              role="alert"
              className="rounded-md border border-red-500/40 bg-red-950/40 px-3.5 py-2.5 text-xs text-red-200"
            >
              {errorMessage}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-[#0B1120] px-5 py-3.5">
          <button
            type="button"
            disabled={isSaving || isRefiningOcr}
            onClick={onDiscard}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-slate-700 bg-[#0F172A] px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4 text-slate-400" />
            <span>Discard</span>
          </button>

          <button
            type="button"
            disabled={
              isSaving ||
              isRefiningOcr ||
              !draft.title.trim() ||
              !draft.content.trim()
            }
            onClick={() => void onConfirmSave()}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            <span>{isSaving ? 'Saving…' : 'Save to Knowledge'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
