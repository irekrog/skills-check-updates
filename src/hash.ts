import { createHash } from 'node:crypto';

export type SkillFile = {
  path: string;
  content: Buffer;
};

// Note: mirrors computeSkillFolderHash from the `skills` CLI, which writes
// `computedHash` into skills-lock.json. Any drift here breaks every comparison.
export const folderHash = (files: SkillFile[]): string => {
  const hash = createHash('sha256');
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of sorted) {
    hash.update(file.path);
    hash.update(file.content);
  }
  return hash.digest('hex');
};

export const gitBlobSha = (content: Buffer): string =>
  createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
