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
import { request } from 'node:http';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyState } from '@indx-watch/sync';
import { fileStateStore } from '@indx-watch/sync/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectInfo, RunSummary, TestCaseDetail } from '../src/index.js';
import { hostGuard, requestIdentity, startNodeServer, writeGuard } from '../src/node.js';
import { ROOT, SHOT, sampleRecords, shop } from './helpers.js';

/** The store `[store]` in examples/shop points at, relative to the bundle. */
const STORE_URL = 'file://../store';
const LAN_IP = '10.0.0.7';
const ALEX_ID = 'alex@shop.test';
const env = { IW_ACTOR: ALEX_ID, IW_ACTOR_NAME: 'Alex' };
/** the runner's agent and CI context must not leak into the server (a PR build has no release for manual runs) */
const UNSET = ['CLAUDECODE', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'IW_ACTOR_KIND', 'IW_RELEASE', 'CI'];
UNSET.push('GITHUB_ACTIONS', 'GITHUB_REF', 'GITHUB_HEAD_REF', 'GITHUB_EVENT_PATH', 'GITHUB_SHA');
let tmp: string;
let dir: string;
let web: string;
let server: { url: string; close(): Promise<void> };
const saved: Record<string, string | undefined> = {};

/** Copies examples/shop (bundle without runs/cache, plus the sample store) into `to`; returns the bundle dir. */
function copyShop(to: string): string {
  const at = join(to, '.indx-watch');
  cpSync(join(ROOT, 'examples/shop/.indx-watch'), at, {
    recursive: true,
    filter: (p) => !/[/\\](runs|cache)$/.test(p),
  });
  cpSync(join(ROOT, 'examples/shop/store'), join(to, 'store'), { recursive: true });
  return at;
}

beforeAll(async () => {
  for (const k of [...Object.keys(env), ...UNSET]) saved[k] = process.env[k];
  Object.assign(process.env, env);
  for (const k of UNSET) delete process.env[k];
  tmp = mkdtempSync(join(tmpdir(), 'iw-server-'));
  dir = copyShop(tmp);
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

describe('startNodeServer: API and SPA', () => {
  it('serves the API with the process identity and the store configuration', async () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const p = await api<ProjectInfo>('/api/project');
    expect(p.identity).toMatchObject({ kind: 'human', id: ALEX_ID, name: 'Alex', via: 'env' });
    expect(p.mode).toBe('local');
    expect(p.sync).toMatchObject({ configured: false, store: STORE_URL }); // sync: false
  });

  it('serves the SPA with fallback and a CSP, but not underscore files', async () => {
    const index = await fetch(`${server.url}/some/where`);
    expect(await index.text()).toContain('<title>INDX Watch</title>');
    expect(index.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(await (await fetch(`${server.url}/assets/app.js`)).text()).toBe('console.log(1)');
    expect(await (await fetch(`${server.url}/_headers`)).text()).not.toBe('secret');
    expect((await fetch(`${server.url}/api/nothing`)).status).toBe(404);
  });
});

describe('startNodeServer: records and bundle edits', () => {
  it('writes runs to the local replica and refreshes the model', async () => {
    const up = await api<{ sha256: string }>('/api/blobs', {
      method: 'POST',
      body: SHOT,
      headers: { 'content-type': 'image/png', 'x-iw-request': '1' },
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
    expect(res.run.actor.id).toBe(ALEX_ID);
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
});

describe('startNodeServer: sync state', () => {
  it('shows record conflicts that an earlier sync saved, right after a start', async () => {
    const copy = mkdtempSync(join(tmpdir(), 'iw-server-conflict-'));
    const at = copyShop(copy);
    const id = 'run_01JF7Z3K0W8N2Q4R6S8T0V0001';
    const note = `record ${id} in v1/log/01JF7Z3K0W8N2Q4R6S8T0V0000.json differs from the local copy; kept the local copy`;
    await (await fileStateStore(at, STORE_URL)).save({ ...emptyState(), conflicts: { [id]: note } });
    const started = await startNodeServer({ dir: at, port: 0, sync: false, webRoot: web });
    try {
      const p = (await (await fetch(`${started.url}/api/project`)).json()) as ProjectInfo;
      expect(p.problems.map((x) => x.message)).toContain(note);
    } finally {
      await started.close();
      rmSync(copy, { recursive: true, force: true });
    }
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
      // The log object is written inside syncOnce; lastSyncAt is set after it returns, so wait for that too.
      const project = async () => (await (await fetch(`${synced.url}/api/project`)).json()) as ProjectInfo;
      await until(async () => !!(await project()).sync.lastSyncAt);
      expect((await project()).sync).toMatchObject({ configured: true, store: STORE_URL });
    } finally {
      await synced.close();
    }
  });
});

describe('startNodeServer: write, host and port guards', () => {
  it('rejects writes from other machines without an identity header (403)', async () => {
    const ip = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
    if (ip) {
      const lan = await startNodeServer({ dir, port: 0, host: '0.0.0.0', sync: false, webRoot: web });
      try {
        const url = lan.url.replace('127.0.0.1', ip);
        expect((await fetch(`${url}/api/project`)).status).toBe(200);
        const init = { method: 'POST', body: 'x', headers: { 'x-iw-request': '1' } };
        expect((await fetch(`${url}/api/blobs`, init)).status).toBe(403);
        expect((await fetch(`${lan.url}/api/blobs`, init)).status).toBe(201);
      } finally {
        await lan.close();
      }
    }
    expect(writeGuard('POST', LAN_IP)?.status).toBe(403);
    expect(writeGuard('GET', LAN_IP)).toBeUndefined();
    expect(writeGuard('POST', '::1')).toBeUndefined();
    expect(writeGuard('POST', '::ffff:127.0.0.1')).toBeUndefined();
    expect(writeGuard('POST', LAN_IP, 'X-Forwarded-Email')).toBeUndefined();
  });

  it('answers only requests addressed to a loopback name (DNS rebinding)', async () => {
    const port = new URL(server.url).port;
    const get = (host: string) =>
      new Promise<number>((ok, no) =>
        request({ host: '127.0.0.1', port, path: '/api/project', headers: { host } }, (r) => {
          r.resume();
          ok(r.statusCode ?? 0);
        })
          .on('error', no)
          .end(),
      );
    expect(await get(`attacker.example:${port}`)).toBe(403);
    expect(await get('127.0.0.1')).toBe(403);
    expect(await get(`localhost:${port}`)).toBe(200);
    expect(hostGuard(`[::1]:${port}`, Number(port))).toBeUndefined();
    expect(hostGuard(`127.0.0.1:${port}`, Number(port))).toBeUndefined();
    expect(hostGuard(null, Number(port))?.status).toBe(403);
  });

  it('fails fast with a clear error when the port is taken', async () => {
    const port = Number(new URL(server.url).port);
    const t0 = Date.now();
    const err = await startNodeServer({ dir, port, sync: false, webRoot: web }).catch((e) => e);
    expect(err).toMatchObject({ code: 'CONFLICT', message: expect.stringMatching(/already in use.*--port/) });
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('requestIdentity', () => {
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
    expect(await id.current(mk(LAN_IP, { headers: hdr }))).toEqual({
      kind: 'human',
      id: 'kim@shop.test',
      via: 'env',
    });
    expect((await id.current(mk('127.0.0.1'))).id).toBe('op@shop.test');
    expect((await id.current(mk(LAN_IP))).id).toBe('guest');
    await expect(id.current(mk(LAN_IP, { method: 'POST', body: '{}' }))).rejects.toThrow(/X-Forwarded-Email/);
  });
});
