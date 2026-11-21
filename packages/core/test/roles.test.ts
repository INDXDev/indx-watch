/** Roles and customer assignment (docs/spec/security.md#roles), over examples/shop. */
import { describe, expect, it } from 'vitest';
import {
  assignedTo,
  buildModel,
  computeStatus,
  customerModel,
  EMAIL,
  inviteItems,
  isAssignee,
  roleOf,
} from '../src/index.js';
import { SCOPE, shop } from './fixtures.js';

const ROLES = { lead: ['QA-Leads'], tester: ['kim@shop.test'], customer: ['uat'] };

describe('roleOf', () => {
  it('matches the actor ID or a group without case; the highest role wins; else the default', () => {
    expect(roleOf(ROLES, { id: 'alex@shop.test', groups: ['qa-leads', 'uat'] })).toBe('lead');
    expect(roleOf(ROLES, { id: 'KIM@shop.test', groups: [] })).toBe('tester');
    expect(roleOf(ROLES, { id: 'sam@acme.test', groups: ['UAT'] })).toBe('customer');
    expect(roleOf(ROLES, { id: 'eve@other.test', groups: [] })).toBeUndefined();
    expect(roleOf({ ...ROLES, default: 'viewer' }, { id: 'eve@other.test', groups: [] })).toBe('viewer');
  });

  it('makes an invited assignee a customer ahead of default, never above a listed role', () => {
    const eve = { id: 'eve@other.test', groups: [] };
    expect(roleOf({ ...ROLES, default: 'viewer' }, eve, true)).toBe('customer');
    expect(roleOf(ROLES, { id: 'kim@shop.test', groups: [] }, true)).toBe('tester');
  });
});

describe('invites (docs/spec/security.md#customer-uat)', () => {
  const items = [
    { test_case: 'TC-6', assignee: 'alex@shop.test' },
    { test_case: 'TC-8', assignee: 'pat@client.test' },
    { test_case: 'TC-9' },
  ];
  it("assigns the chosen items (all by default) and revokes only the email's own assignments", () => {
    const one = inviteItems(items, 'pat@client.test', ['tc-9']);
    expect(one).toMatchObject({ selected: ['TC-9'], missing: [] });
    expect(one.items.map((i) => i.assignee)).toEqual([
      'alex@shop.test',
      'pat@client.test',
      'pat@client.test',
    ]);
    expect(
      inviteItems(items, 'pat@client.test', []).items.every((i) => i.assignee === 'pat@client.test'),
    ).toBe(true);
    const off = inviteItems(items, 'PAT@client.test', [], true);
    expect(off.items).toEqual([items[0], { test_case: 'TC-8' }, { test_case: 'TC-9' }]);
    expect(inviteItems(items, 'pat@client.test', ['TC-1']).missing).toEqual(['TC-1']);
  });
  it('isAssignee and EMAIL', () => {
    expect(isAssignee([{ items }], 'Pat@client.test')).toBe(true);
    expect(isAssignee([{ items }, {}], 'eve@other.test')).toBe(false);
    expect(['pat@client.test', 'group:uat@x.test', 'ci', 'a@b'].map((e) => EMAIL.test(e))).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });
});

describe('customerModel', () => {
  it('keeps only assigned plan items (by email or group:) and what lies above and below them', async () => {
    const b = await shop();
    const { model } = buildModel(b, []);
    const sam = { id: 'Sam@shop.test', groups: ['uat'] };
    expect(assignedTo({ test_case: 'TC-8', assignee: 'sam@shop.test' }, sam)).toBe(true);
    expect(assignedTo({ test_case: 'TC-8', assignee: 'group:UAT' }, sam)).toBe(true);
    expect(assignedTo({ test_case: 'TC-8', assignee: 'group:sam@shop.test' }, sam)).toBe(false);
    expect(assignedTo({ test_case: 'TC-8', assignee: 'ci' }, sam)).toBe(false);

    const m = customerModel(model, sam);
    expect([...m.testCases.keys()]).toEqual(['TC-8']);
    expect(m.plans.flatMap((p) => p.items ?? []).map((i) => i.test_case)).toEqual(['TC-8']);
    expect(
      m.features.flatMap((f) => f.useCases.flatMap((u) => u.criteria.flatMap((c) => c.testCases))),
    ).toEqual(['TC-8']);
    expect(computeStatus(m, SCOPE).testCases.map((t) => t.key)).toEqual(['TC-8']);

    // a group assignment adds that item
    const plans = model.plans.map((p) => ({
      ...p,
      items: p.items?.map((i) => (i.test_case === 'TC-6' ? { ...i, assignee: 'group:uat' } : i)),
    }));
    expect([...customerModel({ ...model, plans }, sam).testCases.keys()].sort()).toEqual(['TC-6', 'TC-8']);
    expect(customerModel(model, { id: 'eve@other.test', groups: [] }).testCases.size).toBe(0);
  });
});
