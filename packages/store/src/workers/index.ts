/**
 * Workers-side factories. CONTRACT: signatures frozen.
 * Binding types are declared here for the parts we use, to avoid another dependency.
 */
import type { AnyRecord } from '@indx-watch/bundle';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { filterRecords, recordRelease, recordTestCase } from '../adapters/memory.js';
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
  // One batch is one transaction. One statement per row, 100 per batch, to stay under the bind limit
  const batch = async (stmts: D1Stmt[]) => {
    let changes = 0;
    for (let i = 0; i < stmts.length; i += 100) {
      for (const r of await d.batch(stmts.slice(i, i + 100))) changes += r.meta?.changes ?? 0;
    }
    return changes;
  };
  const META =
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value';
  const RECORD =
    'INSERT OR IGNORE INTO records (id, kind, at, test_case_id, release, json) VALUES (?, ?, ?, ?, ?, ?)';
  const row = (r: AnyRecord) => [
    r.id,
    r.kind,
    r.at,
    recordTestCase(r) ?? null,
    recordRelease(r) ?? null,
    JSON.stringify(r),
  ];

  return {
    async ingest(records) {
      await init();
      return batch(records.map((r) => q(RECORD, ...row(r))));
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
      await batch([
        q('DELETE FROM definitions'),
        ...ins,
        q(META, 'definitions.source', m.source),
        q(META, 'definitions.at', m.at),
      ]);
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
      await batch(['records', 'definitions', 'meta'].map((t) => q(`DELETE FROM ${t}`)));
    },
  };
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
