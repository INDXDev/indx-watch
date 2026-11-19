/**
 * Node entry used by `iw serve`. CONTRACT: signatures frozen; implementation T-107.
 */
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

export async function startNodeServer(opts: NodeServerOptions): Promise<{ url: string; close(): Promise<void> }> {
  void opts;
  throw new Error('not implemented (T-107)');
}
