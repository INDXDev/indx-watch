/** Editing test cases in workspace mode (docs/spec/web.md#editing-in-workspace-mode) on a Worker and a local app. */
import {
  type Bundle,
  type FileRecord,
  generateSigningKey,
  parseToml,
  sha256Hex,
  verifyRecord,
} from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { definitionFiles } from '@indx-watch/sync';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeD1 } from '../../store/test/helpers/fakes.js';
import type { FixtureDetail, ProjectInfo, TestCaseDetail } from '../src/index.js';
import { createWorker } from '../src/worker.js';
import { app } from './app-helpers.js';
import { req, SHOP, shop } from './helpers.js';
import { TC3, workspaceBucket } from './workspace-helpers.js';

const worker = createWorker();
const dec = new TextDecoder();
const assets = { fetch: async () => new Response('spa') };
const EDIT = {
  title: 'A valid coupon lowers the total',
  priority: 'P0',
  steps: [{ instruction: 'Apply {{FX-1.code}} in the cart.', expected: 'The total is "36.00".' }],
};

async function accessJwt() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  vi.stubGlobal('fetch', async () => Response.json({ keys: [jwk] }));
  return new SignJWT({ email: 'kim@shop.test', sub: 'u1' })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer('https://shop.cloudflareaccess.com')
    .setAudience('aud')
    .setExpirationTime('5m')
    .sign(privateKey);
}

describe('workspace mode: hosted editing (Worker)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('serves definitions from file records and saves an edit as a signed file record of the Access identity', async () => {
    const { r2, store, first } = await workspaceBucket();
    const [jwt, k] = [await accessJwt(), await generateSigningKey('hosted')];
    const env = {
      ...{
        STORE: r2,
        DB: fakeD1(),
        ASSETS: assets,
        STORE_PREFIX: 'shop',
        ACCESS_TEAM: 'shop',
        ACCESS_AUD: 'aud',
      },
      ...{ IW_SIGNING_KEY: k.secret, SIGNING_KEYS: JSON.stringify([k.key]) },
    };
    const headers = { 'Cf-Access-Jwt-Assertion': jwt, 'content-type': 'application/json' };
    const call = (path: string, init: RequestInit = {}) =>
      worker.fetch(new Request(`https://watch.example.com${path}`, { ...init, headers }), env as never);
    const info = (await (await call('/api/project')).json()) as ProjectInfo;
    expect(info.can).toMatchObject({ edit: true, upload: true, data: true });
    const res = await call('/api/test-cases/TC-3', { method: 'PATCH', body: JSON.stringify(EDIT) });
    expect(res.status).toBe(201);
    const { record } = (await res.json()) as { record: FileRecord };
    expect(record).toMatchObject({ path: TC3, entity: 'tc_01JF3Q8M5X2V7K9D4R6T1W0Y33', parents: [first.id] });
    expect(record.actor).toMatchObject({ kind: 'human', id: 'kim@shop.test', via: 'cloudflare-access' });
    const logged = (await store.readLog((await store.listLog({})).keys.at(-1)!)).records[0]!;
    expect(await verifyRecord(logged, [k.key])).toBe(true);
    const tc = (await (await call('/api/test-cases/TC-3')).json()) as TestCaseDetail;
    expect(tc.data).toMatchObject({ title: EDIT.title, priority: 'P0', steps: [EDIT.steps[0]] });
    const empty = await call('/api/test-cases/TC-3', {
      method: 'PATCH',
      body: JSON.stringify({ title: ' ' }),
    });
    expect(empty.status).toBe(400);
    // an upload and a test data edit are file records too, so `iw sync` brings them into every working copy
    const pdf = { name: 'Sales deck.pdf', data: Buffer.from('%PDF-1.4\n').toString('base64') };
    const upload = await call('/api/bundle', { method: 'POST', body: JSON.stringify({ files: [pdf] }) });
    expect(upload.status).toBe(201);
    const fx = (await (await call('/api/fixtures/FX-5')).json()) as FixtureDetail;
    expect(fx.data).toMatchObject({ title: 'Sales deck', kind: 'file', status: 'draft' });
    const edit = { title: 'Sales deck (Q4)', notes: 'Shown in the demo' };
    expect((await call('/api/fixtures/FX-5', { method: 'PATCH', body: JSON.stringify(edit) })).status).toBe(
      200,
    );
    const del = await call('/api/fixtures/FX-5', { method: 'DELETE', headers: { 'X-IW-Request': '1' } });
    expect(del.status).toBe(200);
    const logs = await Promise.all((await store.listLog({})).keys.map((key) => store.readLog(key)));
    const all = logs.flatMap((l) => l.records as unknown as FileRecord[]);
    const deck = all.filter((r) => r.path?.startsWith('fixtures/FX-5-sales-deck/'));
    const versions = deck.map((r) => `${r.path.split('/').pop()}${r.deleted ? ' deleted' : ''}`).sort();
    expect(versions).toEqual([
      'Sales deck.pdf',
      'Sales deck.pdf deleted',
      'fixture.toml',
      'fixture.toml',
      'fixture.toml deleted',
    ]);
    expect((await call('/api/fixtures/FX-5')).status).toBe(404);
  });
});

describe('workspace mode: local editing', () => {
  const local = async (workspace: boolean) => {
    const b = await shop();
    const project = workspace
      ? { ...b.project.data, store: { ...b.project.data.store!, mode: 'workspace' as const } }
      : b.project.data;
    const bundle: Bundle = { ...b, project: { ...b.project, data: project } };
    const a = await app({ bundle });
    const files = await definitionFiles(nodeFs(SHOP));
    const wrote = new Map<string, Uint8Array>();
    Object.assign(a.deps, {
      bundleFiles: async () => files,
      records: async () => [],
      writeFile: async (p: string, d: Uint8Array) => void wrote.set(p, d),
    });
    return { ...a, files, wrote };
  };
  const patch = (body: unknown) => req('/api/test-cases/TC-3', { method: 'PATCH', json: body });

  it('writes the file and a file record; an agent edit becomes an AI draft', async () => {
    const a = await local(true);
    a.setActor({ kind: 'agent', id: 'alex@shop.test', via: 'git', model: 'claude-opus-5-5' });
    const res = await a.app.fetch(patch({ title: 'Agent title' }));
    expect(res.status).toBe(201);
    const record = a.written[0] as FileRecord;
    expect(record).toMatchObject({ kind: 'file', path: TC3, parents: [], actor: { kind: 'agent' } });
    const saved = parseToml(dec.decode(a.wrote.get(TC3)!));
    expect(saved).toMatchObject({
      title: 'Agent title',
      status: 'draft',
      origin: 'ai',
      ai: { model: 'claude-opus-5-5' },
    });
    expect(saved.approved_by).toBeUndefined();
    expect(await sha256Hex(a.wrote.get(TC3)!)).toBe(record.sha256);
  });

  it('stores issue links on the test case, de-duplicated, and refuses anything but http(s) URLs', async () => {
    const a = await local(true);
    const url = 'https://github.com/shop-co/shop/issues/42';
    expect((await a.app.fetch(patch({ links: [url, url] }))).status).toBe(201);
    expect(parseToml(dec.decode(a.wrote.get(TC3)!)).links).toEqual([url]);
    expect((await a.app.fetch(patch({ links: ['javascript:alert(1)'] }))).status).toBe(400);
    expect((await a.app.fetch(patch({ links: null }))).status).toBe(201);
  });

  it('refuses edits while the test case has a conflict file', async () => {
    const a = await local(true);
    a.files.set(TC3.replace('.toml', '.conflict-1a2b3c4d.toml'), a.files.get(TC3)!);
    const res = await a.app.fetch(patch({ priority: 'P1' }));
    expect(res.status).toBe(409);
    expect(await res.text()).toContain('resolve it in a working copy');
    expect(a.written).toEqual([]);
  });

  it('refuses a steps edit of a test case that uses shared steps; a title edit still saves with the use kept', async () => {
    const a = await local(true);
    const tc8 = (body: unknown) => req('/api/test-cases/TC-8', { method: 'PATCH', json: body });
    const detail = (await (await a.app.fetch(req('/api/test-cases/TC-8'))).json()) as TestCaseDetail;
    expect(detail.data.steps[1]).toMatchObject({ from: 'SS-1', fromFirst: true });
    const steps = detail.data.steps.map(({ instruction, expected }) => ({ instruction, expected }));
    const refused = await a.app.fetch(tc8({ steps }));
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('shared steps');
    expect((await a.app.fetch(tc8({ title: 'Wrong password is not accepted' }))).status).toBe(201);
    const file = [...a.wrote.keys()].find((p) => p.includes('TC-8'))!;
    expect(dec.decode(a.wrote.get(file)!)).toContain('use = "SS-1"');
  });

  it('refuses edits in git mode', async () => {
    const a = await local(false);
    expect((await a.app.fetch(patch(EDIT))).status).toBe(409);
    expect(a.written).toEqual([]);
  });
});
