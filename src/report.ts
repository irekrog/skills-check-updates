import { styleText } from 'node:util';

import { HISTORY_DEPTH } from './check.ts';
import { escapeTerminal } from './terminal.ts';

import type { SkillDetails, SkillReport, SkillStatus } from './check-skill.ts';
import type { CommitInfo } from './github.ts';
import type { ScanFinding, UpdateScan } from './scan.ts';
import type { FileChange } from './skill-files.ts';

type Color = Parameters<typeof styleText>[0];
type Label = { text: string; color: Color };

const STATUS_LABELS: Record<SkillStatus, Label> = {
  'up-to-date': { text: 'up to date', color: 'green' },
  outdated: { text: 'update available', color: 'yellow' },
  modified: { text: 'local changes', color: 'magenta' },
  conflict: { text: 'local changes + update available', color: 'red' },
  'not-installed': { text: 'not installed', color: 'yellow' },
  'not-found': { text: 'not found upstream', color: 'red' },
  unsupported: { text: 'unsupported source', color: 'gray' },
  error: { text: 'error', color: 'red' },
};

const STALE_PATH_LABEL: Label = { text: 'up to date, lock needs skillPath', color: 'cyan' };

const CHANGE_MARKS: Record<FileChange['change'], Label> = {
  added: { text: '+', color: 'green' },
  modified: { text: '~', color: 'yellow' },
  removed: { text: '-', color: 'red' },
};

const SEVERITY_COLORS: Record<string, Color> = { CRITICAL: 'red', HIGH: 'red', MEDIUM: 'yellow', LOW: 'gray' };

const SHORT_SHA_LENGTH = 7;
const SHORT_HASH_LENGTH = 12;
const DATE_LENGTH = 10;
const MAX_MESSAGE_LENGTH = 60;
const MAX_LISTED_CHANGES = 10;
const MAX_LISTED_FINDINGS = 10;
const MAX_MATCH_LENGTH = 60;
const SEVERITY_WIDTH = 8;
const RULE_WIDTH = 5;
const FIELD_INDENT = '     ';
const FIELD_WIDTH = 10;

export const pluralize = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

// Why: merged file contents and the expected install hash are only needed by --upgrade,
// the JSON report lists the merged paths.
export const toJsonReport = ({ merge, latestHash: _latestHash, ...report }: SkillReport) => {
  if (!merge) return report;
  return { ...report, merge: merge.status === 'clean' ? { status: merge.status, files: merge.files.map((file) => file.path) } : merge };
};

export const isPlainUpToDate = (report: SkillReport): boolean =>
  report.status === 'up-to-date' && !report.hasStalePath;

const getLabel = (report: SkillReport): Label => {
  if (report.heldUntil) {
    return { text: `${STATUS_LABELS[report.status].text}, held until ${escapeTerminal(report.heldUntil.slice(0, DATE_LENGTH))}`, color: 'gray' };
  }
  return report.status === 'up-to-date' && report.hasStalePath ? STALE_PATH_LABEL : STATUS_LABELS[report.status];
};

const byName = (a: SkillReport, b: SkillReport): number => a.name.localeCompare(b.name);

export const formatReport = (reports: SkillReport[]): string[] => {
  const rows = reports
    .filter((report) => !isPlainUpToDate(report))
    .sort(byName)
    .map((report) => ({
      name: escapeTerminal(report.name),
      label: getLabel(report),
      detail: escapeTerminal(report.message ?? report.url ?? ''),
      scan: report.scan,
    }));
  const nameWidth = Math.max(0, ...rows.map((row) => row.name.length));
  const labelWidth = Math.max(0, ...rows.map((row) => row.label.text.length));

  return rows.flatMap(({ name, label, detail, scan }) => {
    const status = styleText(label.color, label.text.padEnd(labelWidth));
    return [` ${name.padEnd(nameWidth)}  ${status}  ${styleText('dim', detail)}`, ...(scan ? formatScan(scan) : [])];
  });
};

const truncate = (text: string, maxLength: number): string =>
  text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;

const field = (name: string, value: string): string => `${FIELD_INDENT}${styleText('dim', name.padEnd(FIELD_WIDTH))} ${value}`;

const formatFinding = ({ id, severity, pattern, file, line, match }: ScanFinding): string => {
  const location = file === null ? '-' : `${file}${line === null ? '' : `:${line}`}`;
  const text = match === null ? '' : `  ${styleText('dim', escapeTerminal(truncate(match.replace(/\s+/g, ' ').trim(), MAX_MATCH_LENGTH)))}`;
  const label = styleText(SEVERITY_COLORS[severity] ?? 'yellow', escapeTerminal(severity).padEnd(SEVERITY_WIDTH));
  return `${label} ${escapeTerminal(id).padEnd(RULE_WIDTH)} ${escapeTerminal(location)}  ${escapeTerminal(pattern ?? '')}${text}`;
};

const formatScan = (scan: UpdateScan): string[] => {
  if (scan.status === 'error') return [field('scan', styleText('red', `failed: ${escapeTerminal(scan.message)}`))];
  const { findings } = scan;
  if (findings.length === 0) return [field('scan', styleText('green', 'no new findings'))];
  const listed = findings.slice(0, MAX_LISTED_FINDINGS).map(formatFinding);
  const hiddenCount = findings.length - listed.length;
  return [
    field('scan', styleText('red', pluralize(findings.length, 'new finding'))),
    ...listed.map((line) => field('', line)),
    ...(hiddenCount > 0 ? [field('', styleText('dim', `and ${hiddenCount} more`))] : []),
  ];
};

const formatCommit = (commit: CommitInfo | null): string => {
  if (!commit) return styleText('dim', `not found in the last ${HISTORY_DEPTH} upstream commits`);
  const sha = styleText('yellow', escapeTerminal(commit.sha.slice(0, SHORT_SHA_LENGTH)));
  return `${sha}  ${escapeTerminal(commit.date.slice(0, DATE_LENGTH))}  ${escapeTerminal(truncate(commit.message, MAX_MESSAGE_LENGTH))}`;
};

const formatTransition = (from: string, to: string): string => (from === to ? from : `${from} → ${to}`);

const formatChanges = (changes: FileChange[]): string[] => {
  const listed = changes.slice(0, MAX_LISTED_CHANGES).map(({ path, change }) => {
    const mark = CHANGE_MARKS[change];
    return `${styleText(mark.color, mark.text)} ${escapeTerminal(path)}`;
  });
  const hiddenCount = changes.length - listed.length;
  const lines = hiddenCount > 0 ? [...listed, styleText('dim', `and ${hiddenCount} more`)] : listed;
  return lines.map((line, index) => field(index === 0 ? 'changes' : '', line));
};

const formatDetailFields = (details: SkillDetails): string[] => {
  const { installed, latest, commitsBehind, changedFiles, compareUrl } = details;
  const hasVersion = installed.version !== null || latest.version !== null;
  const hash = formatTransition(escapeTerminal(installed.hash.slice(0, SHORT_HASH_LENGTH)), escapeTerminal(latest.hash.slice(0, SHORT_HASH_LENGTH)));

  return [
    field('installed', formatCommit(installed.commit)),
    field('latest', formatCommit(latest.commit)),
    ...(commitsBehind ? [field('behind', pluralize(commitsBehind, 'commit'))] : []),
    ...(hasVersion ? [field('version', formatTransition(escapeTerminal(installed.version ?? '-'), escapeTerminal(latest.version ?? '-')))] : []),
    field('hash', hash),
    ...formatChanges(changedFiles),
    ...(compareUrl ? [field('compare', escapeTerminal(compareUrl))] : []),
  ];
};

const formatSkillDetails = (report: SkillReport): string[] => {
  const label = getLabel(report);
  return [
    ` ${styleText('bold', escapeTerminal(report.name))}  ${styleText(label.color, label.text)}`,
    ...(report.details ? formatDetailFields(report.details) : []),
    ...(report.removedIn ? [field('removed', formatCommit(report.removedIn))] : []),
    ...(report.message ? [field('message', escapeTerminal(report.message))] : []),
    ...(report.url ? [field('source', escapeTerminal(report.url))] : []),
    ...(report.scan ? formatScan(report.scan) : []),
  ];
};

export const formatDetails = (reports: SkillReport[], isShowingAll: boolean): string[] =>
  reports
    .filter((report) => isShowingAll || !isPlainUpToDate(report))
    .sort(byName)
    .flatMap((report, index) => [...(index > 0 ? [''] : []), ...formatSkillDetails(report)]);
