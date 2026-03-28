/**
 * CLI output formatting utilities.
 * Supports NO_COLOR env var and --no-color flag per https://no-color.org/
 */

const hasColor = !process.env.NO_COLOR && !process.argv.includes('--no-color');

const ansi = (code: number) => hasColor ? `\x1b[${code}m` : '';
const reset = ansi(0);

export const c = {
  green: (s: string) => `${ansi(32)}${s}${reset}`,
  red: (s: string) => `${ansi(31)}${s}${reset}`,
  yellow: (s: string) => `${ansi(33)}${s}${reset}`,
  dim: (s: string) => `${ansi(2)}${s}${reset}`,
  bold: (s: string) => `${ansi(1)}${s}${reset}`,
  cyan: (s: string) => `${ansi(36)}${s}${reset}`,
};

/** Format a pass/fail icon */
export const icon = {
  pass: c.green('✓'),
  fail: c.red('✗'),
  warn: c.yellow('⚠'),
  info: c.cyan('●'),
  skip: c.dim('○'),
};

/** Format a summary line like "3/5 healthy | 2 down | 1 no checks" */
export const summaryLine = (parts: string[]): string => {
  return parts.filter(Boolean).join(c.dim(' | '));
};

/** Detect if a commit is from a bot (renovate, dependabot, etc.) */
export const isBotCommit = (author: string, subject: string): boolean => {
  const botAuthors = ['renovate', 'dependabot', 'renovate[bot]', 'dependabot[bot]', 'github-actions', 'sfci', 'snyk-bot'];
  const authorLower = author.toLowerCase();
  if (botAuthors.some((b) => authorLower.includes(b))) return true;
  if (/^(chore|fix)\(deps\)|update dependency|bump /i.test(subject)) return true;
  return false;
};
