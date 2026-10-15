import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { selectSkillNames, splitList } from './select.ts';

import type { LockEntry, SkillsLock } from './lock.ts';

const entry = (source: string): LockEntry => ({ source, sourceType: 'github', computedHash: 'hash' });

const lock: SkillsLock = {
  version: 1,
  skills: {
    grilling: entry('mattpocock/skills'),
    'grill-me': entry('mattpocock/skills'),
    shadcn: entry('shadcn/ui'),
    tdd: entry('mattpocock/skills'),
  },
};

const select = (selection: Partial<Parameters<typeof selectSkillNames>[1]>) =>
  selectSkillNames(lock, { only: [], skip: [], from: [], ...selection });

describe('selectSkillNames', () => {
  it('should select every skill without filters', () => {
    assert.deepEqual(select({}), ['grilling', 'grill-me', 'shadcn', 'tdd']);
  });

  it('should match names with wildcards', () => {
    assert.deepEqual(select({ only: ['grill*'] }), ['grilling', 'grill-me']);
  });

  it('should drop skipped skills', () => {
    assert.deepEqual(select({ skip: ['grill*', 'tdd'] }), ['shadcn']);
  });

  it('should keep only skills from the given source', () => {
    assert.deepEqual(select({ from: ['shadcn/*'] }), ['shadcn']);
  });

  it('should keep unknown exact names so they are reported', () => {
    assert.deepEqual(select({ only: ['tdd', 'typo', 'nothing*'] }), ['tdd', 'typo']);
  });
});

describe('splitList', () => {
  it('should split comma separated values and drop blanks', () => {
    assert.deepEqual(splitList(['a, b', 'c,']), ['a', 'b', 'c']);
  });
});
