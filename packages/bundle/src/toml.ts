/**
 * Canonical TOML (docs/spec/bundle-format.md#common-rules-for-every-toml-file, ADR 0004).
 * CONTRACT: signatures frozen; implementation T-101.
 * 構文解析は smol-toml、書き出しは自前（Zod スキーマのフィールド順で並べる）。
 */
import { parse, TomlDate } from 'smol-toml';
import type { z } from 'zod';
import { SCHEMA_BASE_URL } from './schema/common.js';
import { FILE_TYPES, type FileType } from './schema/definitions.js';
import { childSchema, isPlainObject, shapeOf } from './zwalk.js';

function normalize(v: unknown): unknown {
  if (v instanceof TomlDate) return v.toISOString().replace(/\.000Z$/, 'Z');
  if (Array.isArray(v)) return v.map(normalize);
  if (isPlainObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x)]));
  return v;
}

/** Parse TOML text. Dates/datetimes are normalized to strings ('2026-12-01', '2026-11-19T04:05:12Z'). The '#:schema' line is ignored. */
export function parseToml(text: string): Record<string, unknown> {
  return normalize(parse(text, { unsafeKeyBehaviour: 'throw' })) as Record<string, unknown>;
}

/** Canonical text for a file of the given type, including the '#:schema' header line and blank line. */
export function formatToml(type: FileType, data: Record<string, unknown>): string {
  return `#:schema ${schemaUrl(type)}\n\n${formatBody(FILE_TYPES[type], data, true)}`;
}

/** Canonical body without the '#:schema' line (templates, hashes). */
export function formatTomlBody(type: FileType, data: Record<string, unknown>): string {
  return formatBody(FILE_TYPES[type], data, true);
}

/** Canonical TOML body (no header) of an arbitrary value tree, for hashing; keys in the given order or sorted. */
export function canonicalBody(data: Record<string, unknown>): string {
  return formatBody(undefined, data, false);
}

/** URL of the JSON Schema for a file type. */
export function schemaUrl(type: FileType): string {
  return `${SCHEMA_BASE_URL}/${type}.json`;
}

// ---------- serializer ----------
type S = z.ZodType | undefined;
const MAX_LINE = 100;

/** Body with an explicit schema; free-form parts are sorted when sortFree is set. */
export function formatBody(schema: S, data: Record<string, unknown>, sortFree: boolean): string {
  const blocks: string[][] = [];
  emitTable([], schema, data, false, { blocks, sortFree });
  const text = blocks.flatMap((b) => (b.length ? [b.join('\n')] : [])).join('\n\n');
  return text ? `${text}\n` : '';
}

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (isPlainObject(v)) return Object.values(v).every(isEmpty);
  return false;
}

const isTableArray = (v: unknown): v is Record<string, unknown>[] =>
  Array.isArray(v) && v.length > 0 && v.every(isPlainObject);

function orderedKeys(schema: S, obj: Record<string, unknown>, sortFree: boolean): string[] {
  const keys = Object.keys(obj).filter((k) => !isEmpty(obj[k]));
  const sh = shapeOf(schema);
  if (sh.t === 'object') {
    const known = Object.keys(sh.shape).filter((k) => keys.includes(k));
    return [...known, ...keys.filter((k) => !(k in sh.shape)).sort()];
  }
  return sortFree ? keys.sort() : keys;
}

type Ctx = { blocks: string[][]; sortFree: boolean };

function emitTable(path: string[], schema: S, obj: Record<string, unknown>, arrayEl: boolean, c: Ctx): void {
  const { blocks, sortFree } = c;
  const keys = orderedKeys(schema, obj, sortFree);
  const lines: string[] = [];
  const nested: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (isPlainObject(v) || isTableArray(v)) nested.push(k);
    else {
      const prefix = `${fmtKey(k)} = `;
      lines.push(prefix + fmtValue(v, childSchema(schema, k), prefix.length, sortFree));
    }
  }
  const header = path.map(fmtKey).join('.');
  if (path.length === 0) blocks.push(lines);
  else if (arrayEl) blocks.push([`[[${header}]]`, ...lines]);
  else if (lines.length > 0) blocks.push([`[${header}]`, ...lines]);
  for (const k of nested) {
    const v = obj[k];
    const cs = childSchema(schema, k);
    if (!Array.isArray(v)) emitTable([...path, k], cs, v as Record<string, unknown>, false, c);
    else
      for (const el of v as Record<string, unknown>[])
        emitTable([...path, k], childSchema(cs, 0), el, true, c);
  }
}

const fmtKey = (k: string): string => (/^[A-Za-z0-9_-]+$/.test(k) ? k : basic(k));

function escapeChar(c: string): string {
  const map: Record<string, string> = { '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r' };
  return map[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}`;
}

// 制御文字はエスケープする（TOML の basic string に生で書けない）
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL_BUT_LF = /[\u0000-\u0009\u000b-\u001f\u007f]/g;

function basic(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(CONTROL, escapeChar)}"`;
}

function multiline(s: string): string {
  const body = s.replace(/\n*$/, '\n').replace(/\\/g, '\\\\').replace(CONTROL_BUT_LF, escapeChar);
  return `"""\n${body.replace(/"""/g, '""\\"')}"""`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function fmtNumber(n: number, kind: string): string {
  if (Number.isNaN(n)) return 'nan';
  if (!Number.isFinite(n)) return n > 0 ? 'inf' : '-inf';
  if (kind === 'int' || (kind !== 'float' && Number.isInteger(n))) return String(n);
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

function fmtScalar(v: unknown, schema: S, inline: boolean, sortFree: boolean): string {
  const kind = shapeOf(schema).t;
  if (typeof v === 'string') {
    if ((kind === 'date' && DATE_RE.test(v)) || (kind === 'datetime' && DATETIME_RE.test(v))) return v;
    return !inline && v.includes('\n') ? multiline(v) : basic(v);
  }
  if (typeof v === 'number') return fmtNumber(v, kind);
  if (typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (Array.isArray(v))
    return `[${v.map((x) => fmtScalar(x, childSchema(schema, 0), true, sortFree)).join(', ')}]`;
  if (isPlainObject(v)) {
    const keys = orderedKeys(schema, v, sortFree);
    const parts = keys.map(
      (k) => `${fmtKey(k)} = ${fmtScalar(v[k], childSchema(schema, k), true, sortFree)}`,
    );
    return parts.length ? `{ ${parts.join(', ')} }` : '{}';
  }
  throw new Error(`cannot write ${typeof v} as TOML`);
}

function fmtValue(v: unknown, schema: S, prefixLen: number, sortFree: boolean): string {
  if (!Array.isArray(v)) return fmtScalar(v, schema, false, sortFree);
  const items = v.map((x) => fmtScalar(x, childSchema(schema, 0), true, sortFree));
  const line = `[${items.join(', ')}]`;
  if (prefixLen + line.length <= MAX_LINE) return line;
  return `[\n${items.map((i) => `  ${i},`).join('\n')}\n]`;
}
