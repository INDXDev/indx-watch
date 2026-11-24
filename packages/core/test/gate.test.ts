// computeStatus (coverage, counts, use case done) and the readiness gate on examples/shop.
import { join } from 'node:path';
import type { AnyRecord, Bundle } from '@indx-watch/bundle';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildModel, computeStatus, evaluateGate, type GateResult } from '../src/index.js';
import { run, SCOPE, SHOP, sampleRecords, shop, storeRecords, versionOf, waiver } from './fixtures.js';

let b: Bundle;
beforeAll(async () => {
  b = await shop();
});
const model = (records: AnyRecord[], bundle = b) => buildModel(bundle, records).model;
/** Checks by key as [passed, actual, expected, items]. */
const checksOf = (g: GateResult) =>
  Object.fromEntries(g.checks.map((c) => [c.key, [c.passed, c.actual, c.expected, c.items]]));
/** Gate checks of `records` by key as [passed, actual, expected]. */
const gateMap = (records: AnyRecord[]) =>
  Object.fromEntries(
    evaluateGate(model(records), SCOPE).checks.map((c) => [c.key, [c.passed, c.actual, c.expected]]),
  );
const humanPass = { kind: 'human' as const, verdict: 'pass' as const };

describe('computeStatus on the sample results', () => {
  it('counts ready test cases and covered criteria', () => {
    const s = computeStatus(model(sampleRecords(b)), SCOPE);
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
  });

  it('computes use case status and done', () => {
    const s = computeStatus(model(sampleRecords(b)), SCOPE);
    expect(s.useCases.map((u) => [u.key, u.status, u.done])).toEqual([
      ['UC-1', 'fail', false],
      ['UC-2', 'pass', true],
      ['UC-3', 'pass', true],
      ['UC-4', 'untested', false],
      ['UC-5', 'uncovered', false],
    ]);
  });

  it('includes the gate, with items only on failing checks', () => {
    const s = computeStatus(model(sampleRecords(b)), SCOPE);
    expect(s.gate.passed).toBe(false);
    expect(checksOf(s.gate)).toEqual({
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
});

describe('readiness gate checks', () => {
  it('the sample store examples/shop/store gives the gate documented in reports.md#example', () => {
    const g = evaluateGate(model(storeRecords(join(SHOP, '../store'))), SCOPE);
    expect(g.passed).toBe(false);
    expect(checksOf(g)).toEqual({
      has_gated_tests: [true, '8', '≥ 1', undefined],
      p0_coverage: [true, '6/6', '≥ 1.00', undefined],
      p0_all_pass: [false, '5/6', '6/6', ['TC-8']],
      p1_pass_rate: [true, '2/2 (1.00)', '≥ 0.95', undefined],
      max_needs_review: [true, '0', '≤ 0', undefined],
      max_untested: [true, '0', '≤ 0', undefined],
      allow_stale: [true, '0', '≤ 0', undefined],
      require_evidence: [true, '5/5', '5/5', undefined],
    });
  });

  it('passes once TC-8 passes and TC-2 is waived', () => {
    const recs = [
      ...sampleRecords(b),
      run(b, 'TC-8', { judgements: [humanPass], evidence: true }),
      waiver(b, 'TC-2', versionOf(b, 'TC-2')),
    ];
    expect(evaluateGate(model(recs), SCOPE).passed).toBe(true);
    expect(gateMap(recs).p1_pass_rate).toEqual([true, '2/2 (1.00)', '≥ 0.95']);
  });

  it('a stale result fails allow_stale', () => {
    const g = gateMap([
      ...sampleRecords(b),
      run(b, 'TC-8', { judgements: [humanPass], version: 'tcv:000000000000' }),
    ]);
    expect(g.allow_stale).toEqual([false, '1', '≤ 0']);
    expect(g.require_evidence).toEqual([true, '5/5', '5/5']);
  });

  it('a P0 pass without evidence fails require_evidence', () => {
    const g = gateMap([...sampleRecords(b), run(b, 'TC-8', { judgements: [humanPass] })]);
    expect(g.require_evidence).toEqual([false, '5/6', '6/6']);
  });
});

describe('readiness gate scope', () => {
  it('a check with an empty denominator passes with n/a', () => {
    const drafts: Bundle = structuredClone(b);
    for (const t of drafts.testCases) t.data.status = 'draft';
    const g = Object.fromEntries(
      evaluateGate(model([], drafts), SCOPE).checks.map((c) => [c.key, [c.passed, c.actual]]),
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
    const g = evaluateGate(model([], p2), SCOPE);
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

  it('a definition file that does not load fails valid_definitions, listed first', () => {
    const recs = [
      ...sampleRecords(b),
      run(b, 'TC-8', { judgements: [humanPass], evidence: true }),
      waiver(b, 'TC-2', versionOf(b, 'TC-2')),
    ];
    expect(evaluateGate(model(recs), SCOPE).passed).toBe(true);
    const file = 'specs/FEAT-3-account/UC-4-customer-signs-in/use-case.toml';
    const g = evaluateGate(model(recs, { ...b, invalidFiles: [file] }), SCOPE);
    expect(g.passed).toBe(false);
    expect(g.checks[0]).toEqual({
      key: 'valid_definitions',
      passed: false,
      actual: '1',
      expected: '≤ 0',
      items: [file],
    });
  });

  it('release.plan limits the gate to the plan', () => {
    const scoped: Bundle = structuredClone(b);
    scoped.releases[0]!.data.plan = 'PLAN-1';
    scoped.plans[0]!.data.items = scoped.plans[0]!.data.items!.filter((i) => i.test_case !== 'TC-8');
    const recs = sampleRecords(scoped);
    const checks = Object.fromEntries(
      evaluateGate(model(recs, scoped), SCOPE).checks.map((c) => [c.key, c.actual]),
    );
    expect(checks).toMatchObject({ p0_all_pass: '5/5', p1_pass_rate: 'n/a', max_untested: '0' });
  });
});
