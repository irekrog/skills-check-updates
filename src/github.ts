import { execFileSync } from 'node:child_process';

import { gitBlobSha } from './hash.ts';

export type TreeEntry = {
  path: string;
  mode: string;
  type: string;
  sha: string;
};

export type CommitInfo = {
  sha: string;
  date: string;
  message: string;
};

export type GitHubClient = {
  fetchTree: (repo: string, ref: string) => Promise<TreeEntry[]>;
  fetchFolderTree: (repo: string, commit: string, folder: string) => Promise<TreeEntry[]>;
  fetchFile: (repo: string, ref: string, entry: TreeEntry) => Promise<Buffer>;
  fetchCommits: (repo: string, ref: string, path: string, limit: number) => Promise<CommitInfo[]>;
};

type ApiTree = {
  tree: TreeEntry[];
  truncated: boolean;
};

type ApiCommit = {
  sha: string;
  commit: {
    message: string;
    author: { date: string } | null;
    committer: { date: string } | null;
  };
};

const DEFAULT_REF = 'HEAD';

const API_URL = 'https://api.github.com';
const RAW_URL = 'https://raw.githubusercontent.com';
const GH_CLI_TIMEOUT_MS = 5000;

export const resolveGitHubToken = (): string | null => {
  const fromEnv = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    const token = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GH_CLI_TIMEOUT_MS,
    }).trim();
    return token || null;
  } catch {
    return null;
  }
};

const describeApiError = (response: Response, repo: string, hasToken: boolean): string => {
  if (response.status === 404) return `${repo}: repository or ref not found`;
  const isRateLimited =
    (response.status === 403 || response.status === 429) &&
    response.headers.get('x-ratelimit-remaining') === '0';
  if (isRateLimited) {
    return hasToken
      ? 'GitHub API rate limit exceeded'
      : 'GitHub API rate limit exceeded - set GITHUB_TOKEN or log in with `gh auth login`';
  }
  return `${repo}: GitHub API responded with HTTP ${response.status}`;
};

export const createGitHubClient = (token: string | null): GitHubClient => {
  const headers: Record<string, string> = { 'User-Agent': 'skills-check-updates' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const apiHeaders = { ...headers, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };

  const requestApi = (repo: string, path: string) => fetch(`${API_URL}/repos/${repo}/${path}`, { headers: apiHeaders });

  const fetchApi = async <T>(repo: string, path: string): Promise<T> => {
    const response = await requestApi(repo, path);
    if (!response.ok) throw new Error(describeApiError(response, repo, token !== null));
    return (await response.json()) as T;
  };

  const readTree = (repo: string, body: ApiTree): TreeEntry[] => {
    if (body.truncated) throw new Error(`${repo}: repository tree is too large for the GitHub API`);
    return body.tree;
  };

  return {
    fetchTree: async (repo, ref) => readTree(repo, await fetchApi<ApiTree>(repo, `git/trees/${ref}?recursive=1`)),
    fetchFolderTree: async (repo, commit, folder) => {
      const treeish = folder ? `${commit}:${folder.split('/').map(encodeURIComponent).join('/')}` : commit;
      const response = await requestApi(repo, `git/trees/${treeish}?recursive=1`);
      if (response.status === 404) return [];
      if (!response.ok) throw new Error(describeApiError(response, repo, token !== null));
      return readTree(repo, (await response.json()) as ApiTree);
    },
    fetchCommits: async (repo, ref, path, limit) => {
      const params = new URLSearchParams({ per_page: String(limit) });
      if (ref !== DEFAULT_REF) params.set('sha', ref);
      if (path) params.set('path', path);
      const commits = await fetchApi<ApiCommit[]>(repo, `commits?${params}`);
      return commits.map(({ sha, commit }) => ({
        sha,
        date: commit.committer?.date ?? commit.author?.date ?? '',
        message: commit.message.split('\n')[0] ?? '',
      }));
    },
    fetchFile: async (repo, ref, entry) => {
      const path = entry.path.split('/').map(encodeURIComponent).join('/');
      const response = await fetch(`${RAW_URL}/${repo}/${ref}/${path}`, { headers });
      if (!response.ok) throw new Error(`${repo}: failed to download ${entry.path} (HTTP ${response.status})`);
      const content = Buffer.from(await response.arrayBuffer());
      // Why: the tree and the raw file are two requests against a moving ref - a push
      // in between would mix two versions, so trust the content only if its sha matches.
      if (gitBlobSha(content) !== entry.sha) throw new Error(`${repo}: changed during the check, run it again`);
      return content;
    },
  };
};
