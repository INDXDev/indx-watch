/** Log compaction: `iw compact` writes a log snapshot (docs/spec/sync.md#log-snapshots-v02). */
import { LOG_PREFIX, type LogCopy, type ResultStore, type StoreError } from '@indx-watch/store';
import { ulidFloor } from './phases.js';

/** snapshot: the newest log snapshot afterwards · written: by this call · logs, records: what it holds */
export type CompactResult = {
  snapshot: string | null;
  written: boolean;
  logs: number;
  records: number;
  warnings?: string[];
};

/**
 * Copy the newest log snapshot plus every readable log object older than the lookback window that it lacks
 * into a new snapshot. Writes nothing when no log object is new. The log itself is never changed.
 */
export async function compactLog(o: {
  store: ResultStore;
  projectId: string;
  now?: number;
}): Promise<CompactResult> {
  const [{ store }, now, warnings] = [o, o.now ?? Date.now(), [] as string[]];
  const skip = (e: unknown) => {
    if ((e as StoreError).code !== 'invalid') throw e;
    warnings.push(`${(e as Error).message} (skipped)`);
  };
  await store.init(o.projectId);
  const base = await store.readLogSnapshot(o.projectId, now).catch(skip);
  const logs = new Map<string, LogCopy>(base?.logs.map((l) => [l.key, l]));
  const [size, upto] = [logs.size, `${LOG_PREFIX}${ulidFloor(now - 15 * 60 * 1000)}`];
  for (let after: string | undefined, more = true; more; ) {
    const page = await store.listLog(after ? { startAfter: after } : {});
    const keys = page.keys.filter((k) => k <= upto && !logs.has(k));
    // a log object that cannot be read or holds invalid records is left out: clones read it from the log and warn
    for (const entry of await Promise.all(keys.map((k) => store.readLog(k).catch(skip))))
      if (entry && !entry.invalid) logs.set(entry.key, { key: entry.key, records: entry.records });
    [after, more] = [page.keys.at(-1), page.truncated && !!page.keys.length && page.keys.at(-1)! <= upto];
  }
  const all = [...logs.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  const written = logs.size > size;
  const snapshot = written ? await store.putLogSnapshot(o.projectId, all) : (base?.key ?? null);
  const records = all.reduce((n, l) => n + l.records.length, 0);
  return { snapshot, written, logs: all.length, records, ...(warnings.length && { warnings }) };
}
