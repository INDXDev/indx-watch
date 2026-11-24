// insights() and notifyEvents(): hand-made records over the shop bundle (docs/spec/concepts.md#insights).
import type { AnyRecord, Bundle } from '@indx-watch/bundle';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildModel, insights, notifyEvents, notifyState } from '../src/index.js';
import { run, shop } from './fixtures.js';

let b: Bundle;
beforeAll(async () => {
  const base = await shop();
  const old = base.releases[0]!;
  // a released v1.1.0 next to the shop's v1.2.0
  b = {
    ...base,
    releases: [
      { ...old, data: { ...old.data, version: 'v1.1.0', state: 'released', target_date: '2026-10-01' } },
      ...base.releases,
    ],
  };
});
const model = (records: AnyRecord[], bundle = b) => buildModel(bundle, records).model;
const manual = (key: string, release: string, seconds: number, ended = '2026-11-19T04:10:00Z') => ({
  ...run(b, key, { release, ended, kind: 'human' }),
  actor: { kind: 'human' as const, id: 'alex@shop.test', via: 'git' as const },
  source: 'manual' as const,
  started_at: new Date(Date.parse(ended) - seconds * 1000).toISOString().replace(/\.\d+Z$/, 'Z'),
});

describe('insights()', () => {
  it('has one row per release, oldest first, and no pass rate without results', () => {
    const r = insights(
      model([run(b, 'TC-3', { release: 'v1.1.0' }), run(b, 'TC-4', { release: 'v1.1.0', verdict: 'fail' })]),
    );
    expect(r.releases.map((x) => x.version)).toEqual(['v1.1.0', 'v1.2.0']);
    expect(r.releases[0]!.passRate).toBe(0.5);
    expect(r.releases[1]!.passRate).toBeNull();
    expect(insights(model([])).releases.every((x) => x.passRate === null)).toBe(true);
  });

  it('counts a test case once per release: the later run wins', () => {
    const r = insights(
      model([
        run(b, 'TC-3', { release: 'v1.1.0', verdict: 'fail', ended: '2026-11-19T04:00:00Z' }),
        run(b, 'TC-3', { release: 'v1.1.0', verdict: 'pass', ended: '2026-11-19T05:00:00Z' }),
      ]),
    );
    expect(r.releases[0]!.passRate).toBe(1);
  });

  it('lists assignees of the chosen release by plan item status, people first', () => {
    const r = insights(model([run(b, 'TC-3')]), { release: 'v1.2.0' });
    const ci = r.assignees.find((a) => a.assignee === 'ci')!;
    expect(ci.done).toBe(1);
    expect(r.assignees.at(0)!.assignee).toMatch(/@/);
    expect(r.assignees.findIndex((a) => a.assignee === 'ci')).toBeGreaterThan(
      r.assignees.findIndex((a) => a.assignee === 'alex@shop.test'),
    );
    expect(insights(model([]), { release: 'v0' }).assignees).toEqual([]);
  });

  it('adds up features: pass, fail and open make the ready tests', () => {
    const r = insights(model([run(b, 'TC-3'), run(b, 'TC-4', { verdict: 'fail' })]), { release: 'v1.2.0' });
    expect(r.features.length).toBeGreaterThan(0);
    for (const f of r.features) expect(f.pass + f.fail + f.open).toBe(f.tests);
    expect(r.features.reduce((n, f) => n + f.pass, 0)).toBe(1);
    expect(r.features.reduce((n, f) => n + f.fail, 0)).toBe(1);
  });

  it('takes the median of manual runs by people only', () => {
    const recs = [
      manual('TC-3', 'v1.1.0', 60),
      manual('TC-4', 'v1.1.0', 120),
      manual('TC-6', 'v1.2.0', 300),
      run(b, 'TC-5'), // automated
      { ...manual('TC-7', 'v1.2.0', 5000), started_at: undefined }, // no start
      manual('TC-8', 'v1.2.0', 90000), // over a day: ignored
    ];
    const m = insights(model(recs as AnyRecord[])).manual;
    expect(m.samples).toBe(3);
    expect(m.median).toBe(120);
    expect(m.byRelease).toEqual([
      { version: 'v1.1.0', median: 90, samples: 2 },
      { version: 'v1.2.0', median: 300, samples: 1 },
    ]);
    expect(insights(model([])).manual).toEqual({ median: null, samples: 0, byRelease: [] });
  });
});

describe('notifyEvents()', () => {
  const at = '2026-11-19T12:00:00Z';
  const base = () => notifyState(model([]), '2026-11-19T00:00:00Z');

  it('has nothing to say about an unchanged model', () => {
    const m = model([]);
    expect(notifyEvents(m, notifyState(m, at))).toEqual([]);
  });

  it('reports failing and needs_review runs recorded after the state, with links', () => {
    const fail = run(b, 'TC-3', { verdict: 'fail', ended: '2026-11-19T04:00:00Z' });
    const review = run(b, 'TC-4', { kind: 'llm', verdict: 'pass', ended: '2026-11-19T05:00:00Z' });
    const old = run(b, 'TC-5', { verdict: 'fail', ended: '2026-11-18T04:00:00Z' });
    const m = model([fail, review, old]);
    const out = notifyEvents(m, base(), { appUrl: 'https://watch.shop.test/' });
    expect(out.map((x) => x.event)).toEqual(['run_failed', 'run_needs_review']);
    expect(out[0]).toEqual({
      event: 'run_failed',
      text: 'TC-3 failed in v1.2.0 (staging).',
      url: `https://watch.shop.test/#/runs/${fail.id}`,
    });
    expect(notifyEvents(m, base(), { since: '2026-11-19T04:30:00Z' }).map((x) => x.event)).toEqual([
      'run_needs_review',
    ]);
    expect(notifyEvents(m, base())[0]!.url).toBeUndefined();
  });

  it('speaks Japanese on request', () => {
    const m = model([run(b, 'TC-3', { verdict: 'fail', ended: '2026-11-19T04:00:00Z' })]);
    expect(notifyEvents(m, base(), { locale: 'ja' })[0]!.text).toBe('TC-3 が失敗しました v1.2.0 (staging)。');
  });

  it('reports a gate that changed, not one that stayed', () => {
    const m = model([]);
    const prev = { ...base(), gates: { 'v1.2.0': true } };
    const out = notifyEvents(m, prev);
    expect(out).toHaveLength(1);
    expect(out[0]!.event).toBe('gate_changed');
    expect(out[0]!.text).toMatch(/^Release v1\.2\.0 is not ready: \d+ checks? fail/);
    expect(notifyEvents(m, { ...base(), gates: { 'v1.2.0': false } })).toEqual([]);
    expect(notifyEvents(m, { ...base(), gates: {} })).toEqual([]); // a new release is a baseline
  });

  it('groups new assignments by plan and assignee, and ignores unchanged ones', () => {
    const m = model([]);
    const prev = base();
    delete prev.assigned['PLAN-1#TC-6'];
    delete prev.assigned['PLAN-1#TC-8'];
    prev.assigned['PLAN-1#TC-9'] = 'sam@shop.test'; // reassigned to agent:claude
    const out = notifyEvents(m, prev).filter((x) => x.event === 'assigned');
    expect(out.map((x) => x.text)).toEqual([
      '1 test case in PLAN-1 is assigned to alex@shop.test: TC-6.',
      '1 test case in PLAN-1 is assigned to sam@shop.test: TC-8.',
      '1 test case in PLAN-1 is assigned to agent:claude: TC-9.',
    ]);
  });

  it('names AI drafts that wait for approval once', () => {
    const draft = (t: (typeof b.testCases)[number]) => ({
      ...t,
      data: { ...t.data, status: 'draft' as const, origin: 'ai' as const },
    });
    const m = model([], { ...b, testCases: b.testCases.map((t) => (t.data.key === 'TC-3' ? draft(t) : t)) });
    const out = notifyEvents(m, base()); // TC-9 and TC-10 are drafts of the shop already
    expect(out.filter((x) => x.event === 'approval_waiting').map((x) => x.text)).toEqual([
      '1 draft waits for approval: TC-3.',
    ]);
    expect(notifyEvents(m, notifyState(m, at))).toEqual([]);
  });
});
