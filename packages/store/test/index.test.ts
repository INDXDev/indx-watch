import { readFile } from 'node:fs/promises';
import type { AnyRecord } from '@indx-watch/bundle';
import { describe, expect, it } from 'vitest';
import { memoryIndex } from '../src/adapters/memory.js';
import { CONFLICTS_META } from '../src/merge.js';
import type { Index } from '../src/ports.js';
import { d1Index, INDEX_SCHEMA } from '../src/workers/index.js';
import { fakeD1 } from './helpers/fakes.js';
import { retraction, runRecord, TC3 } from './helpers/records.js';

const T = Date.parse('2026-11-19T04:00:00Z');

function indexContract(name: string, make: () => Index) {
  describe(`Index: ${name}`, () => {
    it('ingests idempotently and filters by kind, test case, release, since and limit', async () => {
      const idx = make();
      const r1 = runRecord({ at: T });
      const r2 = runRecord({ at: T + 60_000, release: 'v1.3.0' });
      const r3 = runRecord({ at: T + 120_000 });
      const x = retraction(r2.id, T + 180_000);
      expect(await idx.ingest([r3, r1])).toBe(2);
      expect(await idx.ingest([r1, r2, x])).toBe(2);
      const ids = async (f?: Parameters<Index['records']>[0]) => (await idx.records(f)).map((r) => r.id);
      expect(await ids()).toEqual([r1.id, r2.id, r3.id, x.id]);
      expect(await ids({ kinds: ['retraction'] })).toEqual([x.id]);
      expect(await ids({ kinds: [] })).toEqual([]);
      expect(await ids({ testCaseId: TC3.id })).toEqual([r1.id, r2.id, r3.id]);
      expect(await ids({ release: 'v1.2.0' })).toEqual([r1.id, r3.id]);
      expect(await ids({ since: '2026-11-19T04:01:00Z' })).toEqual([r2.id, r3.id, x.id]);
      expect(await ids({ kinds: ['run'], limit: 2 })).toEqual([r2.id, r3.id]);
      expect((await idx.records({ kinds: ['run'] }))[0]).toEqual(r1);
    });

    it('keeps the body whose log key sorts first and notes the conflict', async () => {
      const idx = make();
      const run = runRecord({ at: T });
      const forged = { ...run, steps: [{ ...run.steps[0]!, note: 'FORGED BODY' }] };
      const conflicts = async () => JSON.parse((await idx.getMeta(CONFLICTS_META)) ?? '{}');
      expect(await idx.ingest([run], 'v1/log/B.json')).toBe(1);
      expect(await idx.ingest([forged], 'v1/log/C.json')).toBe(1); // a later key: kept, noted
      expect(await idx.records()).toEqual([run]);
      expect(await conflicts()).toEqual({
        [run.id]: `record ${run.id} in v1/log/C.json differs from the indexed copy; kept the indexed copy`,
      });
      expect(await idx.ingest([forged], 'v1/log/A.json')).toBe(2); // an earlier key: replaced, noted
      expect(await idx.records()).toEqual([forged]);
      expect(await idx.ingest([forged], 'v1/log/0.json')).toBe(0); // same body, earlier key: remembered
      expect(await idx.ingest([run], 'v1/log/A.json')).toBe(1);
      expect(await idx.records({ testCaseId: TC3.id })).toEqual([forged]);
      expect(Object.values(await conflicts())[0]).toMatch(/in v1\/log\/A.json .*kept the indexed copy$/);
    });

    it('a body the trust check accepts (signed by a pinned key) beats one it does not, whatever the log keys', async () => {
      const idx = make();
      const run = runRecord({ at: T });
      const forged = { ...run, steps: [{ ...run.steps[0]!, note: 'FORGED BODY' }] };
      const trust = async (r: AnyRecord) => JSON.stringify(r) === JSON.stringify(run);
      expect(await idx.ingest([run], 'v1/log/B.json', trust)).toBe(1);
      expect(await idx.ingest([forged], 'v1/log/A.json', trust)).toBe(1); // earlier key, but unsigned: kept
      expect(await idx.records()).toEqual([run]);
      const other = make();
      await other.ingest([forged], 'v1/log/A.json', trust);
      expect(await other.ingest([run], 'v1/log/B.json', trust)).toBe(2); // later key, but signed: replaced
      expect(await other.records()).toEqual([run]);
      expect(await other.ingest([forged], 'v1/log/0.json', trust)).toBe(1);
      expect(await other.records()).toEqual([run]);
    });

    it('concurrent ingests of two bodies converge on the earliest key and note the conflict', async () => {
      for (const [first, second] of [
        ['v1/log/A.json', 'v1/log/B.json'],
        ['v1/log/B.json', 'v1/log/A.json'],
      ]) {
        const idx = make();
        const run = runRecord({ at: T });
        const forged = { ...run, steps: [{ ...run.steps[0]!, note: 'FORGED BODY' }] };
        await Promise.all([idx.ingest([run], first), idx.ingest([forged], second)]);
        const winner = first === 'v1/log/A.json' ? run : forged;
        expect(await idx.records()).toEqual([winner]);
        expect(Object.keys(JSON.parse((await idx.getMeta(CONFLICTS_META)) ?? '{}'))).toEqual([run.id]);
        // the earliest key is remembered: a third body under a later key is kept out
        await idx.ingest([{ ...run, steps: [] }], 'v1/log/C.json');
        expect(await idx.records()).toEqual([winner]);
      }
    });

    it('stores definitions and meta, and resets', async () => {
      const idx = make();
      expect(await idx.definitions()).toBeNull();
      expect(await idx.getMeta('cursor')).toBeNull();
      await idx.setMeta('cursor', 'a');
      await idx.setMeta('cursor', 'b');
      expect(await idx.getMeta('cursor')).toBe('b');
      const files = new Map([['project.toml', 'key = "SHOP"\n']]);
      await idx.setDefinitions(files, {
        source: 'rec_01JF7Z9A2B4C6D8E0F2G4H6J8K',
        at: '2026-11-19T04:00:00Z',
      });
      await idx.setDefinitions(files, {
        source: 'rec_01JF7Z9A2B4C6D8E0F2G4H6J8M',
        at: '2026-11-19T05:00:00Z',
      });
      expect(await idx.definitions()).toEqual({
        files,
        source: 'rec_01JF7Z9A2B4C6D8E0F2G4H6J8M',
        at: '2026-11-19T05:00:00Z',
      });
      await idx.ingest([runRecord()]);
      await idx.reset();
      expect(await idx.records()).toEqual([]);
      expect(await idx.definitions()).toBeNull();
      expect(await idx.getMeta('cursor')).toBeNull();
    });
  });
}

indexContract('memory', memoryIndex);
indexContract('d1 (node:sqlite fake)', () => d1Index(fakeD1()));

describe('index schema', () => {
  it('src/index-schema.sql and the Workers copy are the same statements', async () => {
    const sql = await readFile(new URL('../src/index-schema.sql', import.meta.url), 'utf8');
    const statements = sql
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toEqual(INDEX_SCHEMA);
  });
});
