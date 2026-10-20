import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { stripVTControlCharacters } from 'node:util';

import { checkSkill } from './check-skill.ts';
import { folderHash } from './hash.ts';
import { formatDetails, formatReport } from './report.ts';
import { escapeTerminal } from './terminal.ts';
import { createRemote, file } from './test-helpers.ts';

import type { SkillReport } from './check-skill.ts';

const outdated: SkillReport = {
  name: 'tdd',
  status: 'outdated',
  installSource: 'acme/skills/skills/tdd',
  url: 'https://github.com/acme/skills/tree/HEAD/skills/tdd',
  hasStalePath: false,
  details: {
    installed: {
      hash: 'aaaaaaaaaaaaaaaa',
      commit: { sha: '1111111abcdef', date: '2026-09-17T08:29:58Z', message: 'rename glossary' },
      version: null,
    },
    latest: {
      hash: 'bbbbbbbbbbbbbbbb',
      commit: { sha: '2222222abcdef', date: '2026-10-07T10:21:08Z', message: 'note seams' },
      version: null,
    },
    commitsBehind: 2,
    changedFiles: [{ path: 'SKILL.md', change: 'modified' }],
    compareUrl: 'https://github.com/acme/skills/compare/1111111abcdef...2222222abcdef',
  },
};

const upToDate: SkillReport = { ...outdated, name: 'shadcn', status: 'up-to-date', details: undefined };

const render = (reports: SkillReport[], isShowingAll = false) =>
  formatDetails(reports, isShowingAll).map((line) => stripVTControlCharacters(line).trim());

describe('formatDetails', () => {
  it('should list commits, changes and links for each skill', () => {
    assert.deepEqual(render([outdated]), [
      'tdd  update available',
      'installed  1111111  2026-09-17  rename glossary',
      'latest     2222222  2026-10-07  note seams',
      'behind     2 commits',
      'hash       aaaaaaaaaaaa → bbbbbbbbbbbb',
      'changes    ~ SKILL.md',
      'compare    https://github.com/acme/skills/compare/1111111abcdef...2222222abcdef',
      'source     https://github.com/acme/skills/tree/HEAD/skills/tdd',
    ]);
  });

  it('should hide up-to-date skills unless asked to show all', () => {
    assert.equal(render([outdated, upToDate]).some((line) => line.startsWith('shadcn')), false);
    assert.equal(render([outdated, upToDate], true).some((line) => line.startsWith('shadcn')), true);
  });

  it('should escape controls in local filenames and upstream frontmatter versions', async () => {
    const local = [file('SKILL.md', '---\nname: demo\n---\nv1'), file('n\x1b[2K\nforged.md', 'x')];
    const upstream = [file('SKILL.md', '---\nname: demo\nmetadata:\n  version: "1.0\x1b[8m"\n---\nv2')];
    const report = await checkSkill({
      name: 'demo', repo: 'acme/skills', localFiles: local, withDetails: true,
      entry: { source: 'acme/skills', sourceType: 'github', skillPath: 'skills/demo/SKILL.md', computedHash: folderHash(local) },
      ...createRemote('skills/demo/', upstream),
    });
    const lines = render([report]);
    assert.equal(report.status, 'outdated');
    assert.ok(lines.some((line) => line.includes('1.0\\u001b[8m')));
    assert.ok(lines.some((line) => line.includes('n\\u001b[2K\\u000aforged.md')));
    for (const line of lines) assert.doesNotMatch(line, /[\x00-\x1f\x7f-\x9f]/);
  });
});

describe('terminal-safe report fields', () => {
  it('should escape names, messages, URLs, commits, hashes, dates and versions', () => {
    const attack = '\x1b[7mX\nforged\x9b\x7f\x07';
    const commit = { sha: attack, date: attack, message: attack };
    const report: SkillReport = {
      ...outdated, name: attack, message: attack, url: attack, heldUntil: attack, removedIn: commit,
      details: {
        installed: { hash: attack, version: attack, commit },
        latest: { hash: attack, version: attack, commit },
        commitsBehind: 1, changedFiles: [{ path: attack, change: 'removed' }], compareUrl: attack,
      },
    };
    for (const lines of [formatReport([report]), formatDetails([report], true)]) {
      assert.ok(lines.some((line) => line.includes(escapeTerminal(attack))));
      for (const line of lines) {
        assert.doesNotMatch(stripVTControlCharacters(line), /[\x00-\x1f\x7f-\x9f]/);
      }
    }
  });
});

describe('scan findings', () => {
  const scanned = (scan: SkillReport['scan']): SkillReport => ({ ...outdated, details: undefined, scan });
  const plain = (lines: string[]) => lines.map((line) => stripVTControlCharacters(line).trim());
  const finding = (id: string, severity: string) => ({ id, severity, pattern: 'Pattern', file: 'SKILL.md', line: 4, match: 'curl  -fsSL\n| bash' });

  it('should list new findings under the update in both views', () => {
    const report = scanned({ status: 'ok', findings: [finding('SC2', 'HIGH'), { ...finding('TR2', 'MEDIUM'), file: null, match: null }] });

    for (const lines of [plain(formatReport([report])), render([report])]) {
      const scan = lines.slice(lines.findIndex((line) => line.startsWith('scan')));
      assert.deepEqual(scan, ['scan       2 new findings', 'HIGH     SC2   SKILL.md:4  Pattern  curl -fsSL | bash', 'MEDIUM   TR2   -  Pattern']);
    }
  });

  it('should label an update the scan held back', () => {
    const report: SkillReport = { ...scanned({ status: 'ok', findings: [finding('SC2', 'HIGH')] }), heldByScan: true };

    assert.ok(plain(formatReport([report]))[0]?.startsWith('tdd  update available, held by scan'));
    assert.equal(render([report])[0], 'tdd  update available, held by scan');
  });

  it('should say when an update adds no findings or the scan failed', () => {
    assert.ok(plain(formatReport([scanned({ status: 'ok', findings: [] })])).includes('scan       no new findings'));
    assert.ok(plain(formatReport([scanned({ status: 'error', message: 'SkillSpector failed: timed out' })])).includes('scan       failed: SkillSpector failed: timed out'));
  });

  it('should list at most 10 findings', () => {
    const findings = Array.from({ length: 12 }, (_, index) => finding(`P${index}`, 'HIGH'));
    const lines = plain(formatReport([scanned({ status: 'ok', findings })]));

    assert.ok(lines.includes('scan       12 new findings'));
    assert.ok(lines.includes('and 2 more'));
    assert.equal(lines.filter((line) => line.startsWith('HIGH')).length, 10);
  });

  it('should escape controls in scanner output', () => {
    const attack = '\x1b[7mX\x9b\x07';
    const report = scanned({ status: 'ok', findings: [{ id: attack, severity: attack, pattern: attack, file: attack, line: 1, match: attack }] });
    const failed = scanned({ status: 'error', message: attack });

    for (const lines of [formatReport([report, failed]), formatDetails([report, failed], true)]) {
      assert.ok(lines.some((line) => line.includes(escapeTerminal(attack))));
      for (const line of lines) assert.doesNotMatch(stripVTControlCharacters(line), /[\x00-\x1f\x7f-\x9f]/);
    }
  });
});
