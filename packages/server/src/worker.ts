/**
 * Cloudflare Workers entry used by `iw deploy`. Bindings: STORE (R2), DB (D1), ASSETS (static assets).
 * Vars: ACCESS_TEAM, ACCESS_AUD, PROJECT_ID, STORE_PREFIX. CONTRACT; implementation T-107.
 */
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    void request;
    void env;
    return new Response('not implemented (T-107)', { status: 501 });
  },
  async scheduled(_event: unknown, env: Env): Promise<void> {
    void env;
  },
};
