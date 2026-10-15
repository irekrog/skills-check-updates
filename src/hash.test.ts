import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { folderHash, gitBlobSha } from './hash.ts';
import { file } from './test-helpers.ts';

describe('gitBlobSha', () => {
  it('should match the sha git assigns to the same content', () => {
    assert.equal(gitBlobSha(Buffer.from('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a');
  });
});

describe('folderHash', () => {
  it('should hash paths in locale order followed by their contents', () => {
    const expected = createHash('sha256').update('refs/a.md').update('a').update('SKILL.md').update('skill').digest('hex');

    assert.equal(folderHash([file('refs/a.md', 'a'), file('SKILL.md', 'skill')]), expected);
  });

  it('should not depend on the order of the input files', () => {
    const files = [file('a.md', 'a'), file('b.md', 'b')];

    assert.equal(folderHash(files), folderHash([...files].reverse()));
  });
});
