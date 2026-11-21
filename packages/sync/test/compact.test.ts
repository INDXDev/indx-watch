// Log snapshots (docs/spec/sync.md#log-snapshots-v02): compactLog and full listings that start from a snapshot.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReplica, createResultStore, memoryObjectStore, SNAPSHOT_PREFIX } from '@indx-watch/store';
import { fsObjectStore } from '@indx-watch/store/node';
import { afterAll, describe, expect, it } from 'vitest';
import { PROJECT, runRecord } from '../../store/test/helpers/records.js';
import { compactLog } from '../src/index.js';
import { clone, instrumented, MIN, putLog } from './helpers.js';

const HOUR = 60 * MIN;
const sorted = async (c: ReturnType<typeof clone>) =>
  (await c.replica.records()).sort((a, b) => (a.id < b.id ? -1 : 1));

describe('log snapshots', () => {
  it('a fresh clone starts from the snapshot and ends with what a full log read gives', async () => {
    const objects = memoryObjectStore();
    const old = Date.now() - 2 * HOUR;
    const run = runRecord({ at: old });
    for (let i = 0; i < 5; i++) await putLog(objects, old + i * MIN, [runRecord({ at: old + i })]);
    // two bodies with one ID: the earlier key wins in both the snapshot and the log
    const forged = { ...run, steps: [{ ...run.steps[0]!, note: 'FORGED BODY' }] };
    await putLog(objects, old + 10 * MIN, [forged]);
    await putLog(objects, old + 20 * MIN, [run]);
    const c = await compactLog({ store: createResultStore(objects), projectId: PROJECT });
    expect(c).toMatchObject({ written: true, logs: 7, records: 7 });
    // after the compaction: a recent object, and a late one with a key older than the snapshot's newest
    await putLog(objects, Date.now(), [runRecord()]);
    const late = runRecord({ at: old });
    await putLog(objects, old + 30 * MIN, [late]);

    const { store, stats } = instrumented(objects);
    const fresh = clone(store, 'fresh');
    const r = await fresh.sync({ direction: 'pull' });
    expect(r.logSnapshot).toBe(c.snapshot);
    expect(r.pulled.records).toBe(8);
    expect(stats.gets).toBe(4); // manifest, snapshot and the two log objects it lacks
    expect(await fresh.replica.getRecord(run.id)).toEqual(forged);
    expect(r.warnings).toEqual([expect.stringContaining(`record ${run.id}`)]);
    const full = clone(objects, 'full');
    const f = await full.sync({ direction: 'pull', full: true });
    expect(f.logSnapshot).toBeUndefined();
    expect(await sorted(fresh)).toEqual(await sorted(full));
    expect((await fresh.state.load()).keys).toEqual((await full.state.load()).keys);
    // the next daily full listing only marks the applied snapshot's keys as read
    stats.gets = 0;
    expect((await fresh.sync({ direction: 'pull', now: () => Date.now() + 25 * HOUR })).pulled.records).toBe(
      0,
    );
    expect(stats.gets).toBe(3); // manifest, snapshot and the late object (the recent one is still in the window)
  });

  it('writes nothing when no log object is new, and adds new ones to the previous snapshot', async () => {
    const objects = memoryObjectStore();
    const store = createResultStore(objects);
    expect(await compactLog({ store, projectId: PROJECT })).toMatchObject({ snapshot: null, written: false });
    const old = Date.now() - HOUR;
    await putLog(objects, old, [runRecord({ at: old })]);
    await putLog(objects, Date.now(), [runRecord()]); // inside the lookback window: left for the next run
    const first = await compactLog({ store, projectId: PROJECT });
    expect(first).toMatchObject({ written: true, logs: 1 });
    expect(await compactLog({ store, projectId: PROJECT })).toEqual({ ...first, written: false });
    const second = await compactLog({ store, projectId: PROJECT, now: Date.now() + HOUR });
    expect(second).toMatchObject({ written: true, logs: 2, records: 2 });
    expect(second.snapshot! > first.snapshot!).toBe(true);
  });

  it('a corrupt, foreign or future snapshot falls back to the log', async () => {
    const objects = memoryObjectStore();
    const old = Date.now() - HOUR;
    await putLog(objects, old, [runRecord({ at: old })]);
    const store = createResultStore(objects);
    const good = (await compactLog({ store, projectId: PROJECT })).snapshot!;
    // a snapshot dated in the future is never picked
    await objects.put(`${SNAPSHOT_PREFIX}7ZZZZZZZZZ0000000000000000.json`, 'not json');
    expect((await clone(objects, 'a').sync({ direction: 'pull' })).logSnapshot).toBe(good);
    const body = JSON.parse(new TextDecoder().decode((await objects.get(good))!));
    const bad = [
      'not json',
      JSON.stringify({ ...body, v: 2 }),
      JSON.stringify({ ...body, project: 'prj_01JF3Q8M5X2V7K9D4R6T1W0Y99' }),
      JSON.stringify({ ...body, logs: [...body.logs, ...body.logs] }),
      JSON.stringify({ ...body, logs: [{ ...body.logs[0], records: [{ kind: 'run' }] }] }),
    ];
    for (const [i, text] of bad.entries()) {
      await objects.delete(good);
      await objects.put(good, text);
      const c = clone(objects, `b${i}`);
      const r = await c.sync({ direction: 'pull' });
      expect(r.logSnapshot).toBeUndefined();
      expect(r.pulled.records).toBe(1);
      expect(r.warnings).toEqual([expect.stringContaining('reading the whole log instead')]);
    }
    // --full ignores snapshots
    expect((await clone(objects, 'c').sync({ direction: 'pull', full: true })).logSnapshot).toBeUndefined();
  });
});

describe('log snapshots: 100,000 records', () => {
  const dir = mkdtempSync(join(tmpdir(), 'iw-compact-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // Acceptance (roadmap T-206): a new clone pulls 100k records in < 10 s from a snapshot. The time is logged;
  // CI runners are slower and noisier, so CI only fails at 30 s.
  it('a fresh clone pulls them from a snapshot in a folder store in under 10 s', async () => {
    const store = createResultStore(fsObjectStore(join(dir, 'store')));
    await store.init(PROJECT);
    // 1,000 uploads of 100 records, like CI jobs
    for (let i = 0; i < 1000; i++)
      await store.appendLog(
        'ci',
        Array.from({ length: 100 }, () => runRecord()),
      );
    // as if run an hour later, when every log object is older than the lookback window
    const c = await compactLog({ store, projectId: PROJECT, now: Date.now() + HOUR });
    expect(c).toMatchObject({ written: true, logs: 1000, records: 100_000 });
    // the clone's replica is a folder too, as in .indx-watch/runs/
    const { store: objects, stats } = instrumented(store.objects);
    const fresh = clone(objects, 'fresh', { replica: createReplica(fsObjectStore(join(dir, 'runs'))) });
    const t0 = performance.now();
    const r = await fresh.sync({ direction: 'pull' });
    const ms = performance.now() - t0;
    console.log(
      `T-206: a fresh clone pulled ${r.pulled.records} records from a log snapshot in ${Math.round(ms)} ms`,
    );
    expect(r).toMatchObject({ logSnapshot: c.snapshot, pulled: { records: 100_000 } });
    expect(stats.gets).toBe(2); // the manifest and the snapshot, instead of 1,000 log objects
    expect(ms).toBeLessThan(process.env.CI ? 30_000 : 10_000);
  }, 120_000);
});
