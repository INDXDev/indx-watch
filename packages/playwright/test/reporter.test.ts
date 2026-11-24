/** The Playwright reporter end to end over examples/shop: test-to-run mapping, warnings, evidence, redaction and sync. */
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type AnyRecord, loadBundle, type RunRecord } from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { buildModel } from '@indx-watch/core';
import { openReplica } from '@indx-watch/store/node';
import type { FullConfig, TestCase, TestResult } from '@playwright/test/reporter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import IndxWatchReporter, { type IndxWatchReporterOptions } from '../src/index.js';

const SHOP = resolve(import.meta.dirname, '../../../examples/shop');
const COMMIT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const ACTOR = 'ci-bot@example.com';
const RUN_GROUP = 'build-512';
const RELEASE = 'v1.2.0';
const PASSWORD = 'hunter2-not-a-real-password';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

let tmp: string;
let bundleDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'iw-pw-'));
  bundleDir = join(tmp, 'shop', '.indx-watch');
  cpSync(join(SHOP, '.indx-watch'), bundleDir, {
    recursive: true,
    filter: (src) => !/[\\/]\.indx-watch[\\/](runs|cache)$/.test(src),
  });
  for (const [k, v] of Object.entries({
    IW_ACTOR: ACTOR,
    IW_ACTOR_KIND: 'ci',
    IW_COMMIT: COMMIT,
    IW_RUN_GROUP: RUN_GROUP,
    IW_RELEASE: RELEASE,
    IW_STORE: '',
    SHOP_CUSTOMER_PASSWORD: PASSWORD,
    GITHUB_ACTIONS: '',
    CLAUDECODE: '',
  }))
    vi.stubEnv(k, v);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

type Res = Partial<TestResult> & { status: TestResult['status'] };
interface Fake {
  title: string;
  tags?: string[];
  project?: string;
  file?: string;
  results: Res[];
  outcome?: ReturnType<TestCase['outcome']>;
  annotations?: TestCase['annotations'];
}

let n = 0;
function fakeTest(f: Fake): { test: TestCase; results: TestResult[] } {
  const file = f.file ?? 'coupon.spec.ts';
  const test = {
    id: `t${n++}`,
    title: f.title,
    tags: f.tags ?? [],
    annotations: f.annotations ?? [],
    expectedStatus: 'passed',
    retries: f.results.length - 1,
    location: { file: join(SHOP, 'tests', file), line: 1, column: 1 },
    results: [] as TestResult[],
    titlePath: () => ['', f.project ?? 'chromium', file, f.title],
    outcome: () => f.outcome ?? (f.results.at(-1)!.status === 'passed' ? 'expected' : 'unexpected'),
  } as unknown as TestCase;
  const results = f.results.map(
    (r, retry) =>
      ({
        retry,
        startTime: new Date(Date.UTC(2026, 10, 19, 4, 13, retry * 10)),
        duration: 1500,
        errors: [],
        steps: [],
        attachments: [],
        annotations: [],
        ...r,
      }) as unknown as TestResult,
  );
  return { test, results };
}

async function report(fakes: Fake[], opts: IndxWatchReporterOptions = {}) {
  writeFileSync(join(tmp, 'shot.png'), PNG);
  const reporter = new IndxWatchReporter({ dir: bundleDir, ...opts });
  const config = { configFile: join(SHOP, 'playwright.config.ts'), rootDir: join(SHOP, 'tests') };
  reporter.onBegin(config as FullConfig); // not awaited, as in Playwright
  for (const { test, results } of fakes.map(fakeTest))
    for (const r of results) {
      test.results.push(r);
      reporter.onTestEnd(test, r);
    }
  // Playwright may delete attachments before onEnd: the reporter must have read them in onTestEnd.
  rmSync(join(tmp, 'shot.png'));
  const end = await reporter.onEnd({ status: 'passed', startTime: new Date(), duration: 1 });
  const records = (await openReplica(bundleDir).records()) as RunRecord[];
  return { end, records: records.sort((a, b) => (a.test_case.key < b.test_case.key ? -1 : 1)) };
}

async function verdicts(records: AnyRecord[]) {
  const { bundle } = await loadBundle(nodeFs(bundleDir));
  const { model } = buildModel(bundle!, records);
  return records.map((r) => model.runs.get(r.id)?.decision.verdict);
}

const warnings = () =>
  vi
    .mocked(console.warn)
    .mock.calls.map((c) => String(c[0]))
    .join('\n');
const step = (title: string, error?: string) => ({
  title,
  category: 'test.step',
  steps: [],
  ...(error ? { error: { message: error } } : {}),
});

/** A single-attempt test linked by `tag` that ends with `status`. */
const single = (tag: string, status: TestResult['status'] = 'passed', extra: Partial<Fake> = {}): Fake => ({
  title: 'x',
  tags: [tag],
  results: [{ status }],
  ...extra,
});

describe('mapping a passing run of examples/shop', () => {
  let end: Awaited<ReturnType<typeof report>>['end'];
  let records: RunRecord[];
  let tc3: RunRecord;
  beforeEach(async () => {
    const shot = { name: 'screenshot', contentType: 'image/png', path: join(tmp, 'shot.png') };
    ({ end, records } = await report([
      {
        title: 'valid coupon reduces the total',
        tags: ['@TC-3'],
        annotations: [{ type: '_iw.fixture', description: 'FX-1:SUMMER10' }],
        results: [
          { status: 'passed', steps: [step('1. Apply'), step('2. Order')] as never, attachments: [shot] },
        ],
      },
      single('@SHOP:TC-1', 'passed', { title: 'product list', file: 'catalog.spec.ts' }),
      single('@tc_01JF3Q8M5X2V7K9D4R6T1W0Y31', 'passed', { title: 'product list again' }),
      single('@TC-1', 'passed', { title: 'product list webkit', project: 'webkit' }),
    ]));
    tc3 = records[2]!;
  });

  it('writes one run per test case and project, all passing', async () => {
    expect(end).toBeUndefined();
    expect(records.map((r) => [r.test_case.key, r.automation?.project, r.judgements.length])).toEqual([
      ['TC-1', 'chromium', 2],
      ['TC-1', 'webkit', 1],
      ['TC-3', 'chromium', 1],
    ]);
    expect(await verdicts(records)).toEqual(['pass', 'pass', 'pass']);
  });

  it('pins the test case version and the fixtures with their selected rows', async () => {
    const { bundle } = await loadBundle(nodeFs(bundleDir));
    expect(tc3.test_case.version).toBe(bundle!.testCases.find((t) => t.data.key === 'TC-3')!.version);
    expect(tc3.fixtures.map((f) => [f.key, f.rows])).toEqual([
      ['FX-1', ['SUMMER10']],
      ['FX-2', undefined],
    ]);
    expect(tc3.fixtures[0]!.version).toMatch(/^fxv:[0-9a-f]{12}$/);
  });

  it('records the actor, build, release, steps, judgement and automation context', () => {
    expect(tc3).toMatchObject({
      source: 'playwright',
      actor: { kind: 'ci', id: ACTOR, via: 'env' },
      build: { commit: COMMIT },
      release: RELEASE,
      environment: 'staging',
      reported: null,
      steps: [
        { index: 1, status: 'pass' },
        { index: 2, status: 'pass' },
      ],
      judgements: [
        { kind: 'assert', verdict: 'pass', test: 'coupon.spec.ts › valid coupon reduces the total' },
      ],
      automation: { framework: 'playwright', group: RUN_GROUP, file: 'examples/shop/tests/coupon.spec.ts' },
    });
  });

  it('stores attachments as evidence blobs', async () => {
    expect(tc3.evidence).toEqual([
      { sha256: expect.any(String), name: 'shot.png', media_type: 'image/png', size: 7, kind: 'screenshot' },
    ]);
    expect(await openReplica(bundleDir).hasBlob(tc3.evidence[0]!.sha256)).toBe(true);
  });
});

describe('mapping outcomes', () => {
  it('says why a run of a manual test case needs review, with the reason from decide()', async () => {
    const { records } = await report([single('@TC-8')]);
    expect(await verdicts(records)).toEqual(['needs_review']);
    expect(warnings()).toContain(
      'TC-8 needs_review: No human judgement yet; TC-8 has mode = "manual" (set mode = "playwright")',
    );
  });

  it('maps a failed step and a failure in any test of the test case to fail', async () => {
    const { records } = await report([
      { title: 'a', tags: ['@TC-5'], results: [{ status: 'passed', steps: [step('1. Add')] as never }] },
      {
        title: 'b',
        tags: ['@TC-5'],
        results: [
          { status: 'failed', errors: [{ message: 'boom' }], steps: [step('1. Add', 'boom\nmore')] as never },
        ],
      },
    ]);
    expect(records[0]!.steps).toEqual([{ index: 1, status: 'fail', note: 'boom' }]);
    expect(records[0]!.judgements.map((j) => [j.verdict, j.reason])).toEqual([
      ['pass', undefined],
      ['fail', 'boom'],
    ]);
    expect(await verdicts(records)).toEqual(['fail']);
  });

  it('records a pass marked flaky when a test passes on retry', async () => {
    const { records } = await report([
      {
        title: 'flaky',
        tags: ['@TC-2'],
        outcome: 'flaky',
        results: [{ status: 'failed' }, { status: 'passed' }],
      },
    ]);
    expect(records[0]!.judgements).toMatchObject([{ kind: 'assert', verdict: 'pass', flaky: true }]);
    expect(await verdicts(records)).toEqual(['pass']);
  });

  it('reports interrupted runs as blocked and skipped tests as skipped', async () => {
    const { records } = await report([
      single('@TC-1', 'interrupted', { title: 'i' }),
      single('@TC-2', 'skipped', { title: 's', outcome: 'skipped' }),
    ]);
    expect(records.map((r) => r.reported)).toEqual(['blocked', 'skipped']);
    expect(await verdicts(records)).toEqual(['blocked', 'skipped']);
  });
});

describe('unlinked tests, a missing bundle and dry run', () => {
  const unlinked: Fake[] = [
    { title: 'ghost @TC-999', results: [{ status: 'passed' }] },
    { title: 'untagged', results: [{ status: 'passed' }] },
    { title: 'other project', tags: ['@OTHER:TC-1', '@smoke'], results: [{ status: 'passed' }] },
  ];

  it('warns about unknown keys and unlinked tests and writes nothing', async () => {
    const lenient = await report(unlinked);
    expect(lenient.end).toBeUndefined();
    expect(lenient.records).toEqual([]);
    expect(warnings()).toContain('@TC-999 (chromium › coupon.spec.ts › ghost @TC-999)');
    expect(warnings()).toContain('2 unlinked test(s)');
    expect(warnings()).toContain('chromium › coupon.spec.ts › untagged');
  });

  it('fails the run on unknown keys in strict mode', async () => {
    expect((await report(unlinked, { strict: true })).end).toEqual({ status: 'failed' });
  });

  it('warns when there is no bundle; strict fails the run', async () => {
    bundleDir = join(tmp, 'missing');
    expect((await report([single('@TC-1')])).end).toBeUndefined();
    expect(warnings()).toContain('cannot load');
    expect((await report([single('@TC-1')], { strict: true })).end).toEqual({ status: 'failed' });
  });

  it('prints records without writing in dry-run mode', async () => {
    const { records } = await report([single('@TC-1')], { dryRun: true });
    expect(records).toEqual([]);
    expect(String(vi.mocked(console.log).mock.calls[0]?.[0])).toContain('would record {"kind":"run"');
  });
});

const trace = () => ({ name: 'trace', contentType: 'application/zip', path: join(tmp, 'shot.png') });
const video = () => ({ name: 'video', contentType: 'video/webm', body: Buffer.from('webm') });
const shot = () => ({ name: 'screenshot', contentType: 'image/png', body: Buffer.from('png') });
/** The evidence kinds of the first (only) run. */
const evidenceKinds = (records: RunRecord[]) => records[0]!.evidence.map((e) => e.kind);

describe('the evidence option', () => {
  const both = () => [
    single('@TC-1', 'passed', { results: [{ status: 'passed', attachments: [shot()] }] }),
    single('@TC-2', 'failed', { results: [{ status: 'failed', attachments: [shot()] }] }),
  ];

  it('keeps only the evidence of failures with evidence: failures', async () => {
    const failures = await report(both(), { evidence: 'failures' });
    expect(failures.records.map((r) => r.evidence.length)).toEqual([0, 1]);
  });

  it('keeps no evidence with evidence: none', async () => {
    const none = await report(both(), { evidence: 'none' });
    expect(none.records.map((r) => r.evidence.length)).toEqual([0, 0]);
  });
});

describe('traces and videos that may show secrets', () => {
  const signIn = () =>
    single('@TC-7', 'passed', { results: [{ status: 'passed', attachments: [trace(), video(), shot()] }] });
  const list = () => single('@TC-1', 'passed', { results: [{ status: 'passed', attachments: [trace()] }] });

  it('skips traces and videos of test cases with an account fixture', async () => {
    expect(evidenceKinds((await report([signIn()])).records)).toEqual(['screenshot']);
  });

  it('keeps them with traces: always', async () => {
    const always = await report([signIn()], { traces: 'always' });
    expect(evidenceKinds(always.records)).toEqual(['trace', 'video', 'screenshot']);
  });

  it('keeps the trace of a test case without secrets', async () => {
    expect(evidenceKinds((await report([list()])).records)).toEqual(['trace']);
  });

  it('also skips them when the environment has a secret set in this process (seed token)', async () => {
    vi.stubEnv('SHOP_SEED_TOKEN', 'seed-token-not-real');
    expect((await report([list()])).records[0]!.evidence).toEqual([]);
  });
});

describe('redaction', () => {
  it('redacts resolved secret values from reasons, notes, titles and text attachments', async () => {
    const log = {
      name: 'error-context',
      contentType: 'text/markdown',
      body: Buffer.from(`typed ${PASSWORD}`),
    };
    const { records } = await report([
      {
        title: `sign in as ${PASSWORD}`,
        tags: ['@TC-7'],
        results: [
          {
            status: 'failed',
            errors: [{ message: `\u001b[31mexpected ${PASSWORD}\u001b[39m` }],
            steps: [step('1. Sign in', `fill ${PASSWORD}`)] as never,
            attachments: [log],
          },
        ],
      },
    ]);
    expect(JSON.stringify(records)).not.toContain(PASSWORD);
    expect(records[0]!.judgements[0]!.reason).toBe('expected ***');
    expect(records[0]!.steps[0]!.note).toBe('fill ***');
    const blob = await openReplica(bundleDir).getBlob(records[0]!.evidence[0]!.sha256);
    expect(new TextDecoder().decode(blob!)).toBe('typed ***');
  });
});

describe('sync', () => {
  it('pushes records and blobs to the configured store after the run', async () => {
    const store = join(tmp, 'store');
    vi.stubEnv('IW_STORE', `file://${store}`);
    const { end } = await report([
      single('@TC-1', 'passed', { results: [{ status: 'passed', attachments: [shot()] }] }),
    ]);
    expect(end).toBeUndefined();
    expect(readdirSync(join(store, 'v1', 'log'))).toHaveLength(1);
    expect(readdirSync(join(store, 'v1', 'blobs', 'sha256'))).toHaveLength(1);
  });

  it('also uploads fixture pointer blobs that are in the local replica', async () => {
    const sha = '8760bc67a01b22044c4098fddeb3a749cd395c4757fab3740aa626cd0da51e1b'; // FX-4 review-photo.png
    const photo = readFileSync(join(SHOP, 'store', 'v1', 'blobs', 'sha256', '87', sha));
    await openReplica(bundleDir).putBlob(new Uint8Array(photo), 'image/png');
    const store = join(tmp, 'store');
    vi.stubEnv('IW_STORE', `file://${store}`);
    await report([single('@TC-1')]);
    expect(readdirSync(join(store, 'v1', 'blobs', 'sha256', '87'))).toEqual([sha]);
  });

  it('logs a failed push and fails only in strict mode', async () => {
    vi.stubEnv('IW_STORE', 's3://bucket/prefix');
    vi.stubEnv('AWS_ACCESS_KEY_ID', '');
    vi.stubEnv('AWS_PROFILE', '');
    const fake = single('@TC-1');
    expect((await report([fake])).end).toBeUndefined();
    expect(warnings()).toContain('push failed');
    expect((await report([fake], { strict: true })).end).toEqual({ status: 'failed' });
    expect((await report([fake], { strict: true, sync: false })).end).toBeUndefined();
  });
});
