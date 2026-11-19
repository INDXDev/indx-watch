import { type AnyRecord, newId, sha256Hex } from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { createResultStore, memoryIndex, memoryObjectStore } from '@indx-watch/store';
import { r2ObjectStore } from '@indx-watch/store/workers';
import { snapshotBundle } from '@indx-watch/sync';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeD1, fakeR2 } from '../../store/test/helpers/fakes.js';
import type { ProjectInfo, RunSummary, StatusResult } from '../src/index.js';
import worker, { catchUp, memoryBundleFs } from '../src/worker.js';
import { SHOP, sampleRecords, shop } from './helpers.js';

const assets = {
  fetch: async () =>
    new Response('<!doctype html><title>spa</title>', { headers: { 'content-type': 'text/html' } }),
};

/** A bucket with a bundle snapshot (as `iw sync --snapshot` publishes it) and optional records written directly to it. */
async function bucket(records: AnyRecord[] = []) {
  const r2 = fakeR2({ honorStartAfter: true });
  const store = createResultStore(r2ObjectStore(r2, 'shop'));
  const b = await shop();
  await store.init(b.project.data.id);
  const snap = await snapshotBundle(nodeFs(SHOP));
  const sha = await sha256Hex(snap.tar);
  await store.putBlob(sha, snap.tar, 'application/x-tar');
  const bundleRecord = {
    kind: 'bundle',
    id: newId('rec', Date.parse('2026-11-18T00:00:00Z')),
    v: 1,
    project: b.project.data.id,
    at: '2026-11-18T00:00:00Z',
    actor: { kind: 'ci', id: 'github:octocat', via: 'github' },
    source: 'ci',
    commit: 'a1b2c3d',
    commit_time: '2026-11-18T00:00:00Z',
    ref: 'refs/heads/main',
    sha256: sha,
    definitions_hash: snap.hash,
    files: snap.files,
  } as AnyRecord;
  await store.appendLog('ci', [bundleRecord, ...records]);
  return { r2, store, b };
}

const call = (env: object, path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://watch.example.com${path}`, init), env as never);

describe('worker', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('serves the model from the latest snapshot plus records ingested from the bucket', async () => {
    const { r2, b } = await bucket();
    const env = { STORE: r2, DB: fakeD1(), ASSETS: assets, STORE_PREFIX: 'shop', PUBLIC: 'true' };
    const p = (await (await call(env, '/api/project')).json()) as ProjectInfo;
    expect(p).toMatchObject({ mode: 'hosted', project: { key: 'SHOP' }, identity: { id: 'anonymous' } });
    expect(p.sync).toMatchObject({ configured: true, store: 'r2://shop' });

    // a CI run written straight to the bucket appears after the next catch-up
    const store = createResultStore(r2ObjectStore(r2, 'shop'));
    await store.appendLog('ci', sampleRecords(b));
    const t0 = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 6000); // the next request may ingest again (at most every 5 s)
    const s = (await (await call(env, '/api/status')).json()) as StatusResult;
    expect(s.testCases.find((t) => t.key === 'TC-4')!.status).toBe('fail');

    // the hosted UI writes to the bucket (a log object) and the index at once
    const res = await call(env, '/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ test_case: 'TC-9', steps: [], verdict: 'pass' }),
    });
    expect(res.status).toBe(201);
    const runs = (await (await call(env, '/api/runs?tc=TC-9')).json()) as RunSummary[];
    expect(runs).toHaveLength(1);
    const logs = await store.listLog({});
    const last = await store.readLog(logs.keys.at(-1)!);
    expect(last.records[0]).toMatchObject({ kind: 'run', test_case: { key: 'TC-9' } });

    // the SPA comes from the assets binding
    expect(await (await call(env, '/tc/TC-1')).text()).toContain('spa');
    // /api/store/* is the bucket
    expect((await call(env, '/api/store/objects/indx-watch-store.json')).status).toBe(200);
    vi.restoreAllMocks();
  });

  it('answers 503 until a snapshot exists', async () => {
    const env = { STORE: fakeR2(), DB: fakeD1(), ASSETS: assets, PUBLIC: 'true' };
    const res = await call(env, '/api/project');
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('no-snapshot');
  });

  it('rejects everything but /healthz when Access is half-configured, and requires a JWT when configured', async () => {
    const half = { STORE: fakeR2(), DB: fakeD1(), ASSETS: assets, ACCESS_TEAM: 'shop', ACCESS_AUD: '' };
    expect((await call(half, '/healthz')).status).toBe(200);
    expect((await call(half, '/api/project')).status).toBe(401);
    expect((await call(half, '/api/store/list?prefix=')).status).toBe(401);
    vi.stubGlobal('fetch', async () => Response.json({ keys: [] }));
    const { r2 } = await bucket();
    const full = {
      STORE: r2,
      DB: fakeD1(),
      ASSETS: assets,
      STORE_PREFIX: 'shop',
      ACCESS_TEAM: 'shop',
      ACCESS_AUD: 'aud',
    };
    expect((await call(full, '/api/project')).status).toBe(401);
    expect((await call(full, '/api/store/objects/indx-watch-store.json')).status).toBe(401);
    expect((await call(full, '/healthz')).status).toBe(200);
  });

  it('scheduled() ingests', async () => {
    const { r2, b } = await bucket();
    const env = { STORE: r2, DB: fakeD1(), ASSETS: assets, STORE_PREFIX: 'shop', PUBLIC: 'true' };
    await worker.scheduled({}, env as never);
    await call(env, '/api/project');
    const store = createResultStore(r2ObjectStore(r2, 'shop'));
    await store.appendLog('ci', sampleRecords(b).slice(0, 1));
    await worker.scheduled({}, env as never);
    const runs = (await (await call(env, '/api/runs')).json()) as RunSummary[];
    expect(runs).toHaveLength(1);
  });
});

describe('catchUp', () => {
  it('reads at most 50 log objects per call and resumes from its cursor', async () => {
    const store = createResultStore(memoryObjectStore());
    const index = memoryIndex();
    const b = await shop();
    const base = Date.parse('2026-11-19T00:00:00Z');
    for (let i = 0; i < 60; i++)
      await store.appendLog(
        'w',
        [{ ...sampleRecords(b)[0]!, id: newId('run', base + i) } as AnyRecord],
        base + i * 60_000,
      );
    const now = base + 2 * 3600_000;
    expect(await catchUp(store, index, 'a', now)).toBe(50);
    expect(await catchUp(store, index, 'a', now)).toBe(10);
    expect(await catchUp(store, index, 'a', now)).toBe(0);
    expect(await index.records()).toHaveLength(60);
    // a late upload with an older key inside the lookback window is still read
    await store.appendLog(
      'w',
      [{ ...sampleRecords(b)[0]!, id: newId('run', base + 99) } as AnyRecord],
      base + 59 * 60_000 - 5 * 60_000,
    );
    expect(await catchUp(store, index, 'a', now)).toBe(1);
  });

  it('respects another invocation’s lease', async () => {
    const store = createResultStore(memoryObjectStore());
    const index = memoryIndex();
    await index.setMeta('ingest.lease', `other ${Date.now() + 10_000}`);
    expect(await catchUp(store, index, 'me')).toBe(0);
    expect(await index.getMeta('ingest.lease')).toMatch(/^other /);
  });
});

describe('memoryBundleFs', () => {
  it('lists directories and files', async () => {
    const fs = memoryBundleFs(
      new Map([
        ['a/b/c.toml', new Uint8Array([1])],
        ['a/d.toml', new Uint8Array([2])],
        ['e', new Uint8Array()],
      ]),
    );
    expect(await fs.list('')).toEqual([
      { name: 'a', dir: true },
      { name: 'e', dir: false },
    ]);
    expect(await fs.list('a')).toEqual([
      { name: 'b', dir: true },
      { name: 'd.toml', dir: false },
    ]);
    expect(await fs.read('a/d.toml')).toEqual(new Uint8Array([2]));
    await fs.remove('a');
    expect(await fs.list('')).toEqual([{ name: 'e', dir: false }]);
  });
});
