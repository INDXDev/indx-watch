// buildModel, testCaseStatus (variants, ordering, scope, staleness, waivers), plan items and localize.
import { type AnyRecord, type Bundle, type RunRecord, testCaseVersion } from '@indx-watch/bundle';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildModel,
  evaluateGate,
  type LocalizeOptions,
  localize,
  planItemStatus,
  testCaseStatus,
} from '../src/index.js';
import {
  retraction,
  review,
  run,
  sampleRecords,
  SCOPE as scope,
  shop,
  versionOf,
  waiver,
} from './fixtures.js';

let b: Bundle;
beforeAll(async () => {
  b = await shop();
});
const model = (records: AnyRecord[], bundle = b) => buildModel(bundle, records).model;
/** Criterion text by key, the input of testCaseVersion. */
const criterionText = (bundle: Bundle) =>
  new Map(bundle.useCases.flatMap((u) => u.data.criteria.map((c) => [c.key, c.text] as const)));

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

describe('test case status: variants and ordering', () => {
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

  it('scopes by release and environment', () => {
    const m = model([run(b, 'TC-1', { release: 'v1.1.0' }), run(b, 'TC-7', { environment: 'local' })]);
    expect(testCaseStatus(m, 'TC-1', scope).status).toBe('untested');
    expect(testCaseStatus(m, 'TC-7', scope).status).toBe('pass');
    expect(testCaseStatus(m, 'TC-7', { ...scope, environment: 'staging' }).status).toBe('untested');
  });
});

describe('test case status: staleness', () => {
  it('rewording a covered AC makes results stale; a translation edit does not', async () => {
    const r = run(b, 'TC-4');
    const reworded: Bundle = structuredClone(b);
    const uc = reworded.useCases.find((u) => u.data.key === 'UC-2')!;
    uc.data.criteria[1]!.text = 'Reworded.';
    const text = criterionText(reworded);
    for (const t of reworded.testCases) t.version = await testCaseVersion(t.data, text);
    const s = testCaseStatus(model([r], reworded), 'TC-4', scope);
    expect(s).toMatchObject({ status: 'stale', verdict: 'pass', stale: true });
    const translated: Bundle = structuredClone(b);
    translated.useCases.find((u) => u.data.key === 'UC-2')!.data.criteria[1]!.i18n!.ja!.text = '別の訳';
    expect(testCaseStatus(model([r], translated), 'TC-4', scope).status).toBe('pass');
  });

  it('a title edit keeps the version; a step edit changes it and makes earlier results stale', async () => {
    const r = run(b, 'TC-3');
    const text = criterionText(b);
    const edit = async (change: (d: Bundle['testCases'][number]['data']) => void) => {
      const edited: Bundle = structuredClone(b);
      const tc = edited.testCases.find((t) => t.data.key === 'TC-3')!;
      change(tc.data);
      tc.version = await testCaseVersion(tc.data, text);
      return { version: tc.version, status: testCaseStatus(model([r], edited), 'TC-3', scope) };
    };
    const retitled = await edit((d) => {
      d.title = 'Renamed';
    });
    expect(retitled.version).toBe(r.test_case.version);
    expect(retitled.status.status).toBe('pass');
    const restepped = await edit((d) => {
      d.steps[0]!.expected = 'Something else.';
    });
    expect(restepped.version).not.toBe(r.test_case.version);
    expect(restepped.status).toMatchObject({ status: 'stale', verdict: 'pass', stale: true });
  });

  it('a different fixture version makes a result stale', () => {
    const r = run(b, 'TC-3');
    r.fixtures[0]!.version = 'fxv:000000000000';
    expect(testCaseStatus(model([r]), 'TC-3', scope).status).toBe('stale');
  });
});

describe('test case status: waivers', () => {
  it('a waiver binds to the test case version', () => {
    const fail = run(b, 'TC-2', { verdict: 'fail' });
    const status = (...records: AnyRecord[]) => testCaseStatus(model([fail, ...records]), 'TC-2', scope);
    expect(status(waiver(b, 'TC-2', versionOf(b, 'TC-2')))).toMatchObject({ status: 'waived', waived: true });
    expect(status(waiver(b, 'TC-2', 'tcv:000000000000')).status).toBe('fail');
  });

  it('a revoked waiver no longer applies', () => {
    const w = waiver(b, 'TC-2', versionOf(b, 'TC-2'));
    const revoke = waiver(b, 'TC-2', versionOf(b, 'TC-2'), '2026-11-19T06:00:00Z', w.id);
    const m = model([run(b, 'TC-2', { verdict: 'fail' }), w, revoke]);
    expect(testCaseStatus(m, 'TC-2', scope).status).toBe('fail');
  });

  it('a waiver is refused for a P0 test case', () => {
    const m = model([run(b, 'TC-3', { verdict: 'fail' }), waiver(b, 'TC-3', versionOf(b, 'TC-3'))]);
    expect(testCaseStatus(m, 'TC-3', scope).status).toBe('fail');
  });
});

describe('test case status: flakiness', () => {
  const at = (i: number) => `2026-11-19T${String(i).padStart(2, '0')}:00:00Z`;
  const series = (verdicts: ('pass' | 'fail')[], o = {}) =>
    verdicts.map((verdict, i) => run(b, 'TC-2', { verdict, ended: at(i), ...o }));

  it('counts pass/fail flips and flaky passes over the last 10 decided runs', () => {
    // 12 runs p f p p…: runs #1 and #2 flip; the window (last 10) holds only #2
    const runs = series(['pass', 'fail', 'pass', ...Array(9).fill('pass')]);
    expect(testCaseStatus(model(runs), 'TC-2', scope).flaky).toEqual({ rate: 0.1, flakes: 1, runs: 10 });
    const retried = run(b, 'TC-2', {
      judgements: [{ kind: 'assert', verdict: 'pass', flaky: true }],
      ended: at(13),
    });
    expect(testCaseStatus(model([...runs, retried]), 'TC-2', scope).flaky).toEqual({
      rate: 0.1,
      flakes: 1,
      runs: 10,
    });
    expect(testCaseStatus(model(series(['pass', 'pass'])), 'TC-2', scope).flaky).toBeUndefined();
  });

  it('ignores blocked runs, other variants, shards of one execution and version changes', () => {
    const blocked = run(b, 'TC-2', { reported: 'blocked', ended: at(1) });
    const [p, f] = series(['pass', 'fail']);
    const webkit = run(b, 'TC-2', { verdict: 'fail', project: 'webkit', ended: at(2) });
    expect(testCaseStatus(model([p!, blocked, webkit]), 'TC-2', scope).flaky).toBeUndefined();
    const shards = series(['pass', 'fail'], { group: 'g1' });
    expect(testCaseStatus(model(shards), 'TC-2', scope).flaky).toBeUndefined();
    const old = run(b, 'TC-2', { verdict: 'fail', version: 'tcv:000000000000', ended: at(0) });
    const fixed = run(b, 'TC-2', { verdict: 'pass', ended: at(1) });
    expect(testCaseStatus(model([old, fixed]), 'TC-2', scope).flaky).toBeUndefined();
    expect(testCaseStatus(model([p!, f!]), 'TC-2', scope).flaky).toEqual({ rate: 0.5, flakes: 1, runs: 2 });
  });

  it('a lone change across builds is a regression or a fix, not a flake; back and forth is', () => {
    const build = (r: RunRecord, commit: string) => ({ ...r, build: { commit } });
    const steady = series(['pass', 'pass', 'fail', 'fail', 'pass']).map((r, i) =>
      build(r, i < 2 ? 'aaaaaaa' : i < 4 ? 'bbbbbbb' : 'ccccccc'),
    );
    expect(testCaseStatus(model(steady), 'TC-2', scope).flaky).toBeUndefined();
    const back = series(['pass', 'fail', 'pass']).map((r, i) => build(r, `${i}`.repeat(7)));
    expect(testCaseStatus(model(back), 'TC-2', scope).flaky).toEqual({ rate: 1 / 3, flakes: 1, runs: 3 });
  });

  it('compares a run with the previous run of the same test case version', () => {
    const [p1, , f1] = series(['pass', 'fail', 'fail']);
    const v2 = run(b, 'TC-2', { verdict: 'fail', version: 'tcv:000000000000', ended: at(1) });
    expect(testCaseStatus(model([p1!, v2, f1!]), 'TC-2', scope).flaky).toMatchObject({ flakes: 1 });
  });

  it('changes neither the status nor the gate', () => {
    const steady = series(['pass', 'pass']);
    const flaky = series(['fail', 'pass']);
    expect(testCaseStatus(model(flaky), 'TC-2', scope).status).toBe(
      testCaseStatus(model(steady), 'TC-2', scope).status,
    );
    expect(evaluateGate(model(flaky), scope)).toEqual(evaluateGate(model(steady), scope));
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
