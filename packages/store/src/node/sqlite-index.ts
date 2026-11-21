/**
 * Index in a node:sqlite file (roadmap T-210). It runs the D1 index over a small D1-shaped wrapper of DatabaseSync,
 * so the schema (src/index-schema.sql) and the guarded merge writes are the D1 ones, statement for statement.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { Index } from '../ports.js';
import { d1Index } from '../workers/index.js';

type Args = (string | number | null)[];

/** Runs `load` without the "SQLite is an experimental feature" ExperimentalWarning that Node 22 prints on first load. */
export async function withoutSqliteWarning<T>(load: () => Promise<T>): Promise<T> {
  const emit = process.emitWarning;
  process.emitWarning = ((w: string | Error, ...rest: never[]) => {
    if (!/SQLite/.test(typeof w === 'string' ? w : w.message)) emit.call(process, w, ...rest);
  }) as typeof emit;
  try {
    return await load();
  } finally {
    process.emitWarning = emit;
  }
}

/** The parts of a D1 binding that d1Index uses, over DatabaseSync. A batch is one transaction, as on D1. */
export function sqliteD1(db: DatabaseSync) {
  const stmt = (sql: string, args: Args = []) => ({
    bind: (...a: Args) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => stmt(sql, args).runNow(),
    runNow: () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  });
  return {
    prepare: (sql: string) => stmt(sql),
    // synchronous, so batches never interleave; ingests still may between their read and their batch (hence guarded writes)
    async batch(stmts: ReturnType<typeof stmt>[]) {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => s.runNow());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

/** Index in a SQLite database file (or ':memory:'); the schema is created on first use. */
export async function sqliteIndex(path: string): Promise<Index> {
  const { DatabaseSync } = await withoutSqliteWarning(() => import('node:sqlite'));
  return d1Index(sqliteD1(new DatabaseSync(path)));
}
