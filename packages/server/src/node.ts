/**
 * Node entry used by `iw serve`. CONTRACT: signatures frozen; implementation T-107.
 */
import { watch as fsWatch } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type HttpBindings, serve } from '@hono/node-server';
import { BundleError, loadBundle } from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { buildModel } from '@indx-watch/core';
import { createResultStore, type IdentityProvider, type ResultStore, StoreError } from '@indx-watch/store';
import * as SN from '@indx-watch/store/node';
import { watch as syncWatch } from '@indx-watch/sync';
import { fileStateStore, writerId } from '@indx-watch/sync/node';
import { createApp, type ServerDeps } from './app.js';
import type { ProjectInfo } from './contract.js';

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
}

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;
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
export async function startNodeServer(opts: NodeServerOptions): Promise<Server> {
  const dir = resolve(opts.dir);
  const fs = nodeFs(dir);
  const replica = SN.openReplica(dir);
  const sync: ProjectInfo['sync'] = { configured: false };
  const cache: { model?: ReturnType<ServerDeps['loadModel']> } = {};
  const build = async () => {
    const { bundle, problems } = await loadBundle(fs);
    const shown: ProjectInfo['problems'] = problems.map((p) => ({ ...p, path: undefined, code: undefined }));
    if (!bundle) throw new StoreError('invalid', shown[0]?.message ?? `no bundle in ${dir}`);
    const records = await replica.records((file, error) =>
      shown.push({ severity: 'warning', message: `invalid record: ${error}`, file: `runs/${file}` }),
    );
    const { model, warnings } = buildModel(bundle, records);
    const more = warnings.map((message) => ({ severity: 'warning', message }));
    return { model, problems: [...shown, ...more] };
  };
  const invalidate = () => delete cache.model;
  const loadModel = () => (cache.model ??= build().catch((e) => rethrow(e, invalidate())));

  // the model is rebuilt after bundle edits (debounced) and replica writes
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = (_e: unknown, name: unknown) => {
    if (/^(runs|cache)([/\\]|$)/.test(String(name ?? ''))) return;
    clearTimeout(timer);
    timer = setTimeout(invalidate, 150);
  };
  const watcher = fsWatch(dir, { recursive: true }, changed).on('error', () => {});
  const unsubscribe = replica.onChange(invalidate);

  // background sync when [store] is configured
  let stopSync: (() => Promise<void>) | undefined;
  let store: ResultStore | undefined;
  const { model: m0 } = await loadModel();
  const project = m0.project;
  const cfg = project.store && { ...project.store, url: process.env.IW_STORE ?? project.store.url };
  if (cfg) {
    Object.assign(sync, { configured: opts.sync !== false, store: cfg.url });
    try {
      store = createResultStore(SN.openObjectStore(cfg, { bundleDir: dir }));
      const state = await fileStateStore(dir, cfg.url);
      const extraBlobs = [...m0.fixtures.values()].flatMap((f) =>
        f.dataFiles.flatMap((d) => (d.pointer ? [d.sha256] : [])),
      );
      const [writer, evidence] = [await writerId(dir), cfg.evidence ?? 'on-demand'];
      const onResult = () =>
        Object.assign(sync, { lastSyncAt: new Date().toISOString(), lastError: undefined });
      const onError = (e: unknown) => Object.assign(sync, { lastError: message(e) });
      const o = {
        replica,
        store,
        state,
        projectId: project.id,
        writer,
        evidence,
        extraBlobs,
        onResult,
        onError,
      };
      if (opts.sync !== false) stopSync = syncWatch(o);
    } catch (e) {
      sync.lastError = message(e);
    }
  }

  const remote = new WeakMap<Request, string>();
  const webRoot = opts.webRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  const deps: ServerDeps = {
    mode: 'local',
    loadModel,
    writeRecord: (record) => replica.putRecord(record).then(() => void invalidate()),
    putBlob: (data, contentType) => replica.putBlob(data, contentType),
    async getBlob(sha) {
      // read-through from the store for evidence = 'on-demand'
      const local = await replica.getBlob(sha);
      if (local || !store || project.store?.evidence === 'none') return local;
      const data = await store.getBlob(sha).catch(() => null);
      return data && (await replica.putBlob(data)) ? data : null;
    },
    identity: requestIdentity(remote, SN.processIdentity({ cwd: dir }), opts.identityHeader),
    syncInfo: () => ({ ...sync }),
    assets: staticAssets(webRoot),
    context: SN.processContext({ cwd: dir }),
    readFile: (path) => fs.read(path),
  };
  const app = createApp(deps);

  const hostname = opts.host ?? '127.0.0.1';
  const local = hostname === 'localhost' || LOOPBACK.test(hostname);
  let port = 0;
  const fetch = (request: Request, env: unknown) => {
    const address = (env as HttpBindings).incoming?.socket?.remoteAddress ?? '';
    remote.set(request, address);
    const host = local ? hostGuard(request.headers.get('host'), port) : undefined;
    return host ?? writeGuard(request.method, address, opts.identityHeader) ?? app.fetch(request);
  };
  const stop = async () => {
    clearTimeout(timer);
    watcher.close();
    unsubscribe();
    await stopSync?.();
  };
  const server = serve({ hostname, port: opts.port ?? 4321, fetch });
  try {
    await new Promise((ok, no) =>
      server.listening ? ok(0) : server.once('listening', ok).once('error', no),
    );
  } catch (e) {
    await stop();
    const code = (e as { code?: string }).code;
    if (code !== 'EADDRINUSE' && code !== 'EACCES') throw e;
    const why = code === 'EACCES' ? 'is not allowed' : 'is already in use (another iw serve?)';
    throw new BundleError('CONFLICT', `Port ${opts.port ?? 4321} on ${hostname} ${why}. Use --port <n>.`);
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
