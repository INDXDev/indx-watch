/**
 * Signed records (docs/spec/security.md#signed-records): Ed25519 via WebCrypto (Node >= 22 and Workers).
 * Signed bytes = "indx-watch/record/v1\n" + canonical record JSON without `sig`.
 */
import { type RecordSig, type SigningKey, VERIFIED_VIA, type Via } from './schema/common.js';
import { AnyRecord } from './schema/records.js';

const ED = { name: 'Ed25519' } as const;
const enc = new TextEncoder();
const b64u = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const unb64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const message = (r: AnyRecord) =>
  enc.encode(`indx-watch/record/v1\n${JSON.stringify(AnyRecord.parse({ ...r, sig: undefined }))}`);
/** IW_SIGNING_KEY format: iwsk1:<kid>:<base64url PKCS#8> */
const SECRET = /^iwsk1:([A-Za-z0-9._-]{1,64}):([A-Za-z0-9_-]+)$/;

/** A new key pair: `secret` goes into IW_SIGNING_KEY (never into files), `key` into project.toml [[signing_keys]]. */
export async function generateSigningKey(kid: string): Promise<{ secret: string; key: SigningKey }> {
  const k = (await crypto.subtle.generateKey(ED, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pkcs8 = b64u(await crypto.subtle.exportKey('pkcs8', k.privateKey));
  return {
    secret: `iwsk1:${kid}:${pkcs8}`,
    key: { kid, public_key: b64u(await crypto.subtle.exportKey('raw', k.publicKey)) },
  };
}

/** A signer for IW_SIGNING_KEY; without a secret it returns records unchanged. Throws on a malformed secret. */
export function recordSigner(secret: string | undefined): <R extends AnyRecord>(record: R) => Promise<R> {
  if (!secret) return async (r) => r;
  const m = SECRET.exec(secret.trim());
  if (!m) throw new Error('IW_SIGNING_KEY is not a signing key from `iw keygen`');
  let key: Promise<CryptoKey> | undefined;
  return async (r) => {
    key ??= crypto.subtle.importKey('pkcs8', unb64u(m[2]!), ED, false, ['sign']);
    const sig: RecordSig = {
      alg: 'Ed25519',
      kid: m[1]!,
      value: b64u(await crypto.subtle.sign(ED, await key, message(r))),
    };
    return AnyRecord.parse({ ...r, sig }) as typeof r;
  };
}

/** Verified `via` values a record claims: its actor and the `by` of every judgement in it. */
export function verifiedClaims(r: AnyRecord): Via[] {
  const by =
    r.kind === 'run' ? r.judgements.map((j) => j.by) : r.kind === 'judgement' ? [r.judgement.by] : [];
  return [r.actor, ...by].flatMap((a) => (a && VERIFIED_VIA.includes(a.via) ? [a.via] : []));
}

/** True when the record carries a valid signature by one of `keys` that may vouch for every verified `via` it claims. */
export async function verifyRecord(r: AnyRecord, keys: readonly SigningKey[]): Promise<boolean> {
  const key = r.sig && keys.find((k) => k.kid === r.sig!.kid);
  if (!r.sig || !key || verifiedClaims(r).some((v) => key.via && !key.via.includes(v))) return false;
  try {
    const pub = await crypto.subtle.importKey('raw', unb64u(key.public_key), ED, false, ['verify']);
    return await crypto.subtle.verify(ED, pub, unb64u(r.sig.value), message(r));
  } catch {
    return false; // malformed key or record
  }
}
