import type { AnyRecord } from '@indx-watch/bundle';
import type { Index, IndexFilter, ObjectInfo, ObjectStore } from '../ports.js';
import { checkKey, cmp, pageKeys, toBytes } from '../util.js';

/** In-memory ObjectStore (tests). */
export function memoryObjectStore(url = 'memory://'): ObjectStore {
  const objects = new Map<string, { body: Uint8Array; etag: string }>();
  let version = 0;
  const info = (key: string): ObjectInfo | null => {
    const o = objects.get(key);
    return o ? { key, size: o.body.byteLength, etag: o.etag } : null;
  };
  return {
    url,
    async get(key) {
      return objects.get(checkKey(key))?.body.slice() ?? null;
    },
    async head(key) {
      return info(checkKey(key));
    },
    async put(key, body, opts) {
      if (opts?.ifNoneMatch && objects.has(checkKey(key))) return false;
      objects.set(checkKey(key), { body: toBytes(body).slice(), etag: `"${++version}"` });
      return true;
    },
    async list(opts) {
      return pageKeys(
        [...objects.keys()].sort().map((k) => info(k)!),
        opts,
      );
    },
    async delete(key) {
      objects.delete(checkKey(key));
    },
  };
}

/** Record filter of the memory index (the d1 index implements the same meaning in SQL). */
export function recordTestCase(r: AnyRecord): string | undefined {
  return r.kind === 'run' || r.kind === 'waiver' ? r.test_case.id : undefined;
}
export function recordRelease(r: AnyRecord): string | undefined {
  return 'release' in r ? r.release : undefined;
}

/** Sorted by (at, id) ascending. limit keeps the newest N (still in ascending order). */
export function filterRecords(all: Iterable<AnyRecord>, f: IndexFilter = {}): AnyRecord[] {
  const out = [...all]
    .filter(
      (r) =>
        (!f.kinds || f.kinds.includes(r.kind)) &&
        (!f.testCaseId || recordTestCase(r) === f.testCaseId) &&
        (!f.release || recordRelease(r) === f.release) &&
        (!f.since || r.at >= f.since),
    )
    .sort((a, b) => cmp(`${a.at} ${a.id}`, `${b.at} ${b.id}`));
  return f.limit !== undefined ? out.slice(Math.max(0, out.length - f.limit)) : out;
}

/** In-memory Index. */
export function memoryIndex(): Index {
  const records = new Map<string, AnyRecord>();
  const meta = new Map<string, string>();
  let defs: { files: Map<string, string>; source: string; at: string } | null = null;
  return {
    async ingest(list) {
      let added = 0;
      for (const r of list) {
        if (records.has(r.id)) continue;
        records.set(r.id, r);
        added++;
      }
      return added;
    },
    async records(filter) {
      return filterRecords(records.values(), filter);
    },
    async setDefinitions(files, m) {
      defs = { files: new Map(files), source: m.source, at: m.at };
    },
    async definitions() {
      return defs && { ...defs, files: new Map(defs.files) };
    },
    async getMeta(key) {
      return meta.get(key) ?? null;
    },
    async setMeta(key, value) {
      meta.set(key, value);
    },
    async reset() {
      records.clear();
      meta.clear();
      defs = null;
    },
  };
}
