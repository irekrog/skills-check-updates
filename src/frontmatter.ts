const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const NAME_LINE = /^name:\s*["']?(.+?)["']?\s*$/m;
// Why: skills that declare a version usually nest it under `metadata:`.
const VERSION_LINE = /^\s*version:\s*["']?(.+?)["']?\s*$/m;

const readField = (markdown: string, pattern: RegExp): string | null =>
  markdown.match(FRONTMATTER)?.[1]?.match(pattern)?.[1] ?? null;

export const readFrontmatterName = (markdown: string): string | null => readField(markdown, NAME_LINE);

export const readFrontmatterVersion = (markdown: string): string | null => readField(markdown, VERSION_LINE);
