import {BookOpen, CheckCircle2, Compass, Radio, Sparkles, X} from 'lucide-react';

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
  const stepsDone = [
    knowledgeCount > 0,
    trustedCount > 0,
    hasInteractedChat,
  ];
  const completedCount = stepsDone.filter(Boolean).length;

  return (
    <section
      aria-label="60-Second Mantis Onboarding"
      className="mantis-slide-up rounded-lg border border-accent-border bg-surface p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-ink">
            <Compass className="h-4 w-4 text-accent-text" />
            <span>Quick Start Workflow</span>
            <span aria-hidden="true" className="text-ink-subtle">
              ·
            </span>
            <span className="font-mono text-[11px] tabular-nums text-accent-text">
              {completedCount}/3 ready
            </span>
          </div>
          <p className="text-xs text-ink-muted">
            Teach Mantis what matters to you, verify trusted memory, then chat or capture from anywhere.
          </p>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss onboarding guide"
          className="inline-flex min-h-[40px] min-w-[40px] shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-elevated hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
        <button
          type="button"
          onClick={onTeachFirstRule}
          className="flex min-h-[56px] items-start gap-2.5 rounded-md border border-line bg-inset p-3 text-left transition-colors hover:border-accent-border"
        >
          {stepsDone[0] ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" />
          ) : (
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" />
          )}
          <div className="min-w-0">
            <div className="text-xs font-semibold text-ink">1. Teach a Rule</div>
            <div className="mt-0.5 text-[11px] text-ink-muted">
              Store facts, rules, or definitions into Auto-Folders.
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={onOpenKnowledge}
          className="flex min-h-[56px] items-start gap-2.5 rounded-md border border-line bg-inset p-3 text-left transition-colors hover:border-accent-border"
        >
          {stepsDone[1] ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" />
          ) : (
            <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
          )}
          <div className="min-w-0">
            <div className="text-xs font-semibold text-ink">2. Trust Memory</div>
            <div className="mt-0.5 text-[11px] text-ink-muted">
              Mark key notes Trusted so AI answers cite them strongly.
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={onOpenCapture}
          className="flex min-h-[56px] items-start gap-2.5 rounded-md border border-line bg-inset p-3 text-left transition-colors hover:border-accent-border"
        >
          {stepsDone[2] ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" />
          ) : (
            <Radio className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
          )}
          <div className="min-w-0">
            <div className="text-xs font-semibold text-ink">3. Capture &amp; Chat</div>
            <div className="mt-0.5 text-[11px] text-ink-muted">
              Extract links, run OCR, or record multi-voice speech.
            </div>
          </div>
        </button>
      </div>
    </section>
  );
}
