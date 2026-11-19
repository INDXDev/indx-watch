/** src/index-schema.sql と同じ文（Workers ではファイルを読めないため。テストで一致を確かめる）。 */
export const INDEX_SCHEMA: string[] = [
  'CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, at TEXT NOT NULL, test_case_id TEXT, release TEXT, json TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS records_at ON records (at, id)',
  'CREATE INDEX IF NOT EXISTS records_test_case ON records (test_case_id)',
  'CREATE TABLE IF NOT EXISTS definitions (path TEXT PRIMARY KEY, text TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
];
