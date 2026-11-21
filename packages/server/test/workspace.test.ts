/** Editing test cases in workspace mode (docs/spec/web.md#editing-in-workspace-mode) on a Worker and a local app. */
import {
  type AnyRecord,
  type Bundle,
  FileRecord,
  generateSigningKey,
  newId,
  parseToml,
  sha256Hex,
  verifyRecord,
} from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { createResultStore } from '@indx-watch/store';
import { r2ObjectStore } from '@indx-watch/store/workers';
import { definitionFiles } from '@indx-watch/sync';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeD1, fakeR2 } from '../../store/test/helpers/fakes.js';
import type { ProjectInfo, TestCaseDetail } from '../src/index.js';
import { createWorker } from '../src/worker.js';
import { app } from './app-helpers.js';
import { req, SHOP, shop } from './helpers.js';

const worker = createWorker();
const [enc, dec] = [new TextEncoder(), new TextDecoder()];
const assets = { fetch: async () => new Response('spa') };
const TC3 = 'specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-3-valid-coupon.toml';
const workspaceToml = (t: string) => t.replace('mode = "git"', 'mode = "workspace"');
const EDIT = {
  title: 'A valid coupon lowers the total',
  priority: 'P0',
  steps: [{ instruction: 'Apply {{FX-1.code}} in the cart.', expected: 'The total is "36.00".' }],
};

/** A bucket holding the shop bundle in workspace mode as `file` records, as a first `iw sync` publishes it. */
async function workspaceBucket() {
  const r2 = fakeR2({ honorStartAfter: true });
  const store = createResultStore(r2ObjectStore(r2, 'shop'));
  const files = await definitionFiles(nodeFs(SHOP));
  files.set('project.toml', enc.encode(workspaceToml(dec.decode(files.get('project.toml')!))));
  const project = (await shop()).project.data.id;
  await store.init(project);
  const records: AnyRecord[] = [];
  const actor = { kind: 'human', id: 'alex@shop.test', via: 'git' } as const;
  for (const [path, data] of files) {
    const sha256 = await sha256Hex(data);
    await store.putBlob(sha256, data, 'application/octet-stream');
    const id = path.endsWith('.toml') ? parseToml(dec.decode(data)).id : undefined;
    const entity = typeof id === 'string' ? id : undefined;
    const at = '2026-11-18T00:00:00Z';
    const env = { kind: 'file', id: newId('rec'), v: 1, project, at, actor, source: 'cli' };
    records.push(FileRecord.parse({ ...env, path, entity, sha256 }));
  }
  await store.appendLog('wa', records);
  return { r2, store, first: records.find((r) => (r as FileRecord).path === TC3)! };
}

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
    expect(info.can).toMatchObject({ edit: true, upload: false });
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
    const upload = await call('/api/bundle', { method: 'POST', body: JSON.stringify({ files: [] }) });
    expect(upload.status).toBe(409);
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
    return { ...a, wrote };
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

  it('refuses edits in git mode', async () => {
    const a = await local(false);
    expect((await a.app.fetch(patch(EDIT))).status).toBe(409);
    expect(a.written).toEqual([]);
  });
});
