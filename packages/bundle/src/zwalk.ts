/**
 * Zod スキーマの内部を読む小さなヘルパー。正規化 TOML の書き出し・レコードの寛容な読み込み・
 * 未知キーの候補提示がフィールド順や型をスキーマから取り出すのに使う。
 */
import type { z } from 'zod';

type Def = { type: string; [k: string]: unknown };
type Any = z.ZodType | undefined;
const def = (s: z.ZodType): Def => (s as unknown as { _zod: { def: Def } })._zod.def;

const WRAPPERS = new Set(['optional', 'default', 'nullable', 'readonly', 'prefault', 'nonoptional', 'catch']);

/** optional / default / nullable / readonly などの包みを外す */
export function unwrap(s: Any): Any {
  let cur = s;
  while (cur && WRAPPERS.has(def(cur).type)) cur = def(cur).innerType as z.ZodType;
  return cur;
}

export type Shape =
  | { t: 'object'; shape: Record<string, z.ZodType> }
  | { t: 'record'; value: z.ZodType }
  | { t: 'array'; el: z.ZodType }
  | { t: 'int' | 'float' | 'date' | 'datetime' | 'other' };

export function shapeOf(s: Any): Shape {
  const u = unwrap(s);
  if (!u) return { t: 'other' };
  const d = def(u);
  if (d.type === 'object') return { t: 'object', shape: d.shape as Record<string, z.ZodType> };
  if (d.type === 'record') return { t: 'record', value: d.valueType as z.ZodType };
  if (d.type === 'array') return { t: 'array', el: d.element as z.ZodType };
  if (d.type === 'number') return { t: (u as unknown as { isInt?: boolean }).isInt ? 'int' : 'float' };
  const toml = (u.meta?.() as { toml?: string } | undefined)?.toml;
  if (toml === 'date' || toml === 'datetime') return { t: toml };
  return { t: 'other' };
}

/** Schema of a child field / element, or undefined for free-form values. */
export function childSchema(s: Any, key: string | number): Any {
  const sh = shapeOf(s);
  if (sh.t === 'object') return typeof key === 'string' ? sh.shape[key] : undefined;
  if (sh.t === 'record') return sh.value;
  if (sh.t === 'array') return sh.el;
  return undefined;
}

export function schemaAt(s: Any, path: readonly PropertyKey[]): Any {
  let cur = s;
  for (const p of path) cur = childSchema(cur, typeof p === 'number' ? p : String(p));
  return cur;
}

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 'steps[0].expected' */
export function dotted(path: readonly PropertyKey[]): string {
  let out = '';
  for (const p of path) out += typeof p === 'number' ? `[${p}]` : `${out ? '.' : ''}${String(p)}`;
  return out;
}

/** Drop keys the schema does not know (at every level), keeping free-form records as they are. */
export function prune(s: Any, v: unknown): unknown {
  const sh = shapeOf(s);
  if (Array.isArray(v)) return sh.t === 'array' ? v.map((x) => prune(sh.el, x)) : v;
  if (!isPlainObject(v)) return v;
  if (sh.t === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) if (k in sh.shape) out[k] = prune(sh.shape[k], v[k]);
    return out;
  }
  if (sh.t === 'record')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, prune(sh.value, x)]));
  return v;
}
