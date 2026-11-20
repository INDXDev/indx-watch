/** The merge rule for two bodies with one record ID (docs/spec/sync.md#merge-rules), shared by sync and the indexes. */
import type { AnyRecord } from '@indx-watch/bundle';
import type { Index } from './ports.js';

/** Index meta key holding the conflicts the merge rule reported: JSON object, record ID → message. */
export const CONFLICTS_META = 'record.conflicts';
/** The copy held under a record ID: its JSON and the log key it was read from (none: unknown, sorts last). */
export type Held = { json: string; key?: string | null | undefined };
/** True when a body carries a valid signature by a pinned key (`verifyRecord` with the trusted keys). */
export type Trust = (record: AnyRecord) => Promise<boolean>;
export type MergeStep = 'add' | 'key' | 'replace' | 'keep' | null;

/**
 * A body signed by a pinned key beats one that is not; otherwise the body under the log key that sorts first wins.
 * 'add': nothing held · 'key': same body under an earlier key · 'replace' / 'keep': another body (report it) ·
 * null: nothing to do. `trust` is only called when the bodies differ.
 */
export async function mergeStep(
  held: Held | undefined,
  r: AnyRecord,
  key?: string,
  trust?: Trust,
): Promise<MergeStep> {
  const first = !!key && (!held?.key || key < held.key);
  if (!held) return 'add';
  if (held.json === JSON.stringify(r)) return first ? 'key' : null;
  const [was, is] = trust ? [await trust(JSON.parse(held.json)), await trust(r)] : [false, false];
  return (was !== is ? is : first) ? 'replace' : 'keep';
}

export function conflictMessage(id: string, key: string | undefined, step: 'replace' | 'keep', copy: string) {
  const what =
    step === 'replace'
      ? `replaced the ${copy} copy (signed, or its log key sorts first)`
      : `kept the ${copy} copy`;
  return `record ${id} in ${key ?? 'a new write'} differs from the ${copy} copy; ${what}`;
}

/** What Index.ingest should store: records to add, replace or re-key (`held` updated in place), and conflict notes. */
export async function mergePlan(
  held: Map<string, Held>,
  records: AnyRecord[],
  logKey?: string,
  trust?: Trust,
) {
  const plan: { r: AnyRecord; step: 'add' | 'key' | 'replace'; held: Held | undefined }[] = [];
  const notes: Record<string, string> = {};
  for (const r of records) {
    const h = held.get(r.id);
    const step = await mergeStep(h, r, logKey, trust);
    if (step === 'keep' || step === 'replace') notes[r.id] = conflictMessage(r.id, logKey, step, 'indexed');
    if (!step || step === 'keep') continue;
    plan.push({ r, step, held: h });
    held.set(r.id, { json: JSON.stringify(r), key: logKey });
  }
  return { plan, notes, count: plan.filter((p) => p.step !== 'key').length + Object.keys(notes).length };
}

/** Index.ingest of the memory index (the d1 index runs the same plan as guarded SQL). */
export async function mergeIngest(
  index: Index,
  held: Map<string, Held>,
  records: AnyRecord[],
  logKey: string | undefined,
  trust: Trust | undefined,
  write: (r: AnyRecord) => void,
) {
  const { plan, notes, count } = await mergePlan(held, records, logKey, trust);
  for (const p of plan) if (p.step !== 'key') write(p.r);
  if (Object.keys(notes).length) {
    const all = { ...JSON.parse((await index.getMeta(CONFLICTS_META)) ?? '{}'), ...notes };
    await index.setMeta(CONFLICTS_META, JSON.stringify(all));
  }
  return count;
}
