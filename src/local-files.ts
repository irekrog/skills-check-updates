import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { assertSafeSkillDirectories, SKILL_DIRS } from './install-paths.ts';
import { assertSkillName, sanitizeName } from './skill-name.ts';

import type { SkillFile } from './hash.ts';

const SKIPPED_DIRS = new Set(['.git', 'node_modules']);

const isNotFound = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

const collectFiles = async (baseDir: string, dir: string, files: SkillFile[]): Promise<void> => {
  const entries = await readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) await collectFiles(baseDir, fullPath, files);
        return;
      }
      if (entry.isFile()) {
        const path = relative(baseDir, fullPath).split(sep).join('/');
        files.push({ path, content: await readFile(fullPath) });
      }
    }),
  );
};

const readSkillDir = async (dir: string): Promise<SkillFile[] | null> => {
  const files: SkillFile[] = [];
  try {
    await collectFiles(dir, dir, files);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  return files;
};

export const readInstalledSkill = async (cwd: string, name: string): Promise<SkillFile[] | null> => {
  assertSkillName(name);
  assertSafeSkillDirectories(cwd, name);
  for (const skillDir of SKILL_DIRS) {
    const files = await readSkillDir(join(cwd, skillDir, sanitizeName(name)));
    if (files) return files;
  }
  return null;
};
