/** The merge rule for two bodies with one record ID (docs/spec/sync.md#merge-rules), shared by sync and the indexes. */
import type { AnyRecord } from '@indx-watch/bundle';
import type { Index } from './ports.js';

/** Index meta key holding the conflicts the merge rule reported: JSON object, record ID → message. */
export const CONFLICTS_META = 'record.conflicts';
/** The copy held under a record ID: its JSON and the log key it was read from (none: unknown, sorts last). */
export type Held = { json: string; key?: string | null | undefined };

/**
 * The body under the log key that sorts first wins. 'add': nothing held · 'key': same body under an earlier key ·
 * 'replace' / 'keep': another body (report it) · null: nothing to do.
 */
export function mergeStep(held: Held | undefined, json: string, key?: string): MergeStep {
  const first = !!key && (!held?.key || key < held.key);
  return !held ? 'add' : held.json === json ? (first ? 'key' : null) : first ? 'replace' : 'keep';
}
export type MergeStep = 'add' | 'key' | 'replace' | 'keep' | null;

export function conflictMessage(id: string, key: string | undefined, step: 'replace' | 'keep', copy: string) {
  const what =
    step === 'replace' ? `replaced the ${copy} copy (its log key sorts first)` : `kept the ${copy} copy`;
  return `record ${id} in ${key ?? 'a new write'} differs from the ${copy} copy; ${what}`;
}

/**
 * Index.ingest of the memory and d1 indexes: applies the rule against `held` (updated in place), calls
 * write(record, body) for each record to store (body false: only its earlier log key), notes conflicts in the meta.
 */
export async function mergeIngest(
  index: Index,
  held: Map<string, Held>,
  records: AnyRecord[],
  logKey: string | undefined,
  write: (r: AnyRecord, body: boolean) => void,
) {
  const notes: Record<string, string> = {};
  let changed = 0;
  for (const r of records) {
    const json = JSON.stringify(r);
    const step = mergeStep(held.get(r.id), json, logKey);
    if (step === 'keep' || step === 'replace') notes[r.id] = conflictMessage(r.id, logKey, step, 'indexed');
    if (!step || step === 'keep') continue;
    if (step !== 'key') changed++;
    write(r, step !== 'key');
    held.set(r.id, { json, key: logKey });
  }
  const n = Object.keys(notes).length;
  if (n) {
    const all = { ...JSON.parse((await index.getMeta(CONFLICTS_META)) ?? '{}'), ...notes };
    await index.setMeta(CONFLICTS_META, JSON.stringify(all));
  }
  return changed + n;
}
