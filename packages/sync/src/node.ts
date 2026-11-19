/** Node 用: 同期の状態を <bundleDir>/cache/sync/<store-hash>.json に置く（消しても安全）。 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Hex } from '@indx-watch/bundle';
import { emptyState, type StateStore, type SyncState } from './index.js';

export async function fileStateStore(
  bundleDir: string,
  storeUrl: string,
): Promise<StateStore & { path: string }> {
  const path = join(bundleDir, 'cache', 'sync', `${(await sha256Hex(storeUrl)).slice(0, 16)}.json`);
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

/** この複製の書き手 ID（<bundleDir>/cache/writer-id。なければ作る）。ログオブジェクトの "writer" に入る。 */
export async function writerId(bundleDir: string): Promise<string> {
  const path = join(bundleDir, 'cache', 'writer-id');
  const existing = (await readFile(path, 'utf8').catch(() => '')).trim();
  if (/^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
  const id = `w_${randomBytes(12).toString('hex')}`;
  await mkdir(join(bundleDir, 'cache'), { recursive: true });
  await writeFile(path, `${id}\n`);
  return id;
}
