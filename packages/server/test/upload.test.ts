import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnyRecord, BundleRecord } from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { definitionFiles } from '@indx-watch/sync';
import { describe, expect, it } from 'vitest';
import type { ProjectInfo, RunSummary, SnapshotSummary, UploadResult } from '../src/index.js';
import { createApp, declaredTester, prepareUpload } from '../src/index.js';
import { safePath } from '../src/upload.js';
import { ALEX, fakeDeps, req, SHOP } from './helpers.js';

const TC3 = 'specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-3-valid-coupon.toml';
const b64 = (s: string) => Buffer.from(s).toString('base64');
const tc3 = () => readFileSync(join(SHOP, TC3), 'utf8');
const cookie = (v: unknown) => `theme=dark; iw_tester=${encodeURIComponent(JSON.stringify(v))}`;

describe('declared tester (iw_tester cookie)', () => {
  it('parses a valid cookie and ignores anything else', () => {
    expect(declaredTester(cookie({ id: 'sam@shop.test', name: 'Sam' }))).toEqual({
      kind: 'human',
      id: 'sam@shop.test',
      name: 'Sam',
      via: 'browser',
    });
    expect(declaredTester(cookie({ id: 'Sam' }))).toEqual({ kind: 'human', id: 'Sam', via: 'browser' });
    for (const bad of [undefined, '', 'iw_tester=%7B', cookie({ id: '' }), cookie({ id: 'x'.repeat(81) })])
      expect(declaredTester(bad)).toBeUndefined();
    expect(declaredTester(cookie({ id: 'a\nb' }))).toBeUndefined();
  });

  it('records manual runs as the declared tester only where the server allows it', async () => {
    const post = (a: { fetch(r: Request): Promise<Response> }) => {
      const r = req('/api/runs', { json: { test_case: 'TC-9', steps: [], verdict: 'pass' } });
      r.headers.set('cookie', cookie({ id: 'sam@shop.test', name: 'Sam' }));
      return a.fetch(r);
    };
    const on = await fakeDeps();
    on.deps.declaredIdentity = true;
    expect((await post(createApp(on.deps))).status).toBe(201);
    expect(on.written[0]?.actor).toEqual({ kind: 'human', id: 'sam@shop.test', name: 'Sam', via: 'browser' });
    const off = await fakeDeps(); // e.g. behind --identity-header or Cloudflare Access
    expect((await post(createApp(off.deps))).status).toBe(201);
    expect(off.written[0]?.actor).toEqual(ALEX);
  });
});

describe('prepareUpload', () => {
  it('replaces a changed file by its id and reports the check result', async () => {
    const base = await definitionFiles(nodeFs(SHOP));
    const changed = tc3().replace('Valid coupon reduces the total', 'A valid coupon lowers the total');
    const { next, result } = await prepareUpload(base, {
      files: [{ name: 'renamed.toml', data: b64(changed) }],
    });
    expect(result.changes.filter((c) => c.change !== 'unchanged')).toEqual([
      { path: TC3, change: 'changed' },
    ]);
    expect(result.ok).toBe(true);
    expect(new TextDecoder().decode(next.get(TC3))).toContain('lowers the total');
  });

  it('places a new test case next to the use case it covers, and refuses secrets', async () => {
    const base = await definitionFiles(nodeFs(SHOP));
    const fresh = tc3()
      .replace('tc_01JF3Q8M5X2V7K9D4R6T1W0Y33', 'tc_01JF3Q8M5X2V7K9D4R6T1W0Y99')
      .replace('key = "TC-3"', 'key = "TC-10"')
      .replace('Valid coupon reduces the total', 'Coupon code is case-insensitive');
    const { result } = await prepareUpload(base, {
      files: [
        { name: 'TC-10.toml', data: b64(fresh) },
        { name: 'notes.txt', data: b64('hello') },
      ],
    });
    expect(result.changes.filter((c) => c.change === 'added').map((c) => c.path)).toEqual([
      'specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-10-coupon-code-is-case-insensitive.toml',
    ]);
    expect(result.unplaced).toEqual([{ name: 'notes.txt', reason: 'no file with this name' }]);
    expect(result.ok).toBe(true);
    const key = ['AKIA', 'Q7RT2X4M9KD3LP8Z'].join(''); // assembled so this file holds no token-shaped literal
    const leaky = tc3().replace('preconditions = ', `notes = "deploy key ${key}"\npreconditions = `);
    const refused = await prepareUpload(base, { files: [{ name: 'TC-3.toml', data: b64(leaky) }] });
    expect(refused.result.ok).toBe(false);
    expect(refused.result.problems.some((p) => p.code === 'secret')).toBe(true);
  });

  it('replaces the whole bundle from a folder and rejects unsafe paths', async () => {
    const base = await definitionFiles(nodeFs(SHOP));
    const files = [...base].map(([path, d]) => ({
      name: path.split('/').pop()!,
      path,
      data: Buffer.from(d).toString('base64'),
    }));
    const all = await prepareUpload(base, {
      replace: true,
      files: files.filter((f) => !f.path.startsWith('plans/')),
    });
    expect(all.result.changes.filter((c) => c.change === 'removed').map((c) => c.path)).toEqual([
      'plans/PLAN-1-v1-2-0-regression.toml',
    ]);
    expect(['../x', '.git/config', 'runs/a.json', 'a//b', 'cache/x'].filter(safePath)).toEqual([]);
    expect(safePath('specs/FEAT-1-catalog/feature.toml')).toBe(true);
    const none = await prepareUpload(base, {
      replace: true,
      files: [{ name: 'x', path: 'a.toml', data: '' }],
    });
    expect(none.result.ok).toBe(false);
  });
});

describe('POST /api/bundle and GET /api/snapshots', () => {
  it('previews, publishes through publishBundle, and refuses agents', async () => {
    const f = await fakeDeps();
    const published: { changed: string[]; message?: string }[] = [];
    f.deps.bundleFiles = () => definitionFiles(nodeFs(SHOP));
    f.deps.publishBundle = async (_files, info) => {
      published.push(info);
      return 'rec_01JF7Z3K0W8N2Q4R6S8T0V9999';
    };
    const a = createApp(f.deps);
    const changed = tc3().replace('Valid coupon reduces the total', 'A valid coupon lowers the total');
    const body = { files: [{ name: 'TC-3.toml', data: b64(changed) }], message: ' fix title ' };
    const dry = await a.fetch(req('/api/bundle', { json: { ...body, dryRun: true } }));
    expect(dry.status).toBe(200);
    expect(published).toHaveLength(0);
    const res = await a.fetch(req('/api/bundle', { json: body }));
    expect(res.status).toBe(201);
    expect(((await res.json()) as UploadResult).snapshot).toBe('rec_01JF7Z3K0W8N2Q4R6S8T0V9999');
    expect(published[0]).toMatchObject({ changed: [TC3], message: 'fix title', actor: ALEX });
    const info = (await (await a.fetch(req('/api/project'))).json()) as ProjectInfo;
    expect(info.can).toEqual({ declare: false, upload: true, share: false });
    f.setActor({ ...ALEX, kind: 'agent', model: 'claude-opus-5-5' });
    expect((await a.fetch(req('/api/bundle', { json: body }))).status).toBe(403);
  });

  it('lists bundle records newest first and puts the newest in /api/project', async () => {
    const base = await fakeDeps();
    const snap = (id: string, at: string, commit_time?: string): AnyRecord =>
      ({
        ...{
          kind: 'bundle',
          id,
          v: 1,
          project: base.bundle.project.data.id,
          at,
          actor: ALEX,
          source: 'manual',
        },
        ...{
          sha256: 'a'.repeat(64),
          definitions_hash: 'b'.repeat(64),
          files: 30,
          ...(commit_time && { commit_time }),
        },
      }) as BundleRecord;
    const records = [
      snap('rec_01JF7Z3K0W8N2Q4R6S8T0V0001', '2026-11-18T00:00:00Z', '2026-11-18T00:00:00Z'),
      snap('rec_01JF7Z3K0W8N2Q4R6S8T0V0002', '2026-11-19T00:00:00Z', '2026-11-19T00:00:00Z'),
    ];
    const f = await fakeDeps({ records });
    const a = createApp(f.deps);
    const list = (await (await a.fetch(req('/api/snapshots'))).json()) as SnapshotSummary[];
    expect(list.map((s) => s.id)).toEqual([
      'rec_01JF7Z3K0W8N2Q4R6S8T0V0002',
      'rec_01JF7Z3K0W8N2Q4R6S8T0V0001',
    ]);
    const info = (await (await a.fetch(req('/api/project'))).json()) as ProjectInfo;
    expect(info.snapshot?.id).toBe('rec_01JF7Z3K0W8N2Q4R6S8T0V0002');
    expect(info.share).toEqual({ clone: null });
    const runs = (await (await a.fetch(req('/api/runs'))).json()) as RunSummary[];
    expect(runs).toEqual([]);
  });
});
