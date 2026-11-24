/**
 * Secrets kept by INDX Watch (docs/spec/security.md#secrets): AES-256-GCM via WebCrypto (Node >= 22 and Workers).
 * The additional data binds a sealed value to every other field of its `secret` record, so only the holder of
 * IW_SECRETS_KEY can write a record that counts, sharing included.
 */
import type { SecretRecord } from './schema/records.js';

const GCM = 'AES-GCM';
const [enc, dec] = [new TextEncoder(), new TextDecoder()];
const b64u = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const unb64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
/** IW_SECRETS_KEY format: iwsec1:<base64url of 32 random bytes> */
const KEY = /^iwsec1:([A-Za-z0-9_-]{43})$/;

/** A new IW_SECRETS_KEY (`iw keygen --secrets`). */
export const generateSecretsKey = () => `iwsec1:${b64u(crypto.getRandomValues(new Uint8Array(32)))}`;

/** The fields a sealed value is bound to. */
type Sealed = Pick<SecretRecord, 'project' | 'at' | 'action' | 'name' | 'title' | 'username' | 'notes'> & {
  shared_with?: string[] | undefined;
};
const aad = (r: Sealed) =>
  enc.encode(
    JSON.stringify([r.project, r.at, r.action, r.name, r.title, r.username, r.notes, r.shared_with ?? null]),
  );

/** A sealer for IW_SECRETS_KEY; throws on a malformed key. */
export function secretSealer(secret: string) {
  const m = KEY.exec(secret.trim());
  if (!m) throw new Error('IW_SECRETS_KEY is not a key from `iw keygen --secrets`');
  const key = crypto.subtle.importKey('raw', unb64u(m[1]!), GCM, false, ['encrypt', 'decrypt']);
  return {
    /** base64url(IV ‖ ciphertext) of `value`, bound to the record's other fields */
    async seal(r: Sealed, value: string): Promise<string> {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt(
        { name: GCM, iv, additionalData: aad(r) },
        await key,
        enc.encode(value),
      );
      return b64u(new Uint8Array([...iv, ...new Uint8Array(ct)]));
    },
    /** The value of a sealed record; null when it was sealed with another key or any field was changed. */
    async open(r: Sealed & { sealed?: string | undefined }): Promise<string | null> {
      try {
        const raw = unb64u(r.sealed ?? '');
        const params = { name: GCM, iv: raw.slice(0, 12), additionalData: aad(r) };
        return dec.decode(await crypto.subtle.decrypt(params, await key, raw.slice(12)));
      } catch {
        return null;
      }
    },
  };
}
export type SecretSealer = ReturnType<typeof secretSealer>;
