// Bundle snapshots published by syncOnce (opts.bundle): when they are written and what the tar holds.
import { AnyRecord as Schema } from '@indx-watch/bundle';
import { createResultStore, memoryObjectStore } from '@indx-watch/store';
import { unpackTar } from 'modern-tar';
import { describe, expect, it } from 'vitest';
import { runRecord } from '../../store/test/helpers/records.js';
import { actor, clone, dirFs, shop, storeRecords } from './helpers.js';

describe('bundle snapshots', () => {
  it('never writes a bundle record without opts.bundle', async () => {
    const objects = memoryObjectStore();
    const a = clone(objects, 'w');
    await a.replica.putRecord(runRecord());
    expect((await a.sync()).snapshot).toBeNull();
    expect((await storeRecords(objects)).filter((r) => r.kind === 'bundle')).toEqual([]);
  });

  it('publishes a deterministic tar once per definitions hash, only from a clean tree', async () => {
    const objects = memoryObjectStore();
    const fs = dirFs(shop);
    const bundle = {
      fs,
      clean: true,
      actor,
      commit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      ref: 'refs/heads/main',
      commitTime: '2026-11-19T04:00:00Z',
    };
    const a = clone(objects, 'w');
    expect((await a.sync({ bundle: { ...bundle, clean: false } })).snapshot).toBeNull();
    const r = await a.sync({ bundle });
    expect(r.snapshot).toMatch(/^rec_/);
    const [rec] = (await storeRecords(objects)).filter((x) => x.kind === 'bundle');
    expect(Schema.parse(rec)).toEqual(rec);
    if (rec?.kind !== 'bundle') throw new Error('no bundle record');
    expect(rec).toMatchObject({
      commit: bundle.commit,
      ref: bundle.ref,
      commit_time: bundle.commitTime,
      source: 'ci',
      actor,
    });
    const tar = (await createResultStore(objects).getBlob(rec.sha256))!;
    const entries = await unpackTar(tar);
    const names = entries.map((e) => e.header.name);
    expect(names).toContain('project.toml');
    expect(names).toEqual([...names].sort());
    expect(names.some((n) => n.startsWith('runs/') || n.startsWith('cache/') || n.startsWith('.'))).toBe(
      false,
    );
    expect(rec.files).toBe(names.length);
    expect(entries.every((e) => e.header.mtime?.getTime() === 0)).toBe(true);

    expect((await a.sync({ bundle })).snapshot).toBeNull();
    const b = clone(objects, 'w2');
    expect((await b.sync({ bundle })).snapshot).toBeNull(); // a snapshot of the same definitions exists
    await fs.write('README.md', '# changed\n');
    const changed = await a.sync({ bundle });
    expect(changed.snapshot).toMatch(/^rec_/);
    const recs = (await storeRecords(objects)).filter((x) => x.kind === 'bundle');
    expect(recs).toHaveLength(2);
    if (recs[0]?.kind === 'bundle' && recs[1]?.kind === 'bundle')
      expect(recs[0].definitions_hash).not.toBe(recs[1].definitions_hash);
  });
});
