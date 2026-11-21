/** GitHub Actions OIDC (docs/spec/security.md#github-oidc): verifying ID tokens, and exchanging them for record signatures. */
import { AnyRecord } from '@indx-watch/bundle';
import { createRemoteJWKSet, decodeJwt, type JWTVerifyGetKey, jwtVerify } from 'jose';
import { type GithubOidcClaims, type OidcVerifier, StoreError } from '../ports.js';
import { guardedFetch, httpError, SECURE_URL } from '../util.js';

type Env = Record<string, string | undefined>;

/** Verifies tokens against GitHub's JWKS; `jwks` and `issuer` replace them in tests (a local fake issuer). */
export function githubOidcVerifier(opts: { jwks?: JWTVerifyGetKey; issuer?: string } = {}): OidcVerifier {
  const issuer = opts.issuer ?? 'https://token.actions.githubusercontent.com';
  const jwks = opts.jwks ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`));
  return {
    async verify(token, audience) {
      let claims: Record<string, unknown>;
      try {
        claims = (await jwtVerify(token, jwks, { issuer, audience })).payload;
      } catch (e) {
        throw new StoreError('unauthorized', `invalid GitHub OIDC token: ${(e as Error).message}`, e);
      }
      const keys = ['repository', 'repository_id', 'actor', 'run_id'] as const;
      if (keys.some((k) => typeof claims[k] !== 'string' || !claims[k]))
        throw new StoreError('unauthorized', `GitHub OIDC token lacks one of ${keys.join(', ')}`);
      return claims as unknown as GithubOidcClaims;
    },
  };
}

/** The audience a writer requests and the server expects. */
export const oidcAudience = (project: string) => `indx-watch:${project}`;

/** True when this process signs through GitHub OIDC: the actor is GITHUB_ACTOR (no IW_ACTOR), IW_OIDC_SIGNER, id-token: write, no IW_SIGNING_KEY. */
export const usesGithubOidc = (e: Env) =>
  !!(e.GITHUB_ACTIONS === 'true' && e.GITHUB_ACTOR && !e.IW_ACTOR && e.IW_OIDC_SIGNER) &&
  !!e.ACTIONS_ID_TOKEN_REQUEST_URL &&
  !e.IW_SIGNING_KEY;

/**
 * Signs each record by exchanging a GitHub OIDC token at IW_OIDC_SIGNER's POST /api/sign, keeping only the returned `sig`;
 * any failure (also a malformed token or reply) is a StoreError, exit 4.
 * `headers` gives Cloudflare Access credentials for the server; `f` replaces fetch in tests.
 */
export function oidcSigner(env: Env, headers: () => Promise<Record<string, string>>, f = fetch) {
  const base = env.IW_OIDC_SIGNER!.replace(/\/+$/, '');
  if (!SECURE_URL.test(base))
    throw new StoreError('invalid', `IW_OIDC_SIGNER must be an https:// URL: ${base}`);
  const tokens = new Map<string, Promise<string>>();
  const request = async (audience: string) => {
    const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL!);
    url.searchParams.set('audience', audience);
    const auth = { authorization: `bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN ?? ''}` };
    const res = await guardedFetch('GitHub OIDC token', () => f(url, { headers: auth }));
    if (!res.ok) throw httpError(res.status, 'GitHub OIDC token (needs permissions: id-token: write)');
    const { value } = (await res.json()) as { value?: unknown };
    if (typeof value !== 'string') throw new StoreError('invalid', 'no token from GitHub');
    return value;
  };
  /** a token per audience, reused until a minute before it expires */
  const token = async (audience: string) => {
    const held = await tokens.get(audience)?.catch(() => undefined);
    if (held && (decodeJwt(held).exp ?? 0) * 1000 - Date.now() > 60_000) return held;
    return tokens.set(audience, request(audience)).get(audience)!;
  };
  const wrap = (e: unknown) =>
    Promise.reject(e instanceof StoreError ? e : new StoreError('invalid', `GitHub OIDC signing: ${e}`, e));
  const sign = async <R extends AnyRecord>(r: R): Promise<R> => {
    const authorization = `Bearer ${await token(oidcAudience(r.project))}`;
    const init = { method: 'POST', redirect: 'manual' as const, body: JSON.stringify({ records: [r] }) };
    const h = { ...(await headers()), 'content-type': 'application/json', authorization };
    const res = await guardedFetch('POST /api/sign', () => f(`${base}/api/sign`, { ...init, headers: h }));
    if (!res.ok) throw httpError(res.status, `POST ${base}/api/sign`);
    const sig = ((await res.json()) as { records?: { sig?: unknown }[] }).records?.[0]?.sig;
    return sig ? (AnyRecord.parse({ ...r, sig }) as typeof r) : r; // only the signature: the record stays ours
  };
  return <R extends AnyRecord>(r: R) => sign(r).catch(wrap);
}
