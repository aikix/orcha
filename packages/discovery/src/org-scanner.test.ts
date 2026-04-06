import { describe, test, expect } from 'bun:test';
import { parseOrgUrl } from './org-scanner.js';

describe('parseOrgUrl', () => {
  test('parses https://github.com/my-org', () => {
    const result = parseOrgUrl('https://github.com/my-org');
    expect(result).toEqual({ host: 'github.com', org: 'my-org' });
  });

  test('parses GHE URL', () => {
    const result = parseOrgUrl('https://git.example.com/my-team');
    expect(result).toEqual({ host: 'git.example.com', org: 'my-team' });
  });

  test('handles URL without protocol', () => {
    const result = parseOrgUrl('github.com/my-org');
    expect(result).toEqual({ host: 'github.com', org: 'my-org' });
  });

  test('strips trailing slashes', () => {
    const result = parseOrgUrl('https://github.com/my-org///');
    expect(result).toEqual({ host: 'github.com', org: 'my-org' });
  });

  test('handles URL with subpath', () => {
    const result = parseOrgUrl('https://github.com/my-org/extra/path');
    expect(result).toEqual({ host: 'github.com', org: 'my-org' });
  });

  test('throws on URL without org', () => {
    expect(() => parseOrgUrl('https://github.com/')).toThrow('Could not extract org name');
  });

  test('throws on bare hostname', () => {
    expect(() => parseOrgUrl('https://github.com')).toThrow('Could not extract org name');
  });
});
