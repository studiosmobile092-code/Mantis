import {
  fetchGitHubFileContent,
  fetchGitHubRepoMetadata,
  fetchGitHubTreeFiles,
} from './github';
import {retrieveRelevantKnowledge} from './memory';
import {generateImprovementSuggestion, type GeneratedSuggestionDraft} from './suggestions';
import type {
  KnowledgeEntry,
  KnowledgeFolder,
  RepoFile,
  SelfAuditFinding,
  SelfAuditReport,
} from '../types/mantis';

export const DEFAULT_MANTIS_REPO = 'studiosmobile092-code/Mantis';

const HIGH_GUARD_PATTERNS = [
  /^\.github\/workflows\//i,
  /^supabase\//i,
  /^src\/lib\/supabase\.ts$/i,
  /^vite\.config\./i,
  /^package\.json$/i,
];

export function isHighGuardPath(filePath: string): boolean {
  return HIGH_GUARD_PATTERNS.some((re) => re.test(filePath));
}

export function looksLikeMantisRepo(files: RepoFile[]): boolean {
  const paths = new Set(files.map((f) => f.path.toLowerCase()));
  return (
    paths.has('src/app.tsx') &&
    (paths.has('src/lib/memory.ts') ||
      paths.has('src/lib/supabase.ts') ||
      paths.has('progress.md'))
  );
}

export async function fetchMantisSelfSnapshot(
  owner: string,
  repo: string,
  branchOverride?: string,
  token?: string,
  onProgress?: (text: string) => void,
): Promise<{repoLabel: string; branch: string; files: RepoFile[]}> {
  onProgress?.(`Reading ${owner}/${repo} metadata...`);
  const meta = await fetchGitHubRepoMetadata(owner, repo, token);
  const branch = branchOverride?.trim() || meta.defaultBranch;

  onProgress?.(`Listing ${owner}/${repo} source files on "${branch}"...`);
  const treeFiles = await fetchGitHubTreeFiles(owner, repo, branch, token, 40);

  const files: RepoFile[] = [];
  const batchSize = 5;
  for (let i = 0; i < treeFiles.length; i += batchSize) {
    const batch = treeFiles.slice(i, i + batchSize);
    onProgress?.(
      `Inspecting ${Math.min(i + batch.length, treeFiles.length)} / ${treeFiles.length} project files...`,
    );
    const settled = await Promise.allSettled(
      batch.map(async (item) => {
        const content = await fetchGitHubFileContent(
          owner,
          repo,
          branch,
          item.path,
          meta.isPrivate,
          token,
        );
        return {
          id: `self-${item.path}`,
          user_id: 'self',
          connection_id: 'self',
          path: item.path,
          size_bytes: item.size,
          sha: item.sha,
          content,
          updated_at: new Date().toISOString(),
        } satisfies RepoFile;
      }),
    );
    for (const res of settled) {
      if (res.status === 'fulfilled') {
        files.push(res.value);
      }
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    repoLabel: `${meta.owner}/${meta.repo}`,
    branch,
    files,
  };
}

export function runMantisSelfAudit(
  files: RepoFile[],
  repoLabel: string,
  branch: string,
  entries: KnowledgeEntry[],
  folders: KnowledgeFolder[],
): SelfAuditReport {
  const findings: SelfAuditFinding[] = [];
  const matchedKnowledge = retrieveRelevantKnowledge(
    'mantis self improvement architecture security tablet supabase workflow',
    entries,
    folders,
    4,
  );
  const matchedKnowledgeTitles = matchedKnowledge.map((m) => m.entry.title);

  for (const file of files) {
    const lower = file.path.toLowerCase();
    const content = file.content;
    const highGuard = isHighGuardPath(file.path);

    // 1. Secret leak scan (skip intentional detector regexes in suggestions.ts / selfImprove.ts)
    const isDetectorFile =
      lower === 'src/lib/suggestions.ts' || lower === 'src/lib/selfimprove.ts';
    if (!isDetectorFile && !lower.endsWith('.example') && !lower.endsWith('.md')) {
      if (/(sb_secret_[A-Za-z0-9_-]{8,}|hf_[A-Za-z0-9]{15,}|service_role)/i.test(content)) {
        findings.push({
          id: `${file.path}::secret-leak`,
          filePath: file.path,
          severity: 'high',
          category: 'security',
          title: 'Potential secret credential found in repository file',
          description:
            'Detected a Supabase Secret key, Hugging Face token, or service_role string. Remove immediately and rotate exposed tokens.',
          highGuard: true,
          canAutoStageDiff: false,
          goalHint: 'Remove secret key pattern from frontend or public repo',
          fileContent: content,
        });
      }
    }

    // 2. Unsafe HTML / eval patterns
    if (
      (lower.endsWith('.ts') || lower.endsWith('.tsx')) &&
      (/\bdangerouslySetInnerHTML\b/.test(content) || /\beval\s*\(/.test(content))
    ) {
      findings.push({
        id: `${file.path}::unsafe-exec`,
        filePath: file.path,
        severity: 'high',
        category: 'security',
        title: 'Unsafe DOM injection or dynamic eval pattern',
        description:
          'Avoid dangerouslySetInnerHTML or eval() in frontend TypeScript modules to prevent XSS.',
        highGuard,
        canAutoStageDiff: false,
        goalHint: 'Replace unsafe HTML injection or eval with safe JSX rendering',
        fileContent: content,
      });
    }

    // 3. target="_blank" without rel="noopener noreferrer"
    if ((lower.endsWith('.tsx') || lower.endsWith('.jsx')) && /target="_blank"(?![^>]*rel=)/.test(content)) {
      findings.push({
        id: `${file.path}::blank-rel`,
        filePath: file.path,
        severity: 'medium',
        category: 'security',
        title: 'External link missing rel="noopener noreferrer"',
        description:
          'Add rel="noopener noreferrer" to target="_blank" anchors for tabnabbing protection.',
        highGuard,
        canAutoStageDiff: true,
        goalHint: 'Add rel="noopener noreferrer" to target="_blank" links',
        fileContent: content,
      });
    }

    // 4. <button> missing explicit type= attribute
    if (
      (lower.endsWith('.tsx') || lower.endsWith('.jsx')) &&
      /<button(?![^>]*\btype=)([^>]*)>/.test(content)
    ) {
      findings.push({
        id: `${file.path}::button-type`,
        filePath: file.path,
        severity: 'medium',
        category: 'accessibility',
        title: '<button> tag missing explicit type attribute',
        description:
          'Explicit type="button" or type="submit" prevents accidental form submissions on mobile/tablet Chrome.',
        highGuard,
        canAutoStageDiff: true,
        goalHint: 'Add explicit type="button" to button elements',
        fileContent: content,
      });
    }

    // 5. Blocking window.alert / window.confirm / window.open
    if (
      (lower.endsWith('.ts') || lower.endsWith('.tsx')) &&
      !isDetectorFile &&
      /\bwindow\.(alert|confirm)\s*\(/.test(content)
    ) {
      findings.push({
        id: `${file.path}::blocking-modal`,
        filePath: file.path,
        severity: 'medium',
        category: 'accessibility',
        title: 'Blocking browser dialog (window.alert/confirm)',
        description:
          'Replace blocking browser dialogs with inline React confirmation UI for Galaxy Tab & iFrame compatibility.',
        highGuard,
        canAutoStageDiff: true,
        goalHint: 'Replace blocking window.alert/confirm with inline UI state',
        fileContent: content,
      });
    }

    // 6. GitHub Actions workflow lockfile & peer-deps guard
    if (
      (lower.endsWith('.yml') || lower.endsWith('.yaml')) &&
      lower.includes('.github/workflows/') &&
      (content.includes('run: npm ci') ||
        (content.includes('npm install') && !content.includes('--legacy-peer-deps')))
    ) {
      findings.push({
        id: `${file.path}::workflow-install`,
        filePath: file.path,
        severity: 'high',
        category: 'reliability',
        title: 'GitHub Actions install step may fail without lockfile/peer fallback',
        description:
          'Ensure workflow checks for package-lock.json and passes --legacy-peer-deps so Vite/esbuild peers install cleanly.',
        highGuard: true,
        canAutoStageDiff: true,
        goalHint: 'Add lockfile fallback and --legacy-peer-deps in workflow install step',
        fileContent: content,
      });
    }

    // 7. SQL RLS without explicit Postgres GRANTs
    if (
      lower.endsWith('.sql') &&
      content.toLowerCase().includes('enable row level security') &&
      !content.toLowerCase().includes('grant usage on schema public')
    ) {
      findings.push({
        id: `${file.path}::sql-grants`,
        filePath: file.path,
        severity: 'high',
        category: 'reliability',
        title: 'RLS enabled without explicit schema/table GRANT statements',
        description:
          'Postgres checks table GRANT privileges before RLS (42501). Add explicit GRANT USAGE ON SCHEMA public and table grants.',
        highGuard: true,
        canAutoStageDiff: true,
        goalHint: 'Add explicit Postgres GRANT USAGE and table grants alongside RLS',
        fileContent: content,
      });
    }

    // 8. Leftover console.log statements
    if ((lower.endsWith('.ts') || lower.endsWith('.tsx')) && /^\s*console\.log\(/m.test(content)) {
      findings.push({
        id: `${file.path}::console-log`,
        filePath: file.path,
        severity: 'low',
        category: 'maintainability',
        title: 'Leftover console.log debugging call',
        description: 'Clean up debug console.log lines before production builds.',
        highGuard,
        canAutoStageDiff: true,
        goalHint: 'Remove leftover debug console.log statements',
        fileContent: content,
      });
    }

    // 9. Large component / module split suggestion (> 550 lines)
    if (lower.endsWith('.tsx') || lower.endsWith('.ts')) {
      const lineCount = content.split('\n').length;
      if (lineCount > 550) {
        findings.push({
          id: `${file.path}::large-module`,
          filePath: file.path,
          severity: 'low',
          category: 'maintainability',
          title: `Large module (${lineCount} lines) — candidate for modular extraction`,
          description: `${file.path} is ${lineCount} lines long. Extracting helper hooks or subcomponents keeps edits safer and faster to review on tablet.`,
          highGuard,
          canAutoStageDiff: true,
          goalHint: `Modularize ${file.path} (${lineCount} lines) into smaller focused sub-units`,
          fileContent: content,
        });
      }
    }

    // 10. Bundle chunking optimization check on vite.config.ts
    if (lower === 'vite.config.ts' && !content.includes('manualChunks') && !content.includes('codeSplitting')) {
      findings.push({
        id: `${file.path}::vite-chunking`,
        filePath: file.path,
        severity: 'low',
        category: 'reliability',
        title: 'Vite build produces a single JS bundle (>500 kB warning)',
        description:
          'Consider adding manual vendor chunking (e.g. @supabase/supabase-js & lucide-react) in vite.config.ts to speed up mobile/tablet loads on GitHub Pages.',
        highGuard: true,
        canAutoStageDiff: true,
        goalHint: 'Stage Vite chunk-splitting review note for faster tablet load',
        fileContent: content,
      });
    }
  }

  // Sort high -> medium -> low, then path
  const rank: Record<SelfAuditFinding['severity'], number> = {high: 0, medium: 1, low: 2};
  findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.filePath.localeCompare(b.filePath));

  // Honest health score based strictly on real findings
  let penalty = 0;
  for (const f of findings) {
    if (f.severity === 'high') penalty += 15;
    else if (f.severity === 'medium') penalty += 7;
    else penalty += 3;
  }
  const healthScore = files.length === 0 ? 0 : Math.max(0, Math.min(100, 100 - penalty));

  return {
    repoLabel,
    branch,
    filesScanned: files.length,
    healthScore,
    findings,
    matchedKnowledgeTitles,
    scannedAt: new Date().toISOString(),
  };
}

export function buildSelfImprovementDraft(
  finding: SelfAuditFinding,
  entries: KnowledgeEntry[],
  folders: KnowledgeFolder[],
): GeneratedSuggestionDraft {
  const syntheticFile: RepoFile = {
    id: finding.id,
    user_id: 'self',
    connection_id: 'self',
    path: finding.filePath,
    size_bytes: finding.fileContent.length,
    sha: '',
    content: finding.fileContent,
    updated_at: new Date().toISOString(),
  };

  const draft = generateImprovementSuggestion(
    syntheticFile,
    finding.goalHint,
    entries,
    folders,
  );

  return {
    ...draft,
    title: `[Self-Audit] ${finding.title}`,
    rationale: `${finding.description}${
      finding.highGuard
        ? ' [HIGH-GUARD FILE: inspect diff carefully and open PR on a separate mantis/* branch.]'
        : ''
    } ${draft.rationale}`.trim(),
  };
}
