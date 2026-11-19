import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AwsClient } from 'aws4fetch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpObjectStore } from '../src/adapters/http.js';
import { memoryObjectStore } from '../src/adapters/memory.js';
import { parseListXml, s3ObjectStore } from '../src/adapters/s3.js';
import { fsObjectStore } from '../src/node/fs-store.js';
import { r2ObjectStore } from '../src/workers/index.js';
import { objectStoreContract } from './contract.js';
import { fakeR2 } from './helpers/fakes.js';
import { startFakeS3, startStoreServer } from './helpers/servers.js';

const creds = { accessKeyId: 'test-key-id', secretAccessKey: 'test-secret' };

objectStoreContract('memory', async () => ({ store: memoryObjectStore() }));

objectStoreContract('fs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'iw-fs-'));
  return { store: fsObjectStore(dir), cleanup: () => rm(dir, { recursive: true, force: true }) };
});

objectStoreContract('s3 (fake S3 server)', async () => {
  const s3 = await startFakeS3();
  return {
    store: s3ObjectStore({ bucket: s3.bucket, endpoint: s3.url, credentials: creds }),
    cleanup: s3.close,
  };
});

objectStoreContract('s3 with prefix (fake S3 server)', async () => {
  const s3 = await startFakeS3();
  return {
    store: s3ObjectStore({
      bucket: s3.bucket,
      prefix: '/team/shop/',
      endpoint: s3.url,
      forcePathStyle: true,
      credentials: creds,
    }),
    cleanup: s3.close,
  };
});

objectStoreContract(
  'http (local /api/store handler)',
  async () => {
    const srv = await startStoreServer({ token: 'test-token' });
    return {
      store: httpObjectStore({
        baseUrl: `${srv.url}/`,
        headers: async () => ({ 'cf-access-token': 'test-token' }),
      }),
      cleanup: srv.close,
    };
  },
  { canDelete: false },
);

objectStoreContract('r2 binding (fake, cursor only)', async () => ({ store: r2ObjectStore(fakeR2(), 'p') }));
objectStoreContract('r2 binding (fake, with startAfter)', async () => ({
  store: r2ObjectStore(fakeR2({ honorStartAfter: true })),
}));

// MinIO: `minio` が PATH にあるときだけ（コミュニティ版の配布は終了しているので通常はスキップ）
const minioBin = (() => {
  try {
    return execFileSync('which', ['minio']).toString().trim() || null;
  } catch {
    return null;
  }
})();
let minio: { proc: ChildProcess; dir: string; url: string } | undefined;
const minioCreds = { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' };
let bucketN = 0;
beforeAll(async () => {
  if (!minioBin) return;
  const dir = await mkdtemp(join(tmpdir(), 'iw-minio-'));
  const port = 19000 + Math.floor(Math.random() * 1000);
  const proc = spawn(minioBin, ['server', dir, '--address', `127.0.0.1:${port}`, '--quiet'], {
    stdio: 'ignore',
  });
  minio = { proc, dir, url: `http://127.0.0.1:${port}` };
  for (let i = 0; i < 50; i++) {
    if (
      await fetch(`${minio.url}/minio/health/live`).then(
        (r) => r.ok,
        () => false,
      )
    )
      return;
    await new Promise((r) => setTimeout(r, 200));
  }
}, 20_000);
afterAll(async () => {
  minio?.proc.kill();
  if (minio) await rm(minio.dir, { recursive: true, force: true });
});
objectStoreContract(
  's3 (MinIO)',
  async () => {
    const bucket = `iw-test-${++bucketN}`;
    await new AwsClient({ ...minioCreds, service: 's3', region: 'us-east-1' }).fetch(
      `${minio!.url}/${bucket}`,
      { method: 'PUT' },
    );
    return { store: s3ObjectStore({ bucket, endpoint: minio!.url, credentials: minioCreds }) };
  },
  { skip: !minioBin },
);

describe('s3 adapter details', () => {
  it('parses ListObjectsV2 XML with entities', () => {
    const xml =
      '<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>a&amp;b/&#x41;&lt;</Key><Size>3</Size><ETag>&quot;x&quot;</ETag></Contents></ListBucketResult>';
    expect(parseListXml(xml)).toEqual({ keys: [{ key: 'a&b/A<', size: 3, etag: '"x"' }], truncated: true });
  });

  it('rejects S3 directory buckets', () => {
    expect(() => s3ObjectStore({ bucket: 'shop--usw2-az1--x-s3', credentials: creds })).toThrow(
      /directory buckets/,
    );
  });

  it('signs requests and sends x-goog-if-generation-match to GCS instead of If-None-Match', async () => {
    const s3 = await startFakeS3();
    try {
      // GCS は storage.googleapis.com で判定する。テストでは fetch を偽サーバーへ向け直す
      const real = globalThis.fetch;
      globalThis.fetch = ((input: Request | string | URL, init?: RequestInit) => {
        const req = new Request(input, init);
        return real(new Request(req.url.replace('https://storage.googleapis.com', s3.url), req));
      }) as typeof fetch;
      try {
        const gcs = s3ObjectStore({
          bucket: s3.bucket,
          endpoint: 'https://storage.googleapis.com',
          forcePathStyle: true,
          credentials: creds,
        });
        expect(await gcs.put('k', 'v', { ifNoneMatch: true })).toBe(true);
        expect(await gcs.put('k', 'w', { ifNoneMatch: true })).toBe(false);
      } finally {
        globalThis.fetch = real;
      }
      const put = s3.requests.filter((r) => r.method === 'PUT');
      expect(put[0]!.headers['x-goog-if-generation-match']).toBe('0');
      expect(put[0]!.headers['if-none-match']).toBeUndefined();
      expect(String(put[0]!.headers.authorization)).toMatch(/^AWS4-HMAC-SHA256 Credential=test-key-id\//);
    } finally {
      await s3.close();
    }
  });

  it('treats a 412 on a blob with matching content as success, and a mismatch as conflict', async () => {
    const s3 = await startFakeS3();
    try {
      const store = s3ObjectStore({ bucket: s3.bucket, endpoint: s3.url, credentials: creds });
      const { sha256Hex } = await import('@indx-watch/bundle');
      const sha = await sha256Hex('blob');
      const key = `v1/blobs/sha256/${sha.slice(0, 2)}/${sha}`;
      expect(await store.put(key, 'blob', { ifNoneMatch: true })).toBe(true);
      expect(await store.put(key, 'blob', { ifNoneMatch: true })).toBe(true);
      s3.objects.set(key, new TextEncoder().encode('tampered'));
      await expect(store.put(key, 'blob', { ifNoneMatch: true })).rejects.toMatchObject({ code: 'conflict' });
    } finally {
      await s3.close();
    }
  });

  it('maps 403 to unauthorized', async () => {
    const s3 = await startFakeS3();
    try {
      const real = globalThis.fetch;
      globalThis.fetch = ((input: Request) => real(input, { headers: {} })) as typeof fetch;
      try {
        const store = s3ObjectStore({ bucket: s3.bucket, endpoint: s3.url, credentials: creds });
        await expect(store.get('x')).rejects.toMatchObject({ code: 'unauthorized' });
      } finally {
        globalThis.fetch = real;
      }
    } finally {
      await s3.close();
    }
  });
});

describe('http adapter details', () => {
  it('treats an Access login redirect as unauthorized', async () => {
    const srv = await startStoreServer({ token: 'test-token' });
    try {
      const store = httpObjectStore({ baseUrl: srv.url });
      await expect(store.get('indx-watch-store.json')).rejects.toMatchObject({ code: 'unauthorized' });
    } finally {
      await srv.close();
    }
  });
});

describe('fs adapter details', () => {
  it('leaves no temp files and ignores dot-files when listing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iw-fs-'));
    try {
      const store = fsObjectStore(dir);
      await store.put('a/x', '1', { ifNoneMatch: true });
      await store.put('a/x', '2', { ifNoneMatch: true });
      await store.put('a/y', '3');
      expect((await readdir(join(dir, 'a'))).sort()).toEqual(['x', 'y']);
      await fsObjectStore(dir).put('a/.hidden', 'h');
      expect((await store.list({ prefix: 'a/' })).keys.map((k) => k.key)).toEqual(['a/x', 'a/y']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
