/** Assigning plan items (docs/spec/security.md#customer-uat, docs/spec/web.md#home): roles, dry runs and the write path. */
import { type Actor, type Bundle, type FileRecord, parseToml } from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { definitionFiles } from '@indx-watch/sync';
import { describe, expect, it } from 'vitest';
import { type AssignResult, createApp, type PlanView, type ServerDeps } from '../src/index.js';
import { fakeDeps, req, SHOP, shop } from './helpers.js';

const PLAN = 'plans/PLAN-1-v1-2-0-regression.toml';
const dec = new TextDecoder();
const human = (id: string): Actor => ({ kind: 'human', id, via: 'cloudflare-access' });
const PEOPLE: Record<string, Actor> = {
  lead: human('alex@shop.test'),
  tester: human('kim@shop.test'),
  viewer: human('viv@shop.test'),
  agent: { kind: 'agent', id: 'alex@shop.test', via: 'git', model: 'claude-opus-5-5' },
};
const GROUPS: Record<string, string[]> = {
  lead: ['qa-leads'],
  tester: ['qa'],
  viewer: [],
  agent: ['qa-leads'],
};
const ROLES = { lead: ['QA-Leads'], tester: ['qa'], viewer: ['viv@shop.test'] };

/** A local-mode app in workspace mode whose identity and Access groups come from the x-test-user header. */
async function workspace(roles?: ServerDeps['roles'], mixed = false) {
  const b = await shop();
  const project = { ...b.project.data, store: { ...b.project.data.store!, mode: 'workspace' as const } };
  // `mixed`: TC-8 has no assignee and TC-9 is Kim's
  const tweak = (i: { test_case: string; assignee?: string }) =>
    !mixed
      ? i
      : i.test_case === 'TC-8'
        ? { test_case: 'TC-8' }
        : i.test_case === 'TC-9'
          ? { ...i, assignee: 'kim@shop.test' }
          : i;
  const plans = b.plans.map((p) => ({ ...p, data: { ...p.data, items: p.data.items?.map(tweak) } }));
  const bundle: Bundle = { ...b, project: { ...b.project, data: project }, plans };
  const f = await fakeDeps({ bundle });
  const files = await definitionFiles(nodeFs(SHOP));
  const wrote = new Map<string, Uint8Array>();
  const user = (r: Request) => r.headers.get('x-test-user') ?? 'lead';
  const app = createApp({
    ...f.deps,
    roles,
    bundleFiles: async () => files,
    records: async () => [],
    writeFile: async (p: string, d: Uint8Array) => void wrote.set(p, d),
    identity: {
      current: async (r: Request) => PEOPLE[user(r)]!,
      groups: async (r: Request) => GROUPS[user(r)]!,
    },
  } as ServerDeps);
  const post = (as: string, key: string, json: unknown) => {
    const r = req(`/api/plans/${key}/assign`, { json });
    r.headers.set('x-test-user', as);
    return app.fetch(r);
  };
  const saved = () => (wrote.has(PLAN) ? parseToml(dec.decode(wrote.get(PLAN)!)) : undefined);
  return { ...f, app, post, wrote, saved };
}
const assignees = (t: { items: { test_case: string; assignee?: string }[] } | undefined) =>
  Object.fromEntries((t?.items ?? []).map((i) => [i.test_case, i.assignee]));

describe('POST /api/plans/:key/assign', () => {
  it('lets a lead give items to anyone, writes the plan through formatToml and a file record, and ignores no-ops', async () => {
    const a = await workspace();
    const res = await a.post('lead', 'plan-1', { to: 'kim@shop.test', items: ['TC-8', 'tc-9'] });
    expect(res.status).toBe(201);
    const out = (await res.json()) as AssignResult;
    expect(out).toMatchObject({ plan: 'PLAN-1', dry_run: false, file: PLAN, unassigned: 0 });
    expect(out.assignments).toEqual([
      { test_case: 'TC-8', assignee: 'kim@shop.test', from: 'sam@shop.test' },
      { test_case: 'TC-9', assignee: 'kim@shop.test', from: 'agent:claude' },
    ]);
    expect(assignees(a.saved() as never)).toMatchObject({
      'TC-8': 'kim@shop.test',
      'TC-6': 'alex@shop.test',
    });
    expect(a.written.at(-1)).toMatchObject({ kind: 'file', path: PLAN, actor: { id: 'alex@shop.test' } });
    expect(dec.decode(a.wrote.get(PLAN)!)).toMatch(/^#:schema /);
    // already so: nothing changes
    const again = (await (
      await a.post('lead', 'PLAN-1', { to: 'alex@shop.test', items: ['TC-6'] })
    ).json()) as AssignResult;
    expect(again.assignments).toEqual([]);
  });

  it('splits by weight; dry_run proposes and writes nothing; bad input is 400, unknown items 404', async () => {
    const a = await workspace();
    const split = 'alex@shop.test:2,sam@shop.test:1,agent:claude:1';
    const dry = (await (await a.post('lead', 'PLAN-1', { split, dry_run: true })).json()) as AssignResult;
    expect(dry).toMatchObject({
      dry_run: true,
      load: { 'alex@shop.test': 3, 'sam@shop.test': 2, 'agent:claude': 2 },
    });
    expect(a.wrote.size).toBe(0);
    expect((await a.post('lead', 'PLAN-1', { split })).status).toBe(201);
    expect(assignees(a.saved() as never)['TC-3']).toBe('alex@shop.test');
    expect((await a.post('lead', 'PLAN-1', { split: 'nobody' })).status).toBe(400);
    expect((await a.post('lead', 'PLAN-1', { split, to: 'ci' })).status).toBe(400);
    expect((await a.post('lead', 'PLAN-1', { to: 'ci', items: ['TC-1'] })).status).toBe(404);
    expect((await a.post('lead', 'PLAN-9', { to: 'ci', items: ['TC-1'] })).status).toBe(404);
  });

  it('with roles: a tester takes an unassigned item or gives back their own, nothing else; viewers and agents may not write', async () => {
    const a = await workspace(ROLES, true);
    const take = await a.post('tester', 'PLAN-1', { to: 'kim@shop.test', items: ['TC-8'] });
    expect(take.status).toBe(201);
    expect(assignees(a.saved() as never)['TC-8']).toBe('kim@shop.test');
    expect((await a.post('tester', 'PLAN-1', { to: 'kim@shop.test', items: ['TC-6'] })).status).toBe(403); // taken
    expect((await a.post('tester', 'PLAN-1', { to: 'sam@shop.test', items: ['TC-8'] })).status).toBe(403); // for someone
    expect((await a.post('tester', 'PLAN-1', { to: null, items: ['TC-6'] })).status).toBe(403); // not theirs
    expect((await a.post('tester', 'PLAN-1', { split: 'kim@shop.test' })).status).toBe(403);
    expect(
      (await a.post('tester', 'PLAN-1', { to: 'kim@shop.test', items: ['TC-8'], dry_run: true })).status,
    ).toBe(403);
    expect((await a.post('tester', 'PLAN-1', { to: null, items: ['TC-9'] })).status).toBe(201); // give back
    expect(assignees(a.saved() as never)['TC-9']).toBeUndefined();
    expect((await a.post('viewer', 'PLAN-1', { to: 'viv@shop.test', items: ['TC-8'] })).status).toBe(403);
    const n = a.wrote.size;
    expect((await a.post('agent', 'PLAN-1', { to: 'ci', items: ['TC-8'] })).status).toBe(403);
    const dry = await a.post('agent', 'PLAN-1', { split: 'alex@shop.test,sam@shop.test', dry_run: true });
    expect(dry.status).toBe(200); // an agent may propose
    expect(a.wrote.size).toBe(n);
  });

  it('is refused where definitions come from git', async () => {
    const f = await fakeDeps();
    const app = createApp({
      ...f.deps,
      bundleFiles: async () => new Map(),
      records: async () => [],
    } as ServerDeps);
    const res = await app.fetch(req('/api/plans/PLAN-1/assign', { json: { to: 'ci', items: ['TC-8'] } }));
    expect(res.status).toBe(409);
    const dry = await app.fetch(req('/api/plans/PLAN-1/assign', { json: { split: 'ci', dry_run: true } }));
    expect(dry.status).toBe(200);
  });

  it('GET /api/plans carries the assignee board and the automation mix', async () => {
    const a = await workspace();
    const plans = (await (await a.app.fetch(req('/api/plans'))).json()) as PlanView[];
    expect(plans[0]!.board?.rows.map((r) => [r.assignee, r.total])).toEqual([
      ['ci', 4],
      ['agent:claude', 1],
      ['alex@shop.test', 1],
      ['sam@shop.test', 1],
    ]);
    expect(plans[0]!.mix).toEqual({ people: 2, ci: 4, agents: 1, total: 7 });
    const record = a.written.at(-1) as FileRecord | undefined;
    expect(record).toBeUndefined();
  });
});
