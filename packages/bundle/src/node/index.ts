/**
 * Node-only helpers (allowed to import node:fs). CONTRACT: signatures frozen; implementation T-101.
 */
import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { BundleFs } from '../types.js';

/** null for a missing file or directory, rethrows anything else. */
const orNull = (e: unknown) => {
  if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes((e as NodeJS.ErrnoException).code ?? '')) return null;
  throw e;
};

/** BundleFs over a directory on disk. */
export function nodeFs(root: string): BundleFs {
  const abs = (p: string) => join(root, ...p.split('/').filter(Boolean));
  return {
    read: (p) => readFile(abs(p)).then((b) => new Uint8Array(b), orNull),
    async write(p, data) {
      await mkdir(dirname(abs(p)), { recursive: true });
      await writeFile(abs(p), data);
    },
    async list(dir) {
      const entries = (await readdir(abs(dir), { withFileTypes: true }).catch(orNull)) ?? [];
      return entries
        .map((e) => ({ name: e.name, dir: e.isDirectory() }))
        .sort((a, b) => (a.name < b.name ? -1 : 1));
    },
    remove: (p) => rm(abs(p), { recursive: true, force: true }),
  };
}

const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();

/** Walk up from cwd to find '.indx-watch/' (or honor IW_DIR); null when not found. */
export function findBundleDir(
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (env.IW_DIR) {
    const dir = resolve(cwd, env.IW_DIR);
    const inner = join(dir, '.indx-watch');
    return isDir(inner) && !existsSync(join(dir, 'project.toml')) ? inner : isDir(dir) ? dir : null;
  }
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (isDir(join(dir, '.indx-watch'))) return join(dir, '.indx-watch');
    if (dirname(dir) === dir) return null;
  }
}
