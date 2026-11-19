/**
 * Creating and rewriting definition files. CONTRACT: signatures frozen; implementation T-101.
 */
import type { FileType } from './schema/definitions.js';
import type { Bundle, BundleFs } from './types.js';

/** Lowercase ASCII slug from a title, max 40 chars ('Valid coupon reduces the total' → 'valid-coupon-reduces-the-total'). */
export function slugify(title: string): string {
  void title;
  throw new Error('not implemented (T-101)');
}

export type NewKind = 'feature' | 'use-case' | 'criterion' | 'test-case' | 'fixture' | 'environment' | 'release' | 'plan';

export interface CreateInput {
  kind: NewKind;
  /** field values (validated); id/key are generated when absent */
  fields: Record<string, unknown>;
  /** parent key: feature for use cases, use case for criteria and test cases */
  parent?: string;
  template?: string;
  origin?: 'human' | 'ai' | 'import';
  ai?: { model: string; skill?: string };
  /** create as status 'ready' (humans only; rejected with origin 'ai'); default 'draft' */
  ready?: boolean;
  /** keys seen in results or elsewhere, so retired keys are not reused */
  knownKeys?: Iterable<string>;
  now?: Date;
}

export interface CreateResult {
  kind: NewKind;
  id: string;
  key: string;
  /** path relative to the bundle root */
  file: string;
}

/** Create a definition with a fresh ID and the next free key, write it canonically. Throws a BundleError on invalid input. */
export async function createDefinition(fs: BundleFs, bundle: Bundle, input: CreateInput): Promise<CreateResult> {
  void fs;
  void bundle;
  void input;
  throw new Error('not implemented (T-101)');
}

/**
 * `iw approve`: set status 'ready', approved_by = actor id (from the IdentityProvider, never a flag) and
 * approved_version = current version (tcv/fxv, or the use case's content hash). Returns the file written.
 */
export async function approveDefinition(fs: BundleFs, bundle: Bundle, ref: string, approver: string): Promise<{ file: string; version: string }> {
  void fs;
  void bundle;
  void ref;
  void approver;
  throw new Error('not implemented (T-101)');
}

/** Validate and write data canonically to path. */
export async function writeDefinition(fs: BundleFs, path: string, type: FileType, data: Record<string, unknown>): Promise<void> {
  void fs;
  void path;
  void type;
  void data;
  throw new Error('not implemented (T-101)');
}

/** Error with a code and problems, thrown by write operations. */
export class BundleError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: unknown[] = [],
  ) {
    super(message);
  }
}
