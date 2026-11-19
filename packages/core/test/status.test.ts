import type { AnyRecord, Bundle } from '@indx-watch/bundle';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildModel,
  computeStatus,
  evaluateGate,
  type LocalizeOptions,
  localize,
  planItemStatus,
  reportData,
  testCaseStatus,
} from '../src/index.js';
import { retraction, review, run, sampleRecords, shop, waiver } from './fixtures.js';

let b: Bundle;
beforeAll(async () => {
  b = await shop();
});
const scope = { release: 'v1.2.0' };
const model = (records: AnyRecord[], bundle = b) => buildModel(bundle, records).model;
const gateMap = (records: AnyRecord[], s = scope) =>
  Object.fromEntries(
    evaluateGate(model(records), s).checks.map((c) => [c.key, [c.passed, c.actual, c.expected]]),
  );

describe('buildModel', () => {
  it('resolves nodes, priorities and keys', () => {
    const m = model([]);
    expect(m.features.map((f) => f.useCases.map((u) => u.data.key))).toEqual([
      ['UC-1'],
      ['UC-2', 'UC-3'],
      ['UC-4', 'UC-5'],
    ]);
    expect(m.testCases.get('TC-6')?.priority).toBe('P0');
    expect(m.testCases.get('TC-1')?.priority).toBe('P1');
    expect(m.useCases.get('UC-5')?.criteria[0]).toMatchObject({ testCases: [], draftTestCases: ['TC-9'] });
    expect(m.fixtures.get('FX-2')?.usedBy).toEqual(['TC-1', 'TC-2', 'TC-3', 'TC-4', 'TC-5', 'TC-6']);
    expect(m.keyOf('tc_01JF3Q8M5X2V7K9D4R6T1W0Y33')).toBe('TC-3');
    expect(m.keyOf('SHOP:TC-3')).toBe('TC-3');
    expect(m.keyOf('ac_01JF3Q8M5X2V7K9D4R6T1W0Y22')).toBe('AC-2.1');
    expect(m.keyOf('TC-99')).toBeUndefined();
  });

  it('fills judgement at/by and orders later judgements', () => {
    const r = run(b, 'TC-2', { verdict: 'fail' });
    const m = model([r, review(b, r.id, 'pass', '2026-11-19T05:00:00Z')]);
    const v = m.runs.get(r.id)!;
    expect(v.judgements.map((x) => [x.kind, x.at, x.by?.id])).toEqual([
      ['assert', '2026-11-19T04:00:00Z', 'github:octocat'],
      ['human', '2026-11-19T05:00:00Z', 'alex@shop.test'],
    ]);
    expect(v.decision).toMatchObject({ verdict: 'pass', rule: 1 });
  });

  it('skips invalid records with a warning and hides retracted ones', () => {
    const r = run(b, 'TC-1', { verdict: 'fail' });
    const { model: m, warnings } = buildModel(b, [r, retraction(b, r.id), { kind: 'nope' } as never]);
    expect(warnings).toHaveLength(1);
    expect(m.runs.get(r.id)?.retracted).toBe(true);
    expect(testCaseStatus(m, 'TC-1', scope).status).toBe('untested');
  });
});

describe('test case status', () => {
  it('a failing webkit run and a later passing chromium run is fail', () => {
    const m = model([
      run(b, 'TC-3', { project: 'webkit', verdict: 'fail', ended: '2026-11-19T04:00:00Z' }),
      run(b, 'TC-3', { project: 'chromium', ended: '2026-11-19T05:00:00Z' }),
    ]);
    const s = testCaseStatus(m, 'TC-3', scope);
    expect(s.status).toBe('fail');
    expect(s.variants?.map((v) => [v.variant, v.verdict])).toEqual([
      ['webkit|', 'fail'],
      ['chromium|', 'pass'],
    ]);
  });

  it('the latest execution per variant wins; shards of one execution take the worst', () => {
    const m = model([
      run(b, 'TC-4', { verdict: 'fail', ended: '2026-11-19T03:00:00Z' }),
      run(b, 'TC-4', { ended: '2026-11-19T04:00:00Z', group: 'g1' }),
      run(b, 'TC-4', { verdict: 'fail', ended: '2026-11-19T03:30:00Z', group: 'g1' }),
    ]);
    expect(testCaseStatus(m, 'TC-4', scope).status).toBe('fail');
    const later = model([
      run(b, 'TC-4', { verdict: 'fail', ended: '2026-11-19T03:00:00Z' }),
      run(b, 'TC-4', { ended: '2026-11-19T04:00:00Z' }),
    ]);
    expect(testCaseStatus(later, 'TC-4', scope).status).toBe('pass');
  });

  it('an agent pass does not pass a test case that declares a human judge (TC-8)', () => {
    const m = model([run(b, 'TC-8', { judgements: [{ kind: 'llm', verdict: 'pass', confidence: 0.95 }] })]);
    expect(testCaseStatus(m, 'TC-8', scope).status).toBe('needs_review');
  });

  it('orders runs by instant, not by string, when timestamp precision differs', () => {
    const m = model([
      run(b, 'TC-1', { ended: '2026-11-19T04:00:00.100Z' }),
      run(b, 'TC-1', { verdict: 'fail', ended: '2026-11-19T04:00:00Z' }),
    ]);
    expect(testCaseStatus(m, 'TC-1', scope).status).toBe('pass');
  });

  it('rewording a covered AC makes results stale; a translation edit does not', async () => {
    const r = run(b, 'TC-4');
    const reworded: Bundle = structuredClone(b);
    const uc = reworded.useCases.find((u) => u.data.key === 'UC-2')!;
    uc.data.criteria[1]!.text = 'Reworded.';
    const { testCaseVersion } = await import('@indx-watch/bundle');
    const text = new Map(
      reworded.useCases.flatMap((u) => u.data.criteria.map((c) => [c.key, c.text] as const)),
    );
    for (const t of reworded.testCases) t.version = await testCaseVersion(t.data, text);
    const s = testCaseStatus(model([r], reworded), 'TC-4', scope);
    expect(s).toMatchObject({ status: 'stale', verdict: 'pass', stale: true });
    const translated: Bundle = structuredClone(b);
    translated.useCases.find((u) => u.data.key === 'UC-2')!.data.criteria[1]!.i18n!.ja!.text = '別の訳';
    expect(testCaseStatus(model([r], translated), 'TC-4', scope).status).toBe('pass');
  });

  it('a different fixture version makes a result stale', () => {
    const r = run(b, 'TC-3');
    r.fixtures[0]!.version = 'fxv:000000000000';
    expect(testCaseStatus(model([r]), 'TC-3', scope).status).toBe('stale');
  });

  it('scopes by release and environment', () => {
    const m = model([run(b, 'TC-1', { release: 'v1.1.0' }), run(b, 'TC-7', { environment: 'local' })]);
    expect(testCaseStatus(m, 'TC-1', scope).status).toBe('untested');
    expect(testCaseStatus(m, 'TC-7', scope).status).toBe('pass');
    expect(testCaseStatus(m, 'TC-7', { ...scope, environment: 'staging' }).status).toBe('untested');
  });

  it('waivers bind to the test case version and are refused for P0', () => {
    const tc2 = b.testCases.find((t) => t.data.key === 'TC-2')!;
    const fail = run(b, 'TC-2', { verdict: 'fail' });
    expect(testCaseStatus(model([fail, waiver(b, 'TC-2', tc2.version)]), 'TC-2', scope)).toMatchObject({
      status: 'waived',
      waived: true,
    });
    expect(testCaseStatus(model([fail, waiver(b, 'TC-2', 'tcv:000000000000')]), 'TC-2', scope).status).toBe(
      'fail',
    );
    const w = waiver(b, 'TC-2', tc2.version);
    const revoke = waiver(b, 'TC-2', tc2.version, '2026-11-19T06:00:00Z', w.id);
    expect(testCaseStatus(model([fail, w, revoke]), 'TC-2', scope).status).toBe('fail');
    const tc3 = b.testCases.find((t) => t.data.key === 'TC-3')!;
    expect(
      testCaseStatus(
        model([run(b, 'TC-3', { verdict: 'fail' }), waiver(b, 'TC-3', tc3.version)]),
        'TC-3',
        scope,
      ).status,
    ).toBe('fail');
  });
});

describe('computeStatus and the gate on examples/shop', () => {
  it('sample results', () => {
    const s = computeStatus(model(sampleRecords(b)), scope);
    expect(s.coverage).toEqual({ covered: 8, total: 9, ratio: 8 / 9 });
    expect(s.counts).toEqual({
      pass: 6,
      fail: 1,
      needs_review: 0,
      untested: 1, // TC-8; draft TC-9 is listed but not counted, like in the gate
      stale: 0,
      waived: 0,
      uncovered: 1,
      blocked: 0,
      skipped: 0,
    });
    expect(s.useCases.map((u) => [u.key, u.status, u.done])).toEqual([
      ['UC-1', 'fail', false],
      ['UC-2', 'pass', true],
      ['UC-3', 'pass', true],
      ['UC-4', 'untested', false],
      ['UC-5', 'uncovered', false],
    ]);
    expect(s.gate.passed).toBe(false);
    expect(
      Object.fromEntries(s.gate.checks.map((c) => [c.key, [c.passed, c.actual, c.expected, c.items]])),
    ).toEqual({
      has_gated_tests: [true, '8', '≥ 1', undefined],
      p0_coverage: [true, '6/6', '≥ 1.00', undefined],
      p0_all_pass: [false, '5/6', '6/6', ['TC-8']],
      p1_pass_rate: [false, '1/2 (0.50)', '≥ 0.95', ['TC-2']],
      max_needs_review: [true, '0', '≤ 0', undefined],
      max_untested: [false, '1', '≤ 0', ['TC-8']],
      allow_stale: [true, '0', '≤ 0', undefined],
      require_evidence: [true, '5/5', '5/5', undefined],
    });
  });

  it('passes once TC-8 passes and TC-2 is waived', () => {
    const tc2 = b.testCases.find((t) => t.data.key === 'TC-2')!;
    const recs = [
      ...sampleRecords(b),
      run(b, 'TC-8', { judgements: [{ kind: 'human', verdict: 'pass' }], evidence: true }),
      waiver(b, 'TC-2', tc2.version),
    ];
    const g = evaluateGate(model(recs), scope);
    expect(g.passed).toBe(true);
    expect(gateMap(recs).p1_pass_rate).toEqual([true, '2/2 (1.00)', '≥ 0.95']);
  });

  it('stale and evidence rules', () => {
    const recs = [
      ...sampleRecords(b),
      run(b, 'TC-8', { judgements: [{ kind: 'human', verdict: 'pass' }], version: 'tcv:000000000000' }),
    ];
    const g = gateMap(recs);
    expect(g.allow_stale).toEqual([false, '1', '≤ 0']);
    expect(g.require_evidence).toEqual([true, '5/5', '5/5']);
    const noProof = [
      ...sampleRecords(b),
      run(b, 'TC-8', { judgements: [{ kind: 'human', verdict: 'pass' }] }),
    ];
    expect(gateMap(noProof).require_evidence).toEqual([false, '5/6', '6/6']);
  });

  it('a check with an empty denominator passes with n/a', () => {
    const drafts: Bundle = structuredClone(b);
    for (const t of drafts.testCases) t.data.status = 'draft';
    const g = Object.fromEntries(
      evaluateGate(model([], drafts), scope).checks.map((c) => [c.key, [c.passed, c.actual]]),
    );
    expect(g).toEqual({
      has_gated_tests: [false, '0'],
      p0_coverage: [false, '0/6'],
      p0_all_pass: [true, 'n/a'],
      p1_pass_rate: [true, 'n/a'],
      max_needs_review: [true, 'n/a'],
      max_untested: [true, 'n/a'],
      allow_stale: [true, 'n/a'],
      require_evidence: [true, 'n/a'],
    });
  });

  it('nothing gated is never ready: a P2-only scope fails has_gated_tests', () => {
    const p2: Bundle = structuredClone(b);
    for (const u of p2.useCases) u.data.priority = 'P2';
    for (const t of p2.testCases) delete t.data.priority;
    const g = evaluateGate(model([], p2), scope);
    expect(g.passed).toBe(false);
    expect(g.checks[0]).toEqual({
      key: 'has_gated_tests',
      passed: false,
      actual: '0',
      expected: '≥ 1',
      items: [],
    });
    expect(g.checks.slice(1).every((c) => c.passed && c.actual === 'n/a')).toBe(true);
  });

  it('release.plan limits the gate to the plan', () => {
    const scoped: Bundle = structuredClone(b);
    scoped.releases[0]!.data.plan = 'PLAN-1';
    scoped.plans[0]!.data.items = scoped.plans[0]!.data.items!.filter((i) => i.test_case !== 'TC-8');
    const recs = sampleRecords(scoped);
    const checks = Object.fromEntries(
      evaluateGate(model(recs, scoped), scope).checks.map((c) => [c.key, c.actual]),
    );
    expect(checks).toMatchObject({ p0_all_pass: '5/5', p1_pass_rate: 'n/a', max_untested: '0' });
  });
});

describe('plan items', () => {
  it('status by item index', () => {
    const m = model([
      ...sampleRecords(b),
      run(b, 'TC-9', { judgements: [{ kind: 'llm', verdict: 'pass', confidence: 0.4 }] }),
    ]);
    const plan = b.plans[0]!.data;
    expect(plan.items!.map((_, i) => planItemStatus(m, 'PLAN-1', i))).toEqual([
      'done',
      'todo',
      'review',
      'done',
      'done',
      'done',
      'done',
    ]);
    expect(() => planItemStatus(m, 'PLAN-1', 99)).toThrow();
  });
});

describe('localize', () => {
  const fx = {
    title: 'Checkout',
    i18n: { ja: { title: '購入手続き', status: 'reviewed', source_hash: 'abc' } },
  };
  it('uses a valid translation', () => {
    expect(localize(fx, 'title', 'ja', { currentSourceHash: 'abc' })).toEqual({
      text: '購入手続き',
      locale: 'ja',
      fallback: false,
      stale: false,
    });
    expect(localize(fx, 'title', 'en')).toEqual({
      text: 'Checkout',
      locale: 'en',
      fallback: false,
      stale: false,
    });
  });
  it('falls back to the source when stale or missing', () => {
    expect(localize(fx, 'title', 'ja', { currentSourceHash: 'zzz' })).toEqual({
      text: 'Checkout',
      locale: 'en',
      fallback: true,
      stale: true,
    });
    expect(localize(fx, 'title', 'ja', { currentSourceHash: 'zzz', allowStale: true })).toMatchObject({
      text: '購入手続き',
      stale: true,
    });
    const opts: LocalizeOptions = { sourceLocale: 'en' };
    expect(localize({ title: 'Plain' }, 'title', 'ja', opts)).toEqual({
      text: 'Plain',
      locale: 'en',
      fallback: true,
      stale: false,
    });
    expect(localize({ title: 'Plain' }, 'title', 'en', opts)).toEqual({
      text: 'Plain',
      locale: 'en',
      fallback: false,
      stale: false,
    });
  });
});

describe('reportData', () => {
  it('has every section and redacts for customers', () => {
    const m = model(sampleRecords(b));
    const opts = {
      audience: 'internal' as const,
      generatedBy: 'qa@shop.test',
      now: new Date('2026-11-19T00:00:00Z'),
      plan: 'PLAN-1',
      cursor: 'c1',
    };
    const r = reportData(m, scope, opts);
    expect(r).toMatchObject({
      project: { key: 'SHOP', name: 'Shop' },
      generatedAt: '2026-11-19T00:00:00Z',
      plan: 'PLAN-1',
      cursor: 'c1',
    });
    expect(r.policy).toEqual({
      llm_pass_confidence: 0.8,
      llm_fail_confidence: 0.8,
      visual_threshold: 0.01,
      require_human_for: [],
    });
    expect(r.gateThresholds.p1_pass_rate).toBe(0.95);
    expect(r.countsByPriority.P0).toMatchObject({ pass: 5, untested: 1, ac_total: 6, ac_covered: 6 });
    expect(r.planItems?.[0]).toMatchObject({
      testCase: 'TC-6',
      assignee: 'alex@shop.test',
      due: '2026-11-26',
      environment: 'staging',
      status: 'done',
    });
    expect(r.failures.map((f) => [f.testCase, f.status, f.step, f.note])).toEqual([
      ['TC-8', 'untested', undefined, undefined],
      ['TC-2', 'fail', 1, 'Total stayed 40.00'],
    ]);
    expect(r.runs).toHaveLength(8);
    expect(r.runs[0]).toMatchObject({
      actor: 'octocat',
      actorKind: 'ci',
      source: 'playwright',
      commit: 'a1b2c3d',
      environment: 'staging',
    });
    const tc2 = b.testCases.find((t) => t.data.key === 'TC-2')!;
    const waived = (v: string) => reportData(model([...sampleRecords(b), waiver(b, 'TC-2', v)]), scope, opts);
    expect(waived(tc2.version).waivers.map((w) => w.testCase)).toEqual(['TC-2']);
    expect(waived('tcv:000000000000').waivers).toEqual([]); // not applied: another version
    const c = reportData(m, scope, { ...opts, audience: 'customer' });
    expect(JSON.stringify(c)).not.toMatch(/@shop\.test|Total stayed/);
  });
});
