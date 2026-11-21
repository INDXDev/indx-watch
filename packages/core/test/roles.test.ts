/** Roles and customer assignment (docs/spec/security.md#roles), over examples/shop. */
import { describe, expect, it } from 'vitest';
import { assignedTo, buildModel, computeStatus, customerModel, roleOf } from '../src/index.js';
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
