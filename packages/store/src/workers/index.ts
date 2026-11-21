/**
 * Workers-side factories. CONTRACT: signatures frozen.
 * Binding types are declared here for the parts we use, to avoid another dependency.
 */
import type { AnyRecord } from '@indx-watch/bundle';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { filterRecords, recordRelease, recordTestCase } from '../adapters/memory.js';
import { CONFLICTS_META, type Held, mergePlan } from '../merge.js';
import type { IdentityProvider, Index, IndexFilter, ObjectInfo, ObjectStore } from '../ports.js';
import { StoreError } from '../ports.js';
import { checkKey, compact, toBytes } from '../util.js';
import { INDEX_SCHEMA } from './index-schema.js';

export { INDEX_SCHEMA } from './index-schema.js';

type R2Object = { key: string; size: number; httpEtag?: string };
type R2Opts = { onlyIf?: Headers; httpMetadata?: { contentType?: string } };
type R2ListOpts = { prefix?: string; cursor?: string; limit?: number; startAfter?: string };
interface R2Like {
  get(key: string): Promise<(R2Object & { arrayBuffer(): Promise<ArrayBuffer> }) | null>;
  head(key: string): Promise<R2Object | null>;
  put(key: string, value: Uint8Array, opts?: R2Opts): Promise<R2Object | null>;
  list(opts: R2ListOpts): Promise<{ objects: R2Object[]; truncated: boolean; cursor?: string }>;
  delete(key: string): Promise<void>;
}

/** One list() page request: continue from the cursor, or start after `after` on the first page. */
const r2Page = (prefix: string, cursor?: string, after?: string): R2ListOpts => ({
  prefix,
  limit: 1000,
  ...(cursor ? { cursor } : after ? { startAfter: after } : {}),
});

/** ObjectStore over an R2 bucket binding, under an optional key prefix. */
export function r2ObjectStore(bucket: unknown, prefix?: string): ObjectStore {
  const b = bucket as R2Like;
  const p = prefix ? `${prefix.replace(/^\/+|\/+$/g, '')}/` : '';
  const k = (key: string) => p + checkKey(key);
  const info = (o: R2Object): ObjectInfo => ({
    key: o.key.slice(p.length),
    size: o.size,
    etag: o.httpEtag,
  });
  return {
    url: `r2://${p.slice(0, -1)}`,
    async get(key) {
      const o = await b.get(k(key));
      return o ? new Uint8Array(await o.arrayBuffer()) : null;
    },
    async head(key) {
      const o = await b.head(k(key));
      return o ? info(o) : null;
    },
    async put(key, body, opts) {
      const r = await b.put(k(key), toBytes(body), {
        ...(opts?.ifNoneMatch ? { onlyIf: new Headers({ 'If-None-Match': '*' }) } : {}),
        ...(opts?.contentType ? { httpMetadata: { contentType: opts.contentType } } : {}),
      });
      return r !== null;
    },
    // The binding's list() does not guarantee startAfter: page with the cursor and filter here as well
    async list(opts) {
      const limit = opts.limit ?? 1000;
      const after = opts.startAfter ? p + opts.startAfter : undefined;
      const out: ObjectInfo[] = [];
      let cursor: string | undefined;
      for (;;) {
        const r = await b.list(r2Page(p + opts.prefix, cursor, after));
        for (const o of r.objects) if (!after || o.key > after) out.push(info(o));
        if (out.length > limit || !r.truncated || !r.cursor)
          return { keys: out.slice(0, limit), truncated: out.length > limit || r.truncated };
        cursor = r.cursor;
      }
    },
    async delete(key) {
      await b.delete(k(key));
    },
  };
}

interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
interface D1Like {
  prepare(sql: string): D1Stmt;
  batch(stmts: D1Stmt[]): Promise<{ meta?: { changes?: number } }[]>;
}

const META =
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value';
// Guarded writes: each applies only to the state ingest read, so concurrent ingests cannot overwrite each other
const ADD = `INSERT INTO records (kind, at, test_case_id, release, json, id) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO NOTHING`;
const REPLACE =
  'UPDATE records SET kind = ?, at = ?, test_case_id = ?, release = ?, json = ? WHERE id = ? AND json = ?';
const KEY = `INSERT INTO record_keys (id, log_key) SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM records WHERE id = ?1 AND json = ?3)
    ON CONFLICT (id) DO UPDATE SET log_key = excluded.log_key WHERE log_key IS ?4 OR excluded.log_key < log_key`;
const NOTES = `INSERT INTO meta (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = json_patch(value, excluded.value)`;
const HELD = `SELECT r.id, r.json, k.log_key AS key FROM records r LEFT JOIN record_keys k ON k.id = r.id
    WHERE r.id IN (SELECT value FROM json_each(?))`;
const row = (r: AnyRecord) => [
  r.kind,
  r.at,
  recordTestCase(r) ?? null,
  recordRelease(r) ?? null,
  JSON.stringify(r),
  r.id,
];
type Query = (sql: string, ...args: unknown[]) => D1Stmt;
/** Statements per D1 batch (one transaction), to stay under the bind limit. */
const BATCH_LIMIT = 100;
/** Ingest rounds before records still losing races are given up on (they are left out of the returned count). */
const INGEST_ROUNDS = 5;
type PlanItem = Awaited<ReturnType<typeof mergePlan>>['plan'][number];

/**
 * Runs statement groups in batches. One batch is one transaction of at most BATCH_LIMIT
 * statements; a group never spans two. Returns the rows each statement changed.
 */
async function runGroups(d: D1Like, groups: D1Stmt[][]) {
  const changes: number[] = [];
  for (let i = 0; i < groups.length; ) {
    const stmts: D1Stmt[] = [];
    while (i < groups.length && (!stmts.length || stmts.length + groups[i]!.length <= BATCH_LIMIT))
      stmts.push(...groups[i++]!);
    for (const r of await d.batch(stmts)) changes.push(r.meta?.changes ?? 0);
  }
  return changes;
}

/** A record's statements, kept in one transaction: the body (unless only its key changes), then its key. */
function planStatements(q: Query, { r, step, held }: PlanItem, logKey?: string) {
  return [
    ...(step === 'add' ? [q(ADD, ...row(r))] : step === 'replace' ? [q(REPLACE, ...row(r), held!.json)] : []),
    ...(logKey ? [q(KEY, r.id, logKey, JSON.stringify(r), held?.key ?? null)] : []),
  ];
}

/** One ingest round: plans `todo` against the held rows, writes it guarded, and returns what lost a race and the count. */
async function ingestRound(d: D1Like, q: Query, [todo, logKey, trust]: Parameters<Index['ingest']>) {
  const { results } = await q(HELD, JSON.stringify(todo.map((r) => r.id))).all<Held & { id: string }>();
  const { plan, notes, count } = await mergePlan(new Map(results.map((h) => [h.id, h])), todo, logKey, trust);
  const groups = plan.map((item) => planStatements(q, item, logKey));
  const changes = await runGroups(d, groups);
  let i = 0;
  // a guarded write that changed nothing lost a race with another ingest
  const lost = plan.filter((p, g) => {
    const won = p.step === 'key' || !!changes[i];
    i += groups[g]!.length;
    return !won;
  });
  if (Object.keys(notes).length) await q(NOTES, CONFLICTS_META, JSON.stringify(notes)).run();
  return { lost: lost.map((p) => p.r), count: count - lost.length };
}

/** Records matching `f`: SQL narrows by test case, release and time; kinds, order and limit are left to the caller. */
async function selectRecords(q: Query, f: IndexFilter) {
  const conds = Object.entries({
    'test_case_id = ?': f.testCaseId,
    'release = ?': f.release,
    'at >= ?': f.since,
  });
  const used = conds.filter(([, v]) => v);
  const where = used.length ? ` WHERE ${used.map(([c]) => c).join(' AND ')}` : '';
  const { results } = await q(`SELECT json FROM records${where}`, ...used.map(([, v]) => v)).all<Held>();
  return results.map((r) => JSON.parse(r.json) as AnyRecord);
}

/** Statements that replace the whole definitions snapshot, then its source and at meta (read back as the snapshot marker). */
function definitionStatements(q: Query, files: Map<string, string>, m: { source: string; at: string }) {
  return [
    q('DELETE FROM definitions'),
    ...[...files].map(([path, text]) => q('INSERT INTO definitions (path, text) VALUES (?, ?)', path, text)),
    q(META, 'definitions.source', m.source),
    q(META, 'definitions.at', m.at),
  ];
}

/**
 * Index over a D1 binding (plain SQL schema in src/index-schema.sql). The schema is created lazily on first use.
 * ingest() retries records that lost a race with a concurrent ingest, up to INGEST_ROUNDS times.
 */
export function d1Index(db: unknown): Index {
  const d = db as D1Like;
  const q: Query = (sql, ...args) => d.prepare(sql).bind(...args);
  let ready: Promise<unknown> | undefined;
  const init = () => (ready ??= d.batch(INDEX_SCHEMA.map((s) => d.prepare(s))));
  const batch = (groups: D1Stmt[][]) => runGroups(d, groups);

  const index: Index = {
    async ingest(records, logKey, trust) {
      await init();
      let [todo, n] = [records, 0];
      // a record that lost a race with another ingest is decided again
      for (let round = 0; todo.length && round < INGEST_ROUNDS; round++) {
        const { lost, count } = await ingestRound(d, q, [todo, logKey, trust]);
        [todo, n] = [lost, n + count];
      }
      return n;
    },
    async records(f: IndexFilter = {}) {
      await init();
      // kinds, order and limit follow the memory index through the same filterRecords
      return filterRecords(await selectRecords(q, f), f);
    },
    async setDefinitions(files, m) {
      await init();
      await batch(definitionStatements(q, files, m).map((x) => [x]));
    },
    async definitions() {
      const [source, at] = [await this.getMeta('definitions.source'), await this.getMeta('definitions.at')];
      if (source === null || at === null) return null;
      const { results } = await q('SELECT path, text FROM definitions ORDER BY path').all<{
        path: string;
        text: string;
      }>();
      return { files: new Map(results.map((r) => [r.path, r.text])), source, at };
    },
    async getMeta(key) {
      await init();
      return (await q('SELECT value FROM meta WHERE key = ?', key).first<{ value: string }>())?.value ?? null;
    },
    async setMeta(key, value) {
      await init();
      await q(META, key, value).run();
    },
    async reset() {
      await init();
      await batch(['records', 'record_keys', 'definitions', 'meta'].map((t) => [q(`DELETE FROM ${t}`)]));
    },
  };
  return index;
}

/** The id, name and email of an Access group object. */
const pickNames = (g: unknown) => {
  const { id, name, email } = (g ?? {}) as Record<string, unknown>;
  return { id, name, email };
};

/** Identity from Cf-Access-Jwt-Assertion verified against https://<team>.cloudflareaccess.com/cdn-cgi/access/certs and aud. */
export function accessIdentity(opts: { team: string; aud: string; fetch?: typeof fetch }): IdentityProvider {
  const issuer = `https://${opts.team}.cloudflareaccess.com`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  const cache = new Map<string, { until: number; groups: Promise<string[]> }>();
  /** get-identity with the (already verified) token as the CF_Authorization cookie; a failure means no groups */
  const lookup = async (token: string) => {
    const f = opts.fetch ?? fetch;
    const r = await f(`${issuer}/cdn-cgi/access/get-identity`, {
      headers: { cookie: `CF_Authorization=${token}` },
    });
    const body = (r.ok ? await r.json().catch(() => ({})) : {}) as { groups?: unknown };
    const groups = Array.isArray(body.groups) ? (body.groups as unknown[]) : [];
    const names = (g: unknown) => (typeof g === 'string' ? [g] : Object.values(pickNames(g)));
    return groups.flatMap(names).filter((s): s is string => typeof s === 'string' && s !== '');
  };
  return {
    async groups(request) {
      const token = request.headers.get('cf-access-jwt-assertion') ?? '';
      const now = Date.now();
      if (cache.size > 1000) cache.clear();
      const hit = cache.get(token);
      if (hit && hit.until > now) return hit.groups;
      const groups = token ? lookup(token).catch(() => []) : Promise.resolve([]);
      cache.set(token, { until: now + 300_000, groups });
      return groups;
    },
    async current(request) {
      const token = request?.headers.get('cf-access-jwt-assertion');
      if (!token) throw new StoreError('unauthorized', 'missing Cf-Access-Jwt-Assertion');
      let claims: { email?: unknown; name?: unknown; common_name?: unknown };
      try {
        claims = (await jwtVerify(token, jwks, { issuer, audience: opts.aud })).payload as typeof claims;
      } catch (e) {
        throw new StoreError('unauthorized', `invalid Access token: ${(e as Error).message}`, e);
      }
      if (typeof claims.email === 'string' && claims.email) {
        const name = typeof claims.name === 'string' ? claims.name : undefined;
        return compact({ kind: 'human', id: claims.email, name, via: 'cloudflare-access' });
      }
      // service token: sub is empty and common_name holds the client ID
      if (typeof claims.common_name === 'string' && claims.common_name) {
        return { kind: 'ci', id: `ci:access:${claims.common_name}`, via: 'cloudflare-access' };
      }
      throw new StoreError('unauthorized', 'Access token has no email or service token identity');
    },
  };
}
