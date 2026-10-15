import type { TreeEntry } from './github.ts';

export type FileSha = {
  path: string;
  sha: string;
};

export type FileChange = {
  path: string;
  change: 'added' | 'modified' | 'removed';
};

const SYMLINK_MODE = '120000';
// Note: `skills add` hashes the source folder, then copies it without these.
const INSTALL_SKIPPED_FILES = new Set(['metadata.json']);
const INSTALL_SKIPPED_DIRS = new Set(['.git', '__pycache__', '__pypackages__']);

export const isInstalledByCli = (path: string): boolean => {
  const parts = path.split('/');
  const fileName = parts.at(-1) ?? '';
  return !INSTALL_SKIPPED_FILES.has(fileName) && parts.slice(0, -1).every((part) => !INSTALL_SKIPPED_DIRS.has(part));
};

export const isHashedByCli = (entry: TreeEntry, prefix: string): boolean =>
  entry.type === 'blob' &&
  entry.mode !== SYMLINK_MODE &&
  entry.path.startsWith(prefix) &&
  !entry.path.slice(prefix.length).split('/').includes('node_modules');

export const listHashedFiles = (tree: TreeEntry[], prefix: string): FileSha[] =>
  tree
    .filter((entry) => isHashedByCli(entry, prefix))
    .map((entry) => ({ path: entry.path.slice(prefix.length), sha: entry.sha }));

export const toSignature = (files: FileSha[]): string =>
  files
    .map(({ path, sha }) => `${path}:${sha}`)
    .sort()
    .join('\n');

// Why: older CLI versions copied metadata.json too, so an unedited local copy can
// hold either the full folder or the subset the current installer copies.
export const treeSignatures = (files: FileSha[]): string[] => [
  toSignature(files),
  toSignature(files.filter((file) => isInstalledByCli(file.path))),
];

export const diffFiles = (local: FileSha[], upstream: FileSha[]): FileChange[] => {
  const localShas = new Map(local.map((file) => [file.path, file.sha]));
  const upstreamPaths = new Set(upstream.map((file) => file.path));
  const added = upstream.filter((file) => !localShas.has(file.path) && isInstalledByCli(file.path));
  const modified = upstream.filter((file) => localShas.has(file.path) && localShas.get(file.path) !== file.sha);
  const removed = local.filter((file) => !upstreamPaths.has(file.path));

  return [
    ...added.map(({ path }) => ({ path, change: 'added' as const })),
    ...modified.map(({ path }) => ({ path, change: 'modified' as const })),
    ...removed.map(({ path }) => ({ path, change: 'removed' as const })),
  ].sort((a, b) => a.path.localeCompare(b.path));
};
