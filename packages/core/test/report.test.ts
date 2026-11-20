// reportData on the examples/shop sample results: sections, waivers and customer redaction.
import type { AnyRecord, Bundle } from '@indx-watch/bundle';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildModel, reportData } from '../src/index.js';
import { SCOPE, sampleRecords, shop, versionOf, waiver } from './fixtures.js';

let b: Bundle;
beforeAll(async () => {
  b = await shop();
});
const model = (records: AnyRecord[]) => buildModel(b, records).model;
const opts = {
  audience: 'internal' as const,
  generatedBy: 'qa@shop.test',
  now: new Date('2026-11-19T00:00:00Z'),
  plan: 'PLAN-1',
  cursor: 'c1',
};

describe('reportData', () => {
  it('has the header, policy, thresholds and counts', () => {
    const r = reportData(model(sampleRecords(b)), SCOPE, opts);
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
  });

  it('lists plan items, failures and runs', () => {
    const r = reportData(model(sampleRecords(b)), SCOPE, opts);
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
  });

  it('lists only waivers that apply to the current version', () => {
    const waived = (v: string) => reportData(model([...sampleRecords(b), waiver(b, 'TC-2', v)]), SCOPE, opts);
    expect(waived(versionOf(b, 'TC-2')).waivers.map((w) => w.testCase)).toEqual(['TC-2']);
    expect(waived('tcv:000000000000').waivers).toEqual([]); // not applied: another version
  });

  it('redacts e-mail addresses and notes for customers', () => {
    const c = reportData(model(sampleRecords(b)), SCOPE, { ...opts, audience: 'customer' });
    expect(JSON.stringify(c)).not.toMatch(/@shop\.test|Total stayed/);
  });
});
