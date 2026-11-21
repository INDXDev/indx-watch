# Sync and the result store

Definitions sync through git. Results — runs, judgements, waivers, deployments, bundle snapshots and their blobs — sync through a **result store**: a folder or any S3-compatible bucket, optionally fronted by a hosted INDX Watch server. This page specifies the store layout, the record format, the merge rules and `iw sync`. Why it is split this way: [ADR 0002](../adr/0002-two-sync-channels.md), [ADR 0003](../adr/0003-storage-only-store-protocol.md). Prior art and S3 facts: [platform notes](../research/platform-notes.md#s3-and-conditional-writes).

## Pieces

```mermaid
flowchart LR
  subgraph clone["A clone (laptop or CI)"]
    B[".indx-watch/ bundle (git)"]
    L[".indx-watch/runs/ local replica"]
    W["writers: iw record, iw serve, Playwright reporter"]
    W --> L
  end
  L <-- "iw sync" --> S[("Result store: file://, s3://, https://")]
  S <-- "iw sync" --> L2["another clone's replica"]
  S --> H["Hosted server (index + UI)"]
  H -- "writes runs from the browser" --> S
```

- Every writer appends records to the **local replica** first (`.indx-watch/runs/`). Writing never needs the network.
- `iw sync` pushes local records and blobs the store does not have, and pulls records the replica does not have.
- The hosted server is a client like any other; its UI writes go straight to its store.

## Local replica layout

```text
.indx-watch/runs/
├── records/2026-11/run_01JF7Z3K0W8N2Q4R6S8T0V2X4Y.json   # one file per record, by record ID, grouped by the month of the ID's ULID time
└── blobs/sha256/87/8760bc67a01b22044c4098fddeb3a749cd395c4757fab3740aa626cd0da51e1b
```

Sync bookkeeping lives in `.indx-watch/cache/sync/<store-hash>.json` and `.indx-watch/cache/writer-id`. Deleting `cache/` is always safe.

## Store layout

Any `ObjectStore` (fs, S3, R2 binding, HTTP) exposes the same keys under the store URL's prefix:

```text
<prefix>/
├── indx-watch-store.json               # {"format":"indx-watch-store","version":1,"project":"prj_…"}
├── v1/log/01JF7Z9A2B4C6D8E0F2G4H6J8K.json   # log objects: one per upload, key = upload ULID
├── v1/blobs/sha256/87/8760bc67…1e1b     # content-addressed blobs
└── v1/snapshots/01JF8A1B2C3D4E5F6G7H8J9K0M.json   # log snapshots (compaction): key = upload ULID
```

| Object | Rule |
|---|---|
| `indx-watch-store.json` | Created by the first writer with a conditional create. A store bound to another project ID is refused (exit 4). |
| Log object | Key = a ULID generated **at upload time**. Body = `{"v":1,"writer":"<writer-id>","records":[…]}`, at most 1,000 records or 5 MB. Never overwritten. |
| Blob | Key = SHA-256 of the content. Written only if absent. Verified on read. |
| Log snapshot | *(v0.2)* Key = a ULID generated at upload time. A copy of log objects for fresh clones ([log snapshots](#log-snapshots-v02)). Never overwritten; the log stays the source of truth. |

Writes use `If-None-Match: *` (on GCS: `x-goog-if-generation-match: 0`), so nothing is ever overwritten; ULID keys and content hashes make collisions practically impossible anyway. Store URLs:

| URL | Adapter | Credentials |
|---|---|---|
| `file:///abs/path` or `file://../rel` (relative to the bundle) | `fs` | file system permissions |
| `s3://bucket/prefix` + `[store].endpoint`/`region` | `s3` (S3, R2, MinIO, GCS interop) | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`; with `AWS_PROFILE` (incl. SSO), credentials come from `aws configure export-credentials --format process` |
| `https://watch.example.com` | `http` → the hosted server's [store endpoints](#store-http-endpoints) | `IW_ACCESS_TOKEN`, or `cloudflared access token -app=<url>`, sent as `cf-access-token`; in CI an Access service token (`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`) |
| (Workers only) | `r2` binding | Worker binding |

### Store HTTP endpoints

A hosted server exposes the same layout over HTTP (behind Cloudflare Access): `GET`/`HEAD /api/store/objects/<key>` (404 when absent), `PUT /api/store/objects/<key>` (201; always create-only: 412 when the key exists, with or without `If-None-Match`; 400 for keys outside the layout, invalid manifests or log objects, records of another project, and blobs whose content does not match their key), `GET /api/store/list?prefix=&startAfter=&limit=` → `{ "keys": [{ "key", "size", "etag"? }], "truncated" }`. Types: [`packages/server/src/contract.ts`](../../packages/server/src/contract.ts).

## Records

Every record is a JSON object that starts with `kind` and `id`, followed by the envelope. The Zod schemas in [`packages/bundle/src/schema/records.ts`](../../packages/bundle/src/schema/records.ts) are the field-level reference and are published as `schemas/v1/record.json`.

| Field | |
|---|---|
| `kind` | `run`, `judgement`, `waiver`, `deployment`, `bundle`, `retraction` (`file` is reserved for workspace mode) |
| `id` | `{prefix}_{ULID}`, generated at creation (offline) |
| `v` | `1` |
| `project` | project machine ID |
| `at` | creation time (RFC 3339) |
| `actor`, `source` | [security.md](security.md#identity) |
| `sig` | optional, *v0.2*: the writer's signature ([signed records](#signed-records)) |

**Canonical record JSON.** Writers validate a record with its strict schema and store `JSON.stringify` of the parsed result (keys in schema order, defaults materialized, no whitespace). Those exact bytes go into the replica, log objects and archives. Readers accept unknown extra fields (from newer tools) and keep the bytes they received; two records with the same ID are compared by these bytes.

### Signed records

*(v0.2)* A writer with `IW_SIGNING_KEY` adds `sig = { "alg": "Ed25519", "kid", "value" }` to every record it writes: an Ed25519 signature (base64url) over `indx-watch/record/v1\n` + the canonical record JSON without `sig`. Readers recompute those bytes from the record they decoded, so a reader whose schema lacks a field a newer writer signed sees the record as unverified until it is upgraded. Signing never changes merge rules: a signed and an unsigned body with the same ID are two different bodies. Which keys are trusted, and what "unverified" means for the UI, reports and the gate: [security.md](security.md#signed-records).

### Run record

```json
{
  "v": 1, "kind": "run", "id": "run_01JF7Z3K0W8N2Q4R6S8T0V2X4Y", "project": "prj_01JF3Q8M5X2V7K9D4R6T1W0Y00",
  "at": "2026-11-19T04:13:40Z",
  "actor": { "kind": "ci", "id": "github:octocat", "name": "octocat", "via": "github" },
  "source": "playwright",
  "test_case": { "id": "tc_01JF3Q8M5X2V7K9D4R6T1W0Y33", "key": "TC-3", "version": "tcv:3f9a1c2b7e10" },
  "fixtures": [ { "id": "fx_01JF3Q8M5X2V7K9D4R6T1W0Y41", "key": "FX-1", "version": "fxv:91be03d2a4c8", "rows": ["SUMMER10"] } ],
  "release": "v1.2.0", "environment": "staging",
  "build": { "commit": "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", "ref": "refs/heads/main", "dirty": false },
  "ci": { "provider": "github", "url": "https://github.com/INDXDev/indx-watch/actions/runs/1/attempts/1", "run_id": "1", "run_attempt": 1, "job": "e2e", "pr": 12 },
  "started_at": "2026-11-19T04:13:31Z", "ended_at": "2026-11-19T04:13:40Z",
  "reported": null,
  "locale": "en",
  "steps": [ { "index": 1, "status": "pass", "note": "", "evidence": ["8760bc67…"] } ],
  "evidence": [ { "sha256": "8760bc67…", "name": "step-1.png", "media_type": "image/png", "size": 8295, "kind": "screenshot", "step": 1 } ],
  "judgements": [ { "id": "jdg_01JF7Z…", "kind": "assert", "verdict": "pass", "confidence": 1, "reason": "", "test": "coupon.spec.ts › valid coupon reduces the total" } ],
  "automation": { "framework": "playwright", "project": "chromium", "group": "github:1:1" }
}
```

- `reported`: what the executor reported for the whole run (`blocked`, `skipped`, or `null`). Only used by decision-policy rule 2.
- The verdict is **not stored**; it is computed ([concepts](concepts.md#decision-policy)).

### Other records

| Kind | Fields (besides the envelope) | Meaning |
|---|---|---|
| `judgement` | `run` (run ID), `judgement` (as in the run: `id`, `kind`, `verdict`, `confidence`, `diff_ratio`, `reason`, `test`, `flaky`, `by`, `at`, and from v0.2 `locale`) | A later judgement, e.g. a human review. |
| `waiver` | `release`, `test_case` (ID + key), `reason`, `version` (test case version it applies to), `run`, `revokes` (waiver ID) | Accept a known failure of that version; a later waiver with `revokes` cancels one. |
| `deployment` | `environment`, `build`, `release`, `url` | A build was deployed to an environment (`iw deployment add`). |
| `bundle` | `commit`, `commit_time`, `ref`, `sha256` (blob: `.tar` of the definition files), `definitions_hash` (SHA-256 over the sorted lines `<path> <sha256>\n` of every definition file — excluding `cache/`, `runs/` and dot-files — to skip unchanged snapshots), `files` (count), `dirty` and `message` (*v0.2*, [snapshots from people](#snapshots-from-people-v02)) | A snapshot of definitions for hosted viewers in git mode. |
| `retraction` | `target` (record ID), `reason` | Hides a record recorded by mistake; nothing is deleted. |
| `file` | reserved | Workspace mode (v0.2). |

## Merge rules

| Data | Rule |
|---|---|
| Records | Set union by `id`. Records are immutable. Two different bodies with the same ID: keep the one signed by a pinned key, otherwise the one whose log key sorts first, and report a warning (see below). |
| Verdict changes | Never edit; append a `judgement` record. Verdict = decision policy over all judgements of the run. |
| Waivers | Latest non-revoked waiver per (release, test case) by `at`, ties broken by `id`. |
| Bundle snapshots | Latest by `commit_time`, then `at`, per `ref`, so an outdated checkout cannot roll the hosted view back. |
| Retractions | A retracted record is ignored by the model; push never uploads a retracted record again. |
| Blobs | Content-addressed; identical by definition. |

**Two bodies with one record ID.** Normal writers never produce this; it means a forged or corrupted upload. So that every replica and index ends with the same body, each one remembers, per record ID, the earliest log key under which it read the body it holds: the sync state (`keys` in `cache/sync/<store>.json`) for a clone, the `record_keys` table for an index. A record written locally and not yet pushed, or held before keys were remembered, has no key and sorts last. When a log object brings another body for a held ID:

- exactly one of the two bodies carries a valid signature by a key pinned in `project.toml` [[signing_keys]] (on the hosted app: the keys `iw deploy` pinned, see [signed records](security.md#signed-records)): that body wins, whatever the log keys, so a forged unsigned body can never replace a signed one;
- otherwise, its key sorts first: the held copy is replaced (`LocalReplica.replaceRecord`, which only sync calls; a guarded `UPDATE` in the D1 index), and the key is remembered;
- otherwise the held copy stays.

Both cases produce the warning `record <id> in <log key> differs from the local copy; replaced the local copy (signed, or its log key sorts first)` (or `…; kept the local copy`; `indexed copy` in an index). Sync returns it in `warnings` and keeps it in the sync state (`conflicts`); `iw check` reports it as a `record-conflict` warning, and the web app shows it in the problems banner (a hosted server keeps it in the index meta `record.conflicts`). Because a full listing reads log objects in key order, a clone that lost `cache/` meets the earliest key first and converges again on the next sync. An index whose rows predate remembered keys converges once it is rebuilt from the store. The D1 index writes each decision as statements guarded by the state it read (the held body and key), so two ingests running at once cannot overwrite each other: a guarded write that changes nothing is decided again. Because the uploader picks the log key, `PUT /api/store/objects/v1/log/…` refuses a key whose time is more than an hour from the server clock; a direct bucket writer can still pick any key, which is why signed bodies win regardless of keys.

Because every operation is a union of immutable items, sync is idempotent, order-independent and safe to interrupt at any point.

## `iw sync` algorithm

**Push**

1. Run the secret scan; refuse if it reports errors.
2. Collect local records not in the pushed set (`cache/sync/<store>.json`). Records that fail the secret scan are held back with a warning (`held` in the result). This step is part of the sync engine, so the background sync of `iw serve` and the Playwright reporter's push hold them back too.
3. Upload every blob they reference that the store does not have (`HEAD`, then conditional `PUT`), plus the blobs of fixture pointer files in the bundle.
4. Upload records in log objects of ≤ 1,000 records, keyed by a fresh ULID, *after* their blobs.
5. Add their IDs to the pushed set.
6. With `--snapshot` (the GitHub Action passes it on the default branch): if the definitions hash differs from the last pushed snapshot and the working tree is clean, upload the bundle tarball and a `bundle` record. Plain local `iw sync` never publishes snapshots.

**Pull**

1. List `v1/log/` with `StartAfter` = the ULID of (cursor time − 15 minutes) — the **lookback window** that absorbs clock skew and slow uploads between writers.
2. Fetch log objects not yet seen (tracked by key for the lookback window), write their records into the local replica if absent (another body for a held ID follows the [merge rules](#merge-rules)), mark them as pushed. Unreadable log objects (corrupt, or from a newer format) are skipped with a warning and remembered as seen; unknown top-level fields are accepted. Records of another project are ignored with a warning.
3. Advance the cursor to min(greatest key seen, ULID of the reader's current time), so one writer with a clock running ahead cannot push every reader's cursor into the future. When no key has been seen, the cursor stays unset.
4. Every 24 hours (or with `--full`, or when `cache/` was deleted), list the whole log once to catch writers whose clocks were wrong by more than the window and to rebuild the pushed set. Unless `--full` was given, this full listing first reads the newest [log snapshot](#log-snapshots-v02), so it only fetches the log objects the snapshot does not hold.
5. Blobs are fetched per `[store].evidence`: `on-demand` (when a page, report or command needs them — read-through from `iw serve`), `all`, or `none`.

**Watch** (`iw sync --watch`): push within ~300 ms of a local write (file watcher on `runs/records/`), poll the store every 3 s (`--interval`). With the `http` adapter, the server can answer list requests by long-polling (v0.2).

```mermaid
sequenceDiagram
  participant A as Clone A (reporter)
  participant S as Result store (S3)
  participant B as Clone B (iw sync --watch)
  A->>A: write run records + blobs to runs/
  A->>S: PUT v1/blobs/sha256/… (If-None-Match: *)
  A->>S: PUT v1/log/<upload ULID>.json
  loop every 3 s
    B->>S: LIST v1/log/ StartAfter=<cursor − 15 min>
    S-->>B: new keys
    B->>S: GET v1/log/<key>.json
    B->>B: add records to runs/, refresh index
  end
```

### Log snapshots *(v0.2)*

A full listing fetches every log object, so a fresh clone of a store with 100,000 records would make thousands of `GET`s. A **log snapshot** is one object holding a copy of many log objects, so that clone reads one object and then only the log objects written since. (Not to be confused with the bundle snapshots above, which hold definitions.)

```json
{ "v": 1, "format": "indx-watch-log-snapshot", "project": "prj_…", "upto": "v1/log/01JF7Z9A2B4C6D8E0F2G4H6J8K.json",
  "logs": [ { "key": "v1/log/01JF7Z0…json", "records": [ … ] }, … ] }
```

- `logs`: log objects in ascending key order, each with its own key and its records as read (the canonical record JSON, `sig` included). Keeping the log key of every record means a clone applies them exactly as if it had read those log objects in key order, so the [merge rules](#merge-rules) (remembered keys, two bodies with one ID, signed bodies win) converge to the same result. `upto` is the greatest key it holds.
- **Who writes it:** `iw compact` ([cli.md](cli.md#iw-compact)), run by hand or on a schedule by anyone with direct write access to the store (`file://` or `s3://`). It reads the newest valid snapshot, adds every log object from the log listing that it lacks and whose key is older than the lookback window (now − 15 minutes), and uploads a new snapshot under a fresh ULID with a create-only write. Log objects that cannot be read, or that hold invalid records, are left out, so clones read them from the log and warn as before. When nothing is new it writes nothing. The hosted server's `/api/store` refuses writes under `v1/snapshots/` (as any key outside the layout), so a holder of an Access token alone cannot add one.
- **How a clone uses it:** a full listing ([pull step 4](#iw-sync-algorithm), and every fresh clone) reads the newest snapshot whose key is not in the reader's future, merges its records log object by log object, marks those log keys as read, then lists the whole log and fetches only the keys the snapshot does not hold. The cursor then advances as usual. A clone remembers the snapshot it applied (`logSnapshot` in the sync state) and on the next daily full listing only marks its keys as read.
- **Safety:** snapshots are additive and immutable; the log is never deleted or rewritten, and removing every snapshot only makes full listings slower. A snapshot that is not valid JSON, has another `format`, a newer `v`, another project, keys out of order or above `upto`, or an invalid record is ignored with a warning (`…; reading the whole log instead`), and the clone reads the whole log. `iw sync --full` ignores snapshots and reads every log object. Old snapshots may be deleted by hand or by a bucket lifecycle rule; readers only read the newest.

### Snapshots from people *(v0.2)*

Besides CI (`iw sync --snapshot` on the default branch), a person can publish a snapshot with `iw push` or by uploading files in the hosted web app ([web.md](web.md#upload)). These `bundle` records carry `dirty: true` when the working tree had uncommitted changes, an optional `message`, and `commit_time` set to the upload time when there is no clean commit, so the newest upload wins under the "by `commit_time`, then `at`" order the hosted server uses. A browser upload has `source = "manual"` and no `commit`.

## Workspace mode (v0.2)

For teams without git, definitions will also sync through the store, Drive-style ([roadmap T-209](../roadmap.md#v02--agents-and-sharing)). Design notes for that work: versions are keyed by `file` record IDs (not content hashes, so reverts do not create cycles); entities are tracked by the `id` inside each file, not by path; concurrent edits get a field-level three-way merge against the common base, and unresolvable fields produce `<name>.conflict-<sha8>.toml` files that make `iw check` fail until resolved. v0.1 tools reject `[store] mode = "workspace"`.

## The hosted server and the index

The hosted server keeps an index (D1 on Cloudflare) of records and the current definitions; on Node, `iw reindex` builds the same index in `cache/index.sqlite`. The hosted server ingests:

- its own writes, immediately;
- uploads through `/api/store/*`, on receipt;
- writes made directly to the bucket (e.g. CI using S3 credentials), by running the pull algorithm against its own store at most every 5 s on read requests and from a scheduled trigger. Each ingest handles at most 50 log objects, saves its cursor in the index, and holds a lease row so only one runs at a time; a fresh deploy on a large bucket catches up over several invocations. Like a clone, it lists the whole log once a day (step 4), resuming across invocations within the same 50-object budget, so another body under an older key converges in the index as in clones.

Records written by the hosted server itself carry an Access-verified actor and, when the Worker has `IW_SIGNING_KEY`, a signature. Records written directly to the bucket are ingested as written; those claiming a verified `via` without a valid signature by a key the deploy pinned (`SIGNING_KEYS`) are shown as unverified ([signed records](security.md#signed-records), [threat model](security.md#threat-model)).

`iw reindex` (or deleting the index) rebuilds it from the store; nothing is lost.

## Acceptance criteria

- [x] Two clones configured with the same `file://` or MinIO store: a run recorded in clone A appears in clone B's `iw status` within 5 s while B runs `iw sync --watch`.
- [x] Sync is idempotent: running `iw sync` twice in a row transfers nothing the second time.
- [x] A record uploaded with a key 10 minutes older than the reader's cursor is still pulled (lookback test with a fake clock).
- [x] Interrupting a push after blobs but before the log object, then re-running, leaves no record without its blobs.
- [x] A store whose `indx-watch-store.json` names another project is refused with exit code 4.
- [x] A reader whose store contains a log key 1 day in the future still pulls records written afterwards by correctly clocked writers.
- [x] `iw sync` without `--snapshot` never writes a `bundle` record.
- [x] Two clones holding a record, after a different body for its ID is uploaded under an earlier log key, both hold that body after their next sync and report a warning; a fresh clone, and the memory and D1 indexes, keep it too.
- [x] A body signed by a pinned key is never replaced by an unsigned body under an earlier key, in clones and indexes; one that arrives later replaces an unsigned body.
- [x] Two concurrent D1 ingests of different bodies for one ID end with the body under the earliest key and a conflict note.
- [x] The hosted catch-up's daily full listing ingests another body written straight to the bucket under a key older than its lookback window.
- [x] `PUT /api/store/objects/v1/log/<key>` refuses a key more than an hour from the server clock.
- [x] A fresh clone pulls 100,000 records from a log snapshot in under 10 s, holds the same records as one that read the whole log, and a corrupt snapshot falls back to the log with a warning.
- [x] The adapter contract test suite passes for `memory`, `fs`, `http`, and `s3` (against MinIO when available, otherwise an S3-compatible fake).
