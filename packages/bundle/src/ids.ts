import { monotonicFactory } from 'ulidx';
import { type IdPrefix, KEY_PATTERNS } from './schema/common.js';

const ulid = monotonicFactory();

/** New machine ID, e.g. 'tc_01JF3Q8M5X2V7K9D4R6T1W0Y3Z'. */
export function newId(prefix: IdPrefix, now?: number): string {
  return `${prefix}_${ulid(now)}`;
}

/** ULID for a store log key, generated at upload time (docs/spec/sync.md). */
export function newUlid(now?: number): string {
  return ulid(now);
}

export type KeyKind = 'feature' | 'useCase' | 'testCase' | 'fixture' | 'plan';
const KEY_PREFIX: Record<KeyKind, string> = {
  feature: 'FEAT',
  useCase: 'UC',
  testCase: 'TC',
  fixture: 'FX',
  plan: 'PLAN',
};

/** Next free key given every key ever seen (bundle + known retired keys). */
export function nextKey(kind: KeyKind, seen: Iterable<string>): string {
  const prefix = KEY_PREFIX[kind];
  let max = 0;
  for (const k of seen) {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(k);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${max + 1}`;
}

/** Next AC key inside a use case: AC-{uc}.{n}. */
export function nextCriterionKey(useCaseKey: string, seen: Iterable<string>): string {
  const uc = useCaseKey.replace(/^UC-/, '');
  let max = 0;
  for (const k of seen) {
    const m = /^AC-(\d+)\.(\d+)$/.exec(k);
    if (m && m[1] === uc) max = Math.max(max, Number(m[2]));
  }
  return `AC-${uc}.${max + 1}`;
}

export type ParsedRef =
  | { type: 'id'; id: string; prefix: string }
  | { type: 'key'; key: string; project?: string };

/** Parse 'TC-3', 'SHOP:TC-3', 'tc_01J…' (docs/spec/cli.md#conventions). */
export function parseRef(ref: string): ParsedRef | null {
  const id = /^([a-z]{2,3})_([0-9A-HJKMNP-TV-Z]{26})$/.exec(ref);
  if (id) return { type: 'id', id: ref, prefix: id[1]! };
  const m = /^(?:([A-Z][A-Z0-9]{1,9}):)?((?:FEAT|UC|TC|FX|PLAN)-\d+|AC-\d+\.\d+)$/.exec(ref);
  if (m) return { type: 'key', key: m[2]!, ...(m[1] ? { project: m[1] } : {}) };
  return null;
}

export { KEY_PATTERNS };
