/** examples/shop with a fixed set of sample results, and fakes for AppDeps. */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Actor,
  type AnyRecord,
  type Bundle,
  type Judgement,
  loadBundle,
  type RunRecord,
  sha256Hex,
} from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { buildModel } from '@indx-watch/core';
import type { ServerDeps } from '../src/index.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const SHOP = join(ROOT, 'examples/shop/.indx-watch');
export const SHOT_SHA = '8760bc67a01b22044c4098fddeb3a749cd395c4757fab3740aa626cd0da51e1b';
export const SHOT = new Uint8Array(
  readFileSync(join(ROOT, 'examples/shop/store/v1/blobs/sha256/87', SHOT_SHA)),
);
export const NOW = new Date('2026-11-19T00:00:00Z');

export const CI: Actor = { kind: 'ci', id: 'github:octocat', name: 'octocat', via: 'github' };
export const SAM: Actor = { kind: 'human', id: 'sam@shop.test', name: 'sam@shop.test', via: 'git' };
export const ALEX: Actor = { kind: 'human', id: 'alex@shop.test', name: 'Alex', via: 'git' };

export async function shop(): Promise<Bundle> {
  const { bundle } = await loadBundle(nodeFs(SHOP));
  if (!bundle) throw new Error('examples/shop does not load');
  return bundle;
}

let seq = 0;
const id = (prefix: string) => `${prefix}_01JF7Z3K0W8N2Q4R6S8T0V${String(++seq).padStart(4, '0')}`;

interface RunOpts {
  verdict?: Judgement['verdict'];
  judgements?: Partial<Judgement>[];
  actor?: Actor;
  ended?: string;
  version?: string;
  note?: string;
  failStep?: { index: number; note: string };
  evidence?: boolean;
  source?: RunRecord['source'];
}

export function run(b: Bundle, key: string, o: RunOpts = {}): RunRecord {
  const tc = b.testCases.find((t) => t.data.key === key)!;
  const ended = o.ended ?? '2026-11-18T22:10:00Z';
  const actor = o.actor ?? CI;
  return {
    kind: 'run',
    id: id('run'),
    v: 1,
    project: b.project.data.id,
    at: ended,
    actor,
    source: o.source ?? 'playwright',
    test_case: { id: tc.data.id, key, version: o.version ?? tc.version },
    fixtures: (tc.data.fixtures ?? []).map((f) => {
      const fx = b.fixtures.find((x) => x.data.key === f.ref)!;
      return { id: fx.data.id, key: f.ref, version: fx.version, ...(f.rows ? { rows: f.rows } : {}) };
    }),
    release: 'v1.2.0',
    environment: 'staging',
    build: { commit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678' },
    ...(actor.kind === 'ci'
      ? { ci: { provider: 'github', url: 'https://github.com/INDXDev/indx-watch/actions/runs/1' } }
      : {}),
    ended_at: ended,
    reported: null,
    ...(o.note ? { note: o.note } : {}),
    steps: o.failStep
      ? [{ index: o.failStep.index, status: 'fail', note: o.failStep.note, evidence: [SHOT_SHA] }]
      : [],
    evidence: o.evidence
      ? [
          {
            sha256: SHOT_SHA,
            name: 'step-1.png',
            media_type: 'image/png',
            size: SHOT.byteLength,
            kind: 'screenshot',
            step: 1,
          },
        ]
      : [],
    judgements: (o.judgements ?? [{ kind: 'assert', verdict: o.verdict ?? 'pass' }]).map(
      (j) => ({ id: id('jdg'), kind: 'assert', verdict: 'pass', ...j }) as Judgement,
    ),
  };
}

/** Sample results for v1.2.0 on staging: passes, a failure with a screenshot, a review, a stale run, a waiver. */
export function sampleRecords(b: Bundle): AnyRecord[] {
  const pass = (key: string) => run(b, key, { evidence: true });
  const waived = run(b, 'TC-2', {
    verdict: 'fail',
    failStep: { index: 1, note: 'Search is case-sensitive' },
  });
  return [
    pass('TC-1'),
    waived,
    pass('TC-3'),
    run(b, 'TC-4', {
      verdict: 'fail',
      evidence: true,
      failStep: { index: 1, note: 'Total stayed 40.00, no message (internal note)' },
    }),
    pass('TC-5'),
    run(b, 'TC-6', {
      judgements: [{ kind: 'llm', verdict: 'pass', confidence: 0.6, reason: 'Layout looks fine on 390px' }],
      evidence: true,
    }),
    run(b, 'TC-7', {
      actor: SAM,
      source: 'manual',
      evidence: true,
      note: 'Checked by sam@shop.test on the VPN',
      judgements: [{ kind: 'human', verdict: 'pass', reason: 'Matches the copy deck', by: SAM }],
    }),
    run(b, 'TC-8', {
      actor: SAM,
      source: 'manual',
      version: 'tcv:0b7c55e1d902',
      ended: '2026-11-12T09:05:00Z',
      judgements: [{ kind: 'human', verdict: 'pass', by: SAM }],
    }),
    {
      kind: 'waiver',
      id: id('wvr'),
      v: 1,
      project: b.project.data.id,
      at: '2026-11-18T23:00:00Z',
      actor: ALEX,
      source: 'cli',
      release: 'v1.2.0',
      test_case: { id: b.testCases.find((t) => t.data.key === 'TC-2')!.data.id, key: 'TC-2' },
      reason: 'Case-insensitive search ships in v1.2.1',
      version: waived.test_case.version,
    },
  ];
}

/** AppDeps over examples/shop: records in memory, blobs in a map. */
export async function fakeDeps(o: { actor?: Actor; records?: AnyRecord[]; bundle?: Bundle } = {}) {
  const bundle = o.bundle ?? (await shop());
  const written: AnyRecord[] = [];
  const blobs = new Map<string, Uint8Array>([[SHOT_SHA, SHOT]]);
  const records = o.records ?? sampleRecords(bundle);
  let actor = o.actor ?? ALEX;
  let build: { commit?: string; ref?: string } = { commit: 'a1b2c3d', ref: 'refs/heads/main' };
  let ci: { provider: string } | undefined;
  const deps: ServerDeps = {
    mode: 'local',
    loadModel: async () => ({ model: buildModel(bundle, [...records, ...written]).model, problems: [] }),
    writeRecord: async (r) => {
      written.push(r);
    },
    putBlob: async (data) => {
      const sha = await sha256Hex(data);
      blobs.set(sha, data);
      return sha;
    },
    getBlob: async (sha) => blobs.get(sha) ?? null,
    identity: { current: async () => actor },
    context: { build: async () => build, ci: async () => ci },
    readFile: nodeFs(SHOP).read,
    now: () => NOW,
  };
  return {
    deps,
    bundle,
    written,
    blobs,
    setActor: (a: Actor) => {
      actor = a;
    },
    setBuild: (b: typeof build, c?: typeof ci) => {
      build = b;
      ci = c;
    },
  };
}

/** A request as the web UI sends it: JSON bodies, and X-IW-Request on other writes. */
export const req = (path: string, init?: RequestInit & { json?: unknown }) =>
  new Request(`http://127.0.0.1${path}`, {
    ...init,
    ...(init?.json !== undefined
      ? {
          method: init.method ?? 'POST',
          body: JSON.stringify(init.json),
          headers: { 'content-type': 'application/json' },
        }
      : init?.method && init.method !== 'GET' && init.method !== 'HEAD'
        ? { headers: { 'x-iw-request': '1', ...(init.headers as Record<string, string>) } }
        : {}),
  });
