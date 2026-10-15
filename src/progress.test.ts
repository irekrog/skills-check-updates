import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { stripVTControlCharacters } from 'node:util';

import { createProgress } from './progress.ts';

const createStream = (isTTY: boolean, columns = 80) => {
  const writes: string[] = [];
  return { isTTY, columns, writes, write: (text: string) => writes.push(text) };
};

const lastLine = (writes: string[]): string => stripVTControlCharacters(writes.at(-1) ?? '').trim();

describe('createProgress', () => {
  it('should print a single static line when the stream is not a terminal', () => {
    const stream = createStream(false);
    const progress = createProgress('Checking', 2, stream);

    progress.tick('tdd');
    progress.tick('shadcn');
    progress.done();

    assert.deepEqual(stream.writes, ['Checking (2 skills)...\n']);
  });

  it('should redraw the bar with the count and last label on every tick', () => {
    const stream = createStream(true);
    const progress = createProgress('Checking', 4, stream);

    progress.tick('tdd');
    progress.tick('shadcn');

    assert.equal(lastLine(stream.writes), `Checking ${'█'.repeat(12)}${'░'.repeat(12)} 2/4 shadcn`);
  });

  it('should truncate the label to fit the terminal width', () => {
    const stream = createStream(true, 40);
    const progress = createProgress('Checking', 1, stream);

    progress.tick('improve-codebase-architecture');

    assert.ok(lastLine(stream.writes).length < 40);
  });

  it('should clear the bar when done', () => {
    const stream = createStream(true);
    const progress = createProgress('Checking', 1, stream);

    progress.tick('tdd');
    progress.done();

    assert.equal(lastLine(stream.writes), '');
  });

  it('should escape untrusted labels before rendering the progress bar', () => {
    const stream = createStream(true, 200);
    const progress = createProgress('Checking', 1, stream);
    progress.tick('demo\x1b]0;title\x07\nforged\x9b');
    const line = stripVTControlCharacters(stream.writes.at(-1) ?? '').replace(/^\r/, '');
    assert.doesNotMatch(line, /[\x00-\x09\x0b-\x1f\x7f-\x9f]/);
    assert.ok(line.includes('demo\\u001b]0;title\\u0007\\u000aforged\\u009b'));
  });
});
