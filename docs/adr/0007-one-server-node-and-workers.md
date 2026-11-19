# 0007. One Hono server for Node and Cloudflare Workers; the index is SQLite-shaped

- Status: accepted
- Date: 2026-11-19

## Context

`iw serve` must work offline on a laptop; `iw deploy` must give a shared instance on Cloudflare. Two server codebases would drift.

## Decision

- `packages/server` exports `createApp(deps)`, a Hono app that depends only on the `AppDeps` in [`contract.ts`](../../packages/server/src/contract.ts) (model loader, record and blob writers, `IdentityProvider`, optional `ObjectStore`). `node.ts` wires Node adapters (fs/S3 store, SQLite or memory index, git identity) and serves the built SPA; `worker.ts` wires R2, D1 and Cloudflare Access and serves the SPA through Workers static assets.
- The index schema is one plain SQL file used with D1 on Workers; Node uses an in-memory index in v0.1 (`node:sqlite` with the same SQL later). The brief suggested Drizzle, but the stable Drizzle release has no `node:sqlite` driver and three JSON-row tables do not need an ORM ([platform notes](../research/platform-notes.md#libraries-and-versions)); revisit when Drizzle 1.0 ships. The index stores records and definitions as JSON rows plus a few indexed columns; domain logic runs in `packages/core` over an in-memory model, so the index stays tiny.
- Node ≥ 22.13. TypeScript 5.9, Vitest 4 (required by the Workers Vitest pool) and Biome 2 are pinned for stability ([platform notes](../research/platform-notes.md#libraries-and-versions)).

## Consequences

- The deployed server is the same code as `iw serve` (verified by running the same API tests against both entry points in v0.2).
- Domain queries are computed in memory: fine for thousands of test cases and hundreds of thousands of records; beyond that, push filters into the index.

## Alternatives considered

- **Next.js on Workers** (the previous design) — larger, framework-coupled, harder to run as a CLI-embedded server.
- **Separate Node and Workers servers** — drift.
