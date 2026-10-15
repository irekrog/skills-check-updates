import { checkSkill, type SkillReport } from './check-skill.ts';
import { readInstalledSkill } from './local-files.ts';
import { assertSkillName } from './skill-name.ts';
import { buildRepoUrl, getGitHubRepo } from './source.ts';

import type { GitHubClient, TreeEntry } from './github.ts';
import type { SkillsLock } from './lock.ts';

type CheckSkillsInput = {
  cwd: string;
  lock: SkillsLock;
  names: string[];
  client: GitHubClient;
  withDetails?: boolean;
  minAge?: number;
  onSkillChecked?: (report: SkillReport) => void;
};

const DEFAULT_REF = 'HEAD';
export const HISTORY_DEPTH = 20;

export const checkSkills = async ({
  cwd,
  lock,
  names,
  client,
  withDetails = false,
  minAge = 0,
  onSkillChecked,
}: CheckSkillsInput): Promise<SkillReport[]> => {
  const now = Date.now();
  const trees = new Map<string, Promise<TreeEntry[]>>();
  const getTree = (repo: string, ref: string): Promise<TreeEntry[]> => {
    const key = `${repo}#${ref}`;
    const cached = trees.get(key);
    if (cached) return cached;
    const tree = client.fetchTree(repo, ref);
    trees.set(key, tree);
    return tree;
  };

  const checkOne = async (name: string): Promise<SkillReport> => {
    try {
      assertSkillName(name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { name, status: 'error', installSource: null, url: null, hasStalePath: false, message };
    }
    const entry = lock.skills[name];
    const hasStalePath = !entry?.skillPath;
    if (!entry) {
      return { name, status: 'error', installSource: null, url: null, hasStalePath, message: 'not in skills-lock.json' };
    }

    const repo = getGitHubRepo(entry);
    if (!repo) {
      const message = `${entry.sourceType} sources are not supported yet`;
      return { name, status: 'unsupported', installSource: null, url: null, hasStalePath, message };
    }

    const ref = entry.ref ?? DEFAULT_REF;
    try {
      const [tree, localFiles] = await Promise.all([getTree(repo, ref), readInstalledSkill(cwd, name)]);
      const readRemoteFile = (treeEntry: TreeEntry) => client.fetchFile(repo, ref, treeEntry);
      const history = {
        commits: (folder: string) => client.fetchCommits(repo, ref, folder, HISTORY_DEPTH),
        folderTree: (commit: string, folder: string) => client.fetchFolderTree(repo, commit, folder),
      };
      return await checkSkill({ name, repo, entry, localFiles, tree, readRemoteFile, history, withDetails, minAge, now });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { name, status: 'error', installSource: null, url: buildRepoUrl(repo, entry.ref), hasStalePath, message };
    }
  };

  return Promise.all(
    names.map(async (name) => {
      const report = await checkOne(name);
      onSkillChecked?.(report);
      return report;
    }),
  );
};
