# 0007. One Hono server for Node and Cloudflare Workers; the index is SQLite-shaped

- Status: accepted
- Date: 2026-11-19

## Context

`iw serve` must work offline on a laptop; `iw deploy` must give a shared instance on Cloudflare. Two server codebases would drift.

## Decision

- `packages/server` exports `createApp(deps)`, a Hono app that depends only on the `AppDeps` in [`contract.ts`](../../packages/server/src/contract.ts) (model loader, record and blob writers, `IdentityProvider`, optional `ObjectStore`). `node.ts` wires Node adapters (fs/S3 store, SQLite or memory index, git identity) and serves the built SPA; `worker.ts` wires R2, D1 and Cloudflare Access and serves the SPA through Workers static assets.
- The index schema is one plain SQL file used with D1 on Workers; Node used an in-memory index in v0.1 and uses `node:sqlite` with the same SQL since v0.2 (see Notes). The brief suggested Drizzle, but the stable Drizzle release has no `node:sqlite` driver and three JSON-row tables do not need an ORM ([platform notes](../research/platform-notes.md#libraries-and-versions)); revisit when Drizzle 1.0 ships. The index stores records and definitions as JSON rows plus a few indexed columns; domain logic runs in `packages/core` over an in-memory model, so the index stays tiny.
- Node ≥ 22.13. TypeScript 5.9, Vitest 4 (required by the Workers Vitest pool) and Biome 2 are pinned for stability ([platform notes](../research/platform-notes.md#libraries-and-versions)).

## Consequences

- The deployed server is the same code as `iw serve` (verified by running the same API tests against both entry points in v0.2).
- Domain queries are computed in memory: fine for thousands of test cases and hundreds of thousands of records; beyond that, push filters into the index.

## Alternatives considered

- **Next.js on Workers** (the previous design) — larger, framework-coupled, harder to run as a CLI-embedded server.
- **Separate Node and Workers servers** — drift.

## Notes

- 2026-11-21 (T-210): Node has a `node:sqlite` index. `sqliteIndex(path)` runs the D1 index (`d1Index`) over a small D1-shaped wrapper of `DatabaseSync`, so the schema (`packages/store/src/index-schema.sql`, mirrored in `src/workers/index-schema.ts`) and the guarded merge writes are the D1 ones, statement for statement. There is no size threshold or flag: `openNodeIndex(bundleDir)` always opens `<bundleDir>/cache/index.sqlite` (safe to delete), and `{ memory: true }` gives the in-memory index (tests). `iw reindex` builds it. `iw serve` still builds its model from the local replica and does not read the index yet; reading records from the index on start is the follow-up for very large replicas ([roadmap](../roadmap.md) T-217). The file keeps a schema version derived from `INDEX_SCHEMA` in `PRAGMA user_version`; a file written with another schema is emptied on open, so a CLI upgrade that changes the schema never leaves stale tables behind and `iw reindex` rebuilds it. `node:sqlite` is loaded on first use with a dynamic import that drops only its Node 22 `ExperimentalWarning`; the bundled CLI keeps the `node:` prefix (`removeNodeProtocol: false`), because `sqlite` has no unprefixed name.
- 2026-11-21 (T-217): `iw serve` reads its records through the `node:sqlite` index, always (no threshold or flag, as for `iw reindex`: one code path, and the cost on a small replica is a directory listing). Like the Worker, which ingests new log objects into D1 and builds its model from `index.records()`, the Node server ingests only replica files whose record the index does not hold and builds its model from the index; the index meta `replica.files` maps each indexed file's key to its record ID and modification time, so a file the index holds that is gone, or whose modification time differs (no comparison with the clock, so coarse or remote file times cannot hide a rewrite), empties the index and rebuilds it once; keying by file, not by record ID, means a misnamed or duplicate file never forces a rebuild. Records are returned in the replica's key order, so API results are identical to reading every file. If the index cannot be opened or a read through it fails, the server reads the replica directly. `iw reindex` writes the same meta, so the next `iw serve` reuses its work. A start still costs O(n) in the number of record files: one `stat` per file (run concurrently) and parsing every JSON row from SQLite; what it skips is reading and validating each record file.
