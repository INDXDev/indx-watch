/**
 * Sync (docs/spec/sync.md). CONTRACT: signatures frozen.
 */
import type { Bundle, BundleFs, BundleRecord } from '@indx-watch/bundle';
import {
  type AnyRecord,
  AnyRecord as AnyRecordSchema,
  newId,
  type Problem,
  scanSecrets,
} from '@indx-watch/bundle';
import {
  blobRefs,
  LOG_PREFIX,
  type LocalReplica,
  type LogEntry,
  type ResultStore,
  type StoreError,
  ulidTime,
} from '@indx-watch/store';
import { snapshotBundle } from './snapshot.js';

export interface SyncState {
  /** greatest log key seen */
  cursor: string | null;
  /** log keys seen inside the lookback window */
  seen: string[];
  /** record IDs (and pointer blob hashes) known to exist in the store */
  pushed: string[];
  lastFullAt: string | null;
  lastSnapshotHash: string | null;
}

export interface StateStore {
  load(): Promise<SyncState>;
  save(state: SyncState): Promise<void>;
}

export interface SyncOptions {
  replica: LocalReplica;
  store: ResultStore;
  state: StateStore;
  projectId: string;
  writer: string;
  /** publish a bundle snapshot when definitions changed (only with `iw sync --snapshot`; the GitHub Action sets it on the default branch) */
  bundle?: {
    fs: BundleFs;
    commit?: string;
    ref?: string;
    clean: boolean;
    commitTime?: string;
    actor: import('@indx-watch/bundle').Actor;
    /** `iw push`: publish even when not clean, unless the newest snapshot has the same definitions */
    manual?: boolean;
    message?: string;
  };
  direction?: 'both' | 'push' | 'pull';
  evidence?: 'on-demand' | 'all' | 'none';
  full?: boolean;
  /** blobs to upload besides those records reference: fixture pointers (`pointerBlobs(bundle)`); skipped when not in the replica */
  extraBlobs?: string[];
  /** lookback window in ms (default 15 min) */
  lookbackMs?: number;
  now?: () => number;
}

export interface SyncResult {
  pushed: { records: number; blobs: number };
  pulled: { records: number; blobs: number };
  snapshot: string | null;
  cursor: string | null;
  /** problems that did not stop the sync: unreadable log objects, foreign or conflicting records, held-back records */
  warnings?: string[];
  /** secret-scan errors of records held back from the push (docs/spec/security.md#secrets); never contain the value */
  held?: Problem[];
}

export { definitionFiles, definitionsHash, snapshotBundle } from './snapshot.js';

const DAY = 24 * 60 * 60 * 1000;
const LOOKBACK = 15 * 60 * 1000;
const BATCH = 1000;

export const emptyState = (): SyncState => ({
  cursor: null,
  seen: [],
  pushed: [],
  lastFullAt: null,
  lastSnapshotHash: null,
});

/** StateStore in memory (tests, the hosted server keeps its cursor in the index). */
export function memoryStateStore(initial: SyncState = emptyState()): StateStore {
  let s = structuredClone(initial);
  return {
    load: async () => structuredClone(s),
    save: async (v) => {
      s = structuredClone(v);
    },
  };
}

const keyTime = (key: string) => ulidTime(key.slice(LOG_PREFIX.length));
const maxKey = (a: string | null, b: string | null) => (a === null ? b : b === null || a >= b ? a : b);
/** SHA-256 of every fixture data file stored as a blob pointer (`iw sync` uploads them with `extraBlobs`). */
export const pointerBlobs = (b: Bundle): string[] =>
  b.fixtures.flatMap((f) => f.dataFiles.flatMap((d) => (d.pointer ? [d.sha256] : [])));
export const isoSeconds = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Snapshot order: by commit_time, then at, then id. */
const snapOrder = (r: BundleRecord) => `${r.commit_time ?? ''}|${r.at}|${r.id}`;

export async function syncOnce(opts: SyncOptions): Promise<SyncResult> {
  const now = opts.now ?? Date.now;
  const lookback = opts.lookbackMs ?? LOOKBACK;
  const direction = opts.direction ?? 'both';
  await opts.store.init(opts.projectId);
  const state = await opts.state.load();
  const pushed = new Set(state.pushed);
  const seen = new Set(state.seen);
  const result: SyncResult = {
    pushed: { records: 0, blobs: 0 },
    pulled: { records: 0, blobs: 0 },
    snapshot: null,
    cursor: state.cursor,
    warnings: [],
  };
  const warn = (msg: string) => (result.warnings ?? []).push(msg) > 0;
  const foreign = (r: AnyRecord, where: string) =>
    r.project !== opts.projectId && warn(`skipped ${r.id} ${where}: it belongs to project ${r.project}`);
  const save = () => opts.state.save({ ...state, pushed: [...pushed], seen: [...seen] });

  // Pull first: a full listing rebuilds the pushed set, so deleting cache/ never causes a double push.
  // For the same reason a push-only sync on a fresh state (no full listing yet) lists the log once too.
  if (direction !== 'push' || !state.lastFullAt) {
    const full =
      !!opts.full ||
      state.cursor === null ||
      !state.lastFullAt ||
      now() - Date.parse(state.lastFullAt) >= DAY;
    let after =
      full || state.cursor === null
        ? undefined
        : `${LOG_PREFIX}${ulidFloor(Math.max(0, keyTime(state.cursor) - lookback))}`;
    let greatest: string | null = null;
    for (;;) {
      const page = await opts.store.listLog(after ? { startAfter: after } : {});
      for (const key of page.keys) {
        greatest = maxKey(greatest, key);
        if (seen.has(key)) continue;
        let entry: LogEntry;
        try {
          entry = await opts.store.readLog(key);
        } catch (e) {
          // One unreadable object (corrupt, or from a newer tool) must not block every later sync.
          if ((e as StoreError).code !== 'invalid') throw e;
          warn(`${(e as Error).message} (skipped)`);
          seen.add(key);
          continue;
        }
        if (entry.invalid) warn(`skipped ${entry.invalid} invalid record(s) in ${key}`);
        for (const r of entry.records) {
          if (foreign(r, `in ${key}`)) continue;
          if (await opts.replica.putRecord(r)) result.pulled.records++;
          else if (await differs(opts.replica, r))
            warn(`record ${r.id} in ${key} differs from the local copy; kept the local copy`);
          pushed.add(r.id);
          if (opts.evidence === 'all') result.pulled.blobs += await fetchBlobs(opts, r);
        }
        seen.add(key);
      }
      if (!page.truncated || !page.keys.length) break;
      after = page.keys.at(-1)!;
    }
    // Cap the cursor at the reader's clock so a writer whose clock runs ahead cannot push it into the future.
    // With no key seen it stays null: listing an empty log is cheap, and a reader whose clock runs ahead
    // would otherwise skip the records of correctly clocked writers.
    const cap = `${LOG_PREFIX}${ulidFloor(now())}.json`;
    const cursor = maxKey(state.cursor, greatest);
    state.cursor = cursor !== null && cursor > cap ? cap : cursor;
    if (full) state.lastFullAt = isoSeconds(now());
    const floor = state.cursor ? keyTime(state.cursor) - lookback : 0;
    for (const k of seen) if (!(keyTime(k) >= floor)) seen.delete(k);
    await save();
  }

  if (direction !== 'pull') {
    const local = await opts.replica.records();
    const retracted = new Set(local.flatMap((r) => (r.kind === 'retraction' ? [r.target] : [])));
    const todo: AnyRecord[] = [];
    for (const r of local) {
      if (pushed.has(r.id) || retracted.has(r.id) || foreign(r, 'in the local replica')) continue;
      // Every caller (iw sync, iw serve, the Playwright reporter) gets the same per-record secret scan.
      const found = scanSecrets(`runs/${r.id}`, JSON.stringify(r)).filter((x) => x.severity === 'error');
      if (found.length) {
        result.held = [...(result.held ?? []), ...found];
        warn(`held back ${r.id}: the secret scan found ${found.length} problem(s); retract it`);
        continue;
      }
      // Blobs go first. A record whose blob is missing locally waits, so the store never has a record without its blobs.
      const n = await pushBlobs(opts, r);
      if (n === null) continue;
      result.pushed.blobs += n;
      todo.push(r);
    }
    for (let i = 0; i < todo.length; i += BATCH) {
      const part = todo.slice(i, i + BATCH);
      for (const key of await opts.store.appendLog(opts.writer, part, now())) seen.add(key);
      for (const r of part) pushed.add(r.id);
      result.pushed.records += part.length;
      await save();
    }
    for (const sha of opts.extraBlobs ?? []) {
      if (pushed.has(sha)) continue;
      if (!(await opts.store.hasBlob(sha))) {
        const data = await opts.replica.getBlob(sha);
        if (!data) continue; // added in another clone, or only fetched into cache/blobs/
        await opts.store.putBlob(sha, data);
        result.pushed.blobs++;
      }
      pushed.add(sha);
    }
    await save();
    if (opts.bundle) {
      const snap = await snapshotBundle(opts.bundle.fs);
      const b = opts.bundle;
      const snaps = local.filter((r): r is BundleRecord => r.kind === 'bundle');
      const exists = snaps.some((r) => r.definitions_hash === snap.hash && r.ref === b.ref);
      const newest = snaps.sort((x, y) => (snapOrder(x) < snapOrder(y) ? 1 : -1))[0];
      const wanted = b.manual
        ? newest?.definitions_hash !== snap.hash
        : b.clean && snap.hash !== state.lastSnapshotHash && !exists;
      if (wanted) {
        const sha = await opts.replica.putBlob(snap.tar, 'application/x-tar');
        if (!(await opts.store.hasBlob(sha))) {
          await opts.store.putBlob(sha, snap.tar, 'application/x-tar');
          result.pushed.blobs++;
        }
        const at = isoSeconds(now());
        const record = AnyRecordSchema.parse({
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
        });
        await opts.replica.putRecord(record);
        for (const key of await opts.store.appendLog(opts.writer, [record], now())) seen.add(key);
        pushed.add(record.id);
        result.pushed.records++;
        result.snapshot = record.id;
      }
      if (opts.bundle.clean) state.lastSnapshotHash = snap.hash;
      await save();
    }
  }
  result.cursor = state.cursor;
  return result;
}

/** Two bodies with the same ID (docs/spec/sync.md#merge-rules). */
async function differs(replica: LocalReplica, r: AnyRecord): Promise<boolean> {
  const local = await replica.getRecord(r.id);
  return !!local && JSON.stringify(local) !== JSON.stringify(r);
}

/** Upload the blobs a record references. null when one of them is missing locally. */
async function pushBlobs(opts: SyncOptions, r: AnyRecord): Promise<number | null> {
  let n = 0;
  for (const sha of blobRefs(r)) {
    if (await opts.store.hasBlob(sha)) continue;
    const data = await opts.replica.getBlob(sha);
    if (!data) return null;
    await opts.store.putBlob(sha, data);
    n++;
  }
  return n;
}

async function fetchBlobs(opts: SyncOptions, r: AnyRecord): Promise<number> {
  let n = 0;
  for (const sha of blobRefs(r)) {
    if (await opts.replica.hasBlob(sha)) continue;
    const data = await opts.store.getBlob(sha);
    if (data) {
      await opts.replica.putBlob(data);
      n++;
    }
  }
  return n;
}

/**
 * Push on local change (debounced), pull every interval. Returns a stop function.
 * A store bound to another project, or one that refuses or is not a store on the first sync, stops the watch:
 * the error goes to onFatal (or onError when onFatal is not given).
 */
export function watch(
  opts: SyncOptions & {
    intervalMs?: number;
    onResult?: (r: SyncResult) => void;
    onError?: (e: unknown) => void;
    onFatal?: (e: unknown) => void;
  },
): () => Promise<void> {
  let stopped = false;
  let ok = false;
  let chain: Promise<void> = Promise.resolve();
  const queued = new Set<string>();
  const run = (direction: 'both' | 'push' | 'pull') => {
    if (stopped || queued.has(direction)) return;
    queued.add(direction);
    chain = chain.then(async () => {
      queued.delete(direction);
      if (stopped) return;
      try {
        // Not `onResult?.(await …)`: without onResult the sync itself would never run.
        const r = await syncOnce({ ...opts, direction });
        ok = true;
        opts.onResult?.(r);
      } catch (e) {
        const code = (e as StoreError).code;
        if (code !== 'wrong-project' && (ok || (code !== 'invalid' && code !== 'unauthorized')))
          return opts.onError?.(e);
        halt();
        (opts.onFatal ?? opts.onError)?.(e);
      }
    });
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = opts.replica.onChange(() => {
    clearTimeout(timer);
    timer = setTimeout(() => run('push'), 300);
  });
  const interval = setInterval(() => run('pull'), opts.intervalMs ?? 3000);
  const halt = () => {
    stopped = true;
    unsubscribe();
    clearTimeout(timer);
    clearInterval(interval);
  };
  run('both');
  return async () => {
    halt();
    await chain;
  };
}

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
