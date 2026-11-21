/**
 * Node entry used by `iw serve`: the web UI, the API over a bundle directory and its replica, and background sync.
 * CONTRACT: signatures frozen; implementation T-107.
 */
import { watch as fsWatch } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type HttpBindings, serve } from '@hono/node-server';
import { type AnyRecord, BundleError, loadBundle, recordSigner } from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { buildVerifiedModel, type Model } from '@indx-watch/core';
import { createResultStore, type IdentityProvider, type ResultStore, StoreError } from '@indx-watch/store';
import * as SN from '@indx-watch/store/node';
import { definitionFiles, type SyncResult, watch as syncWatch } from '@indx-watch/sync';
import { fileStateStore, writerId } from '@indx-watch/sync/node';
import { createApp, type ServerDeps } from './app.js';
import type { ProjectInfo } from './contract.js';
import type { ToolOutputs } from './tools.js';

export interface NodeServerOptions {
  /** bundle directory (.indx-watch) */
  dir: string;
  port?: number;
  host?: string;
  /** run sync in the background when a store is configured */
  sync?: boolean;
  /** directory with the built SPA (index.html); defaults to the packaged web build */
  webRoot?: string;
  /**
   * Trusted proxy header carrying the user's email (e.g. X-Forwarded-Email from an SSO proxy).
   * Without it, write requests from non-loopback addresses are rejected (docs/spec/security.md#shared-servers).
   */
  identityHeader?: string;
  /** the MCP tools' output schemas (CommandData); `/mcp` is served only with them */
  toolOutputs?: ToolOutputs;
  /** read records through the node:sqlite index in cache/index.sqlite (default); false reads every replica file */
  index?: boolean;
}

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;
/** port of `iw serve` without --port */
const DEFAULT_PORT = 4321;
/** quiet time after the last bundle edit before the model is rebuilt (an editor save touches several files) */
const REBUILD_DELAY_MS = 150;
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript' };
Object.assign(TYPES, { '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Static SPA files with index.html fallback; dot- and underscore-files are not served. */
export function staticAssets(root: string): (request: Request) => Promise<Response> {
  const base = resolve(root);
  return async (request) => {
    const path = decodeURIComponent(new URL(request.url).pathname);
    const file = normalize(join(base, path));
    const hidden = path.split('/').some((p) => p.startsWith('.') || p.startsWith('_'));
    const ok = !hidden && file.startsWith(base + sep) && (await stat(file).catch(() => null))?.isFile();
    const served = ok ? file : join(base, 'index.html');
    const data = await readFile(served).catch(() => null);
    if (!data) return new Response('Web UI not built: run `pnpm build`', { status: 404 });
    const cache = served.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
    const type = TYPES[extname(served)] ?? 'application/octet-stream';
    return new Response(data, { headers: { 'Content-Type': type, 'Cache-Control': cache } });
  };
}

/** Writes from non-loopback clients need a trusted identity header (docs/spec/security.md#shared-servers). */
export function writeGuard(method: string, address: string, identityHeader?: string): Response | undefined {
  if (READS.has(method) || LOOPBACK.test(address) || identityHeader) return undefined;
  const error = { code: 'forbidden', message: 'writes from other machines need --identity-header' };
  return Response.json({ error }, { status: 403 });
}

/**
 * A server bound to loopback answers only requests addressed to loopback names (DNS rebinding:
 * docs/spec/security.md#browser-requests).
 */
export function hostGuard(host: string | null, port: number): Response | undefined {
  if (new RegExp(`^(localhost|127\\.0\\.0\\.1|\\[::1\\]):${port}$`, 'i').test(host ?? '')) return undefined;
  const error = { code: 'forbidden', message: `unexpected Host ${host}: open http://127.0.0.1:${port}` };
  return Response.json({ error }, { status: 403 });
}

/**
 * Identity per request: the trusted proxy header when configured and present, the process identity for
 * loopback clients, otherwise read-only guests (writes are refused before they reach the app).
 */
export function requestIdentity(remote: WeakMap<Request, string>, local: IdentityProvider, header?: string) {
  const provider: IdentityProvider = {
    async current(request) {
      const email = header ? request?.headers.get(header)?.trim() : undefined;
      if (email) return { kind: 'human', id: email, via: 'env' };
      if (request && LOOPBACK.test(remote.get(request) ?? '')) return local.current();
      const write = request && !READS.has(request.method);
      if (header && write) throw new StoreError('unauthorized', `missing ${header}`);
      return { kind: 'human', id: 'guest', name: 'Guest (read-only)', via: 'env' };
    },
  };
  return provider;
}

type Server = { url: string; close(): Promise<void> };
/** Per-directory state of a local server; `state` and `store` exist once sync is configured. */
interface Local {
  dir: string;
  fs: ReturnType<typeof nodeFs>;
  replica: ReturnType<typeof SN.openReplica>;
  /** the replica's records, through the index when it opens (docs/spec/cli.md#iw-serve) */
  records: ReturnType<typeof SN.openReplica>['records'];
  sync: ProjectInfo['sync'];
  remote: WeakMap<Request, string>;
  state?: Awaited<ReturnType<typeof fileStateStore>>;
  store?: ResultStore;
}
type Models = ReturnType<typeof modelCache>;
type App = ReturnType<typeof createApp>;

/** Serve a bundle directory: the web UI, the API and, when [store] is configured, background sync. */
export async function startNodeServer(opts: NodeServerOptions): Promise<Server> {
  const dir = resolve(opts.dir);
  const [sync, remote] = [{ configured: false }, new WeakMap<Request, string>()];
  const replica = SN.openReplica(dir);
  const records = opts.index === false ? replica.records : await indexedRecords(dir, replica);
  const l: Local = { dir, fs: nodeFs(dir), replica, records, sync, remote };
  const models = modelCache(l);
  const { model: m0 } = await models.loadModel();
  const stopSync = await startSync(l, m0, opts.sync !== false, models.invalidate);
  const app = createApp(nodeDeps(l, models, opts, m0.project.store?.evidence));
  return listen(l, app, opts, () => Promise.all([models.close(), stopSync?.()]));
}

/** Replica records through cache/index.sqlite; without a usable index (or after an index error), every file is read. */
async function indexedRecords(dir: string, replica: Local['replica']): Promise<Local['records']> {
  const index = await SN.openNodeIndex(dir).catch(() => null);
  const read = index && SN.indexedRecords(index, join(dir, 'runs'));
  return async (onInvalid) => {
    const bad: [string, string][] = []; // passed on only when the read succeeds, so a fallback never reports twice
    const r = read && (await read((f, e) => bad.push([f, e])).catch(() => null));
    for (const [f, e] of r ? bad : []) onInvalid?.(f, e);
    return r ?? replica.records(onInvalid);
  };
}

/** The cached model, rebuilt after bundle edits (debounced) and replica writes. */
function modelCache(l: Local) {
  const cache: { model?: ReturnType<ServerDeps['loadModel']> } = {};
  // the model of the bundle and the replica; invalid records and sync conflicts become warnings
  const build = async () => {
    const { bundle, problems } = await loadBundle(l.fs);
    const shown: ProjectInfo['problems'] = problems.map((p) => ({ ...p, path: undefined, code: undefined }));
    if (!bundle) throw new StoreError('invalid', shown[0]?.message ?? `no bundle in ${l.dir}`);
    const records = await l.records((file, error) =>
      shown.push({ severity: 'warning', message: `invalid record: ${error}`, file: `runs/${file}` }),
    );
    const { model, warnings } = await buildVerifiedModel(bundle, records);
    // records the store has two bodies of (docs/spec/sync.md#merge-rules)
    const conflicts = Object.values((await l.state?.load())?.conflicts ?? {});
    const more = [...warnings, ...conflicts].map((message) => ({ severity: 'warning', message }));
    return { model, problems: [...shown, ...more] };
  };
  const invalidate = () => delete cache.model;
  const loadModel = () => (cache.model ??= build().catch((e) => rethrow(e, invalidate())));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = (_e: unknown, name: unknown) => {
    if (/^(runs|cache)([/\\]|$)/.test(String(name ?? ''))) return;
    clearTimeout(timer);
    timer = setTimeout(invalidate, REBUILD_DELAY_MS);
  };
  // a watcher error (the directory went away, too many watches) only stops live reload: the model still rebuilds
  // after writes through the server and replica changes, so the error is ignored rather than crashing the server
  const watcher = fsWatch(l.dir, { recursive: true }, changed).on('error', () => {});
  const unsubscribe = l.replica.onChange(invalidate);
  const close = () => [clearTimeout(timer), watcher.close(), unsubscribe()];
  return { loadModel, invalidate, close };
}

/** Background sync when [store] is configured; returns its stop function. Setup errors land in sync.lastError. */
async function startSync(l: Local, m0: Model, enabled: boolean, invalidate: () => void) {
  const project = m0.project;
  const cfg = project.store && { ...project.store, url: process.env.IW_STORE ?? project.store.url };
  if (!cfg) return undefined;
  Object.assign(l.sync, { configured: enabled, store: cfg.url });
  try {
    const store = createResultStore(SN.openObjectStore(cfg, { bundleDir: l.dir }));
    l.store = store;
    const state = await fileStateStore(l.dir, cfg.url);
    l.state = state;
    invalidate(); // the first model was built before the sync state, so without its conflicts
    const extraBlobs = [...m0.fixtures.values()].flatMap((f) =>
      f.dataFiles.flatMap((d) => (d.pointer ? [d.sha256] : [])),
    );
    const [writer, evidence, keys] = [
      await writerId(l.dir),
      cfg.evidence ?? 'on-demand',
      project.signing_keys,
    ];
    // workspace mode: each sync also publishes and applies definition files (docs/spec/sync.md#workspace-mode-v02)
    const actor = () => SN.processIdentity({ cwd: l.dir }).current();
    const sign = <R extends AnyRecord>(r: R) => recordSigner(process.env.IW_SIGNING_KEY)(r);
    const workspace = cfg.mode === 'workspace' ? { fs: l.fs, actor: await actor(), sign } : undefined;
    const o = { replica: l.replica, store, state, projectId: project.id, keys, writer, evidence, extraBlobs };
    return enabled ? syncWatch({ ...o, workspace, ...syncReporter(l.sync, invalidate) }) : undefined;
  } catch (e) {
    l.sync.lastError = message(e);
    return undefined;
  }
}

/** Sync callbacks that keep the sync info of /api/project current. */
function syncReporter(sync: ProjectInfo['sync'], invalidate: () => void) {
  // Records the secret scan held back stay local; the UI shows why (docs/spec/security.md#secrets).
  // Warnings may be new conflicts, which the sync state holds: rebuild the model's problems.
  const onResult = (r: SyncResult) => {
    if (r.warnings?.length) invalidate();
    Object.assign(sync, {
      lastSyncAt: new Date().toISOString(),
      lastError: r.held?.length ? r.warnings?.find((w) => w.startsWith('held back')) : undefined,
    });
  };
  return { onResult, onError: (e: unknown) => Object.assign(sync, { lastError: message(e) }) };
}

/** App dependencies of a local server: signed writes to the replica, blobs read through from the store. */
function nodeDeps(l: Local, models: Models, opts: NodeServerOptions, evidence?: string): ServerDeps {
  const { dir, fs, replica } = l;
  // read on each write: a malformed key fails the write, it does not stop the server from starting
  const sign = (r: AnyRecord) => recordSigner(process.env.IW_SIGNING_KEY)(r);
  const webRoot = opts.webRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  return {
    mode: 'local',
    toolOutputs: opts.toolOutputs,
    loadModel: models.loadModel,
    writeRecord: (record) =>
      sign(record).then((r) => replica.putRecord(r).then(() => void models.invalidate())),
    putBlob: (data, contentType) => replica.putBlob(data, contentType),
    async getBlob(sha) {
      // read-through from the store for evidence = 'on-demand'
      const local = await replica.getBlob(sha);
      if (local || !l.store || evidence === 'none') return local;
      const data = await l.store.getBlob(sha).catch(() => null);
      return data && (await replica.putBlob(data)) ? data : null;
    },
    identity: requestIdentity(l.remote, SN.processIdentity({ cwd: dir }), opts.identityHeader),
    syncInfo: () => ({ ...l.sync }),
    assets: staticAssets(webRoot),
    context: SN.processContext({ cwd: dir }),
    readFile: (path) => fs.read(path),
    declaredIdentity: !opts.identityHeader,
    bundleFiles: () => definitionFiles(fs),
    records: () => l.records(),
    writeFile: (path, data) => fs.write(path, data).then(() => void models.invalidate()),
    // local uploads are file edits: review and commit them with git (docs/spec/web.md#upload)
    async publishBundle(files, { changed, removed }) {
      for (const path of changed) await fs.write(path, files.get(path)!);
      for (const path of removed) await fs.remove(path);
      models.invalidate();
      return undefined;
    },
  };
}

/** Listen behind the Host and write guards; a busy or forbidden port becomes a CONFLICT error. */
async function listen(
  l: Local,
  app: App,
  opts: NodeServerOptions,
  stop: () => Promise<unknown>,
): Promise<Server> {
  const hostname = opts.host ?? '127.0.0.1';
  const local = hostname === 'localhost' || LOOPBACK.test(hostname);
  let port = 0;
  const fetch = (request: Request, env: unknown) => {
    const address = (env as HttpBindings).incoming?.socket?.remoteAddress ?? '';
    l.remote.set(request, address);
    const host = local ? hostGuard(request.headers.get('host'), port) : undefined;
    return host ?? writeGuard(request.method, address, opts.identityHeader) ?? app.fetch(request);
  };
  const server = serve({ hostname, port: opts.port ?? DEFAULT_PORT, fetch });
  try {
    await new Promise((ok, no) =>
      server.listening ? ok(0) : server.once('listening', ok).once('error', no),
    );
  } catch (e) {
    await stop();
    const code = (e as { code?: string }).code;
    if (code !== 'EADDRINUSE' && code !== 'EACCES') throw e;
    const why = code === 'EACCES' ? 'is not allowed' : 'is already in use (another iw serve?)';
    const taken = `Port ${opts.port ?? DEFAULT_PORT} on ${hostname} ${why}. Use --port <n>.`;
    throw new BundleError('CONFLICT', taken);
  }
  const { address, family, ...a } = server.address() as AddressInfo;
  port = a.port;
  const any = ['0.0.0.0', '::'].includes(address);
  const host = any ? '127.0.0.1' : family === 'IPv6' ? `[${address}]` : address;
  return {
    url: `http://${host}:${port}`,
    async close() {
      await stop();
      const closed = new Promise((ok) => server.close(ok));
      (server as { closeAllConnections?: () => void }).closeAllConnections?.();
      await closed;
    },
  };
}

/** rethrow(e, cleanup()): throw after running a cleanup expression */
function rethrow(e: unknown, _cleanup: unknown): never {
  throw e;
}
