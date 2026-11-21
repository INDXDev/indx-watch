/** A reusable Cloudflare Access policy as the invite list of customer UAT (docs/spec/security.md#customer-uat). */
import { type AccessPolicy, StoreError } from '../ports.js';
import { SECURE_URL } from '../util.js';

type Rule = { email?: { email?: string } };
type Policy = { include?: Rule[] } & Record<string, unknown>;
const KEPT = ['name', 'decision', 'include', 'exclude', 'require', 'session_duration'];

/**
 * `IW_ACCESS_POLICY` (`<account id>/<policy id>`) and `CLOUDFLARE_API_TOKEN`: GET the policy, PUT it back with the
 * email added to or removed from `include`. `CLOUDFLARE_API_BASE_URL` replaces the API base (https or loopback; tests).
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
    const p = await call({ method: 'GET' });
    const include = p.include ?? [];
    const has = (r: Rule) => r.email?.email?.toLowerCase() === email.toLowerCase();
    if (include.some(has) === add) return false;
    const next = add ? [...include, { email: { email } }] : include.filter((r) => !has(r));
    const body = Object.fromEntries(KEPT.filter((k) => k in p).map((k) => [k, p[k]]));
    await call({ method: 'PUT', body: JSON.stringify({ ...body, include: next }) });
    return true;
  };
  return { allow: (email) => change(email, true), revoke: (email) => change(email, false) };
}
