import type {DiffLine} from '../types/mantis';

export interface DiffStats {
  additions: number;
  deletions: number;
  unchanged: number;
}

/**
 * Computes a clean line-by-line diff using LCS (with a fast fallback for huge files).
 */
export function computeLineDiff(original: string, proposed: string): DiffLine[] {
  const oldLines = original === '' ? [] : original.replace(/\r\n/g, '\n').split('\n');
  const newLines = proposed === '' ? [] : proposed.replace(/\r\n/g, '\n').split('\n');

  if (oldLines.length === 0) {
    return newLines.map((text, idx) => ({
      type: 'add',
      oldLineNo: null,
      newLineNo: idx + 1,
      text,
    }));
  }

  if (newLines.length === 0) {
    return oldLines.map((text, idx) => ({
      type: 'remove',
      oldLineNo: idx + 1,
      newLineNo: null,
      text,
    }));
  }

  // Guard DP memory on large files (> 600x600) by trimming common prefix/suffix first
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const result: DiffLine[] = [];

  for (let i = 0; i < prefix; i += 1) {
    result.push({
      type: 'context',
      oldLineNo: i + 1,
      newLineNo: i + 1,
      text: oldLines[i],
    });
  }

  const midOld = oldLines.slice(prefix, oldLines.length - suffix);
  const midNew = newLines.slice(prefix, newLines.length - suffix);

  if (midOld.length * midNew.length <= 250_000) {
    const m = midOld.length;
    const n = midNew.length;
    const dp: Int32Array[] = Array.from({length: m + 1}, () => new Int32Array(n + 1));

    for (let i = m - 1; i >= 0; i -= 1) {
      for (let j = n - 1; j >= 0; j -= 1) {
        if (midOld[i] === midNew[j]) {
          dp[i][j] = 1 + dp[i + 1][j + 1];
        } else {
          dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
        }
      }
    }

    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (midOld[i] === midNew[j]) {
        result.push({
          type: 'context',
          oldLineNo: prefix + i + 1,
          newLineNo: prefix + j + 1,
          text: midOld[i],
        });
        i += 1;
        j += 1;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        result.push({
          type: 'remove',
          oldLineNo: prefix + i + 1,
          newLineNo: null,
          text: midOld[i],
        });
        i += 1;
      } else {
        result.push({
          type: 'add',
          oldLineNo: null,
          newLineNo: prefix + j + 1,
          text: midNew[j],
        });
        j += 1;
      }
    }

    while (i < m) {
      result.push({
        type: 'remove',
        oldLineNo: prefix + i + 1,
        newLineNo: null,
        text: midOld[i],
      });
      i += 1;
    }

    while (j < n) {
      result.push({
        type: 'add',
        oldLineNo: null,
        newLineNo: prefix + j + 1,
        text: midNew[j],
      });
      j += 1;
    }
  } else {
    for (let i = 0; i < midOld.length; i += 1) {
      result.push({
        type: 'remove',
        oldLineNo: prefix + i + 1,
        newLineNo: null,
        text: midOld[i],
      });
    }
    for (let j = 0; j < midNew.length; j += 1) {
      result.push({
        type: 'add',
        oldLineNo: null,
        newLineNo: prefix + j + 1,
        text: midNew[j],
      });
    }
  }

  const tailStartOld = oldLines.length - suffix;
  const tailStartNew = newLines.length - suffix;
  for (let k = 0; k < suffix; k += 1) {
    result.push({
      type: 'context',
      oldLineNo: tailStartOld + k + 1,
      newLineNo: tailStartNew + k + 1,
      text: oldLines[tailStartOld + k],
    });
  }

  return result;
}

export function summarizeDiffStats(diffLines: DiffLine[]): DiffStats {
  let additions = 0;
  let deletions = 0;
  let unchanged = 0;
  for (const line of diffLines) {
    if (line.type === 'add') additions += 1;
    else if (line.type === 'remove') deletions += 1;
    else unchanged += 1;
  }
  return {additions, deletions, unchanged};
}

export function collapseDiffContext(diffLines: DiffLine[], contextRadius = 3): DiffLine[] {
  const changedIndices = new Set<number>();
  diffLines.forEach((line, idx) => {
    if (line.type !== 'context') {
      for (
        let k = Math.max(0, idx - contextRadius);
        k <= Math.min(diffLines.length - 1, idx + contextRadius);
        k += 1
      ) {
        changedIndices.add(k);
      }
    }
  });

  if (changedIndices.size === 0) {
    return diffLines.slice(0, 20);
  }

  return diffLines.filter((_, idx) => changedIndices.has(idx));
}

export function createUnifiedPatch(
  filePath: string,
  original: string,
  proposed: string,
): string {
  const diff = computeLineDiff(original, proposed);
  const lines = [`--- a/${filePath}`, `+++ b/${filePath}`];
  for (const row of diff) {
    if (row.type === 'add') lines.push(`+${row.text}`);
    else if (row.type === 'remove') lines.push(`-${row.text}`);
    else lines.push(` ${row.text}`);
  }
  return lines.join('\n');
}
