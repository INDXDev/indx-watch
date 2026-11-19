/** ファイルシステム上の ObjectStore（file:// ストアとローカルレプリカ）。 */
import { randomBytes } from 'node:crypto';
import { link, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ObjectInfo, ObjectStore } from '../ports.js';
import { StoreError } from '../ports.js';
import { byKey, checkKey, pageKeys, toBytes } from '../util.js';

const code = (e: unknown) => (e as NodeJS.ErrnoException).code;

function fsError(e: unknown, what: string): StoreError {
  const kind = code(e) === 'EACCES' || code(e) === 'EPERM' ? 'unauthorized' : 'network';
  return new StoreError(kind, `${what}: ${(e as Error).message}`, e);
}

/**
 * 同じディレクトリのドットファイルに書いてから link する。link は既存ならば EEXIST で失敗するので、
 * 中身がそろったファイルだけが現れ、上書きもしない。ifNoneMatch でなければ rename で置き換える。
 */
async function writeAtomic(path: string, data: Uint8Array, createOnly: boolean): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.tmp-${randomBytes(6).toString('hex')}`);
  await writeFile(tmp, data);
  if (!createOnly) {
    await rename(tmp, path);
    return true;
  }
  try {
    await link(tmp, path);
    return true;
  } catch (e) {
    if (code(e) === 'EEXIST') return false;
    throw e;
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

/** dir 以下のファイルを再帰的に集める（ドットで始まる名前は無視）。 */
async function walk(root: string, rel: string, out: ObjectInfo[]): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(join(root, rel), { withFileTypes: true });
  } catch (e) {
    if (code(e) === 'ENOENT' || code(e) === 'ENOTDIR') return;
    throw e;
  }
  for (const d of entries) {
    if (d.name.startsWith('.')) continue;
    const key = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) await walk(root, key, out);
    else if (d.isFile()) out.push({ key, size: (await stat(join(root, key))).size });
  }
}

export function fsObjectStore(root: string, url = `file://${root}`): ObjectStore {
  const path = (key: string) => join(root, checkKey(key));
  return {
    url,
    async get(key) {
      try {
        return new Uint8Array(await readFile(path(key)));
      } catch (e) {
        if (code(e) === 'ENOENT' || code(e) === 'EISDIR') return null;
        throw fsError(e, `read ${key}`);
      }
    },
    async head(key) {
      try {
        const s = await stat(path(key));
        return s.isFile() ? { key, size: s.size } : null;
      } catch (e) {
        if (code(e) === 'ENOENT') return null;
        throw fsError(e, `stat ${key}`);
      }
    },
    async put(key, body, opts) {
      try {
        return await writeAtomic(path(key), toBytes(body), !!opts?.ifNoneMatch);
      } catch (e) {
        throw e instanceof StoreError ? e : fsError(e, `write ${key}`);
      }
    },
    async list(opts) {
      // prefix の最後の '/' までのディレクトリだけを歩く
      const dir = opts.prefix.includes('/') ? opts.prefix.slice(0, opts.prefix.lastIndexOf('/')) : '';
      if (dir) checkKey(dir);
      const all: ObjectInfo[] = [];
      try {
        await walk(root, dir, all);
      } catch (e) {
        throw fsError(e, `list ${opts.prefix}`);
      }
      return pageKeys(all.sort(byKey), opts);
    },
    async delete(key) {
      await rm(path(key), { force: true });
    },
  };
}
