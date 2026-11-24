/**
 * Cloudflare Workers entry used by `iw deploy`. Bindings: STORE (R2), DB (D1), ASSETS (static assets).
 * Vars: ACCESS_TEAM, ACCESS_AUD, STORE_PREFIX, SIGNING_KEYS, OIDC_REPOSITORIES, ROLES; secrets IW_SIGNING_KEY,
 * IW_SECRETS_KEY, IW_ACCESS_POLICY, CLOUDFLARE_API_TOKEN. CONTRACT; implementation T-107.
 * Definitions: the `file` records in workspace mode, else the latest bundle snapshot record
 * (docs/spec/sync.md#the-hosted-server-and-the-index);
 * records come from the D1 index, which catches up with the bucket in bounded steps.
 */
import type { Actor, AnyRecord, Bundle, BundleRecord } from '@indx-watch/bundle';
import {
  BundleRecord as BundleRecordSchema,
  loadBundle,
  newId,
  newUlid,
  Roles,
  recordSigner,
  SigningKey,
  sha256Hex,
  verifyRecord,
} from '@indx-watch/bundle';
import { buildVerifiedModel } from '@indx-watch/core';
import type { Index, ResultStore as Store, Trust } from '@indx-watch/store';
import * as S from '@indx-watch/store';
import { accessIdentity, d1Index, r2ObjectStore } from '@indx-watch/store/workers';
import { isoSeconds, snapshotBundle, ulidFloor, workspaceFiles } from '@indx-watch/sync';
import { unpackTar } from 'modern-tar';
import { createApp, HttpError, type ServerDeps } from './app.js';
import { githubOidcSigning, pinnedRepositories } from './oidc.js';
import type { ToolOutputs } from './tools.js';
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
  /** seals and opens `iw:` secrets (docs/spec/security.md#secrets) */
  IW_SECRETS_KEY?: string;
  /** JSON array of the [[signing_keys]] trusted for verification, pinned by `iw deploy`; never read from the bucket */
  SIGNING_KEYS?: string;
  /** JSON array of the GitHub repositories whose OIDC tokens get signatures, pinned by `iw deploy` */
  OIDC_REPOSITORIES?: string;
  /** JSON of `[hosting.roles]`, pinned by `iw deploy`; never read from the bucket (docs/spec/security.md#roles) */
  ROLES?: string;
  /** secrets `<account id>/<policy id>` and an API token: the Access policy of invites (docs/spec/security.md#customer-uat) */
  IW_ACCESS_POLICY?: string;
  CLOUDFLARE_API_TOKEN?: string;
}

/** The pinned roles; an invalid value lets nobody in. */
function pinnedRoles(env: Env): Roles | undefined {
  if (!env.ROLES) return undefined;
  try {
    return Roles.parse(JSON.parse(env.ROLES));
  } catch {
    return {};
  }
}

/** keys this much older than the cursor are listed again: writers may land a little out of order */
const LOOKBACK_MS = 15 * 60 * 1000;
/** how often the full listing of the log starts over */
const FULL_LISTING_EVERY_MS = 24 * 60 * 60 * 1000;
/** how long one isolate holds the ingest lease; `catchUp` releases it when done */
const LEASE_MS = 30_000;
/** the most log objects one `catchUp` reads */
const READS_PER_CALL = 50;
/** how often a request triggers a catch-up of the index */
const CATCH_UP_EVERY_MS = 5000;
const keyTime = (key: string) => S.ulidTime(key.slice(S.LOG_PREFIX.length));

const skipInvalid = (e: S.StoreError) => (e.code === 'invalid' ? null : Promise.reject(e));
type Each = (key: string) => Promise<boolean>;
/** `now` in epoch ms (default: the current time); `trust` verifies signed records while ingesting. */
type CatchUpOptions = { now?: number; trust?: Trust };
type IngestState = { cursor: string | null; seen: Set<string>; full: { at: number; after?: string } };

/** Page through the log after `after`: false as soon as `each` returns false, true at the end of the log. */
async function eachLogKey(store: Store, after: string | undefined, each: Each) {
  for (;;) {
    const page = await store.listLog(after ? { startAfter: after } : {});
    for (const key of page.keys) if (!(await each(key))) return false;
    if (!page.truncated || !page.keys.length) return true;
    after = page.keys.at(-1);
  }
}

/** The new keys since the cursor, minus the lookback window; advances the cursor. */
async function catchUpRecent(store: Store, st: IngestState, pull: Each) {
  const from = st.cursor
    ? S.LOG_PREFIX + ulidFloor(Math.max(0, keyTime(st.cursor) - LOOKBACK_MS))
    : undefined;
  await eachLogKey(store, from, async (key) => {
    if (st.seen.has(key)) return true;
    if (!(await pull(key))) return false;
    st.seen.add(key);
    st.cursor = !st.cursor || key > st.cursor ? key : st.cursor;
    return true;
  });
}

/** The daily full listing, resumed across calls until it reaches the end of the log. */
async function catchUpFull(store: Store, { cursor, seen, full }: IngestState, pull: Each, now: number) {
  if (!cursor || (full.after === undefined && now - full.at < FULL_LISTING_EVERY_MS)) return;
  full.after ??= '';
  const done = await eachLogKey(store, full.after || undefined, async (key) => {
    if (!seen.has(key) && !(await pull(key))) return false;
    full.after = key;
    return true;
  });
  if (done) [full.at, full.after] = [now, undefined];
}

/**
 * Pull new log objects of the store into the index: at most READS_PER_CALL per call, with a lookback window, cursor and lease
 * in the index meta, plus a daily full listing resumed across calls, so another body under an older key converges
 * as in clones (docs/spec/sync.md#the-hosted-server-and-the-index).
 */
export async function catchUp(
  store: Store,
  index: Index,
  owner: string,
  { now = Date.now(), trust }: CatchUpOptions = {},
) {
  const [holder, until] = ((await index.getMeta('ingest.lease')) ?? '').split(' ');
  if (holder && holder !== owner && Number(until) > now) return 0;
  await index.setMeta('ingest.lease', `${owner} ${now + LEASE_MS}`);
  try {
    const raw = JSON.parse((await index.getMeta('ingest.state')) ?? '{"cursor":null,"seen":[]}');
    const st: IngestState = { cursor: raw.cursor, seen: new Set(raw.seen), full: raw.full ?? { at: now } };
    let [read, added] = [0, 0];
    // false once the budget of reads is spent; an unreadable object is skipped, as in sync
    const pull = async (key: string) => {
      if (read++ >= READS_PER_CALL) return false;
      const log = await store.readLog(key).catch(skipInvalid);
      if (log) added += await index.ingest(log.records, key, trust);
      return true;
    };
    await catchUpRecent(store, st, pull);
    await catchUpFull(store, st, pull, now);
    const cap = `${S.LOG_PREFIX}${ulidFloor(now)}.json`;
    const cursor = st.cursor && st.cursor > cap ? cap : st.cursor;
    const floor = cursor ? keyTime(cursor) - LOOKBACK_MS : 0;
    const state = { cursor, seen: [...st.seen].filter((k) => keyTime(k) >= floor), full: st.full };
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

async function openSnapshot(store: Store, snap: BundleRecord, files: Map<string, Uint8Array>) {
  const tar = (await store.getBlob(snap.sha256)) ?? fail(`snapshot blob ${snap.sha256} is missing`);
  const entries = (await unpackTar(tar)).filter((e) => (e.header.type ?? 'file') === 'file');
  return openFiles(
    snap.id,
    new Map(entries.map((e) => [e.header.name, new Uint8Array(e.data ?? [])])),
    files,
  );
}

/** Load definition files into the view's files. */
async function openFiles(id: string, from: Map<string, Uint8Array>, files: Map<string, Uint8Array>) {
  files.clear();
  for (const [path, data] of from) files.set(path, data);
  const { bundle, problems } = await loadBundle(memoryBundleFs(files));
  return { id, bundle: bundle ?? fail(problems[0]?.message ?? 'snapshot has no project'), problems };
}

/** Workspace mode: the current content of the `file` records (docs/spec/sync.md#workspace-mode-v02). */
async function openWorkspace(store: Store, records: AnyRecord[], view: View): Promise<Snapshot> {
  if (view.blobs.size > 5000) view.blobs.clear();
  const read = async (sha: string) => {
    const data = view.blobs.get(sha) ?? (await store.getBlob(sha));
    if (data) view.blobs.set(sha, data);
    return data;
  };
  const { files, warnings } = await workspaceFiles(records, read);
  const s = await openFiles('workspace', files, view.files);
  return {
    ...s,
    problems: [...s.problems, ...warnings.map((message) => ({ severity: 'warning', message }))],
  };
}

/** the vars an isolate's state depends on */
const STATE_VARS =
  'STORE_PREFIX ACCESS_TEAM ACCESS_AUD PUBLIC IW_SIGNING_KEY IW_SECRETS_KEY SIGNING_KEYS OIDC_REPOSITORIES ROLES'.split(
    ' ',
  );
function setup(env: Env, outputs?: ToolOutputs): State {
  const key = STATE_VARS.map((k) => env[k as keyof Env]).join('|');
  const existing = states.get(env.STORE as object);
  const s = existing?.key === key ? existing : create(env, key, outputs);
  states.set(env.STORE as object, s);
  return s;
}

/** The trust root comes from the deploy, never from a snapshot: anyone who can write the store can publish one. */
function pinnedKeys(env: Env) {
  let json: unknown;
  try {
    json = JSON.parse(env.SIGNING_KEYS || '[]');
  } catch (e) {
    // JSON.parse only throws SyntaxError: leave `json` undefined so it fails the schema check below and is
    // reported as a warning on every model instead of failing requests
    if (!(e instanceof SyntaxError)) throw e;
  }
  const pinned = SigningKey.array().safeParse(json);
  const keys = pinned.success ? pinned.data : [];
  const trust = keys.length ? (r: AnyRecord) => verifyRecord(r, keys) : undefined;
  return { valid: pinned.success, keys, trust };
}
type Pinned = ReturnType<typeof pinnedKeys>;

const UNPINNED =
  'SIGNING_KEYS of this deploy is invalid or misses keys the snapshot lists: run `iw deploy` to pin them';
/** Model warnings, index conflicts and keys the snapshot lists that this deploy does not pin, as problems. */
async function warningProblems(index: Index, bundle: Bundle, { valid, keys }: Pinned, warnings: string[]) {
  const conflicts = Object.values(JSON.parse((await index.getMeta(S.CONFLICTS_META)) ?? '{}')) as string[];
  const listed = bundle.project.data.signing_keys ?? [];
  const unpinned = !valid || listed.some((k) => !keys.some((p) => p.public_key === k.public_key));
  const all = [...warnings, ...conflicts, ...(unpinned ? [UNPINNED] : [])];
  return all.map((message) => ({ severity: 'warning', message }));
}

/** the newest snapshot opened so far and its files */
type View = { files: Map<string, Uint8Array>; snapshot?: Snapshot; blobs: Map<string, Uint8Array> };
/** The model of the newest snapshot over the indexed records; opens the snapshot when it changed. */
async function snapshotModel(store: Store, index: Index, pinned: Pinned, view: View): Promise<Loaded> {
  const records = await index.records();
  if (records.some((r) => r.kind === 'file')) view.snapshot = await openWorkspace(store, records, view);
  const bundles = records.filter((r): r is BundleRecord => r.kind === 'bundle');
  const latest = bundles.sort((a, b) => (order(a) < order(b) ? 1 : -1))[0];
  const workspace = view.snapshot?.id === 'workspace';
  if (!latest && !workspace) fail('No bundle snapshot yet: run `iw sync --snapshot` on the default branch.');
  if (!workspace && view.snapshot?.id !== latest!.id)
    view.snapshot = await openSnapshot(store, latest!, view.files);
  const { bundle, problems } = view.snapshot!;
  const project = { ...bundle.project, data: { ...bundle.project.data, signing_keys: pinned.keys } };
  const { model, warnings } = await buildVerifiedModel({ ...bundle, project }, records);
  return { model, problems: [...problems, ...(await warningProblems(index, bundle, pinned, warnings))] };
}

/** What the model of an isolate is loaded from. */
type Source = { store: Store; index: Index; pinned: Pinned; view: View; ingested: { at: number } };
/**
 * The model, after catching up with the bucket (as lease `owner`) at most every CATCH_UP_EVERY_MS; cached until the
 * index changes.
 */
function modelLoader({ store, index, pinned, view, ingested }: Source, owner: string) {
  let cache: { rev: string; value: Loaded } | undefined;
  return async (): Promise<Loaded> => {
    if (Date.now() - ingested.at >= CATCH_UP_EVERY_MS) {
      ingested.at = Date.now();
      // best effort: a failed catch-up (lease, bucket or D1 error) serves the records indexed so far; the next
      // request or the scheduled run retries
      await catchUp(store, index, owner, { trust: pinned.trust }).catch(() => 0);
    }
    const rev = (await index.getMeta('records.rev')) ?? '';
    if (cache?.rev !== rev) cache = { rev, value: await snapshotModel(store, index, pinned, view) };
    return cache.value;
  };
}

function create(env: Env, key: string, toolOutputs?: ToolOutputs) {
  const objects = r2ObjectStore(env.STORE, env.STORE_PREFIX);
  const [store, index] = [S.createResultStore(objects), d1Index(env.DB)];
  const access = env.ACCESS_TEAM && env.ACCESS_AUD ? { team: env.ACCESS_TEAM, aud: env.ACCESS_AUD } : null;
  // a public deploy is read-only: anonymous viewers, no secrets (docs/spec/security.md#public-deploys)
  const open = env.PUBLIC === 'true';
  const identity = open ? anon : access && accessIdentity(access);
  const [ingested, pinned, owner] = [{ at: 0 }, pinnedKeys(env), newUlid()];
  const { trust } = pinned;
  const view: View = { files: new Map(), blobs: new Map() };
  const ingest = async (records: AnyRecord[], key?: string) => {
    if (await index.ingest(records, key, trust)) await index.setMeta('records.rev', newUlid());
  };
  const loadModel = modelLoader({ store, index, pinned, view, ingested }, owner);

  const deps: ServerDeps = {
    mode: 'hosted',
    loadModel,
    // read on each write: a malformed key fails the write, not every request (reads, /healthz, catch-up)
    signRecord: (record) => recordSigner(env.IW_SIGNING_KEY)(record),
    writeRecord: async (record) => {
      const signed = await deps.signRecord!(record);
      const [key] = await store.appendLog('hosted', [signed]);
      await ingest([signed], key);
    },
    putBlob: (data, type) => sha256Hex(data).then((sha) => store.putBlob(sha, data, type).then(() => sha)),
    getBlob: (sha) => store.getBlob(sha),
    identity: identity ?? anon,
    roles: open ? { default: 'viewer' } : identity ? pinnedRoles(env) : undefined,
    readOnly: open,
    secretsKey: open ? undefined : env.IW_SECRETS_KEY,
    accessPolicy: S.cloudflareAccessPolicy(env as unknown as Record<string, string | undefined>),
    objects,
    onLogObject: async (key) => void (await ingest((await store.readLog(key)).records, key)),
    syncInfo: () => ({ configured: true, store: objects.url, lastSyncAt: new Date(ingested.at).toJSON() }),
    assets: (request) => env.ASSETS.fetch(request),
    readFile: async (path) => view.files.get(path) ?? null,
    records: () => index.records(),
    bundleFiles: async () => {
      await loadModel().catch(() => undefined); // opens the newest snapshot; none yet → empty
      return new Map(view.files);
    },
    publishBundle: (next, info) => publish(store, deps, next, info),
    signForGithub: githubOidcSigning({
      verifier: S.githubOidcVerifier(),
      repositories: pinnedRepositories(env.OIDC_REPOSITORIES),
      secret: env.IW_SIGNING_KEY,
    }),
    toolOutputs,
  };
  return { key, app: createApp(deps), store, index, open: !!identity, owner, ingested, trust };
}

/** A browser upload becomes a snapshot like `iw push` (docs/spec/sync.md#snapshots-from-people-v02). */
async function publish(
  store: Store,
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

/** The Worker; `/mcp` is served only with the tools' output schemas (packages/cli/src/worker.ts passes them). */
export function createWorker(outputs?: ToolOutputs) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const s = setup(env, outputs);
      if (s.open || new URL(request.url).pathname === '/healthz') return s.app.fetch(request);
      const message = 'Cloudflare Access is not configured (ACCESS_TEAM and ACCESS_AUD)';
      return Response.json({ error: { code: 'unauthorized', message } }, { status: 401 });
    },
    async scheduled(_event: unknown, env: Env): Promise<void> {
      const s = setup(env, outputs);
      s.ingested.at = Date.now();
      await catchUp(s.store, s.index, s.owner, { trust: s.trust });
    },
  };
}
export default createWorker();
