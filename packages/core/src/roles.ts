/**
 * Roles from Access identities and what a customer may see (docs/spec/security.md#roles). Pure.
 */
import type { PlanItem, Role, Roles } from '@indx-watch/bundle';
import type { Model } from './types.js';

/** Who a request is: its actor ID (an email, or `ci:access:<client id>`) and its Access group IDs, names and emails. */
export interface Principal {
  id: string;
  groups: string[];
}

const names = (p: Principal) => new Set([p.id, ...p.groups].map((s) => s.toLowerCase()));
const ORDER: Role[] = ['lead', 'tester', 'viewer', 'customer'];

/** The highest role whose list names the actor ID or one of its groups (without case), else `default`. */
export function roleOf(roles: Roles, who: Principal): Role | undefined {
  const n = names(who);
  return ORDER.find((r) => roles[r]?.some((e) => n.has(e.toLowerCase()))) ?? roles.default;
}

/** A plan item is assigned to whoever its `assignee` names: that email, or `group:<name>` of one of their groups. */
export function assignedTo(item: PlanItem, who: Principal): boolean {
  const a = item.assignee?.toLowerCase() ?? '';
  const group = a.startsWith('group:') && a.slice(6);
  return group ? who.groups.some((g) => g.toLowerCase() === group) : names(who).has(a);
}

/**
 * The model restricted to the plan items assigned to `who`: their test cases, the use cases, criteria and
 * features above them, the fixtures they use and the records about them. Everything else is left out.
 */
export function customerModel(m: Model, who: Principal): Model {
  const plans = m.plans
    .map((p) => ({ ...p, items: p.items?.filter((i) => assignedTo(i, who)) }))
    .filter((p) => p.items?.length);
  const tcs = new Set(plans.flatMap((p) => p.items!.map((i) => m.keyOf(i.test_case) ?? i.test_case)));
  const testCases = new Map([...m.testCases].filter(([k]) => tcs.has(k)));
  const [ucs, ids] = [new Set([...testCases.values()].map((t) => t.useCase)), new Set<string>()];
  for (const t of testCases.values()) ids.add(t.data.id);
  const only = (keys: string[]) => keys.filter((k) => tcs.has(k));
  const useCases = new Map(
    [...m.useCases]
      .filter(([k]) => ucs.has(k))
      .map(([k, u]) => {
        const all = u.criteria.map((c) => ({
          ...c,
          testCases: only(c.testCases),
          draftTestCases: only(c.draftTestCases),
        }));
        return [k, { ...u, criteria: all.filter((c) => c.testCases.length + c.draftTestCases.length) }];
      }),
  );
  const features = m.features
    .map((f) => ({ ...f, useCases: f.useCases.flatMap((u) => useCases.get(u.data.key) ?? []) }))
    .filter((f) => f.useCases.length);
  const fixtures = new Map(
    [...m.fixtures]
      .map(([k, f]) => [k, { ...f, usedBy: only(f.usedBy) }] as const)
      .filter(([, f]) => f.usedBy.length),
  );
  const mine = <R extends { test_case: { id: string } }>(r: R) => ids.has(r.test_case.id);
  const runs = new Map([...m.runs].filter(([, v]) => mine(v.record)));
  const records = { waivers: m.waivers.filter(mine), baselines: m.baselines.filter(mine), runs };
  const none = { deployments: [], shares: [], snapshots: [] };
  const verifiedOnly = m.verifiedOnly && customerModel(m.verifiedOnly, who);
  return { ...m, plans, features, useCases, testCases, fixtures, ...records, ...none, verifiedOnly };
}
