/**
 * Records of the local replica read through the node:sqlite index (roadmap T-217): each read lists runs/records/ with
 * file times, parses only the files the index has not seen, and rebuilds the index when a file it holds was replaced
 * or removed (docs/spec/cli.md#iw-serve).
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import type { AnyRecord } from '@indx-watch/bundle';
import type { Index, LocalReplica } from '../ports.js';
import { checkRecord, parseJson } from '../util.js';

/** Index meta key: file key → [record ID, mtime] for every file whose record the index holds. */
export const REPLICA_META = 'replica.files';
type Seen = Record<string, [id: string, mtime: number]>;
type File = { key: string; mtime: number };

/** The record files under runs/records/ in key order (dot-names skipped), as LocalReplica.records() reads them. */
async function listFiles(runs: string): Promise<File[]> {
  const names = await readdir(join(runs, 'records'), { recursive: true }).catch(() => [] as string[]);
  const keys = names.map((n) => `records/${n.split(sep).join('/')}`);
  const files = keys
    .filter((k) => k.endsWith('.json') && !k.split('/').some((p) => p.startsWith('.')))
    .sort();
  const stats = await Promise.all(files.map((k) => stat(join(runs, k)).catch(() => null)));
  return files.flatMap((key, i) => (stats[i]?.isFile() ? [{ key, mtime: stats[i].mtimeMs }] : []));
}

/**
 * LocalReplica.records() over `index`: same records in the same order, but a read parses only files new to the index.
 * A held file that is gone or has another mtime (newer or older) rebuilds the index. Reads run one at a time.
 * `runs` is the replica directory (<bundleDir>/runs).
 */
export function indexedRecords(index: Index, runs: string): LocalReplica['records'] {
  let last: Promise<unknown> = Promise.resolve();
  const read = async (onInvalid?: (file: string, error: string) => void) => {
    const files = await listFiles(runs);
    const raw = await index.getMeta(REPLICA_META);
    let seen: Seen = raw ? JSON.parse(raw) : {};
    let held = new Map((await index.records()).map((r) => [r.id, r]));
    const mtimes = new Map(files.map((f) => [f.key, f.mtime]));
    const changed = ([key, [id, mtime]]: [string, Seen[string]]) =>
      mtimes.get(key) !== mtime || !held.has(id);
    if ((!raw && held.size) || Object.entries(seen).some(changed)) {
      await index.reset();
      [seen, held] = [{}, new Map()];
    }
    const ids = new Set(Object.values(seen).map(([id]) => id));
    const fresh = new Map<string, AnyRecord>();
    for (const f of files.filter((x) => !seen[x.key])) {
      const data = await readFile(join(runs, f.key)).catch(() => null);
      if (!data) continue;
      const c = checkRecord(parseJson(new Uint8Array(data)));
      if ('error' in c) onInvalid?.(f.key, c.error);
      else fresh.set(f.key, c.record);
      // a second file with a held ID is not indexed (it is read again each time, like an invalid file)
      if ('error' in c || ids.has(c.record.id)) continue;
      ids.add(c.record.id);
      seen[f.key] = [c.record.id, f.mtime];
    }
    const add = [...fresh].filter(([k]) => seen[k]);
    if (add.length) await index.ingest(add.map(([, r]) => r));
    await index.setMeta(REPLICA_META, JSON.stringify(seen));
    return files.flatMap((f) => fresh.get(f.key) ?? held.get(seen[f.key]?.[0] ?? '') ?? []);
  };
  return (onInvalid) => {
    const out = last.then(() => read(onInvalid));
    last = out.catch(() => {});
    return out;
  };
}
