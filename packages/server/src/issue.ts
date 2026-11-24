/** The prefilled GitHub issue of a run, test case, criterion or use case (docs/spec/integrations.md#github-issues): shared by `iw issue` and `GET /api/issue`. */
import type * as B from '@indx-watch/bundle';
import { type IssueLink, issueUrl, type Model, type RunView } from '@indx-watch/core';
import { fail, resolveKey, resolveRun } from './tools.js';

export interface IssueOptions {
  /** `[github] repo`, else the remote of the working copy (Node) */
  repo: string | undefined;
  /** the app's origin when it is hosted: the issue then links to the run page */
  appUrl?: string | undefined;
}
export interface IssueResult extends IssueLink {
  repo: string;
  /** the run ID, or TC-n, AC-n.m, UC-n when there is no run */
  ref: string;
  title: string;
  keys: string[];
}

const stepsOf = (tc: B.TestCase) => tc.steps.map((s, i) => `${i + 1}. ${s.instruction}`).join('\n');
const latestRun = (m: Model, tcId: string): RunView | undefined =>
  [...m.runs.values()]
    .filter((v) => v.record.test_case.id === tcId && !v.retracted)
    .sort((a, b) => b.record.ended_at.localeCompare(a.record.ended_at))[0];

/** What went wrong in a run: the failing steps' notes, the run note and the judgements that did not pass. */
function actualOf(v: RunView, tc: B.TestCase | undefined) {
  const failed = v.record.steps.filter((s) => s.status === 'fail' || s.status === 'blocked');
  const lines = failed.map((s) => `Step ${s.index} ${s.status}${s.note ? `: ${s.note}` : ''}`);
  if (v.record.note) lines.push(v.record.note);
  for (const j of v.judgements)
    if (j.verdict !== 'pass' && j.reason) lines.push(`${j.test ? `${j.test}: ` : ''}${j.reason}`);
  const expected = tc?.steps[(failed[0]?.index ?? tc.steps.length) - 1]?.expected;
  const actual =
    [...new Set(lines)].join('\n') || `The run was decided ${v.decision.verdict}: ${v.decision.reason}`;
  return { actual, expected };
}

/** Values of the test case's account fixtures that must never reach an issue. */
function secretsOf(m: Model, tc: B.TestCase | undefined) {
  const out: string[] = [];
  for (const ref of tc?.fixtures ?? []) {
    const a = m.fixtures.get(ref.ref)?.data.account;
    if (a) out.push(a.username, a.secret_ref, ...Object.values(a.fields ?? {}));
  }
  return out;
}

export function issueFor(m: Model, ref: string, o: IssueOptions): IssueResult {
  const repo =
    o.repo ??
    fail('INVALID_CONFIG', 'No GitHub repository: set [github] repo = "owner/name" in project.toml');
  const run = /^run_/i.test(ref) ? resolveRun(m, ref) : undefined;
  const key = run ? run.record.test_case.key : resolveKey(m, ref);
  const tcNode = m.testCases.get(key);
  const ac = [...m.useCases.values()].flatMap((u) => u.criteria).find((c) => c.data.key === key);
  const uc = m.useCases.get(key) ?? (ac && m.useCases.get(ac.useCase));
  const v = run ?? (tcNode && latestRun(m, tcNode.data.id));
  const tc = tcNode?.data;
  const covering = ac ? ac.testCases : uc ? uc.criteria.flatMap((c) => c.testCases) : [];
  const keys = [...new Set([key, ...covering])];
  const title = tc?.title ?? ac?.data.text ?? uc?.data.title ?? key;
  const r = v && actualOf(v, tc);
  const where =
    v &&
    (o.appUrl ? `${o.appUrl.replace(/\/$/, '')}/#/runs/${v.record.id}` : (v.record.ci?.url ?? v.record.id));
  const link = issueUrl({
    ...{ repo, title: `${key}: ${title}`, keys, priority: tcNode?.priority ?? uc?.data.priority },
    ...{
      steps: tc && stepsOf(tc),
      expected: r?.expected ?? ac?.data.text ?? uc?.data.goal,
      actual: r?.actual,
    },
    ...{ run: where, commit: v?.record.build.commit, environment: v?.record.environment },
    redact: secretsOf(m, tc),
  });
  return { ...link, repo, ref: v ? v.record.id : key, title, keys };
}
