import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { diffFiles } from './skill-files.ts';

describe('diffFiles', () => {
  it('should mark added, modified and removed files sorted by path', () => {
    const local = [
      { path: 'SKILL.md', sha: 'a' },
      { path: 'old.md', sha: 'b' },
    ];
    const upstream = [
      { path: 'SKILL.md', sha: 'c' },
      { path: 'new.md', sha: 'd' },
    ];

    assert.deepEqual(diffFiles(local, upstream), [
      { path: 'new.md', change: 'added' },
      { path: 'old.md', change: 'removed' },
      { path: 'SKILL.md', change: 'modified' },
    ]);
  });

  it('should not report upstream files the installer never copies', () => {
    const local = [{ path: 'SKILL.md', sha: 'a' }];
    const upstream = [
      { path: 'SKILL.md', sha: 'a' },
      { path: 'metadata.json', sha: 'b' },
    ];

    assert.deepEqual(diffFiles(local, upstream), []);
  });
});
