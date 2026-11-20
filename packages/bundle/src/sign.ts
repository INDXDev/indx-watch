/**
 * Signed records (docs/spec/security.md#signed-records): Ed25519 via WebCrypto (Node >= 22 and Workers).
 * Signed bytes = "indx-watch/record/v1\n" + canonical record JSON without `sig`.
 */
import { type RecordSig, type SigningKey, VERIFIED_VIA, type Via } from './schema/common.js';
import { type Actor, AnyRecord } from './schema/records.js';

const ED = { name: 'Ed25519' } as const;
const enc = new TextEncoder();
const B64U: Record<string, string> = { '+': '-', '/': '_', '=': '' };
const b64u = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/[+/=]/g, (c) => B64U[c]!);
const unb64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const message = (r: AnyRecord) =>
  enc.encode(`indx-watch/record/v1\n${JSON.stringify(AnyRecord.parse({ ...r, sig: undefined }))}`);
/** IW_SIGNING_KEY format: iwsk1:<kid>:<base64url PKCS#8> */
const SECRET = /^iwsk1:([A-Za-z0-9._-]{1,64}):([A-Za-z0-9_-]+)$/;
/** The judgements a record carries (`judgements` may be missing from a record checkRecord kept as received). */
const judgementsOf = (r: AnyRecord) =>
  r.kind === 'run' ? (r.judgements ?? []) : r.kind === 'judgement' ? [r.judgement] : [];

/** A new key pair: `secret` goes into IW_SIGNING_KEY (never into files), `key` into project.toml [[signing_keys]]. */
export async function generateSigningKey(kid: string): Promise<{ secret: string; key: SigningKey }> {
  const k = (await crypto.subtle.generateKey(ED, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pkcs8 = b64u(await crypto.subtle.exportKey('pkcs8', k.privateKey));
  const public_key = b64u(await crypto.subtle.exportKey('raw', k.publicKey));
  return { secret: `iwsk1:${kid}:${pkcs8}`, key: { kid, public_key } };
}

/**
 * A signer for IW_SIGNING_KEY; without a secret it returns records unchanged. Throws on a malformed secret; a secret
 * whose key material is broken rejects on the first sign. It vouches only for the writer's own identity: a record
 * whose judgements claim another verified identity (e.g. taken from `iw record --from`) is returned unsigned.
 */
export function recordSigner(secret: string | undefined): <R extends AnyRecord>(record: R) => Promise<R> {
  if (!secret) return async (r) => r;
  const m = SECRET.exec(secret.trim());
  if (!m) throw new Error('IW_SIGNING_KEY is not a signing key from `iw keygen`');
  let key: Promise<CryptoKey> | undefined;
  return async (r) => {
    const other = (a?: Actor) =>
      !!a && VERIFIED_VIA.includes(a.via) && JSON.stringify(a) !== JSON.stringify(r.actor);
    if (judgementsOf(r).some((j) => other(j.by))) return r;
    key ??= crypto.subtle.importKey('pkcs8', unb64u(m[2]!), ED, false, ['sign']);
    const value = b64u(await crypto.subtle.sign(ED, await key, message(r)));
    const sig: RecordSig = { alg: 'Ed25519', kid: m[1]!, value };
    return AnyRecord.parse({ ...r, sig }) as typeof r;
  };
}

/** Verified `via` values a record claims: its actor and the `by` of every judgement in it. */
export function verifiedClaims(r: AnyRecord): Via[] {
  const by = judgementsOf(r).map((j) => j.by);
  return [r.actor, ...by].flatMap((a) => (a && VERIFIED_VIA.includes(a.via) ? [a.via] : []));
}

/** True when the record carries a valid signature by one of `keys` that may vouch for every verified `via` it claims. */
export async function verifyRecord(r: AnyRecord, keys: readonly SigningKey[]): Promise<boolean> {
  const fits = (k: SigningKey) => verifiedClaims(r).every((v) => !k.via || k.via.includes(v));
  // every pinned key with the kid: two `iw keygen` runs on one day share the default kid
  for (const key of keys.filter((k) => r.sig && k.kid === r.sig.kid && fits(k)))
    try {
      const pub = await crypto.subtle.importKey('raw', unb64u(key.public_key), ED, false, ['verify']);
      if (await crypto.subtle.verify(ED, pub, unb64u(r.sig!.value), message(r))) return true;
    } catch {
      // a malformed key or record verifies nothing
    }
  return false;
}
