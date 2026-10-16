import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { gitMergeFile, mergeSkillFiles, type MergePlan } from './merge.ts';
import { file } from './test-helpers.ts';

import type { SkillFile } from './hash.ts';

const LINES = ['# Demo', '', 'one', 'two', 'three', 'four', 'five', 'six', ''];
const lines = (replace: Record<number, string> = {}) => LINES.map((line, index) => replace[index] ?? line).join('\n');
const failOnTextMerge = () => assert.fail('text merge should not run');

const mergedFiles = (plan: MergePlan): Record<string, string> => {
  assert.equal(plan.status, 'clean');
  return Object.fromEntries(plan.status === 'clean' ? plan.files.map((merged) => [merged.path, merged.content.toString()]) : []);
};

const merge = (base: SkillFile[], local: SkillFile[], upstream: SkillFile[]) =>
  mergeSkillFiles(base, local, upstream, failOnTextMerge);

describe('mergeSkillFiles', () => {
  it('should combine a local edit and an upstream edit to different files', () => {
    const base = [file('SKILL.md', 'v1'), file('notes.md', 'a')];
    const plan = merge(base, [file('SKILL.md', 'v1'), file('notes.md', 'a, mine')], [file('SKILL.md', 'v2'), file('notes.md', 'a')]);

    assert.deepEqual(mergedFiles(plan), { 'SKILL.md': 'v2', 'notes.md': 'a, mine' });
  });

  it('should keep a local file and apply an upstream deletion', () => {
    const base = [file('SKILL.md', 'v1'), file('old.md', 'old')];
    const plan = merge(base, [...base, file('mine.md', 'mine')], [file('SKILL.md', 'v1')]);

    assert.deepEqual(mergedFiles(plan), { 'SKILL.md': 'v1', 'mine.md': 'mine' });
  });

  it('should accept the same change made on both sides', () => {
    const plan = merge([file('SKILL.md', 'v1')], [file('SKILL.md', 'v2')], [file('SKILL.md', 'v2')]);

    assert.deepEqual(mergedFiles(plan), { 'SKILL.md': 'v2' });
  });

  it('should report a conflict when one side deletes a file the other side changed', () => {
    const plan = merge([file('SKILL.md', 'v1'), file('a.md', 'a')], [file('SKILL.md', 'v1')], [file('SKILL.md', 'v1'), file('a.md', 'a2')]);

    assert.deepEqual(plan, { status: 'conflict', paths: ['a.md'] });
  });

  it('should report a conflict when both sides add the same file with different content', () => {
    const plan = merge([], [file('a.md', 'mine')], [file('a.md', 'theirs')]);

    assert.deepEqual(plan, { status: 'conflict', paths: ['a.md'] });
  });

  it('should list every conflicting file and nothing else', () => {
    const plan = mergeSkillFiles(
      [file('a.md', 'a'), file('b.md', 'b'), file('c.md', 'c')],
      [file('a.md', 'a1'), file('b.md', 'b1'), file('c.md', 'c')],
      [file('a.md', 'a2'), file('b.md', 'b2'), file('c.md', 'c2')],
      () => null,
    );

    assert.deepEqual(plan, { status: 'conflict', paths: ['a.md', 'b.md'] });
  });
});

describe('gitMergeFile', () => {
  it('should merge edits to different lines of the same file', () => {
    const merged = gitMergeFile(Buffer.from(lines({ 2: 'one, mine' })), Buffer.from(lines()), Buffer.from(lines({ 7: 'six, theirs' })));

    assert.equal(merged?.toString(), lines({ 2: 'one, mine', 7: 'six, theirs' }));
  });

  it('should refuse edits to the same lines', () => {
    assert.equal(gitMergeFile(Buffer.from(lines({ 2: 'mine' })), Buffer.from(lines()), Buffer.from(lines({ 2: 'theirs' }))), null);
  });

  it('should refuse to merge binary files', () => {
    const binary = (byte: number) => Buffer.from([0, 1, 2, byte, 0]);

    assert.equal(gitMergeFile(binary(3), binary(4), binary(5)), null);
  });

  it('should report hunk conflicts through mergeSkillFiles', () => {
    const plan = mergeSkillFiles([file('SKILL.md', lines())], [file('SKILL.md', lines({ 2: 'mine' }))], [file('SKILL.md', lines({ 2: 'theirs' }))]);

    assert.deepEqual(plan, { status: 'conflict', paths: ['SKILL.md'] });
  });
});
