import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type RepoInfo = {
  readonly name: string;
  readonly description: string | null;
  readonly language: string | null;
  readonly archived: boolean;
  readonly fork: boolean;
  readonly pushedAt: string;
  readonly defaultBranch: string;
  readonly cloneUrl: string;
};

export type OrgUrl = {
  readonly host: string;
  readonly org: string;
};

/**
 * Parse a GitHub org URL into host + org.
 *
 * Supports:
 * - https://github.com/my-org
 * - https://git.example.com/my-team
 * - github.com/my-org
 * - git.example.com/my-team
 */
export const parseOrgUrl = (url: string): OrgUrl => {
  const cleaned = url.replace(/\/+$/, '');
  const withProtocol = cleaned.startsWith('http') ? cleaned : `https://${cleaned}`;

  const parsed = new URL(withProtocol);
  const org = parsed.pathname.replace(/^\//, '').split('/')[0];

  if (!org) {
    throw new Error(`Could not extract org name from URL: ${url}`);
  }

  return { host: parsed.hostname, org };
};

/**
 * List all repos in a GitHub org using `gh api`.
 * Filters out archived repos and forks by default.
 */
export const listOrgRepos = async (
  orgUrl: OrgUrl,
  options: { includeArchived?: boolean; includeForks?: boolean } = {},
): Promise<RepoInfo[]> => {
  const { host, org } = orgUrl;
  const isGitHubCom = host === 'github.com';

  const args = [
    'api',
    `/orgs/${org}/repos`,
    '--paginate',
    ...(isGitHubCom ? [] : ['--hostname', host]),
    '--jq',
    '.[] | {name, description, language, archived, fork, pushed_at, default_branch, clone_url}',
  ];

  const { stdout } = await execFileAsync('gh', args, { timeout: 60_000 });

  const repos: RepoInfo[] = stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const raw = JSON.parse(line) as {
        name: string;
        description: string | null;
        language: string | null;
        archived: boolean;
        fork: boolean;
        pushed_at: string;
        default_branch: string;
        clone_url: string;
      };
      return {
        name: raw.name,
        description: raw.description,
        language: raw.language,
        archived: raw.archived,
        fork: raw.fork,
        pushedAt: raw.pushed_at,
        defaultBranch: raw.default_branch,
        cloneUrl: raw.clone_url,
      };
    });

  return repos.filter((repo) => {
    if (!options.includeArchived && repo.archived) return false;
    if (!options.includeForks && repo.fork) return false;
    return true;
  });
};
