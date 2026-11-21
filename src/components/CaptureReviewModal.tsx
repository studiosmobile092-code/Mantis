import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  FolderPlus,
  Globe,
  Loader2,
  Mic,
  ScanText,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {AUTO_FOLDER_OPTION} from '../lib/autoFolders';
import {
  getOcrConfidenceLevel,
  type CaptureZone,
  type OcrResolutionMode,
} from '../lib/ocrCapture';
import {
  extractSpeakerLabels,
  renameSpeakerInTranscript,
} from '../lib/speechEngine';
import type {KnowledgeFolder, KnowledgeStatus} from '../types/mantis';

export type CaptureReviewKind = 'url' | 'paste' | 'ocr' | 'mic';
export type CaptureSaveMode = 'single' | 'distill';

export interface CaptureReviewDraft {
  kind: CaptureReviewKind;
  sourceType: string;
  title: string;
  content: string;
  folderId: string | null;
  autoFolderSuggestion?: string;
  autoFolderDescription?: string;
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
  micAiPolished?: boolean;
  micModelUsed?: string;
  micSpeakerCount?: number;
}

interface CaptureReviewModalProps {
  draft: CaptureReviewDraft | null;
  folders: KnowledgeFolder[];
  isSaving: boolean;
  isRefiningOcr: boolean;
  isCategorizingFolder?: boolean;
  errorMessage?: string | null;
  onChangeDraft: (updater: (prev: CaptureReviewDraft) => CaptureReviewDraft) => void;
  onRefineOcrHighRes?: (zone: CaptureZone) => Promise<void>;
  onAutoCategorizeFolder?: () => Promise<void>;
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
  isCategorizingFolder = false,
  errorMessage,
  onChangeDraft,
  onRefineOcrHighRes,
  onAutoCategorizeFolder,
  onConfirmSave,
  onDiscard,
}: CaptureReviewModalProps) {
  const [speakerRenames, setSpeakerRenames] = useState<Record<string, string>>({});

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

  const speakerLabels = useMemo(
    () => (draft?.kind === 'mic' ? extractSpeakerLabels(draft.content) : []),
    [draft?.kind, draft?.content],
  );

  useEffect(() => {
    setSpeakerRenames({});
  }, [draft?.kind, draft?.extractedAt]);

  if (!draft) return null;

  const wordCount = draft.content.trim()
    ? draft.content.trim().split(/\s+/).length
    : 0;
  const confidenceLevel =
    typeof draft.ocrConfidence === 'number'
      ? getOcrConfidenceLevel(draft.ocrConfidence)
      : null;

  const matchedAutoFolder = draft.autoFolderSuggestion
    ? folders.find(
        (f) => f.name.toLowerCase() === draft.autoFolderSuggestion?.trim().toLowerCase(),
      )
    : undefined;

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
      className="mantis-fade-in fixed inset-0 z-50 flex items-end justify-center bg-slate-950/75 p-0 backdrop-blur-xs sm:items-center sm:p-4"
      onClick={() => {
        if (!isSaving && !isRefiningOcr) onDiscard();
      }}
    >
      <div
        className="mantis-modal-in flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-xl border border-line-strong bg-surface shadow-2xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <HeaderIcon className="h-4 w-4 shrink-0 text-accent-text" />
            <div className="min-w-0">
              <h2
                id="capture-review-modal-title"
                className="truncate text-sm font-semibold text-ink"
              >
                {modalTitle}
              </h2>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
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
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-elevated hover:text-ink disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Source URL bar for URL extractions */}
          {draft.sourceUrl && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-inset px-3.5 py-2.5 text-xs">
              <span className="truncate font-mono text-ink-muted">{draft.sourceUrl}</span>
              <a
                href={draft.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 font-medium text-accent-text hover:underline"
              >
                <span>Open Source</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}

          {/* Voice Speaker Diarization & Rename Strip */}
          {draft.kind === 'mic' && (
            <div className="space-y-2.5 rounded-md border border-line bg-inset p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Users className="h-4 w-4 text-accent-text" />
                  <span className="font-medium text-ink">
                    {speakerLabels.length > 1
                      ? `${speakerLabels.length} Voices Detected`
                      : 'Voice Transcript'}
                  </span>
                  <span aria-hidden="true" className="text-ink-subtle">
                    ·
                  </span>
                  <span className="font-mono text-[11px] text-ink-muted">
                    {draft.micAiPolished
                      ? `AI Polished (${draft.micModelUsed || 'Connected Brain'})`
                      : 'Local Acoustic Formatter'}
                  </span>
                </div>
              </div>

              {speakerLabels.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
                  <span className="text-[11px] font-medium text-ink-muted">
                    Relabel speakers:
                  </span>
                  {speakerLabels.map((label) => {
                    const pendingName = speakerRenames[label] ?? label;
                    const changed =
                      pendingName.trim().length > 0 && pendingName.trim() !== label;
                    return (
                      <div key={label} className="flex items-center gap-1">
                        <input
                          type="text"
                          aria-label={`Rename ${label}`}
                          value={pendingName}
                          disabled={isSaving}
                          onChange={(e) =>
                            setSpeakerRenames((prev) => ({
                              ...prev,
                              [label]: e.target.value,
                            }))
                          }
                          className="min-h-[36px] w-28 rounded border border-line-strong bg-surface px-2 py-1 font-mono text-[11px] text-ink focus:border-accent focus:outline-none"
                        />
                        {changed && (
                          <button
                            type="button"
                            onClick={() => {
                              const nextName = pendingName.trim();
                              onChangeDraft((prev) => ({
                                ...prev,
                                content: renameSpeakerInTranscript(
                                  prev.content,
                                  label,
                                  nextName,
                                ),
                              }));
                              setSpeakerRenames((prev) => {
                                const copy = {...prev};
                                delete copy[label];
                                return copy;
                              });
                            }}
                            className="min-h-[36px] rounded bg-accent px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-accent-hover"
                          >
                            Apply
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* OCR Preview Image, Confidence & High-Res Refinement */}
          {draft.kind === 'ocr' && (
            <div className="space-y-3 rounded-md border border-line bg-inset p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-ink">OCR Confidence</span>
                  <span aria-hidden="true" className="text-ink-subtle">
                    ·
                  </span>
                  {confidenceLevel && typeof draft.ocrConfidence === 'number' ? (
                    <span
                      className={`inline-flex items-center gap-1.5 font-mono font-semibold tabular-nums ${
                        confidenceLevel === 'Good'
                          ? 'text-emerald-400'
                          : confidenceLevel === 'Fair'
                            ? 'text-amber-400'
                            : 'text-red-400'
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
                    <span className="text-ink-muted">Screen Capture</span>
                  )}
                  {draft.ocrMode && (
                    <>
                      <span aria-hidden="true" className="text-ink-subtle">
                        ·
                      </span>
                      <span className="font-mono text-[11px] text-ink-muted">
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
                      className="min-h-[42px] rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-xs text-ink focus:border-accent focus:outline-none"
                    >
                      <option value="full">Full Image</option>
                      <option value="center_article">Center Region</option>
                      <option value="bottom_captions">Bottom Captions</option>
                    </select>

                    <button
                      type="button"
                      disabled={isRefiningOcr || isSaving}
                      onClick={() => void onRefineOcrHighRes(draft.ocrZone || 'full')}
                      className="inline-flex min-h-[42px] items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent-text hover:opacity-90 disabled:opacity-50"
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
                <div className="overflow-hidden rounded border border-line bg-canvas">
                  <img
                    src={draft.previewDataUrl}
                    alt="Cropped OCR preview"
                    className="max-h-44 w-full object-contain"
                  />
                </div>
              )}

              {draft.ocrNotice && (
                <p className="text-xs text-amber-400">{draft.ocrNotice}</p>
              )}
            </div>
          )}

          {/* Editable Title */}
          <div className="space-y-1.5">
            <label
              htmlFor="review-entry-title"
              className="block text-xs font-medium text-ink-muted"
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
              className="min-h-[44px] w-full rounded-md border border-line-strong bg-inset px-3.5 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
            />
          </div>

          {/* Editable Content */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="review-entry-content"
                className="block text-xs font-medium text-ink-muted"
              >
                {draft.kind === 'mic'
                  ? 'Transcript Content (Editable)'
                  : draft.kind === 'ocr'
                    ? 'Recognized Text (Editable)'
                    : 'Extracted Content (Editable)'}
              </label>
              <span className="font-mono text-[11px] tabular-nums text-ink-subtle">
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
              className="w-full rounded-md border border-line-strong bg-inset p-3.5 font-mono text-xs leading-relaxed text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
            />
          </div>

          {/* Folder (with AI Auto-Folder), Status, Tags */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-1">
                <label
                  htmlFor="review-entry-folder"
                  className="block text-xs font-medium text-ink-muted"
                >
                  Target Folder
                </label>
                {onAutoCategorizeFolder && (
                  <button
                    type="button"
                    disabled={isSaving || isCategorizingFolder || !draft.content.trim()}
                    onClick={() => void onAutoCategorizeFolder()}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-accent-text hover:underline disabled:opacity-50"
                  >
                    <Sparkles className="h-3 w-3" />
                    <span>{isCategorizingFolder ? 'Detecting…' : 'AI Suggest'}</span>
                  </button>
                )}
              </div>
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
                className="min-h-[44px] w-full rounded-md border border-line-strong bg-inset px-3 py-2 text-xs text-ink focus:border-accent focus:outline-none"
              >
                <option value={AUTO_FOLDER_OPTION}>
                  Auto-Create Topic Folder
                  {draft.autoFolderSuggestion ? ` (${draft.autoFolderSuggestion})` : ''}
                </option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
              {draft.folderId === AUTO_FOLDER_OPTION && draft.autoFolderSuggestion && (
                <div className="flex items-center gap-1.5 font-mono text-[11px] text-accent-text">
                  <FolderPlus className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    {matchedAutoFolder
                      ? `Matches existing "${matchedAutoFolder.name}"`
                      : `Auto-creates "${draft.autoFolderSuggestion}"`}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <span className="block text-xs font-medium text-ink-muted">
                Knowledge Status
              </span>
              <div className="grid min-h-[44px] grid-cols-2 gap-1 rounded-md border border-line-strong bg-inset p-1">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() =>
                    onChangeDraft((prev) => ({...prev, status: 'reviewed'}))
                  }
                  className={`rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                    draft.status === 'reviewed'
                      ? 'bg-elevated text-ink'
                      : 'text-ink-muted hover:text-ink'
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
                      ? 'bg-accent-soft text-accent-text'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  Trusted
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="review-entry-tags"
                className="block text-xs font-medium text-ink-muted"
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
                placeholder="e.g. food, notes"
                className="min-h-[44px] w-full rounded-md border border-line-strong bg-inset px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          {/* Save Mode Toggle for Long URL / Article / Transcripts */}
          {(draft.content.length > 600 || draft.kind === 'url' || draft.kind === 'paste') && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-inset px-3.5 py-2.5">
              <div className="text-xs text-ink-muted">
                <span className="font-medium text-ink">Storage Format:</span>{' '}
                <span>
                  {draft.saveMode === 'single'
                    ? 'Keep exact title and content as one entry'
                    : 'Auto-split long text into topical entries'}
                </span>
              </div>
              <div className="flex items-center gap-1 rounded-md border border-line-strong bg-surface p-1">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() =>
                    onChangeDraft((prev) => ({...prev, saveMode: 'single'}))
                  }
                  className={`min-h-[36px] rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    draft.saveMode === 'single'
                      ? 'bg-elevated text-ink'
                      : 'text-ink-muted hover:text-ink'
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
                  className={`min-h-[36px] rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    draft.saveMode === 'distill'
                      ? 'bg-elevated text-ink'
                      : 'text-ink-muted hover:text-ink'
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
              className="rounded-md border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-400"
            >
              {errorMessage}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-inset px-5 py-3.5">
          <button
            type="button"
            disabled={isSaving || isRefiningOcr}
            onClick={onDiscard}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-line-strong bg-surface px-4 py-2 text-xs font-semibold text-ink hover:bg-elevated disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4 text-ink-muted" />
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
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-accent px-5 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
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
