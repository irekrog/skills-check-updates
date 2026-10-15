import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readFrontmatterName, readFrontmatterVersion } from './frontmatter.ts';

describe('readFrontmatterName', () => {
  it('should read a quoted name', () => {
    assert.equal(readFrontmatterName('---\nname: "demo"\ndescription: x\n---\nbody'), 'demo');
  });

  it('should ignore nested name keys', () => {
    assert.equal(readFrontmatterName('---\nmetadata:\n  name: other\n---\n'), null);
  });

  it('should return null without frontmatter', () => {
    assert.equal(readFrontmatterName('# demo'), null);
  });
});

describe('readFrontmatterVersion', () => {
  it('should read a version nested under metadata', () => {
    assert.equal(readFrontmatterVersion('---\nname: demo\nmetadata:\n  version: "1.0.0"\n---\n'), '1.0.0');
  });

  it('should ignore a version mentioned in the body', () => {
    assert.equal(readFrontmatterVersion('---\nname: demo\n---\nversion: 2'), null);
  });
});
