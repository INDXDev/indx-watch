/** Read routes: project, status, specs, test cases, fixtures, plans, runs and the unverified marks. */
import { buildVerifiedModel } from '@indx-watch/core';
import { describe, expect, it } from 'vitest';
import type {
  FixtureDetail,
  PlanView,
  ProjectInfo,
  RunDetail,
  RunSummary,
  SpecTree,
  StatusResult,
  TestCaseDetail,
} from '../src/index.js';
import { createApp } from '../src/index.js';
import { app, get, jaStatus } from './app-helpers.js';
import { ALEX, fakeDeps, req, SHOT_SHA, sampleRecords, shop } from './helpers.js';

const RELEASE = 'v1.2.0';

/** examples/shop with TC-4 edited in memory, so its translations are outdated. */
async function shopWithTc4(
  edit: (data: Awaited<ReturnType<typeof shop>>['testCases'][number]['data']) => object,
) {
  const bundle = await shop();
  const tc4 = bundle.testCases.find((t) => t.data.key === 'TC-4')!;
  tc4.data = { ...tc4.data, ...edit(tc4.data) };
  return bundle;
}

describe('read routes: project and status', () => {
  it('GET /healthz and /api/project', async () => {
    const { app: a } = await app();
    expect(await get(a, '/healthz')).toEqual({ ok: true });
    const p = await get<ProjectInfo>(a, '/api/project');
    expect(p.project).toMatchObject({
      key: 'SHOP',
      current_release: RELEASE,
      default_environment: 'staging',
    });
    expect(p.identity).toEqual(ALEX);
    expect(p.mode).toBe('local');
    expect(p.sync).toEqual({ configured: false });
    expect(p.environments[0]).toMatchObject({ name: 'staging', access: 'public' });
  });

  it('GET /api/status defaults to the current release and filters by env', async () => {
    const { app: a } = await app();
    const s = await get<StatusResult>(a, '/api/status');
    expect(s.scope).toEqual({ release: RELEASE });
    const byKey = Object.fromEntries(s.testCases.map((t) => [t.key, t.status]));
    expect(byKey).toMatchObject({
      'TC-1': 'pass',
      'TC-2': 'waived',
      'TC-4': 'fail',
      'TC-6': 'needs_review',
      'TC-8': 'stale',
    });
    const other = await get<StatusResult>(a, '/api/status?env=production');
    expect(other.testCases.every((t) => t.status === 'untested')).toBe(true);
  });
});

describe('read routes: specs and test cases', () => {
  it('GET /api/specs builds the tree and marks outdated translations stale', async () => {
    const bundle = await shopWithTc4(() => ({ title: 'Expired coupon is refused' }));
    const { app: a } = await app({ bundle });
    const tree = await get<SpecTree>(a, '/api/specs');
    const uc2 = tree.features.flatMap((f) => f.useCases).find((u) => u.key === 'UC-2')!;
    expect(uc2).toMatchObject({ priority: 'P0', status: 'fail', done: false });
    const tcs = uc2.criteria.flatMap((c) => c.testCases);
    expect(tcs.map((t) => [t.key, t.status, t.lifecycle])).toEqual([
      ['TC-3', 'pass', 'ready'],
      ['TC-4', 'fail', 'ready'],
    ]);
    expect(jaStatus(tcs[1]!)).toBe('stale');
    const tc8 = tree.features.flatMap((f) =>
      f.useCases.flatMap((u) => u.criteria.flatMap((c) => c.testCases)),
    );
    expect(jaStatus(tc8.find((t) => t.key === 'TC-8')!)).toBe('machine');
  });

  it('GET /api/test-cases/:key with fixture values, never secrets', async () => {
    const { app: a } = await app();
    const tc3 = await get<TestCaseDetail>(a, '/api/test-cases/TC-3');
    expect(tc3).toMatchObject({ key: 'TC-3', priority: 'P0', useCase: 'UC-2' });
    expect(tc3.fixtures[0]).toMatchObject({
      key: 'FX-1',
      rows: ['SUMMER10'],
      values: [{ code: 'SUMMER10' }],
    });
    expect(tc3.status.status).toBe('pass');
    expect(tc3.runs).toHaveLength(1);
    const tc8 = await get<TestCaseDetail>(a, '/api/test-cases/tc_01JF3Q8M5X2V7K9D4R6T1W0Y38');
    expect(tc8.fixtures[0]!.values).toEqual([{ username: 'casey@shop.test' }]);
    const res = await a.fetch(req('/api/test-cases/TC-99'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not-found', message: 'test case TC-99 not found' } });
  });

  it("GET /api/test-cases/:key marks an edited step's translation stale", async () => {
    const before = await get<TestCaseDetail>((await app()).app, '/api/test-cases/TC-4');
    expect(jaStatus(before.data.steps[0]!)).toBe('reviewed');
    const bundle = await shopWithTc4(({ steps: [step, ...rest] }) => ({
      steps: [{ ...step!, expected: `${step!.expected} Edited.` }, ...rest],
    }));
    const { app: a } = await app({ bundle });
    const after = await get<TestCaseDetail>(a, '/api/test-cases/TC-4');
    expect(jaStatus(after.data.steps[0]!)).toBe('stale');
    expect(jaStatus(after.data)).not.toBe('stale'); // only that step
  });
});

describe('read routes: fixtures and plans', () => {
  it('GET /api/fixtures and /api/fixtures/:key', async () => {
    const { app: a } = await app();
    const all = await get<FixtureDetail[]>(a, '/api/fixtures');
    expect(all.map((f) => f.key)).toEqual(['FX-1', 'FX-2', 'FX-3', 'FX-4']);
    const fx1 = await get<FixtureDetail>(a, '/api/fixtures/FX-1');
    expect(fx1.preview?.rows).toHaveLength(2);
    expect(fx1.usedBy).toEqual(['TC-3', 'TC-4']);
    const fx2 = all.find((f) => f.key === 'FX-2')!;
    expect(fx2.preview?.text).toContain('Canvas Tote');
    expect(all.find((f) => f.key === 'FX-3')!.preview).toEqual({
      rows: [{ username: 'casey@shop.test', secret_ref: 'env:SHOP_CUSTOMER_PASSWORD' }],
    });
    expect(all.find((f) => f.key === 'FX-4')!.files[0]).toMatchObject({
      pointer: true,
      media_type: 'image/png',
      sha256: SHOT_SHA,
    });
    expect((await a.fetch(req('/api/fixtures/FX-9'))).status).toBe(404);
  });

  it('GET /api/plans and /api/plans/:key compute item status', async () => {
    const { app: a } = await app();
    expect((await get<PlanView[]>(a, '/api/plans')).map((p) => p.key)).toEqual(['PLAN-1']);
    const plan = await get<PlanView>(a, '/api/plans/PLAN-1');
    const st = Object.fromEntries(plan.items.map((i) => [i.test_case, i.status]));
    expect(st).toEqual({
      'TC-6': 'review',
      'TC-8': 'review',
      'TC-9': 'todo',
      'TC-3': 'done',
      'TC-4': 'done',
      'TC-5': 'done',
      'TC-7': 'done',
    });
    expect(plan.items[1]).toMatchObject({ environment: 'staging', due: '2026-11-28' });
    expect((await a.fetch(req('/api/plans/PLAN-9'))).status).toBe(404);
  });
});

describe('read routes: runs', () => {
  it('GET /api/runs and /api/runs/:id', async () => {
    const { app: a } = await app();
    const runs = await get<RunSummary[]>(a, `/api/runs?release=${RELEASE}&limit=3`);
    expect(runs).toHaveLength(3);
    const tc8 = await get<RunSummary[]>(a, '/api/runs?tc=TC-8');
    expect(tc8[0]).toMatchObject({ testCase: 'TC-8', stale: true, verdict: 'pass', rule: 1 });
    const d = await get<RunDetail>(a, `/api/runs/${tc8[0]!.id}`);
    expect(d.testCase).toMatchObject({ key: 'TC-8', title: 'Wrong password is rejected' });
    expect(d.testCase.currentVersion).not.toBe(d.record.test_case.version);
    expect((await a.fetch(req(`/api/runs/${tc8[0]!.id.slice(0, 26)}`))).status).toBe(404); // ambiguous prefix
    expect((await a.fetch(req('/api/runs/run_01JF7Z3K0W8N2Q4R6S8T0V9999'))).status).toBe(404);
  });

  it('marks records that claim a verified via without a signature as unverified (runs, run, report)', async () => {
    const f = await fakeDeps();
    const records = sampleRecords(f.bundle);
    f.deps.loadModel = async () => ({
      model: (await buildVerifiedModel(f.bundle, records)).model,
      problems: [],
    });
    const a = createApp(f.deps);
    const runs = await get<RunSummary[]>(a, `/api/runs?release=${RELEASE}`);
    const tc1 = runs.find((r) => r.testCase === 'TC-1')!;
    expect(tc1).toMatchObject({ actor: { via: 'github' }, unverified: true });
    expect(runs.find((r) => r.testCase === 'TC-7')).not.toHaveProperty('unverified'); // via = "git" is self-asserted
    const detail = await get<RunDetail>(a, `/api/runs/${tc1.id}`);
    expect(detail.unverified).toEqual([tc1.id, ...detail.judgements.map((j) => j.id)]); // its inline judgements too
    const md = await (await a.fetch(req('/api/report?format=md'))).text();
    expect(md).toContain('octocat (ci) · unverified');
  });
});
