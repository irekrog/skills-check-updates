import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkSkills } from './check.ts';
import { folderHash } from './hash.ts';
import { createProject, createRemote, file, writeSkillFiles } from './test-helpers.ts';
import { isUpgradeTarget } from './upgrade.ts';

import type { GitHubClient } from './github.ts';
import type { LockEntry } from './lock.ts';

const prefix = 'skills/demo/';
const v1 = [file('SKILL.md', '---\nname: demo\n---\nv1')];
const v2 = [file('SKILL.md', '---\nname: demo\n---\nv2')];
const edited = [file('SKILL.md', '---\nname: demo\n---\nv1 with local edits')];
const entry = (overrides: Partial<LockEntry> = {}): LockEntry => ({
  source: 'acme/skills', sourceType: 'github', skillPath: `${prefix}SKILL.md`, computedHash: folderHash(v1), ...overrides,
});

const fakeClient = (remote = createRemote(prefix, v1)) => {
  const requests: string[] = [];
  const client: GitHubClient = {
    fetchTree: async (repo) => { requests.push(repo); return remote.tree; },
    fetchFile: async (repo, _ref, entry) => { requests.push(repo); return remote.readRemoteFile(entry); },
    fetchCommits: async (repo) => {
      requests.push(repo);
      return (await remote.history.commits()).map((commit) => ({ ...commit, date: new Date().toISOString() }));
    },
    fetchFolderTree: async (repo, commit) => { requests.push(repo); return remote.history.folderTree(commit); },
  };
  return { client, requests };
};

describe('checkSkills security regressions', () => {
  it('should reject installer flags and path-like names before reading files or fetching a repository', async (t) => {
    const cwd = await createProject(t);
    const names = ['--global', '-g', '../outside', 'a/b', 'a\\b', 'demo\n', 'demo\0', '*', ''];
    const { client, requests } = fakeClient();
    const reports = await checkSkills({
      cwd, names, lock: { version: 1, skills: Object.fromEntries(names.map((name) => [name, entry()])) },
      client, minAge: 7 * 86_400_000,
    });

    assert.deepEqual(requests, []);
    for (const report of reports) {
      assert.equal(report.status, 'error');
      assert.equal(report.installSource, null);
      assert.equal(isUpgradeTarget(report, true), false);
    }
  });

  for (const source of ['attacker/skills', './substitute', '--global']) {
    it(`should install from the checked sourceUrl repository when source is ${source}`, async (t) => {
      const cwd = await createProject(t);
      await writeSkillFiles(cwd, '.agents/skills/demo', v1);
      const { client, requests } = fakeClient(createRemote(prefix, v2));
      const [report] = await checkSkills({
        cwd, names: ['demo'], client,
        lock: { version: 1, skills: { demo: entry({ source, sourceUrl: 'https://github.com/trusted/reviewed.git' }) } },
      });

      assert.ok(report);
      assert.equal(report.status, 'outdated');
      assert.equal(report.installSource, 'trusted/reviewed/skills/demo');
      assert.equal(report.url, 'https://github.com/trusted/reviewed/tree/HEAD/skills/demo');
      assert.ok(requests.length > 0);
      assert.ok(requests.every((repo) => repo === 'trusted/reviewed'));
    });
  }

  for (const name of ['My Skill', 'My-Skill', 'my--skill']) {
    it(`should preserve local edits for the normalized directory of ${name}`, async (t) => {
      const cwd = await createProject(t);
      await writeSkillFiles(cwd, '.agents/skills/my-skill', edited);
      const { client } = fakeClient();
      const [report] = await checkSkills({
        cwd, names: [name], client, lock: { version: 1, skills: { [name]: entry() } },
      });

      assert.ok(report);
      assert.equal(report.status, 'modified');
      assert.equal(isUpgradeTarget(report, false), false);
    });

    it(`should enforce --min-age for the normalized directory of ${name}`, async (t) => {
      const cwd = await createProject(t);
      await writeSkillFiles(cwd, '.agents/skills/my-skill', v1);
      const { client } = fakeClient(createRemote(prefix, v2));
      const [report] = await checkSkills({
        cwd, names: [name], client, minAge: 7 * 86_400_000, lock: { version: 1, skills: { [name]: entry() } },
      });

      assert.ok(report);
      assert.equal(report.status, 'outdated');
      assert.ok(report.heldUntil);
      assert.equal(isUpgradeTarget(report, true), false);
    });
  }

  for (const folder of ['demo#x/demo', 'demo@x/demo']) {
    for (const ref of [undefined, 'main']) {
      for (const hasLockedPath of [false, true]) {
        it(`should reject ambiguous upstream folder ${folder}, ref=${ref}, locked=${hasLockedPath}`, async (t) => {
          const cwd = await createProject(t);
          await writeSkillFiles(cwd, '.agents/skills/demo', v1);
          const { client } = fakeClient(createRemote(`${folder}/`, v1));
          const [report] = await checkSkills({
            cwd, names: ['demo'], client,
            lock: { version: 1, skills: { demo: entry({ ref, skillPath: hasLockedPath ? `${folder}/SKILL.md` : undefined }) } },
          });

          assert.ok(report);
          assert.equal(report.status, 'error');
          assert.equal(report.installSource, null);
          assert.equal(isUpgradeTarget(report, true), false);
        });
      }
    }
  }
});
