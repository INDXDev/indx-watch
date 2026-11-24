/** The Worker over a bucket: model, writes, assets, signing, read-only public deploys, catchUp and memoryBundleFs. */
import { type AnyRecord, generateSigningKey, newId, recordSigner, verifyRecord } from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { createResultStore, memoryIndex, memoryObjectStore } from '@indx-watch/store';
import { definitionFiles, ulidFloor } from '@indx-watch/sync';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectInfo, RunSummary, StatusResult } from '../src/index.js';
import { catchUp, memoryBundleFs } from '../src/worker.js';
import { SHOP, sampleRecords, shop } from './helpers.js';
import { mcpCall } from './mcp-helpers.js';
import {
  AFTER_THROTTLE_MS,
  accessEnv,
  bucket,
  bucketStore,
  call,
  getJson,
  lastRecord,
  postJson,
  publicEnv,
  RUN_TC9,
  STORE_MANIFEST,
  worker,
} from './worker-helpers.js';

describe('worker: model, writes and assets', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('serves the model from the latest snapshot plus records ingested from the bucket', async () => {
    const { r2, b } = await bucket();
    const env = publicEnv(r2);
    const p = await getJson<ProjectInfo>(env, '/api/project');
    expect(p).toMatchObject({ mode: 'hosted', project: { key: 'SHOP' }, identity: { id: 'anonymous' } });
    expect(p.sync).toMatchObject({ configured: true, store: 'r2://shop' });

    // a CI run written straight to the bucket appears after the next catch-up
    const store = bucketStore(r2);
    await store.appendLog('ci', sampleRecords(b));
    const t0 = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(t0 + AFTER_THROTTLE_MS); // the next request may ingest again (at most every 5 s)
    const s = await getJson<StatusResult>(env, '/api/status');
    expect(s.testCases.find((t) => t.key === 'TC-4')!.status).toBe('fail');

    // the hosted UI writes to the bucket (a log object) and the index at once
    const { env: signedIn, kim } = await accessEnv(r2);
    const res = await postJson(signedIn, '/api/runs', RUN_TC9, kim);
    expect(res.status).toBe(201);
    const runs = await getJson<RunSummary[]>(signedIn, '/api/runs?tc=TC-9', { headers: kim });
    expect(runs).toHaveLength(1);
    expect(await lastRecord(store)).toMatchObject({ kind: 'run', test_case: { key: 'TC-9' } });

    // the SPA comes from the assets binding
    expect(await (await call(env, '/tc/TC-1')).text()).toContain('spa');
    // /api/store/* is the bucket
    expect((await call(env, STORE_MANIFEST)).status).toBe(200);
    vi.restoreAllMocks();
  });

  it('scheduled() ingests', async () => {
    const { r2, b } = await bucket();
    const env = publicEnv(r2);
    await worker.scheduled({}, env as never);
    await call(env, '/api/project');
    const store = bucketStore(r2);
    await store.appendLog('ci', sampleRecords(b).slice(0, 1));
    await worker.scheduled({}, env as never);
    const runs = await getJson<RunSummary[]>(env, '/api/runs');
    expect(runs).toHaveLength(1);
  });
});

describe('worker: signing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('signs the records it writes with IW_SIGNING_KEY; unsigned verified claims from the bucket are unverified', async () => {
    const { r2, b } = await bucket();
    const k = await generateSigningKey('hosted-test');
    const { env: signed, kim } = await accessEnv(r2, { IW_SIGNING_KEY: k.secret });
    const store = bucketStore(r2);
    await store.appendLog('ci', sampleRecords(b)); // CI records (via = "github") written without a signature
    const res = await postJson(signed, '/api/runs', RUN_TC9, kim);
    expect(res.status).toBe(201);
    const written = await lastRecord(store);
    expect(written.sig?.kid).toBe('hosted-test');
    expect(await verifyRecord(written, [k.key])).toBe(true);
    const runs = await getJson<RunSummary[]>(signed, '/api/runs?tc=TC-1', { headers: kim });
    expect(runs[0]).toMatchObject({ actor: { via: 'github' }, unverified: true });
    // /mcp on the Worker: an agent run, signed like every write of the server
    const viaWorker = (r: Request) => worker.fetch(r, signed as never);
    const args = { test_case: 'TC-9', verdict: 'fail', note: 'Coupon lost', model: 'claude-test' };
    const mr = await mcpCall(viaWorker, 'https://watch.example.com', 'record_run', args, kim);
    expect(mr.structuredContent.run).toMatchObject({
      source: 'agent',
      actor: { kind: 'agent', model: 'claude-test' },
    });
    expect(await verifyRecord(await lastRecord(store), [k.key])).toBe(true);
  });
});

describe('worker: pinned signing keys', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('trusts only the keys pinned at deploy (SIGNING_KEYS), never keys from a snapshot', async () => {
    const { r2, b } = await bucket();
    const [team, attacker] = [await generateSigningKey('hosted'), await generateSigningKey('hosted-2')];
    const env = publicEnv(r2);
    const { env: pinned, kim } = await accessEnv(r2, { SIGNING_KEYS: JSON.stringify([team.key]) });
    // anyone who can write the store publishes a snapshot that pins their own key
    const files = await definitionFiles(nodeFs(SHOP));
    const toml = `${new TextDecoder().decode(files.get('project.toml'))}
[[signing_keys]]
kid = "hosted-2"
public_key = "${attacker.key.public_key}"
`;
    const upload = await postJson(
      pinned,
      '/api/bundle',
      { files: [{ name: 'project.toml', data: Buffer.from(toml).toString('base64') }] },
      kim,
    );
    expect(upload.status).toBe(201);
    const lead = { kind: 'human', id: 'lead@shop.test', via: 'cloudflare-access' } as const;
    const [r1, r2b] = sampleRecords(b).filter((r) => r.kind === 'run');
    const forged = await recordSigner(attacker.secret)({ ...r1!, actor: lead } as AnyRecord);
    const genuine = await recordSigner(team.secret)({ ...r2b!, actor: lead } as AnyRecord);
    await bucketStore(r2).appendLog('x', [forged, genuine]);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + AFTER_THROTTLE_MS);
    const runs = await getJson<RunSummary[]>(pinned, '/api/runs', { headers: kim });
    expect(runs.find((r) => r.id === forged.id)?.unverified).toBe(true);
    expect(runs.find((r) => r.id === genuine.id)?.unverified).toBeFalsy();
    const p = await getJson<ProjectInfo>(pinned, '/api/project', { headers: kim });
    expect(p.problems.map((x) => x.message)).toContainEqual(expect.stringContaining('iw deploy'));
    // without SIGNING_KEYS nothing is trusted
    const none = await getJson<RunSummary[]>(env, '/api/runs');
    expect(none.find((r) => r.id === genuine.id)?.unverified).toBe(true);
    vi.restoreAllMocks();
  });
});

describe('worker: a malformed signing key', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a malformed IW_SIGNING_KEY fails the writes, not the reads, /healthz or the catch-up', async () => {
    const { r2 } = await bucket();
    const { env: bad, kim } = await accessEnv(r2, { IW_SIGNING_KEY: 'pasted the TOML entry by mistake' });
    expect((await call(bad, '/healthz')).status).toBe(200);
    expect((await call(bad, '/api/project', { headers: kim })).status).toBe(200);
    await worker.scheduled({}, bad as never);
    const res = await postJson(bad, '/api/runs', RUN_TC9, kim);
    expect(res.status).toBe(500);
  });
});

/** Every write route of the API, as [method, path, init]; a public deploy refuses each one. */
const WRITES = (log: string): [string, string, RequestInit?][] => [
  ['POST', '/api/runs', { body: JSON.stringify(RUN_TC9) }],
  ['POST', '/api/bundle', { body: JSON.stringify({ replace: true, files: [] }) }],
  ['POST', '/api/blobs', { headers: { 'x-iw-request': '1' }, body: 'evidence' }],
  ['PUT', log, { headers: { 'if-none-match': '*' }, body: '{"v":1,"writer":"x","records":[]}' }],
  ['POST', '/api/fixtures', { body: '{}' }],
  ['PATCH', '/api/fixtures/FX-1', { body: '{}' }],
  ['PUT', '/api/secrets/shop-admin', { body: JSON.stringify({ value: 'x' }) }],
  ['POST', '/api/secrets/shop-admin/reveal', { body: '{}' }],
  ['POST', '/api/runs/run_1/judgements', { body: '{}' }],
  ['POST', '/api/shares?days=7', { body: '{}' }],
  ['POST', '/api/plans/PLAN-1/invites', { body: '{}' }],
];

describe('worker: a public deploy is read-only', () => {
  it('serves reads to anonymous viewers and refuses every write with 403 read-only, writing nothing', async () => {
    const { r2 } = await bucket();
    const env = { ...publicEnv(r2), IW_SECRETS_KEY: `iwsec1:${'A'.repeat(43)}` };
    const cookie = { cookie: 'iw_tester=%7B%22id%22%3A%22sam%40shop.test%22%7D' };
    const p = await getJson<ProjectInfo>(env, '/api/project', { headers: cookie });
    expect(p).toMatchObject({ readOnly: true, role: 'viewer', identity: { id: 'anonymous' } });
    expect(p.can).toMatchObject({ declare: false, upload: false, share: false, run: false, data: false });
    expect(p.can).toMatchObject({ review: false, approve: false, edit: false, secrets: false });
    expect((await call(env, '/api/status')).status).toBe(200);
    expect((await call(env, STORE_MANIFEST)).status).toBe(200);
    expect(await getJson(env, '/api/secrets')).toEqual({ available: false, secrets: [] });

    const store = bucketStore(r2);
    const before = (await store.listLog({})).keys.length;
    for (const [method, path, init] of WRITES(`/api/store/objects/v1/log/${ulidFloor(Date.now())}.json`)) {
      const headers = { 'content-type': 'application/json', ...cookie, ...(init?.headers ?? {}) };
      const res = await call(env, path, { ...init, method, headers });
      expect([path, res.status]).toEqual([path, 403]);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('read-only');
    }
    // /mcp: read tools work, write tools are refused for the viewer
    const viaWorker = (r: Request) => worker.fetch(r, env as never);
    const base = 'https://watch.example.com';
    expect((await mcpCall(viaWorker, base, 'status', { release: 'v1.2.0' })).isError).toBeFalsy();
    const args = { test_case: 'TC-9', verdict: 'pass', model: 'claude-test' };
    expect((await mcpCall(viaWorker, base, 'record_run', args)).isError).toBe(true);
    expect((await store.listLog({})).keys).toHaveLength(before);
  });
});

const BASE = Date.parse('2026-11-19T00:00:00Z');
const HOUR = 3600_000;
const DAY = 86_400_000;

/** An in-memory store and index for catchUp, with examples/shop loaded. */
async function ingestFixture() {
  const objects = memoryObjectStore();
  return { objects, store: createResultStore(objects), index: memoryIndex(), b: await shop() };
}

describe('catchUp: incremental reads', () => {
  it('reads at most 50 log objects per call and resumes from its cursor', async () => {
    const { store, index, b } = await ingestFixture();
    const append = (i: number, at: number) =>
      store.appendLog('w', [{ ...sampleRecords(b)[0]!, id: newId('run', BASE + i) } as AnyRecord], at);
    for (let i = 0; i < 60; i++) await append(i, BASE + i * 60_000);
    const now = BASE + 2 * HOUR;
    expect(await catchUp(store, index, 'a', { now })).toBe(50);
    expect(await catchUp(store, index, 'a', { now })).toBe(10);
    expect(await catchUp(store, index, 'a', { now })).toBe(0);
    expect(await index.records()).toHaveLength(60);
    // a late upload with an older key inside the lookback window is still read
    await append(99, BASE + 59 * 60_000 - 5 * 60_000);
    expect(await catchUp(store, index, 'a', { now })).toBe(1);
  });

  it('respects another invocation’s lease', async () => {
    const store = createResultStore(memoryObjectStore());
    const index = memoryIndex();
    await index.setMeta('ingest.lease', `other ${Date.now() + 10_000}`);
    expect(await catchUp(store, index, 'me')).toBe(0);
    expect(await index.getMeta('ingest.lease')).toMatch(/^other /);
  });
});

describe('catchUp: daily full listing', () => {
  it('a daily full listing, resumed across calls, ingests another body under an older key', async () => {
    const { objects, store, index, b } = await ingestFixture();
    // hand-made keys: newUlid() is monotonic, so it cannot write under a time before one it already used
    const put = (t: number, r: AnyRecord) =>
      objects.put(`v1/log/${ulidFloor(t)}.json`, JSON.stringify({ v: 1, writer: 'w', records: [r] }));
    const run = sampleRecords(b).find((r) => r.kind === 'run')!;
    await put(BASE, run);
    for (let i = 0; i < 120; i++)
      await put(BASE + HOUR + i * 60_000, { ...run, id: newId('run', BASE + i) } as AnyRecord);
    const now = BASE + 3 * HOUR;
    while (await catchUp(store, index, 'a', { now }));
    const forged = { ...run, at: '2026-11-18T23:00:00Z' } as AnyRecord;
    await put(BASE - HOUR, forged); // written straight to the bucket under an older key, far behind the cursor
    expect(await catchUp(store, index, 'a', { now: now + 60_000 })).toBe(0);
    const held = async () => (await index.records()).find((r) => r.id === run.id);
    expect(await held()).toEqual(run);
    // a day later: the oldest key comes first; 50 reads per call, so the listing resumes over three calls
    // replaced and noted, then the original body under its later key: kept and noted
    expect(await catchUp(store, index, 'a', { now: now + DAY })).toBe(3);
    expect(await held()).toEqual(forged);
    const full = async () => JSON.parse((await index.getMeta('ingest.state'))!).full;
    expect((await full()).after).toMatch(/^v1\/log\//);
    await catchUp(store, index, 'a', { now: now + DAY + 60_000 });
    expect((await full()).after).toMatch(/^v1\/log\//);
    await catchUp(store, index, 'a', { now: now + DAY + 120_000 });
    expect(await full()).toEqual({ at: now + DAY + 120_000 });
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
