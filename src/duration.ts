const DAY_MS = 86_400_000;
const UNIT_MS: Record<string, number> = { d: DAY_MS, h: 3_600_000, m: 60_000 };
const DURATION = /^(\d+(?:\.\d+)?)([dhm])?$/;

export const parseDuration = (value: string): number => {
  const match = value.trim().match(DURATION);
  if (!match) throw new Error(`Invalid duration "${value}" - use days (7) or a value like 7d, 12h, 30m`);
  return Number(match[1]) * (UNIT_MS[match[2] ?? 'd'] ?? DAY_MS);
};
