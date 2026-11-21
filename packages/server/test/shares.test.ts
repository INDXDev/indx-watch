/** Report share links (docs/spec/reports.md#share-links): create, open without identity, expire, revoke, audit records. */
import type { Actor, ShareRecord } from '@indx-watch/bundle';
import { describe, expect, it } from 'vitest';
import type { ProjectInfo, ShareCreated, ShareLink } from '../src/index.js';
import { createApp, HttpError, type ServerDeps } from '../src/index.js';
import { fakeDeps, NOW, req, run, SAM } from './helpers.js';

const KIM: Actor = { kind: 'human', id: 'kim@shop.test', name: 'Kim', via: 'cloudflare-access' };
const SIGNED_IN = { headers: { 'x-test-user': 'kim' } };

/** A hosted app whose identity needs the x-test-user header (as Access needs its JWT); the clock can move. */
async function hosted(actor: Actor = KIM, mode: 'hosted' | 'local' = 'hosted') {
  const f = await fakeDeps();
  let now = NOW;
  const identity = {
    current: async (r: Request) => {
      if (!r.headers.has('x-test-user')) throw new HttpError(401, 'unauthorized', 'no token');
      return actor;
    },
  };
  const app = createApp({ ...f.deps, mode, identity, now: () => now } as ServerDeps);
  const shares = () => f.written.filter((r): r is ShareRecord => r.kind === 'share');
  const send = (path: string, method = 'GET') => app.fetch(req(path, { method, ...SIGNED_IN }));
  return { ...f, app, shares, send, setNow: (d: string) => (now = new Date(d)) };
}

const pathOf = (url: string) => new URL(url).pathname;

describe('share links', () => {
  it('serves a frozen snapshot without identity until it expires; every step is a share record', async () => {
    const h = await hosted();
    const res = await h.send('/api/shares?release=v1.2.0&locale=ja&days=3', 'POST');
    expect(res.status).toBe(201);
    const { link, url } = (await res.json()) as ShareCreated;
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1\/s\/[0-9a-f]{32}$/);
    expect(link).toMatchObject({ audience: 'customer', locale: 'ja', release: 'v1.2.0', state: 'active' });
    expect(link).toMatchObject({ expires_at: '2026-11-22T00:00:00Z', opens: 0, actor: KIM });
    const [created] = h.shares();
    expect(created).toMatchObject({ action: 'create', actor: KIM, id: link.id });
    expect(JSON.stringify(created)).not.toContain(pathOf(url).slice(3)); // only the token's hash is stored
    expect(new TextDecoder().decode(h.blobs.get(created!.sha256!))).toContain('<html');

    // no identity needed; new results do not change the snapshot
    const first = await h.app.fetch(req(pathOf(url)));
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(first.headers.get('referrer-policy')).toBe('no-referrer');
    expect(first.headers.get('content-security-policy')).toContain("default-src 'none'");
    const before = await first.text();
    expect(before).not.toMatch(/@shop\.test/); // customer audience
    h.written.push(run(h.bundle, 'TC-9', { verdict: 'fail', ended: '2026-11-19T00:00:00Z' }));
    expect(await (await h.app.fetch(req(pathOf(url)))).text()).toBe(before);
    expect(h.shares().filter((r) => r.action === 'open')).toHaveLength(2);
    expect(h.shares().at(-1)).toMatchObject({ link: link.id, actor: { id: 'anonymous', via: 'env' } });

    const [listed] = (await (await h.send('/api/shares')).json()) as ShareLink[];
    expect(listed).toMatchObject({ id: link.id, opens: 2, state: 'active' });
    expect(JSON.stringify(listed)).not.toContain('token');

    h.setNow('2026-11-22T00:00:00Z');
    expect((await h.app.fetch(req(pathOf(url)))).status).toBe(404);
    expect((await h.app.fetch(req('/s/00000000000000000000000000000000'))).status).toBe(404);
    expect(h.shares().filter((r) => r.action === 'open')).toHaveLength(2); // 404s are not recorded
    expect(((await (await h.send('/api/shares')).json()) as ShareLink[])[0]!.state).toBe('expired');
    // every other route still needs an identity
    expect((await h.app.fetch(req('/api/shares'))).status).toBe(401);
  });

  it('revokes a link at once and records who did', async () => {
    const h = await hosted();
    const { link, url } = (await (
      await h.send('/api/shares?audience=internal', 'POST')
    ).json()) as ShareCreated;
    expect(link.audience).toBe('internal');
    const res = await h.send(`/api/shares/${link.id}`, 'DELETE');
    expect(res.status).toBe(200);
    expect((await res.json()) as ShareLink).toMatchObject({ state: 'revoked', revoked: { actor: KIM } });
    expect((await h.app.fetch(req(pathOf(url)))).status).toBe(404);
    await h.send(`/api/shares/${link.id}`, 'DELETE'); // again: nothing new
    expect(h.shares().map((r) => r.action)).toEqual(['create', 'revoke']);
    expect((await h.send('/api/shares/rec_01JF7Z3K0W8N2Q4R6S8T0V9999', 'DELETE')).status).toBe(404);
  });

  it('only people signed in through Access on the hosted app create or revoke links', async () => {
    const declared: Actor = { kind: 'human', id: 'sam@shop.test', via: 'browser' };
    const agent: Actor = { ...KIM, kind: 'agent' };
    for (const [actor, mode] of [
      [SAM, 'hosted'],
      [declared, 'hosted'],
      [agent, 'hosted'],
      [KIM, 'local'],
    ] as const) {
      const h = await hosted(actor, mode);
      expect((await h.send('/api/shares', 'POST')).status).toBe(403);
      expect(((await (await h.send('/api/project')).json()) as ProjectInfo).can.share).toBe(false);
      expect(h.shares()).toEqual([]);
    }
    const h = await hosted();
    expect(((await (await h.send('/api/project')).json()) as ProjectInfo).can.share).toBe(true);
    expect((await h.send('/api/shares?days=91', 'POST')).status).toBe(400);
    expect((await h.send('/api/shares?evidence=links', 'POST')).status).toBe(400);
    expect((await h.app.fetch(req('/api/shares', { method: 'POST' }))).status).toBe(401);
  });

  it('the store endpoint refuses share records from clients', async () => {
    const h = await hosted();
    const { link } = (await (await h.send('/api/shares', 'POST')).json()) as ShareCreated;
    expect(link.state).toBe('active');
    const record = h.shares()[0];
    const { memoryObjectStore } = await import('@indx-watch/store');
    const app = createApp({ ...h.deps, mode: 'local', objects: memoryObjectStore() });
    const key = `v1/log/${record!.id.slice(4)}.json`;
    const body = JSON.stringify({ v: 1, writer: 'x', records: [record] });
    const put = await app.fetch(req(`/api/store/objects/${key}`, { method: 'PUT', body }));
    expect(put.status).toBe(400);
    expect(await put.text()).toContain('share records are written by the server only');
  });
});
