/** Reports, the /api/store object endpoints, and hosted mode behind Cloudflare Access. */
import { newUlid, type RunRecord } from '@indx-watch/bundle';
import { createResultStore, httpObjectStore, memoryObjectStore } from '@indx-watch/store';
import { accessIdentity } from '@indx-watch/store/workers';
import { ulidFloor } from '@indx-watch/sync';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectInfo, StoreListResponse } from '../src/index.js';
import { createApp } from '../src/index.js';
import { app, get, OTHER_PROJECT } from './app-helpers.js';
import { fakeDeps, req, SHOT, SHOT_SHA, sampleRecords } from './helpers.js';
import { mcpCall, mcpRequest } from './mcp-helpers.js';

const LOG = `v1/log/${newUlid()}.json`;
const MANIFEST = 'indx-watch-store.json';
const HOUR = 3600_000;
/** A log object body as writers put it. */
const log = (records: unknown[]) => JSON.stringify({ v: 1, writer: 'w', records });

/** An app over fakeDeps with an in-memory object store behind /api/store. */
async function storeApp(onLogObject?: (key: string) => Promise<void>) {
  const f = await fakeDeps();
  const objects = memoryObjectStore();
  return { f, objects, a: createApp({ ...f.deps, objects, ...(onLogObject ? { onLogObject } : {}) }) };
}

describe('report', () => {
  it('renders Markdown and HTML with a strict CSP', async () => {
    const { app: a } = await app();
    const md = await a.fetch(req('/api/report?format=md'));
    expect(md.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(await md.text()).toContain('# Shop — Release v1.2.0');
    const html = await a.fetch(req('/api/report?format=html&audience=customer&locale=ja&plan=PLAN-1'));
    expect(html.headers.get('content-security-policy')).toContain("default-src 'none'");
    const text = await html.text();
    expect(text).toContain('<html lang="ja">');
    expect(text).not.toMatch(/@shop\.test/);
    expect((await a.fetch(req('/api/report?format=pdf'))).status).toBe(400);
  });
});

describe('store endpoints: objects and listing', () => {
  it('GET/HEAD/PUT/list and log ingestion; writes are create-only', async () => {
    const logs: string[] = [];
    const { f, a } = await storeApp(async (k) => void logs.push(k));
    const put = (key: string, body: string, inm = true) =>
      a.fetch(
        req(`/api/store/objects/${key}`, {
          method: 'PUT',
          body,
          headers: inm ? { 'if-none-match': '*' } : {},
        }),
      );
    const body = log(sampleRecords(f.bundle).slice(0, 2));
    expect((await put(LOG, body)).status).toBe(201);
    // never overwritten, with or without If-None-Match
    expect((await put(LOG, log([]))).status).toBe(412);
    expect((await put(LOG, log([]), false)).status).toBe(412);
    expect(logs).toEqual([LOG]);
    // the earliest log key wins a merge: keys far from the server clock are refused
    for (const t of [Date.now() - 2 * HOUR, Date.now() + 2 * HOUR])
      expect((await put(`v1/log/${ulidFloor(t)}.json`, body)).status).toBe(400);
    const got = await a.fetch(req(`/api/store/objects/${LOG}`));
    expect(await got.text()).toBe(body);
    const head = await a.fetch(req(`/api/store/objects/${LOG}`, { method: 'HEAD' }));
    expect([head.status, head.headers.get('content-length')]).toEqual([200, `${body.length}`]);
    expect((await a.fetch(req('/api/store/objects/nope', { method: 'HEAD' }))).status).toBe(404);
    expect((await a.fetch(req('/api/store/objects/nope'))).status).toBe(404);
    const list = await get<StoreListResponse>(a, '/api/store/list?prefix=v1/log/');
    expect(list).toEqual({
      keys: [expect.objectContaining({ key: LOG, size: body.length })],
      truncated: false,
    });
    expect((await a.fetch(req('/api/store/objects/..%2Fx'))).status).toBe(400);
    // limits below 1 or with a fraction are clamped, not passed to the store
    for (const limit of ['-1', '0', '0.5'])
      expect(
        (await get<StoreListResponse>(a, `/api/store/list?prefix=v1/log/&limit=${limit}`)).keys,
      ).toHaveLength(1);
  });

  it('is absent without an object store', async () => {
    const { app: a } = await app();
    expect((await a.fetch(req('/api/store/list?prefix='))).status).toBe(404);
  });
});

describe('store endpoints: validation', () => {
  it('accepts only the manifest, valid log objects of this project and matching blobs', async () => {
    const { f, objects, a } = await storeApp();
    const put = async (key: string, body: BodyInit) =>
      (await a.fetch(req(`/api/store/objects/${key}`, { method: 'PUT', body }))).status;
    const project = f.bundle.project.data.id;
    const manifest = (p: string) => JSON.stringify({ format: 'indx-watch-store', version: 1, project: p });
    expect(await put(MANIFEST, manifest(OTHER_PROJECT))).toBe(400); // not the served project
    expect(await put(MANIFEST, '{"format":"x"}')).toBe(400);
    expect(await put(MANIFEST, manifest(project))).toBe(201);
    expect(await put(MANIFEST, manifest(OTHER_PROJECT))).toBe(412);
    expect(new TextDecoder().decode((await objects.get(MANIFEST))!)).toContain(project);

    const [r] = sampleRecords(f.bundle);
    expect(await put(LOG, '{"v":1}')).toBe(400);
    expect(await put(LOG, log([{ ...r, verdict: 'pass', kind: 'nope' }]))).toBe(400);
    expect(await put(LOG, log([{ ...r, project: OTHER_PROJECT }]))).toBe(400);
    expect(await put('v1/log/not-a-ulid.json', log([r]))).toBe(400);
    expect(await put('v1/snapshots/x', 'x')).toBe(400);
    expect(await put(`v1/snapshots/${newUlid()}.json`, '{"v":1}')).toBe(400); // log snapshots: direct writers only
    expect(await objects.list({ prefix: 'v1/' })).toMatchObject({ keys: [] });

    const blob = `v1/blobs/sha256/${SHOT_SHA.slice(0, 2)}/${SHOT_SHA}`;
    expect(await put(`v1/blobs/sha256/aa/${'a'.repeat(64)}`, 'x')).toBe(400);
    expect(await put(`v1/blobs/sha256/00/${SHOT_SHA}`, SHOT)).toBe(400);
    expect(await put(blob, SHOT)).toBe(201);
    expect(await put(blob, SHOT)).toBe(412);
  });
});

describe('store endpoints: http store adapter', () => {
  it('works with the http store adapter: init, append, blobs (iw sync to a hosted server)', async () => {
    const { f, a } = await storeApp();
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) => a.fetch(new Request(input, init)));
    try {
      const store = createResultStore(httpObjectStore({ baseUrl: 'https://watch.example' }));
      await store.init(f.bundle.project.data.id);
      const [key] = await store.appendLog('w', sampleRecords(f.bundle));
      expect((await store.readLog(key!)).records).toHaveLength(9);
      await store.putBlob(SHOT_SHA, SHOT, 'image/png');
      expect(await store.hasBlob(SHOT_SHA)).toBe(true);
      await expect(store.init(OTHER_PROJECT)).rejects.toThrow(/belongs to project/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('hosted mode with Cloudflare Access', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects requests without a valid Access JWT (401) and attributes writes to the JWT identity', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) =>
      String(input instanceof Request ? input.url : input) ===
      'https://shop.cloudflareaccess.com/cdn-cgi/access/certs'
        ? Response.json({ keys: [jwk] })
        : real(input, init),
    );
    const f = await fakeDeps();
    const a = createApp({
      ...f.deps,
      mode: 'hosted',
      identity: accessIdentity({ team: 'shop', aud: 'aud-1' }),
      assets: async () =>
        new Response('<!doctype html><title>x</title>', { headers: { 'content-type': 'text/html' } }),
    });
    expect((await a.fetch(req('/healthz'))).status).toBe(200);
    const anon = await a.fetch(req('/api/status'));
    expect(anon.status).toBe(401);
    expect(((await anon.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
    expect((await a.fetch(req('/'))).status).toBe(401);
    const sign = (aud: string) =>
      new SignJWT({ email: 'kim@shop.test', name: 'Kim' })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer('https://shop.cloudflareaccess.com')
        .setAudience(aud)
        .setExpirationTime('5m')
        .sign(privateKey);
    const wrongAud = await a.fetch(
      req('/api/status', { headers: { 'cf-access-jwt-assertion': await sign('other') } }),
    );
    expect(wrongAud.status).toBe(401);
    const h = { 'cf-access-jwt-assertion': await sign('aud-1') };
    const p = await a.fetch(req('/api/project', { headers: h }));
    expect(((await p.json()) as ProjectInfo).identity).toEqual({
      kind: 'human',
      id: 'kim@shop.test',
      name: 'Kim',
      via: 'cloudflare-access',
    });
    // /mcp is behind Access too; its writes record the verified identity as an agent
    expect((await mcpRequest(a.fetch, 'http://127.0.0.1', 'tools/list', {})).status).toBe(401);
    const args = { test_case: 'TC-9', verdict: 'fail', note: 'Coupon lost', model: 'claude-test' };
    const mr = await mcpCall(a.fetch, 'http://127.0.0.1', 'record_run', args, h);
    expect(mr.structuredContent.run.actor).toEqual({
      ...{ kind: 'agent', id: 'kim@shop.test', name: 'Kim', via: 'cloudflare-access', model: 'claude-test' },
    });
    const page = await a.fetch(req('/', { headers: h }));
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    const r = await a.fetch(
      new Request('http://127.0.0.1/api/runs', {
        method: 'POST',
        headers: { ...h, 'content-type': 'application/json' },
        body: JSON.stringify({ test_case: 'TC-1', steps: [], verdict: 'pass' }),
      }),
    );
    expect(r.status).toBe(201);
    expect((f.written[0] as RunRecord).actor.via).toBe('cloudflare-access');
  });
});
