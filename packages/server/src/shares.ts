/**
 * Report share links on the hosted app (docs/spec/reports.md#share-links, docs/spec/security.md#share-links):
 * a frozen HTML report in the blob store, one `share` record per create, open and revoke, and `GET /s/<token>`,
 * the one route besides /healthz that resolves no identity.
 */
import * as B from '@indx-watch/bundle';
import type { Model } from '@indx-watch/core';
import type { Context, Hono } from 'hono';
import type { Ctx } from './app.js';
import type { ShareCreated, ShareLink } from './contract.js';
import { bad, fail, HttpError, iso, notFound } from './http.js';
import { HTML_REPORT, reportFor } from './routes.js';

const DAY = 86_400_000;
/** recorded as the actor of `open`: share links carry no identity */
const VISITOR: B.Actor = { kind: 'human', id: 'anonymous', via: 'env' };
const PUBLIC_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
};

/** The actor of a create or revoke request, else 403. */
async function sharer(c: Context, x: Ctx) {
  const who = await x.actor(c);
  if (x.sharer(who)) return who;
  throw new HttpError(403, 'forbidden', 'share links need a person signed in through Cloudflare Access');
}

/** Links by their `create` records, newest first; with pinned signing keys, an unverified one never counts. */
const creates = (m: Model) =>
  m.shares
    .filter((r) => r.action === 'create' && !(m.project.signing_keys?.length && m.unverified?.has(r.id)))
    .sort((a, b) => (a.id < b.id ? 1 : -1));

/** The API view of a link, from its `create` record and the link's later events. */
function view(r: B.ShareRecord, events: B.ShareRecord[], now: string): ShareLink {
  const of = (action: string) => events.filter((e) => e.link === r.id && e.action === action);
  const [rv, { id, at, actor, locale, release, environment, plan }] = [of('revoke')[0], r];
  const { audience = 'customer', expires_at = at } = r;
  const state = rv ? 'revoked' : expires_at > now ? 'active' : 'expired';
  const scope = { locale, release, environment, plan };
  const revoked = rv && { revoked: { at: rv.at, actor: rv.actor } };
  return { id, at, actor, audience, ...scope, expires_at, state, opens: of('open').length, ...revoked };
}

/** Write one `share` record. */
async function write(x: Ctx, m: Model, actor: B.Actor, fields: Partial<B.ShareRecord>) {
  const env = { kind: 'share', id: B.newId('rec'), v: 1, project: m.project.id, at: x.now(), actor };
  const record = B.ShareRecord.parse({ ...env, source: 'manual', ...fields });
  await x.deps.writeRecord(record);
  return record;
}

async function create(c: Context, x: Ctx) {
  const who = await sharer(c, x);
  const days = Number(c.req.query('days') || 7);
  if (!Number.isInteger(days) || days < 1 || days > 90) throw bad('days must be a whole number from 1 to 90');
  const { m, audience, locale, plan, scope, text } = await reportFor(c, x, 'html');
  const sha256 = await x.deps.putBlob(new TextEncoder().encode(text), 'text/html');
  const bytes = crypto.getRandomValues(new Uint8Array(16)); // 128 bits
  const token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const expires_at = iso(new Date(Date.parse(x.now()) + days * DAY));
  const fields = { audience, locale, release: scope.release, environment: scope.environment, plan, sha256 };
  const r = await write(x, m, who, {
    action: 'create',
    token_sha256: await B.sha256Hex(token),
    expires_at,
    ...fields,
  });
  const body: ShareCreated = { link: view(r, [], x.now()), url: `${new URL(c.req.url).origin}/s/${token}` };
  return c.json(body, 201);
}

async function revoke(c: Context, x: Ctx) {
  const [who, m, id] = [await sharer(c, x), await x.model(), c.req.param('id')];
  const r = creates(m).find((l) => l.id === id) ?? fail(notFound(`share link ${id}`));
  const events = view(r, m.shares, x.now()).revoked
    ? m.shares
    : [...m.shares, await write(x, m, who, { action: 'revoke', link: r.id })];
  return c.json(view(r, events, x.now()));
}

/** GET /s/<token>: the snapshot of an active link, recorded as an open; anything else is a 404 with nothing recorded. */
async function open(c: Context, x: Ctx) {
  const [m, hash] = [await x.model(), await B.sha256Hex(c.req.param('token') ?? '')];
  const r = creates(m).find((l) => l.token_sha256 === hash);
  const active = r?.sha256 && view(r, m.shares, x.now()).state === 'active';
  const html = active ? await x.deps.getBlob(r.sha256!) : null;
  if (!r || !html) throw notFound('share link');
  await write(x, m, VISITOR, { action: 'open', link: r.id });
  return c.body(html as Uint8Array<ArrayBuffer>, 200, { ...HTML_REPORT, ...PUBLIC_HEADERS });
}

/** Register the share-link routes. */
export function registerShareRoutes(app: Hono, x: Ctx) {
  app.post('/api/shares', (c) => create(c, x));
  app.get('/api/shares', async (c) => {
    const m = await x.model();
    return c.json(creates(m).map((r) => view(r, m.shares, x.now())));
  });
  app.delete('/api/shares/:id', (c) => revoke(c, x));
  app.get('/s/:token', (c) => open(c, x));
}
