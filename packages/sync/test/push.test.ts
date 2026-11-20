// syncOnce push side: blobs before records, held-back records, retractions, batching and extra blobs.
import { AnyRecord as Schema, sha256Hex } from '@indx-watch/bundle';
import { createResultStore, memoryObjectStore } from '@indx-watch/store';
import { describe, expect, it } from 'vitest';
import { retraction, runRecord } from '../../store/test/helpers/records.js';
import { emptyState, pointerBlobs } from '../src/index.js';
import { clone, enc, instrumented, storeRecords, withEvidence } from './helpers.js';

describe('syncOnce: pushing safely', () => {
  it('an interrupted push leaves no record without its blobs', async () => {
    const inner = memoryObjectStore();
    let failLog = true;
    const { store } = instrumented(inner, (k) => k.startsWith('v1/log/') && failLog);
    const a = clone(store, 'writer-a');
    const { run, sha } = await withEvidence(a.replica, 'evidence');
    await expect(a.sync()).rejects.toThrow(/injected failure/);
    expect(await createResultStore(inner).hasBlob(sha)).toBe(true);
    expect(await storeRecords(inner)).toEqual([]);
    failLog = false;
    expect(await a.sync()).toMatchObject({ pushed: { records: 1, blobs: 0 } });
    expect((await storeRecords(inner)).map((r) => r.id)).toEqual([run.id]);

    // when a blob upload fails, no log object is written
    const inner2 = memoryObjectStore();
    const b = clone(instrumented(inner2, (k) => k.startsWith('v1/blobs/')).store, 'writer-b');
    await withEvidence(b.replica, 'other evidence');
    await expect(b.sync()).rejects.toThrow(/injected failure/);
    expect((await inner2.list({ prefix: 'v1/log/' })).keys).toEqual([]);
  });

  it('holds back a record whose blob is missing locally', async () => {
    const objects = memoryObjectStore();
    const a = clone(objects, 'writer-a');
    const ghost = await sha256Hex('never written');
    await a.replica.putRecord(runRecord({ evidence: [ghost] }));
    expect(await a.sync()).toMatchObject({ pushed: { records: 0 } });
    expect(await storeRecords(objects)).toEqual([]);
  });

  it('holds back a record that fails the secret scan, for every caller of syncOnce', async () => {
    const objects = memoryObjectStore();
    const a = clone(objects, 'w');
    const key = `AKIA${'ABCDEFGHIJKLMNOP'}`;
    const clean = runRecord();
    const leaky = runRecord({ at: Date.now() + 1 });
    leaky.steps[0]!.note = `token ${key}`;
    await a.replica.putRecord(clean);
    await a.replica.putRecord(leaky);
    const r = await a.sync();
    expect(r.pushed.records).toBe(1);
    expect(r.held).toMatchObject([{ code: 'secret', file: `runs/${leaky.id}` }]);
    expect(JSON.stringify(r)).not.toContain(key);
    expect(r.warnings).toContain(`held back ${leaky.id}: the secret scan found 1 problem(s); retract it`);
    expect((await storeRecords(objects)).map((x) => x.id)).toEqual([clean.id]);
    // retracting it releases nothing but the retraction
    const x = retraction(leaky.id);
    await a.replica.putRecord(x);
    const r2 = await a.sync();
    expect([r2.pushed.records, r2.held]).toEqual([1, undefined]);
    expect(JSON.stringify(await storeRecords(objects))).not.toContain(key);
  });

  it('does not scan the signature: random base64url can look like an API key', async () => {
    const objects = memoryObjectStore();
    const a = clone(objects, 'w');
    // a real signature looks like this about once in 130,000 records (docs/spec/security.md#signed-records)
    const value = `${'A'.repeat(40)}-sk-${'B'.repeat(42)}`;
    const signed = Schema.parse({ ...runRecord(), sig: { alg: 'Ed25519', kid: 'ci', value } });
    await a.replica.putRecord(signed);
    const r = await a.sync();
    expect([r.pushed.records, r.held]).toEqual([1, undefined]);
  });
});

describe('syncOnce: what gets pushed', () => {
  it('remembers the log key of each record when one push spans several log objects', async () => {
    const objects = memoryObjectStore();
    const a = clone(objects, 'a');
    const big = Array.from({ length: 3 }, (_, i) => {
      const r = runRecord({ at: Date.now() + i });
      r.steps[0]!.note = 'lorem ipsum '.repeat(170_000); // three of these are over the 5 MB of one log object
      return r;
    });
    for (const r of big) await a.replica.putRecord(r);
    expect((await a.sync()).pushed.records).toBe(3);
    const where = new Map<string, string>();
    for (const key of (await createResultStore(objects).listLog({})).keys)
      for (const r of (await createResultStore(objects).readLog(key)).records) where.set(r.id, key);
    expect(new Set(where.values()).size).toBeGreaterThan(1);
    const { keys } = await a.state.load();
    expect(big.map((r) => keys?.[r.id])).toEqual(big.map((r) => where.get(r.id)));
  });

  it('refuses a store bound to another project', async () => {
    const objects = memoryObjectStore();
    await createResultStore(objects).init('prj_01JF3Q8M5X2V7K9D4R6T1W0Y01');
    await expect(clone(objects, 'w').sync()).rejects.toMatchObject({ code: 'wrong-project' });
  });

  it('never pushes a retracted record', async () => {
    const objects = memoryObjectStore();
    const a = clone(objects, 'w');
    const run = runRecord();
    const x = retraction(run.id);
    await a.replica.putRecord(run);
    await a.replica.putRecord(x);
    expect(await a.sync()).toMatchObject({ pushed: { records: 1 } });
    expect((await storeRecords(objects)).map((r) => r.id)).toEqual([x.id]);
  });

  it('a push-only sync on a fresh state does not push records the store already has', async () => {
    const objects = memoryObjectStore();
    const a = clone(objects, 'w');
    await a.replica.putRecord(runRecord());
    await a.sync({ direction: 'push' });
    await a.state.save(emptyState());
    expect(await a.sync({ direction: 'push' })).toMatchObject({ pushed: { records: 0 } });
    expect((await objects.list({ prefix: 'v1/log/' })).keys).toHaveLength(1);
    expect((await a.state.load()).lastFullAt).not.toBeNull();
  });

  it('uploads fixture pointer blobs given as extraBlobs once, skipping ones not in the replica', async () => {
    const { store, stats } = instrumented(memoryObjectStore());
    const a = clone(store, 'a');
    const sha = await a.replica.putBlob(enc.encode('big fixture file'), 'text/plain');
    const elsewhere = await sha256Hex('only in another clone');
    const extraBlobs = [sha, elsewhere];
    expect(await a.sync({ extraBlobs })).toMatchObject({ pushed: { records: 0, blobs: 1 } });
    expect(await createResultStore(store).getBlob(sha)).toEqual(enc.encode('big fixture file'));
    const puts = stats.puts;
    expect(await a.sync({ extraBlobs })).toMatchObject({ pushed: { blobs: 0 } });
    expect(stats.puts).toBe(puts);
    const bundle = {
      fixtures: [{ dataFiles: [{ pointer: true, sha256: sha }, { sha256: elsewhere }] }],
    } as unknown as Parameters<typeof pointerBlobs>[0];
    expect(pointerBlobs(bundle)).toEqual([sha]);
  });

  it('pushes up to 1000 records per log object', async () => {
    const objects = memoryObjectStore();
    const a = clone(objects, 'w');
    for (let i = 0; i < 1001; i++) await a.replica.putRecord(runRecord());
    expect(await a.sync({ direction: 'push' })).toMatchObject({ pushed: { records: 1001 } });
    expect((await objects.list({ prefix: 'v1/log/' })).keys).toHaveLength(2);
  });
});
