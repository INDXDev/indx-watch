import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AnyRecord, type Bundle, type Judgement, loadBundle, type RunRecord } from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';

export const SHOP = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
  'examples/shop/.indx-watch',
);

export async function shop(): Promise<Bundle> {
  const { bundle } = await loadBundle(nodeFs(SHOP));
  if (!bundle) throw new Error('examples/shop does not load');
  return bundle;
}

let seq = 0;
export const id = (prefix: string) => `${prefix}_01JF7Z3K0W8N2Q4R6S8T0V${String(++seq).padStart(4, '0')}`;
const actor = { kind: 'ci' as const, id: 'github:octocat', name: 'octocat', via: 'github' as const };

export interface RunOpts {
  verdict?: Judgement['verdict'];
  kind?: Judgement['kind'];
  judgements?: Partial<Judgement>[];
  release?: string;
  environment?: string;
  ended?: string;
  project?: string;
  group?: string;
  rows?: string[];
  version?: string;
  evidence?: boolean;
  reported?: 'blocked' | 'skipped' | null;
  failStep?: number;
}

/** A run record of a test case of examples/shop. */
export function run(b: Bundle, key: string, o: RunOpts = {}): RunRecord {
  const tc = b.testCases.find((t) => t.data.key === key)!;
  const ended = o.ended ?? '2026-11-19T04:00:00Z';
  const js = o.judgements ?? [{ kind: o.kind ?? 'assert', verdict: o.verdict ?? 'pass' }];
  const sha = 'a'.repeat(64);
  return {
    kind: 'run',
    id: id('run'),
    v: 1,
    project: b.project.data.id,
    at: ended,
    actor,
    source: 'playwright',
    test_case: { id: tc.data.id, key, version: o.version ?? tc.version },
    fixtures: (tc.data.fixtures ?? []).map((f) => {
      const fx = b.fixtures.find((x) => x.data.key === f.ref)!;
      return {
        id: fx.data.id,
        key: f.ref,
        version: fx.version,
        ...(o.rows && f.rows ? { rows: o.rows } : {}),
      };
    }),
    release: o.release ?? 'v1.2.0',
    environment: o.environment ?? 'staging',
    build: { commit: 'a1b2c3d' },
    ended_at: ended,
    reported: o.reported ?? null,
    steps: o.failStep
      ? [{ index: o.failStep, status: 'fail', note: 'Total stayed 40.00', evidence: [sha] }]
      : [],
    evidence: o.evidence
      ? [{ sha256: sha, name: 'step-1.png', media_type: 'image/png', size: 10, kind: 'screenshot', step: 1 }]
      : [],
    judgements: js.map((j) => ({ id: id('jdg'), kind: 'assert', verdict: 'pass', ...j }) as Judgement),
    ...(o.project || o.group
      ? { automation: { framework: 'playwright', project: o.project, group: o.group } }
      : {}),
  };
}

/** A later judgement record (a human review). */
export function review(
  b: Bundle,
  runId: string,
  verdict: Judgement['verdict'],
  at: string,
  reason = 'checked',
): AnyRecord {
  return {
    kind: 'judgement',
    id: id('rec'),
    v: 1,
    project: b.project.data.id,
    at,
    actor: { kind: 'human', id: 'alex@shop.test', name: 'Alex', via: 'git' },
    source: 'manual',
    run: runId,
    judgement: { id: id('jdg'), kind: 'human', verdict, reason },
  };
}

export function waiver(
  b: Bundle,
  key: string,
  version: string | undefined,
  at = '2026-11-19T05:00:00Z',
  revokes?: string,
): AnyRecord {
  const tc = b.testCases.find((t) => t.data.key === key)!;
  return {
    kind: 'waiver',
    id: id('wvr'),
    v: 1,
    project: b.project.data.id,
    at,
    actor: { kind: 'human', id: 'lead@shop.test', name: 'Lee', via: 'git' },
    source: 'cli',
    release: 'v1.2.0',
    test_case: { id: tc.data.id, key },
    reason: 'Known issue, fixed in v1.2.1',
    ...(version ? { version } : {}),
    ...(revokes ? { revokes } : {}),
  };
}

export function retraction(b: Bundle, target: string): AnyRecord {
  return {
    kind: 'retraction',
    id: id('rec'),
    v: 1,
    project: b.project.data.id,
    at: '2026-11-19T06:00:00Z',
    actor: { kind: 'human', id: 'alex@shop.test', via: 'git' },
    source: 'cli',
    target,
    reason: 'wrong release',
  };
}

/** Sample results for v1.2.0: TC-2 fails, TC-6 is passed by a human, TC-8 and TC-9 are untested. */
export function sampleRecords(b: Bundle): AnyRecord[] {
  const tc6 = run(b, 'TC-6', {
    kind: 'human',
    verdict: 'pass',
    evidence: true,
    judgements: [{ kind: 'human', verdict: 'pass' }],
  });
  return [
    run(b, 'TC-1', { evidence: true }),
    run(b, 'TC-2', { verdict: 'fail', failStep: 1 }),
    run(b, 'TC-3', { project: 'chromium', rows: ['SUMMER10'] }),
    run(b, 'TC-3', { project: 'webkit', rows: ['SUMMER10'] }),
    run(b, 'TC-4'),
    run(b, 'TC-5'),
    tc6,
    run(b, 'TC-7'),
  ];
}
