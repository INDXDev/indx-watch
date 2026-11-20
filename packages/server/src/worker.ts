/**
 * Cloudflare Workers entry used by `iw deploy`. Bindings: STORE (R2), DB (D1), ASSETS (static assets).
 * Vars: ACCESS_TEAM, ACCESS_AUD, PROJECT_ID, STORE_PREFIX. CONTRACT; implementation T-107.
 * Definitions: the latest bundle snapshot record (docs/spec/sync.md#the-hosted-server-and-the-index);
 * records come from the D1 index, which catches up with the bucket in bounded steps.
 */
import type { AnyRecord, BundleFs, BundleRecord } from '@indx-watch/bundle';
import { loadBundle, newUlid, sha256Hex } from '@indx-watch/bundle';
import { buildModel } from '@indx-watch/core';
import * as S from '@indx-watch/store';
import { accessIdentity, d1Index, r2ObjectStore } from '@indx-watch/store/workers';
import { ulidFloor } from '@indx-watch/sync';
import { unpackTar } from 'modern-tar';
import { createApp, HttpError, type ServerDeps } from './app.js';

export interface Env {
  STORE: unknown;
  DB: unknown;
  ASSETS: { fetch(request: Request): Promise<Response> };
  ACCESS_TEAM?: string;
  ACCESS_AUD?: string;
  STORE_PREFIX?: string;
  /** 'true' only for deploys made with --public */
  PUBLIC?: string;
}

/** BundleFs over a map of paths (a bundle snapshot unpacked in memory). */
export function memoryBundleFs(files: Map<string, Uint8Array>): BundleFs {
  const children = (dir: string) => {
    const prefix = dir ? `${dir.replace(/\/+$/, '')}/` : '';
    const inside = [...files.keys()].filter((k) => k.startsWith(prefix));
    const parts = inside.map((k) => k.slice(prefix.length).split('/'));
    return new Map(parts.map(([n = '', ...r]) => [n, r.length > 0]));
  };
  return {
    read: async (p) => files.get(p) ?? null,
    write: async (p, d) => void files.set(p, typeof d === 'string' ? new TextEncoder().encode(d) : d),
    remove: async (p) => {
      for (const k of files.keys()) if (k === p || k.startsWith(`${p}/`)) files.delete(k);
    },
    list: async (dir) => [...children(dir)].sort().map(([name, d]) => ({ name, dir: d })),
  };
}

const LOOKBACK = 15 * 60 * 1000;
const keyTime = (key: string) => S.ulidTime(key.slice(S.LOG_PREFIX.length));

/**
 * Pull new log objects of the store into the index: at most 50 per call, with a lookback window,
 * cursor and lease in the index meta (docs/spec/sync.md#the-hosted-server-and-the-index).
 */
export async function catchUp(store: S.ResultStore, index: S.Index, owner: string, now = Date.now()) {
  const [holder, until] = ((await index.getMeta('ingest.lease')) ?? '').split(' ');
  if (holder && holder !== owner && Number(until) > now) return 0;
  await index.setMeta('ingest.lease', `${owner} ${now + 30_000}`);
  try {
    const st = JSON.parse((await index.getMeta('ingest.state')) ?? '{"cursor":null,"seen":[]}');
    const seen = new Set<string>(st.seen);
    let cursor: string | null = st.cursor;
    let after = cursor ? `${S.LOG_PREFIX}${ulidFloor(Math.max(0, keyTime(cursor) - LOOKBACK))}` : undefined;
    let [read, added] = [0, 0];
    pages: for (;;) {
      const page = await store.listLog(after ? { startAfter: after } : {});
      for (const key of page.keys.filter((k) => !seen.has(k))) {
        if (read++ >= 50) break pages;
        added += await index.ingest((await store.readLog(key)).records);
        seen.add(key);
        cursor = !cursor || key > cursor ? key : cursor;
      }
      if (!page.truncated || !page.keys.length) break;
      after = page.keys.at(-1);
    }
    const cap = `${S.LOG_PREFIX}${ulidFloor(now)}.json`;
    cursor = cursor && cursor > cap ? cap : cursor;
    const floor = cursor ? keyTime(cursor) - LOOKBACK : 0;
    const state = { cursor, seen: [...seen].filter((k) => keyTime(k) >= floor) };
    await index.setMeta('ingest.state', JSON.stringify(state));
    if (added) await index.setMeta('records.rev', newUlid(now));
    return added;
  } finally {
    await index.setMeta('ingest.lease', '');
  }
}

/** Latest snapshot: by commit_time, then at, then id. */
const order = (r: BundleRecord) => `${r.commit_time ?? ''}|${r.at}|${r.id}`;
type Loaded = Awaited<ReturnType<ServerDeps['loadModel']>>;
type Snapshot = { id: string; bundle: Parameters<typeof buildModel>[0]; problems: Loaded['problems'] };
type State = ReturnType<typeof create>;
/** per isolate, by R2 binding */
const states = new WeakMap<object, State>();
const anon: S.IdentityProvider = { current: async () => ({ kind: 'human', id: 'anonymous', via: 'env' }) };

async function openSnapshot(store: S.ResultStore, snap: BundleRecord, files: Map<string, Uint8Array>) {
  const tar = (await store.getBlob(snap.sha256)) ?? fail(`snapshot blob ${snap.sha256} is missing`);
  files.clear();
  for (const e of await unpackTar(tar))
    if ((e.header.type ?? 'file') === 'file') files.set(e.header.name, new Uint8Array(e.data ?? []));
  const { bundle, problems } = await loadBundle(memoryBundleFs(files));
  return { id: snap.id, bundle: bundle ?? fail(problems[0]?.message ?? 'snapshot has no project'), problems };
}

function setup(env: Env): State {
  const key = [env.STORE_PREFIX, env.ACCESS_TEAM, env.ACCESS_AUD, env.PUBLIC].join('|');
  const existing = states.get(env.STORE as object);
  const s = existing?.key === key ? existing : create(env, key);
  states.set(env.STORE as object, s);
  return s;
}

function create(env: Env, key: string) {
  const objects = r2ObjectStore(env.STORE, env.STORE_PREFIX);
  const [store, index] = [S.createResultStore(objects), d1Index(env.DB)];
  const access = env.ACCESS_TEAM && env.ACCESS_AUD ? { team: env.ACCESS_TEAM, aud: env.ACCESS_AUD } : null;
  const identity = env.PUBLIC === 'true' ? anon : access && accessIdentity(access);
  const ingested = { at: 0 };
  const files = new Map<string, Uint8Array>();
  let snapshot: Snapshot | undefined;
  let cache: { rev: string; value: Loaded } | undefined;
  const ingest = async (records: AnyRecord[]) => {
    if (await index.ingest(records)) await index.setMeta('records.rev', newUlid());
  };

  const loadModel = async (): Promise<Loaded> => {
    if (Date.now() - ingested.at >= 5000) {
      ingested.at = Date.now();
      await catchUp(store, index, s.owner).catch(() => 0);
    }
    const rev = (await index.getMeta('records.rev')) ?? '';
    if (cache?.rev === rev) return cache.value;
    const records = await index.records();
    const bundles = records.filter((r): r is BundleRecord => r.kind === 'bundle');
    const latest = bundles.sort((a, b) => (order(a) < order(b) ? 1 : -1))[0];
    if (!latest) fail('No bundle snapshot yet: run `iw sync --snapshot` on the default branch.');
    if (snapshot?.id !== latest.id) snapshot = await openSnapshot(store, latest, files);
    const { model, warnings } = buildModel(snapshot.bundle, records);
    const problems = [...snapshot.problems, ...warnings.map((message) => ({ severity: 'warning', message }))];
    cache = { rev, value: { model, problems } };
    return cache.value;
  };

  const deps: ServerDeps = {
    mode: 'hosted',
    loadModel,
    writeRecord: (record) => store.appendLog('hosted', [record]).then(() => ingest([record])),
    putBlob: (data, type) => sha256Hex(data).then((sha) => store.putBlob(sha, data, type).then(() => sha)),
    getBlob: (sha) => store.getBlob(sha),
    identity: identity ?? anon,
    objects,
    onLogObject: async (key) => void (await ingest((await store.readLog(key)).records)),
    syncInfo: () => ({ configured: true, store: objects.url, lastSyncAt: new Date(ingested.at).toJSON() }),
    assets: (request) => env.ASSETS.fetch(request),
    readFile: async (path) => files.get(path) ?? null,
  };
  const s = { key, app: createApp(deps), store, index, open: !!identity, owner: newUlid(), ingested };
  return s;
}

function fail(message: string): never {
  throw new HttpError(503, 'no-snapshot', message);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const s = setup(env);
    if (s.open || new URL(request.url).pathname === '/healthz') return s.app.fetch(request);
    const message = 'Cloudflare Access is not configured (ACCESS_TEAM and ACCESS_AUD)';
    return Response.json({ error: { code: 'unauthorized', message } }, { status: 401 });
  },
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const s = setup(env);
    s.ingested.at = Date.now();
    await catchUp(s.store, s.index, s.owner);
  },
};
