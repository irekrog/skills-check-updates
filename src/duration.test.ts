import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseDuration } from './duration.ts';

describe('parseDuration', () => {
  it('should read a bare number as days', () => {
    assert.equal(parseDuration('7'), 7 * 86_400_000);
  });

  it('should read day, hour and minute units', () => {
    assert.equal(parseDuration('2d'), 2 * 86_400_000);
    assert.equal(parseDuration('12h'), 12 * 3_600_000);
    assert.equal(parseDuration('30m'), 30 * 60_000);
  });

  it('should reject values it cannot read', () => {
    assert.throws(() => parseDuration('a week'), /Invalid duration/);
    assert.throws(() => parseDuration('7w'), /Invalid duration/);
  });
});
