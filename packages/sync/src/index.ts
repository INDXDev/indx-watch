/**
 * Sync (docs/spec/sync.md). CONTRACT: signatures frozen.
 */
import type { BundleFs } from '@indx-watch/bundle';
import { type AnyRecord, AnyRecord as AnyRecordSchema, newId } from '@indx-watch/bundle';
import { blobRefs, LOG_PREFIX, type LocalReplica, type ResultStore, ulidTime } from '@indx-watch/store';
import { snapshotBundle } from './snapshot.js';

export interface SyncState {
  /** greatest log key seen */
  cursor: string | null;
  /** log keys seen inside the lookback window */
  seen: string[];
  /** record IDs known to exist in the store */
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
  };
  direction?: 'both' | 'push' | 'pull';
  evidence?: 'on-demand' | 'all' | 'none';
  full?: boolean;
  /** lookback window in ms (default 15 min) */
  lookbackMs?: number;
  now?: () => number;
}

export interface SyncResult {
  pushed: { records: number; blobs: number };
  pulled: { records: number; blobs: number };
  snapshot: string | null;
  cursor: string | null;
}

export { definitionsHash, snapshotBundle } from './snapshot.js';

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
export const isoSeconds = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

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
  };
  const save = () => opts.state.save({ ...state, pushed: [...pushed], seen: [...seen] });

  // 先に pull: 全件リスト時に push 済み集合が作り直され、cache/ を消した後でも二重に push しない
  if (direction !== 'push') {
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
        const entry = await opts.store.readLog(key);
        for (const r of entry.records) {
          if (await opts.replica.putRecord(r)) result.pulled.records++;
          pushed.add(r.id);
          if (opts.evidence === 'all') result.pulled.blobs += await fetchBlobs(opts, r);
        }
        seen.add(key);
      }
      if (!page.truncated || !page.keys.length) break;
      after = page.keys.at(-1)!;
    }
    // 時計が進んだ書き手のキーでカーソルが未来に飛ばないよう、読み手の現在時刻で抑える
    const cap = `${LOG_PREFIX}${ulidFloor(now())}.json`;
    // 全件リストの後は、何もなくても読み手の現在時刻までは見たことになる
    const cursor = maxKey(state.cursor, greatest) ?? (full ? cap : null);
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
      if (pushed.has(r.id) || retracted.has(r.id)) continue;
      // blob を先に上げる。手元に blob がない記録は（blob なしの記録を作らないため）今回は送らない
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
    if (opts.bundle) {
      const snap = await snapshotBundle(opts.bundle.fs);
      const exists = local.some(
        (r) => r.kind === 'bundle' && r.definitions_hash === snap.hash && r.ref === opts.bundle?.ref,
      );
      if (opts.bundle.clean && snap.hash !== state.lastSnapshotHash && !exists) {
        const sha = await opts.replica.putBlob(snap.tar, 'application/x-tar');
        if (!(await opts.store.hasBlob(sha))) {
          await opts.store.putBlob(sha, snap.tar, 'application/x-tar');
          result.pushed.blobs++;
        }
        const b = opts.bundle;
        const record = AnyRecordSchema.parse({
          kind: 'bundle',
          id: newId('rec', now()),
          v: 1,
          project: opts.projectId,
          at: isoSeconds(now()),
          actor: b.actor,
          source: b.actor.kind === 'ci' ? 'ci' : 'cli',
          commit: b.commit,
          commit_time: b.commitTime,
          ref: b.ref,
          sha256: sha,
          definitions_hash: snap.hash,
          files: snap.files,
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

/** 記録が参照する blob をストアへ。手元にないものがあれば null。 */
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

/** Push on local change (debounced), pull every interval. Returns a stop function. */
export function watch(
  opts: SyncOptions & {
    intervalMs?: number;
    onResult?: (r: SyncResult) => void;
    onError?: (e: unknown) => void;
  },
): () => Promise<void> {
  let stopped = false;
  let chain: Promise<void> = Promise.resolve();
  const queued = new Set<string>();
  const run = (direction: 'both' | 'push' | 'pull') => {
    if (stopped || queued.has(direction)) return;
    queued.add(direction);
    chain = chain.then(async () => {
      queued.delete(direction);
      if (stopped) return;
      try {
        // `onResult?.(await …)` だと onResult がないとき同期自体が評価されないので分ける
        const r = await syncOnce({ ...opts, direction });
        opts.onResult?.(r);
      } catch (e) {
        opts.onError?.(e);
      }
    });
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = opts.replica.onChange(() => {
    clearTimeout(timer);
    timer = setTimeout(() => run('push'), 300);
  });
  const interval = setInterval(() => run('pull'), opts.intervalMs ?? 3000);
  run('both');
  return async () => {
    stopped = true;
    unsubscribe();
    clearTimeout(timer);
    clearInterval(interval);
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
