import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectInfo, RunSummary, TestCaseDetail } from '../src/index.js';
import { requestIdentity, startNodeServer, writeGuard } from '../src/node.js';
import { ROOT, SHOT, sampleRecords, shop } from './helpers.js';

const env = { IW_ACTOR: 'alex@shop.test', IW_ACTOR_NAME: 'Alex' };
let tmp: string;
let dir: string;
let web: string;
let server: { url: string; close(): Promise<void> };
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of [...Object.keys(env), 'CLAUDECODE', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'IW_ACTOR_KIND'])
    saved[k] = process.env[k];
  Object.assign(process.env, env);
  for (const k of ['CLAUDECODE', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'IW_ACTOR_KIND'])
    delete process.env[k];
  tmp = mkdtempSync(join(tmpdir(), 'iw-server-'));
  dir = join(tmp, '.indx-watch');
  cpSync(join(ROOT, 'examples/shop/.indx-watch'), dir, {
    recursive: true,
    filter: (p) => !/[/\\](runs|cache)$/.test(p),
  });
  cpSync(join(ROOT, 'examples/shop/store'), join(tmp, 'store'), { recursive: true });
  web = join(tmp, 'web');
  mkdirSync(join(web, 'assets'), { recursive: true });
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>INDX Watch</title>');
  writeFileSync(join(web, 'assets/app.js'), 'console.log(1)');
  writeFileSync(join(web, '_headers'), 'secret');
  server = await startNodeServer({ dir, port: 0, sync: false, webRoot: web });
});
afterAll(async () => {
  await server?.close();
  rmSync(tmp, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
});

const api = async <T>(path: string, init?: RequestInit) => {
  const res = await fetch(`${server.url}${path}`, init);
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
};
const until = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out');
};

describe('startNodeServer', () => {
  it('serves the API with the process identity and the store configuration', async () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const p = await api<ProjectInfo>('/api/project');
    expect(p.identity).toMatchObject({ kind: 'human', id: 'alex@shop.test', name: 'Alex', via: 'env' });
    expect(p.mode).toBe('local');
    expect(p.sync).toMatchObject({ configured: false, store: 'file://../store' }); // sync: false
  });

  it('serves the SPA with fallback and a CSP, but not underscore files', async () => {
    const index = await fetch(`${server.url}/some/where`);
    expect(await index.text()).toContain('<title>INDX Watch</title>');
    expect(index.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(await (await fetch(`${server.url}/assets/app.js`)).text()).toBe('console.log(1)');
    expect(await (await fetch(`${server.url}/_headers`)).text()).not.toBe('secret');
    expect((await fetch(`${server.url}/api/nothing`)).status).toBe(404);
  });

  it('writes runs to the local replica and refreshes the model', async () => {
    const up = await api<{ sha256: string }>('/api/blobs', {
      method: 'POST',
      body: SHOT,
      headers: { 'content-type': 'image/png' },
    });
    const res = await api<{ run: { id: string; actor: { id: string } } }>('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        test_case: 'TC-8',
        steps: [{ index: 1, status: 'pass', evidence: [up.sha256] }],
        verdict: 'pass',
      }),
    });
    expect(res.run.actor.id).toBe('alex@shop.test');
    const month = new Date().toISOString().slice(0, 7);
    expect(readFileSync(join(dir, 'runs/records', month, `${res.run.id}.json`), 'utf8')).toContain(
      '"source":"manual"',
    );
    const tc = await api<TestCaseDetail>('/api/test-cases/TC-8');
    expect(tc.status.status).toBe('pass');
  });

  it('picks up records written by other processes and bundle edits', async () => {
    const b = await shop();
    const r = sampleRecords(b).find((x) => x.kind === 'run' && x.test_case.key === 'TC-4')!;
    mkdirSync(join(dir, 'runs/records/2024-12'), { recursive: true });
    writeFileSync(join(dir, 'runs/records/2024-12', `${r.id}.json`), JSON.stringify(r));
    await until(async () => (await api<RunSummary[]>('/api/runs?tc=TC-4')).length === 1);

    const file = join(dir, 'specs/FEAT-1-catalog/UC-1-shopper-finds-product/TC-1-product-list.toml');
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace(
        'title = "Product list shows names and prices"',
        'title = "Product list"',
      ),
    );
    await until(
      async () => (await api<TestCaseDetail>('/api/test-cases/TC-1')).data.title === 'Product list',
    );
  });

  it('syncs in the background when [store] is configured', async () => {
    const synced = await startNodeServer({ dir, port: 0, webRoot: web });
    try {
      const post = { method: 'POST', headers: { 'content-type': 'application/json' } };
      const body = JSON.stringify({ test_case: 'TC-1', steps: [], verdict: 'pass' });
      expect((await fetch(`${synced.url}/api/runs`, { ...post, body })).status).toBe(201);
      await until(
        async () =>
          existsSync(join(tmp, 'store/v1/log')) && readdirSync(join(tmp, 'store/v1/log')).length > 0,
      );
      const info = (await (await fetch(`${synced.url}/api/project`)).json()) as ProjectInfo;
      expect(info.sync).toMatchObject({ configured: true, store: 'file://../store' });
      expect(info.sync.lastSyncAt).toBeTruthy();
    } finally {
      await synced.close();
    }
  });

  it('rejects writes from other machines without an identity header (403)', async () => {
    const ip = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
    if (ip) {
      const lan = await startNodeServer({ dir, port: 0, host: '0.0.0.0', sync: false, webRoot: web });
      try {
        const url = lan.url.replace('127.0.0.1', ip);
        expect((await fetch(`${url}/api/project`)).status).toBe(200);
        const post = await fetch(`${url}/api/blobs`, { method: 'POST', body: 'x' });
        expect(post.status).toBe(403);
        expect((await fetch(`${lan.url}/api/blobs`, { method: 'POST', body: 'x' })).status).toBe(201);
      } finally {
        await lan.close();
      }
    }
    expect(writeGuard('POST', '10.0.0.7')?.status).toBe(403);
    expect(writeGuard('GET', '10.0.0.7')).toBeUndefined();
    expect(writeGuard('POST', '::1')).toBeUndefined();
    expect(writeGuard('POST', '::ffff:127.0.0.1')).toBeUndefined();
    expect(writeGuard('POST', '10.0.0.7', 'X-Forwarded-Email')).toBeUndefined();
  });

  it('resolves identities: header, loopback process identity, read-only guests', async () => {
    const remote = new WeakMap<Request, string>();
    const local = {
      current: async () => ({ kind: 'human' as const, id: 'op@shop.test', via: 'git' as const }),
    };
    const id = requestIdentity(remote, local, 'X-Forwarded-Email');
    const mk = (addr: string, init?: RequestInit) => {
      const r = new Request('http://x/api/runs', init);
      remote.set(r, addr);
      return r;
    };
    const hdr = { 'x-forwarded-email': 'kim@shop.test' };
    expect(await id.current(mk('10.0.0.7', { headers: hdr }))).toEqual({
      kind: 'human',
      id: 'kim@shop.test',
      via: 'env',
    });
    expect((await id.current(mk('127.0.0.1'))).id).toBe('op@shop.test');
    expect((await id.current(mk('10.0.0.7'))).id).toBe('guest');
    await expect(id.current(mk('10.0.0.7', { method: 'POST', body: '{}' }))).rejects.toThrow(
      /X-Forwarded-Email/,
    );
  });
});
