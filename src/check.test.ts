import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkSkills, HISTORY_DEPTH } from './check.ts';
import { folderHash } from './hash.ts';
import { createProject, createRemote, file, writeSkillFiles } from './test-helpers.ts';
import { isUpgradeTarget } from './upgrade.ts';

import type { GitHubClient } from './github.ts';
import type { LockEntry } from './lock.ts';
import type { TestContext } from 'node:test';

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
    fetchFile: async (repo, ref, entry) => {
      requests.push(repo);
      return ref === 'HEAD' ? remote.readRemoteFile(entry) : remote.history.readFile(ref, entry);
    },
    fetchCommits: async (repo, _ref, _path, limit) => {
      requests.push(repo);
      const commits = (await remote.history.commits()).slice(0, limit);
      return commits.map((commit) => ({ ...commit, date: new Date().toISOString() }));
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

describe('checkSkills merge base window', () => {
  // Note: newest first, so versions[0] is the current upstream folder.
  const versions = Array.from({ length: HISTORY_DEPTH + 1 }, (_, index) => [
    file('SKILL.md', `---\nname: demo\n---\nv${HISTORY_DEPTH + 1 - index}`),
    file('notes.md', 'notes'),
  ]);
  const checkWithBaseAt = async (t: TestContext, baseIndex: number) => {
    const base = versions[baseIndex] ?? [];
    const cwd = await createProject(t);
    await writeSkillFiles(cwd, '.agents/skills/demo', [...base.filter((skillFile) => skillFile.path !== 'notes.md'), file('notes.md', 'notes, mine')]);
    const { client } = fakeClient(createRemote(prefix, versions[0] ?? [], versions));
    const [report] = await checkSkills({
      cwd, names: ['demo'], client, withMerge: true, lock: { version: 1, skills: { demo: entry({ computedHash: folderHash(base) }) } },
    });
    assert.ok(report);
    assert.equal(report.status, 'conflict');
    return report;
  };

  it('should merge when the installed version is the oldest commit inside the window', async (t) => {
    const report = await checkWithBaseAt(t, HISTORY_DEPTH - 1);

    assert.equal(report.merge?.status, 'clean');
  });

  it('should treat a base older than the window as unknown instead of merging', async (t) => {
    const report = await checkWithBaseAt(t, HISTORY_DEPTH);

    assert.deepEqual(report.merge, {
      status: 'unavailable',
      reason: `installed version not found in the last ${HISTORY_DEPTH} upstream commits`,
    });
  });
});
