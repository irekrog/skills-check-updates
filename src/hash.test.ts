import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { folderHash, folderHashV2, gitBlobSha, isLockHashOf } from './hash.ts';
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

describe('folderHashV2', () => {
  const entryHash = (...entries: [string, string][]): string => {
    const hash = createHash('sha256');
    for (const [path, content] of entries) {
      hash.update(path).update('\0').update(String(Buffer.byteLength(content))).update('\0').update(content);
    }
    return hash.digest('hex');
  };

  it('should hash byte-sorted paths with the length of each content', () => {
    const expected = entryHash(['B.md', 'b'], ['SKILL.md', 'skill'], ['a.md', 'a']);

    assert.equal(folderHashV2([file('a.md', 'a'), file('SKILL.md', 'skill'), file('B.md', 'b')]), expected);
  });

  it('should leave out the files the installer does not copy', () => {
    const files = [file('SKILL.md', 'skill'), file('metadata.json', '{}'), file('scripts/__pycache__/x.pyc', 'x')];

    assert.equal(folderHashV2(files), entryHash(['SKILL.md', 'skill']));
  });

  it('should normalize CRLF line endings in text but not in binary content', () => {
    assert.equal(folderHashV2([file('SKILL.md', 'a\r\nb')]), entryHash(['SKILL.md', 'a\nb']));
    assert.equal(folderHashV2([file('icon.bin', 'a\r\n\0')]), entryHash(['icon.bin', 'a\r\n\0']));
  });
});

describe('isLockHashOf', () => {
  const files = [file('SKILL.md', 'skill')];

  it('should accept the hash written by either lock version', () => {
    assert.equal(isLockHashOf(folderHash(files), files), true);
    assert.equal(isLockHashOf(folderHashV2(files), files), true);
  });

  it('should reject the hash of other files', () => {
    assert.equal(isLockHashOf(folderHashV2([file('SKILL.md', 'other')]), files), false);
  });
});
