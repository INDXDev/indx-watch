/**
 * Who has which plan item: the split, the board and the automation mix (docs/spec/concepts.md#assignment-and-automation-mix).
 * Pure and deterministic; the CLI, the server, the web app and the MCP tool all call these.
 */
import { Assignee, type Plan, type PlanItem, type Priority } from '@indx-watch/bundle';
import { PRIORITY_RANK } from './model.js';
import { planItemStatus } from './status.js';
import type { Model, PlanItemStatus } from './types.js';

export interface Weight {
  who: string;
  weight: number;
}
/** One item whose assignee changes (`from`: the previous one; `assignee` is empty when it is taken off). */
export interface Change {
  test_case: string;
  environment?: string;
  assignee: string;
  from?: string;
}
export interface Assigned {
  /** the plan's items after the change, to write back */
  items: PlanItem[];
  changes: Change[];
  /** items per assignee after the change */
  load: Record<string, number>;
  unassigned: number;
}

const same = (a: string | undefined, b: string | undefined) => a?.toLowerCase() === b?.toLowerCase();
const valid = (s: string) => Assignee.safeParse(s).success;
const fail = (message: string): never => {
  throw new Error(message);
};
const planOf = (m: Model, key: string) =>
  m.plans.find((p) => p.key.toUpperCase() === key.toUpperCase()) ?? fail(`${key} is not a plan`);

/** `alex@shop.test:2,agent:claude:1` → weights; a whole number after the last colon is the weight (default 1). */
export function parseSplit(spec: string): Weight[] {
  const out: Weight[] = [];
  for (const raw of spec.split(',').map((s) => s.trim())) {
    if (!raw) continue;
    const m = /^(.+):(\d+)$/.exec(raw);
    const [who, weight] = m && valid(m[1]!) ? [m[1]!, Number(m[2])] : [raw, 1];
    if (!valid(who as string))
      fail(`"${raw}" is not an assignee: use an email, ci, agent:<name> or group:<name>`);
    if ((weight as number) < 1) fail(`"${raw}": the weight must be a whole number from 1`);
    if (out.some((o) => same(o.who, who as string))) fail(`${who} appears twice in the split`);
    out.push({ who: who as string, weight: weight as number });
  }
  return out.length ? out : fail('the split names nobody: use who:weight,who:weight');
}

/** Whole quotas of `total` items by weight: the floor of each share, the rest by largest remainder, ties to the earlier entry. */
function quotas(total: number, ws: Weight[]) {
  const sum = ws.reduce((a, w) => a + w.weight, 0);
  const q = ws.map((w) => Math.floor((total * w.weight) / sum));
  const order = ws.map((w, i) => ({ i, r: (total * w.weight) % sum })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let left = total - q.reduce((a, b) => a + b, 0), k = 0; left > 0; left--, k++) q[order[k]!.i]!++;
  return q;
}

/** A plan item's priority and the owners of its feature. */
function facts(m: Model, it: PlanItem) {
  const tc = m.testCases.get(it.test_case);
  const feature = tc && m.useCases.get(tc.useCase)?.feature;
  return {
    priority: (tc?.priority ?? 'P2') as Priority,
    owners: m.features.find((f) => f.data.key === feature)?.data.owners ?? [],
  };
}

/** The changes between a plan's items and `next`, and the load per assignee. */
function result(plan: Plan, next: PlanItem[]): Assigned {
  const items = plan.items ?? [];
  const changes = next.flatMap((n, i): Change[] => {
    const was = items[i]!.assignee;
    if (same(was, n.assignee)) return [];
    const [test_case, environment] = [n.test_case, n.environment];
    return [
      {
        test_case,
        ...(environment && { environment }),
        assignee: n.assignee ?? '',
        ...(was && { from: was }),
      },
    ];
  });
  const load: Record<string, number> = {};
  for (const n of next) if (n.assignee) load[n.assignee] = (load[n.assignee] ?? 0) + 1;
  return { items: next, changes, load, unassigned: next.filter((n) => !n.assignee).length };
}

/**
 * Propose an assignee for each item of a plan by weight. Owners get their own features' items first (until their
 * share is full); the rest go most important first to whoever holds the fewest of that priority for their weight.
 */
export function splitAssignments(
  model: Model,
  planKey: string,
  weights: Weight[],
  opts: { onlyUnassigned?: boolean } = {},
): Assigned {
  const plan = planOf(model, planKey);
  const items = plan.items ?? [];
  const next = items.map((it) => ({ ...it }));
  const slot = (who: string | undefined) => weights.findIndex((w) => same(w.who, who));
  const kept = (i: number) => !!opts.onlyUnassigned && !!items[i]!.assignee;
  const held = weights.map(() => 0);
  const byPriority = weights.map(() => ({}) as Partial<Record<Priority, number>>);
  const take = (s: number, p: Priority) => {
    held[s]!++;
    byPriority[s]![p] = (byPriority[s]![p] ?? 0) + 1;
  };
  items.forEach((it, i) => {
    if (kept(i) && slot(it.assignee) >= 0) take(slot(it.assignee), facts(model, it).priority);
  });
  const pool = items
    .map((it, i) => ({ i, ...facts(model, it) }))
    .filter((x) => !kept(x.i))
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.i - b.i);
  const room = quotas(pool.length + held.reduce((a, b) => a + b, 0), weights).map((q, s) =>
    Math.max(0, q - held[s]!),
  );
  const give = (i: number, s: number, p: Priority) => {
    next[i]!.assignee = weights[s]!.who;
    room[s]!--;
    take(s, p);
  };
  const rest: typeof pool = [];
  for (const x of pool) {
    const s = weights.findIndex((w, k) => room[k]! > 0 && x.owners.some((o) => same(o, w.who)));
    if (s >= 0) give(x.i, s, x.priority);
    else rest.push(x);
  }
  for (const x of rest) {
    const all = weights.map((_, s) => s);
    const open = all.filter((s) => room[s]! > 0);
    const share = (s: number) => (byPriority[s]![x.priority] ?? 0) / weights[s]!.weight;
    const better = (b: number, a: number) =>
      share(b) < share(a) || (share(b) === share(a) && room[b]! > room[a]!);
    give(
      x.i,
      (open.length ? open : all).reduce((a, b) => (better(b, a) ? b : a)),
      x.priority,
    );
  }
  return result(plan, next);
}

/** Give the plan items of `keys` to `to`, or take the assignee off (`null`); `missing`: keys that are no item of the plan. */
export function assignItems(model: Model, planKey: string, to: string | null, keys: string[]) {
  const plan = planOf(model, planKey);
  const items = plan.items ?? [];
  const want = new Set(keys.map((k) => k.toUpperCase()));
  const missing = [...want].filter((k) => !items.some((i) => i.test_case.toUpperCase() === k));
  const next = items.map((it): PlanItem => {
    if (!want.has(it.test_case.toUpperCase())) return it;
    const { assignee: _, ...rest } = it;
    return to ? { ...rest, assignee: to } : rest;
  });
  return { ...result(plan, next), missing };
}

export type StatusCounts = Record<PlanItemStatus, number> & { total: number };
const none = (): StatusCounts => ({ todo: 0, done: 0, blocked: 0, review: 0, total: 0 });
export interface AssigneeBoard {
  plan: string;
  total: number;
  rows: ({ assignee: string } & StatusCounts)[];
  unassigned: StatusCounts;
}

/** A plan's items per assignee by status, most items first, and the unassigned ones (docs/spec/web.md#home). */
export function assigneeBoard(model: Model, planKey: string): AssigneeBoard {
  const plan = planOf(model, planKey);
  const by = new Map<string, StatusCounts>();
  const unassigned = none();
  (plan.items ?? []).forEach((it, i) => {
    if (it.assignee && !by.has(it.assignee)) by.set(it.assignee, none());
    const c = (it.assignee && by.get(it.assignee)) || unassigned;
    c[planItemStatus(model, plan.key, i)]++;
    c.total++;
  });
  const rows = [...by].map(([assignee, c]) => ({ assignee, ...c }));
  rows.sort((a, b) => b.total - a.total || (a.assignee < b.assignee ? -1 : 1));
  return { plan: plan.key, total: plan.items?.length ?? 0, rows, unassigned };
}

export interface AutomationMix {
  people: number;
  ci: number;
  agents: number;
  total: number;
}

/** Items of `plans` by who runs them: `ci` or Playwright → CI, `agent:` or agent mode → agents, else people. */
export function automationMix(model: Model, plans: Pick<Plan, 'items'>[]): AutomationMix {
  const mix = { people: 0, ci: 0, agents: 0, total: 0 };
  for (const it of plans.flatMap((p) => p.items ?? [])) {
    const mode = model.testCases.get(it.test_case)?.data.mode;
    const a = it.assignee ?? '';
    if (a === 'ci' || mode === 'playwright') mix.ci++;
    else if (a.startsWith('agent:') || mode === 'agent') mix.agents++;
    else mix.people++;
    mix.total++;
  }
  return mix;
}
