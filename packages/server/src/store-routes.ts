/**
 * The store endpoints (docs/spec/sync.md#store-http-endpoints): create-only object writes checked by role, listing,
 * and the GitHub OIDC exchange.
 */
import * as B from '@indx-watch/bundle';
import { checkRecord, ulidTime } from '@indx-watch/store';
import type { Context, Hono } from 'hono';
import type { Ctx } from './app.js';
import { bad, errorResponse, fail, HttpError, notFound, q, readBody, readJson } from './http.js';

const MANIFEST = 'indx-watch-store.json';
const LOG_KEY = /^v1\/log\/[0-9A-HJKMNP-TV-Z]{26}\.json$/;
const BLOB_KEY = /^v1\/blobs\/sha256\/([0-9a-f]{2})\/\1[0-9a-f]{62}$/;
const storeKey = (c: Context) => decodeURIComponent(c.req.path.slice('/api/store/objects/'.length));
const parsed = (d: Uint8Array | null) => new Response(d as BodyInit).json().catch(() => undefined);
const objects = (x: Ctx) => x.deps.objects ?? fail(notFound('store endpoint'));

/** Register the store endpoints; they answer 404 when deps.objects is not set. */
export function registerStoreRoutes(app: Hono, x: Ctx) {
  const store = () => objects(x);
  app.on(['GET', 'HEAD'], '/api/store/objects/*', async (c) => {
    if (c.req.method === 'HEAD') {
      const h = await store().head(storeKey(c));
      const headers = h ? { 'Content-Length': `${h.size}`, ...(h.etag && { ETag: h.etag }) } : {};
      return c.body(null, h ? 200 : 404, headers);
    }
    const data = (await store().get(storeKey(c))) ?? fail(notFound(storeKey(c)));
    return c.body(data as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': 'application/octet-stream' });
  });
  app.put('/api/store/objects/*', (c) => putObject(c, x));
  app.post('/api/sign', (c) => signRecords(c, x));
  app.get('/api/store/list', async (c) => {
    const limit = Math.max(1, Math.min(Math.trunc(Number(q(c, 'limit'))) || 1000, 1000));
    const [prefix, startAfter] = [c.req.query('prefix') ?? '', q(c, 'startAfter')];
    const r = await store().list({ prefix, startAfter, limit });
    const keys = r.keys.map(({ key, size, etag }) => ({ key, size, ...(etag && { etag }) }));
    return c.json({ keys, truncated: r.truncated });
  });
}

/** GitHub OIDC exchange (docs/spec/security.md#github-oidc): signs the records for the token; stores nothing. */
async function signRecords(c: Context, x: Ctx) {
  const exchange = x.deps.signForGithub ?? fail(notFound('GitHub OIDC signing'));
  const auth = /^Bearer (\S+)$/i.exec(c.req.header('authorization') ?? '')?.[1];
  const token = auth ?? fail(new HttpError(401, 'unauthorized', 'missing GitHub OIDC token'));
  const raw = (await readJson<{ records?: unknown }>(c)).records;
  if (!Array.isArray(raw) || !raw.length || raw.length > 1000) throw bad('records: 1 to 1000 records');
  const records = raw.map((r) => {
    const checked = checkRecord(r);
    return 'error' in checked ? fail(bad(checked.error)) : checked.record;
  });
  const project = (await storeProject(x, true)) ?? fail(notFound('project'));
  return c.json({ records: await exchange(token, records, project) });
}

/** project of the served model (none before the first snapshot), else of the store manifest */
async function storeProject(x: Ctx, manifest: boolean) {
  const id = (await x.model(null).catch(() => undefined))?.project.id;
  const m = !id && manifest && B.StoreManifest.safeParse(await parsed(await objects(x).get(MANIFEST)));
  return id ?? (m ? m.data?.project : undefined);
}

/** Records only a lead may write through the store endpoint (docs/spec/security.md#roles). */
const LEAD_KINDS = ['waiver', 'baseline', 'bundle'];
/** Refuse a log object that is far from now, malformed, holds records of another project or beyond the role. */
async function checkLog(key: string, data: Uint8Array, project: string | undefined, lead: boolean) {
  // the earliest log key wins a merge, so a writer may not pick one far from now (docs/spec/sync.md#merge-rules)
  if (Math.abs(ulidTime(key.slice(7, 33)) - Date.now()) > 3600_000)
    throw bad(`${key}: not within an hour of now`);
  const log = B.LogObject.safeParse(await parsed(data));
  if (!log.success) throw bad(`${key} is not a log object`);
  for (const raw of log.data.records) {
    const r = checkRecord(raw);
    if ('error' in r) throw bad(`${key}: ${r.error}`);
    if (project && r.record.project !== project) throw bad(`${r.record.id} belongs to another project`);
    if (r.record.kind === 'share' || r.record.kind === 'secret')
      throw bad(`${r.record.id}: ${r.record.kind} records are written by the server only`);
    if (!lead && LEAD_KINDS.includes(r.record.kind))
      throw new HttpError(403, 'forbidden', `${r.record.id}: ${r.record.kind} records need the lead role`);
  }
}

/** Refuse anything but the manifest, valid log objects and matching blobs. */
async function checkObject(x: Ctx, key: string, data: Uint8Array, lead: boolean) {
  if (BLOB_KEY.test(key)) {
    if (!key.endsWith(`/${await B.sha256Hex(data)}`)) throw bad('blob does not match its key');
    return;
  }
  const project = await storeProject(x, key !== MANIFEST);
  if (LOG_KEY.test(key)) return checkLog(key, data, project, lead);
  if (key !== MANIFEST) throw bad(`${key}: only the manifest, log objects and blobs can be written`);
  const m = B.StoreManifest.safeParse(await parsed(data));
  if (!m.success) throw bad(`${key} is not a store manifest`);
  if (project && m.data.project !== project) throw bad(`this store belongs to ${project}`);
}

/** Create-only writes of the manifest, valid log objects and matching blobs (docs/spec/sync.md#store-layout). */
async function putObject(c: Context, x: Ctx) {
  const [key, data] = [storeKey(c), await readBody(c)];
  const store = objects(x);
  const exists = () => errorResponse(new HttpError(412, 'conflict', `${key} exists`));
  if (await store.head(key)) return exists();
  await checkObject(x, key, data, (await x.grant(c)).role === 'lead');
  const opts = { ifNoneMatch: true, contentType: c.req.header('content-type') };
  if (!(await store.put(key, data, opts))) return exists();
  if (key.startsWith('v1/log/')) await x.deps.onLogObject?.(key);
  return c.body(null, 201);
}
