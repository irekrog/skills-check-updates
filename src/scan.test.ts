import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { createUpdateScanner, holdsUpdate, newFindings, parseFindings, readSkillSpectorVersion, type ScanFinding } from './scan.ts';
import { file } from './test-helpers.ts';

import type { TestContext } from 'node:test';

const finding = (id: string, path: string | null, overrides: Partial<ScanFinding> = {}): ScanFinding => ({
  id, severity: 'HIGH', pattern: null, file: path, line: 1, match: null, ...overrides,
});

const issue = (id: string, path: string, severity = 'HIGH') => ({
  id, severity, pattern: 'Pattern', finding: 'matched text', location: { file: path, start_line: 3 },
});

type FakeRun = { code: number; stdout: string; stderr?: string };
type ScannedDir = { command: string; args: string[]; files: Record<string, string> };

const readTree = (dir: string): Record<string, string> =>
  Object.fromEntries(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);
        return [path.slice(dir.length + 1).split('\\').join('/'), readFileSync(path, 'utf8')];
      }),
  );

// Note: answers from the scanned SKILL.md, the way SkillSpector would read the folder.
const fakeSkillSpector = (t: TestContext, respond: (skill: string) => FakeRun, delayMs = 0) => {
  const scanned: ScannedDir[] = [];
  const dirs: string[] = [];
  let active = 0;
  let maxActive = 0;
  t.mock.method(childProcess, 'execFile', (command: string, args: string[], _options: unknown, callback: (...result: unknown[]) => void) => {
    const dir = args[1] ?? '';
    const files = readTree(dir);
    scanned.push({ command, args, files });
    dirs.push(dir);
    active += 1;
    maxActive = Math.max(maxActive, active);
    const { code, stdout, stderr = '' } = respond(files['SKILL.md'] ?? '');
    const error = code === 0 ? null : Object.assign(new Error(`Command failed with exit code ${code}`), { code });
    setTimeout(() => {
      active -= 1;
      callback(error, stdout, stderr);
    }, delayMs);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return { scanned, dirs, maxActive: () => maxActive };
};

const report = (...issues: unknown[]): FakeRun => ({ code: 0, stdout: JSON.stringify({ issues }) });

describe('parseFindings', () => {
  it('should read the rule, severity, location and matched text of each issue', () => {
    assert.deepEqual(parseFindings({ issues: [issue('SC2', 'scripts/run.sh')] }), [
      { id: 'SC2', severity: 'HIGH', pattern: 'Pattern', file: 'scripts/run.sh', line: 3, match: 'matched text' },
    ]);
  });

  it('should keep issues without a location', () => {
    assert.deepEqual(parseFindings({ issues: [{ id: 'TR2', severity: 'MEDIUM' }] }), [
      { id: 'TR2', severity: 'MEDIUM', pattern: null, file: null, line: null, match: null },
    ]);
  });

  it('should reject reports it does not understand', () => {
    assert.throws(() => parseFindings({ risk_assessment: {} }), /no issues list/);
    assert.throws(() => parseFindings({ issues: [{ severity: 'HIGH' }] }), /no id or severity/);
  });
});

describe('newFindings', () => {
  it('should ignore a finding that only moved to another line', () => {
    assert.deepEqual(newFindings([finding('P2', 'SKILL.md', { line: 3 })], [finding('P2', 'SKILL.md', { line: 9 })]), []);
  });

  it('should report the surplus when a rule fires more often in the same file', () => {
    const before = [finding('E1', 'SKILL.md')];
    const after = [finding('E1', 'SKILL.md'), finding('E1', 'SKILL.md', { line: 40 })];

    assert.equal(newFindings(before, after).length, 1);
  });

  it('should report a known rule firing in another file', () => {
    assert.deepEqual(newFindings([finding('PE3', 'SKILL.md')], [finding('PE3', 'SKILL.md'), finding('PE3', 'notes.md')]), [
      finding('PE3', 'notes.md'),
    ]);
  });

  it('should skip incomplete-analysis diagnostics', () => {
    assert.deepEqual(newFindings([], [finding('AE1', 'SKILL.md')]), []);
  });

  it('should list the most severe findings first', () => {
    const after = [finding('E1', 'a.md', { severity: 'MEDIUM' }), finding('SC2', 'b.md', { severity: 'CRITICAL' }), finding('X1', 'c.md', { severity: 'INFO' })];

    assert.deepEqual(newFindings([], after).map(({ id }) => id), ['SC2', 'E1', 'X1']);
  });
});

describe('createUpdateScanner', () => {
  const installed = [file('SKILL.md', 'v1')];
  const upstream = [file('SKILL.md', 'v2'), file('scripts/run.sh', 'curl | bash')];

  it('should scan both versions statically and return what the update adds', async (t) => {
    const fake = fakeSkillSpector(t, (skill) =>
      skill === 'v1' ? report(issue('P2', 'SKILL.md')) : report(issue('P2', 'SKILL.md'), issue('SC2', 'scripts/run.sh')),
    );

    const scan = await createUpdateScanner(2)(installed, upstream);

    assert.deepEqual(scan, {
      status: 'ok',
      findings: [{ id: 'SC2', severity: 'HIGH', pattern: 'Pattern', file: 'scripts/run.sh', line: 3, match: 'matched text' }],
    });
    assert.deepEqual(fake.scanned.map(({ command, args }) => [command, ...args.filter((_, index) => index !== 1)]), [
      ['skillspector', 'scan', '--no-llm', '--format', 'json'],
      ['skillspector', 'scan', '--no-llm', '--format', 'json'],
    ]);
    assert.deepEqual(fake.scanned.map(({ files }) => files), [{ 'SKILL.md': 'v1' }, { 'SKILL.md': 'v2', 'scripts/run.sh': 'curl | bash' }]);
    for (const dir of fake.dirs) assert.equal(existsSync(dir), false);
  });

  it('should accept exit code 1, which only means a high risk score', async (t) => {
    fakeSkillSpector(t, (skill) => ({ ...report(...(skill === 'v2' ? [issue('SC2', 'SKILL.md')] : [])), code: skill === 'v2' ? 1 : 0 }));

    const scan = await createUpdateScanner(2)(installed, upstream);

    assert.equal(scan.status, 'ok');
    assert.equal(scan.status === 'ok' && scan.findings.length, 1);
  });

  it('should report a scanner failure instead of throwing', async (t) => {
    const fake = fakeSkillSpector(t, () => ({ code: 2, stdout: '', stderr: 'Error: Cannot determine input type\nmore' }));

    assert.deepEqual(await createUpdateScanner(2)(installed, upstream), {
      status: 'error', message: 'SkillSpector failed: Error: Cannot determine input type',
    });
    for (const dir of fake.dirs) assert.equal(existsSync(dir), false);
  });

  it('should report output that is not a JSON report', async (t) => {
    fakeSkillSpector(t, () => ({ code: 0, stdout: 'Report saved to: report.json' }));

    assert.deepEqual(await createUpdateScanner(2)(installed, upstream), { status: 'error', message: 'SkillSpector did not print a JSON report' });
  });

  it('should never write an upstream file outside the scan folder', async (t) => {
    const escape = `scu-escape-${process.pid}-${Date.now()}.md`;
    fakeSkillSpector(t, () => report());

    const scan = await createUpdateScanner(2)(installed, [file(`../${escape}`, 'x')]);

    assert.equal(scan.status, 'error');
    assert.match(scan.status === 'error' ? scan.message : '', /unsafe skill file path/);
    assert.equal(existsSync(join(tmpdir(), escape)), false);
  });

  it('should run no more scans at once than its concurrency', async (t) => {
    const fake = fakeSkillSpector(t, () => report(), 5);
    const scanUpdate = createUpdateScanner(1);

    await Promise.all([scanUpdate(installed, upstream), scanUpdate(installed, upstream)]);

    assert.equal(fake.scanned.length, 4);
    assert.equal(fake.maxActive(), 1);
  });
});

describe('readSkillSpectorVersion', () => {
  it('should read the installed version', (t) => {
    t.mock.method(childProcess, 'execFileSync', () => 'SkillSpector v2.13.0\n');
    syncBuiltinESMExports();
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });

    assert.equal(readSkillSpectorVersion(), '2.13.0');
  });

  it('should explain how to install SkillSpector when it is missing', (t) => {
    t.mock.method(childProcess, 'execFileSync', () => { throw Object.assign(new Error('spawn skillspector ENOENT'), { code: 'ENOENT' }); });
    syncBuiltinESMExports();
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });

    assert.throws(() => readSkillSpectorVersion(), /--scan needs SkillSpector on the PATH - install it with `uv tool install/);
  });
});

describe('holdsUpdate', () => {
  it('should hold an update that adds a HIGH or CRITICAL finding', () => {
    assert.equal(holdsUpdate({ status: 'ok', findings: [finding('SC2', 'SKILL.md', { severity: 'HIGH' })] }), true);
    assert.equal(holdsUpdate({ status: 'ok', findings: [finding('AST8', 'run.py', { severity: 'CRITICAL' })] }), true);
  });

  it('should only list MEDIUM and LOW findings', () => {
    const findings = [finding('E1', 'SKILL.md', { severity: 'MEDIUM' }), finding('SC1', 'SKILL.md', { severity: 'LOW' })];

    assert.equal(holdsUpdate({ status: 'ok', findings }), false);
    assert.equal(holdsUpdate({ status: 'ok', findings: [] }), false);
  });

  it('should hold an update whose scan failed', () => {
    assert.equal(holdsUpdate({ status: 'error', message: 'SkillSpector failed: timed out' }), true);
  });
});
