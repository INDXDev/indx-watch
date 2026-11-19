import type { ObjectStore } from '../ports.js';
import { StoreError } from '../ports.js';
import { checkKey, guardedFetch, httpError, toBytes } from '../util.js';

/** ObjectStore over a hosted server's /api/store/* (packages/server/src/contract.ts ROUTES.store*). */
export function httpObjectStore(opts: {
  baseUrl: string;
  headers?: () => Promise<Record<string, string>>;
}): ObjectStore {
  const base = opts.baseUrl.replace(/\/+$/, '');
  // Access は未ログインだとログイン画面へリダイレクトするので、追わずに unauthorized にする
  const send = async (what: string, path: string, init: RequestInit = {}) => {
    const headers = { ...(await opts.headers?.()), ...(init.headers as Record<string, string>) };
    return guardedFetch(what, () => fetch(`${base}${path}`, { ...init, headers, redirect: 'manual' }));
  };
  const obj = (key: string) => `/api/store/objects/${checkKey(key)}`;
  return {
    url: base,
    async get(key) {
      const res = await send(`GET ${key}`, obj(key));
      if (res.status === 404) return null;
      if (!res.ok) throw httpError(res.status, `GET ${key}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async head(key) {
      const res = await send(`HEAD ${key}`, obj(key), { method: 'HEAD' });
      if (res.status === 404) return null;
      if (!res.ok) throw httpError(res.status, `HEAD ${key}`);
      return {
        key,
        size: Number(res.headers.get('content-length') ?? 0),
        etag: res.headers.get('etag') ?? undefined,
      };
    },
    async put(key, body, o) {
      const headers: Record<string, string> = {
        'content-type': o?.contentType ?? 'application/octet-stream',
      };
      if (o?.ifNoneMatch) headers['if-none-match'] = '*';
      const data = toBytes(body) as Uint8Array<ArrayBuffer>;
      const res = await send(`PUT ${key}`, obj(key), { method: 'PUT', headers, body: data });
      if (res.ok) return true;
      if (res.status === 412 && o?.ifNoneMatch) return false;
      throw httpError(res.status, `PUT ${key}`);
    },
    async list(o) {
      const q = new URLSearchParams({ prefix: o.prefix });
      if (o.startAfter) q.set('startAfter', o.startAfter);
      if (o.limit !== undefined) q.set('limit', String(o.limit));
      const res = await send(`LIST ${o.prefix}`, `/api/store/list?${q}`);
      if (!res.ok) throw httpError(res.status, `LIST ${o.prefix}`);
      const body = (await res.json()) as {
        keys: { key: string; size: number; etag?: string }[];
        truncated: boolean;
      };
      return { keys: body.keys, truncated: body.truncated };
    },
    async delete() {
      throw new StoreError('invalid', 'delete is not available over the hosted store API');
    },
  };
}
