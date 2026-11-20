// watch(): records flowing between clones, fatal versus retried errors; plus ulidFloor and the Node state files.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createResultStore, memoryObjectStore, type ObjectStore, ulidTime } from '@indx-watch/store';
import { openReplica } from '@indx-watch/store/node';
import { describe, expect, it } from 'vitest';
import { PROJECT, runRecord } from '../../store/test/helpers/records.js';
import { emptyState, memoryStateStore, type SyncResult, ulidFloor, watch } from '../src/index.js';
import { fileStateStore, writerId } from '../src/node.js';
import { clone } from './helpers.js';

describe('watch', () => {
  it('a record written in clone A appears in clone B within seconds', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iw-watch-'));
    try {
      const objects = memoryObjectStore();
      const mk = (name: string) => ({
        replica: openReplica(join(dir, name)),
        store: createResultStore(objects),
        state: memoryStateStore(),
        projectId: PROJECT,
        writer: name,
      });
      const a = mk('a');
      const b = mk('b');
      const errors: unknown[] = [];
      const results: SyncResult[] = [];
      // A has no onResult (it must still sync); B collects results
      const stopA = watch({ ...a, intervalMs: 100, onError: (e) => errors.push(e) });
      const stopB = watch({
        ...b,
        intervalMs: 100,
        onError: (e) => errors.push(e),
        onResult: (r) => results.push(r),
      });
      const run = runRecord();
      await openReplica(join(dir, 'a')).putRecord(run); // like a writer in another process (the reporter)
      const started = Date.now();
      while (!(await b.replica.getRecord(run.id)) && Date.now() - started < 5000)
        await new Promise((r) => setTimeout(r, 50));
      await stopA();
      await stopB();
      expect(errors).toEqual([]);
      expect(results.some((r) => r.pulled.records === 1)).toBe(true);
      expect(await b.replica.getRecord(run.id)).toEqual(run);
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('watch errors', () => {
  it('stops on a store bound to another project and reports it to onFatal', async () => {
    const objects = memoryObjectStore();
    await createResultStore(objects).init('prj_01JF3Q8M5X2V7K9D4R6T1W0Y01');
    const a = clone(objects, 'w');
    const errors: unknown[] = [];
    const fatal = await new Promise<unknown>((resolve) => {
      watch({ ...a.opts, intervalMs: 20, onError: (e) => errors.push(e), onFatal: resolve });
    });
    expect(fatal).toMatchObject({ code: 'wrong-project' });
    await new Promise((r) => setTimeout(r, 100));
    expect(errors).toEqual([]); // no retries after the fatal error
  });

  it('keeps retrying network errors', async () => {
    const inner = memoryObjectStore();
    const broken: ObjectStore = {
      ...inner,
      url: inner.url,
      get: async () => {
        throw Object.assign(new Error('offline'), { code: 'network' });
      },
    };
    const a = clone(broken, 'w');
    const errors: unknown[] = [];
    const fatal: unknown[] = [];
    const stop = watch({
      ...a.opts,
      intervalMs: 20,
      onError: (e) => errors.push(e),
      onFatal: (e) => fatal.push(e),
    });
    await new Promise((r) => setTimeout(r, 150));
    await stop();
    expect(errors.length).toBeGreaterThan(1);
    expect(fatal).toEqual([]);
  });
});

describe('helpers', () => {
  it('ulidFloor encodes the time with zero randomness', () => {
    const t = Date.parse('2026-11-19T04:13:40Z');
    expect(ulidFloor(t)).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}0{16}$/);
    expect(ulidTime(ulidFloor(t))).toBe(t);
    expect(ulidFloor(t) < ulidFloor(t + 1)).toBe(true);
  });

  it('fileStateStore keeps state per store under cache/sync/', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iw-state-'));
    try {
      const s = await fileStateStore(dir, 's3://shop-results/watch');
      expect(await s.load()).toEqual(emptyState());
      const state = {
        ...emptyState(),
        cursor: 'v1/log/01JF7Z9A2B4C6D8E0F2G4H6J8K.json',
        pushed: ['run_01JF7Z3K0W8N2Q4R6S8T0V2X4Y'],
      };
      await s.save(state);
      expect(await (await fileStateStore(dir, 's3://shop-results/watch')).load()).toEqual(state);
      expect(s.path).toMatch(/cache\/sync\/[0-9a-f]{16}\.json$/);
      expect((await fileStateStore(dir, 'file://../store')).path).not.toBe(s.path);
      // the configured URL and the adapter's normalized URL share one state file
      expect((await fileStateStore(dir, 's3://shop-results/watch/')).path).toBe(s.path);
      const w = await writerId(dir);
      expect(w).toMatch(/^w_[0-9a-f]{24}$/);
      expect(await writerId(dir)).toBe(w);
      expect(await readFile(join(dir, 'cache', 'writer-id'), 'utf8')).toBe(`${w}\n`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
