import { DECISION_POLICY_DEFAULTS, type Judgement, type Priority } from '@indx-watch/bundle';
import { describe, expect, it } from 'vitest';
import { decide, runFacts, type TestCaseNode } from '../src/index.js';

const P = DECISION_POLICY_DEFAULTS;
type Ctx = {
  priority: Priority;
  mode: string;
  reported: 'blocked' | 'skipped' | null;
  judges?: string[];
};
const ctx: Ctx = { priority: 'P1', mode: 'playwright', reported: null };
let n = 0;
const j = (
  kind: Judgement['kind'],
  verdict: Judgement['verdict'],
  extra: Partial<Judgement> = {},
): Judgement => ({
  id: `jdg_01JF7Z3K0W8N2Q4R6S8T0V${String(++n).padStart(4, '0')}`,
  kind,
  verdict,
  at: '2026-11-19T04:00:00Z',
  ...extra,
});
const rule = (js: Judgement[], c: Partial<Ctx> = {}, policy = P) => decide(js, policy, { ...ctx, ...c });

describe('decision policy rows', () => {
  it('1: the last human judgement wins (human beats assert fail)', () => {
    const d = rule([
      j('assert', 'fail'),
      j('human', 'fail', { at: '2026-11-19T05:00:00Z' }),
      j('human', 'pass', { at: '2026-11-19T06:00:00Z' }),
    ]);
    expect(d).toMatchObject({ verdict: 'pass', rule: 1 });
  });
  it('1: order is by at, then id, not by array position', () => {
    const late = j('human', 'fail', { at: '2026-11-19T07:00:00Z' });
    expect(rule([late, j('human', 'pass', { at: '2026-11-19T06:00:00Z' })]).verdict).toBe('fail');
  });
  it('2: reported blocked or a machine blocked judgement', () => {
    expect(rule([j('assert', 'pass')], { reported: 'blocked' })).toMatchObject({
      verdict: 'blocked',
      rule: 2,
    });
    expect(rule([j('assert', 'fail'), j('llm', 'skipped')])).toMatchObject({ verdict: 'skipped', rule: 2 });
    expect(rule([j('llm', 'skipped')], { reported: 'blocked' }).verdict).toBe('blocked');
  });
  it('3: an assert fail beats an llm pass', () => {
    expect(rule([j('llm', 'pass', { confidence: 0.99 }), j('assert', 'fail')])).toMatchObject({
      verdict: 'fail',
      rule: 3,
    });
  });
  it('4: a confident llm fail', () => {
    expect(rule([j('llm', 'fail', { confidence: 0.9 })])).toMatchObject({ verdict: 'fail', rule: 4 });
  });
  it('5: a visual diff over the threshold, or without a ratio', () => {
    expect(rule([j('visual', 'diff', { diff_ratio: 0.2 })])).toMatchObject({
      verdict: 'needs_review',
      rule: 5,
    });
    expect(rule([j('visual', 'fail')])).toMatchObject({ rule: 5 });
  });
  it('6: an unsure llm, a missing confidence (counts as 0) or an unconfident fail', () => {
    expect(rule([j('llm', 'pass', { confidence: 0.5 })])).toMatchObject({ verdict: 'needs_review', rule: 6 });
    expect(rule([j('llm', 'pass')])).toMatchObject({ rule: 6 });
    expect(rule([j('llm', 'fail', { confidence: 0.5 })])).toMatchObject({ rule: 6 });
    expect(rule([j('llm', 'unknown', { confidence: 0.95 })])).toMatchObject({ rule: 6 });
  });
  it('7: require_human_for and hybrid mode', () => {
    expect(
      rule([j('assert', 'pass')], { priority: 'P0' }, { ...P, require_human_for: ['P0'] }),
    ).toMatchObject({ rule: 7 });
    expect(rule([j('assert', 'pass')], { mode: 'hybrid' })).toMatchObject({
      verdict: 'needs_review',
      rule: 7,
    });
  });
  it('8: every judgement passes, a visual diff within the threshold counts as pass', () => {
    expect(
      rule([
        j('assert', 'pass'),
        j('visual', 'diff', { diff_ratio: 0.005 }),
        j('llm', 'pass', { confidence: 0.9 }),
      ]),
    ).toMatchObject({
      verdict: 'pass',
      rule: 8,
    });
  });
  it('8 needs a judgement of every declared judge kind; otherwise 10', () => {
    const agent = [j('llm', 'pass', { confidence: 0.95 })];
    expect(rule(agent, { judges: ['human'], mode: 'manual', priority: 'P0' })).toMatchObject({
      verdict: 'needs_review',
      rule: 10,
    });
    expect(rule([j('assert', 'pass')], { judges: ['assert', 'visual'] }).rule).toBe(10);
    expect(rule([j('assert', 'pass')], { judges: ['assert'] })).toMatchObject({ verdict: 'pass', rule: 8 });
    expect(rule([...agent, j('human', 'pass')], { judges: ['human'] })).toMatchObject({ rule: 1 });
  });
  it("runFacts: a test case without [[judges]] declares its mode's default (human, assert)", () => {
    const tc = (mode: string, judges?: { kind: string }[]) =>
      ({ priority: 'P1', policy: P, data: { mode, judges } }) as unknown as TestCaseNode;
    expect(runFacts(tc('manual'), null).judges).toEqual(['human']);
    expect(runFacts(tc('playwright'), null).judges).toEqual(['assert']);
    expect(runFacts(tc('agent'), null).judges).toBeUndefined();
    expect(runFacts(tc('manual', [{ kind: 'llm' }]), 'blocked')).toEqual({
      ...{ priority: 'P1', mode: 'manual', reported: 'blocked', judges: ['llm'] },
    });
    // an agent's confident pass of a manual test case waits for a person
    const agent = [j('llm', 'pass', { confidence: 1 })];
    expect(decide(agent, P, runFacts(tc('manual'), null))).toMatchObject({
      verdict: 'needs_review',
      rule: 10,
    });
  });
  it('judgement order compares instants, not strings, across precisions', () => {
    const early = j('human', 'fail', { at: '2026-11-19T04:00:00Z' });
    expect(rule([j('human', 'pass', { at: '2026-11-19T04:00:00.100Z' }), early]).verdict).toBe('pass');
  });
  it('9: no judgements', () => {
    expect(rule([])).toMatchObject({ verdict: 'needs_review', rule: 9 });
  });
  it('10: anything else, e.g. an assert with verdict unknown', () => {
    expect(rule([j('assert', 'unknown')])).toMatchObject({ verdict: 'needs_review', rule: 10 });
  });
});
