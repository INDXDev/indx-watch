/** A reusable Cloudflare Access policy as the invite list of customer UAT (docs/spec/security.md#customer-uat). */
import { type AccessPolicy, StoreError } from '../ports.js';
import { SECURE_URL } from '../util.js';

type Rule = { email?: { email?: string } };
type Policy = { include?: Rule[] } & Record<string, unknown>;

/**
 * `IW_ACCESS_POLICY` (`<account id>/<policy id>`) and `CLOUDFLARE_API_TOKEN`: GET the policy, PUT back every field
 * read (but the read-only ones) with the email added to or removed from `include`, then GET again to verify, since
 * a concurrent PUT can drop it. `CLOUDFLARE_API_BASE_URL` replaces the API base (https or loopback; tests).
 */
export function cloudflareAccessPolicy(env: Record<string, string | undefined>): AccessPolicy | undefined {
  const [account, policy] = env.IW_ACCESS_POLICY?.split('/') ?? [];
  if (!account || !policy || !env.CLOUDFLARE_API_TOKEN) return undefined;
  const api = env.CLOUDFLARE_API_BASE_URL ?? 'https://api.cloudflare.com/client/v4';
  const url = `${api}/accounts/${encodeURIComponent(account)}/access/policies/${encodeURIComponent(policy)}`;
  const headers = { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' };
  const call = async (init: RequestInit) => {
    if (!SECURE_URL.test(api)) throw new StoreError('invalid', 'CLOUDFLARE_API_BASE_URL must be https://');
    const res = await fetch(url, { ...init, headers }).catch((e) => {
      throw new StoreError('network', `Cloudflare API: ${(e as Error).message}`, e);
    });
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; result?: Policy };
    if (!res.ok || !body.success || !body.result)
      throw new StoreError('network', `Cloudflare API: the Access policy answered ${res.status}`);
    return body.result;
  };
  const change = async (email: string, add: boolean) => {
    const has = (r: Rule) => r.email?.email?.toLowerCase() === email.toLowerCase();
    for (let put = 0; ; put++) {
      const { id: _, created_at: _c, updated_at: _u, app_count: _a, reusable: _r, ...p } = await call({});
      const include = p.include ?? [];
      if (include.some(has) === add) return put > 0;
      if (put === 2) throw new StoreError('conflict', 'the Access policy changed meanwhile: invite again');
      const next = add ? [...include, { email: { email } }] : include.filter((r) => !has(r));
      await call({ method: 'PUT', body: JSON.stringify({ ...p, include: next }) });
    }
  };
  return { allow: (email) => change(email, true), revoke: (email) => change(email, false) };
}
