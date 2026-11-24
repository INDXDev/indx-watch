import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createArchive, readArchive } from '../src/archive.js';
import { checkBundle } from '../src/check.js';
import { loadBundle } from '../src/load.js';
import { findBundleDir, nodeFs } from '../src/node/index.js';
import { decodeRecord, encodeRecord } from '../src/record-io.js';
import { TestCase } from '../src/schema/definitions.js';
import { verifiedClaims } from '../src/sign.js';
import { parseToml } from '../src/toml.js';
import { fixtureVersion, testCaseVersion, translationSourceHash } from '../src/versions.js';
import { createDefinition, slugify } from '../src/write.js';
import { memFs, REPO, SHOP, shopFiles } from './helpers.js';

const dec = new TextDecoder();
const TC3 = 'specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-3-valid-coupon.toml';

describe('load problems', () => {
  it('a TOML syntax error names line, column and the line, and lists the file in invalidFiles', async () => {
    const fs = memFs();
    const file = 'specs/FEAT-3-account/UC-4-customer-signs-in/use-case.toml';
    await fs.write(file, `${fs.text(file)}\n[[[\n`);
    const { bundle, problems } = await loadBundle(fs);
    const p = problems.find((x) => x.file === file)!;
    expect(p).toMatchObject({ severity: 'error', code: 'invalid-toml' });
    expect(p.message).toMatch(/ at line \d+, column \d+: \[\[\[$/);
    expect(bundle!.invalidFiles).toEqual([file]);
    expect(bundle!.useCases.some((u) => u.file === file)).toBe(false);
    expect((await loadBundle(memFs())).bundle!.invalidFiles).toEqual([]);
  });
});

describe('docs/spec/bundle-format.md examples', () => {
  const md = readFileSync(join(REPO, 'docs/spec/bundle-format.md'), 'utf8');
  const blocks = [...md.matchAll(/```toml\n([\s\S]*?)```/g)]
    .map((m) => m[1]!)
    .filter((b) => b.includes('id = '));
  const texts = [...shopFiles()].map(([p, b]) => [p, dec.decode(b)] as const);
  it('has examples', () => expect(blocks.length).toBeGreaterThanOrEqual(9));
  it.each(blocks.map((b) => [b.split('\n').find((l) => l.startsWith('id = ')), b]))('%s', (_id, block) => {
    const exact = texts.find(([, t]) => t === block);
    // the short illustration under "Common rules" is the start of TC-3
    const prefix = texts.find(([p, t]) => p === TC3 && t.startsWith(block) && block.split('\n').length <= 6);
    expect(exact ?? prefix).toBeDefined();
  });
});

describe('versions', () => {
  const tc = TestCase.parse(parseToml(dec.decode(shopFiles().get(TC3)!)));
  const ac = new Map([['AC-2.1', 'A valid coupon reduces the order total by its discount.']]);

  it('is stable under a title, tag or translation change', async () => {
    const v = await testCaseVersion(tc, ac);
    expect(v).toMatch(/^tcv:[0-9a-f]{12}$/);
    const cosmetic = {
      ...tc,
      title: 'Other',
      tags: ['x'],
      priority: 'P1' as const,
      steps: tc.steps.map((s) => ({
        ...s,
        i18n: { ja: { instruction: 'x', status: 'machine' as const, source_hash: '000000000000' } },
      })),
    };
    expect(await testCaseVersion(cosmetic, ac)).toBe(v);
  });

  it('ignores guidance: purpose, start, checks, fixture use and notes', async () => {
    const v = await testCaseVersion(tc, ac);
    const { purpose: _p, start: _s, start_note: _n, ...bare } = tc;
    const plain = {
      ...bare,
      steps: tc.steps.map(({ checks: _, ...s }) => s),
      fixtures: tc.fixtures?.map(({ use: _, note: _n, i18n: _i, ...f }) => f),
    };
    expect(tc.purpose && tc.steps[0]!.checks && tc.fixtures![0]!.use).toBeTruthy();
    expect(await testCaseVersion(plain, ac)).toBe(v);
  });

  it('start is a path with one leading slash, never another host', () => {
    const ok = (start: string) => TestCase.shape.start.safeParse(start).success;
    expect([ok('/cart'), ok('/'), ok('//evil.example/x'), ok('cart')]).toEqual([true, true, false, false]);
  });

  it('changes when a step or a covered criterion changes', async () => {
    const v = await testCaseVersion(tc, ac);
    const step = { ...tc, steps: [{ ...tc.steps[0]!, expected: 'Something else.' }, tc.steps[1]!] };
    expect(await testCaseVersion(step, ac)).not.toBe(v);
    expect(await testCaseVersion(tc, new Map([['AC-2.1', 'Reworded.']]))).not.toBe(v);
  });
});

describe('versions of the shop bundle', () => {
  it('keeps the versions of the shop test cases (sample results stay current)', async () => {
    const { bundle } = await loadBundle(memFs());
    expect(Object.fromEntries(bundle!.testCases.map((t) => [t.data.key, t.version]))).toEqual({
      'TC-1': 'tcv:4c31fb105036',
      'TC-2': 'tcv:1fc4935a7bd8',
      'TC-3': 'tcv:234b18516499',
      'TC-4': 'tcv:4d8e394e3d0f',
      'TC-5': 'tcv:b1910773f3f5',
      'TC-6': 'tcv:c373dedbc578',
      'TC-7': 'tcv:880407595f3c',
      'TC-8': 'tcv:b1b0b194241f',
      'TC-9': 'tcv:657f1b81c898',
      'TC-10': 'tcv:762f027791d5',
    });
  });

  it('a CRLF checkout (git autocrlf) gives the same versions and values', async () => {
    const crlf = new Map(
      [...shopFiles()].map(([p, b]) => [
        p,
        /\.(toml|csv|json)$/.test(p) ? new TextEncoder().encode(dec.decode(b).replace(/\n/g, '\r\n')) : b,
      ]),
    );
    const [lf, win] = [(await loadBundle(memFs())).bundle!, (await loadBundle(memFs(crlf))).bundle!];
    const versions = (x: typeof lf) => [...x.testCases, ...x.fixtures].map((t) => [t.data.key, t.version]);
    expect(versions(win)).toEqual(versions(lf));
    expect(win.environments).toEqual(lf.environments);
  });

  it('fixture version covers data content but not the title', async () => {
    const { bundle } = await loadBundle(memFs());
    const fx = bundle!.fixtures.find((f) => f.data.key === 'FX-1')!;
    expect(await fixtureVersion({ ...fx.data, title: 'Renamed' }, fx.dataFiles)).toBe(fx.version);
    expect(await fixtureVersion(fx.data, [{ ...fx.dataFiles[0]!, sha256: 'f'.repeat(64) }])).not.toBe(
      fx.version,
    );
  });

  it('translation source hash is over the canonical body of the listed fields', async () => {
    expect(
      await translationSourceHash(
        { title: 'Checkout', description: 'Cart, coupons and placing an order.', key: 'x' },
        ['title', 'description'],
      ),
    ).toBe('21d4059be89b');
  });
});

describe('records', () => {
  const run = {
    kind: 'run',
    id: 'run_01JF7Z3K0W8N2Q4R6S8T0V2X4Y',
    v: 1,
    project: 'prj_01JF3Q8M5X2V7K9D4R6T1W0Y00',
    at: '2026-11-19T04:13:40Z',
    actor: { kind: 'ci', id: 'github:octocat', via: 'github' },
    source: 'playwright',
    test_case: { id: 'tc_01JF3Q8M5X2V7K9D4R6T1W0Y33', key: 'TC-3', version: 'tcv:3f9a1c2b7e10' },
    ended_at: '2026-11-19T04:13:40Z',
  };

  it('encodes in schema order with defaults', () => {
    const text = encodeRecord(run);
    expect(text.startsWith('{"kind":"run","id":"run_01JF7Z3K0W8N2Q4R6S8T0V2X4Y","v":1,')).toBe(true);
    expect(JSON.parse(text)).toMatchObject({
      fixtures: [],
      build: {},
      reported: null,
      steps: [],
      evidence: [],
      judgements: [],
    });
    expect(() => encodeRecord({ ...run, extra: 1 })).toThrow();
  });

  it('decodes leniently', () => {
    expect(
      decodeRecord(JSON.stringify({ ...run, future: { a: 1 }, actor: { ...run.actor, team: 'x' } }))?.kind,
    ).toBe('run');
    expect(decodeRecord({ ...run, at: 'yesterday' })).toBeNull();
    expect(decodeRecord({ kind: 'nope' })).toBeNull();
    expect(decodeRecord('not json')).toBeNull();
  });
  it('treats CI provider identities as claims that need a signature', () => {
    for (const via of ['github', 'gitlab', 'circleci', 'buildkite'] as const)
      expect(verifiedClaims(decodeRecord({ ...run, actor: { ...run.actor, via } })!)).toEqual([via]);
    expect(
      verifiedClaims(decodeRecord({ ...run, actor: { kind: 'human', id: 'a@shop.test', via: 'git' } })!),
    ).toEqual([]);
  });
});

/** A retraction record to carry through an archive. */
const RETRACTION = {
  kind: 'retraction',
  id: 'rec_01JF7Z3K0W8N2Q4R6S8T0V2X4Z',
  v: 1,
  project: 'prj_01JF3Q8M5X2V7K9D4R6T1W0Y00',
  at: '2026-11-19T04:13:40Z',
  actor: { kind: 'human', id: 'a@shop.test', via: 'git' },
  source: 'cli',
  target: 'run_01JF7Z3K0W8N2Q4R6S8T0V2X4Y',
  reason: 'wrong release',
};

describe('archive', () => {
  it('round-trips with identical manifest hashes and bytes', async () => {
    const bundleFiles = [...shopFiles()].map(([path, data]) => ({ path, data }));
    const blob = new Uint8Array([1, 2, 3]);
    const records = [RETRACTION];
    const now = new Date('2026-11-19T00:00:00Z');
    const a = await createArchive({
      project: 'SHOP',
      bundleFiles,
      records,
      blobs: [{ path: 'x', data: blob }],
      now,
    });
    expect(a.manifest).toMatchObject({ records: 1, blobs: 1, created_at: '2026-11-19T00:00:00Z' });
    const back = await readArchive(a.tar);
    expect(back.manifest.sha256).toBe(a.manifest.sha256);
    expect(back.bundleFiles.map((f) => f.path).sort()).toEqual(bundleFiles.map((f) => f.path).sort());
    expect(back.records).toEqual(records);
    const b = await createArchive({
      project: 'SHOP',
      bundleFiles: back.bundleFiles,
      records: back.records,
      blobs: back.blobs,
      now,
    });
    expect(b.manifest.sha256).toBe(a.manifest.sha256);
    expect(b.tar).toEqual(a.tar);
  });

  it('rejects entries outside the layout (zip-slip)', async () => {
    for (const path of ['../../escaped.txt', 'a/./b.toml', 'a//b', 'a\\..\\b']) {
      const bad = await createArchive({
        project: 'SHOP',
        bundleFiles: [{ path, data: new TextEncoder().encode('x') }],
        records: [],
        blobs: [],
      });
      await expect(readArchive(bad.tar), path).rejects.toThrow(/not allowed/);
    }
  });

  it('rejects a modified archive', async () => {
    const a = await createArchive({
      project: 'SHOP',
      bundleFiles: [{ path: 'project.toml', data: new TextEncoder().encode('x = 1\n') }],
      records: [],
      blobs: [],
    });
    const tar = new Uint8Array(a.tar);
    const i = new TextDecoder('latin1').decode(tar).indexOf('x = 1');
    tar[i] = 'y'.charCodeAt(0);
    await expect(readArchive(tar)).rejects.toThrow(/mismatch/);
  });
});

describe('slugify', () => {
  it('slugify', () => {
    expect(slugify('Valid coupon reduces the total')).toBe('valid-coupon-reduces-the-total');
    expect(slugify('v1.2.0 regression')).toBe('v1-2-0-regression');
    expect(slugify('Ünïcödé — and a very long title that goes on and on')).toBe(
      'unicode-and-a-very-long-title-that-goes',
    );
    expect(slugify('期限切れ')).toBe('untitled');
  });
});

const NOW = new Date('2026-11-19T05:00:00Z');
type Create = Parameters<typeof createDefinition>[2];

/** createDefinition over the bundle as the files stand now, at NOW (callers reload between writes). */
const create = async (fs: ReturnType<typeof memFs>, input: Omit<Create, 'now'>) =>
  createDefinition(fs, (await loadBundle(fs)).bundle!, { ...input, now: NOW });

/** UC-6 under FEAT-3, ready, with one criterion. */
const resetUseCase = (fs: ReturnType<typeof memFs>) =>
  create(fs, {
    kind: 'use-case',
    parent: 'FEAT-3',
    fields: { title: 'Customer resets the password', criteria: ['A reset email is sent'] },
    ready: true,
  });

describe('write', () => {
  it('creates use cases, criteria and test cases that pass check', async () => {
    const fs = memFs();
    const uc = await resetUseCase(fs);
    expect(parseToml(fs.text(uc.file)!).priority).toBe('P1'); // gated by default
    expect(uc).toMatchObject({
      key: 'UC-6',
      file: 'specs/FEAT-3-account/UC-6-customer-resets-the-password/use-case.toml',
    });
    const ai = { origin: 'ai', ai: { model: 'm' } } as const;
    const ac = await create(fs, {
      kind: 'criterion',
      parent: 'UC-6',
      fields: { text: 'The link expires after an hour' },
      ...ai,
    });
    expect(ac.key).toBe('AC-6.2');
    const tc = await create(fs, {
      kind: 'test-case',
      parent: 'UC-6',
      fields: { title: 'Reset mail' },
      origin: 'ai',
      ai: { model: 'claude-opus-5-5', skill: 'write-test-cases' },
      knownKeys: ['TC-12'],
    });
    expect(tc).toMatchObject({
      key: 'TC-13',
      file: 'specs/FEAT-3-account/UC-6-customer-resets-the-password/TC-13-reset-mail.toml',
    });
    expect(parseToml(fs.text(tc.file)!)).toMatchObject({
      status: 'draft',
      origin: 'ai',
      covers: ['AC-6.1', 'AC-6.2'],
      ai: { model: 'claude-opus-5-5', created_at: '2026-11-19T05:00:00Z' },
    });
    const steps = [{ instruction: 'a', expected: 'b' }];
    await create(fs, {
      kind: 'test-case',
      parent: 'UC-6',
      template: 'web',
      fields: { title: 'From template', steps },
      ready: true,
    });
    // an AI use case's criteria are drafts with their own [ai] table, like `iw new ac`
    const fields = { title: 'Customer changes the email', criteria: ['A confirmation is sent'] };
    const aiUc = await create(fs, { kind: 'use-case', fields, ...ai });
    expect(parseToml(fs.text(aiUc.file)!).criteria).toEqual([
      expect.objectContaining({
        status: 'draft',
        origin: 'ai',
        ai: { model: 'm', created_at: expect.any(String) },
      }),
    ]);
    const r = await checkBundle(fs);
    expect(r.problems.filter((p) => p.severity === 'error')).toEqual([]);
  });
});

describe('write refusals', () => {
  it('refuses a ready AI test case and an unknown mode', async () => {
    const fs = memFs();
    await resetUseCase(fs);
    const { bundle } = await loadBundle(fs);
    const tc = { kind: 'test-case', parent: 'UC-6' } as const;
    const ready = { ...tc, fields: { title: 'x' }, origin: 'ai', ai: { model: 'm' }, ready: true } as const;
    await expect(createDefinition(fs, bundle!, ready)).rejects.toThrow(/draft/);
    const robot = { ...tc, fields: { title: 'x', mode: 'robot' } };
    await expect(createDefinition(fs, bundle!, robot)).rejects.toThrow(/Invalid/);
  });
});

describe('node helpers', () => {
  it('finds the bundle by walking up and honors IW_DIR', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'iw-'));
    mkdirSync(join(tmp, '.indx-watch'));
    mkdirSync(join(tmp, 'a', 'b'), { recursive: true });
    expect(findBundleDir(join(tmp, 'a', 'b'), {})).toBe(join(tmp, '.indx-watch'));
    expect(findBundleDir(tmp, { IW_DIR: SHOP })).toBe(SHOP);
    expect(findBundleDir(tmp, { IW_DIR: join(tmp, 'missing') })).toBeNull();
    const fs = nodeFs(tmp);
    await fs.write('x/y.txt', 'hi');
    expect(dec.decode((await fs.read('x/y.txt'))!)).toBe('hi');
    expect(await fs.list('x')).toEqual([{ name: 'y.txt', dir: false }]);
    expect(await fs.read('nope')).toBeNull();
    await fs.remove('x');
    expect(await fs.list('x')).toEqual([]);
  });

  it('nodeFs stays inside its root: no "..", no symbolic links out', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'iw-'));
    const root = join(tmp, 'bundle');
    mkdirSync(join(root, 'fixtures', 'FX-1'), { recursive: true });
    writeFileSync(join(tmp, 'netrc'), 'machine api login deploy password x');
    symlinkSync(join(tmp, 'netrc'), join(root, 'fixtures', 'FX-1', 'coupons.csv'));
    symlinkSync(tmp, join(root, 'fixtures', 'FX-2'));
    writeFileSync(join(root, 'project.toml'), 'ok');
    const fs = nodeFs(root);
    expect(await fs.list('fixtures/FX-1')).toEqual([]);
    expect(await fs.list('fixtures')).toEqual([{ name: 'FX-1', dir: true }]);
    await expect(fs.read('fixtures/FX-1/coupons.csv')).rejects.toThrow(/outside the bundle/);
    await expect(fs.read('fixtures/FX-2/netrc')).rejects.toThrow(/outside the bundle/);
    await expect(fs.read('../netrc')).rejects.toThrow(/outside the bundle/);
    await expect(fs.write('../../escaped.txt', 'x')).rejects.toThrow(/outside the bundle/);
    await expect(fs.write('fixtures/FX-1/coupons.csv', 'x')).rejects.toThrow(/symbolic link/);
    await expect(fs.write('fixtures/FX-2/new.txt', 'x')).rejects.toThrow(/outside the bundle/);
    expect(readFileSync(join(tmp, 'netrc'), 'utf8')).toContain('deploy');
    expect(dec.decode((await fs.read('project.toml'))!)).toBe('ok');
  });
});
