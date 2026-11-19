/**
 * Node-only helpers (allowed to import node:fs). CONTRACT: signatures frozen; implementation T-101.
 */
import { existsSync, statSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { BundleFs } from '../types.js';

/** null for a missing file or directory, rethrows anything else. */
const orNull = (e: unknown) => {
  if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes((e as NodeJS.ErrnoException).code ?? '')) return null;
  throw e;
};

/**
 * BundleFs over a directory on disk. Paths may not leave the root, symbolic links are not listed, and a
 * read or write whose real path is outside the root is refused (a cloned bundle cannot point at ~/.netrc).
 */
export function nodeFs(root: string): BundleFs {
  const base = resolve(root);
  const abs = (p: string) => {
    const a = resolve(base, ...p.split('/').filter(Boolean));
    if (a !== base && !a.startsWith(base + sep)) throw new Error(`Path ${p} is outside the bundle`);
    return a;
  };
  /** throws unless the real path of a (which must exist) is inside the real root */
  const inside = async (a: string) => {
    const [r, x] = await Promise.all([realpath(base), realpath(a)]);
    if (x !== r && !x.startsWith(r + sep)) throw new Error(`${a} leads outside the bundle (symbolic link)`);
  };
  return {
    async read(p) {
      const a = abs(p);
      return inside(a)
        .then(() => readFile(a))
        .then((b) => new Uint8Array(b), orNull);
    },
    async write(p, data) {
      const a = abs(p);
      await mkdir(dirname(a), { recursive: true });
      await inside(dirname(a));
      if ((await lstat(a).catch(orNull))?.isSymbolicLink()) throw new Error(`${p} is a symbolic link`);
      await writeFile(a, data);
    },
    async list(dir) {
      const entries = (await readdir(abs(dir), { withFileTypes: true }).catch(orNull)) ?? [];
      return entries
        .filter((e) => !e.isSymbolicLink())
        .map((e) => ({ name: e.name, dir: e.isDirectory() }))
        .sort((a, b) => (a.name < b.name ? -1 : 1));
    },
    remove: async (p) => rm(abs(p), { recursive: true, force: true }),
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
