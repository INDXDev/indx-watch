/**
 * Report data (docs/spec/reports.md#contents). Rendering lives in the server package.
 */
import {
  type Actor,
  DECISION_POLICY_DEFAULTS,
  type Priority,
  Priority as PrioritySchema,
} from '@indx-watch/bundle';
import { automationMix } from './assign.js';
import { byTimeThenId } from './decide.js';
import type { ReportData } from './index.js';
import { byKey, PRIORITY_RANK } from './model.js';
import { activeWaiver, computeStatus, gateOf, planItemStatus, runsInScope } from './status.js';
import type { Model, Scope, StatusResult, TestCaseStatus } from './types.js';

const OPEN = new Set(['fail', 'needs_review', 'blocked', 'stale', 'untested']);
/** Name shown to customers instead of an e-mail address or an anonymous actor. */
export const QA_TEAM = 'QA team';

/** What the report needs besides model and scope; `customer` redacts e-mails, notes and CI links. */
interface ReportOptions {
  plan?: string;
  audience: 'internal' | 'customer';
  generatedBy: string;
  now: Date;
  commit?: string;
  cursor?: string;
}

/** Ready test cases per status and ready-use-case AC coverage (ac_total, ac_covered), by priority. */
function countsByPriority(model: Model, status: StatusResult): ReportData['countsByPriority'] {
  const counts = Object.fromEntries(
    PrioritySchema.options.map((p) => [p, {} as Record<string, number>]),
  ) as Record<Priority, Record<string, number>>;
  for (const t of status.testCases) {
    const node = model.testCases.get(t.key)!;
    if (node.data.status !== 'ready') continue; // drafts do not count (as in status.counts)
    const c = counts[node.priority];
    c[t.status] = (c[t.status] ?? 0) + 1;
  }
  for (const u of status.useCases) {
    if (model.useCases.get(u.key)?.data.status !== 'ready') continue;
    const c = counts[u.priority];
    c.ac_total = (c.ac_total ?? 0) + u.criteria.length;
    c.ac_covered = (c.ac_covered ?? 0) + u.criteria.filter((a) => a.testCases.length > 0).length;
  }
  return counts;
}

function planItems(model: Model, planKey: string | undefined, customer: boolean): ReportData['planItems'] {
  const plan = planKey ? model.plans.find((p) => p.key === planKey) : undefined;
  return plan?.items?.map((it, i) => ({
    testCase: it.test_case,
    assignee: customer && it.assignee?.includes('@') ? undefined : it.assignee,
    due: it.due ?? plan.due,
    environment: it.environment ?? plan.environment,
    status: planItemStatus(model, plan.key, i),
  }));
}

/** Who reads the report: `who` names an actor for that audience. */
type Audience = { customer: boolean; who: (a: Actor) => string };

type Failure = ReportData['failures'][number];

/** The open result of a ready P0/P1 test case, with its first non-passing step; undefined otherwise. */
function failureOf(model: Model, t: TestCaseStatus, customer: boolean): Failure | undefined {
  const node = model.testCases.get(t.key)!;
  if (!OPEN.has(t.status) || PRIORITY_RANK[node.priority] > 1 || node.data.status !== 'ready') return;
  const runId = t.variants?.find((v) => v.verdict !== 'pass')?.run ?? t.latestRun;
  const run = runId ? model.runs.get(runId) : undefined;
  const step = run?.record.steps?.find((s) => s.status !== 'pass');
  return {
    testCase: t.key,
    title: node.data.title,
    priority: node.priority,
    status: t.status,
    run: run?.record.id,
    step: step?.index,
    note: customer ? undefined : (step?.note ?? run?.record.note) || undefined,
    evidence:
      step?.evidence?.[0] ?? run?.record.evidence?.find((e) => !step || e.step === step.index)?.sha256,
  };
}

/** Failures by priority, then key. */
function failures(model: Model, status: StatusResult, customer: boolean): Failure[] {
  return status.testCases
    .map((t) => failureOf(model, t, customer))
    .filter((f): f is Failure => f !== undefined)
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byKey(a.testCase, b.testCase));
}

/** Waivers that turned a fail into waived; a stale waiver (other version) is not listed. Empty without a release. */
function waivers(model: Model, release: string | undefined, status: StatusResult, who: Audience['who']) {
  if (!release) return [];
  return status.testCases.flatMap((t) => {
    const w = t.waived && activeWaiver(model, release, model.testCases.get(t.key)!.data.id);
    return w ? [{ testCase: t.key, reason: w.reason, by: who(w.actor), at: w.at }] : [];
  });
}

/** Runs in scope of listed (non-deprecated) test cases, oldest first. */
function runs(model: Model, scope: Scope, listed: Set<string>, { customer, who }: Audience) {
  return [...model.testCases.values()]
    .filter((t) => listed.has(t.data.key))
    .flatMap((t) => runsInScope(model, t.data.id, scope).map((v) => ({ v, key: t.data.key })))
    .sort((a, b) => byTimeThenId(a.v.record.ended_at, a.v.record.id, b.v.record.ended_at, b.v.record.id))
    .map(({ v, key }) => ({
      id: v.record.id,
      testCase: key,
      version: v.record.test_case.version,
      verdict: v.stale ? `${v.decision.verdict} (stale)` : v.decision.verdict,
      actor: who(v.record.actor),
      actorKind: v.record.actor.kind,
      source: v.record.source,
      commit: v.record.build?.commit,
      environment: v.record.environment,
      at: v.record.ended_at,
      evidence: v.record.evidence?.length ?? 0,
      ciUrl: customer ? undefined : v.record.ci?.url,
      ...(model.unverified?.has(v.record.id) && { unverified: true as const }),
    }));
}

/** Who runs the items of the plan, or of the release's plans: `{ automation }` when there are items. */
function automation(model: Model, scope: Scope, planKey: string | undefined) {
  const plans = model.plans.filter((p) =>
    planKey ? p.key === planKey : !scope.release || p.release === scope.release,
  );
  const mix = automationMix(model, plans);
  return mix.total > 0 ? { automation: mix } : {};
}

/** Everything a report shows for a scope; `opts.now` is rendered to whole seconds (UTC). */
export function reportData(model: Model, scope: Scope, opts: ReportOptions): ReportData {
  const customer = opts.audience === 'customer';
  const who = (a: Actor) =>
    customer ? (a.name && !a.name.includes('@') ? a.name : QA_TEAM) : (a.name ?? a.id);
  const status = computeStatus(model, scope);
  const { title, footer } = model.project.report ?? {};
  const brand = {
    ...(title && { title }),
    ...(footer && { footer }),
    ...(model.ui?.logo && { logo: model.ui.logo }),
  };
  return {
    project: { key: model.project.key, name: model.project.name },
    ...(Object.keys(brand).length && { brand }),
    scope,
    plan: opts.plan,
    audience: opts.audience,
    generatedAt: opts.now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    generatedBy: customer && opts.generatedBy.includes('@') ? QA_TEAM : opts.generatedBy,
    bundleCommit: opts.commit,
    cursor: opts.cursor,
    policy: { ...DECISION_POLICY_DEFAULTS, ...model.project.decision_policy },
    gateThresholds: { ...gateOf(model) },
    countsByPriority: countsByPriority(model, status),
    planItems: planItems(model, opts.plan, customer),
    ...automation(model, scope, opts.plan),
    status,
    failures: failures(model, status, customer),
    waivers: waivers(model, scope.release, status, who),
    runs: runs(model, scope, new Set(status.testCases.map((t) => t.key)), { customer, who }),
  };
}
