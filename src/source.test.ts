import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildInstallSource, buildRepoUrl, getGitHubRepo } from './source.ts';

import type { LockEntry } from './lock.ts';

const entry = (overrides: Partial<LockEntry> = {}): LockEntry => ({
  source: 'acme/skills',
  sourceType: 'github',
  computedHash: 'hash',
  ...overrides,
});

describe('getGitHubRepo', () => {
  it('should read the repo from an owner/repo source', () => {
    assert.equal(getGitHubRepo(entry()), 'acme/skills');
  });

  it('should prefer the repo from sourceUrl', () => {
    assert.equal(getGitHubRepo(entry({ sourceUrl: 'https://github.com/acme/other.git' })), 'acme/other');
  });

  it('should return null for non-GitHub sources', () => {
    assert.equal(getGitHubRepo(entry({ sourceType: 'git', source: 'git@example.com:acme/skills.git' })), null);
  });
});

describe('buildRepoUrl', () => {
  it('should link to the repo root without a folder', () => {
    assert.equal(buildRepoUrl('acme/skills'), 'https://github.com/acme/skills');
  });

  it('should link to the skill folder on the default branch', () => {
    assert.equal(buildRepoUrl('acme/skills', undefined, 'skills/demo'), 'https://github.com/acme/skills/tree/HEAD/skills/demo');
  });

  it('should link to the pinned ref', () => {
    assert.equal(buildRepoUrl('acme/skills', 'v2'), 'https://github.com/acme/skills/tree/v2');
    assert.equal(buildRepoUrl('acme/skills', 'v2', 'skills/demo'), 'https://github.com/acme/skills/tree/v2/skills/demo');
  });
});

describe('buildInstallSource', () => {
  it('should append the skill folder to the source', () => {
    assert.equal(buildInstallSource('acme/skills', 'skills/demo/SKILL.md'), 'acme/skills/skills/demo');
  });

  it('should use the bare source for a skill at the repo root', () => {
    assert.equal(buildInstallSource('acme/skills', 'SKILL.md'), 'acme/skills');
  });

  it('should keep the pinned ref', () => {
    assert.equal(buildInstallSource('acme/skills', 'skills/demo/SKILL.md', 'v2'), 'acme/skills/skills/demo#v2');
  });

  it('should reject folder names that the installer would interpret as source syntax', () => {
    for (const folder of ['demo#x/demo', 'skills/demo@other', 'skills/demo:other', 'skills/demo\\other']) {
      assert.throws(() => buildInstallSource('acme/skills', `${folder}/SKILL.md`), /unsupported skill folder/);
      assert.throws(() => buildInstallSource('acme/skills', `${folder}/SKILL.md`, 'main'), /unsupported skill folder/);
    }
  });
});
