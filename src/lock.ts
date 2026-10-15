import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type LockEntry = {
  source: string;
  sourceType: string;
  sourceUrl?: string;
  ref?: string;
  skillPath?: string;
  computedHash: string;
};

export type SkillsLock = {
  version: number;
  skills: Record<string, LockEntry>;
};

export const LOCK_FILE = 'skills-lock.json';

const isSkillsLock = (value: unknown): value is SkillsLock =>
  typeof value === 'object' &&
  value !== null &&
  'skills' in value &&
  typeof value.skills === 'object' &&
  value.skills !== null;

export const readLock = async (cwd: string): Promise<SkillsLock> => {
  const parsed: unknown = JSON.parse(await readFile(join(cwd, LOCK_FILE), 'utf8'));
  if (!isSkillsLock(parsed)) {
    throw new Error(`${LOCK_FILE} has no "skills" map`);
  }
  return parsed;
};
