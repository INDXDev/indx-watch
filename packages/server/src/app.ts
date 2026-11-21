/**
 * The Hono app shared by `iw serve` (Node) and the Worker (docs/architecture.md#http-api).
 * Routes and shapes: contract.ts. The actor always comes from deps.identity, never from a request body.
 */
import type * as B from '@indx-watch/bundle';
import type { ContextProvider } from '@indx-watch/store';
import { type Context, Hono } from 'hono';
import type { AppDeps } from './contract.js';
import { canShare, errorResponse, HttpError, iso, notFound } from './http.js';
import { registerMcpRoute } from './mcp.js';
import { registerReadRoutes, registerStoreRoutes, registerWriteRoutes } from './routes.js';
import { registerShareRoutes } from './shares.js';
import type { ToolOutputs } from './tools.js';

export { errorResponse, HttpError, MAX_BLOB_BYTES } from './http.js';
export { resolveRelease } from './routes.js';

/** Optional extras of AppDeps (change request: fold into AppDeps). */
export interface ServerDeps extends AppDeps {
  /** build and CI context recorded on manual runs and reports (Node: processContext) */
  context?: ContextProvider;
  /** read a bundle file, e.g. dataset rows; path relative to the bundle root */
  readFile?(path: string): Promise<Uint8Array | null>;
  /** clock for tests */
  now?(): Date;
  /** honor the `iw_tester` cookie when no verified identity exists (docs/spec/web.md#identity) */
  declaredIdentity?: boolean;
  /** current definition files by bundle-relative path (uploads merge into them) */
  bundleFiles?(): Promise<Map<string, Uint8Array>>;
  /** write an upload: files on disk (Node) or a new snapshot (Workers); returns the bundle record ID if any */
  publishBundle?(
    files: Map<string, Uint8Array>,
    info: { actor: B.Actor; message?: string; changed: string[]; removed: string[] },
  ): Promise<string | undefined>;
  /** the MCP tools' output schemas (CommandData, passed in by the CLI); `/mcp` is served only with them */
  toolOutputs?: ToolOutputs;
}

/** The browser-declared tester from the `iw_tester` cookie, if valid. Pure; tested. */
export function declaredTester(cookie: string | null | undefined): B.Actor | undefined {
  const raw = /(?:^|;\s*)iw_tester=([^;]*)/.exec(cookie ?? '')?.[1];
  try {
    const v = raw ? (JSON.parse(decodeURIComponent(raw)) as { id?: unknown; name?: unknown } | null) : null;
    const id = typeof v?.id === 'string' ? v.id.trim() : '';
    const name = typeof v?.name === 'string' ? v.name.trim() : '';
    if (!id || id.length > 80 || name.length > 80 || [...id, ...name].some((ch) => ch.charCodeAt(0) < 32))
      return undefined;
    return { kind: 'human', id, ...(name && { name }), via: 'browser' };
  } catch {
    return undefined; // not JSON
  }
}

const CSP_APP =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'";

/**
 * Why a write must be refused as a possible cross-site request (docs/spec/security.md#browser-requests):
 * writes must not be "simple" requests (JSON, X-IW-Request or If-None-Match) and must come from this origin.
 */
export function crossSite(r: Request): string | undefined {
  if (['GET', 'HEAD', 'OPTIONS'].includes(r.method)) return undefined;
  const h = r.headers;
  const json = h.get('content-type')?.split(';')[0]?.trim().toLowerCase() === 'application/json';
  if (!json && !h.has('x-iw-request') && !h.has('if-none-match'))
    return 'writes need Content-Type: application/json or an X-IW-Request header';
  const origin = h.get('origin');
  const hosts = [h.get('host'), h.get('x-forwarded-host'), new URL(r.url).host];
  const foreign = origin !== null && !(URL.canParse(origin) && hosts.includes(new URL(origin).host));
  return foreign || h.get('sec-fetch-site') === 'cross-site' ? 'cross-site writes are refused' : undefined;
}

/** Per-app state and request helpers shared by the route groups in routes.ts. */
function appContext(deps: AppDeps) {
  const d = deps as ServerDeps;
  const actors = new WeakMap<Request, Promise<B.Actor>>();
  /** the actor of a request, resolved once: the declared tester if allowed, else deps.identity */
  const actor = (c: Context) => {
    const declared = d.declaredIdentity ? declaredTester(c.req.header('cookie')) : undefined;
    const a =
      actors.get(c.req.raw) ?? (declared ? Promise.resolve(declared) : deps.identity.current(c.req.raw));
    actors.set(c.req.raw, a);
    return a;
  };
  return {
    deps: d,
    actor,
    /** may this actor create and revoke report share links */
    sharer: (a: B.Actor) => canShare(d, a),
    now: () => iso(d.now?.() ?? new Date()),
    read: d.readFile ?? (async () => null),
    model: async () => (await deps.loadModel()).model,
    /** name and media type of blobs uploaded through this server (bounded) */
    uploads: new Map<string, { name: string; type: string }>(),
  };
}
/** What route modules get from createApp. */
export type Ctx = ReturnType<typeof appContext>;

/** The Hono app: security middleware, then the read, write and store routes. */
export function createApp(deps: AppDeps): { fetch(request: Request): Promise<Response> } {
  const x = appContext(deps);
  const app = new Hono();
  app.onError((e) => errorResponse(e));
  const spa = (c: Context) => deps.assets && !c.req.path.startsWith('/api/');
  app.notFound((c) => (spa(c) ? deps.assets!(c.req.raw) : errorResponse(notFound(c.req.path))));
  app.use('*', async (c, next) => {
    const refused = crossSite(c.req.raw);
    if (refused) throw new HttpError(403, 'forbidden', refused);
    // share links are the one public path besides /healthz (docs/spec/security.md#share-links)
    if (deps.mode === 'hosted' && c.req.path !== '/healthz' && !c.req.path.startsWith('/s/'))
      await x.actor(c);
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    const html = c.res.headers.get('content-type')?.startsWith('text/html');
    if (html && !c.res.headers.has('content-security-policy')) c.header('Content-Security-Policy', CSP_APP);
  });
  app.get('/healthz', (c) => c.json({ ok: true }));
  registerReadRoutes(app, x);
  registerWriteRoutes(app, x);
  registerStoreRoutes(app, x);
  registerShareRoutes(app, x);
  if (x.deps.toolOutputs) registerMcpRoute(app, x, x.deps.toolOutputs);
  return { fetch: async (request: Request) => app.fetch(request) };
}
