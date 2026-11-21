import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  accessHeaders,
  awsCredentials,
  type Exec,
  type ExecSync,
  openNodeIndex,
  openObjectStore,
} from '../src/node/index.js';
import { SCHEMA_VERSION, withoutSqliteWarning } from '../src/node/sqlite-index.js';
import { runRecord } from './helpers/records.js';
import { startFakeS3, startStoreServer } from './helpers/servers.js';

const fakeExec = (out: Record<string, string | null>): Exec & { calls: string[][] } => {
  const calls: string[][] = [];
  const fn = (async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    return out[cmd] ?? null;
  }) as Exec & { calls: string[][] };
  fn.calls = calls;
  return fn;
};

describe('openObjectStore', () => {
  it('resolves relative file:// URLs against the bundle directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iw-open-'));
    try {
      const store = openObjectStore({ url: 'file://../store' }, { bundleDir: join(dir, '.indx-watch') });
      expect(store.url).toBe('file://../store');
      await store.put('indx-watch-store.json', '{}');
      expect(await readFile(join(dir, 'store', 'indx-watch-store.json'), 'utf8')).toBe('{}');
      const abs = openObjectStore({ url: `file://${join(dir, 'abs')}` }, { bundleDir: dir });
      await abs.put('x', 'y');
      expect(await readFile(join(dir, 'abs', 'x'), 'utf8')).toBe('y');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects workspace mode (v0.2) and unknown schemes', () => {
    expect(() =>
      openObjectStore({ url: 'file://../store', mode: 'workspace' }, { bundleDir: '/tmp' }),
    ).toThrow(/workspace/);
  });

  it('opens s3:// with env credentials, endpoint and prefix', async () => {
    const s3 = await startFakeS3('shop-results');
    try {
      const env = {
        AWS_ACCESS_KEY_ID: 'test-key-id',
        AWS_SECRET_ACCESS_KEY: 'test-secret',
        AWS_REGION: 'auto',
      };
      const store = openObjectStore(
        { url: 's3://shop-results/watch', endpoint: s3.url },
        { bundleDir: '/tmp', env },
      );
      expect(store.url).toBe('s3://shop-results/watch');
      await store.put('k', 'v');
      expect([...s3.objects.keys()]).toEqual(['watch/k']);
      expect(String(s3.requests[0]!.headers.authorization)).toContain('/auto/s3/aws4_request');
      expect(() => openObjectStore({ url: 's3://shop-results' }, { bundleDir: '/tmp', env: {} })).toThrow(
        /AWS_ACCESS_KEY_ID/,
      );
    } finally {
      await s3.close();
    }
  });

  it('opens https:// with the IW_ACCESS_TOKEN header', async () => {
    const srv = await startStoreServer({ token: 'test-token' });
    try {
      const store = openObjectStore(
        { url: srv.url },
        { bundleDir: '/tmp', env: { IW_ACCESS_TOKEN: 'test-token' } },
      );
      expect(await store.put('a', 'b', { ifNoneMatch: true })).toBe(true);
      expect(await store.put('a', 'b', { ifNoneMatch: true })).toBe(false);
    } finally {
      await srv.close();
    }
  });

  it('keeps the index in cache/index.sqlite across opens, or in memory with { memory: true }', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iw-index-'));
    try {
      const run = runRecord();
      await (await openNodeIndex(dir)).ingest([run], 'v1/log/A.json');
      await (await openNodeIndex(dir, { memory: true })).ingest([runRecord()]);
      expect(await (await openNodeIndex(dir)).records()).toEqual([run]);
      expect((await stat(join(dir, 'cache', 'index.sqlite'))).isFile()).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('empties an index file written with another schema, then works in the current one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iw-index-'));
    try {
      await openNodeIndex(dir);
      const old = new DatabaseSync(join(dir, 'cache', 'index.sqlite'));
      old.exec(
        'DROP TABLE IF EXISTS records; CREATE TABLE records (id TEXT PRIMARY KEY); PRAGMA user_version = 1',
      );
      old.close();
      const run = runRecord();
      await (await openNodeIndex(dir)).ingest([run], 'v1/log/A.json');
      expect(await (await openNodeIndex(dir)).records()).toEqual([run]);
      const db = new DatabaseSync(join(dir, 'cache', 'index.sqlite'));
      expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION });
      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('drops only the node:sqlite ExperimentalWarning while loading it', async () => {
    const [emit, seen] = [process.emitWarning, [] as unknown[]];
    process.emitWarning = ((w: string) => void seen.push(w)) as typeof emit;
    try {
      await withoutSqliteWarning(async () => {
        process.emitWarning(
          'SQLite is an experimental feature and might change at any time',
          'ExperimentalWarning',
        );
        process.emitWarning('something else');
        process.emitWarning('SQLite file is busy');
      });
    } finally {
      process.emitWarning = emit;
    }
    expect(seen).toEqual(['something else', 'SQLite file is busy']);
  });
});

describe('awsCredentials', () => {
  it('prefers env keys, then `aws configure export-credentials` for AWS_PROFILE', () => {
    const calls: string[][] = [];
    const sso = JSON.stringify({
      Version: 1,
      AccessKeyId: 'ASIAEXAMPLE',
      SecretAccessKey: 'sso-secret',
      SessionToken: 'tok',
    });
    const run: ExecSync = (cmd, args) => {
      calls.push([cmd, ...args]);
      return cmd === 'aws' ? sso : null;
    };
    const env = {
      AWS_ACCESS_KEY_ID: 'k',
      AWS_SECRET_ACCESS_KEY: 's',
      AWS_SESSION_TOKEN: 't',
      AWS_PROFILE: 'p',
    };
    expect(awsCredentials(env, run)).toEqual({ accessKeyId: 'k', secretAccessKey: 's', sessionToken: 't' });
    expect(calls).toEqual([]);
    expect(awsCredentials({ AWS_PROFILE: 'shop-sso' }, run)).toEqual({
      accessKeyId: 'ASIAEXAMPLE',
      secretAccessKey: 'sso-secret',
      sessionToken: 'tok',
    });
    expect(calls).toEqual([
      ['aws', 'configure', 'export-credentials', '--profile', 'shop-sso', '--format', 'process'],
    ]);
    expect(() => awsCredentials({ AWS_PROFILE: 'x' }, () => null)).toThrow(/AWS_PROFILE=x/);
    expect(() => awsCredentials({}, () => null)).toThrow(/AWS_ACCESS_KEY_ID/);
  });
});

describe('accessHeaders', () => {
  it('uses IW_ACCESS_TOKEN, then a service token, then cloudflared', async () => {
    const run = fakeExec({ cloudflared: 'eyJ.token.sig\n' });
    expect(await accessHeaders('https://watch.shop.test', { IW_ACCESS_TOKEN: 't' }, run)).toEqual({
      'cf-access-token': 't',
    });
    expect(
      await accessHeaders(
        'https://watch.shop.test',
        { CF_ACCESS_CLIENT_ID: 'id', CF_ACCESS_CLIENT_SECRET: 'sec' },
        run,
      ),
    ).toEqual({
      'CF-Access-Client-Id': 'id',
      'CF-Access-Client-Secret': 'sec',
    });
    expect(await accessHeaders('https://watch.shop.test', {}, run)).toEqual({
      'cf-access-token': 'eyJ.token.sig',
    });
    expect(run.calls).toEqual([['cloudflared', 'access', 'token', '-app=https://watch.shop.test']]);
    expect(await accessHeaders('http://127.0.0.1:4317', {}, run)).toEqual({});
    expect(await accessHeaders('https://watch.shop.test', {}, fakeExec({}))).toEqual({});
  });

  it('sends credentials only over https:// or to this machine', async () => {
    const service = { CF_ACCESS_CLIENT_ID: 'id', CF_ACCESS_CLIENT_SECRET: 'sec' };
    for (const env of [service, { IW_ACCESS_TOKEN: 't' }])
      await expect(accessHeaders('http://watch.shop.test', env, fakeExec({}))).rejects.toMatchObject({
        code: 'invalid',
        message: expect.stringMatching(/insecure store URL/),
      });
    await expect(accessHeaders('http://127.0.0.1.evil.test', service)).rejects.toMatchObject({
      code: 'invalid',
    });
    expect(await accessHeaders('http://localhost:4317/', service)).toMatchObject({
      'CF-Access-Client-Id': 'id',
    });
    expect(await accessHeaders('http://watch.shop.test', {}, fakeExec({}))).toEqual({});
  });
});
