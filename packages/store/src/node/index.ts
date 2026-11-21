/**
 * Node-side factories. CONTRACT: signatures frozen.
 */
import { type FSWatcher, watch as fsWatch, mkdirSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { StoreConfig } from '@indx-watch/bundle';
import { httpObjectStore } from '../adapters/http.js';
import { memoryIndex } from '../adapters/memory.js';
import { s3ObjectStore } from '../adapters/s3.js';
import type { Index, LocalReplica, ObjectStore } from '../ports.js';
import { StoreError } from '../ports.js';
import { createReplica } from '../replica.js';
import { compact } from '../util.js';
import { exec as defaultExec, type ExecSync, execSync } from './exec.js';
import { fsObjectStore } from './fs-store.js';
import { sqliteIndex } from './sqlite-index.js';

export { browserRun, type Chromium, loadChromium, playwrightBrowser } from './browser.js';
export type { Exec, ExecSync } from './exec.js';
export { fsObjectStore } from './fs-store.js';
export { isAgentEnv, processContext, processIdentity } from './identity.js';
export { indexedRecords, REPLICA_META } from './replica-index.js';
export { sqliteIndex } from './sqlite-index.js';

type Env = Record<string, string | undefined>;
type Credentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };

const creds = (accessKeyId: string, secretAccessKey: string, sessionToken?: string): Credentials =>
  compact({ accessKeyId, secretAccessKey, sessionToken });

/**
 * AWS credentials: environment variables, else `aws configure export-credentials --format process` for AWS_PROFILE
 * (SSO included). Runs synchronously, once, when the store is opened.
 */
export function awsCredentials(env: Env, run: ExecSync = execSync): Credentials {
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    return creds(env.AWS_ACCESS_KEY_ID, env.AWS_SECRET_ACCESS_KEY, env.AWS_SESSION_TOKEN);
  }
  if (!env.AWS_PROFILE) {
    throw new StoreError(
      'unauthorized',
      'S3 store needs AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY or AWS_PROFILE',
    );
  }
  const args = ['configure', 'export-credentials', '--profile', env.AWS_PROFILE, '--format', 'process'];
  try {
    const j = JSON.parse(run('aws', args, { ...process.env, ...env }) ?? '');
    if (j.AccessKeyId && j.SecretAccessKey) return creds(j.AccessKeyId, j.SecretAccessKey, j.SessionToken);
  } catch {}
  throw new StoreError('unauthorized', `no credentials from aws CLI for AWS_PROFILE=${env.AWS_PROFILE}`);
}

/**
 * Headers for a hosted server behind Cloudflare Access: IW_ACCESS_TOKEN → service token → cloudflared.
 * Credentials go only over https:// (or plain http to this machine, for tests); any other http URL is refused.
 */
export async function accessHeaders(
  url: string,
  env: Env,
  run = defaultExec,
): Promise<Record<string, string>> {
  const secure = /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$))/.test(url);
  if (!secure && (env.IW_ACCESS_TOKEN || (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET)))
    throw new StoreError(
      'invalid',
      `insecure store URL ${url}: Access credentials are sent only over https://`,
    );
  if (env.IW_ACCESS_TOKEN) return { 'cf-access-token': env.IW_ACCESS_TOKEN };
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    return {
      'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET,
    };
  }
  if (!url.startsWith('https://')) return {};
  const args = ['access', 'token', `-app=${url}`];
  const token = (await run('cloudflared', args, { env: { ...process.env, ...env } }))?.trim();
  return token && !/\s/.test(token) ? { 'cf-access-token': token } : {};
}

/** ObjectStore for a store URL (file://, s3://, https://). file:// paths resolve relative to bundleDir. */
export function openObjectStore(
  config: StoreConfig,
  opts: { bundleDir: string; env?: Record<string, string | undefined> },
): ObjectStore {
  const env = opts.env ?? process.env;
  if (config.mode === 'workspace') {
    throw new StoreError('invalid', '[store] mode = "workspace" is planned for v0.2; use git mode');
  }
  const url = config.url;
  if (url.startsWith('file://')) {
    const p = decodeURIComponent(url.slice('file://'.length));
    return fsObjectStore(isAbsolute(p) ? p : resolve(opts.bundleDir, p), url);
  }
  if (url.startsWith('s3://')) {
    const [bucket = '', ...rest] = url.slice('s3://'.length).split('/');
    if (!bucket) throw new StoreError('invalid', `invalid store URL ${url}`);
    const { endpoint, force_path_style: forcePathStyle } = config;
    const region = config.region ?? env.AWS_REGION ?? env.AWS_DEFAULT_REGION;
    const credentials = awsCredentials(env);
    return s3ObjectStore({ bucket, prefix: rest.join('/'), endpoint, region, forcePathStyle, credentials });
  }
  if (url.startsWith('https://') || url.startsWith('http://')) {
    let h: Promise<Record<string, string>> | undefined;
    return httpObjectStore({
      baseUrl: url,
      headers: () => (h ??= accessHeaders(url.replace(/\/+$/, ''), env)),
    });
  }
  throw new StoreError('invalid', `unsupported store URL ${url}`);
}

/** Local replica at <bundleDir>/runs/ (docs/spec/sync.md#local-replica-layout). */
export function openReplica(bundleDir: string): LocalReplica {
  const root = join(bundleDir, 'runs');
  // Writes by other processes (the Playwright reporter, for example) are noticed by watching runs/records/ and each
  // month directory. A recursive watch is set up asynchronously on Linux and misses writes right after it starts,
  // so each directory gets its own watcher, synchronously.
  return createReplica(fsObjectStore(root), (notify) => {
    const records = join(root, 'records');
    const watchers = new Map<string, FSWatcher>();
    const add = (dir: string) => {
      if (watchers.has(dir)) return;
      try {
        const w = fsWatch(dir, (_e, name) => {
          if (!name || String(name).startsWith('.')) return;
          if (dir === records) add(join(records, String(name)));
          notify();
        });
        w.on('error', () => {});
        watchers.set(dir, w);
      } catch {}
    };
    try {
      mkdirSync(records, { recursive: true });
      add(records);
      for (const m of readdirSync(records)) if (!m.startsWith('.')) add(join(records, m));
    } catch {}
    return () => {
      for (const w of watchers.values()) w.close();
    };
  });
}

/** Index on Node: a node:sqlite file at <bundleDir>/cache/index.sqlite (safe to delete), or in memory. */
export async function openNodeIndex(bundleDir: string, opts?: { memory?: boolean }): Promise<Index> {
  if (opts?.memory) return memoryIndex();
  const cache = join(resolve(bundleDir), 'cache');
  mkdirSync(cache, { recursive: true });
  return sqliteIndex(join(cache, 'index.sqlite'));
}
