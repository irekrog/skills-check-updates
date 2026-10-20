import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { assertSafeSkillDirectories } from './install-paths.ts';
import { readInstalledSkill, replaceInstalledSkill } from './local-files.ts';
import { LOCK_FILE, readLock } from './lock.ts';
import { assertSkillName } from './skill-name.ts';

import type { SkillReport, SkillStatus } from './check-skill.ts';
import type { SkillFile } from './hash.ts';
import type { MergePlan } from './merge.ts';

type InstallResult = {
  isSuccess: boolean;
  output: string;
};

export type UpgradeOutcome = 'updated' | 'merged' | 'skipped' | 'failed';

type UpgradeResult = {
  outcome: UpgradeOutcome;
  output: string;
};

type BlockedMerge = Exclude<MergePlan, { status: 'clean' }>;

// Why: scu mirrors this version's folder hash, name normalization and lock format
// (hash.ts, skill-name.ts) - bump it only after checking that they still match.
const SKILLS_CLI = 'skills@1.7.2';

const UPGRADABLE: SkillStatus[] = ['outdated', 'not-installed', 'conflict'];
const UPGRADABLE_WITH_FORCE: SkillStatus[] = ['modified'];

export const isUpgradeTarget = (report: SkillReport, isForced: boolean): boolean => {
  if (report.installSource === null || report.heldUntil) return false;
  if (UPGRADABLE.includes(report.status)) return true;
  // Why: a reinstall with an explicit folder makes `skills add` record the skillPath,
  // after which the official `skills update` can track the skill again.
  if (report.status === 'up-to-date') return report.hasStalePath;
  return isForced && UPGRADABLE_WITH_FORCE.includes(report.status);
};

export const installSkill = (cwd: string, name: string, installSource: string): InstallResult => {
  try {
    assertSkillName(name);
    assertSafeSkillDirectories(cwd, name);
  } catch (error) {
    return { isSuccess: false, output: error instanceof Error ? error.message : String(error) };
  }
  const result = spawnSync('npx', ['--yes', SKILLS_CLI, 'add', installSource, '--skill', name, '-y'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { isSuccess: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
};

const describeBlockedMerge = (merge: BlockedMerge): string => {
  const cause = merge.status === 'conflict' ? `local and upstream changes overlap in ${merge.paths.join(', ')}` : `cannot merge: ${merge.reason}`;
  return `${cause} - local changes kept, use --force to overwrite them`;
};

const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

type PreviousVersion = {
  lock: Buffer;
  files: SkillFile[];
};

const readPreviousVersion = async (cwd: string, name: string): Promise<PreviousVersion | null> => {
  const files = await readInstalledSkill(cwd, name);
  return files ? { lock: await readFile(join(cwd, LOCK_FILE)), files } : null;
};

const readInstalledHash = async (cwd: string, name: string): Promise<string | null> => {
  try {
    return (await readLock(cwd)).skills[name]?.computedHash ?? null;
  } catch {
    return null;
  }
};

const restorePreviousVersion = async (cwd: string, name: string, previous: PreviousVersion): Promise<UpgradeResult> => {
  try {
    await replaceInstalledSkill(cwd, name, previous.files);
    await writeFile(join(cwd, LOCK_FILE), previous.lock);
  } catch (error) {
    return { outcome: 'failed', output: `upstream changed after the check, and the previous version could not be restored: ${toError(error).message}` };
  }
  return { outcome: 'skipped', output: 'upstream changed after the check - previous version restored, run scu again' };
};

export const upgradeSkill = async (cwd: string, report: SkillReport, isForced: boolean): Promise<UpgradeResult> => {
  const { name, installSource, latestHash } = report;
  const needsMerge = report.status === 'conflict' && !isForced;
  const merge: MergePlan | null = needsMerge ? (report.merge ?? { status: 'unavailable', reason: 'no merge was planned' }) : null;
  if (merge && merge.status !== 'clean') return { outcome: 'skipped', output: describeBlockedMerge(merge) };
  if (installSource === null) return { outcome: 'failed', output: 'no install source' };

  const previous = latestHash ? await readPreviousVersion(cwd, name).catch((error: unknown) => toError(error)) : null;
  if (previous instanceof Error) return { outcome: 'failed', output: previous.message };
  const { isSuccess, output } = installSkill(cwd, name, installSource);
  if (!isSuccess) return { outcome: 'failed', output };
  // Why: the installer downloads the source again, so a push after the check would
  // install a version scu never saw - one --min-age did not hold back or a merge did not plan for.
  if (previous && (await readInstalledHash(cwd, name)) !== latestHash) return restorePreviousVersion(cwd, name, previous);
  if (!merge) return { outcome: 'updated', output };
  try {
    // Why: the installer records the new upstream version in the lock, which becomes
    // the base of the next merge; the merged files then replace its fresh copy.
    await replaceInstalledSkill(cwd, name, merge.files);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { outcome: 'failed', output: `installed the upstream version, but could not restore local changes: ${message}` };
  }
  return { outcome: 'merged', output };
};
