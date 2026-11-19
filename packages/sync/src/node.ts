/** Node: sync state in <bundleDir>/cache/sync/<store-hash>.json (safe to delete). */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Hex } from '@indx-watch/bundle';
import { emptyState, type StateStore, type SyncState } from './index.js';

/** Keyed by the store URL without trailing slashes, as adapters report it (`ResultStore.objects.url`). */
export async function fileStateStore(
  bundleDir: string,
  storeUrl: string,
): Promise<StateStore & { path: string }> {
  const hash = await sha256Hex(storeUrl.replace(/\/+$/, ''));
  const path = join(bundleDir, 'cache', 'sync', `${hash.slice(0, 16)}.json`);
  return {
    path,
    async load() {
      try {
        return { ...emptyState(), ...(JSON.parse(await readFile(path, 'utf8')) as Partial<SyncState>) };
      } catch {
        return emptyState();
      }
    },
    async save(state) {
      await mkdir(join(bundleDir, 'cache', 'sync'), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(state)}\n`);
      await rename(tmp, path);
    },
  };
}

/** Writer ID of this clone (<bundleDir>/cache/writer-id, created when missing); goes into each log object's "writer". */
export async function writerId(bundleDir: string): Promise<string> {
  const path = join(bundleDir, 'cache', 'writer-id');
  const existing = (await readFile(path, 'utf8').catch(() => '')).trim();
  if (/^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
  const id = `w_${randomBytes(12).toString('hex')}`;
  await mkdir(join(bundleDir, 'cache'), { recursive: true });
  await writeFile(path, `${id}\n`);
  return id;
}
