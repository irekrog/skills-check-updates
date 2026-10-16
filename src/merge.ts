import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SkillFile } from './hash.ts';

export type MergePlan =
  | { status: 'clean'; files: SkillFile[] }
  | { status: 'conflict'; paths: string[] }
  | { status: 'unavailable'; reason: string };

// Returns the merged content, or null when the two sides change the same lines.
type TextMerge = (local: Buffer, base: Buffer, upstream: Buffer) => Buffer | null;

const MAX_MERGE_OUTPUT_BYTES = 64 * 1024 * 1024;

export const gitMergeFile: TextMerge = (local, base, upstream) => {
  const dir = mkdtempSync(join(tmpdir(), 'scu-merge-'));
  try {
    const localPath = join(dir, 'local');
    const basePath = join(dir, 'base');
    const upstreamPath = join(dir, 'upstream');
    writeFileSync(localPath, local);
    writeFileSync(basePath, base);
    writeFileSync(upstreamPath, upstream);
    const result = spawnSync('git', ['merge-file', '-p', '-q', localPath, basePath, upstreamPath], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: MAX_MERGE_OUTPUT_BYTES,
    });
    if (result.error) throw new Error(`could not run git merge-file: ${result.error.message}`);
    // Note: a positive status counts conflicting hunks, a negative one (binary files) is an error.
    return result.status === 0 ? result.stdout : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const isSame = (a: Buffer | undefined, b: Buffer | undefined): boolean =>
  a === undefined || b === undefined ? a === b : a.equals(b);

// Returns the merged content, null for a file that ends up deleted, or 'conflict'.
const mergeFile = (
  base: Buffer | undefined,
  local: Buffer | undefined,
  upstream: Buffer | undefined,
  mergeText: TextMerge,
): Buffer | null | 'conflict' => {
  if (isSame(local, base)) return upstream ?? null;
  if (isSame(upstream, base) || isSame(local, upstream)) return local ?? null;
  if (!base || !local || !upstream) return 'conflict';
  return mergeText(local, base, upstream) ?? 'conflict';
};

export const mergeSkillFiles = (
  base: SkillFile[],
  local: SkillFile[],
  upstream: SkillFile[],
  mergeText: TextMerge = gitMergeFile,
): MergePlan => {
  const byPath = (files: SkillFile[]) => new Map(files.map((file) => [file.path, file.content]));
  const [baseByPath, localByPath, upstreamByPath] = [byPath(base), byPath(local), byPath(upstream)];
  const paths = [...new Set([...baseByPath.keys(), ...localByPath.keys(), ...upstreamByPath.keys()])].sort();
  const files: SkillFile[] = [];
  const conflicts: string[] = [];

  for (const path of paths) {
    const merged = mergeFile(baseByPath.get(path), localByPath.get(path), upstreamByPath.get(path), mergeText);
    if (merged === 'conflict') conflicts.push(path);
    else if (merged) files.push({ path, content: merged });
  }
  return conflicts.length > 0 ? { status: 'conflict', paths: conflicts } : { status: 'clean', files };
};
