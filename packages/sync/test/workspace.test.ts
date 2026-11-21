/** Workspace mode (docs/spec/sync.md#workspace-mode-v02): two clones edit definitions through one store. */
import { type Actor, type BundleFs, checkBundle, type FileRecord } from '@indx-watch/bundle';
import { memoryObjectStore } from '@indx-watch/store';
import { beforeAll, describe, expect, it } from 'vitest';
import { definitionFiles, headsOf, workspaceFiles } from '../src/index.js';
import { clone, dirFs, enc, shop, storeRecords } from './helpers.js';

const TC3 = 'specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-3-valid-coupon.toml';
const dec = new TextDecoder();
const human: Actor = { kind: 'human', id: 'alex@shop.test', via: 'git' };
const agent: Actor = { kind: 'agent', id: 'alex@shop.test', via: 'env', model: 'claude-opus-5-5' };

/** A working tree in memory. */
function memFs(files: Map<string, Uint8Array>): BundleFs {
  const names = (dir: string) => {
    const pre = dir ? `${dir}/` : '';
    const parts = [...files.keys()]
      .filter((k) => k.startsWith(pre))
      .map((k) => k.slice(pre.length).split('/'));
    return new Map(parts.map(([n = '', ...r]) => [n, r.length > 0]));
  };
  return {
    read: async (p) => files.get(p) ?? null,
    write: async (p, d) => void files.set(p, typeof d === 'string' ? enc.encode(d) : d),
    remove: async (p) => void files.delete(p),
    list: async (dir) => [...names(dir)].map(([name, d]) => ({ name, dir: d })),
  };
}

let shopFiles: Map<string, Uint8Array>;
beforeAll(async () => {
  shopFiles = await definitionFiles(dirFs(shop));
});

/** Two clones over one store; A starts with the shop bundle and publishes it, B starts empty and receives it. */
async function setup() {
  const objects = memoryObjectStore();
  const make = (files: Map<string, Uint8Array>, writer: string, actor = human) => {
    const c = clone(objects, writer);
    const fs = memFs(files);
    const sync = (who = actor) => c.sync({ workspace: { fs, actor: who } });
    const text = (p = TC3) => dec.decode(files.get(p) ?? new Uint8Array());
    const edit = (from: string, to: string, p = TC3) =>
      void files.set(p, enc.encode(text(p).replace(from, to)));
    return { ...c, syncWith: c.sync, fs, files, sync, text, edit };
  };
  const a = make(new Map(shopFiles), 'wa');
  const b = make(new Map(), 'wb');
  const first = await a.sync();
  expect(first.workspace?.published.length).toBe(shopFiles.size);
  expect((await b.sync()).workspace?.written.length).toBe(shopFiles.size);
  expect(b.files).toEqual(a.files);
  return { objects, a, b, make };
}
const errors = async (fs: BundleFs) =>
  (await checkBundle(fs)).problems.filter((p) => p.severity === 'error').map((p) => p.code);

describe('workspace mode', () => {
  it('merges edits of different fields from two clones into the same file', async () => {
    const { a, b } = await setup();
    a.edit('title = "Valid coupon reduces the total"', 'title = "A valid coupon lowers the total"');
    b.edit('mode = "playwright"', 'priority = "P0"\nmode = "playwright"');
    await a.sync();
    const rb = await b.sync();
    expect(rb.workspace).toMatchObject({ published: [TC3], written: [TC3], conflicts: [] });
    await a.sync();
    expect(a.text()).toContain('title = "A valid coupon lowers the total"');
    expect(a.text()).toContain('priority = "P0"');
    expect(a.files).toEqual(b.files);
    expect(await errors(a.fs)).toEqual([]);
    // a third sync on either side changes nothing
    expect((await a.sync()).workspace).toMatchObject({ published: [], written: [] });
    expect((await b.sync()).workspace).toMatchObject({ published: [], written: [] });
  });

  it('keeps both versions of a field edited on both sides until a person resolves it', async () => {
    const { a, b } = await setup();
    a.edit('Valid coupon reduces the total', 'Title from A');
    b.edit('Valid coupon reduces the total', 'Title from B');
    await a.sync();
    const rb = await b.sync();
    await a.sync();
    const [conflict] = rb.workspace!.conflicts;
    expect(conflict).toMatch(/TC-3-valid-coupon\.conflict-[0-9a-f]{8}\.toml$/);
    expect(a.files).toEqual(b.files);
    expect(a.files.has(conflict!)).toBe(true);
    expect(await errors(a.fs)).toEqual(['workspace-conflict']);
    // B resolves: edits the file and deletes the conflict file
    b.edit('Title from A', 'Title agreed');
    b.files.delete(conflict!);
    expect((await b.sync()).workspace).toMatchObject({ published: [TC3], conflicts: [] });
    expect((await a.sync()).workspace?.removed).toEqual([conflict]);
    expect(a.text()).toContain('title = "Title agreed"');
    expect(a.files).toEqual(b.files);
    expect(await errors(a.fs)).toEqual([]);
  });

  it('applies deletes and new files, and an edit wins over a concurrent delete', async () => {
    const { a, b } = await setup();
    a.files.delete(TC3);
    b.edit('Valid coupon', 'Kept coupon');
    await a.sync();
    await b.sync();
    await a.sync();
    expect(a.text()).toContain('Kept coupon');
    b.files.delete(TC3);
    await b.sync();
    expect((await a.sync()).workspace?.removed).toEqual([TC3]);
    expect(a.files.has(TC3)).toBe(false);
  });

  it('publishes an agent change only as an AI draft', async () => {
    const { objects, a } = await setup();
    const before = (await storeRecords(objects)).length;
    a.edit('Valid coupon reduces the total', 'Agent title');
    const r = await a.sync(agent);
    expect(r.workspace?.held).toEqual([TC3]);
    expect(r.warnings?.some((w) => w.includes('not an AI draft'))).toBe(true);
    expect((await storeRecords(objects)).length).toBe(before);
    a.edit('status = "ready"', 'status = "draft"\norigin = "ai"');
    a.edit(
      '[[fixtures]]',
      '[ai]\nmodel = "claude-opus-5-5"\ncreated_at = 2026-11-21T00:00:00Z\n\n[[fixtures]]',
    );
    expect((await a.sync(agent)).workspace?.published).toEqual([TC3]);
  });

  it('holds a TOML file that does not parse instead of publishing a delete of its entity', async () => {
    const { objects, a, b } = await setup();
    const before = (await storeRecords(objects)).length;
    a.edit('title = "Valid coupon', 'title = Valid coupon');
    const broken = a.text();
    const r = await a.sync();
    expect(r.workspace).toMatchObject({ published: [], written: [], removed: [], held: [TC3] });
    expect(r.warnings?.some((w) => w.includes('does not parse'))).toBe(true);
    expect(a.text()).toBe(broken);
    expect((await storeRecords(objects)).length).toBe(before);
    expect((await b.sync()).workspace?.removed).toEqual([]);
    // once fixed, the edit is published as usual
    a.edit('title = Valid coupon', 'title = "Fixed coupon');
    expect((await a.sync()).workspace?.published).toEqual([TC3]);
  });

  it('marks a file moved to different paths on both sides as a conflict', async () => {
    const { a, b } = await setup();
    const [toA, toB] = [TC3.replace('TC-3-valid', 'TC-3-a'), TC3.replace('TC-3-valid', 'TC-3-b')];
    a.files.set(toA, a.files.get(TC3)!);
    a.files.delete(TC3);
    b.files.set(toB, b.files.get(TC3)!);
    b.files.delete(TC3);
    await a.sync();
    const rb = await b.sync();
    await a.sync();
    expect(rb.workspace?.conflicts).toHaveLength(1);
    expect(a.files).toEqual(b.files);
    expect(await errors(a.fs)).toEqual(['workspace-conflict']);
  });

  it('runs the guard before applying, so a git-owned bundle is not synced', async () => {
    const { a } = await setup();
    const guard = () => {
      throw new Error('git tracks this bundle');
    };
    await expect(a.syncWith({ workspace: { fs: a.fs, actor: human, guard } })).rejects.toThrow('git tracks');
  });

  it('gives the hosted view the same files as the clones', async () => {
    const { objects, a, b } = await setup();
    a.edit('Valid coupon reduces the total', 'Title from A');
    b.edit('Valid coupon reduces the total', 'Title from B');
    await a.sync();
    await b.sync();
    await a.sync();
    const records = await storeRecords(objects);
    const heads = headsOf(records.filter((r): r is FileRecord => r.kind === 'file' && r.path === TC3));
    expect(heads).toHaveLength(2);
    const { files } = await workspaceFiles(records, (sha) => a.replica.getBlob(sha));
    expect(files).toEqual(a.files);
  });
});
