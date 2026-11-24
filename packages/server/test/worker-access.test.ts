/** The Worker behind Cloudflare Access: missing snapshots, JWTs, share links, pinned ROLES and browser uploads. */
import { type AnyRecord, generateSigningKey, newId, sha256Hex, verifyRecord } from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { definitionFiles } from '@indx-watch/sync';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeD1, fakeR2 } from '../../store/test/helpers/fakes.js';
import type { ProjectInfo, ShareCreated } from '../src/index.js';
import { SHOP, shop } from './helpers.js';
import {
  AFTER_THROTTLE_MS,
  accessEnv,
  accessKey,
  assets,
  bucket,
  bucketStore,
  call,
  getJson,
  hostedEnv,
  lastRecord,
  postJson,
  publicEnv,
  RUN_TC9,
  STORE_MANIFEST,
} from './worker-helpers.js';

afterEach(() => vi.unstubAllGlobals());

describe('worker: access', () => {
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
    const full = hostedEnv(r2);
    expect((await call(full, '/api/project')).status).toBe(401);
    expect((await call(full, STORE_MANIFEST)).status).toBe(401);
    expect((await call(full, '/healthz')).status).toBe(200);
  });

  it('applies the pinned ROLES with groups from get-identity; an invalid ROLES lets nobody in; --public ignores them', async () => {
    const { jwk, as } = await accessKey();
    const groups: Record<string, string[]> = { 'kim@shop.test': ['qa'], 'viv@shop.test': [] };
    const tokens = new Map<string, string>();
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      if (!String(url).endsWith('/get-identity')) return Response.json({ keys: [jwk] });
      const token = new Headers(init?.headers).get('cookie')!.replace('CF_Authorization=', '');
      return Response.json({ groups: groups[tokens.get(token)!] });
    });
    const signIn = async (email: string) => {
      const header = await as(email);
      tokens.set(header['Cf-Access-Jwt-Assertion'], email);
      return header;
    };
    const { r2 } = await bucket();
    const env = hostedEnv(r2, { ROLES: JSON.stringify({ tester: ['QA'] }) });
    const [kim, viv] = [await signIn('kim@shop.test'), await signIn('viv@shop.test')];
    expect((await getJson<ProjectInfo>(env, '/api/project', { headers: kim })).role).toBe('tester');
    expect((await postJson(env, '/api/runs', RUN_TC9, kim)).status).toBe(201);
    expect((await call(env, '/api/project', { headers: viv })).status).toBe(403);
    const project = (roles: string, headers: Record<string, string>) =>
      call({ ...env, ROLES: roles }, '/api/project', { headers });
    expect((await project('{"lead": "nope"}', kim)).status).toBe(403);
    expect((await project('{"default": "viewer"}', viv)).status).toBe(200);
    const open = { ...publicEnv(r2), ROLES: JSON.stringify({ tester: ['qa'] }) };
    expect((await getJson<ProjectInfo>(open, '/api/project')).role).toBe('viewer');
  });
});

/** A share create record written straight to the bucket, as anyone with write access to it could. */
async function shareCreate(project: string, token: string, actor: object, sha256: string, at: string) {
  return {
    ...{ kind: 'share', id: newId('rec'), v: 1, project, at, actor, source: 'manual' },
    ...{ action: 'create', token_sha256: await sha256Hex(token), expires_at: '2999-01-01T00:00:00Z' },
    ...{ audience: 'customer', sha256 },
  } as AnyRecord;
}

describe('worker: share links', () => {
  it('serves an active share link without an Access JWT and records the open; /api still needs one', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ keys: [] }));
    const html = new TextEncoder().encode('<!doctype html><title>frozen</title>');
    const [token, sha] = ['0123456789abcdef0123456789abcdef', await sha256Hex(html)];
    const kim = { kind: 'human', id: 'kim@shop.test', via: 'cloudflare-access' };
    const create = await shareCreate((await shop()).project.data.id, token, kim, sha, '2026-11-18T00:00:00Z');
    const { r2, store } = await bucket([create]);
    await store.putBlob(sha, html, 'text/html');
    const env = hostedEnv(r2);
    const res = await call(env, `/s/${token}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('frozen');
    expect((await call(env, '/s/ffffffffffffffffffffffffffffffff')).status).toBe(404);
    expect((await call(env, '/api/shares')).status).toBe(401);
    const [opened, link] = [await lastRecord(store), create.id];
    expect(opened).toMatchObject({ kind: 'share', action: 'open', link, actor: { id: 'anonymous' } });
  });

  it('creates a link on a Worker with pinned keys only when its record verifies; forged records never open', async () => {
    const { r2, b } = await bucket();
    const k = await generateSigningKey('hosted');
    const { env, kim } = await accessEnv(r2, { SIGNING_KEYS: JSON.stringify([k.key]) });
    const share = (e: object) =>
      call(e, '/api/shares?days=7', { method: 'POST', headers: { ...kim, 'X-IW-Request': '1' } });
    // keys pinned but no IW_SIGNING_KEY: the create record would never verify, so nothing is written
    const refused = await share(env);
    expect(refused.status).toBe(503);
    expect(await refused.text()).toContain('IW_SIGNING_KEY');
    const signed = { ...env, IW_SIGNING_KEY: k.secret };
    const res = await share(signed);
    expect(res.status).toBe(201);
    const { link, url } = (await res.json()) as ShareCreated;
    const store = bucketStore(r2);
    const created = await lastRecord(store);
    expect(created).toMatchObject({ kind: 'share', action: 'create', id: link.id });
    expect(await verifyRecord(created, [k.key])).toBe(true);
    const opened = await call(signed, new URL(url).pathname);
    expect(opened.status).toBe(200);
    expect(await opened.text()).toContain('<html');

    // direct bucket writes: an unsigned Access create, a self-asserted create and a revoke by git never count
    const at = '2026-11-19T00:00:00Z';
    const project = b.project.data.id;
    const forge = (token: string, actor: object) =>
      shareCreate(project, token, actor, (created as { sha256: string }).sha256, at);
    const [t1, t2] = ['1'.repeat(32), '2'.repeat(32)];
    const git = { kind: 'human', id: 'eve@shop.test', via: 'git' };
    const base = { v: 1, project, at, source: 'manual' };
    const revoked = { ...base, kind: 'share', id: newId('rec'), actor: git, action: 'revoke', link: link.id };
    const forged = [await forge(t1, { ...git, via: 'cloudflare-access' }), await forge(t2, git), revoked];
    await store.appendLog('x', forged as AnyRecord[]);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + AFTER_THROTTLE_MS);
    expect((await call(signed, `/s/${t1}`)).status).toBe(404);
    expect((await call(signed, `/s/${t2}`)).status).toBe(404);
    expect((await call(signed, new URL(url).pathname)).status).toBe(200);
    vi.restoreAllMocks();
  });
});

describe('worker: browser uploads', () => {
  it('publishes a browser upload as a snapshot, also into an empty bucket', async () => {
    const files = await definitionFiles(nodeFs(SHOP));
    const tc3 = [...files.keys()].find((k) => k.endsWith('/TC-3-valid-coupon.toml'))!;
    const text = new TextDecoder()
      .decode(files.get(tc3))
      .replace('Valid coupon reduces the total', 'Renamed');
    const { r2 } = await bucket();
    const { env, kim } = await accessEnv(r2);
    const post = (env: object, body: object) => postJson(env, '/api/bundle', body, kim);
    const get = <T>(path: string) => getJson<T>(env, path, { headers: kim });
    const res = await post(env, {
      files: [{ name: 'TC-3.toml', data: Buffer.from(text).toString('base64') }],
    });
    expect(res.status).toBe(201);
    const p = await get<ProjectInfo>('/api/project');
    expect(p.snapshot).toMatchObject({
      source: 'manual',
      actor: { id: 'kim@shop.test', via: 'cloudflare-access' },
    });
    expect(p.share.clone).toBe('https://watch.example.com');
    const tc = await get<{ data: { title: string } }>('/api/test-cases/TC-3');
    expect(tc.data.title).toBe('Renamed');

    // a fresh deploy: the whole folder is the first snapshot
    const { STORE_PREFIX: _, ...fresh } = env;
    const empty = { ...fresh, STORE: fakeR2(), DB: fakeD1() };
    const all = [...files].map(([path, d]) => ({
      name: path,
      path,
      data: Buffer.from(d).toString('base64'),
    }));
    expect((await post(empty, { replace: true, files: all })).status).toBe(201);
    expect((await call(empty, '/api/project', { headers: kim })).status).toBe(200);
  });
});
