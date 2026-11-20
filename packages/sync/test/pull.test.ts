// syncOnce pull side: exchanging records, idempotence, the lookback window and cursor, unreadable or foreign log objects.
import { createResultStore, memoryObjectStore, ulidTime } from '@indx-watch/store';
import { describe, expect, it } from 'vitest';
import { PROJECT, runRecord } from '../../store/test/helpers/records.js';
import { emptyState, ulidFloor } from '../src/index.js';
import { clone, enc, instrumented, MIN, putLog, storeRecords, withEvidence } from './helpers.js';

describe('syncOnce: exchanging records', () => {
  it('two replicas through one store see each other’s records; evidence follows the policy', async () => {
    const objects = memoryObjectStore();
    const a = clone(objects, 'writer-a');
    const b = clone(objects, 'writer-b');
    const { run, sha } = await withEvidence(a.replica, 'screenshot-a');
    const rb = runRecord();
    await b.replica.putRecord(rb);

    expect(await a.sync()).toMatchObject({ pushed: { records: 1, blobs: 1 }, pulled: { records: 0 } });
    const rb1 = await b.sync();
    expect(rb1).toMatchObject({ pushed: { records: 1, blobs: 0 }, pulled: { records: 1, blobs: 0 } });
    expect(await b.replica.getRecord(run.id)).toEqual(run);
    expect(await b.replica.hasBlob(sha)).toBe(false); // on-demand (the default)
    expect(await a.sync({ evidence: 'all' })).toMatchObject({ pulled: { records: 1 } });
    expect(await a.replica.getRecord(rb.id)).toEqual(rb);

    const c = clone(objects, 'writer-c', { evidence: 'all' });
    expect(await c.sync()).toMatchObject({ pulled: { records: 2, blobs: 1 } });
    expect(await c.replica.getBlob(sha)).toEqual(enc.encode('screenshot-a'));
    expect(rb1.cursor).toMatch(/^v1\/log\//);
  });

  it('is idempotent: a second sync transfers nothing', async () => {
    const { store, stats } = instrumented(memoryObjectStore());
    const a = clone(store, 'writer-a');
    const b = clone(store, 'writer-b');
    await withEvidence(a.replica, 'x');
    await a.sync();
    await b.replica.putRecord(runRecord());
    await b.sync();
    await a.sync();
    const before = { ...stats };
    const r = await a.sync();
    expect(r).toMatchObject({ pushed: { records: 0, blobs: 0 }, pulled: { records: 0, blobs: 0 } });
    expect(stats.puts).toBe(before.puts);
    expect(stats.gets - before.gets).toBe(1); // only the store manifest check
  });

  it('pulls a log object keyed 10 minutes before the reader’s cursor (lookback window)', async () => {
    const objects = memoryObjectStore();
    const T = Date.now();
    const reader = clone(objects, 'reader', { now: () => T });
    await putLog(objects, T, [runRecord()]);
    await reader.sync();
    const late = runRecord();
    await putLog(objects, T - 10 * MIN, [late]);
    const veryLate = runRecord();
    await putLog(objects, T - 40 * MIN, [veryLate]);
    expect(await reader.sync({ now: () => T + 1000 })).toMatchObject({ pulled: { records: 1 } });
    expect(await reader.replica.getRecord(late.id)).not.toBeNull();
    // keys older than the window are picked up by the daily full listing (or --full)
    expect(await reader.replica.getRecord(veryLate.id)).toBeNull();
    expect(await reader.sync({ now: () => T + 25 * 60 * MIN })).toMatchObject({ pulled: { records: 1 } });
    expect(await reader.replica.getRecord(veryLate.id)).not.toBeNull();
  });

  it('a log key one day in the future does not hide records written afterwards', async () => {
    const objects = memoryObjectStore();
    const T = Date.now();
    const reader = clone(objects, 'reader', { now: () => T });
    const future = runRecord();
    await putLog(objects, T + 24 * 60 * MIN, [future]);
    const r1 = await reader.sync();
    expect(r1.pulled.records).toBe(1);
    expect(ulidTime(r1.cursor!.slice('v1/log/'.length))).toBeLessThanOrEqual(T);
    const writer = clone(objects, 'writer');
    const later = runRecord();
    await writer.replica.putRecord(later);
    await writer.sync({ now: () => Date.now() });
    expect(await reader.sync({ now: () => T + 3000 })).toMatchObject({ pulled: { records: 1 } });
    expect(await reader.replica.getRecord(later.id)).toEqual(later);
  });
});

describe('syncOnce: pull edge cases', () => {
  it('rebuilds the pushed set from a full listing when the cache was deleted', async () => {
    const objects = memoryObjectStore();
    const a = clone(objects, 'w');
    await a.replica.putRecord(runRecord());
    await a.sync();
    await a.state.save(emptyState());
    expect(await a.sync()).toMatchObject({ pushed: { records: 0 }, pulled: { records: 0 } });
    expect(await storeRecords(objects)).toHaveLength(1);
  });

  it('a reader whose clock runs ahead keeps no cursor on an empty store and still pulls later records', async () => {
    const objects = memoryObjectStore();
    const reader = clone(objects, 'reader', { now: () => Date.now() + 20 * MIN });
    expect((await reader.sync()).cursor).toBeNull();
    const writer = clone(objects, 'writer');
    const run = runRecord();
    await writer.replica.putRecord(run);
    expect(await writer.sync()).toMatchObject({ pushed: { records: 1 } });
    expect(await reader.sync()).toMatchObject({ pulled: { records: 1 } });
    expect(await reader.replica.getRecord(run.id)).toEqual(run);
  });

  it('skips unreadable log objects with a warning instead of failing every sync', async () => {
    const objects = memoryObjectStore();
    const T = Date.now();
    await createResultStore(objects).init(PROJECT);
    const good = runRecord();
    await objects.put(`v1/log/${ulidFloor(T - 3000).slice(0, 10)}AAAAAAAAAAAAAAAA.json`, '{not json');
    await objects.put(
      `v1/log/${ulidFloor(T - 2000).slice(0, 10)}AAAAAAAAAAAAAAAA.json`,
      JSON.stringify({ v: 2, writer: 'w_newer_tool', records: [] }),
    );
    await objects.put(
      `v1/log/${ulidFloor(T - 1000).slice(0, 10)}AAAAAAAAAAAAAAAA.json`,
      JSON.stringify({ v: 1, writer: 'w', records: [good, { kind: 'run' }], future_field: true }),
    );
    const d = clone(objects, 'reader');
    const mine = runRecord();
    await d.replica.putRecord(mine);
    const r = await d.sync();
    expect(r).toMatchObject({ pulled: { records: 1 }, pushed: { records: 1 } });
    expect(r.warnings).toEqual([
      expect.stringMatching(/^v1\/log\/.* is not a valid log object \(skipped\)$/),
      expect.stringMatching(/newer INDX Watch \(log v2\); upgrade/),
      expect.stringMatching(/^skipped 1 invalid record\(s\) in v1\/log\//),
    ]);
    expect(await d.replica.getRecord(good.id)).toEqual(good);
    expect((await d.sync()).warnings).toEqual([]); // seen: not read (or reported) again
  });

  it('skips records of another project, both ways', async () => {
    const objects = memoryObjectStore();
    const other = { ...runRecord(), project: 'prj_01JF3Q8M5X2V7K9D4R6T1W0Y99' };
    await putLog(objects, Date.now(), [other]);
    const e = clone(objects, 'e');
    const r = await e.sync();
    expect(r.pulled.records).toBe(0);
    expect(r.warnings).toEqual([expect.stringContaining(`skipped ${other.id} in v1/log/`)]);
    expect(await e.replica.getRecord(other.id)).toBeNull();
    const local = { ...runRecord(), project: 'prj_01JF3Q8M5X2V7K9D4R6T1W0Y99' };
    await e.replica.putRecord(local);
    const p = await e.sync({ direction: 'push' });
    expect(p.pushed.records).toBe(0);
    expect(p.warnings).toEqual([expect.stringContaining(`skipped ${local.id} in the local replica`)]);
  });
});
