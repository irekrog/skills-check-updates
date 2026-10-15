import { spawnSync } from 'node:child_process';

import { assertSafeSkillDirectories } from './install-paths.ts';
import { assertSkillName } from './skill-name.ts';

import type { SkillReport, SkillStatus } from './check-skill.ts';

type UpgradeResult = {
  isSuccess: boolean;
  output: string;
};

const UPGRADABLE: SkillStatus[] = ['outdated', 'not-installed'];
const UPGRADABLE_WITH_FORCE: SkillStatus[] = ['modified', 'conflict'];

export const isUpgradeTarget = (report: SkillReport, isForced: boolean): boolean => {
  if (report.installSource === null || report.heldUntil) return false;
  if (UPGRADABLE.includes(report.status)) return true;
  // Why: a reinstall with an explicit folder makes `skills add` record the skillPath,
  // after which the official `skills update` can track the skill again.
  if (report.status === 'up-to-date') return report.hasStalePath;
  return isForced && UPGRADABLE_WITH_FORCE.includes(report.status);
};

export const upgradeSkill = (cwd: string, name: string, installSource: string): UpgradeResult => {
  try {
    assertSkillName(name);
    assertSafeSkillDirectories(cwd, name);
  } catch (error) {
    return { isSuccess: false, output: error instanceof Error ? error.message : String(error) };
  }
  const result = spawnSync('npx', ['--yes', 'skills@latest', 'add', installSource, '--skill', name, '-y'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { isSuccess: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
};
