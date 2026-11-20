/** Write routes: manual runs, reviews, blobs, and the cross-site request guard. */
import type { JudgementRecord } from '@indx-watch/bundle';
import { describe, expect, it } from 'vitest';
import type { ManualRunResult, ReviewResult, RunDetail, RunSummary } from '../src/index.js';
import { createApp } from '../src/index.js';
import { app, get } from './app-helpers.js';
import { ALEX, fakeDeps, req, SAM, SHOT, SHOT_SHA } from './helpers.js';

const MB = 1024 * 1024;
/** A ref that resolves to the current release, v1.2.0. */
const RELEASE_BUILD = { commit: 'a1b2c3d', ref: 'refs/heads/release/1.2' };
/** The failed manual run of TC-8 the web UI posts, with its screenshot on step 1. */
const failedRun = (sha256: string) => ({
  test_case: 'TC-8',
  environment: 'staging',
  locale: 'ja',
  started_at: '2026-11-18T23:58:00Z',
  actor: SAM, // ignored: the actor comes from the server
  steps: [
    { index: 1, status: 'fail', note: 'Shows "Something went wrong"', evidence: [sha256] },
    { index: 2, status: 'pass' },
  ],
  verdict: 'fail',
  note: 'Wrong error message',
});
const SHOT_EVIDENCE = {
  sha256: SHOT_SHA,
  name: 'wrong.png',
  media_type: 'image/png',
  size: SHOT.byteLength,
  kind: 'screenshot',
  step: 1,
};

describe('manual runs: recording', () => {
  it('records a manual run: actor from identity, human judgement, fixture versions, release by refs', async () => {
    const f = await app();
    f.setBuild(RELEASE_BUILD, { provider: 'github' });
    const up = await f.app.fetch(
      req('/api/blobs', {
        method: 'POST',
        body: SHOT,
        headers: { 'content-type': 'image/png', 'x-filename': 'wrong.png' },
      }),
    );
    expect(up.status).toBe(201);
    const blob = (await up.json()) as { sha256: string };
    const res = await f.app.fetch(req('/api/runs', { json: failedRun(blob.sha256) }));
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
      build: RELEASE_BUILD,
      ci: { provider: 'github' },
      test_case: { id: tc8.data.id, key: 'TC-8', version: tc8.version },
      fixtures: [{ id: fx3.data.id, key: 'FX-3', version: fx3.version }],
      started_at: '2026-11-18T23:58:00Z',
      ended_at: '2026-11-19T00:00:00Z',
    });
    expect(run.evidence).toEqual([SHOT_EVIDENCE]);
    expect(run.judgements).toEqual([
      expect.objectContaining({ kind: 'human', verdict: 'fail', reason: 'Wrong error message', by: ALEX }),
    ]);
    // the stored record is canonical: key order of the schema
    expect(Object.keys(run).slice(0, 6)).toEqual(['kind', 'id', 'v', 'project', 'at', 'actor']);
  });
});

describe('manual runs: validation and release', () => {
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
});

describe('reviews', () => {
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
    const big = new Uint8Array(25 * MB + 1);
    const res = await a.fetch(
      req('/api/blobs', { method: 'POST', body: big, headers: { 'content-type': 'image/png' } }),
    );
    expect(res.status).toBe(413);
  });

  it('stops reading a chunked upload once it is over 25 MB', async () => {
    const { app: a } = await app();
    let pulled = 0;
    const chunk = new Uint8Array(MB);
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += chunk.byteLength;
        c.enqueue(chunk);
      },
    });
    const init = { method: 'POST', body, duplex: 'half', headers: { 'x-iw-request': '1' } };
    const res = await a.fetch(new Request('http://127.0.0.1/api/blobs', init as RequestInit));
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(30 * MB);
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
