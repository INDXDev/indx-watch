# 0003. The result store protocol needs only object storage

- Status: accepted
- Date: 2026-11-19

## Context

Results must sync continuously between laptops, CI and a hosted UI, with no server required (a bucket is enough), and must work on AWS S3, Cloudflare R2, MinIO and GCS interop. Prior art: git-lfs and DVC (content-addressed blobs with pointer files), git-annex, CRDT libraries such as Automerge, and Litestream (WAL shipping). S3 has strong read-after-write consistency and supports conditional writes (`If-None-Match`) on major providers ([platform notes](../research/platform-notes.md#s3-and-conditional-writes)).

## Decision

The store is an **append-only log of immutable JSON records plus content-addressed blobs** ([sync.md](../spec/sync.md)):

- Log objects are keyed by a ULID generated at upload time; readers list with `StartAfter` and a 15-minute lookback window, plus a periodic full listing.
- Blobs are keyed by SHA-256, like git-lfs and DVC.
- The merge rule is set union by record ID. State that changes over time (verdicts, waivers) is expressed as new records interpreted by pure functions.
- Workspace-mode files use a version graph with a field-level three-way merge, and conflict files when that fails.

## Consequences

- Any S3-compatible bucket or folder is a complete sync backend; no coordinator, no locking.
- Readers do O(new objects) work per sync; a full listing is O(log objects) and runs daily.
- A writer with a clock wrong by more than the window is caught by the daily full listing.
- Compaction (snapshots) is needed for very large logs; designed for v0.2.

## Alternatives considered

- **CRDT library (Automerge/Yjs)** — powerful for concurrent text editing, unnecessary for immutable results, heavy dependency.
- **Per-writer prefixes with exact cursors** — exact, but listing writer prefixes grows with every CI job.
- **A central API server** — simplest consistency but violates "a bucket is enough".
- **SQLite replication (Litestream/LiteFS)** — single-writer, ties the format to SQLite.
