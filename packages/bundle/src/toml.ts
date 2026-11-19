/**
 * Canonical TOML (docs/spec/bundle-format.md#common-rules-for-every-toml-file, ADR 0004).
 * CONTRACT: signatures frozen; implementation T-101.
 */
import type { FileType } from './schema/definitions.js';

/** Parse TOML text. Dates/datetimes are normalized to strings ('2026-12-01', '2026-11-19T04:05:12Z'). The '#:schema' line is ignored. */
export function parseToml(text: string): Record<string, unknown> {
  void text;
  throw new Error('not implemented (T-101)');
}

/** Canonical text for a file of the given type, including the '#:schema' header line and blank line. */
export function formatToml(type: FileType, data: Record<string, unknown>): string {
  void type;
  void data;
  throw new Error('not implemented (T-101)');
}

/** Canonical TOML body (no header) of an arbitrary value tree, for hashing; keys in the given order or sorted. */
export function canonicalBody(data: Record<string, unknown>): string {
  void data;
  throw new Error('not implemented (T-101)');
}

/** URL of the JSON Schema for a file type. */
export function schemaUrl(type: FileType): string {
  void type;
  throw new Error('not implemented (T-101)');
}
