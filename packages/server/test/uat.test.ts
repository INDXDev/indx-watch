/**
 * Customer UAT end to end on the Worker (docs/spec/security.md#customer-uat): a fake Cloudflare Access API (the policy)
 * and a fake Access JWT issuer (a local JWKS and get-identity). A run against a real Access policy is a manual step.
 */
import { generateSigningKey, parseToml } from '@indx-watch/bundle';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeAccessApi, fakeD1 } from '../../store/test/helpers/fakes.js';
import type { InviteResult, PlanView, ProjectInfo, RunSummary } from '../src/index.js';
import { createWorker } from '../src/worker.js';
import { workspaceBucket } from './workspace-helpers.js';

const worker = createWorker();
const GROUPS: Record<string, string[]> = { 'alex@shop.test': ['QA-Leads'], 'pat@client.test': [] };

/** A fake Access issuer and Cloudflare API behind the global fetch; `as(email)` gives that person's request headers. */
async function access() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  const [api, tokens] = [fakeAccessApi(), new Map<string, string>()];
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === 'https://shop.cloudflareaccess.com/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
    if (u.endsWith('/cdn-cgi/access/get-identity')) {
      const token = new Headers(init?.headers).get('cookie')!.replace('CF_Authorization=', '');
      return Response.json({ groups: GROUPS[tokens.get(token)!]?.map((name) => ({ id: name, name })) });
    }
    return (await api.fetch(url, init)) ?? Response.json({ unexpected: u }, { status: 599 });
  });
  const as = async (email: string) => {
    const jwt = await new SignJWT({ email, sub: email })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer('https://shop.cloudflareaccess.com')
      .setAudience('aud')
      .setExpirationTime('5m')
      .sign(privateKey);
    tokens.set(jwt, email);
    return { 'Cf-Access-Jwt-Assertion': jwt, 'content-type': 'application/json' };
  };
  return { api, as };
}

describe('customer UAT on the Worker (fake Access API and issuer)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lead invites → policy gets the email → customer sees and runs only assigned items → lead sees the run; revoke → 403', async () => {
    const { r2, store } = await workspaceBucket();
    const { api, as } = await access();
    const k = await generateSigningKey('hosted');
    const env = {
      ...{
        STORE: r2,
        DB: fakeD1(),
        ASSETS: { fetch: async () => new Response('spa') },
        STORE_PREFIX: 'shop',
      },
      ...{ ACCESS_TEAM: 'shop', ACCESS_AUD: 'aud', ROLES: JSON.stringify({ lead: ['qa-leads'] }) },
      ...{ IW_SIGNING_KEY: k.secret, SIGNING_KEYS: JSON.stringify([k.key]) },
      ...{ IW_ACCESS_POLICY: 'acc/pol', CLOUDFLARE_API_TOKEN: 'cf-token' },
    };
    const [lead, pat] = [await as('alex@shop.test'), await as('pat@client.test')];
    const call = (headers: Record<string, string>, path: string, init: RequestInit = {}) =>
      worker.fetch(new Request(`https://watch.example.com${path}`, { ...init, headers }), env as never);
    const json = async <T>(headers: Record<string, string>, path: string) =>
      (await (await call(headers, path)).json()) as T;
    const post = (headers: Record<string, string>, path: string, body: unknown) =>
      call(headers, path, { method: 'POST', body: JSON.stringify(body) });

    // before the invite: Access would let pat in only through the policy; the app refuses an unknown identity
    expect((await call(pat, '/api/project')).status).toBe(403);
    expect((await post(pat, '/api/plans/PLAN-1/invites', { email: 'pat@client.test' })).status).toBe(403);
    expect(
      (await post(lead, '/api/plans/PLAN-1/invites', { email: 'pat@client.test', items: ['TC-1'] })).status,
    ).toBe(404);

    const invited = await post(lead, '/api/plans/PLAN-1/invites', {
      email: 'pat@client.test',
      items: ['TC-8', 'TC-9'],
    });
    expect(invited.status).toBe(201);
    const result = (await invited.json()) as InviteResult;
    expect(result).toMatchObject({
      plan: 'PLAN-1',
      items: ['TC-8', 'TC-9'],
      access: 'added',
      revoked: false,
    });
    expect(result.record!.actor).toMatchObject({
      kind: 'human',
      id: 'alex@shop.test',
      via: 'cloudflare-access',
    });
    expect(api.emails()).toContain('pat@client.test');
    // inviting again changes nothing: no new plan version
    const again = (await (
      await post(lead, '/api/plans/plan-1/invites', { email: 'pat@client.test', items: ['TC-9'] })
    ).json()) as InviteResult;
    expect([again.record, again.items, again.access]).toEqual([undefined, [], 'added']);
    const plan = parseToml(new TextDecoder().decode((await store.getBlob(result.record!.sha256!))!)) as {
      items: { test_case: string; assignee?: string }[];
    };
    expect(plan.items.filter((i) => i.assignee === 'pat@client.test').map((i) => i.test_case)).toEqual([
      'TC-8',
      'TC-9',
    ]);

    // the customer sees only the assigned items and records a run of one of them
    const info = await json<ProjectInfo>(pat, '/api/project');
    expect([info.role, info.can.run, info.can.review]).toEqual(['customer', true, false]);
    const plans = await json<PlanView[]>(pat, '/api/plans');
    expect(plans.flatMap((p) => p.items?.map((i) => i.test_case) ?? [])).toEqual(['TC-8', 'TC-9']);
    expect((await call(pat, '/api/test-cases/TC-3')).status).toBe(404);
    expect((await post(pat, '/api/runs', { test_case: 'TC-3', steps: [], verdict: 'pass' })).status).not.toBe(
      201,
    );
    const run = await post(pat, '/api/runs', {
      test_case: 'TC-8',
      steps: [],
      verdict: 'pass',
      note: 'Looks right',
    });
    expect(run.status).toBe(201);

    // the lead sees it with the customer's verified identity
    const runs = await json<RunSummary[]>(lead, '/api/runs?tc=TC-8');
    expect(runs[0]).toMatchObject({
      actor: { kind: 'human', id: 'pat@client.test', via: 'cloudflare-access' },
      verdict: 'pass',
    });
    expect(runs[0]!.unverified).toBeFalsy();

    // revoke: the policy drops the email and a still valid Access session is refused
    const revoked = await call(lead, '/api/plans/PLAN-1/invites/pat%40client.test', { method: 'DELETE' });
    expect(revoked.status).toBe(200);
    expect(((await revoked.json()) as InviteResult).access).toBe('removed');
    expect(api.emails()).not.toContain('pat@client.test');
    expect((await call(pat, '/api/project')).status).toBe(403);
    expect((await call(pat, '/api/plans')).status).toBe(403);
  });

  it('refuses invites without pinned roles and answers access: manual without a policy', async () => {
    const { r2 } = await workspaceBucket();
    const { as } = await access();
    const base = {
      ...{
        STORE: r2,
        DB: fakeD1(),
        ASSETS: { fetch: async () => new Response('spa') },
        STORE_PREFIX: 'shop',
      },
      ...{ ACCESS_TEAM: 'shop', ACCESS_AUD: 'aud' },
    };
    const lead = await as('alex@shop.test');
    const invite = (env: object) =>
      worker.fetch(
        new Request('https://watch.example.com/api/plans/PLAN-1/invites', {
          method: 'POST',
          headers: lead,
          body: JSON.stringify({ email: 'pat@client.test', items: ['TC-9'] }),
        }),
        env as never,
      );
    expect((await invite(base)).status).toBe(409); // no ROLES: everyone would be lead
    const withDefault = JSON.stringify({ lead: ['qa-leads'], default: 'viewer' });
    expect((await invite({ ...base, ROLES: withDefault })).status).toBe(409); // a customer would be a viewer
    const res = await invite({ ...base, ROLES: JSON.stringify({ lead: ['qa-leads'] }) });
    expect(res.status).toBe(201);
    expect(((await res.json()) as InviteResult).access).toBe('manual');
  });
});
