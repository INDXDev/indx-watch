/** bundleDiff: what a change did to use cases, criteria and test cases (docs/spec/concepts.md#bundle-diff). */
import type { Bundle } from '@indx-watch/bundle';

export type DiffKind = 'uc' | 'ac' | 'tc';
export type DiffPart = 'title' | 'steps' | 'criteria' | 'data' | 'details';
/** what: the parts of a changed item that differ (a criterion only has `title`, its text); only in `changed`. */
export interface DiffEntry {
  kind: DiffKind;
  key: string;
  title: string;
  what?: DiffPart[];
}
export interface BundleDiff {
  added: DiffEntry[];
  changed: DiffEntry[];
  removed: DiffEntry[];
}

type Item = { key: string; title: string; parts: Partial<Record<DiffPart, string>> };

/** JSON with sorted keys, so field order never counts as a change. */
const same = (v: unknown): string =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );

function items(b: Bundle): Map<string, Item> {
  const out = new Map<string, Item>();
  const fxv = new Map(b.fixtures.map((f) => [f.data.key, f.version]));
  const text = new Map<string, string>();
  for (const { data: uc } of b.useCases) {
    const { criteria, ...rest } = uc;
    out.set(uc.id, { key: uc.key, title: uc.title, parts: { title: same(uc.title), details: same(rest) } });
    for (const c of criteria) {
      text.set(c.key, c.text);
      out.set(c.id, { key: c.key, title: c.text, parts: { title: same(c.text) } });
    }
  }
  for (const { data: tc } of b.testCases) {
    const { steps, covers, fixtures, title, ...rest } = tc;
    const parts = {
      title: same(title),
      steps: same(steps),
      criteria: same(covers.map((k) => [k, text.get(k)])),
      data: same((fixtures ?? []).map((f) => [f, fxv.get(f.ref)])),
      details: same(rest),
    };
    out.set(tc.id, { key: tc.key, title, parts });
  }
  return out;
}

const kindOf = (key: string): DiffKind =>
  key.startsWith('TC-') ? 'tc' : key.startsWith('UC-') ? 'uc' : 'ac';
const num = (k: string) => k.split(/[-.]/).slice(1).map(Number);

/** Items match by id, so a renumbered key is a change, not a removal plus an addition. Sorted by kind (UC, AC, TC), then key. */
export function bundleDiff(base: Bundle, head: Bundle): BundleDiff {
  const [a, b] = [items(base), items(head)];
  const out: BundleDiff = { added: [], changed: [], removed: [] };
  const entry = (i: Item, what?: DiffPart[]): DiffEntry => ({
    kind: kindOf(i.key),
    key: i.key,
    title: i.title,
    ...(what ? { what } : {}),
  });
  for (const [id, h] of b) {
    const o = a.get(id);
    if (!o) {
      out.added.push(entry(h));
      continue;
    }
    const what = (Object.keys(h.parts) as DiffPart[]).filter((p) => h.parts[p] !== o.parts[p]);
    if (o.key !== h.key && !what.includes('details') && h.parts.details !== undefined) what.push('details');
    if (what.length) out.changed.push(entry(h, what));
  }
  for (const [id, o] of a) if (!b.has(id)) out.removed.push(entry(o));
  const order = ['uc', 'ac', 'tc'];
  const cmp = (x: DiffEntry, y: DiffEntry) => {
    const [p, q] = [num(x.key), num(y.key)];
    return order.indexOf(x.kind) - order.indexOf(y.kind) || p[0]! - q[0]! || (p[1] ?? 0) - (q[1] ?? 0);
  };
  for (const list of Object.values(out)) list.sort(cmp);
  return out;
}
