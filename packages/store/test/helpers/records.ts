/** Test records with examples/shop IDs (validated with AnyRecord before they are returned). */
import { type AnyRecord, newId, type RunRecord, AnyRecord as Schema } from '@indx-watch/bundle';

export const PROJECT = 'prj_01JF3Q8M5X2V7K9D4R6T1W0Y00';
export const TC3 = { id: 'tc_01JF3Q8M5X2V7K9D4R6T1W0Y33', key: 'TC-3', version: 'tcv:3f9a1c2b7e10' };
const actor = { kind: 'ci', id: 'github:octocat', name: 'octocat', via: 'github' } as const;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export function runRecord(opts: { at?: number; evidence?: string[]; release?: string } = {}): RunRecord {
  const at = opts.at ?? Date.now();
  return Schema.parse({
    kind: 'run',
    id: newId('run', at),
    v: 1,
    project: PROJECT,
    at: iso(at),
    actor,
    source: 'playwright',
    test_case: TC3,
    release: opts.release ?? 'v1.2.0',
    environment: 'staging',
    ended_at: iso(at),
    steps: [{ index: 1, status: 'pass', evidence: opts.evidence ?? [] }],
    evidence: (opts.evidence ?? []).map((sha256, i) => ({
      sha256,
      name: `step-${i + 1}.png`,
      media_type: 'image/png',
      size: 8,
      kind: 'screenshot',
      step: 1,
    })),
    judgements: [{ id: newId('jdg', at), kind: 'assert', verdict: 'pass', confidence: 1 }],
  }) as RunRecord;
}

export function retraction(target: string, at = Date.now()): AnyRecord {
  return Schema.parse({
    kind: 'retraction',
    id: newId('rec', at),
    v: 1,
    project: PROJECT,
    at: iso(at),
    actor,
    source: 'cli',
    target,
    reason: 'recorded against the wrong release',
  });
}
