// bundleDiff over examples/shop with hand-made edits (docs/spec/concepts.md#bundle-diff).
import { describe, expect, it } from 'vitest';
import { bundleDiff } from '../src/index.js';
import { shop } from './fixtures.js';

describe('bundleDiff', () => {
  it('reports nothing for the same bundle', async () => {
    const b = await shop();
    expect(bundleDiff(b, structuredClone(b))).toEqual({ added: [], changed: [], removed: [] });
  });

  it('lists added, changed (with what) and removed items, sorted', async () => {
    const base = await shop();
    const head = structuredClone(base);
    const tc3 = head.testCases.find((t) => t.data.key === 'TC-3')!;
    tc3.data.steps[0]!.expected = 'Something else';
    const removedTc = head.testCases.pop()!;
    const uc = head.useCases.find((u) => u.data.key === tc3.useCase)!;
    const ac = uc.data.criteria[0]!;
    ac.text = 'Reworded criterion';
    uc.data.criteria.push({ id: 'ac_01JF7Z3K0W8N2Q4R6S8T0VZZZZ', key: `${ac.key}9`, text: 'New one' });
    const diff = bundleDiff(base, head);
    expect(diff.removed.map((e) => e.key)).toEqual([removedTc.data.key]);
    expect(diff.added).toEqual([{ kind: 'ac', key: `${ac.key}9`, title: 'New one' }]);
    const by = Object.fromEntries(diff.changed.map((e) => [e.key, e.what]));
    expect(by[ac.key]).toEqual(['title']);
    expect(by['TC-3']).toContain('steps');
    expect(by['TC-3']).not.toContain('title');
  });

  it('flags a reworded criterion on the test cases that cover it, and a changed fixture as data', async () => {
    const base = await shop();
    const head = structuredClone(base);
    const tc = head.testCases.find((t) => t.data.fixtures?.length)!;
    const key = tc.data.covers[0]!;
    for (const u of head.useCases) for (const c of u.data.criteria) if (c.key === key) c.text = 'Reworded';
    head.fixtures.find((f) => f.data.key === tc.data.fixtures![0]!.ref)!.version = 'fxv:000000000000';
    const by = Object.fromEntries(bundleDiff(base, head).changed.map((e) => [e.key, e.what]));
    expect(by[tc.data.key]).toEqual(['criteria', 'data']);
  });
});
