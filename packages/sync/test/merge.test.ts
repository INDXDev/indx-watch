// syncOnce merge rules: conflicting bodies for one record ID, signed bodies and convergence.
import { generateSigningKey, recordSigner } from '@indx-watch/bundle';
import { memoryObjectStore } from '@indx-watch/store';
import { describe, expect, it } from 'vitest';
import { runRecord } from '../../store/test/helpers/records.js';
import { emptyState } from '../src/index.js';
import { clone, MIN, putLog } from './helpers.js';

describe('syncOnce: two bodies with one record ID', () => {
  it('warns when the store has another body for a record ID and keeps the local copy', async () => {
    const objects = memoryObjectStore();
    const a = clone(objects, 'a');
    const run = runRecord();
    await a.replica.putRecord(run);
    await a.sync();
    const forged = { ...run, steps: [{ ...run.steps[0]!, note: 'FORGED BODY' }] };
    const key = await putLog(objects, Date.now() + 1000, [forged]); // sorts after the key of the push
    const r = await a.sync();
    const warning = `record ${run.id} in ${key} differs from the local copy; kept the local copy`;
    expect(r.warnings).toEqual([warning]);
    expect(await a.replica.getRecord(run.id)).toEqual(run);
    expect((await a.state.load()).conflicts).toEqual({ [run.id]: warning });
  });

  it('a body signed by a pinned key is never replaced by an unsigned one under an earlier key', async () => {
    const objects = memoryObjectStore();
    const k = await generateSigningKey('ci');
    const [a, b] = [clone(objects, 'a', { keys: [k.key] }), clone(objects, 'b', { keys: [k.key] })];
    const run = await recordSigner(k.secret)(runRecord());
    await a.replica.putRecord(run);
    await a.sync();
    const forged = { ...run, sig: undefined, steps: [{ ...run.steps[0]!, note: 'FORGED BODY' }] };
    await putLog(objects, Date.now() - 5 * MIN, [forged]); // sorts before the signed body's key
    expect((await a.sync()).warnings).toEqual([expect.stringContaining('kept the local copy')]);
    expect(await a.replica.getRecord(run.id)).toEqual(run);
    // a fresh clone meets the forged body first and replaces it once the signed one arrives
    expect((await b.sync()).warnings).toEqual([expect.stringContaining('replaced the local copy')]);
    expect(await b.replica.getRecord(run.id)).toEqual(run);
  });

  it('two bodies with one record ID converge on the one whose log key sorts first', async () => {
    const objects = memoryObjectStore();
    const [a, b] = [clone(objects, 'a'), clone(objects, 'b')];
    const run = runRecord();
    await a.replica.putRecord(run);
    await a.sync();
    await b.sync();
    expect(await b.replica.getRecord(run.id)).toEqual(run);
    const forged = { ...run, steps: [{ ...run.steps[0]!, note: 'FORGED BODY' }] };
    const key = await putLog(objects, Date.now() - 5 * MIN, [forged]); // earlier than the push, inside the lookback
    const replaced = `record ${run.id} in ${key} differs from the local copy; replaced the local copy (signed, or its log key sorts first)`;
    for (const c of [a, b]) {
      expect((await c.sync()).warnings).toEqual([replaced]);
      expect(await c.replica.getRecord(run.id)).toEqual(forged);
      expect((await c.sync()).warnings).toEqual([]);
      await c.state.save(emptyState()); // cache/ deleted: the full listing reads the earlier key first
      expect((await c.sync()).warnings).toEqual([
        expect.stringMatching(/differs from the local copy; kept the local copy$/),
      ]);
      expect(await c.replica.getRecord(run.id)).toEqual(forged);
    }
    // a fresh clone reads the earlier key first and keeps its body as well
    const fresh = clone(objects, 'c');
    expect((await fresh.sync()).warnings).toEqual([expect.stringContaining('kept the local copy')]);
    expect(await fresh.replica.getRecord(run.id)).toEqual(forged);
  });
});
