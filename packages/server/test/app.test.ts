import type { AnyRecord, JudgementRecord, RunRecord } from '@indx-watch/bundle';
import { buildVerifiedModel } from '@indx-watch/core';
import { createResultStore, httpObjectStore, memoryObjectStore } from '@indx-watch/store';
import { accessIdentity } from '@indx-watch/store/workers';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  FixtureDetail,
  ManualRunResult,
  PlanView,
  ProjectInfo,
  ReviewResult,
  RunDetail,
  RunSummary,
  SpecTree,
  StatusResult,
  StoreListResponse,
  TestCaseDetail,
} from '../src/index.js';
import { createApp } from '../src/index.js';
import { ALEX, fakeDeps, req, SAM, SHOT, SHOT_SHA, sampleRecords, shop } from './helpers.js';

const app = async (o: Parameters<typeof fakeDeps>[0] = {}) => {
  const f = await fakeDeps(o);
  return { ...f, app: createApp(f.deps) };
};
const get = async <T>(a: { fetch(r: Request): Promise<Response> }, path: string) => {
  const res = await a.fetch(req(path));
  expect(res.status, `${path}: ${res.status}`).toBe(200);
  return (await res.json()) as T;
};

describe('read routes', () => {
  it('GET /healthz and /api/project', async () => {
    const { app: a } = await app();
    expect(await get(a, '/healthz')).toEqual({ ok: true });
    const p = await get<ProjectInfo>(a, '/api/project');
    expect(p.project).toMatchObject({
      key: 'SHOP',
      current_release: 'v1.2.0',
      default_environment: 'staging',
    });
    expect(p.identity).toEqual(ALEX);
    expect(p.mode).toBe('local');
    expect(p.sync).toEqual({ configured: false });
    expect(p.environments[0]).toMatchObject({ name: 'staging', access: 'public' });
  });

  it('GET /api/status defaults to the current release and filters by env', async () => {
    const { app: a } = await app();
    const s = await get<StatusResult>(a, '/api/status');
    expect(s.scope).toEqual({ release: 'v1.2.0' });
    const byKey = Object.fromEntries(s.testCases.map((t) => [t.key, t.status]));
    expect(byKey).toMatchObject({
      'TC-1': 'pass',
      'TC-2': 'waived',
      'TC-4': 'fail',
      'TC-6': 'needs_review',
      'TC-8': 'stale',
    });
    const other = await get<StatusResult>(a, '/api/status?env=production');
    expect(other.testCases.every((t) => t.status === 'untested')).toBe(true);
  });

  it('GET /api/specs builds the tree and marks outdated translations stale', async () => {
    const bundle = await shop();
    const tc4 = bundle.testCases.find((t) => t.data.key === 'TC-4')!;
    tc4.data = { ...tc4.data, title: 'Expired coupon is refused' };
    const { app: a } = await app({ bundle });
    const tree = await get<SpecTree>(a, '/api/specs');
    const uc2 = tree.features.flatMap((f) => f.useCases).find((u) => u.key === 'UC-2')!;
    expect(uc2).toMatchObject({ priority: 'P0', status: 'fail', done: false });
    const tcs = uc2.criteria.flatMap((c) => c.testCases);
    expect(tcs.map((t) => [t.key, t.status, t.lifecycle])).toEqual([
      ['TC-3', 'pass', 'ready'],
      ['TC-4', 'fail', 'ready'],
    ]);
    expect((tcs[1]!.i18n as { ja: { status: string } }).ja.status).toBe('stale');
    const tc8 = tree.features.flatMap((f) =>
      f.useCases.flatMap((u) => u.criteria.flatMap((c) => c.testCases)),
    );
    expect((tc8.find((t) => t.key === 'TC-8')!.i18n as { ja: { status: string } }).ja.status).toBe('machine');
  });

  it('GET /api/test-cases/:key with fixture values, never secrets', async () => {
    const { app: a } = await app();
    const tc3 = await get<TestCaseDetail>(a, '/api/test-cases/TC-3');
    expect(tc3).toMatchObject({ key: 'TC-3', priority: 'P0', useCase: 'UC-2' });
    expect(tc3.fixtures[0]).toMatchObject({
      key: 'FX-1',
      rows: ['SUMMER10'],
      values: [{ code: 'SUMMER10' }],
    });
    expect(tc3.status.status).toBe('pass');
    expect(tc3.runs).toHaveLength(1);
    const tc8 = await get<TestCaseDetail>(a, '/api/test-cases/tc_01JF3Q8M5X2V7K9D4R6T1W0Y38');
    expect(tc8.fixtures[0]!.values).toEqual([{ username: 'casey@shop.test' }]);
    const res = await a.fetch(req('/api/test-cases/TC-99'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not-found', message: 'test case TC-99 not found' } });
  });

  it('GET /api/fixtures and /api/fixtures/:key', async () => {
    const { app: a } = await app();
    const all = await get<FixtureDetail[]>(a, '/api/fixtures');
    expect(all.map((f) => f.key)).toEqual(['FX-1', 'FX-2', 'FX-3', 'FX-4']);
    const fx1 = await get<FixtureDetail>(a, '/api/fixtures/FX-1');
    expect(fx1.preview?.rows).toHaveLength(2);
    expect(fx1.usedBy).toEqual(['TC-3', 'TC-4']);
    const fx2 = all.find((f) => f.key === 'FX-2')!;
    expect(fx2.preview?.text).toContain('Canvas Tote');
    expect(all.find((f) => f.key === 'FX-3')!.preview).toEqual({
      rows: [{ username: 'casey@shop.test', secret_ref: 'env:SHOP_CUSTOMER_PASSWORD' }],
    });
    expect(all.find((f) => f.key === 'FX-4')!.files[0]).toMatchObject({
      pointer: true,
      media_type: 'image/png',
      sha256: SHOT_SHA,
    });
    expect((await a.fetch(req('/api/fixtures/FX-9'))).status).toBe(404);
  });

  it('GET /api/plans and /api/plans/:key compute item status', async () => {
    const { app: a } = await app();
    expect((await get<PlanView[]>(a, '/api/plans')).map((p) => p.key)).toEqual(['PLAN-1']);
    const plan = await get<PlanView>(a, '/api/plans/PLAN-1');
    const st = Object.fromEntries(plan.items.map((i) => [i.test_case, i.status]));
    expect(st).toEqual({
      'TC-6': 'review',
      'TC-8': 'review',
      'TC-9': 'todo',
      'TC-3': 'done',
      'TC-4': 'done',
      'TC-5': 'done',
      'TC-7': 'done',
    });
    expect(plan.items[1]).toMatchObject({ environment: 'staging', due: '2026-11-28' });
    expect((await a.fetch(req('/api/plans/PLAN-9'))).status).toBe(404);
  });

  it('GET /api/runs and /api/runs/:id', async () => {
    const { app: a } = await app();
    const runs = await get<RunSummary[]>(a, '/api/runs?release=v1.2.0&limit=3');
    expect(runs).toHaveLength(3);
    const tc8 = await get<RunSummary[]>(a, '/api/runs?tc=TC-8');
    expect(tc8[0]).toMatchObject({ testCase: 'TC-8', stale: true, verdict: 'pass', rule: 1 });
    const d = await get<RunDetail>(a, `/api/runs/${tc8[0]!.id}`);
    expect(d.testCase).toMatchObject({ key: 'TC-8', title: 'Wrong password is rejected' });
    expect(d.testCase.currentVersion).not.toBe(d.record.test_case.version);
    expect((await a.fetch(req(`/api/runs/${tc8[0]!.id.slice(0, 26)}`))).status).toBe(404); // ambiguous prefix
    expect((await a.fetch(req('/api/runs/run_01JF7Z3K0W8N2Q4R6S8T0V9999'))).status).toBe(404);
  });

  it('marks records that claim a verified via without a signature as unverified (runs, run, report)', async () => {
    const f = await fakeDeps();
    const records = sampleRecords(f.bundle);
    f.deps.loadModel = async () => ({
      model: (await buildVerifiedModel(f.bundle, records)).model,
      problems: [],
    });
    const a = createApp(f.deps);
    const runs = await get<RunSummary[]>(a, '/api/runs?release=v1.2.0');
    const tc1 = runs.find((r) => r.testCase === 'TC-1')!;
    expect(tc1).toMatchObject({ actor: { via: 'github' }, unverified: true });
    expect(runs.find((r) => r.testCase === 'TC-7')).not.toHaveProperty('unverified'); // via = "git" is self-asserted
    expect((await get<RunDetail>(a, `/api/runs/${tc1.id}`)).unverified).toContain(tc1.id);
    const md = await (await a.fetch(req('/api/report?format=md'))).text();
    expect(md).toContain('octocat (ci) · unverified');
  });
});

describe('manual runs and reviews', () => {
  it('records a manual run: actor from identity, human judgement, fixture versions, release by refs', async () => {
    const f = await app();
    f.setBuild({ commit: 'a1b2c3d', ref: 'refs/heads/release/1.2' }, { provider: 'github' });
    const up = await f.app.fetch(
      req('/api/blobs', {
        method: 'POST',
        body: SHOT,
        headers: { 'content-type': 'image/png', 'x-filename': 'wrong.png' },
      }),
    );
    expect(up.status).toBe(201);
    const blob = (await up.json()) as { sha256: string };
    const res = await f.app.fetch(
      req('/api/runs', {
        json: {
          test_case: 'TC-8',
          environment: 'staging',
          locale: 'ja',
          started_at: '2026-11-18T23:58:00Z',
          actor: SAM, // ignored: the actor comes from the server
          steps: [
            { index: 1, status: 'fail', note: 'Shows "Something went wrong"', evidence: [blob.sha256] },
            { index: 2, status: 'pass' },
          ],
          verdict: 'fail',
          note: 'Wrong error message',
        },
      }),
    );
    expect(res.status).toBe(201);
    const { run, decision } = (await res.json()) as ManualRunResult;
    expect(decision).toMatchObject({ verdict: 'fail', rule: 1 });
    expect(f.written).toEqual([run]);
    const tc8 = f.bundle.testCases.find((t) => t.data.key === 'TC-8')!;
    const fx3 = f.bundle.fixtures.find((x) => x.data.key === 'FX-3')!;
    expect(run).toMatchObject({
      actor: ALEX,
      source: 'manual',
      release: 'v1.2.0',
      environment: 'staging',
      locale: 'ja',
      reported: null,
      build: { commit: 'a1b2c3d', ref: 'refs/heads/release/1.2' },
      ci: { provider: 'github' },
      test_case: { id: tc8.data.id, key: 'TC-8', version: tc8.version },
      fixtures: [{ id: fx3.data.id, key: 'FX-3', version: fx3.version }],
      started_at: '2026-11-18T23:58:00Z',
      ended_at: '2026-11-19T00:00:00Z',
    });
    expect(run.evidence).toEqual([
      {
        sha256: SHOT_SHA,
        name: 'wrong.png',
        media_type: 'image/png',
        size: SHOT.byteLength,
        kind: 'screenshot',
        step: 1,
      },
    ]);
    expect(run.judgements).toEqual([
      expect.objectContaining({ kind: 'human', verdict: 'fail', reason: 'Wrong error message', by: ALEX }),
    ]);
    // the stored record is canonical: key order of the schema
    expect(Object.keys(run).slice(0, 6)).toEqual(['kind', 'id', 'v', 'project', 'at', 'actor']);
  });

  it('applies the reason rule, reported, and release resolution', async () => {
    const f = await app();
    const post = (json: unknown) => f.app.fetch(req('/api/runs', { json }));
    const steps = [{ index: 1, status: 'blocked' }];
    const noReason = await post({ test_case: 'TC-8', steps, verdict: 'blocked' });
    expect(noReason.status).toBe(400);
    expect(((await noReason.json()) as { error: { code: string } }).error.code).toBe('invalid');
    expect(
      (await post({ test_case: 'TC-8', steps: [{ index: 9, status: 'pass' }], verdict: 'pass' })).status,
    ).toBe(400);
    expect((await post({ test_case: 'TC-8', steps, verdict: 'pass', release: 'v9' })).status).toBe(400);
    expect(
      (
        await post({
          test_case: 'TC-8',
          steps,
          verdict: 'blocked',
          note: 'x',
          locale: 'xx',
          started_at: 'soon',
        })
      ).status,
    ).toBe(201);
    expect(
      (await post({ test_case: 'TC-8', steps: [{ index: 1, status: 'pass', note: 3 }], verdict: 'pass' }))
        .status,
    ).toBe(400);
    const missing = { index: 1, status: 'pass', evidence: ['f'.repeat(64)] };
    expect((await post({ test_case: 'TC-8', steps: [missing], verdict: 'pass' })).status).toBe(400);

    const blocked = (await (
      await post({ test_case: 'TC-8', steps, verdict: 'blocked', note: 'Staging is down' })
    ).json()) as ManualRunResult;
    expect(blocked.run).toMatchObject({ reported: 'blocked', release: 'v1.2.0', environment: 'staging' });
    expect(blocked.decision.verdict).toBe('blocked');

    f.setBuild({ commit: 'a1b2c3d', ref: 'refs/heads/feature/x' }, { provider: 'github' });
    const branch = (await (
      await post({ test_case: 'TC-8', steps: [], verdict: 'pass' })
    ).json()) as ManualRunResult;
    expect(branch.run.release).toBeUndefined();
  });

  it('records a review as a judgement record; reason required; agents refused', async () => {
    const f = await app();
    const tc6 = await get<RunSummary[]>(f.app, '/api/runs?tc=TC-6');
    const path = `/api/runs/${tc6[0]!.id}/judgements`;
    expect((await f.app.fetch(req(path, { json: { verdict: 'pass', reason: ' ' } }))).status).toBe(400);
    const res = await f.app.fetch(
      req(path, { json: { verdict: 'pass', reason: 'Checked on an iPhone SE', by: SAM } }),
    );
    expect(res.status).toBe(201);
    const r = (await res.json()) as ReviewResult;
    expect(r.decision).toMatchObject({ verdict: 'pass', rule: 1 });
    const rec = f.written[0] as JudgementRecord;
    expect(rec).toMatchObject({ kind: 'judgement', run: tc6[0]!.id, actor: ALEX, judgement: r.judgement });
    expect(r.judgement).toMatchObject({
      kind: 'human',
      verdict: 'pass',
      by: ALEX,
      reason: 'Checked on an iPhone SE',
    });
    expect((await get<RunDetail>(f.app, `/api/runs/${tc6[0]!.id}`)).decision.verdict).toBe('pass');

    f.setActor({ ...ALEX, kind: 'agent', model: 'claude-opus-5-5' });
    expect((await f.app.fetch(req(path, { json: { verdict: 'fail', reason: 'x' } }))).status).toBe(403);
  });
});

describe('blobs', () => {
  it('serves images inline and everything else as an attachment', async () => {
    const { app: a } = await app();
    const png = await a.fetch(req(`/api/blobs/${SHOT_SHA}`));
    expect(png.headers.get('content-type')).toBe('image/png');
    expect(png.headers.get('content-disposition')).toBeNull();
    expect(new Uint8Array(await png.arrayBuffer())).toEqual(SHOT);
    const html = await a.fetch(
      req('/api/blobs', {
        method: 'POST',
        body: '<script>alert(1)</script>',
        headers: { 'content-type': 'text/html', 'x-filename': 'x.html' },
      }),
    );
    const { sha256, media_type } = (await html.json()) as { sha256: string; media_type: string };
    expect(media_type).toBe('text/html');
    const back = await a.fetch(req(`/api/blobs/${sha256}`));
    expect(back.headers.get('content-disposition')).toBe('attachment; filename="x.html"');
    expect(back.headers.get('content-security-policy')).toContain('sandbox');
    expect((await a.fetch(req(`/api/blobs/${'0'.repeat(64)}`))).status).toBe(404);
    expect((await a.fetch(req('/api/blobs/nothex'))).status).toBe(400);
  });

  it('rejects uploads over 25 MB', async () => {
    const { app: a } = await app();
    const big = new Uint8Array(25 * 1024 * 1024 + 1);
    const res = await a.fetch(
      req('/api/blobs', { method: 'POST', body: big, headers: { 'content-type': 'image/png' } }),
    );
    expect(res.status).toBe(413);
  });

  it('stops reading a chunked upload once it is over 25 MB', async () => {
    const { app: a } = await app();
    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += chunk.byteLength;
        c.enqueue(chunk);
      },
    });
    const init = { method: 'POST', body, duplex: 'half', headers: { 'x-iw-request': '1' } };
    const res = await a.fetch(new Request('http://127.0.0.1/api/blobs', init as RequestInit));
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(30 * 1024 * 1024);
  });
});

describe('cross-site requests', () => {
  const run = { test_case: 'TC-1', verdict: 'pass' };
  const send = async (headers: Record<string, string>, body = JSON.stringify(run), path = '/api/runs') => {
    const { app: a, written } = await app();
    const res = await a.fetch(new Request(`http://127.0.0.1:4321${path}`, { method: 'POST', body, headers }));
    return [res.status, written.length];
  };
  it('refuses writes a cross-site page could send, and allows the UI and the CLI', async () => {
    const json = { 'content-type': 'application/json' };
    // a form or no-cors fetch: text/plain, no custom header
    expect(await send({ 'content-type': 'text/plain;charset=UTF-8' })).toEqual([403, 0]);
    expect(await send({}, 'x', '/api/blobs')).toEqual([403, 0]);
    // a foreign or opaque Origin, or Sec-Fetch-Site: cross-site
    expect(await send({ ...json, origin: 'https://evil.example' })).toEqual([403, 0]);
    expect(await send({ ...json, origin: 'null' })).toEqual([403, 0]);
    expect(await send({ ...json, 'sec-fetch-site': 'cross-site' })).toEqual([403, 0]);
    // the web UI (same origin) and clients without Origin
    expect(await send({ ...json, origin: 'http://127.0.0.1:4321', 'sec-fetch-site': 'same-origin' })).toEqual(
      [201, 1],
    );
    expect(await send(json)).toEqual([201, 1]);
    expect((await send({ 'x-iw-request': '1', 'content-type': 'image/png' }, 'x', '/api/blobs'))[0]).toBe(
      201,
    );
  });

  it('sends a CSP that forbids framing on HTML pages', async () => {
    const { deps } = await fakeDeps();
    const html = { headers: { 'content-type': 'text/html' } };
    const a = createApp({ ...deps, assets: async () => new Response('<!doctype html>', html) });
    const res = await a.fetch(req('/'));
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
  });
});

describe('report', () => {
  it('renders Markdown and HTML with a strict CSP', async () => {
    const { app: a } = await app();
    const md = await a.fetch(req('/api/report?format=md'));
    expect(md.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(await md.text()).toContain('# Shop — Release v1.2.0');
    const html = await a.fetch(req('/api/report?format=html&audience=customer&locale=ja&plan=PLAN-1'));
    expect(html.headers.get('content-security-policy')).toContain("default-src 'none'");
    const text = await html.text();
    expect(text).toContain('<html lang="ja">');
    expect(text).not.toMatch(/@shop\.test/);
    expect((await a.fetch(req('/api/report?format=pdf'))).status).toBe(400);
  });
});

describe('store endpoints', () => {
  const LOG = 'v1/log/01JF7Z9A2B4C6D8E0F2G4H6J8K.json';
  it('GET/HEAD/PUT/list and log ingestion; writes are create-only', async () => {
    const f = await fakeDeps();
    const objects = memoryObjectStore();
    const logs: string[] = [];
    const a = createApp({ ...f.deps, objects, onLogObject: async (k) => void logs.push(k) });
    const put = (key: string, body: string, inm = true) =>
      a.fetch(
        req(`/api/store/objects/${key}`, {
          method: 'PUT',
          body,
          headers: inm ? { 'if-none-match': '*' } : {},
        }),
      );
    const log = (records: unknown[]) => JSON.stringify({ v: 1, writer: 'w', records });
    const body = log(sampleRecords(f.bundle).slice(0, 2));
    expect((await put(LOG, body)).status).toBe(201);
    // never overwritten, with or without If-None-Match
    expect((await put(LOG, log([]))).status).toBe(412);
    expect((await put(LOG, log([]), false)).status).toBe(412);
    expect(logs).toEqual([LOG]);
    const got = await a.fetch(req(`/api/store/objects/${LOG}`));
    expect(await got.text()).toBe(body);
    const head = await a.fetch(req(`/api/store/objects/${LOG}`, { method: 'HEAD' }));
    expect([head.status, head.headers.get('content-length')]).toEqual([200, `${body.length}`]);
    expect((await a.fetch(req('/api/store/objects/nope', { method: 'HEAD' }))).status).toBe(404);
    expect((await a.fetch(req('/api/store/objects/nope'))).status).toBe(404);
    const list = await get<StoreListResponse>(a, '/api/store/list?prefix=v1/log/');
    expect(list).toEqual({
      keys: [expect.objectContaining({ key: LOG, size: body.length })],
      truncated: false,
    });
    expect((await a.fetch(req('/api/store/objects/..%2Fx'))).status).toBe(400);
  });

  it('accepts only the manifest, valid log objects of this project and matching blobs', async () => {
    const f = await fakeDeps();
    const objects = memoryObjectStore();
    const a = createApp({ ...f.deps, objects });
    const put = async (key: string, body: BodyInit) =>
      (await a.fetch(req(`/api/store/objects/${key}`, { method: 'PUT', body }))).status;
    const project = f.bundle.project.data.id;
    const manifest = (p: string) => JSON.stringify({ format: 'indx-watch-store', version: 1, project: p });
    const other = 'prj_01JF3Q8M5X2V7K9D4R6T1W0Y99';
    expect(await put('indx-watch-store.json', manifest(other))).toBe(400); // not the served project
    expect(await put('indx-watch-store.json', '{"format":"x"}')).toBe(400);
    expect(await put('indx-watch-store.json', manifest(project))).toBe(201);
    expect(await put('indx-watch-store.json', manifest(other))).toBe(412);
    expect(new TextDecoder().decode((await objects.get('indx-watch-store.json'))!)).toContain(project);

    const [r] = sampleRecords(f.bundle);
    const log = (records: unknown[]) => JSON.stringify({ v: 1, writer: 'w', records });
    expect(await put(LOG, '{"v":1}')).toBe(400);
    expect(await put(LOG, log([{ ...r, verdict: 'pass', kind: 'nope' }]))).toBe(400);
    expect(await put(LOG, log([{ ...r, project: other }]))).toBe(400);
    expect(await put('v1/log/not-a-ulid.json', log([r]))).toBe(400);
    expect(await put('v1/snapshots/x', 'x')).toBe(400);
    expect(await objects.list({ prefix: 'v1/' })).toMatchObject({ keys: [] });

    const blob = `v1/blobs/sha256/${SHOT_SHA.slice(0, 2)}/${SHOT_SHA}`;
    expect(await put(`v1/blobs/sha256/aa/${'a'.repeat(64)}`, 'x')).toBe(400);
    expect(await put(`v1/blobs/sha256/00/${SHOT_SHA}`, SHOT)).toBe(400);
    expect(await put(blob, SHOT)).toBe(201);
    expect(await put(blob, SHOT)).toBe(412);
  });

  it('works with the http store adapter: init, append, blobs (iw sync to a hosted server)', async () => {
    const f = await fakeDeps();
    const objects = memoryObjectStore();
    const a = createApp({ ...f.deps, objects });
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) => a.fetch(new Request(input, init)));
    try {
      const store = createResultStore(httpObjectStore({ baseUrl: 'https://watch.example' }));
      await store.init(f.bundle.project.data.id);
      const [key] = await store.appendLog('w', sampleRecords(f.bundle));
      expect((await store.readLog(key!)).records).toHaveLength(9);
      await store.putBlob(SHOT_SHA, SHOT, 'image/png');
      expect(await store.hasBlob(SHOT_SHA)).toBe(true);
      await expect(store.init('prj_01JF3Q8M5X2V7K9D4R6T1W0Y99')).rejects.toThrow(/belongs to project/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('is absent without an object store', async () => {
    const { app: a } = await app();
    expect((await a.fetch(req('/api/store/list?prefix='))).status).toBe(404);
  });
});

describe('hosted mode with Cloudflare Access', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects requests without a valid Access JWT (401) and attributes writes to the JWT identity', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) =>
      String(input instanceof Request ? input.url : input) ===
      'https://shop.cloudflareaccess.com/cdn-cgi/access/certs'
        ? Response.json({ keys: [jwk] })
        : real(input, init),
    );
    const f = await fakeDeps();
    const a = createApp({
      ...f.deps,
      mode: 'hosted',
      identity: accessIdentity({ team: 'shop', aud: 'aud-1' }),
      assets: async () =>
        new Response('<!doctype html><title>x</title>', { headers: { 'content-type': 'text/html' } }),
    });
    expect((await a.fetch(req('/healthz'))).status).toBe(200);
    const anon = await a.fetch(req('/api/status'));
    expect(anon.status).toBe(401);
    expect(((await anon.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
    expect((await a.fetch(req('/'))).status).toBe(401);
    const sign = (aud: string) =>
      new SignJWT({ email: 'kim@shop.test', name: 'Kim' })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer('https://shop.cloudflareaccess.com')
        .setAudience(aud)
        .setExpirationTime('5m')
        .sign(privateKey);
    const wrongAud = await a.fetch(
      req('/api/status', { headers: { 'cf-access-jwt-assertion': await sign('other') } }),
    );
    expect(wrongAud.status).toBe(401);
    const h = { 'cf-access-jwt-assertion': await sign('aud-1') };
    const p = await a.fetch(req('/api/project', { headers: h }));
    expect(((await p.json()) as ProjectInfo).identity).toEqual({
      kind: 'human',
      id: 'kim@shop.test',
      name: 'Kim',
      via: 'cloudflare-access',
    });
    const page = await a.fetch(req('/', { headers: h }));
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    const r = await a.fetch(
      new Request('http://127.0.0.1/api/runs', {
        method: 'POST',
        headers: { ...h, 'content-type': 'application/json' },
        body: JSON.stringify({ test_case: 'TC-1', steps: [], verdict: 'pass' }),
      }),
    );
    expect(r.status).toBe(201);
    expect((f.written[0] as RunRecord).actor.via).toBe('cloudflare-access');
  });
});

export type { AnyRecord };
