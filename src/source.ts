import { posix } from 'node:path';

import type { LockEntry } from './lock.ts';

const GITHUB_ORIGIN = 'https://github.com';
const DEFAULT_BRANCH = 'HEAD';
const COMPARE_SHA_LENGTH = 12;
const SHORTHAND = /^[\w.-]+\/[\w.-]+$/;
const GITHUB_URL = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/;

export const getGitHubRepo = (entry: LockEntry): string | null => {
  if (entry.sourceType !== 'github') return null;
  const fromUrl = entry.sourceUrl?.match(GITHUB_URL)?.[1];
  if (fromUrl) return fromUrl;
  return SHORTHAND.test(entry.source) ? entry.source : null;
};

export const getSkillFolder = (skillPath: string): string => {
  const folder = posix.dirname(skillPath);
  return folder === '.' ? '' : folder;
};

export const buildRepoUrl = (repo: string, ref?: string, folder = ''): string => {
  if (!ref && !folder) return `${GITHUB_ORIGIN}/${repo}`;
  const treePath = folder ? `${ref ?? DEFAULT_BRANCH}/${folder}` : ref;
  return `${GITHUB_ORIGIN}/${repo}/tree/${treePath}`;
};

export const buildCompareUrl = (repo: string, from: string, to: string): string =>
  `${GITHUB_ORIGIN}/${repo}/compare/${from.slice(0, COMPARE_SHA_LENGTH)}...${to.slice(0, COMPARE_SHA_LENGTH)}`;

export const buildInstallSource = (repo: string, skillPath: string, ref?: string): string => {
  const folder = getSkillFolder(skillPath);
  // The installer interprets these characters as source syntax, not literal folder names.
  if (/[#@:\\\x00-\x1f\x7f-\x9f]/.test(folder)) {
    throw new Error('unsupported skill folder: contains installer syntax or control characters');
  }
  const source = folder ? `${repo}/${folder}` : repo;
  return ref ? `${source}#${ref}` : source;
};
