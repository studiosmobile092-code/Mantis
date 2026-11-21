import {Check, CheckCircle2, Clock, FileCode2, ShieldAlert, X} from 'lucide-react';
import {useState} from 'react';
import type {AssassinPrepBrief} from '../types/mantis';
import {DiffViewer} from './DiffViewer';

interface AssassinBriefCardProps {
  brief: AssassinPrepBrief;
  onApprove: (brief: AssassinPrepBrief) => Promise<void>;
  onReject: (brief: AssassinPrepBrief) => void;
}

export function AssassinBriefCard({brief, onApprove, onReject}: AssassinBriefCardProps) {
  const [isApproving, setIsApproving] = useState(false);

  async function handleApproveClick() {
    setIsApproving(true);
    try {
      await onApprove(brief);
    } finally {
      setIsApproving(false);
    }
  }

  return (
    <section
      aria-label="Smart-Assassin Execution Brief"
      className="mantis-slide-up rounded-lg border border-accent-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 font-mono text-[11px] text-accent-text uppercase">
            <span>Smart-Assassin Execution Brief</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1 tabular-nums text-ink-muted">
              <Clock className="h-3 w-3" />
              {brief.prepLatencyMs} ms parallel prep
            </span>
          </div>
          <h3 className="text-sm font-semibold text-ink">{brief.goal}</h3>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isApproving}
            onClick={() => onReject(brief)}
            className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-line-strong bg-inset px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5 text-danger" />
            <span>Reject &amp; Log DPO</span>
          </button>

          <button
            type="button"
            disabled={isApproving}
            onClick={() => void handleApproveClick()}
            className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            <span>
              {isApproving
                ? 'Staging…'
                : brief.proposedDiffs.length > 0
                  ? 'Approve & Stage Diff'
                  : 'Approve & Log SFT'}
            </span>
          </button>
        </div>
      </div>

      {/* Parallel Prep Breakdown */}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <div className="font-mono text-[11px] font-medium text-ink-muted">
            Matched Context ({brief.matchedMemories.length} memories · {brief.matchedFiles.length} files)
          </div>
          <div className="space-y-1">
            {brief.matchedMemories.slice(0, 3).map((m) => (
              <div
                key={m.entry.id}
                className="flex items-center justify-between gap-2 rounded border border-line bg-inset px-2.5 py-1.5 text-xs"
              >
                <span className="truncate font-medium text-ink">{m.entry.title}</span>
                <span className="shrink-0 font-mono text-[11px] text-accent-text">
                  {m.folderName}
                </span>
              </div>
            ))}
            {brief.matchedFiles.slice(0, 3).map((f) => (
              <div
                key={f.file.id}
                className="flex items-center gap-2 rounded border border-line bg-inset px-2.5 py-1.5 font-mono text-[11px] text-ink-muted"
              >
                <FileCode2 className="h-3.5 w-3.5 shrink-0 text-accent-text" />
                <span className="truncate">{f.file.path}</span>
              </div>
            ))}
            {brief.matchedMemories.length === 0 && brief.matchedFiles.length === 0 && (
              <div className="rounded border border-line bg-inset px-2.5 py-2 text-xs text-ink-subtle">
                Zero prior context matched — executed using fresh rules &amp; safety checks.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="font-mono text-[11px] font-medium text-ink-muted">
            Automated Verification Gate
          </div>
          <div className="space-y-1">
            {brief.verifierChecks.map((check, i) => (
              <div
                key={i}
                className="flex items-start justify-between gap-2 rounded border border-line bg-inset px-2.5 py-1.5 text-xs"
              >
                <div className="flex items-start gap-2">
                  {check.passed ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-text" />
                  ) : (
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
                  )}
                  <div>
                    <div className="font-medium text-ink">{check.label}</div>
                    <div className="text-[11px] text-ink-muted">{check.detail}</div>
                  </div>
                </div>
                <span
                  className={`shrink-0 font-mono text-[10px] uppercase ${
                    check.passed ? 'text-accent-text' : 'text-warn'
                  }`}
                >
                  {check.passed ? 'Pass' : 'Warn'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Staged Diff Previews */}
      {brief.proposedDiffs.length > 0 && (
        <div className="mt-3 space-y-2.5">
          {brief.proposedDiffs.map((diff) => (
            <div key={diff.filePath} className="space-y-1.5">
              <div className="text-xs text-ink-muted">
                <strong className="text-ink">{diff.title}:</strong> {diff.rationale}
              </div>
              <DiffViewer
                filePath={diff.filePath}
                originalContent={diff.originalContent}
                proposedContent={diff.proposedContent}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
