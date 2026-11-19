import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BundleFs } from '../src/types.js';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const SHOP = join(REPO, 'examples/shop/.indx-watch');

/** Every file of examples/shop/.indx-watch as a path → bytes map. */
export function shopFiles(): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(SHOP, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(SHOP);
  return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** In-memory BundleFs for tests. */
export function memFs(files: Map<string, Uint8Array> = shopFiles()): BundleFs & {
  files: Map<string, Uint8Array>;
  text(path: string): string | undefined;
} {
  return {
    files,
    text: (p) => {
      const b = files.get(p);
      return b ? dec.decode(b) : undefined;
    },
    async read(p) {
      return files.get(p) ?? null;
    },
    async write(p, data) {
      files.set(p, typeof data === 'string' ? enc.encode(data) : data);
    },
    async list(dir) {
      const prefix = dir ? `${dir.replace(/\/$/, '')}/` : '';
      const seen = new Map<string, boolean>();
      for (const k of files.keys()) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length).split('/');
        const name = rest[0]!;
        seen.set(name, (seen.get(name) ?? false) || rest.length > 1);
      }
      return [...seen].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, isDir]) => ({ name, dir: isDir }));
    },
    async remove(p) {
      files.delete(p);
      for (const k of [...files.keys()]) if (k.startsWith(`${p}/`)) files.delete(k);
    },
  };
}
