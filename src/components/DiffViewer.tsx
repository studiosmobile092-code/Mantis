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
    <div className="overflow-hidden rounded-md border border-slate-800 bg-[#0B1120]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/80 px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <span className="font-semibold text-slate-200">{filePath}</span>
          <span aria-hidden="true" className="text-slate-600">
            ·
          </span>
          <span className="tabular-nums text-emerald-400">+{stats.additions}</span>
          <span className="tabular-nums text-red-400">-{stats.deletions}</span>
        </div>

        <button
          type="button"
          onClick={() => setShowFullFile((v) => !v)}
          className="min-h-[34px] rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700"
        >
          {showFullFile ? 'Show Changed Hunks' : 'Show Full Diff'}
        </button>
      </div>

      {stats.additions === 0 && stats.deletions === 0 ? (
        <div className="px-4 py-6 text-center font-mono text-xs text-slate-400">
          No line changes yet — edit the proposed code to customize your patch.
        </div>
      ) : (
        <div className="max-h-96 overflow-auto font-mono text-xs leading-relaxed">
          <table className="w-full border-collapse">
            <tbody>
              {visibleLines.map((line, index) => {
                const rowBg =
                  line.type === 'add'
                    ? 'bg-emerald-950/35 text-emerald-100'
                    : line.type === 'remove'
                      ? 'bg-red-950/35 text-red-200'
                      : 'text-slate-300';
                const marker = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
                const markerColor =
                  line.type === 'add'
                    ? 'text-emerald-400'
                    : line.type === 'remove'
                      ? 'text-red-400'
                      : 'text-slate-600';

                return (
                  <tr key={`${index}-${line.oldLineNo ?? 'n'}-${line.newLineNo ?? 'n'}`} className={rowBg}>
                    <td className="w-10 select-none border-r border-slate-800/80 px-2 py-0.5 text-right tabular-nums text-[11px] text-slate-500">
                      {line.oldLineNo ?? ''}
                    </td>
                    <td className="w-10 select-none border-r border-slate-800/80 px-2 py-0.5 text-right tabular-nums text-[11px] text-slate-500">
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
