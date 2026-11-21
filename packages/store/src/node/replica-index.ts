/**
 * Records of the local replica read through the node:sqlite index (roadmap T-217): each read lists runs/records/ with
 * file times, parses only the files whose record is not in the index yet, and rebuilds the index when a file it holds
 * was replaced or removed (docs/spec/cli.md#iw-serve).
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, sep } from 'node:path';
import type { AnyRecord } from '@indx-watch/bundle';
import type { Index, LocalReplica } from '../ports.js';
import { checkRecord, parseJson } from '../util.js';

/** Index meta key: `{ at, recent }`, the start time of the last read and the files it parsed that changed after it. */
export const REPLICA_META = 'replica.scan';
type Scan = { at: number; recent: Record<string, number> };
type File = { key: string; id: string; mtime: number };

/** The record files under runs/records/ in key order (dot-names skipped), as LocalReplica.records() reads them. */
async function listFiles(runs: string): Promise<File[]> {
  const names = await readdir(join(runs, 'records'), { recursive: true }).catch(() => [] as string[]);
  const keys = names.map((n) => `records/${n.split(sep).join('/')}`);
  const files = keys.filter((k) => k.endsWith('.json') && !k.split('/').some((p) => p.startsWith('.')));
  const out: File[] = [];
  for (const key of files.sort()) {
    const s = await stat(join(runs, key)).catch(() => null);
    if (s?.isFile()) out.push({ key, id: basename(key, '.json'), mtime: s.mtimeMs });
  }
  return out;
}

/** Whether the index holds a record whose file is gone, or was rewritten since the last read. */
function stale(held: Map<string, AnyRecord>, files: File[], scan: Scan | null) {
  if (!scan) return held.size > 0;
  const ids = new Set(files.map((f) => f.id));
  const rewritten = (f: File) => held.has(f.id) && f.mtime >= scan.at && scan.recent[f.key] !== f.mtime;
  return [...held.keys()].some((id) => !ids.has(id)) || files.some(rewritten);
}

/**
 * LocalReplica.records() over `index`: same records in the same order, but a read parses only files new to the index.
 * Reads run one at a time. `runs` is the replica directory (<bundleDir>/runs).
 */
export function indexedRecords(index: Index, runs: string): LocalReplica['records'] {
  let last: Promise<unknown> = Promise.resolve();
  const read = async (onInvalid?: (file: string, error: string) => void) => {
    const at = Date.now();
    const files = await listFiles(runs);
    const raw = await index.getMeta(REPLICA_META);
    let held = new Map((await index.records()).map((r) => [r.id, r]));
    if (stale(held, files, raw ? (JSON.parse(raw) as Scan) : null)) {
      await index.reset();
      held = new Map();
    }
    const fresh = new Map<string, AnyRecord>();
    const recent: Scan['recent'] = {};
    for (const f of files.filter((x) => !held.has(x.id))) {
      const data = await readFile(join(runs, f.key)).catch(() => null);
      if (!data) continue;
      const c = checkRecord(parseJson(new Uint8Array(data)));
      if ('error' in c) {
        onInvalid?.(f.key, c.error);
        continue;
      }
      fresh.set(f.key, c.record);
      if (f.mtime >= at) recent[f.key] = f.mtime;
    }
    if (fresh.size) await index.ingest([...fresh.values()]);
    await index.setMeta(REPLICA_META, JSON.stringify({ at, recent } satisfies Scan));
    return files.flatMap((f) => held.get(f.id) ?? fresh.get(f.key) ?? []);
  };
  return (onInvalid) => {
    const out = last.then(() => read(onInvalid));
    last = out.catch(() => {});
    return out;
  };
}
