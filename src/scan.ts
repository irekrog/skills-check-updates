import { execFile, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { isInside } from './install-paths.ts';

import type { SkillFile } from './hash.ts';

export type ScanFinding = {
  id: string;
  severity: string;
  pattern: string | null;
  file: string | null;
  line: number | null;
  match: string | null;
};

// Note: `findings` lists only what the upstream version adds to the installed copy.
export type UpdateScan = { status: 'ok'; findings: ScanFinding[] } | { status: 'error'; message: string };

export type ScanUpdate = (installed: SkillFile[], upstream: SkillFile[]) => Promise<UpdateScan>;

const SKILLSPECTOR = 'skillspector';
const INSTALL_HINT = 'uv tool install git+https://github.com/NVIDIA/skillspector.git@v2.13.0';
const VERSION_TIMEOUT_MS = 30_000;
const SCAN_TIMEOUT_MS = 5 * 60_000;
const MAX_REPORT_BYTES = 64 * 1024 * 1024;
const MAX_ERROR_LENGTH = 200;
// Why: AE1 marks a referenced file the static analyzer could not parse completely - it
// describes the scanner's coverage, not the skill, and long documentation triggers it.
const IGNORED_RULES = new Set(['AE1']);
const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
// Why: lower severities fire on many harmless updates of popular skills, so they are
// listed for review but do not hold an update back.
const HOLDING_SEVERITIES = new Set(['CRITICAL', 'HIGH']);

export const readSkillSpectorVersion = (): string => {
  let output: string;
  try {
    output = execFileSync(SKILLSPECTOR, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: VERSION_TIMEOUT_MS });
  } catch {
    throw new Error(`--scan needs SkillSpector on the PATH - install it with \`${INSTALL_HINT}\``);
  }
  return /\d+\.\d+\.\d+\S*/.exec(output)?.[0] ?? 'unknown';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export const parseFindings = (report: unknown): ScanFinding[] => {
  if (!isRecord(report) || !Array.isArray(report.issues)) throw new Error('unexpected SkillSpector report: no issues list');
  return report.issues.map((issue: unknown) => {
    if (!isRecord(issue) || typeof issue.id !== 'string' || typeof issue.severity !== 'string') {
      throw new Error('unexpected SkillSpector report: an issue has no id or severity');
    }
    const location = isRecord(issue.location) ? issue.location : {};
    return {
      id: issue.id,
      severity: issue.severity,
      pattern: asString(issue.pattern),
      file: asString(location.file),
      line: typeof location.start_line === 'number' ? location.start_line : null,
      match: asString(issue.finding),
    };
  });
};

const severityRank = (finding: ScanFinding): number => {
  const index = SEVERITY_ORDER.indexOf(finding.severity);
  return index === -1 ? SEVERITY_ORDER.length : index;
};

const bySeverity = (a: ScanFinding, b: ScanFinding): number =>
  severityRank(a) - severityRank(b) || (a.file ?? '').localeCompare(b.file ?? '') || (a.line ?? 0) - (b.line ?? 0);

const findingKey = (finding: ScanFinding): string => JSON.stringify([finding.id, finding.file]);

// Why: any edit above a finding shifts its line, so findings are matched by rule and file,
// and only the surplus of a rule in a file counts as new.
export const newFindings = (before: ScanFinding[], after: ScanFinding[]): ScanFinding[] => {
  const remaining = new Map<string, number>();
  for (const finding of before) remaining.set(findingKey(finding), (remaining.get(findingKey(finding)) ?? 0) + 1);
  return after
    .filter((finding) => {
      if (IGNORED_RULES.has(finding.id)) return false;
      const count = remaining.get(findingKey(finding)) ?? 0;
      if (count === 0) return true;
      remaining.set(findingKey(finding), count - 1);
      return false;
    })
    .sort(bySeverity);
};

// Note: a failed scan holds the update too - it was asked for and did not happen.
export const holdsUpdate = (scan: UpdateScan): boolean =>
  scan.status === 'error' || scan.findings.some((finding) => HOLDING_SEVERITIES.has(finding.severity));

const writeSkill = async (dir: string, files: SkillFile[]): Promise<void> => {
  for (const file of files) {
    const target = resolve(dir, file.path);
    if (!isInside(dir, target) || target === dir) throw new Error(`unsafe skill file path: ${file.path}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
};

const firstLine = (text: string): string => (text.trim().split('\n')[0] ?? '').slice(0, MAX_ERROR_LENGTH);

const runSkillSpector = (dir: string): Promise<unknown> =>
  new Promise((resolveReport, reject) => {
    const options = { encoding: 'utf8' as const, maxBuffer: MAX_REPORT_BYTES, timeout: SCAN_TIMEOUT_MS };
    execFile(SKILLSPECTOR, ['scan', dir, '--no-llm', '--format', 'json'], options, (error, stdout, stderr) => {
      // Why: exit code 1 only means the risk score passed SkillSpector's own threshold.
      if (error && error.code !== 1) {
        const cause = error.killed ? 'timed out' : firstLine(stderr) || firstLine(stdout) || error.message;
        reject(new Error(`SkillSpector failed: ${cause}`));
        return;
      }
      try {
        resolveReport(JSON.parse(stdout));
      } catch {
        reject(new Error('SkillSpector did not print a JSON report'));
      }
    });
  });

const scanFiles = async (files: SkillFile[]): Promise<ScanFinding[]> => {
  const dir = await mkdtemp(join(tmpdir(), 'scu-scan-'));
  try {
    await writeSkill(dir, files);
    return parseFindings(await runSkillSpector(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const createLimiter = (limit: number) => {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < limit) active += 1;
    else await new Promise<void>((start) => waiting.push(start));
    try {
      return await task();
    } finally {
      // Why: hand the slot straight to the next task, so a new caller cannot take it in between.
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
};

const scanError = (error: unknown): UpdateScan => ({ status: 'error', message: error instanceof Error ? error.message : String(error) });

export const createUpdateScanner = (concurrency = Math.max(1, Math.floor(availableParallelism() / 2))): ScanUpdate => {
  const limit = createLimiter(concurrency);
  return async (installed, upstream) => {
    // Why: wait for both scans, so no scanner keeps running or leaves a temporary folder behind.
    const [before, after] = await Promise.allSettled([limit(() => scanFiles(installed)), limit(() => scanFiles(upstream))]);
    if (before.status === 'rejected') return scanError(before.reason);
    if (after.status === 'rejected') return scanError(after.reason);
    return { status: 'ok', findings: newFindings(before.value, after.value) };
  };
};
