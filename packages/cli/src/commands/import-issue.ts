/** `iw import github-issue <number|URL>`: one GitHub issue as one draft use case (docs/spec/cli.md#iw-import-github-issue-numberurl). */
import * as iwb from '@indx-watch/bundle';
import { parseIssueUrl } from '@indx-watch/core';
import { githubIssueSource, type IssueData, type StoreError } from '@indx-watch/store';
import * as cx from '../context.js';
import { repoOf } from '../github.js';
import { type Args, type Ctx, fail, many, str } from '../util.js';
import { knownKeys, originOf } from './specs.js';

const TASK = /^\s*[-*]\s+\[[ xX]\]\s+(\S.*)$/;

/** The `### Label` sections of a rendered issue form, by lower-case label. */
function sections(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let name: string | undefined;
  for (const line of body.split(/\r?\n/)) {
    const h = /^###\s+(.+?)\s*$/.exec(line);
    if (h) {
      name = h[1]!.toLowerCase();
      out.set(name, '');
    } else if (name) out.set(name, `${out.get(name)}${line}\n`);
  }
  return new Map([...out].map(([k, v]) => [k, v.trim()]));
}

/** What the issue says: form fields when it came from the test request form, and every task-list item as a criterion. */
export function parseIssue(issue: IssueData) {
  const s = sections(issue.body);
  const given = (k: string) => (s.get(k) && s.get(k) !== '_No response_' ? s.get(k) : undefined);
  const tasks = (given('acceptance criteria') ?? issue.body)
    .split(/\r?\n/)
    .flatMap((l) => TASK.exec(l)?.[1]?.trim() ?? []);
  const priority = /\bP[0-3]\b/.exec(given('priority') ?? issue.labels.join(' '))?.[0] ?? 'P2';
  return { actor: given('actor') ?? 'User', goal: given('goal') ?? issue.title, priority, criteria: tasks };
}

/** The issue from `--from` (`gh issue view <n> --json title,body,labels,url`) or from the IssueSource. */
async function readIssue(
  ctx: Ctx,
  a: Args,
  repo: string | undefined,
  number: number | undefined,
): Promise<IssueData> {
  const from = str(a.from);
  if (!from) {
    if (!repo || !number)
      return fail('USAGE', 'Give an issue URL, or a number in a project with [github] repo');
    const source = ctx.issues ?? githubIssueSource(ctx.env);
    return source
      .get(repo, number)
      .catch((e: StoreError) => fail(e.code === 'not-found' ? 'NOT_FOUND' : 'STORE_ERROR', e.message));
  }
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(await cx.readFrom(ctx, from));
  } catch (e) {
    if (e instanceof iwb.BundleError) throw e;
    return fail('INVALID_INPUT', `--from: ${(e as Error).message}`);
  }
  const url = typeof j.url === 'string' ? j.url : '';
  const n = Number(j.number ?? parseIssueUrl(url)?.number ?? number);
  if (typeof j.title !== 'string' || !url || !n)
    return fail(
      'INVALID_INPUT',
      '--from needs title, url and body (gh issue view --json title,body,labels,url)',
    );
  const labels = ((j.labels as unknown[]) ?? []).map((l) =>
    typeof l === 'string' ? l : String((l as { name?: string })?.name ?? ''),
  );
  return { number: n, title: j.title, body: typeof j.body === 'string' ? j.body : '', labels, url };
}

/** The feature named by --feature, else the one a label names, else the only one. */
function featureOf(p: cx.Project, a: Args, labels: string[]) {
  const feats = p.bundle.features;
  const named = str(a.feature);
  const hit = named
    ? feats.find(
        (f) =>
          f.data.key.toLowerCase() === named.toLowerCase() ||
          f.data.title.toLowerCase() === named.toLowerCase(),
      )
    : (feats.find((f) =>
        labels.some((l) => [f.data.title, f.data.key].some((n) => n.toLowerCase() === l.toLowerCase())),
      ) ?? (feats.length === 1 ? feats[0] : undefined));
  return (
    hit?.data.key ??
    fail('USAGE', named ? `No feature ${named}` : 'Which feature? Pass --feature <FEAT-n or title>')
  );
}

export async function importGithubIssue(ctx: Ctx, a: Args) {
  const [, ref] = many(a._);
  if (!ref) fail('USAGE', 'Usage: iw import github-issue <number | URL> [--from <file.json>] [--feature F]');
  if (a['dry-run'] || a.merge || a.uc)
    fail('USAGE', '--dry-run, --merge and --uc apply to other imports only');
  const p = await cx.openProject(ctx, a);
  const parsed = /^\d+$/.test(ref!)
    ? undefined
    : (parseIssueUrl(ref!) ?? fail('USAGE', `${ref} is not an issue number or a GitHub issue URL`));
  const repo = parsed?.repo ?? repoOf(p);
  const issue = await readIssue(ctx, a, repo, parsed?.number ?? Number(ref));
  const existing = p.bundle.useCases.find((u) => u.data.links?.includes(issue.url));
  if (existing) {
    const data = { issue: issue.url, created: null, existing: existing.data.key, criteria: 0 };
    return { data, text: `${issue.url} is already ${existing.data.key} (${existing.file}); nothing changed` };
  }
  const x = parseIssue(issue);
  if (!x.criteria.length)
    fail(
      'INVALID_INPUT',
      `${issue.url} has no task list ("- [ ] …"). Ask /iw-design to read it and propose use cases, or add the criteria to the issue`,
    );
  const feature = featureOf(p, a, issue.labels);
  const agent = (await cx.actorOf(ctx)).kind === 'agent';
  const { origin, model } = await originOf(ctx, { ...a, origin: agent ? 'ai' : 'import' });
  const fields = {
    ...{ title: issue.title, actor: x.actor, goal: x.goal, priority: x.priority },
    links: [issue.url],
    criteria: x.criteria.map((text) => ({ text, status: 'draft' })),
  };
  const r = await iwb.createDefinition(p.fs, p.bundle, {
    ...{ kind: 'use-case', fields, parent: feature, origin },
    ...(model && { ai: { model, skill: str(a.skill) ?? 'iw-design' } }),
    knownKeys: knownKeys(await p.replica.records()),
  });
  const data = { issue: issue.url, created: r, existing: null, criteria: x.criteria.length };
  return {
    data,
    text: `Created ${r.key} (draft) in ${r.file} from ${issue.url} with ${x.criteria.length} criteria`,
  };
}
