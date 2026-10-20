import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkSkill } from './check-skill.ts';
import { folderHash, type SkillFile } from './hash.ts';
import { createRemote, fakeCommit, file } from './test-helpers.ts';

import type { LockEntry } from './lock.ts';
import type { ScanUpdate } from './scan.ts';

const PREFIX = 'skills/demo/';
const v1 = [file('SKILL.md', '---\nname: demo\n---\nv1'), file('references/a.md', 'a')];
const v2 = [file('SKILL.md', '---\nname: demo\n---\nv2'), file('references/a.md', 'a')];
const edited = [file('SKILL.md', '---\nname: demo\n---\nv1 with local edits'), file('references/a.md', 'a')];

const lockedAt = (files: SkillFile[], overrides: Partial<LockEntry> = {}): LockEntry => ({
  source: 'acme/skills',
  sourceType: 'github',
  skillPath: `${PREFIX}SKILL.md`,
  computedHash: folderHash(files),
  ...overrides,
});

type CheckOptions = {
  history?: SkillFile[][];
  withDetails?: boolean;
  scanUpdate?: ScanUpdate;
};

const check = (
  entry: LockEntry,
  localFiles: SkillFile[] | null,
  upstream: SkillFile[],
  { history, withDetails = false, scanUpdate }: CheckOptions = {},
) =>
  checkSkill({
    name: 'demo',
    repo: 'acme/skills',
    entry,
    localFiles,
    withDetails,
    scanUpdate,
    ...createRemote(PREFIX, upstream, history),
  });

describe('checkSkill', () => {
  it('should report up-to-date when local files match upstream', async () => {
    const report = await check(lockedAt(v1), v1, v1);

    assert.equal(report.status, 'up-to-date');
    assert.equal(report.installSource, 'acme/skills/skills/demo');
    assert.equal(report.url, 'https://github.com/acme/skills/tree/HEAD/skills/demo');
    assert.equal(report.hasStalePath, false);
    assert.equal(report.details, undefined);
  });

  it('should report outdated when upstream changed since install', async () => {
    const report = await check(lockedAt(v1), v1, v2);

    assert.equal(report.status, 'outdated');
    assert.equal(report.latestHash, folderHash(v2));
  });

  it('should report modified when only the local copy changed', async () => {
    assert.equal((await check(lockedAt(v1), edited, v1)).status, 'modified');
  });

  it('should report conflict when both the local copy and upstream changed', async () => {
    assert.equal((await check(lockedAt(v1), edited, v2)).status, 'conflict');
  });

  it('should not treat metadata.json skipped by the installer as a local change', async () => {
    const metadata = file('metadata.json', '{}');

    assert.equal((await check(lockedAt([...v1, metadata]), v1, [...v1, metadata])).status, 'up-to-date');
    assert.equal((await check(lockedAt([...v1, metadata]), v1, [...v2, metadata])).status, 'outdated');
  });

  it('should accept metadata.json in copies made by older installers', async () => {
    const metadata = file('metadata.json', '{}');
    const stale = { computedHash: 'stale' };
    const history = [
      [...v2, metadata],
      [...v1, metadata],
    ];

    assert.equal((await check(lockedAt(v1, stale), [...v1, metadata], [...v1, metadata])).status, 'up-to-date');
    assert.equal((await check(lockedAt(v1, stale), [...v1, metadata], [...v2, metadata], { history })).status, 'outdated');
  });

  it('should treat a copy of an older upstream version as unedited when the lock hash is stale', async () => {
    const report = await check(lockedAt(v1, { computedHash: 'stale' }), v1, v2, { history: [v2, v1] });

    assert.equal(report.status, 'outdated');
  });

  it('should report conflict when no recent upstream version matches the local copy', async () => {
    const report = await check(lockedAt(v1, { computedHash: 'stale' }), edited, v2, { history: [v2, v1] });

    assert.equal(report.status, 'conflict');
  });

  it('should skip the history lookup when the lock proves the copy is clean', async () => {
    const remote = createRemote(PREFIX, v2, [v2, v1]);

    await checkSkill({ name: 'demo', repo: 'acme/skills', entry: lockedAt(v1), localFiles: v1, withDetails: false, ...remote });

    assert.deepEqual(remote.historyReads, []);
  });

  it('should download only files that differ from the local copy', async () => {
    const remote = createRemote(PREFIX, v2);

    await checkSkill({ name: 'demo', repo: 'acme/skills', entry: lockedAt(v1), localFiles: v1, withDetails: false, ...remote });

    assert.deepEqual(remote.downloads, [`${PREFIX}SKILL.md`]);
  });

  it('should report not-installed when the skill folder is missing', async () => {
    assert.equal((await check(lockedAt(v1), null, v1)).status, 'not-installed');
  });

  it('should report not-found when the skill was removed upstream', async () => {
    const remote = createRemote('skills/other/', [file('SKILL.md', '---\nname: other\n---\n')]);
    const report = await checkSkill({
      name: 'demo',
      repo: 'acme/skills',
      entry: lockedAt(v1),
      localFiles: v1,
      withDetails: false,
      ...remote,
    });

    assert.equal(report.status, 'not-found');
    assert.equal(report.installSource, null);
    assert.equal(report.url, 'https://github.com/acme/skills');
  });

  it('should locate the skill when the lock has no skillPath', async () => {
    const { skillPath: _, ...legacyEntry } = lockedAt(v1);
    const report = await check(legacyEntry, v1, v2);

    assert.equal(report.status, 'outdated');
    assert.equal(report.hasStalePath, true);
    assert.equal(report.installSource, 'acme/skills/skills/demo');
  });

  it('should follow a skill that moved to another folder upstream', async () => {
    const report = await check(lockedAt(v1, { skillPath: 'old/demo/SKILL.md' }), v1, v1);

    assert.equal(report.status, 'up-to-date');
    assert.equal(report.hasStalePath, true);
    assert.equal(report.installSource, 'acme/skills/skills/demo');
  });
});

describe('checkSkill min age', () => {
  const MIN_AGE = 7 * 86_400_000;
  const remoteWithUpdate = () => createRemote(PREFIX, v2, [v2, v1]);
  const checkAt = (now: string, localFiles = v1) =>
    checkSkill({
      name: 'demo',
      repo: 'acme/skills',
      entry: lockedAt(v1),
      localFiles,
      withDetails: false,
      minAge: MIN_AGE,
      now: Date.parse(now),
      ...remoteWithUpdate(),
    });

  it('should hold an update whose latest change is younger than the minimum age', async () => {
    const report = await checkAt('2026-10-22T10:00:00Z');

    assert.equal(report.status, 'outdated');
    assert.equal(report.heldUntil, '2026-10-27T10:00:00.000Z');
  });

  it('should release the update once the latest change is old enough', async () => {
    assert.equal((await checkAt('2026-10-28T10:00:00Z')).heldUntil, undefined);
  });

  it('should not hold skills that only have local changes', async () => {
    const remote = createRemote(PREFIX, v1, [v1]);
    const report = await checkSkill({
      name: 'demo',
      repo: 'acme/skills',
      entry: lockedAt(v1),
      localFiles: edited,
      withDetails: false,
      minAge: MIN_AGE,
      now: Date.parse('2026-10-20T11:00:00Z'),
      ...remote,
    });

    assert.equal(report.status, 'modified');
    assert.equal(report.heldUntil, undefined);
  });
});

describe('checkSkill details', () => {
  it('should point both versions at the latest commit when up to date', async () => {
    const { details } = await check(lockedAt(v1), v1, v1, { withDetails: true });

    assert.deepEqual(details?.installed.commit, fakeCommit(0));
    assert.deepEqual(details?.latest.commit, fakeCommit(0));
    assert.equal(details?.commitsBehind, 0);
    assert.deepEqual(details?.changedFiles, []);
    assert.equal(details?.compareUrl, null);
  });

  it('should find the installed commit and link a compare view when outdated', async () => {
    const { details } = await check(lockedAt(v1), v1, v2, { history: [v2, v1], withDetails: true });

    assert.deepEqual(details?.installed.commit, fakeCommit(1));
    assert.deepEqual(details?.latest.commit, fakeCommit(0));
    assert.equal(details?.commitsBehind, 1);
    assert.equal(details?.installed.hash, folderHash(v1));
    assert.equal(details?.latest.hash, folderHash(v2));
    assert.deepEqual(details?.changedFiles, [{ path: 'SKILL.md', change: 'modified' }]);
    assert.equal(details?.compareUrl, 'https://github.com/acme/skills/compare/111111111111...000000000000');
  });

  it('should name the commit that removed a skill gone from upstream', async () => {
    const remote = createRemote('skills/other/', [file('SKILL.md', '---\nname: other\n---\n')]);
    const report = await checkSkill({
      name: 'demo',
      repo: 'acme/skills',
      entry: lockedAt(v1),
      localFiles: v1,
      withDetails: true,
      ...remote,
    });

    assert.equal(report.status, 'not-found');
    assert.deepEqual(report.removedIn, fakeCommit(0));
  });

  it('should list added and removed files', async () => {
    const v3 = [file('SKILL.md', '---\nname: demo\n---\nv1'), file('references/b.md', 'b')];
    const { details } = await check(lockedAt(v1), v1, v3, { history: [v3, v1], withDetails: true });

    assert.deepEqual(details?.changedFiles, [
      { path: 'references/a.md', change: 'removed' },
      { path: 'references/b.md', change: 'added' },
    ]);
  });

  it('should read the frontmatter version of both copies', async () => {
    const installed = [file('SKILL.md', '---\nname: demo\nmetadata:\n  version: "1.0"\n---\n')];
    const latest = [file('SKILL.md', '---\nname: demo\nmetadata:\n  version: "1.1"\n---\n')];
    const { details } = await check(lockedAt(installed), installed, latest, {
      history: [latest, installed],
      withDetails: true,
    });

    assert.equal(details?.installed.version, '1.0');
    assert.equal(details?.latest.version, '1.1');
  });

  it('should leave the installed commit unknown when the local copy matches no upstream version', async () => {
    const { details } = await check(lockedAt(v1), edited, v2, { history: [v2, v1], withDetails: true });

    assert.equal(details?.installed.commit, null);
    assert.equal(details?.commitsBehind, null);
    assert.equal(details?.compareUrl, null);
  });
});

describe('checkSkill merge plan', () => {
  const base = [file('SKILL.md', '---\nname: demo\n---\nv1'), file('references/a.md', 'a')];
  const upstream = [file('SKILL.md', '---\nname: demo\n---\nv2'), file('references/a.md', 'a')];
  const local = [file('SKILL.md', '---\nname: demo\n---\nv1'), file('references/a.md', 'a, mine')];
  const planFor = async (localFiles: SkillFile[], entry = lockedAt(base), history = [upstream, base]) => {
    const remote = createRemote(PREFIX, upstream, history);
    const report = await checkSkill({ name: 'demo', repo: 'acme/skills', entry, localFiles, withDetails: false, withMerge: true, ...remote });
    return { report, remote };
  };

  it('should merge local edits with upstream changes made to other files', async () => {
    const { report } = await planFor(local);

    assert.equal(report.status, 'conflict');
    assert.equal(report.merge?.status, 'clean');
    const files = report.merge?.status === 'clean' ? report.merge.files : [];
    assert.deepEqual(Object.fromEntries(files.map(({ path, content }) => [path, content.toString()])), {
      'SKILL.md': '---\nname: demo\n---\nv2',
      'references/a.md': 'a, mine',
    });
  });

  it('should find the base among older commits by the lock hash', async () => {
    const middle = [file('SKILL.md', '---\nname: demo\n---\nv1.5'), file('references/a.md', 'a')];
    const { report } = await planFor(local, lockedAt(base), [upstream, middle, base]);

    assert.equal(report.merge?.status, 'clean');
  });

  it('should download only base files missing from the local and upstream copies', async () => {
    const withNotes = [...base, file('notes.md', 'n')];
    const remote = createRemote(PREFIX, upstream, [upstream, withNotes]);
    const localFiles = [...base, file('notes.md', 'n, mine')];
    await checkSkill({ name: 'demo', repo: 'acme/skills', entry: lockedAt(withNotes), localFiles, withDetails: false, withMerge: true, ...remote });

    assert.deepEqual(remote.downloads.filter((path) => path.includes(':')), [`${'1'.repeat(40)}:${PREFIX}notes.md`]);
  });

  it('should report overlapping edits to the same file', async () => {
    const { report } = await planFor([file('SKILL.md', '---\nname: demo\n---\nv1, mine'), file('references/a.md', 'a')]);

    assert.deepEqual(report.merge, { status: 'conflict', paths: ['SKILL.md'] });
  });

  it('should explain when no upstream commit reproduces the lock hash', async () => {
    const { report } = await planFor(local, lockedAt(base, { computedHash: 'stale' }));

    assert.deepEqual(report.merge, { status: 'unavailable', reason: 'installed version not found in the last 2 upstream commits' });
  });

  it('should not plan a merge unless asked', async () => {
    const report = await check(lockedAt(base), local, upstream, { history: [upstream, base] });

    assert.equal(report.merge, undefined);
  });
});

describe('checkSkill scan', () => {
  const recordScans = () => {
    const scans: { installed: string[]; upstream: string[] }[] = [];
    const scanUpdate: ScanUpdate = async (installed, upstream) => {
      scans.push({ installed: installed.map((scanned) => scanned.path), upstream: upstream.map((scanned) => scanned.path) });
      return { status: 'ok', findings: [] };
    };
    return { scans, scanUpdate };
  };

  it('should scan the installed copy and the files an update would install', async () => {
    const { scans, scanUpdate } = recordScans();
    const metadata = file('metadata.json', '{}');

    const report = await check(lockedAt([...v1, metadata]), edited, [...v2, metadata], { scanUpdate });

    assert.equal(report.status, 'conflict');
    assert.deepEqual(report.scan, { status: 'ok', findings: [] });
    assert.deepEqual(scans, [{ installed: ['SKILL.md', 'references/a.md'], upstream: ['SKILL.md', 'references/a.md'] }]);
  });

  it('should not scan skills without an upstream change', async () => {
    const { scans, scanUpdate } = recordScans();

    assert.equal((await check(lockedAt(v1), v1, v1, { scanUpdate })).scan, undefined);
    assert.equal((await check(lockedAt(v1), edited, v1, { scanUpdate })).scan, undefined);
    assert.deepEqual(scans, []);
  });
});
