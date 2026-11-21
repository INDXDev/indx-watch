-- Index schema (plain SQL, shared by the D1 index and the node:sqlite index, src/node/sqlite-index.ts).
-- Mirrored in src/workers/index-schema.ts (a test keeps them equal). The index is a cache: rebuild with `iw reindex`.
CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, at TEXT NOT NULL, test_case_id TEXT, release TEXT, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS records_at ON records (at, id);
CREATE INDEX IF NOT EXISTS records_test_case ON records (test_case_id);
-- The log key each record body was read from (docs/spec/sync.md#merge-rules); its own table, so older indexes need no migration.
CREATE TABLE IF NOT EXISTS record_keys (id TEXT PRIMARY KEY, log_key TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS definitions (path TEXT PRIMARY KEY, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
