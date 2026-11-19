/** テスト用の小さなサーバー: S3 互換の偽物と /api/store/* の実装（どちらもメモリ上）。 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { memoryObjectStore } from '../../src/adapters/memory.js';
import type { ObjectStore } from '../../src/ports.js';

async function body(req: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

async function listen(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>) {
  const server: Server = createServer((req, res) => {
    handler(req, res).catch((e) => {
      res.statusCode = 500;
      res.end(String(e));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * S3 互換の偽サーバー（パス形式: /<bucket>/<key>）。PUT/GET/HEAD/DELETE/ListObjectsV2 と
 * If-None-Match: * / x-goog-if-generation-match: 0 を実装。署名は Authorization ヘッダーの有無だけを見る。
 */
export async function startFakeS3(bucket = 'test-bucket') {
  const objects = new Map<string, Uint8Array>();
  const requests: { method: string; headers: IncomingMessage['headers'] }[] = [];
  const srv = await listen(async (req, res) => {
    requests.push({ method: req.method!, headers: req.headers });
    const u = new URL(req.url!, 'http://x');
    if (!String(req.headers.authorization ?? '').startsWith('AWS4-HMAC-SHA256')) {
      res.statusCode = 403;
      return void res.end('<Error><Code>AccessDenied</Code></Error>');
    }
    const [, b, ...rest] = u.pathname.split('/');
    if (b !== bucket) {
      res.statusCode = 404;
      return void res.end('<Error><Code>NoSuchBucket</Code></Error>');
    }
    const key = decodeURIComponent(rest.join('/'));
    if (req.method === 'GET' && !key && u.searchParams.get('list-type') === '2') {
      const prefix = u.searchParams.get('prefix') ?? '';
      const after = u.searchParams.get('start-after') ?? '';
      const max = Number(u.searchParams.get('max-keys') ?? 1000);
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix) && k > after).sort();
      const page = keys.slice(0, max);
      const contents = page
        .map(
          (k) =>
            `<Contents><Key>${esc(k)}</Key><Size>${objects.get(k)!.byteLength}</Size><ETag>&quot;e&quot;</ETag></Contents>`,
        )
        .join('');
      res.setHeader('content-type', 'application/xml');
      return void res.end(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucket}</Name><IsTruncated>${keys.length > max}</IsTruncated>${contents}</ListBucketResult>`,
      );
    }
    const o = objects.get(key);
    if (req.method === 'PUT') {
      const data = await body(req);
      const createOnly =
        req.headers['if-none-match'] === '*' || req.headers['x-goog-if-generation-match'] === '0';
      if (createOnly && o) {
        res.statusCode = 412;
        return void res.end('<Error><Code>PreconditionFailed</Code></Error>');
      }
      objects.set(key, data);
      res.setHeader('etag', '"e"');
      return void res.end();
    }
    if (req.method === 'DELETE') {
      objects.delete(key);
      res.statusCode = 204;
      return void res.end();
    }
    if (!o) {
      res.statusCode = 404;
      return void res.end(req.method === 'HEAD' ? undefined : '<Error><Code>NoSuchKey</Code></Error>');
    }
    res.setHeader('content-length', String(o.byteLength));
    res.setHeader('etag', '"e"');
    res.end(req.method === 'HEAD' ? undefined : Buffer.from(o));
  });
  return { ...srv, bucket, objects, requests };
}

/** ROUTES.store* を ObjectStore の上に実装した最小のハンドラー（packages/server の代わり）。 */
export async function startStoreServer(opts: { token?: string; store?: ObjectStore } = {}) {
  const store = opts.store ?? memoryObjectStore();
  const srv = await listen(async (req, res) => {
    const u = new URL(req.url!, 'http://x');
    const json = (status: number, v: unknown) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(v));
    };
    if (opts.token && req.headers['cf-access-token'] !== opts.token) {
      res.statusCode = 302;
      res.setHeader('location', 'https://team.cloudflareaccess.com/login');
      return void res.end();
    }
    if (u.pathname === '/api/store/list' && req.method === 'GET') {
      const limit = u.searchParams.get('limit');
      const startAfter = u.searchParams.get('startAfter');
      return json(
        200,
        await store.list({
          prefix: u.searchParams.get('prefix') ?? '',
          ...(startAfter ? { startAfter } : {}),
          ...(limit ? { limit: Number(limit) } : {}),
        }),
      );
    }
    if (!u.pathname.startsWith('/api/store/objects/'))
      return json(404, { error: { code: 'not-found', message: 'no route' } });
    const key = decodeURIComponent(u.pathname.slice('/api/store/objects/'.length));
    if (req.method === 'PUT') {
      const created = await store.put(key, await body(req), {
        ifNoneMatch: req.headers['if-none-match'] === '*',
      });
      return json(created ? 201 : 412, created ? {} : { error: { code: 'conflict', message: 'exists' } });
    }
    const info = await store.head(key);
    if (!info) {
      res.statusCode = 404;
      return void res.end();
    }
    res.setHeader('content-length', String(info.size));
    if (req.method === 'HEAD') return void res.end();
    res.end(Buffer.from((await store.get(key))!));
  });
  return { ...srv, store };
}
