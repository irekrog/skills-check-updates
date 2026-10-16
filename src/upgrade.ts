import { spawnSync } from 'node:child_process';

import { assertSafeSkillDirectories } from './install-paths.ts';
import { replaceInstalledSkill } from './local-files.ts';
import { assertSkillName } from './skill-name.ts';

import type { SkillReport, SkillStatus } from './check-skill.ts';
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

export const upgradeSkill = async (cwd: string, report: SkillReport, isForced: boolean): Promise<UpgradeResult> => {
  const { name, installSource } = report;
  const needsMerge = report.status === 'conflict' && !isForced;
  const merge: MergePlan | null = needsMerge ? (report.merge ?? { status: 'unavailable', reason: 'no merge was planned' }) : null;
  if (merge && merge.status !== 'clean') return { outcome: 'skipped', output: describeBlockedMerge(merge) };
  if (installSource === null) return { outcome: 'failed', output: 'no install source' };

  const { isSuccess, output } = installSkill(cwd, name, installSource);
  if (!isSuccess) return { outcome: 'failed', output };
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
