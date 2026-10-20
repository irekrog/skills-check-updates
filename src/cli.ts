#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs, styleText } from 'node:util';

import { checkSkills } from './check.ts';
import { parseDuration } from './duration.ts';
import { createGitHubClient, resolveGitHubToken } from './github.ts';
import { LOCK_FILE, readLock } from './lock.ts';
import { createProgress } from './progress.ts';
import { formatDetails, formatReport, isPlainUpToDate, pluralize, toJsonReport } from './report.ts';
import { createUpdateScanner, readSkillSpectorVersion } from './scan.ts';
import { selectSkillNames, splitList } from './select.ts';
import { escapeTerminal } from './terminal.ts';
import { isUpgradeTarget, upgradeSkill, type UpgradeOutcome } from './upgrade.ts';
import { openUi } from './ui.ts';

import type { SkillReport } from './check-skill.ts';

const HELP = `Usage: scu [options] [skill...]

Check the skills listed in ${LOCK_FILE} for newer versions upstream.
Without arguments every skill in the lock is checked. Skill names accept * wildcards.

Options:
  -u, --upgrade         Reinstall outdated skills with \`npx skills add\`, merging local
                        changes back in when they do not overlap upstream changes (needs git)
  -f, --force           With --upgrade, overwrite skills that have local changes instead
  -d, --details         Show installed and latest commits, changed files and a compare link
                        (lists up-to-date skills too when skill names are given)
      --skip <pattern>  Leave out matching skills (repeatable, comma separated, * wildcards)
      --from <repo>     Only check skills from this source, e.g. mattpocock/skills or 'vercel-labs/*'
      --min-age <age>   Hold back updates whose latest change is younger than this,
                        e.g. 7 (days), 7d, 12h, 30m
      --scan            Scan updates with SkillSpector (static analysis) and list the findings
                        the new version adds to the installed copy; holds back updates that add
                        HIGH or CRITICAL findings, even with --force; needs skillspector on the PATH
      --exit-code       Exit with 2 when updates are available (0 when none, 1 on errors)
      --json            Print the report as JSON
      --ui              Open an interactive local skill map (offline, project lock only)
      --cwd <dir>       Project directory (default: current directory)
  -h, --help            Show this help
  -v, --version         Show the version

GitHub requests use GITHUB_TOKEN, GH_TOKEN or \`gh auth token\` when available.`;

const EXIT_ERROR = 1;
const EXIT_UPDATES_AVAILABLE = 2;

const OUTCOME_LABELS: Record<UpgradeOutcome, { text: string; color: 'green' | 'yellow' | 'red' }> = {
  updated: { text: 'done', color: 'green' },
  merged: { text: 'done, local changes merged', color: 'green' },
  skipped: { text: 'skipped', color: 'yellow' },
  failed: { text: 'failed', color: 'red' },
};

const readVersion = async (): Promise<string> => {
  const packageJson: unknown = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const hasVersion = typeof packageJson === 'object' && packageJson !== null && 'version' in packageJson;
  return hasVersion ? String(packageJson.version) : 'unknown';
};

type SummaryInput = {
  reports: SkillReport[];
  targets: SkillReport[];
  isUpgrade: boolean;
  isForced: boolean;
  minAge: string | undefined;
  scannerVersion: string | null;
};

const printScanSummary = (reports: SkillReport[], scannerVersion: string): void => {
  const scanned = reports.filter((report) => report.scan?.status === 'ok');
  const withFindings = scanned.filter((report) => report.scan?.status === 'ok' && report.scan.findings.length > 0);
  const heldCount = reports.filter((report) => report.heldByScan).length;
  const result = withFindings.length > 0
    ? `new findings in ${pluralize(withFindings.length, 'update')} - review them`
    : `no new findings in ${pluralize(scanned.length, 'update')}`;
  console.log(`Scan (SkillSpector ${escapeTerminal(scannerVersion)}, static analysis): ${result}.`);
  if (heldCount > 0) {
    const reason = `${pluralize(heldCount, 'update')} held back by a HIGH or CRITICAL finding or a failed scan`;
    console.log(`${styleText('red', reason)} - to install one anyway, run ${styleText('cyan', 'scu -u <skill>')} without --scan.`);
  }
};

const printSummary = ({ reports, targets, isUpgrade, isForced, minAge, scannerVersion }: SummaryInput): void => {
  const upToDateCount = reports.filter(isPlainUpToDate).length;
  const withLocalChanges = reports.filter((report) => report.status === 'modified' || report.status === 'conflict');
  const heldCount = reports.filter((report) => report.heldUntil).length;

  console.log();
  console.log(styleText('green', `${pluralize(upToDateCount, 'skill')} up to date.`));
  if (!isUpgrade && targets.length > 0) {
    console.log(`Run ${styleText('cyan', 'scu -u')} to update ${pluralize(targets.length, 'skill')}.`);
  }
  if (heldCount > 0) {
    console.log(`${pluralize(heldCount, 'update')} held back - the latest change is younger than ${escapeTerminal(minAge ?? '')}.`);
  }
  if (!isForced && withLocalChanges.length > 0) {
    console.log(`Local changes in ${pluralize(withLocalChanges.length, 'skill')} are kept - add --force to overwrite.`);
  }
  if (scannerVersion !== null) printScanSummary(reports, scannerVersion);
};

type UpgradeInput = {
  cwd: string;
  targets: SkillReport[];
  isForced: boolean;
  stream: Pick<NodeJS.WriteStream, 'write'>;
};

const runUpgrade = async ({ cwd, targets, isForced, stream }: UpgradeInput): Promise<boolean> => {
  let isAllSuccessful = true;
  stream.write('\n');
  for (const report of targets) {
    stream.write(`Updating ${escapeTerminal(report.name)}... `);
    const { outcome, output } = await upgradeSkill(cwd, report, isForced);
    const label = OUTCOME_LABELS[outcome];
    stream.write(`${styleText(label.color, label.text)}\n`);
    if (outcome === 'skipped' || outcome === 'failed') {
      isAllSuccessful = false;
      stream.write(`${styleText('dim', escapeTerminal(output))}\n`);
    }
  }
  return isAllSuccessful;
};

const main = async (): Promise<void> => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      upgrade: { type: 'boolean', short: 'u', default: false },
      force: { type: 'boolean', short: 'f', default: false },
      details: { type: 'boolean', short: 'd', default: false },
      skip: { type: 'string', multiple: true, default: [] },
      from: { type: 'string', multiple: true, default: [] },
      'min-age': { type: 'string' },
      scan: { type: 'boolean', default: false },
      'exit-code': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      ui: { type: 'boolean', default: false },
      cwd: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  });

  if (values.help) {
    console.log(HELP);
    return;
  }
  if (values.version) {
    console.log(await readVersion());
    return;
  }
  if (values.ui && (values.upgrade || values.force || values.details || values.json || values['min-age'] !== undefined || values['exit-code'] || values.scan)) {
    throw new Error('--ui is an offline skill map; use it separately from update and report options');
  }

  const cwd = resolve(values.cwd ?? process.cwd());
  const minAge = values['min-age'] === undefined ? 0 : parseDuration(values['min-age']);
  const lock = await readLock(cwd);
  const hasExplicitNames = positionals.length > 0;
  const names = selectSkillNames(lock, {
    only: positionals,
    skip: splitList(values.skip),
    from: splitList(values.from),
  });
  if (values.ui) {
    await openUi(cwd, lock, names);
    return;
  }
  const scannerVersion = values.scan ? readSkillSpectorVersion() : null;
  const progress = values.json ? null : createProgress(`Checking ${LOCK_FILE}`, names.length);
  const client = createGitHubClient(resolveGitHubToken());
  const reports = await checkSkills({
    cwd,
    lock,
    names,
    client,
    withDetails: values.details,
    withMerge: values.upgrade && !values.force,
    minAge,
    scanUpdate: values.scan ? createUpdateScanner() : undefined,
    onSkillChecked: (report) => progress?.tick(report.name),
  });
  progress?.done();
  const targets = reports.filter((report) => isUpgradeTarget(report, values.force));
  const hasErrors = reports.some((report) => report.status === 'error' || report.scan?.status === 'error');

  if (values.json) {
    console.log(JSON.stringify(reports.map(toJsonReport), null, 2).replace(/[\x7f-\x9f\u2028\u2029]/g, escapeTerminal));
  } else {
    const lines = values.details ? formatDetails(reports, hasExplicitNames) : formatReport(reports);
    console.log();
    for (const line of lines) console.log(line);
    printSummary({ reports, targets, isUpgrade: values.upgrade, isForced: values.force, minAge: values['min-age'], scannerVersion });
  }

  const stream = values.json ? process.stderr : process.stdout;
  const isUpgradeSuccessful = values.upgrade ? await runUpgrade({ cwd, targets, isForced: values.force, stream }) : true;
  // Why: like an overlapping merge, an update held by the scan needs a person to look at it.
  const hasScanHolds = values.upgrade && reports.some((report) => report.heldByScan);
  if (hasErrors || !isUpgradeSuccessful || hasScanHolds) {
    process.exitCode = EXIT_ERROR;
  } else if (values['exit-code'] && !values.upgrade && targets.length > 0) {
    process.exitCode = EXIT_UPDATES_AVAILABLE;
  }
};

main().catch((error: unknown) => {
  console.error(styleText('red', escapeTerminal(error instanceof Error ? error.message : String(error))));
  process.exitCode = EXIT_ERROR;
});
