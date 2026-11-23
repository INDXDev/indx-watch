/** Roles from Access identity groups (docs/spec/security.md#roles): the allow/deny matrix and what a customer sees. */
import {
  type Actor,
  type Bundle,
  FileRecord,
  newId,
  newUlid,
  parseToml,
  sha256Hex,
} from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { memoryObjectStore } from '@indx-watch/store';
import { definitionFiles } from '@indx-watch/sync';
import { describe, expect, it } from 'vitest';
import { permits } from '../src/app.js';
import type { ProjectInfo } from '../src/index.js';
import { createApp, HttpError, type ServerDeps } from '../src/index.js';
import { fakeDeps, req, SHOP, SHOT_SHA, sampleRecords, shop } from './helpers.js';
import { mcpCall } from './mcp-helpers.js';

const ROLES = { lead: ['QA-Leads'], tester: ['qa'], viewer: ['viv@shop.test'], customer: ['uat'] };
/** who sends a request (x-test-user), with their Access groups */
const PEOPLE: Record<string, { actor: Actor; groups: string[] }> = {
  lead: { actor: human('alex@shop.test'), groups: ['qa-leads'] },
  tester: { actor: human('kim@shop.test'), groups: ['qa'] },
  viewer: { actor: human('viv@shop.test'), groups: [] },
  customer: { actor: human('sam@shop.test'), groups: ['uat'] },
  nobody: { actor: human('eve@other.test'), groups: ['strangers'] },
};
function human(id: string): Actor {
  return { kind: 'human', id, via: 'cloudflare-access' };
}

/** A hosted app whose fake Access identity and groups come from the x-test-user header. */
async function hosted(
  roles: ServerDeps['roles'] | null = ROLES,
  extra: Partial<ServerDeps> = {},
  bundle?: Bundle,
) {
  const f = await fakeDeps({ bundle });
  const objects = memoryObjectStore();
  const who = (r: Request) =>
    PEOPLE[r.headers.get('x-test-user') ?? ''] ?? fail(new HttpError(401, 'unauthorized', 'no token'));
  const identity = {
    current: async (r: Request) => who(r).actor,
    groups: async (r: Request) => who(r).groups,
  };
  const app = createApp({
    ...f.deps,
    mode: 'hosted',
    identity,
    objects,
    roles: roles ?? undefined,
    ...extra,
  } as ServerDeps);
  const send = (user: string, path: string, init: RequestInit & { json?: unknown } = {}) =>
    app.fetch(req(path, { ...init, headers: { ...(init.headers ?? {}), 'x-test-user': user } }));
  const sendJson = (user: string, path: string, json: unknown) => {
    const r = req(path, { json });
    r.headers.set('x-test-user', user);
    return app.fetch(r);
  };
  /** the ID of the newest run of a test case, as the lead sees it */
  const runId = async (key: string) =>
    ((await (await send('lead', `/api/runs?tc=${key}`)).json()) as { id: string }[])[0]!.id;
  return { ...f, app, send, sendJson, runId };
}
function fail(e: Error): never {
  throw e;
}
const MANUAL = (tc: string) => ({ test_case: tc, verdict: 'pass', steps: [] });
const keys = (text: string) => [...new Set(text.match(/\bTC-\d+\b/g))].sort();

describe('permits', () => {
  it('lead may do anything; others only what their role allows', () => {
    expect(permits('lead', 'POST', '/api/bundle')).toBe(true);
    expect(permits('tester', 'POST', '/api/bundle')).toBe(true); // test data only, checked by the route
    expect(permits('tester', 'PATCH', '/api/fixtures/FX-1')).toBe(true);
    expect(permits('viewer', 'POST', '/api/fixtures')).toBe(false);
    expect(permits('tester', 'POST', '/api/runs/run_1/baselines')).toBe(false);
    expect(permits('tester', 'PUT', '/api/store/objects/v1/log/x.json')).toBe(true);
    expect(permits('viewer', 'GET', '/api/store/list')).toBe(true);
    expect(permits('customer', 'GET', '/api/store/list')).toBe(false);
    expect(permits('customer', 'GET', '/api/snapshots')).toBe(false);
    expect(permits('customer', 'GET', '/mcp')).toBe(false);
    expect(permits('customer', 'POST', '/api/runs/run_1/judgements')).toBe(false);
    expect(permits('viewer', 'POST', '/api/blobs')).toBe(false);
    expect(permits('viewer', 'DELETE', '/api/shares/x')).toBe(false);
    expect(permits(undefined, 'GET', '/api/specs')).toBe(false);
  });
});

describe('roles on the hosted app', () => {
  it('allow/deny matrix over the API', async () => {
    const h = await hosted();
    const tc8 = await h.runId('TC-8');
    const status = async (user: string) => ({
      specs: (await h.send(user, '/api/specs')).status,
      run: (await h.sendJson(user, '/api/runs', MANUAL('TC-8'))).status,
      review: (await h.sendJson(user, `/api/runs/${tc8}/judgements`, { verdict: 'pass', reason: 'ok' }))
        .status,
      blob: (
        await h.send(user, '/api/blobs', { method: 'POST', body: 'x', headers: { 'x-iw-request': '1' } })
      ).status,
      storeList: (await h.send(user, '/api/store/list')).status,
      bundle: (await h.sendJson(user, '/api/bundle', { files: [] })).status,
    });
    expect(await status('lead')).toEqual({
      specs: 200,
      run: 201,
      review: 201,
      blob: 201,
      storeList: 200,
      bundle: 403,
    });
    expect(await status('tester')).toMatchObject({
      specs: 200,
      run: 201,
      review: 201,
      blob: 201,
      storeList: 200,
    });
    expect(await status('viewer')).toMatchObject({
      specs: 200,
      run: 403,
      review: 403,
      blob: 403,
      storeList: 200,
    });
    expect(await status('customer')).toMatchObject({
      specs: 200,
      run: 201,
      review: 403,
      blob: 201,
      storeList: 403,
    });
    expect(await status('nobody')).toMatchObject({
      specs: 403,
      run: 403,
      review: 403,
      blob: 403,
      storeList: 403,
    });
    // the bundle upload is refused for the lead and the tester because this server cannot write; for others by role
    expect(await (await h.sendJson('tester', '/api/bundle', { files: [] })).text()).toContain('cannot write');
    expect(await (await h.sendJson('viewer', '/api/bundle', { files: [] })).text()).toContain('viewer');
    const tc1 = await h.runId('TC-1');
    const approve = (user: string) => h.sendJson(user, `/api/runs/${tc1}/baselines`, { sha256: SHOT_SHA });
    expect((await approve('tester')).status).toBe(403);
    expect((await approve('lead')).status).toBe(201);
  });

  it('a default role lets unmatched identities in; no roles at all means lead', async () => {
    const d = await hosted({ ...ROLES, default: 'viewer' });
    const p = (await (await d.send('nobody', '/api/project')).json()) as ProjectInfo;
    expect(p).toMatchObject({ role: 'viewer', can: { run: false, review: false, approve: false } });
    const open = await hosted(null);
    const q = (await (await open.send('nobody', '/api/project')).json()) as ProjectInfo;
    expect(q).toMatchObject({ role: 'lead', can: { run: true, review: true, approve: true } });
  });

  it('store writes: testers append runs, but waivers need the lead role', async () => {
    const h = await hosted();
    const records = sampleRecords(h.bundle);
    const put = (user: string, kind: string) =>
      h.send(user, `/api/store/objects/v1/log/${newUlid()}.json`, {
        method: 'PUT',
        headers: { 'if-none-match': '*' },
        body: JSON.stringify({ v: 1, writer: 'w', records: records.filter((r) => r.kind === kind) }),
      });
    expect((await put('tester', 'run')).status).toBe(201);
    expect((await put('tester', 'waiver')).status).toBe(403);
    expect((await put('lead', 'waiver')).status).toBe(201);
    expect((await put('viewer', 'run')).status).toBe(403);
  });

  it('/mcp: viewers read, testers record runs, only leads write drafts, customers are refused', async () => {
    const h = await hosted();
    const call = (user: string, tool: string, args: object) =>
      mcpCall(h.app.fetch, 'http://127.0.0.1', tool, args, { 'x-test-user': user });
    expect((await call('viewer', 'status', { release: 'v1.2.0' })).isError).toBeFalsy();
    const run = { test_case: 'TC-8', verdict: 'pass', confidence: 0.9, note: 'ok', model: 'claude-test' };
    const denied = await call('viewer', 'record_run', run);
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).toContain('viewer');
    expect((await call('tester', 'record_run', run)).isError).toBeFalsy();
    const draft = { kind: 'feature', fields: { title: 'X' }, model: 'claude-test' };
    expect(JSON.stringify(await call('tester', 'new', draft))).toContain('tester role cannot write');
    expect((await call('customer', 'status', {})).status).toBe(403);
  });
});

/** A hosted app in workspace mode whose store already holds the test case files as `file` records. */
async function workspaceHosted() {
  const b = await shop();
  const project = { ...b.project.data, store: { ...b.project.data.store!, mode: 'workspace' as const } };
  const files = await definitionFiles(nodeFs(SHOP));
  const records: FileRecord[] = [];
  for (const [path, data] of files) {
    const entity = path.endsWith('.toml') ? parseToml(new TextDecoder().decode(data)).id : undefined;
    const env = { kind: 'file', id: newId('rec'), v: 1, project: project.id, at: '2026-11-18T00:00:00Z' };
    const actor = { kind: 'human', id: 'alex@shop.test', via: 'git' };
    records.push(
      FileRecord.parse({ ...env, actor, source: 'cli', path, entity, sha256: await sha256Hex(data) }),
    );
  }
  const extra = { bundleFiles: async () => files, records: async () => records };
  return hosted(ROLES, extra, { ...b, project: { ...b.project, data: project } });
}

describe('roles: definition edits in workspace mode', () => {
  it('only leads edit (PATCH /api/test-cases/:key); others, customers included, are refused before the lookup', async () => {
    const h = await workspaceHosted();
    const patch = (user: string, key: string) => {
      const r = req(`/api/test-cases/${key}`, { method: 'PATCH', json: { priority: 'P1' } });
      r.headers.set('x-test-user', user);
      return h.app.fetch(r);
    };
    expect(permits('tester', 'PATCH', '/api/test-cases/TC-3')).toBe(false);
    for (const user of ['viewer', 'tester', 'customer', 'nobody']) {
      expect((await patch(user, 'TC-3')).status, user).toBe(403);
      // an unknown or unassigned key answers 403 too, so a customer learns nothing about it
      expect((await patch(user, 'TC-999')).status, user).toBe(403);
    }
    expect(h.written).toEqual([]);
    const res = await patch('lead', 'TC-3');
    expect(res.status).toBe(201);
    expect(h.written).toMatchObject([{ kind: 'file', actor: { id: 'alex@shop.test' } }]);
    const can = async (user: string) =>
      ((await (await h.send(user, '/api/project')).json()) as ProjectInfo).can.edit;
    expect([await can('lead'), await can('tester'), await can('viewer'), await can('customer')]).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });
});

describe('a customer sees only assigned plan items', () => {
  it('across specs, status, test cases, runs, plans, fixtures, blobs and reports', async () => {
    const h = await hosted();
    const text = async (path: string, user = 'customer') => {
      const res = await h.send(user, path);
      expect(res.status, path).toBe(200);
      return res.text();
    };
    // PLAN-1 assigns TC-8 to sam@shop.test
    for (const path of [
      '/api/specs',
      '/api/status?release=v1.2.0',
      '/api/runs',
      '/api/plans',
      '/api/fixtures',
    ])
      expect(
        keys(await text(path)).filter((k) => k !== 'TC-8'),
        path,
      ).toEqual([]);
    expect(keys(await text('/api/specs'))).toEqual(['TC-8']);
    expect(keys(await text('/api/specs', 'viewer')).length).toBeGreaterThan(5);
    expect((await h.send('customer', '/api/test-cases/TC-6')).status).toBe(404);
    expect((await h.send('customer', `/api/runs/${await h.runId('TC-4')}`)).status).toBe(404);
    expect((await h.send('customer', `/api/runs/${await h.runId('TC-8')}`)).status).toBe(200);
    expect((await h.sendJson('customer', '/api/runs', MANUAL('TC-6'))).status).toBe(404);
    // the TC-1 screenshot belongs to a run the customer does not see
    expect((await h.send('customer', `/api/blobs/${SHOT_SHA}`)).status).toBe(404);
    expect((await h.send('viewer', `/api/blobs/${SHOT_SHA}`)).status).toBe(200);
    // reports: only assigned items, always the customer audience
    const report = await text('/api/report?format=md&audience=internal&release=v1.2.0');
    expect(keys(report).filter((k) => k !== 'TC-8')).toEqual([]);
    expect(report).not.toMatch(/@shop\.test/);
    const info = JSON.parse(await text('/api/project')) as ProjectInfo;
    expect(info).toMatchObject({ role: 'customer', problems: [], share: { clone: null } });
    expect(info.can).toMatchObject({ run: true, review: false, approve: false, upload: false, share: false });
    expect(info.snapshot).toBeUndefined();
    expect(info.environments.map((e) => [e.guide, e.access])).toEqual(
      info.environments.map(() => [undefined, undefined]),
    );
    const fixtures = JSON.parse(await text('/api/fixtures')) as { key: string }[];
    expect(fixtures.map((f) => f.key)).toEqual(['FX-3']);
    expect((await h.send('customer', '/api/fixtures/FX-1')).status).toBe(404);
  });

  it("without other people's emails, notes, judgement reasons or CI links, as in customer reports", async () => {
    const h = await hosted();
    const note = { ...MANUAL('TC-8'), note: 'internal: flaky on staging', reason: 'checked by kim' };
    expect((await h.sendJson('tester', '/api/runs', note)).status).toBe(201);
    expect((await h.sendJson('customer', '/api/runs', MANUAL('TC-8'))).status).toBe(201);
    const ids = ((await (await h.send('lead', '/api/runs?tc=TC-8')).json()) as { id: string }[]).map(
      (r) => r.id,
    );
    const details = async (user: string) =>
      (await Promise.all(ids.map(async (id) => (await h.send(user, `/api/runs/${id}`)).text()))).join();
    expect(await details('viewer')).toContain('internal: flaky');
    for (const path of ['/api/runs', '/api/test-cases/TC-8', ...ids.map((id) => `/api/runs/${id}`)]) {
      // their own email and the FX-3 account they test with stay
      const body = (await (await h.send('customer', path)).text()).replace(/(sam|casey)@shop\.test/g, '');
      expect(body, path).not.toMatch(/@shop\.test|internal:|checked by/);
    }
    expect(await (await h.send('customer', '/api/runs?tc=TC-8')).text()).toContain('sam@shop.test');
    expect(await (await h.send('viewer', '/api/runs?tc=TC-8')).text()).toContain('kim@shop.test');
  });
});
