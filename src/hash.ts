import { createHash } from 'node:crypto';

import { isInstalledByCli } from './skill-files.ts';

export type SkillFile = {
  path: string;
  content: Buffer;
};

// Note: mirrors computeSkillFolderHash from `skills` 1.7 (computeLegacySkillFolderHash
// since 1.8), which writes `computedHash` into version 1 locks. Any drift here breaks
// every comparison.
export const folderHash = (files: SkillFile[]): string => {
  const hash = createHash('sha256');
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of sorted) {
    hash.update(file.path);
    hash.update(file.content);
  }
  return hash.digest('hex');
};

const normalizeLineEndings = (content: Buffer): Buffer =>
  content.includes(0) || !content.includes('\r\n')
    ? content
    : Buffer.from(content.toString('latin1').replaceAll('\r\n', '\n'), 'latin1');

// Note: mirrors computeSkillFolderHash from `skills` 1.8, which writes version 2 locks.
// It hashes only the files the installer copies, so the source folder and the
// installed copy hash alike. Unlike scu, it would also follow symlinks and include
// node_modules; skills shipping either do not reproduce this hash.
export const folderHashV2 = (files: SkillFile[]): string => {
  const entries = files
    .filter((file) => isInstalledByCli(file.path))
    .map((file) => ({ path: Buffer.from(file.path, 'utf8'), content: normalizeLineEndings(file.content) }))
    .sort((a, b) => Buffer.compare(a.path, b.path));
  const hash = createHash('sha256');
  for (const { path, content } of entries) {
    hash.update(path);
    hash.update('\0');
    hash.update(String(content.length));
    hash.update('\0');
    hash.update(content);
  }
  return hash.digest('hex');
};

// Why: a version 2 lock can hold either hash - skills 1.8 rehashes only the entries whose
// copy was unedited when it migrates a version 1 lock, and `skills` 1.7 keeps a version 2
// lock's version while writing legacy hashes into it, as scu --upgrade did with 1.7.2.
export const isLockHashOf = (computedHash: string, files: SkillFile[]): boolean =>
  folderHash(files) === computedHash || folderHashV2(files) === computedHash;

// Note: the hash the installer for this lock version records for the same files.
export const lockHash = (lockVersion: number | undefined, files: SkillFile[]): string =>
  (lockVersion ?? 1) >= 2 ? folderHashV2(files) : folderHash(files);

export const gitBlobSha = (content: Buffer): string =>
  createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
