import { styleText } from 'node:util';

import { escapeTerminal } from './terminal.ts';

type ProgressStream = {
  isTTY?: boolean;
  columns?: number;
  write: (text: string) => unknown;
};

type Progress = {
  tick: (label: string) => void;
  done: () => void;
};

const BAR_WIDTH = 24;
const DEFAULT_COLUMNS = 80;
const CLEAR_LINE = '\r\x1b[2K';

export const createProgress = (title: string, total: number, stream: ProgressStream = process.stderr): Progress => {
  title = escapeTerminal(title);
  if (!stream.isTTY) {
    stream.write(`${title} (${total} skills)...\n`);
    return { tick: () => {}, done: () => {} };
  }

  let completed = 0;
  const render = (label: string) => {
    label = escapeTerminal(label);
    const filled = total === 0 ? BAR_WIDTH : Math.round((completed / total) * BAR_WIDTH);
    const counter = `${completed}/${total}`;
    const plainWidth = title.length + BAR_WIDTH + counter.length + 3;
    // Why: a line wider than the terminal wraps, and `\r` then rewrites only the last
    // row, leaving a trail of half-drawn bars behind.
    const labelWidth = Math.max(0, (stream.columns || DEFAULT_COLUMNS) - plainWidth - 1);
    const bar = `${styleText('cyan', '█'.repeat(filled))}${styleText('dim', '░'.repeat(BAR_WIDTH - filled))}`;
    stream.write(`${CLEAR_LINE}${styleText('dim', title)} ${bar} ${counter} ${styleText('dim', label.slice(0, labelWidth))}`);
  };

  render('');
  return {
    tick: (label) => {
      completed += 1;
      render(label);
    },
    done: () => {
      stream.write(CLEAR_LINE);
    },
  };
};
