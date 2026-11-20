/**
 * Cloudflare Workers entry used by `iw deploy`. Bindings: STORE (R2), DB (D1), ASSETS (static assets).
 * Vars: ACCESS_TEAM, ACCESS_AUD, PROJECT_ID, STORE_PREFIX, SIGNING_KEYS; secret IW_SIGNING_KEY. CONTRACT; implementation T-107.
 * Definitions: the latest bundle snapshot record (docs/spec/sync.md#the-hosted-server-and-the-index);
 * records come from the D1 index, which catches up with the bucket in bounded steps.
 */
import type { Actor, AnyRecord, Bundle, BundleRecord } from '@indx-watch/bundle';
import {
  BundleRecord as BundleRecordSchema,
  loadBundle,
  newId,
  newUlid,
  recordSigner,
  SigningKey,
  sha256Hex,
  verifyRecord,
} from '@indx-watch/bundle';
import { buildVerifiedModel } from '@indx-watch/core';
import * as S from '@indx-watch/store';
import { accessIdentity, d1Index, r2ObjectStore } from '@indx-watch/store/workers';
import { isoSeconds, snapshotBundle, ulidFloor } from '@indx-watch/sync';
import { unpackTar } from 'modern-tar';
import { createApp, HttpError, type ServerDeps } from './app.js';
import { memoryBundleFs } from './upload.js';

export { memoryBundleFs };

export interface Env {
  STORE: unknown;
  DB: unknown;
  ASSETS: { fetch(request: Request): Promise<Response> };
  ACCESS_TEAM?: string;
  ACCESS_AUD?: string;
  STORE_PREFIX?: string;
  /** 'true' only for deploys made with --public */
  PUBLIC?: string;
  /** signs every record this server writes (docs/spec/security.md#signed-records) */
  IW_SIGNING_KEY?: string;
  /** JSON array of the [[signing_keys]] trusted for verification, pinned by `iw deploy`; never read from the bucket */
  SIGNING_KEYS?: string;
}

const LOOKBACK = 15 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const keyTime = (key: string) => S.ulidTime(key.slice(S.LOG_PREFIX.length));

/**
 * Pull new log objects of the store into the index: at most 50 per call, with a lookback window, cursor and lease
 * in the index meta, plus a daily full listing resumed across calls, so another body under an older key converges
 * as in clones (docs/spec/sync.md#the-hosted-server-and-the-index).
 */
export async function catchUp(
  store: S.ResultStore,
  index: S.Index,
  owner: string,
  now = Date.now(),
  trust?: S.Trust,
) {
  const [holder, until] = ((await index.getMeta('ingest.lease')) ?? '').split(' ');
  if (holder && holder !== owner && Number(until) > now) return 0;
  await index.setMeta('ingest.lease', `${owner} ${now + 30_000}`);
  try {
    const st = JSON.parse((await index.getMeta('ingest.state')) ?? '{"cursor":null,"seen":[]}');
    const seen = new Set<string>(st.seen);
    const full: { at: number; after?: string } = st.full ?? { at: now };
    let cursor: string | null = st.cursor;
    let [read, added] = [0, 0];
    // false once the budget of 50 reads is spent; an unreadable object is skipped, as in sync
    const pull = async (key: string) => {
      if (read++ >= 50) return false;
      const log = await store
        .readLog(key)
        .catch((e: S.StoreError) => (e.code === 'invalid' ? null : Promise.reject(e)));
      if (log) added += await index.ingest(log.records, key, trust);
      return true;
    };
    const list = async (after: string | undefined, each: (key: string) => Promise<boolean>) => {
      for (;;) {
        const page = await store.listLog(after ? { startAfter: after } : {});
        for (const key of page.keys) if (!(await each(key))) return false;
        if (!page.truncated || !page.keys.length) return true;
        after = page.keys.at(-1);
      }
    };
    const from = cursor ? `${S.LOG_PREFIX}${ulidFloor(Math.max(0, keyTime(cursor) - LOOKBACK))}` : undefined;
    await list(from, async (key) => {
      if (seen.has(key)) return true;
      if (!(await pull(key))) return false;
      seen.add(key);
      cursor = !cursor || key > cursor ? key : cursor;
      return true;
    });
    if (cursor && (full.after !== undefined || now - full.at >= DAY)) {
      full.after ??= '';
      const done = await list(full.after || undefined, async (key) => {
        if (!seen.has(key) && !(await pull(key))) return false;
        full.after = key;
        return true;
      });
      if (done) [full.at, full.after] = [now, undefined];
    }
    const cap = `${S.LOG_PREFIX}${ulidFloor(now)}.json`;
    cursor = cursor && cursor > cap ? cap : cursor;
    const floor = cursor ? keyTime(cursor) - LOOKBACK : 0;
    const state = { cursor, seen: [...seen].filter((k) => keyTime(k) >= floor), full };
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
type Snapshot = { id: string; bundle: Bundle; problems: Loaded['problems'] };
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
  const key = [
    env.STORE_PREFIX,
    env.ACCESS_TEAM,
    env.ACCESS_AUD,
    env.PUBLIC,
    env.IW_SIGNING_KEY,
    env.SIGNING_KEYS,
  ].join('|');
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
  // read on each write: a malformed key fails the write, not every request (reads, /healthz, catch-up)
  const sign = (r: AnyRecord) => recordSigner(env.IW_SIGNING_KEY)(r);
  // the trust root comes from the deploy, never from a snapshot: anyone who can write the store can publish one
  const pinned = SigningKey.array().safeParse(
    (() => {
      try {
        return JSON.parse(env.SIGNING_KEYS || '[]');
      } catch {}
    })(),
  );
  const keys = pinned.success ? pinned.data : [];
  const trust = keys.length ? (r: AnyRecord) => verifyRecord(r, keys) : undefined;
  const files = new Map<string, Uint8Array>();
  let snapshot: Snapshot | undefined;
  let cache: { rev: string; value: Loaded } | undefined;
  const ingest = async (records: AnyRecord[], key?: string) => {
    if (await index.ingest(records, key, trust)) await index.setMeta('records.rev', newUlid());
  };

  const loadModel = async (): Promise<Loaded> => {
    if (Date.now() - ingested.at >= 5000) {
      ingested.at = Date.now();
      await catchUp(store, index, s.owner, Date.now(), trust).catch(() => 0);
    }
    const rev = (await index.getMeta('records.rev')) ?? '';
    if (cache?.rev === rev) return cache.value;
    const records = await index.records();
    const bundles = records.filter((r): r is BundleRecord => r.kind === 'bundle');
    const latest = bundles.sort((a, b) => (order(a) < order(b) ? 1 : -1))[0];
    if (!latest) fail('No bundle snapshot yet: run `iw sync --snapshot` on the default branch.');
    if (snapshot?.id !== latest.id) snapshot = await openSnapshot(store, latest, files);
    const { bundle } = snapshot;
    const project = { ...bundle.project, data: { ...bundle.project.data, signing_keys: keys } };
    const { model, warnings } = await buildVerifiedModel({ ...bundle, project }, records);
    const conflicts = Object.values(JSON.parse((await index.getMeta(S.CONFLICTS_META)) ?? '{}')) as string[];
    const untrusted =
      !pinned.success ||
      bundle.project.data.signing_keys?.some((k) => !keys.some((p) => p.public_key === k.public_key))
        ? [
            'SIGNING_KEYS of this deploy is invalid or misses keys the snapshot lists: run `iw deploy` to pin them',
          ]
        : [];
    const more = [...warnings, ...conflicts, ...untrusted].map((message) => ({
      severity: 'warning',
      message,
    }));
    const problems = [...snapshot.problems, ...more];
    cache = { rev, value: { model, problems } };
    return cache.value;
  };

  const deps: ServerDeps = {
    mode: 'hosted',
    loadModel,
    writeRecord: async (record) => {
      const signed = await sign(record);
      const [key] = await store.appendLog('hosted', [signed]);
      await ingest([signed], key);
    },
    putBlob: (data, type) => sha256Hex(data).then((sha) => store.putBlob(sha, data, type).then(() => sha)),
    getBlob: (sha) => store.getBlob(sha),
    identity: identity ?? anon,
    objects,
    onLogObject: async (key) => void (await ingest((await store.readLog(key)).records, key)),
    syncInfo: () => ({ configured: true, store: objects.url, lastSyncAt: new Date(ingested.at).toJSON() }),
    assets: (request) => env.ASSETS.fetch(request),
    readFile: async (path) => files.get(path) ?? null,
    declaredIdentity: env.PUBLIC === 'true',
    bundleFiles: async () => {
      await loadModel().catch(() => undefined); // opens the newest snapshot; none yet → empty
      return new Map(files);
    },
    publishBundle: (next, info) => publish(store, deps, next, info),
  };
  const s = { key, app: createApp(deps), store, index, open: !!identity, owner: newUlid(), ingested, trust };
  return s;
}

/** A browser upload becomes a snapshot like `iw push` (docs/spec/sync.md#snapshots-from-people-v02). */
async function publish(
  store: S.ResultStore,
  deps: ServerDeps,
  files: Map<string, Uint8Array>,
  info: { actor: Actor; message?: string },
) {
  const fs = memoryBundleFs(new Map(files));
  const [snap, { bundle }] = [await snapshotBundle(fs), await loadBundle(fs)];
  const project = bundle?.project.data.id ?? fail('the upload has no valid project.toml');
  await store.init(project);
  const [sha, at] = [await deps.putBlob(snap.tar, 'application/x-tar'), isoSeconds(Date.now())];
  const record = BundleRecordSchema.parse({
    ...{ kind: 'bundle', id: newId('rec'), v: 1, project, at, actor: info.actor, source: 'manual' },
    ...{
      commit_time: at,
      sha256: sha,
      definitions_hash: snap.hash,
      files: snap.files,
      message: info.message,
    },
  });
  await deps.writeRecord(record);
  return record.id;
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
    await catchUp(s.store, s.index, s.owner, Date.now(), s.trust);
  },
};
