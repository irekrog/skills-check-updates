export const assertSkillName = (name: string): void => {
  // Spaces and colons occur in frontmatter names; flags and path separators must not.
  if (!/^[A-Za-z0-9]/.test(name) || /[^A-Za-z0-9._ :_-]/.test(name)) {
    throw new Error('invalid skill name: use letters, digits, spaces, dots, underscores, colons or hyphens, starting with a letter or digit');
  }
};

// Keep in sync with sanitizeName in vercel-labs/skills/src/installer.ts.
export const sanitizeName = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9._]+/g, '-').replace(/^[.\-]+|[.\-]+$/g, '').slice(0, 255) || 'unnamed-skill';
