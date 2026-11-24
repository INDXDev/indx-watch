/** Shared fixtures for the worker*.test.ts files: a bucket with a shop snapshot, requests and hosted envs. */
import { type AnyRecord, newId, sha256Hex } from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { createResultStore } from '@indx-watch/store';
import { r2ObjectStore } from '@indx-watch/store/workers';
import { snapshotBundle } from '@indx-watch/sync';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { vi } from 'vitest';
import { TOOL_OUTPUTS } from '../../cli/src/tools.js';
import { fakeD1, fakeR2 } from '../../store/test/helpers/fakes.js';
import { createWorker } from '../src/worker.js';
import { SHOP, shop } from './helpers.js';

export const worker = createWorker(TOOL_OUTPUTS);

export const assets = {
  fetch: async () =>
    new Response('<!doctype html><title>spa</title>', { headers: { 'content-type': 'text/html' } }),
};

/** A bucket with a bundle snapshot (as `iw sync --snapshot` publishes it) and optional records written directly to it. */
export async function bucket(records: AnyRecord[] = []) {
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

export const call = (env: object, path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://watch.example.com${path}`, init), env as never);

/** GET a JSON API path. */
export const getJson = async <T>(env: object, path: string, init?: RequestInit) =>
  (await (await call(env, path, init)).json()) as T;

/** POST a JSON body. */
export const postJson = (env: object, path: string, body: unknown, headers: Record<string, string> = {}) =>
  call(env, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

/** The public hosted env over a bucket with the `shop` prefix. */
export const publicEnv = (r2: unknown) => ({
  STORE: r2,
  DB: fakeD1(),
  ASSETS: assets,
  STORE_PREFIX: 'shop',
  PUBLIC: 'true',
});

/** The hosted env behind Access (team `shop`, aud `aud`) over the bucket, without the public flag. */
export function hostedEnv(r2: unknown, extra: object = {}) {
  const { PUBLIC: _, ...hosted } = publicEnv(r2);
  return { ...hosted, ACCESS_TEAM: 'shop', ACCESS_AUD: 'aud', ...extra };
}

/** An Access signing key: its JWK (kid `k1`) and the `Cf-Access-Jwt-Assertion` header for a person. */
export async function accessKey() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  const as = async (email: string, sub = email) => ({
    'Cf-Access-Jwt-Assertion': await new SignJWT({ email, sub })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer('https://shop.cloudflareaccess.com')
      .setAudience('aud')
      .setExpirationTime('5m')
      .sign(privateKey),
  });
  return { jwk, as };
}

/**
 * A Worker behind Access over the bucket (a fake JWKS through a stubbed fetch) and the header of a signed-in
 * person: a public deploy is read-only (docs/spec/security.md#public-deploys), so writes are tested here.
 */
export async function accessEnv(r2: unknown, extra: object = {}) {
  const { jwk, as } = await accessKey();
  vi.stubGlobal('fetch', async () => Response.json({ keys: [jwk] }));
  return { env: hostedEnv(r2, extra), kim: await as('kim@shop.test', 'u1') };
}

/** The result store the worker reads, opened again from the test. */
export const bucketStore = (r2: Parameters<typeof r2ObjectStore>[0]) =>
  createResultStore(r2ObjectStore(r2, 'shop'));

/** The first record of the newest log object in a store. */
export async function lastRecord(store: ReturnType<typeof createResultStore>) {
  return (await store.readLog((await store.listLog({})).keys.at(-1)!)).records[0] as AnyRecord;
}

/** A passing run of TC-9 as the web UI posts it. */
export const RUN_TC9 = { test_case: 'TC-9', steps: [], verdict: 'pass' };
/** Past the 5 s ingest throttle, so the next request catches up again. */
export const AFTER_THROTTLE_MS = 6000;
export const STORE_MANIFEST = '/api/store/objects/indx-watch-store.json';
