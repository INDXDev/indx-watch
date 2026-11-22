/**
 * Roles from Access identities and what a customer may see (docs/spec/security.md#roles). Pure.
 */
import type { Actor, Environment, Judgement, PlanItem, Role, Roles } from '@indx-watch/bundle';
import { QA_TEAM } from './report.js';
import type { Model, RunView, TestCaseNode } from './types.js';

/** Who a request is: its actor ID (an email, or `ci:access:<client id>`) and its Access group IDs, names and emails. */
export interface Principal {
  id: string;
  groups: string[];
}

const names = (p: Principal) => new Set([p.id, ...p.groups].map((s) => s.toLowerCase()));
const ORDER: Role[] = ['lead', 'tester', 'viewer', 'customer'];

/**
 * The highest role whose list names the actor ID or one of its groups (without case); else `default`; else
 * `customer` for an invited email assignee (docs/spec/security.md#customer-uat).
 */
export function roleOf(roles: Roles, who: Principal, invited = false): Role | undefined {
  const n = names(who);
  const listed = ORDER.find((r) => roles[r]?.some((e) => n.has(e.toLowerCase())));
  return listed ?? roles.default ?? (invited ? 'customer' : undefined);
}

/** Invites need roles whose fallback for an unlisted invited email is `customer` (no `default`, or that one). */
export const canInvite = (r?: Roles) => !!r && (r.default ?? 'customer') === 'customer';

/** An email a customer can be invited with. */
export const EMAIL = /^[^@\s:]+@[^@\s]+\.[^@\s]+$/;
const same = (a: string | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();
/** Is `email` the assignee of any plan item. */
export const isAssignee = (plans: { items?: PlanItem[] }[], email: string) =>
  plans.some((p) => p.items?.some((i) => same(i.assignee, email)));

/**
 * A plan's items after inviting `email` to the items of `keys`, or revoking it from them. Without `keys`: every
 * item, except that an invite leaves items assigned to someone else alone (naming them reassigns them).
 * `changed`: the items whose assignee changed; `reassigned`: those taken from another assignee; `missing`: keys
 * that are not items of the plan (docs/spec/security.md#customer-uat).
 */
export function inviteItems(items: PlanItem[], email: string, keys: string[], revoke = false) {
  const want = new Set(keys.map((k) => k.toUpperCase()));
  const missing = [...want].filter((k) => !items.some((i) => i.test_case.toUpperCase() === k));
  const hit = (i: PlanItem) =>
    want.size ? want.has(i.test_case.toUpperCase()) : revoke || !i.assignee || same(i.assignee, email);
  const change = (i: PlanItem) => hit(i) && (revoke ? same(i.assignee, email) : !same(i.assignee, email));
  const next = items.map((i): PlanItem => {
    if (!change(i)) return i;
    const { assignee: _, ...rest } = i;
    return revoke ? rest : { ...rest, assignee: email };
  });
  const keysOf = (f: (i: PlanItem) => boolean) => items.filter(f).map((i) => i.test_case);
  const reassigned = revoke ? [] : keysOf((i) => change(i) && !!i.assignee);
  return { items: next, changed: keysOf(change), reassigned, missing };
}

/** Does an assignee or owner entry name `who`: their ID, or `group:<name>` of one of their groups (without case). */
function named(entry: string | undefined, who: Principal): boolean {
  const a = entry?.toLowerCase() ?? '';
  const group = a.startsWith('group:') && a.slice(6);
  return group ? who.groups.some((g) => g.toLowerCase() === group) : names(who).has(a);
}
/** A plan item is assigned to whoever its `assignee` names: that email, or `group:<name>` of one of their groups. */
export const assignedTo = (item: PlanItem, who: Principal) => named(item.assignee, who);

/** Keys of the features whose `owners` name `who` (docs/spec/concepts.md#feature-owners). */
export const ownedFeatures = (m: Model, who: Principal) =>
  m.features.filter((f) => f.data.owners?.some((o) => named(o, who))).map((f) => f.data.key);

/**
 * The model narrowed to `features`: their use cases, the test cases of those use cases or covering one of their
 * criteria, and every record (docs/spec/concepts.md#feature-owners).
 */
export function ownedModel(m: Model, features: string[]): Model {
  const kept = m.features.filter((f) => features.includes(f.data.key));
  const ucs = new Set(kept.flatMap((f) => f.useCases.map((u) => u.data.key)));
  const uc = (ac: string) => `UC-${ac.slice(3, ac.indexOf('.'))}`;
  const mine = (t: TestCaseNode) => ucs.has(t.useCase) || t.data.covers.some((ac) => ucs.has(uc(ac)));
  const useCases = new Map([...m.useCases].filter(([k]) => ucs.has(k)));
  const testCases = new Map([...m.testCases].filter(([, t]) => mine(t)));
  const verifiedOnly = m.verifiedOnly && ownedModel(m.verifiedOnly, features);
  return { ...m, features: kept, useCases, testCases, verifiedOnly };
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
