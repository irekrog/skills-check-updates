import { posix } from 'node:path';

import { readFrontmatterName } from './frontmatter.ts';

import type { TreeEntry } from './github.ts';

const SKILL_FILE = 'SKILL.md';
const DOWNLOAD_BATCH_SIZE = 8;

const findByFrontmatter = async (
  name: string,
  candidates: TreeEntry[],
  readFile: (entry: TreeEntry) => Promise<Buffer>,
): Promise<string | null> => {
  for (let start = 0; start < candidates.length; start += DOWNLOAD_BATCH_SIZE) {
    const batch = candidates.slice(start, start + DOWNLOAD_BATCH_SIZE);
    const names = await Promise.all(
      batch.map(async (entry) => readFrontmatterName((await readFile(entry)).toString('utf8'))),
    );
    const match = batch[names.indexOf(name)];
    if (match) return match.path;
  }
  return null;
};

export const findSkillPath = async (
  name: string,
  tree: TreeEntry[],
  readFile: (entry: TreeEntry) => Promise<Buffer>,
): Promise<string | null> => {
  // Why: repos often ship build copies of a skill deeper in the tree (dist/plugins/...),
  // and the shallowest copy is the canonical one.
  const skillFiles = tree
    .filter((entry) => entry.type === 'blob' && posix.basename(entry.path) === SKILL_FILE)
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  const isNamedFolder = (entry: TreeEntry) => posix.basename(posix.dirname(entry.path)) === name;
  // Why: the folder name usually matches the skill name, so checking those first
  // avoids downloading every SKILL.md in repos that host hundreds of skills.
  const fromNamedFolder = await findByFrontmatter(name, skillFiles.filter(isNamedFolder), readFile);
  return fromNamedFolder ?? findByFrontmatter(name, skillFiles.filter((entry) => !isNamedFolder(entry)), readFile);
};
