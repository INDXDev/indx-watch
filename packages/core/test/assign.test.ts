/** Splitting, the board and the automation mix (docs/spec/concepts.md#assignment-and-automation-mix), over examples/shop. */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assigneeBoard,
  assignItems,
  automationMix,
  buildModel,
  parseSplit,
  splitAssignments,
} from '../src/index.js';
import { SHOP, shop, storeRecords } from './fixtures.js';

const model = async () => buildModel(await shop(), storeRecords(join(SHOP, '../store'))).model;
const who = (a: { items: { test_case: string; assignee?: string }[] }) =>
  Object.fromEntries(a.items.map((i) => [i.test_case, i.assignee]));

describe('parseSplit', () => {
  it('reads weights after the last colon, default 1, and refuses what is not an assignee', () => {
    const spec = 'alex@shop.test:2, sam@shop.test, agent:claude:1, agent:codex, group:qa:3, ci:2';
    expect(parseSplit(spec)).toEqual([
      { who: 'alex@shop.test', weight: 2 },
      { who: 'sam@shop.test', weight: 1 },
      { who: 'agent:claude', weight: 1 },
      { who: 'agent:codex', weight: 1 },
      { who: 'group:qa', weight: 3 },
      { who: 'ci', weight: 2 },
    ]);
    expect(() => parseSplit('')).toThrow(/names nobody/);
    expect(() => parseSplit('alex')).toThrow(/not an assignee/);
    expect(() => parseSplit('alex@shop.test:0')).toThrow(/weight/);
    expect(() => parseSplit('ci,ci')).toThrow(/twice/);
  });
});

describe('splitAssignments', () => {
  it('gives owners their own features first, then fills the rest by weight', async () => {
    const m = await model();
    const r = splitAssignments(m, 'PLAN-1', parseSplit('alex@shop.test:2,sam@shop.test:1,agent:claude:1'));
    // alex owns FEAT-2 (TC-3 to TC-6) but has room for three (plan order among equals: TC-6, TC-3, TC-4); sam owns FEAT-3 (TC-7 to TC-9) with room for two
    expect(who(r)).toEqual({
      'TC-3': 'alex@shop.test',
      'TC-4': 'alex@shop.test',
      'TC-5': 'agent:claude',
      'TC-6': 'alex@shop.test',
      'TC-7': 'sam@shop.test',
      'TC-8': 'sam@shop.test',
      'TC-9': 'agent:claude',
    });
    expect(r.load).toEqual({ 'alex@shop.test': 3, 'sam@shop.test': 2, 'agent:claude': 2 });
    expect(r.unassigned).toBe(0);
    expect(r.changes.find((c) => c.test_case === 'TC-3')).toEqual({
      test_case: 'TC-3',
      assignee: 'alex@shop.test',
      from: 'ci',
    });
  });

  it('is deterministic', async () => {
    const m = await model();
    const w = parseSplit('a@x.test:3,b@x.test:2,c@x.test:1');
    expect(splitAssignments(m, 'PLAN-1', w)).toEqual(splitAssignments(m, 'PLAN-1', w));
  });

  it('spreads the P0 items so that one person does not hold them all', async () => {
    const m = await model();
    const r = splitAssignments(m, 'PLAN-1', parseSplit('x@x.test,y@x.test'));
    const p0 = ['TC-3', 'TC-4', 'TC-5', 'TC-7', 'TC-8'];
    const mine = p0.filter((k) => who(r)[k] === 'x@x.test');
    expect(mine.length).toBeGreaterThan(1);
    expect(mine.length).toBeLessThan(p0.length);
    expect(Object.values(r.load).sort()).toEqual([3, 4]);
  });

  it('with onlyUnassigned keeps assignees and counts them toward their share', async () => {
    const m = await model();
    const open = new Set(['TC-3', 'TC-4']);
    const items = m.plans[0]!.items!.map((i) => (open.has(i.test_case) ? { test_case: i.test_case } : i));
    const part = { ...m, plans: [{ ...m.plans[0]!, items }] };
    const r = splitAssignments(part, 'PLAN-1', parseSplit('sam@shop.test,alex@shop.test'), {
      onlyUnassigned: true,
    });
    expect(who(r)['TC-6']).toBe('alex@shop.test'); // kept
    expect(who(r)['TC-8']).toBe('sam@shop.test'); // kept
    expect(who(r)['TC-5']).toBe('ci'); // kept, not in the weights
    expect(r.changes.map((c) => c.test_case)).toEqual(['TC-3', 'TC-4']);
    expect(r.unassigned).toBe(0);
  });
});

describe('assignItems', () => {
  it('assigns named items, takes assignees off and reports unknown keys', async () => {
    const m = await model();
    const r = assignItems(m, 'plan-1', 'kim@shop.test', ['tc-3', 'TC-6', 'TC-99']);
    expect(r.missing).toEqual(['TC-99']);
    expect(r.changes.map((c) => [c.test_case, c.assignee, c.from])).toEqual([
      ['TC-6', 'kim@shop.test', 'alex@shop.test'],
      ['TC-3', 'kim@shop.test', 'ci'],
    ]);
    const back = assignItems(m, 'PLAN-1', null, ['TC-8']);
    expect(who(back)['TC-8']).toBeUndefined();
    expect(back.changes).toEqual([{ test_case: 'TC-8', assignee: '', from: 'sam@shop.test' }]);
    expect(back.unassigned).toBe(1);
  });
});

describe('assigneeBoard and automationMix', () => {
  it('counts items by assignee and status, most items first, unassigned last', async () => {
    const m = await model();
    const b = assigneeBoard(m, 'PLAN-1');
    expect(b.total).toBe(7);
    expect(b.rows[0]).toMatchObject({ assignee: 'ci', total: 4 });
    expect(b.rows.map((r) => r.assignee)).toEqual(['ci', 'agent:claude', 'alex@shop.test', 'sam@shop.test']);
    for (const r of b.rows) expect(r.todo + r.done + r.blocked + r.review).toBe(r.total);
    expect(b.unassigned.total).toBe(0);
    const open = assignItems(m, 'PLAN-1', null, ['TC-6', 'TC-8']);
    const m2 = { ...m, plans: [{ ...m.plans[0]!, items: open.items }] };
    expect(assigneeBoard(m2, 'PLAN-1').unassigned.total).toBe(2);
  });

  it('counts who runs the items: CI by assignee or Playwright mode, agents, people', async () => {
    const m = await model();
    expect(automationMix(m, m.plans)).toEqual({ people: 2, ci: 4, agents: 1, total: 7 });
    const items = [
      { test_case: 'TC-6', assignee: 'agent:claude' },
      { test_case: 'TC-10' },
      { test_case: 'TC-3', assignee: 'sam@shop.test' },
      { test_case: 'TC-8' },
    ];
    expect(automationMix(m, [{ items }])).toEqual({ people: 1, ci: 1, agents: 2, total: 4 });
    expect(automationMix(m, [])).toEqual({ people: 0, ci: 0, agents: 0, total: 0 });
  });
});
