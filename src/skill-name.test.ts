import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sanitizeName } from './skill-name.ts';

describe('sanitizeName compatibility with skills', () => {
  it('should use the installer directory names for display names', () => {
    for (const name of ['My Skill', 'My-Skill', 'my--skill']) assert.equal(sanitizeName(name), 'my-skill');
    assert.equal(sanitizeName('ce:review'), 'ce-review');
    assert.equal(sanitizeName('../evil'), 'evil');
    assert.equal(sanitizeName('...'), 'unnamed-skill');
    assert.equal(sanitizeName('A'.repeat(256)), 'a'.repeat(255));
  });
});
