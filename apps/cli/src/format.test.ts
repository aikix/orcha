import { describe, test, expect } from 'bun:test';
import { isBotCommit } from './format.js';

describe('isBotCommit', () => {
  test('detects renovate bot', () => {
    expect(isBotCommit('renovate[bot]', 'chore(deps): update dependency')).toBe(true);
    expect(isBotCommit('renovate', 'Update dependency express to v5')).toBe(true);
  });

  test('detects dependabot', () => {
    expect(isBotCommit('dependabot[bot]', 'Bump express from 4.18 to 4.19')).toBe(true);
  });

  test('detects bot-like subjects', () => {
    expect(isBotCommit('ci-bot', 'chore(deps): update dependency')).toBe(true);
    expect(isBotCommit('someone', 'bump lodash to 4.17.21')).toBe(true);
    expect(isBotCommit('someone', 'fix(deps): update dependency x')).toBe(true);
  });

  test('does not flag human commits', () => {
    expect(isBotCommit('alice', 'fix: handle null dates in detail page')).toBe(false);
    expect(isBotCommit('bob', 'feat: add user profile component')).toBe(false);
    expect(isBotCommit('carol', 'refactor auth middleware')).toBe(false);
  });
});
