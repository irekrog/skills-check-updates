// Escape untrusted text before adding our own terminal styling or line breaks.
export const escapeTerminal = (text: string): string =>
  text.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, (char) =>
    `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
