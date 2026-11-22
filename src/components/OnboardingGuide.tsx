import {BookOpen, CheckCircle2, Radio, Sparkles, X} from 'lucide-react';

interface OnboardingGuideProps {
  knowledgeCount: number;
  trustedCount: number;
  hasInteractedChat: boolean;
  onTeachFirstRule: () => void;
  onOpenKnowledge: () => void;
  onOpenCapture: () => void;
  onDismiss: () => void;
}

export function OnboardingGuide({
  knowledgeCount,
  trustedCount,
  hasInteractedChat,
  onTeachFirstRule,
  onOpenKnowledge,
  onOpenCapture,
  onDismiss,
}: OnboardingGuideProps) {
  const stepsDone = [knowledgeCount > 0, trustedCount > 0, hasInteractedChat];
  const completedCount = stepsDone.filter(Boolean).length;

  return (
    <section
      aria-label="Workspace starter workflow"
      className="mx-auto w-full max-w-2xl rounded-lg border border-line bg-surface p-3.5 text-left"
    >
      <div className="flex items-center justify-between gap-2 border-b border-line pb-2.5">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-ink">Training Loop Checklist</span>
          <span aria-hidden="true" className="text-ink-subtle">
            ·
          </span>
          <span className="font-mono text-[11px] tabular-nums text-accent-text">
            {completedCount}/3 completed
          </span>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss training checklist"
          className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md text-ink-muted hover:bg-elevated hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={onTeachFirstRule}
          className="flex min-h-[48px] items-start gap-2.5 rounded-md border border-line bg-inset p-2.5 text-left transition-colors hover:border-line-strong"
        >
          {stepsDone[0] ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-text" />
          ) : (
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-text" />
          )}
          <div className="min-w-0">
            <div className="text-xs font-medium text-ink">1. Teach a Rule</div>
            <div className="mt-0.5 text-[11px] text-ink-muted">
              Add facts or conventions directly.
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={onOpenKnowledge}
          className="flex min-h-[48px] items-start gap-2.5 rounded-md border border-line bg-inset p-2.5 text-left transition-colors hover:border-line-strong"
        >
          {stepsDone[1] ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-text" />
          ) : (
            <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-muted" />
          )}
          <div className="min-w-0">
            <div className="text-xs font-medium text-ink">2. Verify Memory</div>
            <div className="mt-0.5 text-[11px] text-ink-muted">
              Mark high-value notes Trusted.
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={onOpenCapture}
          className="flex min-h-[48px] items-start gap-2.5 rounded-md border border-line bg-inset p-2.5 text-left transition-colors hover:border-line-strong"
        >
          {stepsDone[2] ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-text" />
          ) : (
            <Radio className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-muted" />
          )}
          <div className="min-w-0">
            <div className="text-xs font-medium text-ink">3. Capture &amp; Test</div>
            <div className="mt-0.5 text-[11px] text-ink-muted">
              Ingest links, OCR, or voice logs.
            </div>
          </div>
        </button>
      </div>
    </section>
  );
}
