import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { type AnyRecord, type BundleFs, AnyRecord as Schema, sha256Hex } from '@indx-watch/bundle';
import {
  createReplica,
  createResultStore,
  type LocalReplica,
  memoryObjectStore,
  type ObjectStore,
  ulidTime,
} from '@indx-watch/store';
import { openReplica } from '@indx-watch/store/node';
import { unpackTar } from 'modern-tar';
import { describe, expect, it } from 'vitest';
import { PROJECT, retraction, runRecord } from '../../store/test/helpers/records.js';
import {
  emptyState,
  memoryStateStore,
  type SyncOptions,
  type SyncResult,
  syncOnce,
  ulidFloor,
  watch,
} from '../src/index.js';
import { fileStateStore, writerId } from '../src/node.js';

const enc = new TextEncoder();
const MIN = 60_000;
const actor = { kind: 'ci', id: 'github:octocat', via: 'github' } as const;

/** GET の回数を数える ObjectStore ラッパー（転送量の確認用）。fail で特定の put を失敗させる。 */
function instrumented(inner: ObjectStore, fail?: (key: string) => boolean) {
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

function clone(objects: ObjectStore, writer: string, extra: Partial<SyncOptions> = {}) {
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

/** 別プロセスの書き手を真似て、任意の時刻のキーでログオブジェクトを直接置く。 */
async function putLog(objects: ObjectStore, ms: number, records: AnyRecord[]) {
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

async function storeRecords(objects: ObjectStore) {
  const rs = createResultStore(objects);
  const out: AnyRecord[] = [];
  for (const key of (await rs.listLog({})).keys) out.push(...(await rs.readLog(key)).records);
  return out;
}

async function withEvidence(replica: LocalReplica, text: string) {
  const sha = await replica.putBlob(enc.encode(text), 'image/png');
  const run = runRecord({ evidence: [sha] });
  await replica.putRecord(run);
  return { run, sha };
}

describe('syncOnce', () => {
  it('two replicas through one store see each other’s records; evidence follows the policy', async () => {
    const objects = memoryObjectStore();
    const a = clone(objects, 'writer-a');
    const b = clone(objects, 'writer-b');
    const { run, sha } = await withEvidence(a.replica, 'screenshot-a');
    const rb = runRecord();
    await b.replica.putRecord(rb);

    expect(await a.sync()).toMatchObject({ pushed: { records: 1, blobs: 1 }, pulled: { records: 0 } });
    const rb1 = await b.sync();
    expect(rb1).toMatchObject({ pushed: { records: 1, blobs: 0 }, pulled: { records: 1, blobs: 0 } });
    expect(await b.replica.getRecord(run.id)).toEqual(run);
    expect(await b.replica.hasBlob(sha)).toBe(false); // on-demand（既定）
    expect(await a.sync({ evidence: 'all' })).toMatchObject({ pulled: { records: 1 } });
    expect(await a.replica.getRecord(rb.id)).toEqual(rb);

    const c = clone(objects, 'writer-c', { evidence: 'all' });
    expect(await c.sync()).toMatchObject({ pulled: { records: 2, blobs: 1 } });
    expect(await c.replica.getBlob(sha)).toEqual(enc.encode('screenshot-a'));
    expect(rb1.cursor).toMatch(/^v1\/log\//);
  });

  it('is idempotent: a second sync transfers nothing', async () => {
    const { store, stats } = instrumented(memoryObjectStore());
    const a = clone(store, 'writer-a');
    const b = clone(store, 'writer-b');
    await withEvidence(a.replica, 'x');
    await a.sync();
    await b.replica.putRecord(runRecord());
    await b.sync();
    await a.sync();
    const before = { ...stats };
    const r = await a.sync();
    expect(r).toMatchObject({ pushed: { records: 0, blobs: 0 }, pulled: { records: 0, blobs: 0 } });
    expect(stats.puts).toBe(before.puts);
    expect(stats.gets - before.gets).toBe(1); // ストアのマニフェスト確認だけ
  });

  it('pulls a log object keyed 10 minutes before the reader’s cursor (lookback window)', async () => {
    const objects = memoryObjectStore();
    const T = Date.now();
    const reader = clone(objects, 'reader', { now: () => T });
    await reader.sync();
    const late = runRecord();
    await putLog(objects, T - 10 * MIN, [late]);
    const veryLate = runRecord();
    await putLog(objects, T - 40 * MIN, [veryLate]);
    expect(await reader.sync({ now: () => T + 1000 })).toMatchObject({ pulled: { records: 1 } });
    expect(await reader.replica.getRecord(late.id)).not.toBeNull();
    // 窓より古いキーは日次の全件リスト（または --full）で拾う
    expect(await reader.replica.getRecord(veryLate.id)).toBeNull();
    expect(await reader.sync({ now: () => T + 25 * 60 * MIN })).toMatchObject({ pulled: { records: 1 } });
    expect(await reader.replica.getRecord(veryLate.id)).not.toBeNull();
  });

  it('a log key one day in the future does not hide records written afterwards', async () => {
    const objects = memoryObjectStore();
    const T = Date.now();
    const reader = clone(objects, 'reader', { now: () => T });
    const future = runRecord();
    await putLog(objects, T + 24 * 60 * MIN, [future]);
    const r1 = await reader.sync();
    expect(r1.pulled.records).toBe(1);
    expect(ulidTime(r1.cursor!.slice('v1/log/'.length))).toBeLessThanOrEqual(T);
    const writer = clone(objects, 'writer');
    const later = runRecord();
    await writer.replica.putRecord(later);
    await writer.sync({ now: () => Date.now() });
    expect(await reader.sync({ now: () => T + 3000 })).toMatchObject({ pulled: { records: 1 } });
    expect(await reader.replica.getRecord(later.id)).toEqual(later);
  });

  it('an interrupted push leaves no record without its blobs', async () => {
    const inner = memoryObjectStore();
    let failLog = true;
    const { store } = instrumented(inner, (k) => k.startsWith('v1/log/') && failLog);
    const a = clone(store, 'writer-a');
    const { run, sha } = await withEvidence(a.replica, 'evidence');
    await expect(a.sync()).rejects.toThrow(/injected failure/);
    expect(await createResultStore(inner).hasBlob(sha)).toBe(true);
    expect(await storeRecords(inner)).toEqual([]);
    failLog = false;
    expect(await a.sync()).toMatchObject({ pushed: { records: 1, blobs: 0 } });
    expect((await storeRecords(inner)).map((r) => r.id)).toEqual([run.id]);

    // blob のアップロードが失敗したら、ログオブジェクトは書かれない
    const inner2 = memoryObjectStore();
    const b = clone(instrumented(inner2, (k) => k.startsWith('v1/blobs/')).store, 'writer-b');
    await withEvidence(b.replica, 'other evidence');
    await expect(b.sync()).rejects.toThrow(/injected failure/);
    expect((await inner2.list({ prefix: 'v1/log/' })).keys).toEqual([]);
  });

  it('holds back a record whose blob is missing locally', async () => {
    const objects = memoryObjectStore();
    const a = clone(objects, 'writer-a');
    const ghost = await sha256Hex('never written');
    await a.replica.putRecord(runRecord({ evidence: [ghost] }));
    expect(await a.sync()).toMatchObject({ pushed: { records: 0 } });
    expect(await storeRecords(objects)).toEqual([]);
  });

  it('refuses a store bound to another project', async () => {
    const objects = memoryObjectStore();
    await createResultStore(objects).init('prj_01JF3Q8M5X2V7K9D4R6T1W0Y01');
    await expect(clone(objects, 'w').sync()).rejects.toMatchObject({ code: 'wrong-project' });
  });

  it('never pushes a retracted record', async () => {
    const objects = memoryObjectStore();
    const a = clone(objects, 'w');
    const run = runRecord();
    const x = retraction(run.id);
    await a.replica.putRecord(run);
    await a.replica.putRecord(x);
    expect(await a.sync()).toMatchObject({ pushed: { records: 1 } });
    expect((await storeRecords(objects)).map((r) => r.id)).toEqual([x.id]);
  });

  it('rebuilds the pushed set from a full listing when the cache was deleted', async () => {
    const objects = memoryObjectStore();
    const a = clone(objects, 'w');
    await a.replica.putRecord(runRecord());
    await a.sync();
    await a.state.save(emptyState());
    expect(await a.sync()).toMatchObject({ pushed: { records: 0 }, pulled: { records: 0 } });
    expect(await storeRecords(objects)).toHaveLength(1);
  });

  it('pushes up to 1000 records per log object', async () => {
    const objects = memoryObjectStore();
    const a = clone(objects, 'w');
    for (let i = 0; i < 1001; i++) await a.replica.putRecord(runRecord());
    expect(await a.sync({ direction: 'push' })).toMatchObject({ pushed: { records: 1001 } });
    expect((await objects.list({ prefix: 'v1/log/' })).keys).toHaveLength(2);
  });
});

/** examples/shop の定義ファイルを読むだけの BundleFs（テスト用）。 */
function dirFs(root: string, files = new Map<string, Uint8Array>()): BundleFs {
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

describe('bundle snapshots', () => {
  const shop = join(import.meta.dirname, '../../../examples/shop/.indx-watch');

  it('never writes a bundle record without opts.bundle', async () => {
    const objects = memoryObjectStore();
    const a = clone(objects, 'w');
    await a.replica.putRecord(runRecord());
    expect((await a.sync()).snapshot).toBeNull();
    expect((await storeRecords(objects)).filter((r) => r.kind === 'bundle')).toEqual([]);
  });

  it('publishes a deterministic tar once per definitions hash, only from a clean tree', async () => {
    const objects = memoryObjectStore();
    const fs = dirFs(shop);
    const bundle = {
      fs,
      clean: true,
      actor,
      commit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      ref: 'refs/heads/main',
      commitTime: '2026-11-19T04:00:00Z',
    };
    const a = clone(objects, 'w');
    expect((await a.sync({ bundle: { ...bundle, clean: false } })).snapshot).toBeNull();
    const r = await a.sync({ bundle });
    expect(r.snapshot).toMatch(/^rec_/);
    const [rec] = (await storeRecords(objects)).filter((x) => x.kind === 'bundle');
    expect(Schema.parse(rec)).toEqual(rec);
    if (rec?.kind !== 'bundle') throw new Error('no bundle record');
    expect(rec).toMatchObject({
      commit: bundle.commit,
      ref: bundle.ref,
      commit_time: bundle.commitTime,
      source: 'ci',
      actor,
    });
    const tar = (await createResultStore(objects).getBlob(rec.sha256))!;
    const entries = await unpackTar(tar);
    const names = entries.map((e) => e.header.name);
    expect(names).toContain('project.toml');
    expect(names).toEqual([...names].sort());
    expect(names.some((n) => n.startsWith('runs/') || n.startsWith('cache/') || n.startsWith('.'))).toBe(
      false,
    );
    expect(rec.files).toBe(names.length);
    expect(entries.every((e) => e.header.mtime?.getTime() === 0)).toBe(true);

    expect((await a.sync({ bundle })).snapshot).toBeNull();
    const b = clone(objects, 'w2');
    expect((await b.sync({ bundle })).snapshot).toBeNull(); // 同じ定義のスナップショットは取り込み済み
    await fs.write('README.md', '# changed\n');
    const changed = await a.sync({ bundle });
    expect(changed.snapshot).toMatch(/^rec_/);
    const recs = (await storeRecords(objects)).filter((x) => x.kind === 'bundle');
    expect(recs).toHaveLength(2);
    if (recs[0]?.kind === 'bundle' && recs[1]?.kind === 'bundle')
      expect(recs[0].definitions_hash).not.toBe(recs[1].definitions_hash);
  });
});

describe('watch', () => {
  it('a record written in clone A appears in clone B within seconds', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iw-watch-'));
    try {
      const objects = memoryObjectStore();
      const mk = (name: string) => ({
        replica: openReplica(join(dir, name)),
        store: createResultStore(objects),
        state: memoryStateStore(),
        projectId: PROJECT,
        writer: name,
      });
      const a = mk('a');
      const b = mk('b');
      const errors: unknown[] = [];
      const results: SyncResult[] = [];
      // A は onResult なし（それでも同期すること）、B は結果を集める
      const stopA = watch({ ...a, intervalMs: 100, onError: (e) => errors.push(e) });
      const stopB = watch({
        ...b,
        intervalMs: 100,
        onError: (e) => errors.push(e),
        onResult: (r) => results.push(r),
      });
      const run = runRecord();
      await openReplica(join(dir, 'a')).putRecord(run); // 別プロセスの書き手（レポーター）を真似る
      const started = Date.now();
      while (!(await b.replica.getRecord(run.id)) && Date.now() - started < 5000)
        await new Promise((r) => setTimeout(r, 50));
      await stopA();
      await stopB();
      expect(errors).toEqual([]);
      expect(results.some((r) => r.pulled.records === 1)).toBe(true);
      expect(await b.replica.getRecord(run.id)).toEqual(run);
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('helpers', () => {
  it('ulidFloor encodes the time with zero randomness', () => {
    const t = Date.parse('2026-11-19T04:13:40Z');
    expect(ulidFloor(t)).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}0{16}$/);
    expect(ulidTime(ulidFloor(t))).toBe(t);
    expect(ulidFloor(t) < ulidFloor(t + 1)).toBe(true);
  });

  it('fileStateStore keeps state per store under cache/sync/', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iw-state-'));
    try {
      const s = await fileStateStore(dir, 's3://shop-results/watch');
      expect(await s.load()).toEqual(emptyState());
      const state = {
        ...emptyState(),
        cursor: 'v1/log/01JF7Z9A2B4C6D8E0F2G4H6J8K.json',
        pushed: ['run_01JF7Z3K0W8N2Q4R6S8T0V2X4Y'],
      };
      await s.save(state);
      expect(await (await fileStateStore(dir, 's3://shop-results/watch')).load()).toEqual(state);
      expect(s.path).toMatch(/cache\/sync\/[0-9a-f]{16}\.json$/);
      expect((await fileStateStore(dir, 'file://../store')).path).not.toBe(s.path);
      const w = await writerId(dir);
      expect(w).toMatch(/^w_[0-9a-f]{24}$/);
      expect(await writerId(dir)).toBe(w);
      expect(await readFile(join(dir, 'cache', 'writer-id'), 'utf8')).toBe(`${w}\n`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
