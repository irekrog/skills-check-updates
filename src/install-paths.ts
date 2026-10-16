import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

import { sanitizeName } from './skill-name.ts';

export const SKILL_DIRS = ['.agents/skills', '.claude/skills'];

export const isInside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
};

export const assertSafeSkillDirectories = (cwd: string, name: string): void => {
  const root = realpathSync(cwd);
  for (const skillDir of SKILL_DIRS) {
    const parts = [...skillDir.split('/'), sanitizeName(name)];
    for (let index = 0; index < parts.length; index += 1) {
      const path = join(root, ...parts.slice(0, index + 1));
      let info;
      try {
        info = lstatSync(path);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') break;
        throw error;
      }
      // Agent-specific skill symlinks are normal; destination roots must be real directories.
      const isSkillLink = index === parts.length - 1 && info.isSymbolicLink();
      if ((!isSkillLink && !info.isDirectory()) || !isInside(root, realpathSync(path))) {
        throw new Error(`unsafe skill destination: ${path} must be a directory inside the project; destination roots cannot be symlinks`);
      }
    }
  }
};
