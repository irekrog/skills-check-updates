import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { mkdir, symlink } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { createProject } from './test-helpers.ts';
import { isUpgradeTarget, upgradeSkill } from './upgrade.ts';

import type { SkillReport } from './check-skill.ts';
import type { TestContext } from 'node:test';

const recordInstaller = (t: TestContext) => {
  const calls: unknown[][] = [];
  t.mock.method(childProcess, 'spawnSync', (...args: unknown[]) => {
    calls.push(args);
    return { status: 0, stdout: '', stderr: '' };
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return calls;
};

const report = (overrides: Partial<SkillReport>): SkillReport => ({
  name: 'demo',
  status: 'up-to-date',
  installSource: 'acme/skills/skills/demo',
  url: 'https://github.com/acme/skills/tree/HEAD/skills/demo',
  hasStalePath: false,
  ...overrides,
});

describe('upgradeSkill preflight', () => {
  it('should never spawn the installer for a flag or path-like skill name', async (t) => {
    const cwd = await createProject(t);
    const calls = recordInstaller(t);
    for (const name of ['--global', '-g', '../outside', 'demo\n']) {
      const result = upgradeSkill(cwd, name, 'acme/skills/skills/demo');
      assert.equal(result.isSuccess, false);
      assert.match(result.output, /invalid skill name/);
    }
    assert.deepEqual(calls, []);
  });

  for (const target of ['.agents', '.agents/skills', '.claude', '.claude/skills']) {
    it(`should never spawn the installer through a ${target} symlink`, async (t) => {
      const fixture = await createProject(t);
      const cwd = join(fixture, 'project');
      const outside = join(fixture, 'outside');
      await mkdir(cwd);
      await mkdir(outside);
      const link = join(cwd, target);
      await mkdir(dirname(link), { recursive: true });
      await symlink(outside, link, 'junction');
      const calls = recordInstaller(t);

      const result = upgradeSkill(cwd, 'demo', 'acme/skills/skills/demo');

      assert.equal(result.isSuccess, false);
      assert.match(result.output, /unsafe skill destination/);
      assert.deepEqual(calls, []);
    });
  }

  it('should revalidate destinations for every install and preserve the original name in argv', async (t) => {
    const fixture = await createProject(t);
    const cwd = join(fixture, 'project');
    const outside = join(fixture, 'outside');
    await mkdir(cwd);
    await mkdir(outside);
    const calls = recordInstaller(t);

    assert.equal(upgradeSkill(cwd, 'My Skill', 'trusted/reviewed/skills/demo').isSuccess, true);
    assert.deepEqual(calls[0]?.[1], ['--yes', 'skills@latest', 'add', 'trusted/reviewed/skills/demo', '--skill', 'My Skill', '-y']);
    await symlink(outside, join(cwd, '.claude'), 'junction');
    assert.equal(upgradeSkill(cwd, 'My Skill', 'trusted/reviewed/skills/demo').isSuccess, false);
    assert.equal(calls.length, 1);
  });
});

describe('isUpgradeTarget', () => {
  it('should upgrade outdated and missing skills', () => {
    assert.equal(isUpgradeTarget(report({ status: 'outdated' }), false), true);
    assert.equal(isUpgradeTarget(report({ status: 'not-installed' }), false), true);
  });

  it('should skip up-to-date skills that already have a skillPath', () => {
    assert.equal(isUpgradeTarget(report({}), false), false);
  });

  it('should reinstall up-to-date skills to record a missing skillPath', () => {
    assert.equal(isUpgradeTarget(report({ hasStalePath: true }), false), true);
  });

  it('should keep local changes unless forced', () => {
    assert.equal(isUpgradeTarget(report({ status: 'conflict' }), false), false);
    assert.equal(isUpgradeTarget(report({ status: 'modified' }), false), false);
    assert.equal(isUpgradeTarget(report({ status: 'conflict' }), true), true);
  });

  it('should hold back updates younger than --min-age even when forced', () => {
    assert.equal(isUpgradeTarget(report({ status: 'outdated', heldUntil: '2026-10-27T10:00:00.000Z' }), false), false);
    assert.equal(isUpgradeTarget(report({ status: 'conflict', heldUntil: '2026-10-27T10:00:00.000Z' }), true), false);
  });

  it('should skip skills without an install source', () => {
    assert.equal(isUpgradeTarget(report({ status: 'outdated', installSource: null }), true), false);
  });
});
