import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { escapeTerminal } from './terminal.ts';

describe('escapeTerminal', () => {
  it('should make all C0, DEL and C1 characters visible without passing them to the terminal', () => {
    const controls = Array.from({ length: 160 }, (_, index) => index)
      .filter((code) => code < 32 || code >= 127).map((code) => String.fromCharCode(code)).join('');
    const escaped = escapeTerminal(controls);
    assert.doesNotMatch(escaped, /[\x00-\x1f\x7f-\x9f]/);
    assert.ok(escaped.includes('\\u001b'));
    assert.ok(escaped.includes('\\u000a'));
    assert.ok(escaped.includes('\\u009b'));
  });

  it('should keep ordinary Unicode text and escape Unicode line separators', () => {
    assert.equal(escapeTerminal('żółć → 技能'), 'żółć → 技能');
    assert.equal(escapeTerminal('a\u2028b\u2029c'), 'a\\u2028b\\u2029c');
  });
});
