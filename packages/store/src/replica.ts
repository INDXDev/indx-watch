import { sha256Hex } from '@indx-watch/bundle';
import type { LocalReplica, ObjectStore } from './ports.js';
import { StoreError } from './ports.js';
import { blobPath, checkRecord, idTime, parseJson } from './util.js';

/**
 * Local replica (docs/spec/sync.md#local-replica-layout) on top of any ObjectStore.
 * The month in records/<YYYY-MM>/<id>.json comes from the ULID time of the ID, so the path depends only on the ID.
 * external: a hook that reports writes by other processes (a file watcher on Node).
 */
export function createReplica(
  objects: ObjectStore,
  external?: (notify: () => void) => () => void,
): LocalReplica {
  const listeners = new Set<() => void>();
  let stopExternal: (() => void) | undefined;
  const notify = () => {
    for (const l of [...listeners]) l();
  };
  const recordKey = (id: string) => {
    const t = idTime(id);
    if (!/^[a-z]{2,3}_[0-9A-HJKMNP-TV-Z]{26}$/.test(id) || Number.isNaN(t))
      throw new StoreError('invalid', `invalid record id ${id}`);
    return `records/${new Date(t).toISOString().slice(0, 7)}/${id}.json`;
  };

  return {
    async putRecord(record) {
      const c = checkRecord(record);
      if ('error' in c) throw new StoreError('invalid', `record ${record.id}: ${c.error}`);
      const created = await objects.put(recordKey(record.id), JSON.stringify(record), { ifNoneMatch: true });
      if (created) notify();
      return created;
    },
    async getRecord(id) {
      const raw = await objects.get(recordKey(id));
      if (!raw) return null;
      const c = checkRecord(parseJson(raw));
      return 'record' in c ? c.record : null;
    },
    async records(onInvalid) {
      const out = [];
      let startAfter: string | undefined;
      for (;;) {
        const page = await objects.list({ prefix: 'records/', startAfter });
        for (const { key } of page.keys) {
          if (!key.endsWith('.json')) continue;
          const raw = await objects.get(key);
          if (!raw) continue;
          const c = checkRecord(parseJson(raw));
          if ('record' in c) out.push(c.record);
          else onInvalid?.(key, c.error);
        }
        if (!page.truncated || !page.keys.length) return out;
        startAfter = page.keys.at(-1)!.key;
      }
    },
    async putBlob(data, contentType) {
      const sha = await sha256Hex(data);
      if (await objects.put(blobPath(sha), data, { ifNoneMatch: true, contentType })) notify();
      return sha;
    },
    async getBlob(sha256) {
      const data = await objects.get(blobPath(sha256));
      if (data && (await sha256Hex(data)) !== sha256)
        throw new StoreError('invalid', `local blob ${sha256} is corrupt`);
      return data;
    },
    async hasBlob(sha256) {
      return (await objects.head(blobPath(sha256))) !== null;
    },
    onChange(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && external) stopExternal = external(notify);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          stopExternal?.();
          stopExternal = undefined;
        }
      };
    },
  };
}
