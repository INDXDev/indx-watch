import { LogObject, newUlid, StoreManifest, sha256Hex } from '@indx-watch/bundle';
import type { ObjectStore, ResultStore } from './ports.js';
import { StoreError } from './ports.js';
import { blobPath, checkRecord, parseJson } from './util.js';

const MANIFEST = 'indx-watch-store.json';
export const LOG_PREFIX = 'v1/log/';
const MAX_RECORDS = 1000;
const MAX_BYTES = 5 * 1024 * 1024;

/** 1 つのログオブジェクトに入る分（≤1000 件・≤5 MB）ずつに分ける。 */
function chunk(lines: string[]): string[][] {
  const enc = new TextEncoder();
  const out: string[][] = [];
  let cur: string[] = [];
  let size = 0;
  for (const l of lines) {
    const n = enc.encode(l).byteLength + 1;
    if (cur.length && (cur.length >= MAX_RECORDS || size + n > MAX_BYTES)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(l);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Store protocol on top of an ObjectStore (docs/spec/sync.md#store-layout). */
export function createResultStore(objects: ObjectStore): ResultStore {
  const blobKey = (sha: string) => `v1/${blobPath(sha)}`;
  return {
    objects,
    async init(projectId) {
      const want = JSON.stringify({ format: 'indx-watch-store', version: 1, project: projectId });
      let raw = await objects.get(MANIFEST);
      if (
        !raw &&
        !(await objects.put(MANIFEST, want, { ifNoneMatch: true, contentType: 'application/json' }))
      ) {
        raw = await objects.get(MANIFEST); // 同時に作られた
      }
      if (!raw) return;
      const m = StoreManifest.safeParse(parseJson(raw));
      if (!m.success)
        throw new StoreError('invalid', `${objects.url}/${MANIFEST} is not an INDX Watch store manifest`);
      if (m.data.project !== projectId) {
        throw new StoreError(
          'wrong-project',
          `${objects.url} belongs to project ${m.data.project}, not ${projectId}`,
        );
      }
    },
    async appendLog(writer, records, now) {
      const keys: string[] = [];
      const lines = records.map((r) => {
        const c = checkRecord(r);
        if ('error' in c) throw new StoreError('invalid', `record ${r.id}: ${c.error}`);
        return JSON.stringify(r);
      });
      for (const part of chunk(lines)) {
        const body = `{"v":1,"writer":${JSON.stringify(writer)},"records":[${part.join(',')}]}`;
        for (;;) {
          const key = `${LOG_PREFIX}${newUlid(now)}.json`;
          if (await objects.put(key, body, { ifNoneMatch: true, contentType: 'application/json' })) {
            keys.push(key);
            break;
          }
        }
      }
      return keys;
    },
    async listLog(o) {
      const startAfter =
        o.startAfter && !o.startAfter.startsWith(LOG_PREFIX) ? LOG_PREFIX + o.startAfter : o.startAfter;
      const r = await objects.list({ prefix: LOG_PREFIX, startAfter, limit: o.limit });
      return { keys: r.keys.map((k) => k.key).filter((k) => k.endsWith('.json')), truncated: r.truncated };
    },
    async readLog(key) {
      const raw = await objects.get(key);
      if (!raw) throw new StoreError('not-found', `${key} not found`);
      const body = LogObject.safeParse(parseJson(raw));
      if (!body.success) throw new StoreError('invalid', `${key} is not a valid log object`);
      const checked = body.data.records.map(checkRecord);
      const records = checked.flatMap((c) => ('record' in c ? [c.record] : []));
      return { key, writer: body.data.writer, records, invalid: checked.length - records.length };
    },
    async hasBlob(sha256) {
      return (await objects.head(blobKey(sha256))) !== null;
    },
    async putBlob(sha256, data, contentType) {
      if ((await sha256Hex(data)) !== sha256)
        throw new StoreError('invalid', `blob content does not match ${sha256}`);
      if (await objects.head(blobKey(sha256))) return;
      await objects.put(blobKey(sha256), data, {
        ifNoneMatch: true,
        contentType: contentType ?? 'application/octet-stream',
      });
    },
    async getBlob(sha256) {
      const data = await objects.get(blobKey(sha256));
      if (data && (await sha256Hex(data)) !== sha256)
        throw new StoreError('invalid', `blob ${sha256} is corrupt`);
      return data;
    },
  };
}
