/**
 * Load a bundle through a BundleFs (docs/spec/bundle-format.md#layout).
 * CONTRACT: signatures frozen; implementation T-101.
 */
import type { Bundle, BundleFs, Problem } from './types.js';

export interface LoadResult {
  /** null when project.toml is missing or invalid */
  bundle: Bundle | null;
  problems: Problem[];
}

/** Parse and validate every file; never throws for content errors (they become problems). */
export async function loadBundle(fs: BundleFs): Promise<LoadResult> {
  void fs;
  throw new Error('not implemented (T-101)');
}
