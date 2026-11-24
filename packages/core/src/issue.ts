/** Prefilled GitHub new-issue URLs and issue links (docs/spec/integrations.md#github-issues). Pure: opening the URL is the person's. */
import { scanSecrets } from '@indx-watch/bundle';

export const FAILURE_TEMPLATE = 'indx-watch-test-failure.yml';
/** Longest URL we build; GitHub answers 414 above its (undocumented) limit, and browsers and proxies stop earlier. */
export const ISSUE_URL_MAX = 6000;

export interface IssueInput {
  /** `owner/name` */
  repo: string;
  title: string;
  /** TC-n, AC-n.m, UC-n shown in the keys field */
  keys: string[];
  priority?: string | undefined;
  steps?: string | undefined;
  expected?: string | undefined;
  actual?: string | undefined;
  /** link to the run in the app, or the run ID */
  run?: string | undefined;
  commit?: string | undefined;
  environment?: string | undefined;
  /** values that must never leave: account usernames, secret references and their field values */
  redact?: string[] | undefined;
}
export interface IssueLink {
  url: string;
  /** fields that were shortened or left out to keep the URL short */
  trimmed: string[];
  /** fields left out because they looked like a secret */
  secrets: string[];
}

const LONG = ['actual', 'expected', 'steps'] as const;
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1))}…`);

/** The prefilled new-issue URL of the failure form: fields that look like secrets are dropped, the rest is shortened to fit. */
export function issueUrl(i: IssueInput): IssueLink {
  const secrets: string[] = [];
  const clean = (name: string, v: string | undefined) => {
    let t = (v ?? '').trim();
    for (const r of i.redact ?? []) if (r.length >= 3) t = t.split(r).join('[redacted]');
    if (t && scanSecrets(name, t).length) {
      secrets.push(name);
      return '';
    }
    return t;
  };
  const f: Record<string, string> = {
    keys: clean('keys', [...i.keys, i.priority].filter(Boolean).join(', ')),
    steps: clean('steps', i.steps),
    expected: clean('expected', i.expected),
    actual: clean('actual', i.actual),
    run: clean('run', i.run),
    commit: clean('commit', i.commit),
    environment: clean('environment', i.environment),
  };
  const title = clean('title', i.title);
  const build = () => {
    const q = new URLSearchParams({ template: FAILURE_TEMPLATE, title });
    for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
    return `https://github.com/${i.repo}/issues/new?${q.toString().replaceAll('+', '%20')}`;
  };
  const trimmed: string[] = [];
  for (const k of LONG) {
    // halve the longest field until the URL fits; essentials (keys, run, commit, environment) stay
    while (build().length > ISSUE_URL_MAX && f[k]!.length > 40) {
      f[k] = clip(f[k]!, Math.floor(f[k]!.length / 2));
      if (!trimmed.includes(k)) trimmed.push(k);
    }
  }
  for (const k of LONG)
    if (build().length > ISSUE_URL_MAX && f[k]) {
      f[k] = '';
      if (!trimmed.includes(k)) trimmed.push(k);
    }
  return { url: build(), trimmed, secrets };
}

/** `owner/name` of a GitHub remote (`git@github.com:o/n.git`, `https://github.com/o/n`), else undefined. */
export function repoOfRemote(remote: string | null | undefined): string | undefined {
  return /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/
    .exec(remote?.trim() ?? '')
    ?.slice(1, 3)
    .join('/');
}

/** The repository and number of a GitHub issue URL. */
export function parseIssueUrl(url: string): { repo: string; number: number } | undefined {
  const m = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)\/?(?:[?#].*)?$/.exec(url.trim());
  return m ? { repo: m[1]!, number: Number(m[2]) } : undefined;
}
