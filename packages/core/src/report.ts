/**
 * Report data (docs/spec/reports.md#contents). Rendering lives in the server package.
 */
import {
  type Actor,
  DECISION_POLICY_DEFAULTS,
  type Priority,
  Priority as PrioritySchema,
} from '@indx-watch/bundle';
import type { ReportData } from './index.js';
import { byKey, PRIORITY_RANK } from './model.js';
import { activeWaiver, computeStatus, gateOf, planItemStatus, runsInScope } from './status.js';
import type { Model, Scope } from './types.js';

const OPEN = new Set(['fail', 'needs_review', 'blocked', 'stale', 'untested']);

export function reportData(
  model: Model,
  scope: Scope,
  opts: {
    plan?: string;
    audience: 'internal' | 'customer';
    generatedBy: string;
    now: Date;
    commit?: string;
    cursor?: string;
  },
): ReportData {
  const customer = opts.audience === 'customer';
  const who = (a: Actor) =>
    customer ? (a.name && !a.name.includes('@') ? a.name : 'QA team') : (a.name ?? a.id);
  const status = computeStatus(model, scope);
  const byTc = new Map(status.testCases.map((t) => [t.key, t]));
  const priorities = PrioritySchema.options;

  const countsByPriority = Object.fromEntries(
    priorities.map((p) => [p, {} as Record<string, number>]),
  ) as Record<Priority, Record<string, number>>;
  for (const t of status.testCases) {
    const c = countsByPriority[model.testCases.get(t.key)!.priority];
    c[t.status] = (c[t.status] ?? 0) + 1;
  }
  for (const u of status.useCases) {
    const c = countsByPriority[u.priority];
    if (model.useCases.get(u.key)?.data.status !== 'ready') continue;
    c.ac_total = (c.ac_total ?? 0) + u.criteria.length;
    c.ac_covered = (c.ac_covered ?? 0) + u.criteria.filter((a) => a.testCases.length > 0).length;
  }

  const plan = opts.plan ? model.plans.find((p) => p.key === opts.plan) : undefined;
  const planItems = plan?.items?.map((it, i) => ({
    testCase: it.test_case,
    assignee: customer && it.assignee?.includes('@') ? undefined : it.assignee,
    due: it.due ?? plan.due,
    environment: it.environment ?? plan.environment,
    status: planItemStatus(model, plan.key, i),
  }));

  const failures: ReportData['failures'] = [];
  for (const t of status.testCases) {
    const node = model.testCases.get(t.key)!;
    if (!OPEN.has(t.status) || PRIORITY_RANK[node.priority] > 1 || node.data.status !== 'ready') continue;
    const run = t.latestRun
      ? model.runs.get(t.variants?.find((v) => v.verdict !== 'pass')?.run ?? t.latestRun)
      : undefined;
    const step = run?.record.steps?.find((s) => s.status !== 'pass');
    failures.push({
      testCase: t.key,
      title: node.data.title,
      priority: node.priority,
      status: t.status,
      run: run?.record.id,
      step: step?.index,
      note: customer ? undefined : (step?.note ?? run?.record.note) || undefined,
      evidence:
        step?.evidence?.[0] ?? run?.record.evidence?.find((e) => !step || e.step === step.index)?.sha256,
    });
  }

  const waivers: ReportData['waivers'] = [];
  if (scope.release)
    for (const t of status.testCases) {
      const w = activeWaiver(model, scope.release, model.testCases.get(t.key)!.data.id);
      if (w) waivers.push({ testCase: t.key, reason: w.reason, by: who(w.actor), at: w.at });
    }

  const runs = [...model.testCases.values()]
    .flatMap((t) => runsInScope(model, t.data.id, scope).map((v) => ({ v, key: t.data.key })))
    .sort((a, b) =>
      a.v.record.ended_at < b.v.record.ended_at
        ? -1
        : a.v.record.ended_at > b.v.record.ended_at
          ? 1
          : a.v.record.id < b.v.record.id
            ? -1
            : 1,
    )
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
    }));

  const g = gateOf(model);
  return {
    project: { key: model.project.key, name: model.project.name },
    scope,
    plan: opts.plan,
    audience: opts.audience,
    generatedAt: opts.now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    generatedBy: customer && opts.generatedBy.includes('@') ? 'QA team' : opts.generatedBy,
    bundleCommit: opts.commit,
    cursor: opts.cursor,
    policy: { ...DECISION_POLICY_DEFAULTS, ...model.project.decision_policy },
    gateThresholds: { ...g },
    countsByPriority,
    planItems,
    status,
    failures: failures.sort(
      (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byKey(a.testCase, b.testCase),
    ),
    waivers,
    runs: runs.filter((r) => byTc.has(r.testCase)),
  };
}
