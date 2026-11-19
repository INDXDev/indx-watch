/**
 * Record (de)serialization (docs/spec/sync.md#records). CONTRACT; implementation T-101.
 * Canonical record JSON = JSON.stringify of the Zod-parsed record (keys in schema order, defaults materialized), no whitespace.
 * Writers store exactly these bytes; readers keep the bytes they received.
 */
import type { z } from 'zod';
import { AnyRecord } from './schema/records.js';
import { isPlainObject, prune } from './zwalk.js';

const BY_KIND = new Map<string, z.ZodType>(AnyRecord.options.map((o) => [o.shape.kind.value, o]));

/** Validate (strict) and return the canonical JSON text of a record about to be written. Throws on invalid input. */
export function encodeRecord(record: unknown): string {
  return JSON.stringify(AnyRecord.parse(record));
}

/** Read a record leniently: unknown extra fields from newer tools are tolerated (kept in the raw text), known fields validated. Null when invalid. */
export function decodeRecord(value: unknown): AnyRecord | null {
  let v = value;
  if (typeof v === 'string' || v instanceof Uint8Array) {
    try {
      v = JSON.parse(typeof v === 'string' ? v : new TextDecoder().decode(v));
    } catch {
      return null;
    }
  }
  if (!isPlainObject(v)) return null;
  const schema = BY_KIND.get(String(v.kind));
  if (!schema) return null;
  const res = schema.safeParse(prune(schema, v));
  return res.success ? (res.data as AnyRecord) : null;
}
