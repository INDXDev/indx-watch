/** GitHub OIDC signing (docs/spec/security.md#github-oidc), with a locally generated key pair as a fake GitHub issuer. */
import {
  type Actor,
  type AnyRecord,
  generateSigningKey,
  type RunRecord,
  verifyRecord,
} from '@indx-watch/bundle';
import { githubOidcVerifier, oidcSigner, StoreError } from '@indx-watch/store';
import { processIdentity } from '@indx-watch/store/node';
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  claimsMismatch,
  createApp,
  githubOidcSigning,
  pinnedRepositories,
  type ServerDeps,
} from '../src/index.js';
import { fakeDeps, run, shop } from './helpers.js';

const ISSUER = 'https://token.actions.githubusercontent.com';
const ACTOR: Actor = { kind: 'ci', id: 'github:octocat', name: 'octocat', via: 'github-oidc' };
const CLAIMS = { repository: 'INDXDev/shop', repository_id: '42', actor: 'octocat', run_id: '7' };

async function issuer() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'gh', alg: 'RS256' }] });
  const token = (aud: string, o: { claims?: JWTPayload; iss?: string; exp?: string | number } = {}) =>
    new SignJWT({ ...CLAIMS, ...o.claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'gh' })
      .setIssuer(o.iss ?? ISSUER)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(o.exp ?? '5m')
      .sign(privateKey);
  return { jwks, token };
}

/** A hosted app over the shop with OIDC signing; Access would refuse every other route. */
async function setup(repositories = ['indxdev/shop']) {
  const gh = await issuer();
  const { secret, key } = await generateSigningKey('srv');
  const f = await fakeDeps();
  const refuse = async (): Promise<Actor> => Promise.reject(new StoreError('unauthorized', 'no Access JWT'));
  const signForGithub = githubOidcSigning({
    verifier: githubOidcVerifier({ jwks: gh.jwks }),
    repositories,
    secret,
  });
  const deps: ServerDeps = { ...f.deps, mode: 'hosted', identity: { current: refuse }, signForGithub };
  const app = createApp(deps);
  const project = f.bundle.project.data.id;
  const aud = `indx-watch:${project}`;
  const record = (o: Partial<RunRecord> = {}): RunRecord => ({
    ...run(f.bundle, 'TC-1', { actor: ACTOR }),
    ci: { provider: 'github', repository: 'INDXDev/shop', run_id: '7' },
    ...o,
  });
  const post = (records: unknown[], token?: string) =>
    app.fetch(
      new Request('https://watch.test/api/sign', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
        body: JSON.stringify({ records }),
      }),
    );
  return { gh, key, app, aud, record, post, project };
}

describe('GitHub OIDC verifier', () => {
  it('checks signature, issuer, audience, expiry and the claims it needs', async () => {
    const gh = await issuer();
    const v = githubOidcVerifier({ jwks: gh.jwks });
    expect(await v.verify(await gh.token('a'), 'a')).toMatchObject(CLAIMS);
    const other = await issuer();
    const bad = [
      await gh.token('b'),
      await gh.token('a', { iss: 'https://evil.test' }),
      await gh.token('a', { exp: Math.floor(Date.now() / 1000) - 600 }),
      await other.token('a'),
      await gh.token('a', { claims: { run_id: undefined } }),
    ];
    for (const t of bad) await expect(v.verify(t, 'a')).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

describe('POST /api/sign', () => {
  it('signs records whose actor and ci match the token, without Access', async () => {
    const s = await setup();
    const res = await s.post([s.record()], await s.gh.token(s.aud));
    expect(res.status).toBe(200);
    const [signed] = ((await res.json()) as { records: AnyRecord[] }).records;
    expect(signed!.sig?.kid).toBe('srv');
    expect(await verifyRecord(signed!, [{ ...s.key, via: ['github-oidc'] }])).toBe(true);
    expect(await verifyRecord(signed!, [{ ...s.key, via: ['github'] }])).toBe(false);
  });

  it('refuses bad tokens, unpinned repositories and records the claims do not cover', async () => {
    const s = await setup();
    const status = async (records: unknown[], token?: string) => (await s.post(records, token)).status;
    expect(await status([s.record()])).toBe(401);
    expect(await status([s.record()], await s.gh.token('indx-watch:prj_other'))).toBe(401);
    const ok = await s.gh.token(s.aud);
    expect(await status([s.record({ actor: { ...ACTOR, id: 'github:mallory' } })], ok)).toBe(403);
    expect(await status([s.record(), s.record({ actor: { ...ACTOR, via: 'github' } })], ok)).toBe(403);
    expect(await status([s.record({ ci: { provider: 'github', repository: 'x/y', run_id: '7' } })], ok)).toBe(
      403,
    );
    expect(await status([], ok)).toBe(400);
    const other = await s.gh.token(s.aud, { claims: { repository: 'mallory/shop', repository_id: '9' } });
    expect(await status([s.record()], other)).toBe(403);
    const byId = await setup(['42']);
    expect((await byId.post([byId.record()], await byId.gh.token(byId.aud))).status).toBe(200);
  });

  it('is not served without a signing key or pinned repositories', async () => {
    const verifier = githubOidcVerifier({ jwks: (await issuer()).jwks });
    expect(githubOidcSigning({ verifier, repositories: ['a/b'] })).toBeUndefined();
    expect(githubOidcSigning({ verifier, repositories: [], secret: 'x' })).toBeUndefined();
    const app = createApp((await fakeDeps()).deps);
    const r = new Request('http://127.0.0.1/api/sign', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
      body: '{"records":[]}',
    });
    expect((await app.fetch(r)).status).toBe(404);
    expect(pinnedRepositories('["a/b", 3, ""]')).toEqual(['a/b']);
    expect(pinnedRepositories('nope')).toEqual([]);
  });

  it('claimsMismatch allows agents and records without ci', async () => {
    const b = await shop();
    const r = run(b, 'TC-1', { actor: { ...ACTOR, kind: 'agent', model: 'm' } });
    expect(claimsMismatch({ ...r, ci: undefined }, CLAIMS, b.project.data.id)).toBeUndefined();
    expect(claimsMismatch(r, CLAIMS, 'prj_other')).toMatch(/another project/);
  });
});

describe('writer', () => {
  it('records via github-oidc and gets the server signature through the token exchange', async () => {
    const s = await setup();
    const env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_ACTOR: 'octocat',
      IW_OIDC_SIGNER: 'https://watch.test/',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://gh.test/token?api-version=2.0',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'rt',
    };
    expect(await processIdentity({ env }).current()).toEqual(ACTOR);
    expect((await processIdentity({ env: { ...env, IW_SIGNING_KEY: 'k' } }).current()).via).toBe('github');
    let requests = 0;
    const fetchFake = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.host !== 'gh.test') return s.app.fetch(new Request(url, init));
      requests++;
      expect(url.searchParams.get('api-version')).toBe('2.0');
      expect((init?.headers as Record<string, string> | undefined)?.authorization).toBe('bearer rt');
      return Response.json({ value: await s.gh.token(url.searchParams.get('audience')!) });
    };
    const sign = oidcSigner(env, async () => ({ 'CF-Access-Client-Id': 'id' }), fetchFake as typeof fetch);
    const signed = [await sign(s.record()), await sign(s.record())];
    expect(requests).toBe(1); // the token is reused
    for (const r of signed) expect(await verifyRecord(r, [s.key])).toBe(true);
    const refused = sign(s.record({ actor: { ...ACTOR, id: 'github:mallory' } }));
    await expect(refused).rejects.toBeInstanceOf(StoreError);
    const garbled = async (input: string | URL | Request, init?: RequestInit) =>
      new URL(String(input)).host === 'gh.test' ? fetchFake(input, init) : new Response('<html>');
    const bad = oidcSigner(env, async () => ({}), garbled as typeof fetch)(s.record());
    await expect(bad).rejects.toBeInstanceOf(StoreError); // a non-JSON reply exits 4, not as a key error
    expect(() => oidcSigner({ ...env, IW_OIDC_SIGNER: 'http://watch.test' }, async () => ({}))).toThrow(
      /https/,
    );
  });
});
