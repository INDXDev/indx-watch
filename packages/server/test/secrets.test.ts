/** Sharing test data and secrets with people (docs/spec/security.md#sharing, #secrets). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Actor, generateSecretsKey, type SecretRecord } from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { definitionFiles } from '@indx-watch/sync';
import { describe, expect, it } from 'vitest';
import type { AccessOverview, FixtureDetail, ProjectInfo, SecretList, TestCaseDetail } from '../src/index.js';
import { createApp, HttpError, type ServerDeps } from '../src/index.js';
import { accessOf } from '../src/secrets.js';
import { fakeDeps, req, SHOP, shop } from './helpers.js';

const ROLES = { lead: ['QA-Leads'], tester: ['qa'], viewer: ['viv@shop.test', 'pat@shop.test'] };
const human = (id: string): Actor => ({ kind: 'human', id, via: 'cloudflare-access' });
const PEOPLE: Record<string, { actor: Actor; groups: string[] }> = {
  lead: { actor: human('alex@shop.test'), groups: ['qa-leads'] },
  tester: { actor: human('kim@shop.test'), groups: ['qa'] },
  viewer: { actor: human('viv@shop.test'), groups: [] },
  pat: { actor: human('pat@shop.test'), groups: [] },
};

/** A hosted app with roles; FX-1 (coupon codes) is shared with the qa group only. */
async function hosted(extra: Partial<ServerDeps> = { secretsKey: generateSecretsKey() }) {
  const bundle = await shop();
  bundle.fixtures.find((f) => f.data.key === 'FX-1')!.data.shared_with = ['group:qa'];
  const f = await fakeDeps({ bundle });
  const who = (r: Request) => {
    const p = PEOPLE[r.headers.get('x-test-user') ?? ''];
    if (!p) throw new HttpError(401, 'unauthorized', 'no token');
    return p;
  };
  const identity = {
    current: async (r: Request) => who(r).actor,
    groups: async (r: Request) => who(r).groups,
  };
  const deps = { ...f.deps, mode: 'hosted', identity, roles: ROLES, ...extra } as ServerDeps;
  const app = createApp(deps);
  const send = (user: string, path: string, init: RequestInit & { json?: unknown } = {}) => {
    const r = req(path, init.json === undefined ? { headers: { 'X-IW-Request': '1' }, ...init } : init);
    r.headers.set('x-test-user', user);
    return app.fetch(r);
  };
  const json = async <T>(user: string, path: string, init?: RequestInit & { json?: unknown }) =>
    (await (await send(user, path, init)).json()) as T;
  return { ...f, send, json };
}

describe('sharing test data', () => {
  it('hides a restricted fixture from people it is not shared with, files included', async () => {
    const h = await hosted();
    const mine = await h.json<FixtureDetail>('tester', '/api/fixtures/FX-1');
    expect(mine.hidden).toBeUndefined();
    expect(mine.preview?.rows?.length).toBeGreaterThan(0);
    expect(mine.access).toEqual([
      { who: 'QA-Leads', why: 'lead', role: 'lead' },
      { who: 'group:qa', why: 'shared' },
    ]);
    const theirs = await h.json<FixtureDetail>('viewer', '/api/fixtures/FX-1');
    expect(theirs).toMatchObject({ key: 'FX-1', hidden: true, files: [] });
    expect(theirs.preview).toBeUndefined();
    expect((await h.send('viewer', `/api/blobs/${mine.files[0]!.sha256}`)).status).toBe(404);
    expect((await h.send('tester', `/api/blobs/${mine.files[0]!.sha256}`)).status).toBe(200);
    const tc = await h.json<TestCaseDetail>('viewer', '/api/test-cases/TC-3');
    expect(tc.fixtures.find((x) => x.key === 'FX-1')).toMatchObject({ hidden: true });
    expect(tc.fixtures.find((x) => x.key === 'FX-1')?.values).toBeUndefined();
    // a team fixture lists the whole team
    const team = await h.json<FixtureDetail>('viewer', '/api/fixtures/FX-2');
    expect(team.access.map((a) => a.why)).toEqual(['lead', 'team', 'team', 'team']);
  });

  it('says who can open what for one email (leads only)', async () => {
    const h = await hosted();
    expect((await h.send('tester', '/api/access')).status).toBe(403);
    const all = await h.json<AccessOverview>('lead', '/api/access');
    expect(all.people).toContain('viv@shop.test');
    expect(all.groups).toContain('group:qa');
    const viv = await h.json<AccessOverview>('lead', '/api/access?who=viv@shop.test');
    expect(viv.role).toBe('viewer');
    expect(viv.items?.find((i) => i.key === 'FX-1')).toMatchObject({
      can: false,
      why: 'none',
      groups: ['group:qa'],
    });
    expect(viv.items?.find((i) => i.key === 'FX-2')).toMatchObject({ can: true, why: 'team' });
  });

  it('accessOf says everyone without a role table', () => {
    expect(accessOf(['a@shop.test'], undefined)).toEqual([{ who: '*', why: 'everyone' }]);
  });
});

describe('secrets kept by INDX Watch', () => {
  const login = {
    title: 'Staging admin',
    username: 'admin@shop.test',
    value: 'hunter2!',
    shared_with: ['group:qa'],
  };

  it('stores a sealed value, shares it like test data and records every reveal', async () => {
    const h = await hosted();
    expect(
      (await h.send('viewer', '/api/secrets/staging-admin', { method: 'PUT', json: login })).status,
    ).toBe(403);
    const created = await h.send('lead', '/api/secrets/staging-admin', { method: 'PUT', json: login });
    expect(created.status).toBe(201);
    const rec = h.written.find((r) => r.kind === 'secret') as SecretRecord;
    expect(rec).toMatchObject({ action: 'set', name: 'staging-admin', username: 'admin@shop.test' });
    expect(JSON.stringify(rec)).not.toContain('hunter2');

    const list = await h.json<SecretList>('tester', '/api/secrets');
    expect(list.secrets.map((s) => s.ref)).toEqual(['iw:staging-admin']);
    expect((await h.json<SecretList>('viewer', '/api/secrets')).secrets).toEqual([]);
    expect((await h.send('viewer', '/api/secrets/staging-admin/reveal', { method: 'POST' })).status).toBe(
      404,
    );
    const shown = await h.json<{ value: string }>('tester', '/api/secrets/staging-admin/reveal', {
      method: 'POST',
    });
    expect(shown.value).toBe('hunter2!');
    const reveal = h.written.find((r) => r.kind === 'secret' && r.action === 'reveal') as SecretRecord;
    expect(reveal).toMatchObject({ name: 'staging-admin', actor: { id: 'kim@shop.test' } });
    expect(reveal.sealed).toBeUndefined();
    const [s] = (await h.json<SecretList>('lead', '/api/secrets')).secrets;
    expect(s?.history.map((e) => e.action)).toEqual(['reveal', 'set']);

    // a record whose sharing was changed without the key does not count
    h.written.push({
      ...rec,
      id: 'rec_01JF7Z3K0W8N2Q4R6S8T0V9998',
      at: '2099-01-01T00:00:00Z',
      shared_with: undefined,
    });
    expect((await h.json<SecretList>('viewer', '/api/secrets')).secrets).toEqual([]);

    // a tester edits it, keeps the value, and may not lock themselves out
    const out = await h.send('tester', '/api/secrets/staging-admin', {
      method: 'PUT',
      json: { shared_with: ['viv@shop.test'] },
    });
    expect(out.status).toBe(400);
    const opened = await h.send('tester', '/api/secrets/staging-admin', {
      method: 'PUT',
      json: { shared_with: null },
    });
    expect(opened.status).toBe(200);
    const again = await h.json<{ value: string }>('viewer', '/api/secrets/staging-admin/reveal', {
      method: 'POST',
    });
    expect(again.value).toBe('hunter2!');

    expect((await h.send('tester', '/api/secrets/staging-admin', { method: 'DELETE' })).status).toBe(200);
    expect((await h.json<SecretList>('lead', '/api/secrets')).secrets).toEqual([]);
  });

  it('opens another body under the ID of a record that opened before on its own', async () => {
    const h = await hosted();
    await h.send('lead', '/api/secrets/staging-admin', { method: 'PUT', json: login });
    expect((await h.json<SecretList>('tester', '/api/secrets')).secrets).toHaveLength(1);
    const shown = await h.send('tester', '/api/secrets/staging-admin/reveal', { method: 'POST' });
    expect(shown.headers.get('cache-control')).toBe('no-store');
    // a direct bucket write replaces the body under the same ID with other sharing
    const i = h.written.findIndex((r) => r.kind === 'secret');
    h.written[i] = { ...(h.written[i] as SecretRecord), shared_with: undefined };
    expect((await h.json<SecretList>('viewer', '/api/secrets')).secrets).toEqual([]);
    const reveal = await h.send('viewer', '/api/secrets/staging-admin/reveal', { method: 'POST' });
    expect(reveal.status).toBe(404);
  });

  it('needs IW_SECRETS_KEY', async () => {
    const h = await hosted({});
    expect(await h.json<SecretList>('lead', '/api/secrets')).toEqual({ available: false, secrets: [] });
    expect((await h.send('lead', '/api/secrets/x', { method: 'PUT', json: login })).status).toBe(503);
    expect((await h.json<ProjectInfo>('lead', '/api/project')).can.secrets).toBe(false);
  });

  it('refuses secret records through the store endpoint and agents writing secrets', async () => {
    const h = await hosted();
    PEOPLE.agent = { actor: { ...human('alex@shop.test'), kind: 'agent' }, groups: ['qa-leads'] };
    expect((await h.send('agent', '/api/secrets/x', { method: 'PUT', json: login })).status).toBe(403);
    delete PEOPLE.agent;

    expect((await h.send('lead', '/api/secrets/x', { method: 'PUT', json: login })).status).toBe(201);
    const record = h.written.find((r) => r.kind === 'secret')!;
    const { memoryObjectStore } = await import('@indx-watch/store');
    const app = createApp({ ...h.deps, mode: 'local', objects: memoryObjectStore() });
    const key = `v1/log/${record.id.slice(4)}.json`;
    const body = JSON.stringify({ v: 1, writer: 'x', records: [record] });
    const put = await app.fetch(req(`/api/store/objects/${key}`, { method: 'PUT', body }));
    expect(put.status).toBe(400);
    expect(await put.text()).toContain('secret records are written by the server only');
  });

  it('keeps the value on an empty one, validates sharing, and hides sharing and forged history', async () => {
    const h = await hosted();
    await h.send('lead', '/api/secrets/staging-admin', { method: 'PUT', json: login });
    const kept = await h.send('tester', '/api/secrets/staging-admin', { method: 'PUT', json: { value: '' } });
    expect(kept.status).toBe(200);
    const shown = await h.json<{ value: string }>('tester', '/api/secrets/staging-admin/reveal', {
      method: 'POST',
    });
    expect(shown.value).toBe('hunter2!');
    expect((await h.send('lead', '/api/secrets/y', { method: 'PUT', json: { value: '' } })).status).toBe(400);
    const bad = { shared_with: 'group:qa' };
    expect((await h.send('lead', '/api/secrets/staging-admin', { method: 'PUT', json: bad })).status).toBe(
      400,
    );
    const rec = h.written.find((r) => r.kind === 'secret') as SecretRecord;
    h.written.push({ ...rec, id: 'rec_01JF7Z3K0W8N2Q4R6S8T0V9997', at: '2099-01-01T00:00:00Z', notes: 'x' });
    const [s] = (await h.json<SecretList>('lead', '/api/secrets')).secrets;
    expect(s?.history.map((e) => e.action)).toEqual(['reveal', 'set', 'set']);
  });
});

describe('sharing through bundle uploads', () => {
  it('a tester cannot change a fixture not shared with them, nor unshare one from themselves', async () => {
    // FX-4 of the shop is shared with group:qa; out@shop.test is a tester outside it
    const roles = { ...ROLES, tester: ['qa', 'out@shop.test'] };
    const h = await hosted({
      roles,
      bundleFiles: () => definitionFiles(nodeFs(SHOP)),
      publishBundle: async () => undefined,
    });
    PEOPLE.outsider = { actor: human('out@shop.test'), groups: [] };
    const toml = readFileSync(join(SHOP, 'fixtures/FX-4-review-photo/fixture.toml'), 'utf8');
    const upload = (user: string, text: string) =>
      h.send(user, '/api/bundle', {
        method: 'POST',
        json: {
          files: [
            {
              name: 'fixture.toml',
              path: 'fixtures/FX-4-review-photo/fixture.toml',
              data: Buffer.from(text).toString('base64'),
            },
          ],
          dryRun: true,
        },
      });
    const unshared = toml.replace('shared_with = ["group:qa"]\n', '');
    expect((await upload('outsider', unshared)).status).toBe(404);
    expect((await upload('tester', toml.replace('group:qa', 'group:other'))).status).toBe(400);
    expect((await upload('tester', toml.replace('Review photo', 'Review photo 2'))).status).toBe(200);
    expect((await upload('lead', unshared)).status).toBe(200);
    delete PEOPLE.outsider;
  });
});
