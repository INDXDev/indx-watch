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
        const r = await b.list({
          prefix: p + opts.prefix,
          limit: 1000,
          ...(cursor ? { cursor } : { ...(after ? { startAfter: after } : {}) }),
        });
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

/** Index over a D1 binding (plain SQL schema in src/index-schema.sql). */
export function d1Index(db: unknown): Index {
  const d = db as D1Like;
  const q = (sql: string, ...args: unknown[]) => d.prepare(sql).bind(...args);
  let ready: Promise<unknown> | undefined;
  const init = () => (ready ??= d.batch(INDEX_SCHEMA.map((s) => d.prepare(s))));
  // One batch is one transaction, at most 100 statements to stay under the bind limit; a group never spans two.
  // Returns the rows each statement changed.
  const batch = async (groups: D1Stmt[][]) => {
    const changes: number[] = [];
    for (let i = 0; i < groups.length; ) {
      const stmts: D1Stmt[] = [];
      while (i < groups.length && (!stmts.length || stmts.length + groups[i]!.length <= 100))
        stmts.push(...groups[i++]!);
      for (const r of await d.batch(stmts)) changes.push(r.meta?.changes ?? 0);
    }
    return changes;
  };
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

  const index: Index = {
    async ingest(records, logKey, trust) {
      await init();
      let [todo, n] = [records, 0];
      // a guarded write that changed nothing lost a race with another ingest: decide that record again
      for (let round = 0; todo.length && round < 5; round++) {
        const ids = JSON.stringify(todo.map((r) => r.id));
        const { results } = await q(HELD, ids).all<Held & { id: string }>();
        const { plan, notes, count } = await mergePlan(
          new Map(results.map((h) => [h.id, h])),
          todo,
          logKey,
          trust,
        );
        // a record's statements stay in one transaction: the body (unless only its key changes), then its key
        const groups = plan.map(({ r, step, held }) => [
          ...(step === 'add'
            ? [q(ADD, ...row(r))]
            : step === 'replace'
              ? [q(REPLACE, ...row(r), held!.json)]
              : []),
          ...(logKey ? [q(KEY, r.id, logKey, JSON.stringify(r), held?.key ?? null)] : []),
        ]);
        const changes = await batch(groups);
        let i = 0;
        const lost = plan.filter((p, g) => {
          const won = p.step === 'key' || !!changes[i];
          i += groups[g]!.length;
          return !won;
        });
        if (Object.keys(notes).length) await q(NOTES, CONFLICTS_META, JSON.stringify(notes)).run();
        [todo, n] = [lost.map((p) => p.r), n + count - lost.length];
      }
      return n;
    },
    async records(f: IndexFilter = {}) {
      await init();
      const conds = Object.entries({
        'test_case_id = ?': f.testCaseId,
        'release = ?': f.release,
        'at >= ?': f.since,
      });
      const used = conds.filter(([, v]) => v);
      const where = used.length ? ` WHERE ${used.map(([c]) => c).join(' AND ')}` : '';
      const { results } = await q(`SELECT json FROM records${where}`, ...used.map(([, v]) => v)).all<{
        json: string;
      }>();
      // kinds, order and limit follow the memory index through the same filterRecords
      return filterRecords(
        results.map((r) => JSON.parse(r.json) as AnyRecord),
        f,
      );
    },
    async setDefinitions(files, m) {
      await init();
      const ins = [...files].map(([path, text]) =>
        q('INSERT INTO definitions (path, text) VALUES (?, ?)', path, text),
      );
      const stmts = [
        q('DELETE FROM definitions'),
        ...ins,
        q(META, 'definitions.source', m.source),
        q(META, 'definitions.at', m.at),
      ];
      await batch(stmts.map((x) => [x]));
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

/** Identity from Cf-Access-Jwt-Assertion verified against https://<team>.cloudflareaccess.com/cdn-cgi/access/certs and aud. */
export function accessIdentity(opts: { team: string; aud: string }): IdentityProvider {
  const issuer = `https://${opts.team}.cloudflareaccess.com`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  return {
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
