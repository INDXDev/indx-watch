/**
 * Record (de)serialization (docs/spec/sync.md#records). CONTRACT; implementation T-101.
 * Canonical record JSON = JSON.stringify of the Zod-parsed record (keys in schema order, defaults materialized), no whitespace.
 * Writers store exactly these bytes; readers keep the bytes they received.
 */
import type { AnyRecord } from './schema/records.js';

/** Validate (strict) and return the canonical JSON text of a record about to be written. Throws on invalid input. */
export function encodeRecord(record: unknown): string {
  void record;
  throw new Error('not implemented (T-101)');
}

/** Read a record leniently: unknown extra fields from newer tools are tolerated (kept in the raw text), known fields validated. Null when invalid. */
export function decodeRecord(value: unknown): AnyRecord | null {
  void value;
  throw new Error('not implemented (T-101)');
}
