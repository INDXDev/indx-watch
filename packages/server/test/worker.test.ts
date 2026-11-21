import {
  type AnyRecord,
  generateSigningKey,
  newId,
  recordSigner,
  sha256Hex,
  verifyRecord,
} from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { createResultStore, memoryIndex, memoryObjectStore } from '@indx-watch/store';
import { r2ObjectStore } from '@indx-watch/store/workers';
import { definitionFiles, snapshotBundle, ulidFloor } from '@indx-watch/sync';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOOL_OUTPUTS } from '../../cli/src/tools.js';
import { fakeD1, fakeR2 } from '../../store/test/helpers/fakes.js';
import type { ProjectInfo, RunSummary, ShareCreated, StatusResult } from '../src/index.js';
import { catchUp, createWorker, memoryBundleFs } from '../src/worker.js';
import { SHOP, sampleRecords, shop } from './helpers.js';
import { mcpCall } from './mcp-helpers.js';

const worker = createWorker(TOOL_OUTPUTS);

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

/** GET a JSON API path. */
const getJson = async <T>(env: object, path: string) => (await (await call(env, path)).json()) as T;

/** POST a JSON body. */
const postJson = (env: object, path: string, body: unknown, headers: Record<string, string> = {}) =>
  call(env, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

/** The public hosted env over a bucket with the `shop` prefix. */
const publicEnv = (r2: unknown) => ({
  STORE: r2,
  DB: fakeD1(),
  ASSETS: assets,
  STORE_PREFIX: 'shop',
  PUBLIC: 'true',
});

/** The result store the worker reads, opened again from the test. */
const bucketStore = (r2: Parameters<typeof r2ObjectStore>[0]) => createResultStore(r2ObjectStore(r2, 'shop'));

/** A passing run of TC-9 as the web UI posts it. */
const RUN_TC9 = { test_case: 'TC-9', steps: [], verdict: 'pass' };
/** Past the 5 s ingest throttle, so the next request catches up again. */
const AFTER_THROTTLE_MS = 6000;
const STORE_MANIFEST = '/api/store/objects/indx-watch-store.json';

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
    const res = await postJson(env, '/api/runs', RUN_TC9);
    expect(res.status).toBe(201);
    const runs = await getJson<RunSummary[]>(env, '/api/runs?tc=TC-9');
    expect(runs).toHaveLength(1);
    const logs = await store.listLog({});
    const last = await store.readLog(logs.keys.at(-1)!);
    expect(last.records[0]).toMatchObject({ kind: 'run', test_case: { key: 'TC-9' } });

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
    const signed = { ...publicEnv(r2), IW_SIGNING_KEY: k.secret };
    const store = bucketStore(r2);
    await store.appendLog('ci', sampleRecords(b)); // CI records (via = "github") written without a signature
    const res = await postJson(signed, '/api/runs', RUN_TC9);
    expect(res.status).toBe(201);
    const logs = await store.listLog({});
    const written = (await store.readLog(logs.keys.at(-1)!)).records[0] as AnyRecord;
    expect(written.sig?.kid).toBe('hosted-test');
    expect(await verifyRecord(written, [k.key])).toBe(true);
    const runs = await getJson<RunSummary[]>(signed, '/api/runs?tc=TC-1');
    expect(runs[0]).toMatchObject({ actor: { via: 'github' }, unverified: true });
    // /mcp on the Worker: an agent run, signed like every write of the server
    const viaWorker = (r: Request) => worker.fetch(r, signed as never);
    const args = { test_case: 'TC-9', verdict: 'fail', note: 'Coupon lost', model: 'claude-test' };
    const mr = await mcpCall(viaWorker, 'https://watch.example.com', 'record_run', args);
    expect(mr.structuredContent.run).toMatchObject({
      source: 'agent',
      actor: { kind: 'agent', model: 'claude-test' },
    });
    const agentRun = (await store.readLog((await store.listLog({})).keys.at(-1)!)).records[0] as AnyRecord;
    expect(await verifyRecord(agentRun, [k.key])).toBe(true);
  });

  it('trusts only the keys pinned at deploy (SIGNING_KEYS), never keys from a snapshot', async () => {
    const { r2, b } = await bucket();
    const [team, attacker] = [await generateSigningKey('hosted'), await generateSigningKey('hosted-2')];
    const env = publicEnv(r2);
    const pinned = { ...env, SIGNING_KEYS: JSON.stringify([team.key]) };
    // anyone who can write the store publishes a snapshot that pins their own key
    const files = await definitionFiles(nodeFs(SHOP));
    const toml = `${new TextDecoder().decode(files.get('project.toml'))}
[[signing_keys]]
kid = "hosted-2"
public_key = "${attacker.key.public_key}"
`;
    const upload = await postJson(pinned, '/api/bundle', {
      files: [{ name: 'project.toml', data: Buffer.from(toml).toString('base64') }],
    });
    expect(upload.status).toBe(201);
    const lead = { kind: 'human', id: 'lead@shop.test', via: 'cloudflare-access' } as const;
    const [r1, r2b] = sampleRecords(b).filter((r) => r.kind === 'run');
    const forged = await recordSigner(attacker.secret)({ ...r1!, actor: lead } as AnyRecord);
    const genuine = await recordSigner(team.secret)({ ...r2b!, actor: lead } as AnyRecord);
    await bucketStore(r2).appendLog('x', [forged, genuine]);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + AFTER_THROTTLE_MS);
    const runs = await getJson<RunSummary[]>(pinned, '/api/runs');
    expect(runs.find((r) => r.id === forged.id)?.unverified).toBe(true);
    expect(runs.find((r) => r.id === genuine.id)?.unverified).toBeFalsy();
    const p = await getJson<ProjectInfo>(pinned, '/api/project');
    expect(p.problems.map((x) => x.message)).toContainEqual(expect.stringContaining('iw deploy'));
    // without SIGNING_KEYS nothing is trusted
    const none = await getJson<RunSummary[]>(env, '/api/runs');
    expect(none.find((r) => r.id === genuine.id)?.unverified).toBe(true);
    vi.restoreAllMocks();
  });
});

describe('worker: a malformed signing key', () => {
  it('a malformed IW_SIGNING_KEY fails the writes, not the reads, /healthz or the catch-up', async () => {
    const { r2 } = await bucket();
    const bad = { ...publicEnv(r2), IW_SIGNING_KEY: 'pasted the TOML entry by mistake' };
    expect((await call(bad, '/healthz')).status).toBe(200);
    expect((await call(bad, '/api/project')).status).toBe(200);
    await worker.scheduled({}, bad as never);
    const res = await postJson(bad, '/api/runs', RUN_TC9);
    expect(res.status).toBe(500);
  });
});

describe('worker: access and snapshots', () => {
  afterEach(() => vi.unstubAllGlobals());

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
    const { PUBLIC: _, ...hosted } = publicEnv(r2);
    const full = { ...hosted, ACCESS_TEAM: 'shop', ACCESS_AUD: 'aud' };
    expect((await call(full, '/api/project')).status).toBe(401);
    expect((await call(full, STORE_MANIFEST)).status).toBe(401);
    expect((await call(full, '/healthz')).status).toBe(200);
  });

  it('serves an active share link without an Access JWT and records the open; /api still needs one', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ keys: [] }));
    const html = new TextEncoder().encode('<!doctype html><title>frozen</title>');
    const [token, sha] = ['0123456789abcdef0123456789abcdef', await sha256Hex(html)];
    const b = await shop();
    const link = newId('rec');
    const create = {
      ...{ kind: 'share', id: link, v: 1, project: b.project.data.id, at: '2026-11-18T00:00:00Z' },
      ...{ actor: { kind: 'human', id: 'kim@shop.test', via: 'cloudflare-access' }, source: 'manual' },
      ...{ action: 'create', token_sha256: await sha256Hex(token), expires_at: '2999-01-01T00:00:00Z' },
      ...{ audience: 'customer', sha256: sha },
    } as AnyRecord;
    const { r2, store } = await bucket([create]);
    await store.putBlob(sha, html, 'text/html');
    const { PUBLIC: _, ...hosted } = publicEnv(r2);
    const env = { ...hosted, ACCESS_TEAM: 'shop', ACCESS_AUD: 'aud' };
    const res = await call(env, `/s/${token}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('frozen');
    expect((await call(env, '/s/ffffffffffffffffffffffffffffffff')).status).toBe(404);
    expect((await call(env, '/api/shares')).status).toBe(401);
    const opened = (await store.readLog((await store.listLog({})).keys.at(-1)!)).records[0];
    expect(opened).toMatchObject({ kind: 'share', action: 'open', link, actor: { id: 'anonymous' } });
  });

  it('creates a link on a Worker with pinned keys only when its record verifies; forged records never open', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
    vi.stubGlobal('fetch', async () => Response.json({ keys: [jwk] }));
    const jwt = await new SignJWT({ email: 'kim@shop.test', sub: 'u1' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer('https://shop.cloudflareaccess.com')
      .setAudience('aud')
      .setExpirationTime('5m')
      .sign(privateKey);
    const { r2, b } = await bucket();
    const k = await generateSigningKey('hosted');
    const { PUBLIC: _, ...hosted } = publicEnv(r2);
    const env = { ...hosted, ACCESS_TEAM: 'shop', ACCESS_AUD: 'aud', SIGNING_KEYS: JSON.stringify([k.key]) };
    const share = (e: object) =>
      call(e, '/api/shares?days=7', {
        method: 'POST',
        headers: { 'Cf-Access-Jwt-Assertion': jwt, 'X-IW-Request': '1' },
      });
    // keys pinned but no IW_SIGNING_KEY: the create record would never verify, so nothing is written
    const refused = await share(env);
    expect(refused.status).toBe(503);
    expect(await refused.text()).toContain('IW_SIGNING_KEY');
    const signed = { ...env, IW_SIGNING_KEY: k.secret };
    const res = await share(signed);
    expect(res.status).toBe(201);
    const { link, url } = (await res.json()) as ShareCreated;
    const store = bucketStore(r2);
    const created = (await store.readLog((await store.listLog({})).keys.at(-1)!)).records[0]!;
    expect(created).toMatchObject({ kind: 'share', action: 'create', id: link.id });
    expect(await verifyRecord(created, [k.key])).toBe(true);
    const opened = await call(signed, new URL(url).pathname);
    expect(opened.status).toBe(200);
    expect(await opened.text()).toContain('<html');

    // direct bucket writes: an unsigned Access create, a self-asserted create and a revoke by git never count
    const at = '2026-11-19T00:00:00Z';
    const env0 = { v: 1, project: b.project.data.id, at, source: 'manual' };
    const forge = async (token: string, actor: object) => ({
      ...env0,
      ...{ kind: 'share', id: newId('rec'), actor, action: 'create', token_sha256: await sha256Hex(token) },
      ...{
        expires_at: '2999-01-01T00:00:00Z',
        audience: 'customer',
        sha256: (created as { sha256: string }).sha256,
      },
    });
    const [t1, t2] = ['1'.repeat(32), '2'.repeat(32)];
    const git = { kind: 'human', id: 'eve@shop.test', via: 'git' };
    const revoke = { ...env0, kind: 'share', id: newId('rec'), actor: git, action: 'revoke', link: link.id };
    const forged = [await forge(t1, { ...git, via: 'cloudflare-access' }), await forge(t2, git), revoke];
    await store.appendLog('x', forged as AnyRecord[]);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + AFTER_THROTTLE_MS);
    expect((await call(signed, `/s/${t1}`)).status).toBe(404);
    expect((await call(signed, `/s/${t2}`)).status).toBe(404);
    expect((await call(signed, new URL(url).pathname)).status).toBe(200);
    vi.restoreAllMocks();
  });

  it('publishes a browser upload as a snapshot, also into an empty bucket', async () => {
    const files = await definitionFiles(nodeFs(SHOP));
    const tc3 = [...files.keys()].find((k) => k.endsWith('/TC-3-valid-coupon.toml'))!;
    const text = new TextDecoder()
      .decode(files.get(tc3))
      .replace('Valid coupon reduces the total', 'Renamed');
    const post = (env: object, body: object) =>
      postJson(env, '/api/bundle', body, { cookie: 'iw_tester=%7B%22id%22%3A%22sam%40shop.test%22%7D' });
    const { r2 } = await bucket();
    const env = publicEnv(r2);
    const res = await post(env, {
      files: [{ name: 'TC-3.toml', data: Buffer.from(text).toString('base64') }],
    });
    expect(res.status).toBe(201);
    const p = await getJson<ProjectInfo>(env, '/api/project');
    expect(p.snapshot).toMatchObject({ source: 'manual', actor: { id: 'sam@shop.test', via: 'browser' } });
    expect(p.share.clone).toBe('https://watch.example.com');
    const tc = await getJson<{ data: { title: string } }>(env, '/api/test-cases/TC-3');
    expect(tc.data.title).toBe('Renamed');

    // a fresh deploy: the whole folder is the first snapshot
    const empty = { STORE: fakeR2(), DB: fakeD1(), ASSETS: assets, PUBLIC: 'true' };
    const all = [...files].map(([path, d]) => ({
      name: path,
      path,
      data: Buffer.from(d).toString('base64'),
    }));
    expect((await post(empty, { replace: true, files: all })).status).toBe(201);
    expect((await call(empty, '/api/project')).status).toBe(200);
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
