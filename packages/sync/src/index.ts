/**
 * Sync (docs/spec/sync.md). CONTRACT: signatures frozen; implementation T-105.
 */
import type { BundleFs } from '@indx-watch/bundle';
import type { LocalReplica, ResultStore } from '@indx-watch/store';

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
  /** git mode: publish a bundle snapshot when definitions changed */
  bundle?: { fs: BundleFs; commit?: string; ref?: string; clean: boolean; actor: import('@indx-watch/bundle').Actor };
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

export async function syncOnce(opts: SyncOptions): Promise<SyncResult> {
  void opts;
  throw new Error('not implemented (T-105)');
}

/** Push on local change (debounced), pull every interval. Returns a stop function. */
export function watch(
  opts: SyncOptions & { intervalMs?: number; onResult?: (r: SyncResult) => void; onError?: (e: unknown) => void },
): () => Promise<void> {
  void opts;
  throw new Error('not implemented (T-105)');
}

/** ULID string for a time with zero randomness (used for StartAfter with lookback). */
export function ulidFloor(ms: number): string {
  void ms;
  throw new Error('not implemented (T-105)');
}

/** Workspace mode: three-way merge of parsed TOML objects (top-level fields; arrays of tables by id/key). */
export function mergeDefinitions(
  base: Record<string, unknown> | null,
  ours: Record<string, unknown>,
  theirs: Record<string, unknown>,
): { merged: Record<string, unknown>; conflicts: string[] } {
  void base;
  void ours;
  void theirs;
  throw new Error('not implemented (T-105)');
}
