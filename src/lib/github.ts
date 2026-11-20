export interface ParsedGitHubRepo {
  owner: string;
  repo: string;
}

export interface GitHubRepoMetadata {
  owner: string;
  repo: string;
  defaultBranch: string;
  description: string;
  isPrivate: boolean;
}

export interface GitHubTreeFile {
  path: string;
  sha: string;
  size: number;
}

const SESSION_PAT_KEY = 'mantis_github_read_token';

const ALLOWED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.sql',
  '.css',
  '.html',
  '.yml',
  '.yaml',
  '.py',
  '.sh',
  '.toml',
  '.txt',
]);

const ALLOWED_EXACT_NAMES = new Set([
  'dockerfile',
  'makefile',
  '.gitignore',
  '.env.example',
  'license',
]);

const SKIP_PREFIXES = ['node_modules/', 'dist/', 'build/', '.git/', 'coverage/', 'public/assets/'];

export function getSessionGitHubToken(): string {
  try {
    return window.sessionStorage.getItem(SESSION_PAT_KEY) || '';
  } catch {
    return '';
  }
}

export function setSessionGitHubToken(token: string): void {
  try {
    const trimmed = token.trim();
    if (trimmed) {
      window.sessionStorage.setItem(SESSION_PAT_KEY, trimmed);
    } else {
      window.sessionStorage.removeItem(SESSION_PAT_KEY);
    }
  } catch {
    // Ignore storage restriction errors
  }
}

export function parseGitHubRepoInput(raw: string): ParsedGitHubRepo | null {
  const cleaned = raw.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  if (!cleaned) return null;

  const urlMatch = cleaned.match(/github\.com\/([^/\s]+)\/([^/\s]+)/i);
  if (urlMatch) {
    return {owner: urlMatch[1], repo: urlMatch[2]};
  }

  const slashMatch = cleaned.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (slashMatch) {
    return {owner: slashMatch[1], repo: slashMatch[2]};
  }

  return null;
}

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
  };
  if (token && token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

function isIndexableFile(path: string, size: number): boolean {
  if (size <= 0 || size > 32_000) return false;
  const lower = path.toLowerCase();
  if (SKIP_PREFIXES.some((prefix) => lower.startsWith(prefix) || lower.includes(`/${prefix}`))) {
    return false;
  }
  const baseName = lower.split('/').pop() || '';
  if (baseName === 'package-lock.json' || baseName === 'bun.lock' || baseName === 'yarn.lock') {
    return false;
  }
  if (ALLOWED_EXACT_NAMES.has(baseName)) return true;
  const dotIdx = baseName.lastIndexOf('.');
  if (dotIdx === -1) return false;
  return ALLOWED_EXTENSIONS.has(baseName.slice(dotIdx));
}

function filePriority(path: string): number {
  const lower = path.toLowerCase();
  if (lower === 'readme.md' || lower === 'progress.md') return 0;
  if (lower === 'package.json' || lower === 'vite.config.ts') return 1;
  if (lower.startsWith('src/')) return 2;
  if (lower.startsWith('supabase/') || lower.startsWith('.github/')) return 3;
  return 4;
}

export async function fetchGitHubRepoMetadata(
  owner: string,
  repo: string,
  token?: string,
): Promise<GitHubRepoMetadata> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: buildHeaders(token),
  });
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        `Repository ${owner}/${repo} not found (or private — add a session-only read token if private).`,
      );
    }
    if (res.status === 403) {
      throw new Error('GitHub API rate limit reached. Add a read-only token or retry shortly.');
    }
    throw new Error(`GitHub API error (${res.status}).`);
  }
  const data = (await res.json()) as {
    default_branch?: string;
    description?: string | null;
    private?: boolean;
  };
  return {
    owner,
    repo,
    defaultBranch: data.default_branch || 'main',
    description: data.description || '',
    isPrivate: Boolean(data.private),
  };
}

export async function fetchGitHubTreeFiles(
  owner: string,
  repo: string,
  branch: string,
  token?: string,
  maxFiles = 40,
): Promise<GitHubTreeFile[]> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    {headers: buildHeaders(token)},
  );
  if (!res.ok) {
    throw new Error(`Could not list repository files for branch "${branch}" (${res.status}).`);
  }
  const data = (await res.json()) as {
    tree?: Array<{path?: string; type?: string; sha?: string; size?: number}>;
  };
  const files = (data.tree || [])
    .filter((item) => item.type === 'blob' && item.path && isIndexableFile(item.path, item.size || 0))
    .map((item) => ({
      path: item.path as string,
      sha: item.sha || '',
      size: item.size || 0,
    }));

  files.sort((a, b) => filePriority(a.path) - filePriority(b.path) || a.path.localeCompare(b.path));
  return files.slice(0, maxFiles);
}

export async function fetchGitHubFileContent(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  isPrivate: boolean,
  token?: string,
): Promise<string> {
  // Public repos can fetch via raw.githubusercontent.com without consuming REST API rate limits
  if (!isPrivate) {
    const encodedPath = path
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${encodedPath}`;
    const rawRes = await fetch(rawUrl);
    if (rawRes.ok) {
      return await rawRes.text();
    }
  }

  const encodedPath = path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const apiRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
    {
      headers: {
        ...buildHeaders(token),
        Accept: 'application/vnd.github.raw',
      },
    },
  );
  if (!apiRes.ok) {
    throw new Error(`Failed to fetch ${path} (${apiRes.status})`);
  }
  return await apiRes.text();
}

function toBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary);
}

/**
 * Guarded Phase 3 write action:
 * Never commits directly to the base branch. Creates a separate mantis/* branch and opens a Pull Request.
 */
export async function createPullRequestForApprovedSuggestion(params: {
  owner: string;
  repo: string;
  baseBranch: string;
  filePath: string;
  title: string;
  rationale: string;
  proposedContent: string;
  suggestionId: string;
  token: string;
}): Promise<string> {
  const token = params.token.trim();
  if (!token) {
    throw new Error('A session-only GitHub token with Pull Request permissions is required to open a PR.');
  }

  const headers = {
    ...buildHeaders(token),
    'Content-Type': 'application/json',
  };

  // 1. Get base branch SHA
  const refRes = await fetch(
    `https://api.github.com/repos/${params.owner}/${params.repo}/git/ref/heads/${encodeURIComponent(params.baseBranch)}`,
    {headers},
  );
  if (!refRes.ok) {
    throw new Error(`Could not read base branch "${params.baseBranch}" (${refRes.status}).`);
  }
  const refData = (await refRes.json()) as {object?: {sha?: string}};
  const baseSha = refData.object?.sha;
  if (!baseSha) {
    throw new Error('Missing base branch commit SHA.');
  }

  // 2. Create a guarded feature branch
  const branchName = `mantis/suggestion-${params.suggestionId.slice(0, 8)}`;
  const createBranchRes = await fetch(
    `https://api.github.com/repos/${params.owner}/${params.repo}/git/refs`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      }),
    },
  );
  if (!createBranchRes.ok && createBranchRes.status !== 422) {
    throw new Error(`Failed to create branch ${branchName} (${createBranchRes.status}).`);
  }

  // 3. Check if file already exists on that branch to include its blob SHA
  const encodedPath = params.filePath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  let existingFileSha: string | undefined;
  const existingRes = await fetch(
    `https://api.github.com/repos/${params.owner}/${params.repo}/contents/${encodedPath}?ref=${encodeURIComponent(branchName)}`,
    {headers},
  );
  if (existingRes.ok) {
    const existingData = (await existingRes.json()) as {sha?: string};
    existingFileSha = existingData.sha;
  }

  // 4. Commit updated file strictly to the new branch
  const putRes = await fetch(
    `https://api.github.com/repos/${params.owner}/${params.repo}/contents/${encodedPath}`,
    {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `Mantis approved suggestion: ${params.title}`,
        content: toBase64Utf8(params.proposedContent),
        branch: branchName,
        ...(existingFileSha ? {sha: existingFileSha} : {}),
      }),
    },
  );
  if (!putRes.ok) {
    throw new Error(`Failed to commit to branch ${branchName} (${putRes.status}). Check token permissions.`);
  }

  // 5. Open Pull Request for user review/merge
  const prRes = await fetch(
    `https://api.github.com/repos/${params.owner}/${params.repo}/pulls`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: `[Mantis] ${params.title}`,
        head: branchName,
        base: params.baseBranch,
        body: `Approved inside Mantis Phase 3.\n\n**Rationale:**\n${params.rationale}`,
      }),
    },
  );
  if (!prRes.ok) {
    throw new Error(`Branch ${branchName} created, but opening Pull Request failed (${prRes.status}).`);
  }
  const prData = (await prRes.json()) as {html_url?: string};
  return prData.html_url || `https://github.com/${params.owner}/${params.repo}/pulls`;
}
