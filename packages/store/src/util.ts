/** 小さな共通ヘルパー（ランタイム非依存）。 */
import { AnyRecord } from '@indx-watch/bundle';
import { StoreError } from './ports.js';

const enc = new TextEncoder();

/** undefined と空文字の値を落とす（任意フィールドを出力に含めない）。 */
export const compact = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;
export const toBytes = (body: Uint8Array | string): Uint8Array =>
  typeof body === 'string' ? enc.encode(body) : body;

/** キーの形を制限する（パストラバーサル防止）。英数字と . _ - / のみ、空・'..' セグメント禁止。 */
export function checkKey(key: string): string {
  if (!/^[A-Za-z0-9._\-/]+$/.test(key) || key.split('/').some((s) => s === '' || s === '.' || s === '..')) {
    throw new StoreError('invalid', `invalid object key: ${JSON.stringify(key)}`);
  }
  return key;
}

/** JSON として読む。壊れていれば undefined（呼び出し側のスキーマ検証で弾く）。 */
export function parseJson(raw: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return undefined;
  }
}

const SHA = /^[0-9a-f]{64}$/;
export function checkSha(sha256: string): string {
  if (!SHA.test(sha256)) throw new StoreError('invalid', `invalid sha256: ${sha256}`);
  return sha256;
}

/** blobs/sha256/<aa>/<hash>（ストアでは 'v1/' の下、レプリカでは runs/ の下）。 */
export const blobPath = (sha256: string) => `blobs/sha256/${checkSha(sha256).slice(0, 2)}/${sha256}`;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** ULID の先頭 10 文字（ミリ秒時刻）を読む。 */
export function ulidTime(ulid: string): number {
  let t = 0;
  for (const c of ulid.slice(0, 10)) {
    const v = CROCKFORD.indexOf(c);
    if (v < 0) return Number.NaN;
    t = t * 32 + v;
  }
  return t;
}

/** ID（'run_01J…'）や ULID 文字列から時刻を取り出す。 */
export const idTime = (id: string) => ulidTime(id.slice(id.indexOf('_') + 1));

/**
 * 記録を検証する。厳密スキーマに通ればそのまま（既定値込み）返す。
 * 新しいツールが足した未知のフィールドだけが原因で落ちた場合は、それを除いて再検証し、受け取った値を返す（バイトを保つ）。
 */
export function checkRecord(raw: unknown): { record: AnyRecord } | { error: string } {
  const r = AnyRecord.safeParse(raw);
  if (r.success) return { record: r.data };
  if (r.error.issues.every((i) => i.code === 'unrecognized_keys')) {
    const copy = structuredClone(raw) as Record<string, unknown>;
    for (const issue of r.error.issues) {
      let node: unknown = copy;
      for (const p of issue.path) node = (node as Record<PropertyKey, unknown>)?.[p];
      if (node && typeof node === 'object' && 'keys' in issue)
        for (const k of issue.keys) delete (node as Record<string, unknown>)[k];
    }
    if (AnyRecord.safeParse(copy).success) return { record: raw as AnyRecord };
  }
  return { error: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') };
}

/** 記録が参照する blob のハッシュ（証拠・ステップの証拠・バンドルのスナップショット）。 */
export function blobRefs(record: AnyRecord): string[] {
  const out = new Set<string>();
  if (record.kind === 'run') {
    for (const e of record.evidence ?? []) out.add(e.sha256);
    for (const s of record.steps ?? []) for (const h of s.evidence ?? []) out.add(h);
  } else if (record.kind === 'bundle') out.add(record.sha256);
  else if (record.kind === 'file' && record.sha256) out.add(record.sha256);
  return [...out];
}

/** fetch 失敗やステータスを StoreError に変換する。 */
export function httpError(status: number, what: string): StoreError {
  if (status === 401 || status === 403 || (status >= 300 && status < 400)) {
    return new StoreError('unauthorized', `${what}: HTTP ${status} (check credentials or Access login)`);
  }
  if (status === 404) return new StoreError('not-found', `${what}: not found`);
  if (status === 409 || status === 412) return new StoreError('conflict', `${what}: HTTP ${status}`);
  return new StoreError(status >= 500 ? 'network' : 'invalid', `${what}: HTTP ${status}`);
}

export async function guardedFetch(what: string, f: () => Promise<Response>): Promise<Response> {
  try {
    return await f();
  } catch (e) {
    throw new StoreError('network', `${what}: ${(e as Error).message}`, e);
  }
}

/** 辞書順リストの共通処理（memory / fs / r2 の後段）。 */
export function pageKeys<T extends { key: string }>(
  sorted: T[],
  opts: { prefix: string; startAfter?: string; limit?: number },
): { keys: T[]; truncated: boolean } {
  const limit = opts.limit ?? 1000;
  const all = sorted.filter(
    (o) => o.key.startsWith(opts.prefix) && (!opts.startAfter || o.key > opts.startAfter),
  );
  return { keys: all.slice(0, limit), truncated: all.length > limit };
}

export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const byKey = (a: { key: string }, b: { key: string }) => cmp(a.key, b.key);
