import type { AnyRecord } from '@indx-watch/bundle';
import { LogObject, LogSnapshot, newUlid, StoreManifest, sha256Hex } from '@indx-watch/bundle';
import type { ObjectStore, ResultStore } from './ports.js';
import { StoreError } from './ports.js';
import { blobPath, checkRecord, parseJson, ulidTime } from './util.js';

const MANIFEST = 'indx-watch-store.json';
export const LOG_PREFIX = 'v1/log/';
export const SNAPSHOT_PREFIX = 'v1/snapshots/';
const MAX_RECORDS = 1000;
const MAX_BYTES = 5 * 1024 * 1024;

/** Split into parts that fit one log object (≤ 1000 records, ≤ 5 MB). */
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

/** Create or verify the store manifest for this project. */
async function initStore(objects: ObjectStore, projectId: string) {
  const want = JSON.stringify({ format: 'indx-watch-store', version: 1, project: projectId });
  let raw = await objects.get(MANIFEST);
  if (!raw && !(await objects.put(MANIFEST, want, { ifNoneMatch: true, contentType: 'application/json' }))) {
    raw = await objects.get(MANIFEST); // created concurrently by another writer
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
}

/** Write `body` under a new ULID key below `prefix`, retrying on a key collision. */
async function putNew(objects: ObjectStore, prefix: string, body: string, now?: number) {
  for (;;) {
    const key = `${prefix}${newUlid(now)}.json`;
    if (await objects.put(key, body, { ifNoneMatch: true, contentType: 'application/json' })) return key;
  }
}

/** Upload records as log objects of at most 1000 records / 5 MB each. */
async function appendLog(objects: ObjectStore, writer: string, records: AnyRecord[], now?: number) {
  const lines = records.map((r) => {
    const c = checkRecord(r);
    if ('error' in c) throw new StoreError('invalid', `record ${r.id}: ${c.error}`);
    return JSON.stringify(r);
  });
  const keys: string[] = [];
  for (const part of chunk(lines)) {
    const body = `{"v":1,"writer":${JSON.stringify(writer)},"records":[${part.join(',')}]}`;
    keys.push(await putNew(objects, LOG_PREFIX, body, now));
  }
  return keys;
}

/** The key of the newest log snapshot not after `now`. */
async function newestSnapshotKey(objects: ObjectStore, now: number) {
  let [key, after]: (string | undefined)[] = [];
  for (;;) {
    const page = await objects.list({ prefix: SNAPSHOT_PREFIX, startAfter: after });
    for (const k of page.keys.map((o) => o.key))
      if (k.endsWith('.json') && ulidTime(k.slice(SNAPSHOT_PREFIX.length)) <= now) key = k;
    if (!page.truncated || !page.keys.length) return key;
    after = page.keys.at(-1)!.key;
  }
}

/** The newest log snapshot not after `now`, validated, or null. */
async function readLogSnapshot(objects: ObjectStore, project: string, now = Date.now()) {
  const key = await newestSnapshotKey(objects, now);
  const raw = key ? await objects.get(key) : null;
  if (!key || !raw) return null;
  const bad = (why: string) => new StoreError('invalid', `log snapshot ${key} ${why}`);
  const s = LogSnapshot.safeParse(parseJson(raw));
  if (!s.success) throw bad('is not valid (or was written by a newer INDX Watch)');
  if (s.data.project !== project) throw bad(`belongs to project ${s.data.project}`);
  const logs = s.data.logs.map((l, i, all) => {
    if ((i > 0 && all[i - 1]!.key >= l.key) || l.key > s.data.upto) throw bad('has keys out of order');
    const records = l.records.map((r) => {
      const c = checkRecord(r);
      if ('error' in c) throw bad(`has an invalid record in ${l.key}: ${c.error}`);
      return c.record;
    });
    return { key: l.key, records };
  });
  return { key, upto: s.data.upto, logs };
}

/** One log object; records that do not validate are counted as `invalid`. */
async function readLog(objects: ObjectStore, key: string) {
  const raw = await objects.get(key);
  if (!raw) throw new StoreError('not-found', `${key} not found`);
  const json = parseJson(raw) as { v?: unknown; writer?: unknown; records?: unknown } | undefined;
  if (typeof json?.v === 'number' && json.v > 1)
    throw new StoreError(
      'invalid',
      `${key} was written by a newer INDX Watch (log v${json.v}); upgrade to read it`,
    );
  // Like records, log objects may carry unknown top-level fields from newer tools.
  const body = LogObject.safeParse(json && { v: json.v, writer: json.writer, records: json.records });
  if (!body.success) throw new StoreError('invalid', `${key} is not a valid log object`);
  const checked = body.data.records.map(checkRecord);
  const records = checked.flatMap((c) => ('record' in c ? [c.record] : []));
  return { key, writer: body.data.writer, records, invalid: checked.length - records.length };
}

/** Store protocol on top of an ObjectStore (docs/spec/sync.md#store-layout). */
export function createResultStore(objects: ObjectStore): ResultStore {
  const blobKey = (sha: string) => `v1/${blobPath(sha)}`;
  return {
    objects,
    init: (projectId) => initStore(objects, projectId),
    appendLog: (writer, records, now) => appendLog(objects, writer, records, now),
    async listLog(o) {
      const startAfter =
        o.startAfter && !o.startAfter.startsWith(LOG_PREFIX) ? LOG_PREFIX + o.startAfter : o.startAfter;
      const r = await objects.list({ prefix: LOG_PREFIX, startAfter, limit: o.limit });
      return { keys: r.keys.map((k) => k.key).filter((k) => k.endsWith('.json')), truncated: r.truncated };
    },
    async putLogSnapshot(project, logs) {
      const upto = logs.at(-1)?.key;
      const body = JSON.stringify({ v: 1, format: 'indx-watch-log-snapshot', project, upto, logs });
      return putNew(objects, SNAPSHOT_PREFIX, body);
    },
    readLogSnapshot: (project, now) => readLogSnapshot(objects, project, now),
    readLog: (key) => readLog(objects, key),
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
