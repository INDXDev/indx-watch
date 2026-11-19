/**
 * Bundle checks (docs/spec/cli.md#iw-check). CONTRACT: signatures frozen; implementation T-102.
 */
import type { BundleFs, Problem } from './types.js';

export interface CheckOptions {
  /** canonicalize, regenerate slugs, renumber duplicate keys */
  fix?: boolean;
  /** keys known from the result store (retired keys must not be reused) */
  knownKeys?: Iterable<string>;
}

export interface CheckResult {
  files: number;
  errors: number;
  warnings: number;
  problems: Problem[];
  /** files rewritten by fix */
  changed: string[];
  renumbered: { from: string; to: string; id: string }[];
}

export async function checkBundle(fs: BundleFs, opts?: CheckOptions): Promise<CheckResult> {
  void fs;
  void opts;
  throw new Error('not implemented (T-102)');
}

/** Secret scan of one file's text (docs/spec/security.md#secrets). */
export function scanSecrets(file: string, text: string): Problem[] {
  void file;
  void text;
  throw new Error('not implemented (T-102)');
}
