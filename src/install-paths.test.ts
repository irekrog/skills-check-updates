import assert from 'node:assert/strict';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { checkSkills } from './check.ts';
import { assertSafeSkillDirectories } from './install-paths.ts';
import { createProject, writeSkillFiles, file } from './test-helpers.ts';
import { isUpgradeTarget } from './upgrade.ts';

import type { GitHubClient } from './github.ts';

const noNetwork: GitHubClient = {
  fetchTree: async () => [], fetchFile: async () => Buffer.alloc(0),
  fetchCommits: async () => [], fetchFolderTree: async () => [],
};

describe('skill destination containment', () => {
  for (const target of ['.agents', '.agents/skills', '.claude', '.claude/skills']) {
    it(`should reject a committed ${target} symlink before using either skill copy`, async (t) => {
      const fixture = await createProject(t);
      const cwd = join(fixture, 'project');
      const outside = join(fixture, 'project-neighbor');
      await mkdir(cwd);
      await mkdir(outside);
      await writeFile(join(outside, 'marker'), 'keep');
      const link = join(cwd, target);
      await mkdir(dirname(link), { recursive: true });
      await symlink(outside, link, 'junction');
      if (target.startsWith('.claude')) {
        await writeSkillFiles(cwd, '.agents/skills/demo', [file('SKILL.md', 'local')]);
      }

      const [report] = await checkSkills({
        cwd, names: ['demo'], client: noNetwork,
        lock: { version: 1, skills: { demo: { source: 'acme/skills', sourceType: 'github', computedHash: 'x' } } },
      });

      assert.ok(report);
      assert.equal(report.status, 'error');
      assert.match(report.message ?? '', /unsafe skill destination/);
      assert.equal(report.installSource, null);
      assert.equal(isUpgradeTarget(report, true), false);
      assert.equal(await readFile(join(outside, 'marker'), 'utf8'), 'keep');
    });
  }

  it('should accept missing destinations and normal internal skill symlinks', async (t) => {
    const cwd = await createProject(t);
    assert.doesNotThrow(() => assertSafeSkillDirectories(cwd, 'My Skill'));
    await writeSkillFiles(cwd, '.agents/skills/my-skill', [file('SKILL.md', 'local')]);
    await mkdir(join(cwd, '.claude/skills'), { recursive: true });
    await symlink(join(cwd, '.agents/skills/my-skill'), join(cwd, '.claude/skills/my-skill'), 'junction');
    assert.doesNotThrow(() => assertSafeSkillDirectories(cwd, 'My Skill'));
  });

  it('should reject dangling root symlinks and roots that are files', async (t) => {
    const cwd = await createProject(t);
    await symlink(join(cwd, 'missing'), join(cwd, '.agents'), 'junction');
    assert.throws(() => assertSafeSkillDirectories(cwd, 'demo'), /unsafe skill destination/);
    const other = await createProject(t);
    await writeFile(join(other, '.claude'), 'file');
    assert.throws(() => assertSafeSkillDirectories(other, 'demo'), /unsafe skill destination/);
  });

  it('should reject skill symlinks that resolve outside the project', async (t) => {
    const fixture = await createProject(t);
    const cwd = join(fixture, 'project');
    const outside = join(fixture, 'project-neighbor');
    await mkdir(join(cwd, '.agents/skills'), { recursive: true });
    await mkdir(outside);
    await symlink(outside, join(cwd, '.agents/skills/demo'), 'junction');
    assert.throws(() => assertSafeSkillDirectories(cwd, 'demo'), /unsafe skill destination/);
  });
});
