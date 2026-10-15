import type { SkillsLock } from './lock.ts';

type SkillSelection = {
  only: string[];
  skip: string[];
  from: string[];
};

const WILDCARD = '*';

const toMatcher = (pattern: string): ((value: string) => boolean) => {
  if (!pattern.includes(WILDCARD)) return (value) => value === pattern;
  const source = pattern
    .split(WILDCARD)
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  const regex = new RegExp(`^${source}$`);
  return (value) => regex.test(value);
};

const matchesAny = (patterns: string[], value: string): boolean =>
  patterns.some((pattern) => toMatcher(pattern)(value));

export const splitList = (values: string[]): string[] =>
  values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);

export const selectSkillNames = (lock: SkillsLock, { only, skip, from }: SkillSelection): string[] => {
  const selected = Object.entries(lock.skills)
    .filter(([name]) => only.length === 0 || matchesAny(only, name))
    .filter(([name]) => !matchesAny(skip, name))
    .filter(([, entry]) => from.length === 0 || matchesAny(from, entry.source))
    .map(([name]) => name);
  // Why: a mistyped exact name should surface as an error row instead of being silently ignored.
  const unknownNames = only.filter((pattern) => !pattern.includes(WILDCARD) && !Object.hasOwn(lock.skills, pattern));
  return [...selected, ...unknownNames];
};
