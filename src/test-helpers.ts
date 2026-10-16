import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { gitBlobSha, type SkillFile } from './hash.ts';

import type { CommitInfo, TreeEntry } from './github.ts';
import type { TestContext } from 'node:test';

export const createProject = async (t: TestContext): Promise<string> => {
  const cwd = await mkdtemp(join(tmpdir(), 'scu-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  return cwd;
};

export const writeSkillFiles = async (cwd: string, folder: string, files: SkillFile[]): Promise<void> => {
  for (const file of files) {
    const path = join(cwd, folder, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content);
  }
};

export const file = (path: string, content: string): SkillFile => ({ path, content: Buffer.from(content) });

const toTree = (prefix: string, files: SkillFile[]): TreeEntry[] =>
  files.map((treeFile) => ({
    path: `${prefix}${treeFile.path}`,
    mode: '100644',
    type: 'blob',
    sha: gitBlobSha(treeFile.content),
  }));

export const fakeCommit = (index: number): CommitInfo => ({
  sha: `${index}`.repeat(40),
  date: `2026-10-${String(20 - index).padStart(2, '0')}T10:00:00Z`,
  message: `change ${index}`,
});

// Note: `history` lists folder versions newest first, so history[0] should equal `files`.
export const createRemote = (prefix: string, files: SkillFile[], history: SkillFile[][] = [files]) => {
  const downloads: string[] = [];
  const historyReads: string[] = [];
  const commits = history.map((_, index) => fakeCommit(index));
  const readRemoteFile = async (entry: TreeEntry): Promise<Buffer> => {
    const match = files.find((remoteFile) => `${prefix}${remoteFile.path}` === entry.path);
    if (!match) throw new Error(`no fake file at ${entry.path}`);
    downloads.push(entry.path);
    return match.content;
  };
  const filesAt = (commit: string) => history[commits.findIndex((candidate) => candidate.sha === commit)] ?? [];
  const folderTree = async (commit: string): Promise<TreeEntry[]> => {
    historyReads.push(commit);
    return toTree('', filesAt(commit));
  };
  const readFile = async (commit: string, entry: TreeEntry): Promise<Buffer> => {
    const match = filesAt(commit).find((historyFile) => `${prefix}${historyFile.path}` === entry.path);
    if (!match) throw new Error(`no fake file at ${entry.path} in ${commit}`);
    downloads.push(`${commit}:${entry.path}`);
    return match.content;
  };
  return {
    tree: toTree(prefix, files),
    readRemoteFile,
    history: { commits: async () => commits, folderTree, readFile },
    downloads,
    historyReads,
  };
};
