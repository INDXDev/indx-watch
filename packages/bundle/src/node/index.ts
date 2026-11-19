/**
 * Node-only helpers (allowed to import node:fs). CONTRACT: signatures frozen; implementation T-101.
 */
import type { BundleFs } from '../types.js';

/** BundleFs over a directory on disk. */
export function nodeFs(root: string): BundleFs {
  void root;
  throw new Error('not implemented (T-101)');
}

/** Walk up from cwd to find '.indx-watch/' (or honor IW_DIR); null when not found. */
export function findBundleDir(cwd: string, env?: Record<string, string | undefined>): string | null {
  void cwd;
  void env;
  throw new Error('not implemented (T-101)');
}
