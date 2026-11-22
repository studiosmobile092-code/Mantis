interface LossSparklineProps {
  history: number[];
  height?: number;
  label?: string;
}

export function LossSparkline({history, height = 52, label}: LossSparklineProps) {
  if (history.length === 0) {
    return (
      <div
        className="flex items-center justify-between border border-dashed border-line bg-inset px-3 font-mono text-[11px] text-ink-subtle"
        style={{height}}
      >
        <span>{label || 'Cross-Entropy Loss'}</span>
        <span>0 steps · no gradient history</span>
      </div>
    );
  }

  const width = 260;
  const padX = 6;
  const padY = 8;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  const minLoss = Math.min(...history);
  const maxLoss = Math.max(...history);
  const span = Math.max(1e-4, maxLoss - minLoss);

  const points = history.map((val, idx) => {
    const x =
      history.length === 1
        ? padX + plotW / 2
        : padX + (idx / (history.length - 1)) * plotW;
    const normY = (val - minLoss) / span;
    const y = padY + (1 - normY) * plotH;
    return {x, y, val};
  });

  const polyline = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const lastPoint = points[points.length - 1];
  const firstLoss = history[0];
  const latestLoss = history[history.length - 1];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between font-mono text-[11px] tabular-nums text-ink-muted">
        <span>{label || 'Loss Curve'}</span>
        <span>
          {firstLoss.toFixed(3)} →{' '}
          <strong className="font-semibold text-accent-text">{latestLoss.toFixed(3)}</strong>
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Training loss curve from ${firstLoss.toFixed(3)} to ${latestLoss.toFixed(3)}`}
        className="w-full overflow-visible rounded border border-line bg-inset"
        style={{height}}
      >
        <line
          x1={padX}
          y1={padY + plotH / 2}
          x2={width - padX}
          y2={padY + plotH / 2}
          stroke="currentColor"
          strokeOpacity="0.08"
          strokeDasharray="3 3"
        />
        {points.length > 1 && (
          <polyline
            fill="none"
            stroke="var(--accent-text, #10b981)"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={polyline}
          />
        )}
        <circle
          cx={lastPoint.x}
          cy={lastPoint.y}
          r="3"
          fill="var(--accent-text, #10b981)"
        />
      </svg>

      <div className="flex items-center justify-between font-mono text-[10px] tabular-nums text-ink-subtle">
        <span>min {minLoss.toFixed(3)}</span>
        <span>{history.length} logged steps</span>
        <span>max {maxLoss.toFixed(3)}</span>
      </div>
    </div>
  );
}
