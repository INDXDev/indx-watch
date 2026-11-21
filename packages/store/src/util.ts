/** Small shared helpers (runtime-neutral). */
import { AnyRecord } from '@indx-watch/bundle';
import { StoreError } from './ports.js';

const enc = new TextEncoder();

/** Drop undefined and empty-string values (optional fields stay out of the output). */
export const compact = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;
export const toBytes = (body: Uint8Array | string): Uint8Array =>
  typeof body === 'string' ? enc.encode(body) : body;

/** Restrict the shape of keys (no path traversal): letters, digits and . _ - / only; no empty, '.' or '..' segments. */
export function checkKey(key: string): string {
  if (!/^[A-Za-z0-9._\-/]+$/.test(key) || key.split('/').some((s) => s === '' || s === '.' || s === '..')) {
    throw new StoreError('invalid', `invalid object key: ${JSON.stringify(key)}`);
  }
  return key;
}

/** Parse JSON; undefined when broken (the caller's schema check rejects it). */
export function parseJson(raw: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return undefined;
  }
}

const SHA = /^[0-9a-f]{64}$/;
export function checkSha(sha256: string): string {
  if (!SHA.test(sha256)) throw new StoreError('invalid', `invalid sha256: ${sha256}`);
  return sha256;
}

/** blobs/sha256/<aa>/<hash> (under 'v1/' in a store, under runs/ in a replica). */
export const blobPath = (sha256: string) => `blobs/sha256/${checkSha(sha256).slice(0, 2)}/${sha256}`;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Read the first 10 characters of a ULID (the time in ms). */
export function ulidTime(ulid: string): number {
  let t = 0;
  for (const c of ulid.slice(0, 10)) {
    const v = CROCKFORD.indexOf(c);
    if (v < 0) return Number.NaN;
    t = t * 32 + v;
  }
  return t;
}

/** Time of an ID ('run_01J…') or a ULID string. */
export const idTime = (id: string) => ulidTime(id.slice(id.indexOf('_') + 1));

/**
 * Validate a record. When the strict schema accepts it, return the parsed record (defaults included).
 * When it fails only on unknown fields added by a newer tool, re-check without them and return the value as received (keeping its bytes).
 */
export function checkRecord(raw: unknown): { record: AnyRecord } | { error: string } {
  const r = AnyRecord.safeParse(raw);
  if (r.success) return { record: r.data };
  if (r.error.issues.every((i) => i.code === 'unrecognized_keys')) {
    const copy = structuredClone(raw) as Record<string, unknown>;
    for (const issue of r.error.issues) {
      let node: unknown = copy;
      for (const p of issue.path) node = (node as Record<PropertyKey, unknown>)?.[p];
      if (node && typeof node === 'object' && 'keys' in issue)
        for (const k of issue.keys) delete (node as Record<string, unknown>)[k];
    }
    if (AnyRecord.safeParse(copy).success) return { record: raw as AnyRecord };
  }
  return { error: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') };
}

/** Hashes of the blobs a record references (evidence, step evidence, bundle snapshots, files). */
export function blobRefs(record: AnyRecord): string[] {
  const out = new Set<string>();
  if (record.kind === 'run') {
    for (const e of record.evidence ?? []) out.add(e.sha256);
    for (const s of record.steps ?? []) for (const h of s.evidence ?? []) out.add(h);
  } else if (record.kind === 'bundle') out.add(record.sha256);
  else if (record.kind === 'file' && record.sha256) out.add(record.sha256);
  return [...out];
}

/** Turn fetch failures and HTTP statuses into StoreErrors. */
export function httpError(status: number, what: string): StoreError {
  if (status === 401 || status === 403 || (status >= 300 && status < 400)) {
    return new StoreError('unauthorized', `${what}: HTTP ${status} (check credentials or Access login)`);
  }
  if (status === 404) return new StoreError('not-found', `${what}: not found`);
  if (status === 409 || status === 412) return new StoreError('conflict', `${what}: HTTP ${status}`);
  return new StoreError(status >= 500 ? 'network' : 'invalid', `${what}: HTTP ${status}`);
}

/** https://, or plain http to this machine (tests): where credentials may be sent. */
export const SECURE_URL = /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$))/;

export async function guardedFetch(what: string, f: () => Promise<Response>): Promise<Response> {
  try {
    return await f();
  } catch (e) {
    throw new StoreError('network', `${what}: ${(e as Error).message}`, e);
  }
}

/** Shared lexicographic paging (the last step of the memory, fs and r2 listings). */
export function pageKeys<T extends { key: string }>(
  sorted: T[],
  opts: { prefix: string; startAfter?: string; limit?: number },
): { keys: T[]; truncated: boolean } {
  const limit = opts.limit ?? 1000;
  const all = sorted.filter(
    (o) => o.key.startsWith(opts.prefix) && (!opts.startAfter || o.key > opts.startAfter),
  );
  return { keys: all.slice(0, limit), truncated: all.length > limit };
}

export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const byKey = (a: { key: string }, b: { key: string }) => cmp(a.key, b.key);
