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
