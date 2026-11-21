/**
 * Sync (docs/spec/sync.md). CONTRACT: signatures frozen.
 */
import type { AnyRecord, Bundle, BundleFs, Problem, SigningKey } from '@indx-watch/bundle';
import type { LocalReplica, ResultStore, StoreError } from '@indx-watch/store';
import { pullPhase, pushPhase, syncContext } from './phases.js';

export interface SyncState {
  /** greatest log key seen */
  cursor: string | null;
  /** log keys seen inside the lookback window */
  seen: string[];
  /** record IDs (and pointer blob hashes) known to exist in the store */
  pushed: string[];
  lastFullAt: string | null;
  lastSnapshotHash: string | null;
  /** record ID → the earliest log key holding the body the replica has (docs/spec/sync.md#merge-rules) */
  keys?: Record<string, string>;
  /** record ID → warning, for records the store has two bodies of (`iw check` and the UI show them) */
  conflicts?: Record<string, string>;
  /** key of the log snapshot the last full listing started from (docs/spec/sync.md#log-snapshots-v02) */
  logSnapshot?: string;
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
    /** signs the bundle record (IW_SIGNING_KEY, docs/spec/security.md#signed-records) */
    sign?: <R extends AnyRecord>(record: R) => Promise<R>;
  };
  direction?: 'both' | 'push' | 'pull';
  evidence?: 'on-demand' | 'all' | 'none';
  full?: boolean;
  /** project.toml [[signing_keys]]: a body they verify is never replaced by one they do not (merge rules) */
  keys?: SigningKey[];
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
  /** the log snapshot a full listing started from */
  logSnapshot?: string;
}

export { type CompactResult, compactLog } from './compact.js';
export { isoSeconds, ulidFloor } from './phases.js';
export { definitionFiles, definitionsHash, snapshotBundle } from './snapshot.js';

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

/** SHA-256 of every fixture data file stored as a blob pointer (`iw sync` uploads them with `extraBlobs`). */
export const pointerBlobs = (b: Bundle): string[] =>
  b.fixtures.flatMap((f) => f.dataFiles.flatMap((d) => (d.pointer ? [d.sha256] : [])));

/** One sync: pull (pullPhase), then push (pushPhase), as `direction` (default 'both') allows. */
export async function syncOnce(opts: SyncOptions): Promise<SyncResult> {
  await opts.store.init(opts.projectId);
  const c = await syncContext(opts);
  // Pull first: a full listing rebuilds the pushed set, so deleting cache/ never causes a double push.
  // For the same reason a push-only sync on a fresh state (no full listing yet) lists the log once too.
  if (opts.direction !== 'push' || !c.state.lastFullAt) await pullPhase(c);
  if (opts.direction !== 'pull') await pushPhase(c);
  c.result.cursor = c.state.cursor;
  return c.result;
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
