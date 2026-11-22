/** Roles and customer assignment (docs/spec/security.md#roles), over examples/shop. */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assignedTo,
  buildModel,
  canInvite,
  computeStatus,
  customerModel,
  EMAIL,
  inviteItems,
  isAssignee,
  ownedFeatures,
  ownedModel,
  roleOf,
} from '../src/index.js';
import { SCOPE, SHOP, shop, storeRecords } from './fixtures.js';

const ROLES = { lead: ['QA-Leads'], tester: ['kim@shop.test'], customer: ['uat'] };

describe('roleOf', () => {
  it('matches the actor ID or a group without case; the highest role wins; else the default', () => {
    expect(roleOf(ROLES, { id: 'alex@shop.test', groups: ['qa-leads', 'uat'] })).toBe('lead');
    expect(roleOf(ROLES, { id: 'KIM@shop.test', groups: [] })).toBe('tester');
    expect(roleOf(ROLES, { id: 'sam@acme.test', groups: ['UAT'] })).toBe('customer');
    expect(roleOf(ROLES, { id: 'eve@other.test', groups: [] })).toBeUndefined();
    expect(roleOf({ ...ROLES, default: 'viewer' }, { id: 'eve@other.test', groups: [] })).toBe('viewer');
  });

  it('makes an invited assignee a customer only where no role list or default covers it', () => {
    const eve = { id: 'eve@other.test', groups: [] };
    expect(roleOf(ROLES, eve, true)).toBe('customer');
    expect(roleOf({ ...ROLES, default: 'viewer' }, eve, true)).toBe('viewer');
    expect(roleOf(ROLES, { id: 'kim@shop.test', groups: [] }, true)).toBe('tester');
    expect(
      [
        undefined,
        ROLES,
        { ...ROLES, default: 'customer' as const },
        { ...ROLES, default: 'viewer' as const },
      ].map(canInvite),
    ).toEqual([false, true, true, false]);
  });
});

describe('invites (docs/spec/security.md#customer-uat)', () => {
  const items = [
    { test_case: 'TC-6', assignee: 'alex@shop.test' },
    { test_case: 'TC-8', assignee: 'pat@client.test' },
    { test_case: 'TC-9' },
  ];
  it("assigns the chosen items, by default only the free ones, and revokes only the email's own", () => {
    const one = inviteItems(items, 'pat@client.test', ['tc-9']);
    expect(one).toMatchObject({ changed: ['TC-9'], reassigned: [], missing: [] });
    expect(one.items.map((i) => i.assignee)).toEqual([
      'alex@shop.test',
      'pat@client.test',
      'pat@client.test',
    ]);
    const all = inviteItems(items, 'pat@client.test', []);
    expect(all).toMatchObject({ changed: ['TC-9'], reassigned: [] });
    expect(all.items[0]).toEqual(items[0]);
    expect(inviteItems(items, 'pat@client.test', ['TC-6', 'TC-8'])).toMatchObject({
      changed: ['TC-6'],
      reassigned: ['TC-6'],
    });
    const off = inviteItems(items, 'PAT@client.test', [], true);
    expect(off).toMatchObject({ changed: ['TC-8'], reassigned: [] });
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

describe('feature owners (docs/spec/concepts.md#feature-owners)', () => {
  it('lists the features whose owners name the person or one of their groups, without case', async () => {
    const { model } = buildModel(await shop(), []);
    expect(ownedFeatures(model, { id: 'Alex@shop.test', groups: [] })).toEqual(['FEAT-2']);
    expect(ownedFeatures(model, { id: 'kim@shop.test', groups: ['QA@shop.test'] })).toEqual(['FEAT-1']);
    expect(ownedFeatures(model, { id: 'sam@shop.test', groups: ['qa@shop.test'] })).toEqual([
      'FEAT-1',
      'FEAT-3',
    ]);
    expect(ownedFeatures(model, { id: 'qa@shop.test', groups: [] })).toEqual([]); // a group owner is not an ID
  });

  it('narrows status and the gate to the owned features; the full model is unchanged', async () => {
    const b = await shop();
    const { model } = buildModel(b, storeRecords(join(SHOP, '../store')));
    const m = ownedModel(model, ['FEAT-2']);
    expect(m.features.map((f) => f.data.key)).toEqual(['FEAT-2']);
    expect([...m.useCases.keys()]).toEqual(['UC-2', 'UC-3']);
    const s = computeStatus(m, SCOPE);
    expect(s.testCases.map((t) => t.key)).toEqual(['TC-3', 'TC-4', 'TC-5', 'TC-6']);
    expect(s.useCases.map((u) => u.key)).toEqual(['UC-2', 'UC-3']);
    const full = computeStatus(model, SCOPE);
    for (const t of s.testCases) expect(t).toEqual(full.testCases.find((x) => x.key === t.key));
    expect(full.testCases.length).toBeGreaterThan(4);
    expect(ownedModel(model, []).testCases.size).toBe(0);
  });
});
