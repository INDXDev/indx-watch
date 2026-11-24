/** Reading GitHub issues (docs/spec/integrations.md#github-issues): the REST adapter of `IssueSource`. Read-only: it never writes to GitHub. */
import { type IssueData, type IssueSource, StoreError } from '../ports.js';
import { guardedFetch, httpError, SECURE_URL } from '../util.js';

type Env = Record<string, string | undefined>;

/**
 * `GET /repos/{repo}/issues/{n}`. The token (GITHUB_TOKEN, optional: public repositories need none) is sent only to
 * an https:// base; `f` and `GITHUB_API_URL` replace fetch and the base in tests and on GitHub Enterprise.
 */
export function githubIssueSource(env: Env = {}, f: typeof fetch = fetch): IssueSource {
  const base = (env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, '');
  if (!SECURE_URL.test(base))
    throw new StoreError('invalid', `GITHUB_API_URL must be an https:// URL: ${base}`);
  return {
    async get(repo, number) {
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new StoreError('invalid', `not a repository: ${repo}`);
      const headers: Record<string, string> = {
        accept: 'application/vnd.github+json',
        'user-agent': 'indx-watch',
      };
      if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
      const what = `GitHub ${repo}#${number}`;
      const res = await guardedFetch(what, () =>
        f(`${base}/repos/${repo}/issues/${number}`, { headers, redirect: 'manual' }),
      );
      if (!res.ok) throw httpError(res.status, what);
      const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!j || typeof j.title !== 'string' || typeof j.html_url !== 'string')
        throw new StoreError('invalid', `${what}: unexpected answer`);
      // pull requests share the issue API; they are not issues
      if (j.pull_request) throw new StoreError('invalid', `${what} is a pull request, not an issue`);
      const labels = ((j.labels as unknown[]) ?? []).map((l) =>
        typeof l === 'string' ? l : ((l as { name?: string })?.name ?? ''),
      );
      const out: IssueData = {
        number,
        title: j.title,
        body: typeof j.body === 'string' ? j.body : '',
        labels: labels.filter(Boolean),
        url: j.html_url,
      };
      return out;
    },
  };
}
