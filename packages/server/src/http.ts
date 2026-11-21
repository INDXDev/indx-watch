/**
 * HTTP errors and small helpers shared by app.ts and routes.ts (runtime-neutral); app.ts re-exports the public ones.
 */
import type { Actor } from '@indx-watch/bundle';
import { StoreError } from '@indx-watch/store';

export const MAX_BLOB_BYTES = 25 * 1024 * 1024;

/** An error with an HTTP status and a code for the { error: { code, message } } body. */
export class HttpError extends Error {
  status: 400 | 401 | 403 | 404 | 409 | 412 | 413 | 503;
  code: string;
  constructor(status: HttpError['status'], code: string, message: string) {
    super(message);
    [this.status, this.code] = [status, code];
  }
}
/** 400 invalid */
export const bad = (message: string) => new HttpError(400, 'invalid', message);
/** 404 not-found */
export const notFound = (what: string) => new HttpError(404, 'not-found', `${what} not found`);
const STORE_STATUS: Record<string, number> = { 'not-found': 404, unauthorized: 401, invalid: 400 };

/** The { error: { code, message } } response for any thrown value. */
export function errorResponse(e: unknown): Response {
  const message = e instanceof Error ? e.message : String(e);
  const store = e instanceof StoreError ? ([STORE_STATUS[e.code] ?? 500, e.code] as const) : undefined;
  const other =
    (e as Error)?.name === 'ZodError' ? ([400, 'invalid'] as const) : ([500, 'internal'] as const);
  const [status, code] = e instanceof HttpError ? [e.status, e.code] : (store ?? other);
  return Response.json({ error: { code, message } }, { status });
}

/** Throw from an expression. */
export function fail(e: Error): never {
  throw e;
}

/** ISO timestamp without milliseconds. */
export const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

const MAGIC = Object.entries({ '89504e47': 'image/png', ffd8ff: 'image/jpeg', '47494638': 'image/gif' });
/** Media type from the first bytes (uploads without a usable Content-Type). */
export const sniff = (b: Uint8Array) => {
  const hex = [...b.slice(0, 4)].map((x) => x.toString(16).padStart(2, '0')).join('');
  return MAGIC.find(([m]) => hex.startsWith(m))?.[1] ?? 'application/octet-stream';
};

/** Who may create and revoke report share links (docs/spec/security.md#share-links). */
export const canShare = (d: { mode: string }, a: Actor) =>
  d.mode === 'hosted' && a.kind === 'human' && a.via === 'cloudflare-access';
