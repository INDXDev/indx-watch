import { sha256Hex } from '@indx-watch/bundle';
import { AwsClient } from 'aws4fetch';
import type { ObjectInfo, ObjectStore } from '../ports.js';
import { StoreError } from '../ports.js';
import { checkKey, guardedFetch, httpError, toBytes } from '../util.js';

export interface S3Options {
  bucket: string;
  prefix?: string;
  endpoint?: string;
  region?: string;
  forcePathStyle?: boolean;
  credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
}

const xmlText = (s: string) =>
  s.replace(/&(lt|gt|quot|apos|amp|#(\d+)|#x([0-9a-f]+));/gi, (_, n: string, d?: string, h?: string) =>
    d
      ? String.fromCodePoint(Number(d))
      : h
        ? String.fromCodePoint(Number.parseInt(h, 16))
        : ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' } as Record<string, string>)[n.toLowerCase()]!,
  );
const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? xmlText(m[1]!) : undefined;
};

/** Read a ListObjectsV2 XML response (a small regex parser, no dependency). */
export function parseListXml(xml: string): { keys: ObjectInfo[]; truncated: boolean } {
  const keys: ObjectInfo[] = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const etag = tag(m[1]!, 'ETag');
    keys.push({
      key: tag(m[1]!, 'Key') ?? '',
      size: Number(tag(m[1]!, 'Size') ?? 0),
      ...(etag ? { etag } : {}),
    });
  }
  return { keys, truncated: tag(xml, 'IsTruncated') === 'true' };
}

const BLOB_KEY = /(?:^|\/)blobs\/sha256\/[0-9a-f]{2}\/([0-9a-f]{64})$/;

/** S3-compatible ObjectStore over aws4fetch (S3, R2, MinIO, GCS interop). */
export function s3ObjectStore(opts: S3Options): ObjectStore {
  if (opts.bucket.endsWith('--x-s3')) {
    throw new StoreError(
      'invalid',
      'S3 directory buckets are not supported (no lexicographic listing or StartAfter)',
    );
  }
  const region = opts.region ?? 'us-east-1';
  const endpoint = new URL(opts.endpoint ?? `https://s3.${region}.amazonaws.com`);
  const local = /^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/.test(endpoint.hostname);
  const pathStyle = opts.forcePathStyle ?? local;
  const gcs = endpoint.hostname === 'storage.googleapis.com';
  const base = pathStyle
    ? `${endpoint.origin}${endpoint.pathname.replace(/\/$/, '')}/${opts.bucket}`
    : `${endpoint.protocol}//${opts.bucket}.${endpoint.host}`;
  const prefix = opts.prefix ? `${opts.prefix.replace(/^\/+|\/+$/g, '')}/` : '';
  const client = new AwsClient({ ...opts.credentials, service: 's3', region, retries: 2 });
  const url = (key: string) => `${base}/${prefix}${checkKey(key)}`;
  const send = (what: string, u: string, init: RequestInit = {}) =>
    guardedFetch(what, () => client.fetch(u, init));

  async function get(key: string) {
    const res = await send(`GET ${key}`, url(key));
    if (res.status === 404) return null;
    if (!res.ok) throw httpError(res.status, `GET ${key}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  return {
    url: `s3://${opts.bucket}${prefix ? `/${prefix.slice(0, -1)}` : ''}`,
    get,
    async head(key) {
      const res = await send(`HEAD ${key}`, url(key), { method: 'HEAD' });
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
      if (o?.ifNoneMatch) headers[gcs ? 'x-goog-if-generation-match' : 'if-none-match'] = gcs ? '0' : '*';
      const data = toBytes(body);
      const res = await send(`PUT ${key}`, url(key), {
        method: 'PUT',
        headers,
        body: data as Uint8Array<ArrayBuffer>,
      });
      if (res.ok) return true;
      if (res.status !== 412 || !o?.ifNoneMatch) throw httpError(res.status, `PUT ${key}`);
      // A retried request can turn a success into 412: check content-addressed blobs by the hash of their content
      const hash = BLOB_KEY.exec(key)?.[1];
      if (!hash) return false;
      const existing = await get(key);
      if (existing && (await sha256Hex(existing)) === hash) return true;
      throw new StoreError('conflict', `PUT ${key}: an object with different content exists`);
    },
    async list(o) {
      const q = new URLSearchParams({
        'list-type': '2',
        prefix: prefix + o.prefix,
        'max-keys': String(o.limit ?? 1000),
      });
      if (o.startAfter) q.set('start-after', prefix + o.startAfter);
      const res = await send(`LIST ${o.prefix}`, `${base}/?${q}`);
      if (!res.ok) throw httpError(res.status, `LIST ${o.prefix}`);
      const r = parseListXml(await res.text());
      return { keys: r.keys.map((k) => ({ ...k, key: k.key.slice(prefix.length) })), truncated: r.truncated };
    },
    async delete(key) {
      const res = await send(`DELETE ${key}`, url(key), { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw httpError(res.status, `DELETE ${key}`);
    },
  };
}
