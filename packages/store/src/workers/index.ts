/**
 * Workers-side factories. CONTRACT: signatures frozen; implementation T-104.
 */
import type { IdentityProvider, Index, ObjectStore } from '../ports.js';

/** ObjectStore over an R2 bucket binding, under an optional key prefix. */
export function r2ObjectStore(bucket: unknown, prefix?: string): ObjectStore {
  void bucket;
  void prefix;
  throw new Error('not implemented (T-104)');
}

/** Index over a D1 binding (Drizzle sqlite schema shared with node:sqlite). */
export function d1Index(db: unknown): Index {
  void db;
  throw new Error('not implemented (T-104)');
}

/** Identity from Cf-Access-Jwt-Assertion verified against https://<team>.cloudflareaccess.com/cdn-cgi/access/certs and aud. */
export function accessIdentity(opts: { team: string; aud: string }): IdentityProvider {
  void opts;
  throw new Error('not implemented (T-104)');
}
