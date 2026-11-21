/**
 * Roles from Access identities and what a customer may see (docs/spec/security.md#roles). Pure.
 */
import type { Actor, Environment, Judgement, PlanItem, Role, Roles } from '@indx-watch/bundle';
import { QA_TEAM } from './report.js';
import type { Model, RunView } from './types.js';

/** Who a request is: its actor ID (an email, or `ci:access:<client id>`) and its Access group IDs, names and emails. */
export interface Principal {
  id: string;
  groups: string[];
}

const names = (p: Principal) => new Set([p.id, ...p.groups].map((s) => s.toLowerCase()));
const ORDER: Role[] = ['lead', 'tester', 'viewer', 'customer'];

/**
 * The highest role whose list names the actor ID or one of its groups (without case); else `customer` for an
 * invited email assignee, else `default` (docs/spec/security.md#customer-uat).
 */
export function roleOf(roles: Roles, who: Principal, invited = false): Role | undefined {
  const n = names(who);
  return (
    ORDER.find((r) => roles[r]?.some((e) => n.has(e.toLowerCase()))) ?? (invited ? 'customer' : roles.default)
  );
}

/** An email a customer can be invited with. */
export const EMAIL = /^[^@\s:]+@[^@\s]+\.[^@\s]+$/;
const same = (a: string | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();
/** Is `email` the assignee of any plan item. */
export const isAssignee = (plans: { items?: PlanItem[] }[], email: string) =>
  plans.some((p) => p.items?.some((i) => same(i.assignee, email)));

/**
 * A plan's items after inviting `email` to the items of `keys` (every item when empty), or revoking it from them;
 * `missing`: keys that are not items of the plan (docs/spec/security.md#customer-uat).
 */
export function inviteItems(items: PlanItem[], email: string, keys: string[], revoke = false) {
  const want = new Set(keys.map((k) => k.toUpperCase()));
  const hit = (i: PlanItem) => !want.size || want.has(i.test_case.toUpperCase());
  const missing = [...want].filter((k) => !items.some((i) => i.test_case.toUpperCase() === k));
  const next = items.map((i): PlanItem => {
    if (!hit(i) || (revoke && !same(i.assignee, email))) return i;
    const { assignee: _, ...rest } = i;
    return revoke ? rest : { ...rest, assignee: email };
  });
  return { items: next, selected: items.filter(hit).map((i) => i.test_case), missing };
}

/** A plan item is assigned to whoever its `assignee` names: that email, or `group:<name>` of one of their groups. */
export function assignedTo(item: PlanItem, who: Principal): boolean {
  const a = item.assignee?.toLowerCase() ?? '';
  const group = a.startsWith('group:') && a.slice(6);
  return group ? who.groups.some((g) => g.toLowerCase() === group) : names(who).has(a);
}

/** What customer reports redact (docs/spec/reports.md#sharing-with-customers), from the records a customer sees. */
function redact(m: Model, who: Principal, mine: (r: { test_case: { id: string } }) => boolean) {
  const shown = (a: Actor) => (a.name && !a.name.includes('@') ? a.name : QA_TEAM);
  const hide = (a: Actor): Actor =>
    a.id.toLowerCase() === who.id.toLowerCase() ? a : { ...a, id: shown(a), name: undefined };
  const j = ({ reason: _, by, ...rest }: Judgement): Judgement => ({ ...rest, ...(by && { by: hide(by) }) });
  const run = ({ note: _, ci: _c, steps, ...r }: RunView['record']) => ({
    ...{ ...r, actor: hide(r.actor), judgements: r.judgements?.map(j) },
    steps: steps.map(({ note: _, ...s }) => s),
  });
  const view = (v: RunView) => ({
    ...v,
    record: run(v.record),
    judgements: v.judgements.map(j),
    decision: { ...v.decision, reason: '' },
  });
  const actors = <R extends { actor: Actor; test_case: { id: string } }>(rs: R[]) =>
    rs.filter(mine).map((r) => ({ ...r, actor: hide(r.actor) }));
  const title = (i18n: Environment['i18n']) =>
    i18n && Object.fromEntries(Object.entries(i18n).map(([l, t]) => [l, { title: t?.title }]));
  return {
    runs: new Map([...m.runs].filter(([, v]) => mine(v.record)).map(([k, v]) => [k, view(v)])),
    ...{ waivers: actors(m.waivers), baselines: actors(m.baselines) },
    environments: m.environments.map(({ guide: _, access: _a, i18n, ...e }) => ({ ...e, i18n: title(i18n) })),
  };
}

/**
 * The model restricted to the plan items assigned to `who`: their test cases, the use cases, criteria and
 * features above them, the fixtures they use and the records about them. Everything else is left out, and runs and
 * environments lose what customer reports redact (docs/spec/security.md#roles).
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
  const mine = (r: { test_case: { id: string } }) => ids.has(r.test_case.id);
  const records = redact(m, who, mine);
  const none = { deployments: [], shares: [], snapshots: [] };
  const verifiedOnly = m.verifiedOnly && customerModel(m.verifiedOnly, who);
  return { ...m, plans, features, useCases, testCases, fixtures, ...records, ...none, verifiedOnly };
}
