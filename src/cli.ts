#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs, styleText } from 'node:util';

import { checkSkills } from './check.ts';
import { parseDuration } from './duration.ts';
import { createGitHubClient, resolveGitHubToken } from './github.ts';
import { LOCK_FILE, readLock } from './lock.ts';
import { createProgress } from './progress.ts';
import { formatDetails, formatReport, isPlainUpToDate, pluralize } from './report.ts';
import { selectSkillNames, splitList } from './select.ts';
import { escapeTerminal } from './terminal.ts';
import { isUpgradeTarget, upgradeSkill } from './upgrade.ts';

import type { SkillReport } from './check-skill.ts';

const HELP = `Usage: scu [options] [skill...]

Check the skills listed in ${LOCK_FILE} for newer versions upstream.
Without arguments every skill in the lock is checked. Skill names accept * wildcards.

Options:
  -u, --upgrade         Reinstall outdated skills with \`npx skills add\`
  -f, --force           With --upgrade, also overwrite skills that have local changes
  -d, --details         Show installed and latest commits, changed files and a compare link
                        (lists up-to-date skills too when skill names are given)
      --skip <pattern>  Leave out matching skills (repeatable, comma separated, * wildcards)
      --from <repo>     Only check skills from this source, e.g. mattpocock/skills or 'vercel-labs/*'
      --min-age <age>   Hold back updates whose latest change is younger than this,
                        e.g. 7 (days), 7d, 12h, 30m
      --exit-code       Exit with 2 when updates are available (0 when none, 1 on errors)
      --json            Print the report as JSON
      --cwd <dir>       Project directory (default: current directory)
  -h, --help            Show this help
  -v, --version         Show the version

GitHub requests use GITHUB_TOKEN, GH_TOKEN or \`gh auth token\` when available.`;

const EXIT_ERROR = 1;
const EXIT_UPDATES_AVAILABLE = 2;

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
};

const printSummary = ({ reports, targets, isUpgrade, isForced, minAge }: SummaryInput): void => {
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
};

const runUpgrade = (cwd: string, targets: SkillReport[], stream: Pick<NodeJS.WriteStream, 'write'> = process.stdout): boolean => {
  let isAllSuccessful = true;
  stream.write('\n');
  for (const { name, installSource } of targets) {
    if (installSource === null) continue;
    stream.write(`Updating ${escapeTerminal(name)}... `);
    const { isSuccess, output } = upgradeSkill(cwd, name, installSource);
    stream.write(`${isSuccess ? styleText('green', 'done') : styleText('red', 'failed')}\n`);
    if (!isSuccess) {
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
      'exit-code': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
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

  const cwd = resolve(values.cwd ?? process.cwd());
  const minAge = values['min-age'] === undefined ? 0 : parseDuration(values['min-age']);
  const lock = await readLock(cwd);
  const hasExplicitNames = positionals.length > 0;
  const names = selectSkillNames(lock, {
    only: positionals,
    skip: splitList(values.skip),
    from: splitList(values.from),
  });
  const progress = values.json ? null : createProgress(`Checking ${LOCK_FILE}`, names.length);
  const client = createGitHubClient(resolveGitHubToken());
  const reports = await checkSkills({
    cwd,
    lock,
    names,
    client,
    withDetails: values.details,
    minAge,
    onSkillChecked: (report) => progress?.tick(report.name),
  });
  progress?.done();
  const targets = reports.filter((report) => isUpgradeTarget(report, values.force));
  const hasErrors = reports.some((report) => report.status === 'error');

  if (values.json) {
    console.log(JSON.stringify(reports, null, 2).replace(/[\x7f-\x9f\u2028\u2029]/g, escapeTerminal));
  } else {
    const lines = values.details ? formatDetails(reports, hasExplicitNames) : formatReport(reports);
    console.log();
    for (const line of lines) console.log(line);
    printSummary({ reports, targets, isUpgrade: values.upgrade, isForced: values.force, minAge: values['min-age'] });
  }

  const isUpgradeSuccessful = values.upgrade ? runUpgrade(cwd, targets, values.json ? process.stderr : process.stdout) : true;
  if (hasErrors || !isUpgradeSuccessful) {
    process.exitCode = EXIT_ERROR;
  } else if (values['exit-code'] && !values.upgrade && targets.length > 0) {
    process.exitCode = EXIT_UPDATES_AVAILABLE;
  }
};

main().catch((error: unknown) => {
  console.error(styleText('red', escapeTerminal(error instanceof Error ? error.message : String(error))));
  process.exitCode = EXIT_ERROR;
});
