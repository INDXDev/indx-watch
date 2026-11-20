import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnyRecord, sha256Hex } from '@indx-watch/bundle';
import { describe, expect, it } from 'vitest';
import { memoryObjectStore } from '../src/adapters/memory.js';
import { openReplica } from '../src/node/index.js';
import { createResultStore } from '../src/result-store.js';
import { checkRecord, idTime } from '../src/util.js';
import { PROJECT, runRecord } from './helpers/records.js';

const enc = new TextEncoder();

describe('createResultStore', () => {
  it('creates the manifest in the documented format and refuses another project', async () => {
    const objects = memoryObjectStore();
    const rs = createResultStore(objects);
    await rs.init(PROJECT);
    expect(new TextDecoder().decode((await objects.get('indx-watch-store.json'))!)).toBe(
      `{"format":"indx-watch-store","version":1,"project":"${PROJECT}"}`,
    );
    await expect(rs.init('prj_01JF3Q8M5X2V7K9D4R6T1W0Y01')).rejects.toMatchObject({ code: 'wrong-project' });
    await objects.put('indx-watch-store.json', '{"format":"x"}');
    await expect(rs.init(PROJECT)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('writes log objects of at most 1000 records under v1/log/<ULID>.json', async () => {
    const objects = memoryObjectStore();
    const rs = createResultStore(objects);
    const records = Array.from({ length: 2001 }, () => runRecord());
    const keys = await rs.appendLog('w1', records);
    expect(keys).toHaveLength(3);
    for (const k of keys) expect(k).toMatch(/^v1\/log\/[0-9A-HJKMNP-TV-Z]{26}\.json$/);
    const body = JSON.parse(new TextDecoder().decode((await objects.get(keys[0]!))!));
    expect(Object.keys(body)).toEqual(['v', 'writer', 'records']);
    expect(body.records).toHaveLength(1000);
    expect(JSON.stringify(body.records[0])).toBe(JSON.stringify(records[0]));
    const listed = await rs.listLog({});
    expect(listed.keys).toEqual([...keys].sort());
    expect((await rs.listLog({ startAfter: keys[0]! })).keys).toEqual(keys.slice(1));
    // a bare ULID gets the v1/log/ prefix; the key with that ULID is included
    expect((await rs.listLog({ startAfter: keys[1]!.slice(7, -5), limit: 1 })).keys).toEqual([keys[1]]);
    const entry = await rs.readLog(keys[2]!);
    expect(entry).toMatchObject({ key: keys[2], writer: 'w1', invalid: 0 });
    expect(entry.records.map((r) => r.id)).toEqual([records[2000]!.id]);
  });

  it('counts invalid records and tolerates unknown fields from newer tools', async () => {
    const objects = memoryObjectStore();
    const rs = createResultStore(objects);
    const good = runRecord();
    const newer = { ...runRecord(), future_field: 1, test_case: { ...good.test_case, extra: true } };
    await objects.put(
      'v1/log/01JF7Z9A2B4C6D8E0F2G4H6J8K.json',
      JSON.stringify({ v: 1, writer: 'w', records: [good, newer, { kind: 'run' }], future: { a: 1 } }),
    );
    const entry = await rs.readLog('v1/log/01JF7Z9A2B4C6D8E0F2G4H6J8K.json');
    expect(entry.invalid).toBe(1);
    expect(entry.records).toHaveLength(2);
    expect(JSON.stringify(entry.records[1])).toBe(JSON.stringify(newer));
    await objects.put('v1/log/01JF7Z9A2B4C6D8E0F2G4H6J8M.json', 'not json');
    await expect(rs.readLog('v1/log/01JF7Z9A2B4C6D8E0F2G4H6J8M.json')).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(rs.readLog('v1/log/01JF7Z9A2B4C6D8E0F2G4H6J8N.json')).rejects.toMatchObject({
      code: 'not-found',
    });
    await objects.put('v1/log/01JF7Z9A2B4C6D8E0F2G4H6J8P.json', '{"v":2,"writer":"w","records":[]}');
    await expect(rs.readLog('v1/log/01JF7Z9A2B4C6D8E0F2G4H6J8P.json')).rejects.toMatchObject({
      code: 'invalid',
      message: expect.stringMatching(/newer INDX Watch.*upgrade/),
    });
  });

  it('refuses to write invalid records', async () => {
    const rs = createResultStore(memoryObjectStore());
    const bad = { ...runRecord(), source: 'telepathy' } as unknown as AnyRecord;
    await expect(rs.appendLog('w', [bad])).rejects.toMatchObject({ code: 'invalid' });
  });

  it('verifies blob hashes on put and get', async () => {
    const objects = memoryObjectStore();
    const rs = createResultStore(objects);
    const data = enc.encode('png bytes');
    const sha = await sha256Hex(data);
    await expect(rs.putBlob(sha, enc.encode('other'))).rejects.toMatchObject({ code: 'invalid' });
    expect(await rs.hasBlob(sha)).toBe(false);
    expect(await rs.getBlob(sha)).toBeNull();
    await rs.putBlob(sha, data);
    await objects.put(`v1/blobs/sha256/${sha.slice(0, 2)}/${sha}`, 'corrupt');
    await expect(rs.getBlob(sha)).rejects.toMatchObject({ code: 'invalid' });
    await expect(rs.hasBlob('../x')).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('checkRecord', () => {
  it('accepts canonical records and rejects structurally invalid ones', () => {
    const r = runRecord();
    expect(AnyRecord.safeParse(r).success).toBe(true);
    expect(checkRecord(r)).toEqual({ record: r });
    expect(checkRecord({ ...r, at: 'yesterday' })).toHaveProperty('error');
  });
});

describe('local replica (fs)', () => {
  it('stores records by month and blobs by hash, create-if-absent, with change events', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iw-replica-'));
    try {
      const replica = openReplica(dir);
      let changes = 0;
      const off = replica.onChange(() => changes++);
      const blob = enc.encode('screenshot');
      const sha = await replica.putBlob(blob, 'image/png');
      expect(sha).toBe(await sha256Hex(blob));
      const run = runRecord({ evidence: [sha] });
      expect(await replica.putRecord(run)).toBe(true);
      expect(await replica.putRecord(run)).toBe(false);
      expect(changes).toBeGreaterThanOrEqual(2);
      off();
      const month = new Date(idTime(run.id)).toISOString().slice(0, 7);
      const file = join(dir, 'runs', 'records', month, `${run.id}.json`);
      expect(await readFile(file, 'utf8')).toBe(JSON.stringify(run));
      expect(await readdir(join(dir, 'runs', 'blobs', 'sha256', sha.slice(0, 2)))).toEqual([sha]);
      expect(await replica.getRecord(run.id)).toEqual(run);
      expect(await replica.getBlob(sha)).toEqual(blob);
      expect(await replica.hasBlob(sha)).toBe(true);
      expect(await replica.getRecord('run_01JF7Z3K0W8N2Q4R6S8T0V2X4Y')).toBeNull();

      await writeFile(
        join(dir, 'runs', 'records', month, 'run_01JF7Z3K0W8N2Q4R6S8T0V2X4Z.json'),
        '{"kind":"run"}',
      );
      await writeFile(join(dir, 'runs', 'records', month, '.tmp-partial'), '{');
      const invalid: string[] = [];
      const all = await replica.records((f) => invalid.push(f));
      expect(all.map((r) => r.id)).toEqual([run.id]);
      expect(invalid).toEqual([`records/${month}/run_01JF7Z3K0W8N2Q4R6S8T0V2X4Z.json`]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('notices records written by another process', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iw-replica-'));
    try {
      const a = openReplica(dir);
      const b = openReplica(dir);
      const seen = new Promise<void>((resolve) => {
        const off = a.onChange(() => {
          off();
          resolve();
        });
      });
      await b.putRecord(runRecord());
      await seen;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
