/** Test fakes: an R2 binding (in memory), a D1 binding (node:sqlite) and the Cloudflare API's Access policies. */
import { DatabaseSync } from 'node:sqlite';

export function fakeR2(opts: { honorStartAfter?: boolean } = {}) {
  const objects = new Map<string, { data: Uint8Array; etag: string }>();
  let v = 0;
  const meta = (key: string) => {
    const o = objects.get(key)!;
    return { key, size: o.data.byteLength, etag: o.etag, httpEtag: `"${o.etag}"` };
  };
  return {
    objects,
    async get(key: string) {
      const o = objects.get(key);
      return o ? { ...meta(key), arrayBuffer: async () => o.data.slice().buffer } : null;
    },
    async head(key: string) {
      return objects.has(key) ? meta(key) : null;
    },
    async put(key: string, value: Uint8Array, o?: { onlyIf?: Headers }) {
      if (o?.onlyIf?.get('If-None-Match') === '*' && objects.has(key)) return null;
      objects.set(key, { data: value.slice(), etag: String(++v) });
      return meta(key);
    },
    async list(o: { prefix?: string; cursor?: string; limit?: number; startAfter?: string }) {
      const all = [...objects.keys()].filter((k) => k.startsWith(o.prefix ?? '')).sort();
      let from = o.cursor ? Number(o.cursor) : 0;
      if (!o.cursor && o.startAfter && opts.honorStartAfter)
        from = all.filter((k) => k <= o.startAfter!).length;
      const limit = Math.min(o.limit ?? 1000, 2); // small pages exercise the cursor handling
      const page = all.slice(from, from + limit);
      const truncated = from + limit < all.length;
      return { objects: page.map(meta), truncated, ...(truncated ? { cursor: String(from + limit) } : {}) };
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
}

/** The parts of D1 we use (prepare/bind/all/first/run/batch), imitated with node:sqlite. */
export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  let queue: Promise<unknown> = Promise.resolve();
  interface Stmt {
    bind(...a: unknown[]): Stmt;
    all(): Promise<{ results: unknown[] }>;
    first(): Promise<unknown>;
    run(): Promise<{ meta: { changes: number } }>;
  }
  const stmt = (sql: string, args: unknown[] = []): Stmt => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(args as never[])).changes) } }),
  });
  return {
    db,
    prepare: (sql: string) => stmt(sql),
    // D1 runs one batch at a time
    batch(stmts: { run(): Promise<{ meta: { changes: number } }> }[]) {
      const run = queue.then(() => this.batchNow(stmts));
      queue = run.catch(() => undefined);
      return run;
    },
    async batchNow(stmts: { run(): Promise<{ meta: { changes: number } }> }[]) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

/**
 * The Cloudflare API's reusable Access policy `acc/pol` (docs/spec/security.md#customer-uat): `fetch` answers GET and
 * PUT of it for the token `cf-token` (anything else: undefined, so a test can route other URLs); `requests` logs calls;
 * the first `lostPuts` PUTs are lost, as if a concurrent PUT had overwritten them.
 */
export function fakeAccessApi(base = 'https://api.cloudflare.com/client/v4', o = { lostPuts: 0 }) {
  let policy: Record<string, unknown> = {
    ...{ id: 'pol', name: 'UAT customers', decision: 'allow', session_duration: '24h', created_at: 'x' },
    ...{ approval_required: true, purpose_justification_required: true, app_count: 1, reusable: true },
    ...{ include: [{ email: { email: 'placeholder@shop.test' } }], exclude: [], require: [] },
  };
  const requests: { method: string; body?: Record<string, unknown> }[] = [];
  const emails = () =>
    (policy.include as { email?: { email: string } }[]).flatMap((r) => r.email?.email ?? []);
  const fetch = async (url: string | URL, init: RequestInit = {}): Promise<Response | undefined> => {
    if (String(url) !== `${base}/accounts/acc/access/policies/pol`) return undefined;
    const method = init.method ?? 'GET';
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    requests.push({ method, body });
    if (new Headers(init.headers).get('authorization') !== 'Bearer cf-token')
      return Response.json({ success: false, errors: [{ message: 'auth' }] }, { status: 403 });
    // a lost PUT stands for a concurrent writer's PUT that overwrote ours
    if (method === 'PUT' && o.lostPuts-- <= 0) policy = { ...body, id: 'pol', app_count: 1, reusable: true };
    return Response.json({ success: true, result: policy });
  };
  return { fetch, requests, emails };
}
