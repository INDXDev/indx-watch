/** Shared fixtures for the sync tests: in-memory clones over one store, log writers and an examples/shop BundleFs. */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { AnyRecord, BundleFs } from '@indx-watch/bundle';
import {
  createReplica,
  createResultStore,
  type LocalReplica,
  memoryObjectStore,
  type ObjectStore,
} from '@indx-watch/store';
import { PROJECT, runRecord } from '../../store/test/helpers/records.js';
import { memoryStateStore, type SyncOptions, syncOnce, ulidFloor } from '../src/index.js';

export const enc = new TextEncoder();
export const MIN = 60_000;
export const actor = { kind: 'ci', id: 'github:octocat', via: 'github' } as const;
/** The examples/shop bundle directory. */
export const shop = join(import.meta.dirname, '../../../examples/shop/.indx-watch');

/** ObjectStore wrapper that counts GETs (to check transfers); `fail` makes chosen puts fail. */
export function instrumented(inner: ObjectStore, fail?: (key: string) => boolean) {
  const stats = { gets: 0, puts: 0 };
  const store: ObjectStore = {
    ...inner,
    url: inner.url,
    get: (k) => {
      stats.gets++;
      return inner.get(k);
    },
    put: async (k, b, o) => {
      if (fail?.(k)) throw new Error(`injected failure on ${k}`);
      stats.puts++;
      return inner.put(k, b, o);
    },
    head: (k) => inner.head(k),
    list: (o) => inner.list(o),
    delete: (k) => inner.delete(k),
  };
  return { store, stats };
}

/** A fresh in-memory clone (replica + state) syncing with `objects`. */
export function clone(objects: ObjectStore, writer: string, extra: Partial<SyncOptions> = {}) {
  const replica = createReplica(memoryObjectStore());
  const state = memoryStateStore();
  const opts: SyncOptions = {
    replica,
    store: createResultStore(objects),
    state,
    projectId: PROJECT,
    writer,
    ...extra,
  };
  return { replica, state, opts, sync: (o: Partial<SyncOptions> = {}) => syncOnce({ ...opts, ...o }) };
}

/** Put a log object directly under a key of any time, like a writer in another process. */
export async function putLog(objects: ObjectStore, ms: number, records: AnyRecord[]) {
  const key = `v1/log/${ulidFloor(ms).slice(0, 10)}${Math.random()
    .toString(36)
    .slice(2, 12)
    .toUpperCase()
    .replace(/[ILOU]/g, 'X')
    .padEnd(16, '0')
    .slice(0, 16)}.json`;
  await objects.put(key, JSON.stringify({ v: 1, writer: 'other', records }), { ifNoneMatch: true });
  return key;
}

/** Every record in the store log, in key order. */
export async function storeRecords(objects: ObjectStore) {
  const rs = createResultStore(objects);
  const out: AnyRecord[] = [];
  for (const key of (await rs.listLog({})).keys) out.push(...(await rs.readLog(key)).records);
  return out;
}

/** Put a run with one evidence blob into the replica. */
export async function withEvidence(replica: LocalReplica, text: string) {
  const sha = await replica.putBlob(enc.encode(text), 'image/png');
  const run = runRecord({ evidence: [sha] });
  await replica.putRecord(run);
  return { run, sha };
}

/** BundleFs over the examples/shop definition files (for tests). */
export function dirFs(root: string, files = new Map<string, Uint8Array>()): BundleFs {
  return {
    async read(p) {
      if (files.has(p)) return files.get(p)!;
      return readFile(join(root, p)).then(
        (b) => new Uint8Array(b),
        () => null,
      );
    },
    async write(p, d) {
      files.set(p, typeof d === 'string' ? enc.encode(d) : d);
    },
    async list(dir) {
      const out = await readdir(join(root, dir), { withFileTypes: true }).catch(() => []);
      const names = out.map((e) => ({ name: e.name, dir: e.isDirectory() }));
      for (const p of files.keys()) {
        const rel = relative(dir, p);
        if (!rel.startsWith('..') && !rel.includes('/') && !names.some((n) => n.name === rel))
          names.push({ name: rel, dir: false });
      }
      return names;
    },
    async remove() {},
  };
}
