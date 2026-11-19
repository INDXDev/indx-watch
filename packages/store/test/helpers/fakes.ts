/** テスト用の偽物: R2 バインディング（メモリ）と D1 バインディング（node:sqlite）。 */
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
      const limit = Math.min(o.limit ?? 1000, 2); // 小さなページでカーソル処理を確かめる
      const page = all.slice(from, from + limit);
      const truncated = from + limit < all.length;
      return { objects: page.map(meta), truncated, ...(truncated ? { cursor: String(from + limit) } : {}) };
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
}

/** D1 の使う部分（prepare/bind/all/first/run/batch）を node:sqlite で真似る。 */
export function fakeD1() {
  const db = new DatabaseSync(':memory:');
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
    async batch(stmts: { run(): Promise<{ meta: { changes: number } }> }[]) {
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
