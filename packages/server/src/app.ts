/**
 * The Hono app shared by `iw serve` (Node) and the Worker (docs/architecture.md#http-api).
 * Routes and shapes: contract.ts. The actor always comes from deps.identity, never from a request body.
 */
import type * as B from '@indx-watch/bundle';
import { customerModel, isAssignee, type Principal, roleOf, sharedModel } from '@indx-watch/core';
import type { AccessPolicy, ContextProvider } from '@indx-watch/store';
import { type Context, Hono } from 'hono';
import type { AppDeps } from './contract.js';
import { canShare, errorResponse, HttpError, iso, notFound } from './http.js';
import { registerMcpRoute } from './mcp.js';
import { registerReadRoutes, registerWriteRoutes } from './routes.js';
import { registerSecretRoutes } from './secrets.js';
import { registerShareRoutes } from './shares.js';
import { registerStoreRoutes } from './store-routes.js';
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
  /** sign records for a GitHub OIDC token (docs/spec/security.md#github-oidc); POST /api/sign answers 404 without it */
  signForGithub?(token: string, records: B.AnyRecord[], project: string): Promise<B.AnyRecord[]>;
  /** roles pinned by the deploy (docs/spec/security.md#roles); without them every identity is `lead` */
  roles?: B.Roles;
  /** the Access policy invites add customers to (docs/spec/security.md#customer-uat); without it: `access: "manual"` */
  accessPolicy?: AccessPolicy;
  /** every record (workspace mode: the `file` records a definition edit builds on) */
  records?(): Promise<B.AnyRecord[]>;
  /** write a definition file into the working tree after a workspace edit (Node) */
  writeFile?(path: string, data: Uint8Array): Promise<void>;
  /** remove a definition file from the working tree after a workspace delete (Node) */
  removeFile?(path: string): Promise<void>;
  /** IW_SECRETS_KEY: without it `iw:` secrets cannot be read or written (docs/spec/security.md#secrets) */
  secretsKey?: string;
  /** the MCP tools' output schemas (CommandData, passed in by the CLI); `/mcp` is served only with them */
  toolOutputs?: ToolOutputs;
  /** a public deploy: every request but GET, HEAD and `/mcp` answers 403 (docs/spec/security.md#public-deploys) */
  readOnly?: boolean;
}

/** The answer to a write on a public deploy. */
export const READ_ONLY = 'This is a read-only demo. Install INDX Watch to run tests: npx indx-watch init';

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

/** Roles allowed per `METHOD /path`, first match (docs/spec/security.md#roles); anything else needs `lead`. */
const PERMITS: [RegExp, B.Role[]][] = [
  [/^GET \/api\/access$/, []],
  [/^\w+ \/mcp$/, ['tester', 'viewer']],
  [/^(GET|HEAD) \/api\/(store|snapshots|shares)\b/, ['tester', 'viewer']],
  [/^(GET|HEAD) /, ['tester', 'viewer', 'customer']],
  [/^POST \/api\/(runs|blobs)$/, ['tester', 'customer']],
  [/^(POST \/api\/runs\/[^/]+\/judgements|PUT \/api\/store\/.*)$/, ['tester']],
  // test data is shared work: testers add and edit it too (docs/spec/security.md#roles)
  [/^(POST \/api\/(fixtures|bundle)|(PATCH|DELETE) \/api\/fixtures\/[^/]+)$/, ['tester']],
  // secrets: what each may see is decided per secret by its sharing (docs/spec/security.md#secrets)
  [/^POST \/api\/secrets\/[^/]+\/reveal$/, ['tester', 'viewer', 'customer']],
  [/^(PUT|DELETE) \/api\/secrets\/[^/]+$/, ['tester']],
];
/** May this role make this request. Pure; tested. */
export const permits = (role: B.Role | undefined, method: string, path: string) =>
  role === 'lead' || !!(role && PERMITS.find(([re]) => re.test(`${method} ${path}`))?.[1].includes(role));

/** Per-app state and request helpers shared by the route modules. */
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
  const grants = new WeakMap<Request, Promise<{ role?: B.Role; who: Principal }>>();
  /** the role and principal of a request, resolved once; groups are looked up only when roles are configured */
  const grant = (c: Context) => {
    const g =
      grants.get(c.req.raw) ??
      actor(c).then(async ({ id }) => {
        if (!d.roles) return { role: 'lead' as const, who: { id, groups: [] } };
        const who = { id, groups: (await d.identity.groups?.(c.req.raw)) ?? [] };
        // the model only for an identity no role list or `default` covers
        const invited = async () => isAssignee((await deps.loadModel()).model.plans, id);
        return { role: roleOf(d.roles, who) ?? roleOf(d.roles, who, await invited()), who };
      });
    grants.set(c.req.raw, g);
    return g;
  };
  return {
    deps: d,
    actor,
    grant,
    /**
     * The current model (null: no request, everything); for a customer restricted to the plan items assigned to
     * them, and without the data of fixtures not shared with the request's identity.
     */
    model: async (c: Context | null) => {
      const [m, g] = [(await deps.loadModel()).model, c && (await grant(c))];
      if (!g) return m;
      return sharedModel(g.role === 'customer' ? customerModel(m, g.who) : m, g.who, g.role);
    },
    /** may this actor create and revoke report share links */
    sharer: (a: B.Actor) => canShare(d, a),
    now: () => iso(d.now?.() ?? new Date()),
    read: d.readFile ?? (async () => null),
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
    // /mcp posts JSON-RPC for reads too: its write tools check the `viewer` role
    if (x.deps.readOnly && !['GET', 'HEAD'].includes(c.req.method) && c.req.path !== '/mcp')
      throw new HttpError(403, 'read-only', READ_ONLY);
    // without Access: /healthz, /api/sign (GitHub OIDC token instead) and share links (docs/spec/security.md)
    if (deps.mode === 'hosted' && !/^\/(healthz|api\/sign|s\/[^/]+)$/.test(c.req.path)) {
      const { role } = await x.grant(c);
      if (!permits(role, c.req.method, c.req.path))
        throw new HttpError(403, 'forbidden', `the role ${role ?? '(none)'} may not do this`);
    }
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
  registerSecretRoutes(app, x);
  if (x.deps.toolOutputs) registerMcpRoute(app, x, x.deps.toolOutputs);
  return { fetch: async (request: Request) => app.fetch(request) };
}
