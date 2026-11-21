/** The steps of `syncOnce` (docs/spec/sync.md): a shared context, the pull phase and the push phase. */
import {
  type AnyRecord,
  AnyRecord as AnyRecordSchema,
  type BundleRecord,
  newId,
  scanSecrets,
  verifyRecord,
} from '@indx-watch/bundle';
import type { StoreError } from '@indx-watch/store';
import { blobRefs, conflictMessage, LOG_PREFIX, mergeStep, ulidTime } from '@indx-watch/store';
import type { SyncOptions, SyncResult } from './index.js';
import { snapshotBundle } from './snapshot.js';

const DAY = 24 * 60 * 60 * 1000;
const LOOKBACK = 15 * 60 * 1000;
const BATCH = 1000;

/** Everything the sync steps read and update; created once per `syncOnce` call. */
export type SyncContext = Awaited<ReturnType<typeof syncContext>>;

/** Load the state and set up the context (the result starts with the stored cursor). */
export async function syncContext(opts: SyncOptions) {
  const state = await opts.state.load();
  const result: SyncResult = {
    pushed: { records: 0, blobs: 0 },
    pulled: { records: 0, blobs: 0 },
    snapshot: null,
    cursor: state.cursor,
    warnings: [],
  };
  const pushed = new Set(state.pushed);
  const seen = new Set(state.seen);
  const keys: Record<string, string> = { ...state.keys };
  const conflicts: Record<string, string> = { ...state.conflicts };
  const c = {
    opts,
    state,
    result,
    pushed,
    seen,
    keys,
    conflicts,
    now: opts.now ?? Date.now,
    lookback: opts.lookbackMs ?? LOOKBACK,
    trust: opts.keys?.length ? (r: AnyRecord) => verifyRecord(r, opts.keys!) : undefined,
    /** Add a warning to the result; always true. */
    warn: (msg: string) => (result.warnings ?? []).push(msg) > 0,
    /** True (with a warning) when the record belongs to another project. */
    foreign: (r: AnyRecord, where: string) =>
      r.project !== opts.projectId && c.warn(`skipped ${r.id} ${where}: it belongs to project ${r.project}`),
    /** Persist the state with the context's sets and maps. */
    save: () => opts.state.save({ ...state, pushed: [...pushed], seen: [...seen], keys, conflicts }),
  };
  return c;
}

export const keyTime = (key: string) => ulidTime(key.slice(LOG_PREFIX.length));
const maxKey = (a: string | null, b: string | null) => (a === null ? b : b === null || a >= b ? a : b);
export const isoSeconds = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** ULID string for a time with zero randomness (used for StartAfter with lookback). */
export function ulidFloor(ms: number): string {
  let t = Math.max(0, Math.floor(ms));
  let out = '';
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return `${out}${'0'.repeat(16)}`;
}

// ── Pull ────────────────────────────────────────────────────────────────────────────────────────────

/** Read the log (fully once a day, otherwise from the cursor minus the lookback) and merge every unseen object. */
export async function pullPhase(c: SyncContext): Promise<void> {
  const { state } = c;
  const full =
    !!c.opts.full ||
    state.cursor === null ||
    !state.lastFullAt ||
    c.now() - Date.parse(state.lastFullAt) >= DAY;
  let after =
    full || state.cursor === null
      ? undefined
      : `${LOG_PREFIX}${ulidFloor(Math.max(0, keyTime(state.cursor) - c.lookback))}`;
  let greatest = full && !c.opts.full ? await fromLogSnapshot(c) : null;
  for (;;) {
    const page = await c.opts.store.listLog(after ? { startAfter: after } : {});
    for (const key of page.keys) {
      greatest = maxKey(greatest, key);
      if (!c.seen.has(key)) await pullKey(c, key);
    }
    if (!page.truncated || !page.keys.length) break;
    after = page.keys.at(-1)!;
  }
  advanceCursor(c, greatest, full);
  await c.save();
}

/** A full listing starts from the newest log snapshot (docs/spec/sync.md#log-snapshots-v02): its log objects count as read. */
async function fromLogSnapshot(c: SyncContext): Promise<string | null> {
  const snap = await c.opts.store.readLogSnapshot(c.opts.projectId, c.now()).catch((e) => {
    if ((e as StoreError).code !== 'invalid') throw e;
    c.warn(`${(e as Error).message}; reading the whole log instead`);
  });
  if (!snap) return null;
  // merged on every full listing, like the log objects it replaces: repairs the replica, applies new trusted keys
  await pullRecords(
    c,
    snap.logs.flatMap((l) => l.records.map((r): [AnyRecord, string] => [r, l.key])),
  );
  for (const l of snap.logs) c.seen.add(l.key);
  c.result.logSnapshot = snap.key;
  return snap.upto;
}

/** Merge one log object; it counts as seen afterwards, also when it could not be read. */
async function pullKey(c: SyncContext, key: string): Promise<void> {
  // One unreadable object (corrupt, or from a newer tool) must not block every later sync.
  const entry = await c.opts.store.readLog(key).catch((e) => {
    if ((e as StoreError).code !== 'invalid') throw e;
    c.warn(`${(e as Error).message} (skipped)`);
  });
  if (entry?.invalid) c.warn(`skipped ${entry.invalid} invalid record(s) in ${key}`);
  await pullRecords(
    c,
    (entry?.records ?? []).map((r) => [r, key]),
  );
  c.seen.add(key);
}

/** Merge (record, log key) pairs in order, 500 at a time; bodies of one ID one after another (only they are ordered). */
async function pullRecords(c: SyncContext, items: [AnyRecord, string][]): Promise<void> {
  for (let i = 0; i < items.length; i += 500) {
    const chains = new Map<string, Promise<void>>();
    for (const [r, key] of items.slice(i, i + 500))
      chains.set(
        r.id,
        (chains.get(r.id) ?? Promise.resolve()).then(() => pullRecord(c, r, key)),
      );
    await Promise.all(chains.values());
  }
}

/** Two bodies with one ID: every replica ends with the one under the log key that sorts first. */
async function pullRecord(c: SyncContext, r: AnyRecord, key: string): Promise<void> {
  if (c.foreign(r, `in ${key}`)) return;
  const local = await c.opts.replica.getRecord(r.id);
  const held = local ? { json: JSON.stringify(local), key: c.keys[r.id] } : undefined;
  const step = await mergeStep(held, r, key, c.trust);
  if (step === 'add' && (await c.opts.replica.putRecord(r))) c.result.pulled.records++;
  if (step === 'replace') await c.opts.replica.replaceRecord(r);
  if (step === 'replace' || step === 'keep') {
    const note = conflictMessage(r.id, key, step, 'local');
    c.conflicts[r.id] = note;
    c.warn(note);
  }
  if (step && step !== 'keep') c.keys[r.id] = key;
  c.pushed.add(r.id);
  if (c.opts.evidence === 'all') c.result.pulled.blobs += await fetchBlobs(c, r);
}

/**
 * Cap the cursor at the reader's clock so a writer whose clock runs ahead cannot push it into the future.
 * With no key seen it stays null: listing an empty log is cheap, and a reader whose clock runs ahead
 * would otherwise skip the records of correctly clocked writers. Then forget seen keys outside the window.
 */
function advanceCursor(c: SyncContext, greatest: string | null, full: boolean): void {
  const cap = `${LOG_PREFIX}${ulidFloor(c.now())}.json`;
  const cursor = maxKey(c.state.cursor, greatest);
  c.state.cursor = cursor !== null && cursor > cap ? cap : cursor;
  if (full) c.state.lastFullAt = isoSeconds(c.now());
  const floor = c.state.cursor ? keyTime(c.state.cursor) - c.lookback : 0;
  for (const k of c.seen) if (!(keyTime(k) >= floor)) c.seen.delete(k);
}

/** Download the blobs a record references that the replica lacks (`evidence: 'all'`). */
async function fetchBlobs(c: SyncContext, r: AnyRecord): Promise<number> {
  let n = 0;
  for (const sha of blobRefs(r)) {
    if (await c.opts.replica.hasBlob(sha)) continue;
    const data = await c.opts.store.getBlob(sha);
    if (!data) continue;
    await c.opts.replica.putBlob(data);
    n++;
  }
  return n;
}

// ── Push ────────────────────────────────────────────────────────────────────────────────────────────

/** Push records not yet in the store (in batches), then the extra blobs, then a snapshot when one is wanted. */
export async function pushPhase(c: SyncContext): Promise<void> {
  const local = await c.opts.replica.records();
  const todo = await pushable(c, local);
  for (let i = 0; i < todo.length; i += BATCH) await appendBatch(c, todo.slice(i, i + BATCH));
  for (const sha of c.opts.extraBlobs ?? []) {
    if (c.pushed.has(sha)) continue;
    if (!(await c.opts.store.hasBlob(sha))) {
      const data = await c.opts.replica.getBlob(sha);
      if (!data) continue; // added in another clone, or only fetched into cache/blobs/
      await c.opts.store.putBlob(sha, data);
      c.result.pushed.blobs++;
    }
    c.pushed.add(sha);
  }
  await c.save();
  if (c.opts.bundle) await publishSnapshot(c, local);
}

/** Records to append, with their blobs already uploaded. Skips pushed, retracted, foreign and secret-holding ones. */
async function pushable(c: SyncContext, local: AnyRecord[]): Promise<AnyRecord[]> {
  const retracted = new Set(local.flatMap((r) => (r.kind === 'retraction' ? [r.target] : [])));
  const todo: AnyRecord[] = [];
  for (const r of local) {
    if (c.pushed.has(r.id) || retracted.has(r.id) || c.foreign(r, 'in the local replica')) continue;
    // Every caller (iw sync, iw serve, the Playwright reporter) gets the same per-record secret scan.
    // Not over `sig`: a signature is random base64url, so it can look like an API key, and it is no secret.
    const text = JSON.stringify({ ...r, sig: undefined });
    const found = scanSecrets(`runs/${r.id}`, text).filter((x) => x.severity === 'error');
    if (found.length) {
      c.result.held = [...(c.result.held ?? []), ...found];
      c.warn(`held back ${r.id}: the secret scan found ${found.length} problem(s); retract it`);
      continue;
    }
    // Blobs go first. A record whose blob is missing locally waits, so the store never has a record without its blobs.
    const n = await pushBlobs(c, r);
    if (n === null) continue;
    c.result.pushed.blobs += n;
    todo.push(r);
  }
  return todo;
}

/** Append one batch to the log and remember the log key of each record. */
async function appendBatch(c: SyncContext, part: AnyRecord[]): Promise<void> {
  const written = await c.opts.store.appendLog(c.opts.writer, part, c.now());
  for (const key of written) {
    c.seen.add(key);
    // a part over 5 MB spans several log objects: remember the one each record is in
    if (written.length > 1) for (const r of (await c.opts.store.readLog(key)).records) c.keys[r.id] ??= key;
  }
  for (const r of part) {
    c.pushed.add(r.id);
    c.keys[r.id] ??= written[0]!;
  }
  c.result.pushed.records += part.length;
  await c.save();
}

/** Upload the blobs a record references. null when one of them is missing locally. */
async function pushBlobs(c: SyncContext, r: AnyRecord): Promise<number | null> {
  let n = 0;
  for (const sha of blobRefs(r)) {
    if (await c.opts.store.hasBlob(sha)) continue;
    const data = await c.opts.replica.getBlob(sha);
    if (!data) return null;
    await c.opts.store.putBlob(sha, data);
    n++;
  }
  return n;
}

/** Snapshot order: by commit_time, then at, then id. */
const snapOrder = (r: BundleRecord) => `${r.commit_time ?? ''}|${r.at}|${r.id}`;

/** Publish a bundle snapshot when the definitions changed: upload the tar, then append a (signed) bundle record. */
async function publishSnapshot(c: SyncContext, local: AnyRecord[]): Promise<void> {
  const { opts, now } = c;
  const b = opts.bundle!;
  const snap = await snapshotBundle(b.fs);
  const snaps = local.filter((r): r is BundleRecord => r.kind === 'bundle');
  const exists = snaps.some((r) => r.definitions_hash === snap.hash && r.ref === b.ref);
  const newest = snaps.sort((x, y) => (snapOrder(x) < snapOrder(y) ? 1 : -1))[0];
  const wanted = b.manual
    ? newest?.definitions_hash !== snap.hash
    : b.clean && snap.hash !== c.state.lastSnapshotHash && !exists;
  if (wanted) {
    const sha = await opts.replica.putBlob(snap.tar, 'application/x-tar');
    if (!(await opts.store.hasBlob(sha))) {
      await opts.store.putBlob(sha, snap.tar, 'application/x-tar');
      c.result.pushed.blobs++;
    }
    const at = isoSeconds(now());
    const record = await (b.sign ?? (async (r) => r))(
      AnyRecordSchema.parse({
        kind: 'bundle',
        id: newId('rec', now()),
        v: 1,
        project: opts.projectId,
        at,
        actor: b.actor,
        source: b.actor.kind === 'ci' ? 'ci' : 'cli',
        commit: b.commit,
        // an upload without a clean commit is ordered by its upload time (docs/spec/sync.md#snapshots-from-people-v02)
        commit_time: b.clean ? b.commitTime : at,
        ref: b.ref,
        sha256: sha,
        definitions_hash: snap.hash,
        files: snap.files,
        ...(b.manual && !b.clean && { dirty: true }),
        ...(b.message && { message: b.message }),
      }),
    );
    await opts.replica.putRecord(record);
    const [key] = await opts.store.appendLog(opts.writer, [record], now());
    c.seen.add(key!);
    c.keys[record.id] = key!;
    c.pushed.add(record.id);
    c.result.pushed.records++;
    c.result.snapshot = record.id;
  }
  if (b.clean) c.state.lastSnapshotHash = snap.hash;
  await c.save();
}
