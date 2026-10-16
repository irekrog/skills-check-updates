import { posix } from 'node:path';

import { findSkillPath } from './find-skill-path.ts';
import { readFrontmatterVersion } from './frontmatter.ts';
import { folderHash, gitBlobSha, type SkillFile } from './hash.ts';
import { mergeSkillFiles, type MergePlan } from './merge.ts';
import {
  diffFiles,
  isHashedByCli,
  isInstalledByCli,
  listHashedFiles,
  toSignature,
  treeSignatures,
  type FileChange,
  type FileSha,
} from './skill-files.ts';
import { buildCompareUrl, buildInstallSource, buildRepoUrl, getSkillFolder } from './source.ts';

import type { CommitInfo, TreeEntry } from './github.ts';
import type { LockEntry } from './lock.ts';

export type SkillStatus =
  | 'up-to-date'
  | 'outdated'
  | 'modified'
  | 'conflict'
  | 'not-installed'
  | 'not-found'
  | 'unsupported'
  | 'error';

type SkillVersion = {
  hash: string;
  commit: CommitInfo | null;
  version: string | null;
};

export type SkillDetails = {
  installed: SkillVersion;
  latest: SkillVersion;
  commitsBehind: number | null;
  changedFiles: FileChange[];
  compareUrl: string | null;
};

export type SkillReport = {
  name: string;
  status: SkillStatus;
  installSource: string | null;
  url: string | null;
  hasStalePath: boolean;
  message?: string;
  details?: SkillDetails;
  removedIn?: CommitInfo;
  heldUntil?: string;
  merge?: MergePlan;
};

type History = {
  commits: (folder: string) => Promise<CommitInfo[]>;
  folderTree: (commit: string, folder: string) => Promise<TreeEntry[]>;
  readFile: (commit: string, entry: TreeEntry) => Promise<Buffer>;
};

type CheckSkillInput = {
  name: string;
  repo: string;
  entry: LockEntry;
  localFiles: SkillFile[] | null;
  tree: TreeEntry[];
  readRemoteFile: (entry: TreeEntry) => Promise<Buffer>;
  history: History;
  withDetails: boolean;
  withMerge?: boolean;
  minAge?: number;
  now?: number;
};

const HOLDABLE: SkillStatus[] = ['outdated', 'conflict'];

const resolveStatus = (matchesUpstream: boolean, isLocalClean: boolean, isUpstreamChanged: boolean): SkillStatus => {
  if (matchesUpstream) return 'up-to-date';
  if (!isLocalClean) return isUpstreamChanged ? 'conflict' : 'modified';
  return isUpstreamChanged ? 'outdated' : 'up-to-date';
};

const resolveSkillPath = async ({ name, entry, tree, readRemoteFile }: CheckSkillInput): Promise<string | null> => {
  const isLockedPathPresent = tree.some((treeEntry) => treeEntry.type === 'blob' && treeEntry.path === entry.skillPath);
  if (entry.skillPath && isLockedPathPresent) return entry.skillPath;
  return findSkillPath(name, tree, readRemoteFile);
};

const planMerge = (base: SkillFile[], local: SkillFile[], upstream: SkillFile[]): MergePlan => {
  const installed = (files: SkillFile[]) => files.filter((file) => isInstalledByCli(file.path));
  try {
    return mergeSkillFiles(installed(base), local, installed(upstream));
  } catch (error) {
    return { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
  }
};

const readVersion = (files: SkillFile[], skillFileName: string): string | null => {
  const skillFile = files.find((file) => file.path === skillFileName);
  return skillFile ? readFrontmatterVersion(skillFile.content.toString('utf8')) : null;
};

type BaseLookup = {
  commits: CommitInfo[];
  prefix: string;
  computedHash: string;
  folderTreeAt: (commit: string) => Promise<TreeEntry[]>;
  readFile: History['readFile'];
  knownContent: Map<string, Buffer>;
};

// Why: the lock hash is the upstream folder as it was installed, so the commit that
// reproduces it is the common base of the local edits and the upstream changes.
const findBaseFiles = async ({ commits, prefix, computedHash, folderTreeAt, readFile, knownContent }: BaseLookup) => {
  for (const commit of commits.slice(1)) {
    const entries = (await folderTreeAt(commit.sha)).filter((treeEntry) => isHashedByCli(treeEntry, ''));
    const files = await Promise.all(
      entries.map(async (treeEntry) => {
        const content = knownContent.get(treeEntry.sha) ?? (await readFile(commit.sha, { ...treeEntry, path: `${prefix}${treeEntry.path}` }));
        knownContent.set(treeEntry.sha, content);
        return { path: treeEntry.path, content };
      }),
    );
    if (folderHash(files) === computedHash) return files;
  }
  return null;
};

export const checkSkill = async (input: CheckSkillInput): Promise<SkillReport> => {
  const { name, repo, entry, localFiles, tree, readRemoteFile, history, withDetails, withMerge = false, minAge = 0, now = Date.now() } = input;
  const skillPath = await resolveSkillPath(input);
  if (!skillPath) {
    const url = buildRepoUrl(repo, entry.ref);
    const report: SkillReport = { name, status: 'not-found', installSource: null, url, hasStalePath: !entry.skillPath };
    if (!withDetails || !entry.skillPath) return report;
    // Why: the last commit touching a folder that no longer exists is the one that removed it.
    const [removedIn] = await history.commits(getSkillFolder(entry.skillPath));
    return removedIn ? { ...report, removedIn } : report;
  }

  const folder = getSkillFolder(skillPath);
  const prefix = folder ? `${folder}/` : '';
  const hasStalePath = skillPath !== entry.skillPath;
  const installSource = buildInstallSource(repo, skillPath, entry.ref);
  const url = buildRepoUrl(repo, entry.ref, folder);
  if (!localFiles) return { name, status: 'not-installed', installSource, url, hasStalePath };

  const upstreamFiles = listHashedFiles(tree, prefix);
  const localContentBySha = new Map(localFiles.map((file) => [gitBlobSha(file.content), file.content]));
  // Why: a file with the same blob sha is byte-identical to the local copy, so only
  // files that differ need a download.
  const remoteFiles = await Promise.all(
    tree
      .filter((treeEntry) => isHashedByCli(treeEntry, prefix))
      .map(async (treeEntry) => ({
        path: treeEntry.path.slice(prefix.length),
        content: localContentBySha.get(treeEntry.sha) ?? (await readRemoteFile(treeEntry)),
      })),
  );

  const localShas = localFiles.map((file) => ({ path: file.path, sha: gitBlobSha(file.content) }));
  const localSignature = toSignature(localShas);
  const matchesFiles = (files: FileSha[]) => treeSignatures(files).includes(localSignature);
  const matchesUpstream = matchesFiles(upstreamFiles);
  const upstreamHash = folderHash(remoteFiles);
  const isUpstreamChanged = upstreamHash !== entry.computedHash;
  const skippedRemoteFiles = remoteFiles.filter((file) => !isInstalledByCli(file.path));
  // Why: the lock hash covers files the installer skips (metadata.json), so local
  // files alone never reproduce it for such skills - add the upstream copies back.
  const isLockClean =
    folderHash(localFiles) === entry.computedHash ||
    folderHash([...localFiles, ...skippedRemoteFiles]) === entry.computedHash;

  const folderTrees = new Map<string, Promise<TreeEntry[]>>();
  const folderTreeAt = (commit: string): Promise<TreeEntry[]> => {
    const cached = folderTrees.get(commit) ?? history.folderTree(commit, folder);
    folderTrees.set(commit, cached);
    return cached;
  };

  const findInstalledIndex = async (commits: CommitInfo[]): Promise<number | null> => {
    // Why: the newest commit touching the folder holds the current upstream content.
    if (matchesUpstream) return commits.length > 0 ? 0 : null;
    for (const [index, commit] of commits.entries()) {
      if (index > 0 && matchesFiles(listHashedFiles(await folderTreeAt(commit.sha), ''))) return index;
    }
    return null;
  };
  // Why: older CLI versions wrote hashes that no longer reproduce, so a lock mismatch
  // alone is not proof of local edits - an unedited copy matches some upstream commit.
  const needsInstalledIndex = withDetails || (!matchesUpstream && !isLockClean);
  const needsCommits = needsInstalledIndex || (minAge > 0 && !matchesUpstream);
  const commits = needsCommits ? await history.commits(folder) : [];
  const installedIndex = needsInstalledIndex ? await findInstalledIndex(commits) : null;
  const isLocalClean = matchesUpstream || isLockClean || installedIndex !== null;

  const status = resolveStatus(matchesUpstream, isLocalClean, isUpstreamChanged);
  const latestCommit = commits[0] ?? null;
  const releaseAt = latestCommit ? Date.parse(latestCommit.date) + minAge : Number.NaN;
  const isHeld = minAge > 0 && HOLDABLE.includes(status) && releaseAt > now;
  const report: SkillReport = { name, status, installSource, url, hasStalePath };
  if (isHeld) report.heldUntil = new Date(releaseAt).toISOString();
  if (withMerge && status === 'conflict' && !isHeld) {
    const knownContent = new Map([...localFiles, ...remoteFiles].map((file) => [gitBlobSha(file.content), file.content]));
    const { computedHash } = entry;
    const base = await findBaseFiles({ commits, prefix, computedHash, folderTreeAt, readFile: history.readFile, knownContent });
    report.merge = base
      ? planMerge(base, localFiles, remoteFiles)
      : { status: 'unavailable', reason: `installed version not found in the last ${commits.length} upstream commits` };
  }
  if (!withDetails) return report;

  const skillFileName = posix.basename(skillPath);
  const installedCommit = installedIndex === null ? null : (commits[installedIndex] ?? null);
  const hasNewerCommit = installedCommit !== null && latestCommit !== null && installedCommit.sha !== latestCommit.sha;
  const details: SkillDetails = {
    installed: { hash: entry.computedHash, commit: installedCommit, version: readVersion(localFiles, skillFileName) },
    latest: { hash: upstreamHash, commit: latestCommit, version: readVersion(remoteFiles, skillFileName) },
    commitsBehind: installedIndex,
    changedFiles: diffFiles(localShas, upstreamFiles),
    compareUrl: hasNewerCommit ? buildCompareUrl(repo, installedCommit.sha, latestCommit.sha) : null,
  };
  return { ...report, details };
};
