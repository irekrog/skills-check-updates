import { mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

import { assertSafeSkillDirectories, isInside, SKILL_DIRS } from './install-paths.ts';
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

const realSkillDirs = async (cwd: string, name: string): Promise<string[]> => {
  const dirs = new Set<string>();
  for (const skillDir of SKILL_DIRS) {
    try {
      dirs.add(await realpath(join(cwd, skillDir, sanitizeName(name))));
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
  return [...dirs];
};

const writeInside = async (dir: string, path: string, content: Buffer): Promise<void> => {
  const target = join(dir, path);
  await mkdir(dirname(target), { recursive: true });
  // Why: a folder the installer copied could be a symlink - never write through it.
  if (!isInside(dir, await realpath(dirname(target)))) throw new Error(`unsafe skill file destination: ${target}`);
  await rm(target, { force: true });
  await writeFile(target, content);
};

export const replaceInstalledSkill = async (cwd: string, name: string, files: SkillFile[]): Promise<void> => {
  assertSkillName(name);
  assertSafeSkillDirectories(cwd, name);
  const paths = new Set(files.map((file) => file.path));
  for (const dir of await realSkillDirs(cwd, name)) {
    const stale = ((await readSkillDir(dir)) ?? []).filter((file) => !paths.has(file.path));
    for (const file of stale) await rm(join(dir, file.path), { force: true });
    for (const file of files) await writeInside(dir, file.path, file.content);
  }
};
