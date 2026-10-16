import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { mkdir, readdir, readFile, symlink } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { createProject, file, writeSkillFiles } from './test-helpers.ts';
import { installSkill, isUpgradeTarget, upgradeSkill } from './upgrade.ts';

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

describe('installSkill preflight', () => {
  it('should never spawn the installer for a flag or path-like skill name', async (t) => {
    const cwd = await createProject(t);
    const calls = recordInstaller(t);
    for (const name of ['--global', '-g', '../outside', 'demo\n']) {
      const result = installSkill(cwd, name, 'acme/skills/skills/demo');
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

      const result = installSkill(cwd, 'demo', 'acme/skills/skills/demo');

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

    assert.equal(installSkill(cwd, 'My Skill', 'trusted/reviewed/skills/demo').isSuccess, true);
    assert.deepEqual(calls[0]?.[1], ['--yes', 'skills@latest', 'add', 'trusted/reviewed/skills/demo', '--skill', 'My Skill', '-y']);
    await symlink(outside, join(cwd, '.claude'), 'junction');
    assert.equal(installSkill(cwd, 'My Skill', 'trusted/reviewed/skills/demo').isSuccess, false);
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

  it('should leave skills with only local changes alone unless forced', () => {
    assert.equal(isUpgradeTarget(report({ status: 'modified' }), false), false);
    assert.equal(isUpgradeTarget(report({ status: 'modified' }), true), true);
  });

  it('should try to update skills with both local and upstream changes', () => {
    assert.equal(isUpgradeTarget(report({ status: 'conflict' }), false), true);
  });

  it('should hold back updates younger than --min-age even when forced', () => {
    assert.equal(isUpgradeTarget(report({ status: 'outdated', heldUntil: '2026-10-27T10:00:00.000Z' }), false), false);
    assert.equal(isUpgradeTarget(report({ status: 'conflict', heldUntil: '2026-10-27T10:00:00.000Z' }), true), false);
  });

  it('should skip skills without an install source', () => {
    assert.equal(isUpgradeTarget(report({ status: 'outdated', installSource: null }), true), false);
  });
});

const readFolder = async (dir: string): Promise<Record<string, string>> => {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
  return Object.fromEntries(await Promise.all(files.map(async (path) => [path.slice(dir.length + 1), await readFile(path, 'utf8')])));
};

describe('upgradeSkill merge', () => {
  const merged = [file('SKILL.md', 'merged'), file('notes/new.md', 'new')];
  const conflict = (merge: SkillReport['merge']) => report({ status: 'conflict', merge });

  it('should keep the local copy without installing when changes overlap', async (t) => {
    const cwd = await createProject(t);
    const calls = recordInstaller(t);

    const result = await upgradeSkill(cwd, conflict({ status: 'conflict', paths: ['SKILL.md'] }), false);

    assert.equal(result.outcome, 'skipped');
    assert.match(result.output, /overlap in SKILL\.md/);
    assert.deepEqual(calls, []);
  });

  it('should keep the local copy when no base version was found', async (t) => {
    const cwd = await createProject(t);
    const calls = recordInstaller(t);

    const result = await upgradeSkill(cwd, conflict({ status: 'unavailable', reason: 'base not found' }), false);

    assert.equal(result.outcome, 'skipped');
    assert.match(result.output, /cannot merge: base not found/);
    assert.deepEqual(calls, []);
  });

  it('should install upstream and then write the merged files into every copy', async (t) => {
    const cwd = await createProject(t);
    await writeSkillFiles(cwd, '.agents/skills/demo', [file('SKILL.md', 'local'), file('stale.md', 'gone')]);
    await writeSkillFiles(cwd, '.claude/skills/demo', [file('SKILL.md', 'local')]);
    const calls = recordInstaller(t);

    const result = await upgradeSkill(cwd, conflict({ status: 'clean', files: merged }), false);

    assert.equal(result.outcome, 'merged');
    assert.equal(calls.length, 1);
    const expected = { 'SKILL.md': 'merged', [join('notes', 'new.md')]: 'new' };
    assert.deepEqual(await readFolder(join(cwd, '.agents/skills/demo')), expected);
    assert.deepEqual(await readFolder(join(cwd, '.claude/skills/demo')), expected);
  });

  it('should write through a skill symlink once', async (t) => {
    const cwd = await createProject(t);
    await writeSkillFiles(cwd, '.agents/skills/demo', [file('SKILL.md', 'local')]);
    await mkdir(join(cwd, '.claude/skills'), { recursive: true });
    await symlink('../../.agents/skills/demo', join(cwd, '.claude/skills/demo'), 'junction');
    recordInstaller(t);

    assert.equal((await upgradeSkill(cwd, conflict({ status: 'clean', files: merged }), false)).outcome, 'merged');
    assert.deepEqual(Object.keys(await readFolder(join(cwd, '.agents/skills/demo'))).sort(), ['SKILL.md', join('notes', 'new.md')]);
  });

  it('should never write merged files through a symlinked folder inside the skill', async (t) => {
    const fixture = await createProject(t);
    const cwd = join(fixture, 'project');
    const outside = join(fixture, 'outside');
    await writeSkillFiles(cwd, '.agents/skills/demo', [file('SKILL.md', 'local')]);
    await mkdir(outside);
    await symlink(outside, join(cwd, '.agents/skills/demo/notes'), 'junction');
    recordInstaller(t);

    const result = await upgradeSkill(cwd, conflict({ status: 'clean', files: merged }), false);

    assert.equal(result.outcome, 'failed');
    assert.match(result.output, /unsafe skill file destination/);
    assert.deepEqual(await readdir(outside), []);
  });

  it('should leave the files to the installer when forced', async (t) => {
    const cwd = await createProject(t);
    await writeSkillFiles(cwd, '.agents/skills/demo', [file('SKILL.md', 'local')]);
    const calls = recordInstaller(t);

    const result = await upgradeSkill(cwd, conflict({ status: 'conflict', paths: ['SKILL.md'] }), true);

    assert.equal(result.outcome, 'updated');
    assert.equal(calls.length, 1);
    assert.equal(await readFile(join(cwd, '.agents/skills/demo/SKILL.md'), 'utf8'), 'local');
  });

  it('should not touch the local copy when the installer fails', async (t) => {
    const cwd = await createProject(t);
    await writeSkillFiles(cwd, '.agents/skills/demo', [file('SKILL.md', 'local')]);
    t.mock.method(childProcess, 'spawnSync', () => ({ status: 1, stdout: '', stderr: 'offline' }));
    syncBuiltinESMExports();
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });

    const result = await upgradeSkill(cwd, conflict({ status: 'clean', files: merged }), false);

    assert.equal(result.outcome, 'failed');
    assert.equal(await readFile(join(cwd, '.agents/skills/demo/SKILL.md'), 'utf8'), 'local');
  });
});
