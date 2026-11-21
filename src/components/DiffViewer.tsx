import {Lock} from 'lucide-react';
import {useMemo, useState} from 'react';
import {collapseDiffContext, computeLineDiff, summarizeDiffStats} from '../lib/diff';

interface DiffViewerProps {
  filePath: string;
  originalContent: string;
  proposedContent: string;
}

export function DiffViewer({filePath, originalContent, proposedContent}: DiffViewerProps) {
  const [showFullFile, setShowFullFile] = useState(false);

  const allLines = useMemo(
    () => computeLineDiff(originalContent, proposedContent),
    [originalContent, proposedContent],
  );
  const stats = useMemo(() => summarizeDiffStats(allLines), [allLines]);
  const visibleLines = useMemo(
    () => (showFullFile ? allLines : collapseDiffContext(allLines, 3)),
    [allLines, showFullFile],
  );

  return (
    <div className="overflow-hidden rounded-md border border-line bg-inset">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <span className="font-semibold text-ink">{filePath}</span>
          <span aria-hidden="true" className="text-ink-subtle">
            ·
          </span>
          <span className="tabular-nums text-emerald-400">+{stats.additions}</span>
          <span className="tabular-nums text-red-400">-{stats.deletions}</span>
          <span aria-hidden="true" className="text-ink-subtle">
            ·
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-400">
            <Lock className="h-3 w-3" />
            <span>Propose-Only · Approval Required</span>
          </span>
        </div>

        <button
          type="button"
          onClick={() => setShowFullFile((v) => !v)}
          className="min-h-[38px] rounded border border-line-strong bg-inset px-2.5 py-1 text-[11px] font-medium text-ink hover:bg-elevated"
        >
          {showFullFile ? 'Show Changed Hunks' : 'Show Full Diff'}
        </button>
      </div>

      {stats.additions === 0 && stats.deletions === 0 ? (
        <div className="px-4 py-6 text-center font-mono text-xs text-ink-muted">
          No line changes yet — edit the proposed code to customize your patch.
        </div>
      ) : (
        <div className="max-h-96 overflow-auto font-mono text-xs leading-relaxed">
          <table className="w-full border-collapse">
            <tbody>
              {visibleLines.map((line, index) => {
                const rowBg =
                  line.type === 'add'
                    ? 'bg-emerald-500/15 text-ink'
                    : line.type === 'remove'
                      ? 'bg-red-500/15 text-ink'
                      : 'text-ink-muted';
                const marker = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
                const markerColor =
                  line.type === 'add'
                    ? 'text-emerald-400'
                    : line.type === 'remove'
                      ? 'text-red-400'
                      : 'text-ink-subtle';

                return (
                  <tr
                    key={`${index}-${line.oldLineNo ?? 'n'}-${line.newLineNo ?? 'n'}`}
                    className={rowBg}
                  >
                    <td className="w-10 select-none border-r border-line px-2 py-0.5 text-right tabular-nums text-[11px] text-ink-subtle">
                      {line.oldLineNo ?? ''}
                    </td>
                    <td className="w-10 select-none border-r border-line px-2 py-0.5 text-right tabular-nums text-[11px] text-ink-subtle">
                      {line.newLineNo ?? ''}
                    </td>
                    <td className={`w-6 select-none px-1.5 py-0.5 text-center font-semibold ${markerColor}`}>
                      {marker}
                    </td>
                    <td className="whitespace-pre px-2 py-0.5">{line.text || ' '}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
