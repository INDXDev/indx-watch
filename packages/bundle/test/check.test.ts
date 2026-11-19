import { describe, expect, it } from 'vitest';
import { type CheckDeps, checkBundle, scanSecrets } from '../src/check.js';
import { loadBundle } from '../src/load.js';
import { nodeFs } from '../src/node/index.js';
import { parseToml } from '../src/toml.js';
import { memFs, SHOP } from './helpers.js';

const TC3 = 'specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-3-valid-coupon.toml';
const TC9 = 'specs/FEAT-3-account/UC-5-customer-adds-review-photo/TC-9-upload-review-photo.toml';
const codes = (r: { problems: { code: string; severity: string }[] }, sev = 'error') =>
  r.problems.filter((p) => p.severity === sev).map((p) => p.code);

describe('check on examples/shop', () => {
  it('loads every entity', async () => {
    const { bundle, problems } = await loadBundle(nodeFs(SHOP));
    expect(problems).toEqual([]);
    expect(bundle?.testCases.map((t) => t.data.key).sort()).toEqual([
      'TC-1',
      'TC-2',
      'TC-3',
      'TC-4',
      'TC-5',
      'TC-6',
      'TC-7',
      'TC-8',
      'TC-9',
    ]);
    expect(bundle?.fixtures.find((f) => f.data.key === 'FX-4')?.dataFiles[0]?.pointer?.size).toBe(8295);
    expect(bundle?.templates).toHaveLength(1);
  });

  it('reports no errors and no warnings', async () => {
    const r = await checkBundle(nodeFs(SHOP), { hasBlob: async () => true } as CheckDeps);
    expect(r.problems).toEqual([]);
    expect(r.files).toBeGreaterThan(20);
  });

  it('warns about pointer blobs that are not available', async () => {
    const r = await checkBundle(memFs(), { hasBlob: async () => false } as CheckDeps);
    expect(codes(r, 'warning')).toEqual(['missing-blob']);
  });
});

describe('check problems', () => {
  it('unknown key with a suggestion', async () => {
    const fs = memFs();
    fs.files.set(
      TC3,
      new TextEncoder().encode(
        fs.text(TC3)!.replace('expected = "The confirmation', 'expectd = "The confirmation'),
      ),
    );
    const r = await checkBundle(fs);
    const p = r.problems.find((x) => x.code === 'unknown-key');
    expect(p).toMatchObject({
      file: TC3,
      path: 'steps[1].expectd',
      message: 'Unknown key "expectd". Did you mean "expected"?',
    });
  });

  it('ai-ready-without-approval and approval of the current version', async () => {
    const fs = memFs();
    fs.files.set(
      TC9,
      new TextEncoder().encode(fs.text(TC9)!.replace('status = "draft"', 'status = "ready"')),
    );
    expect(codes(await checkBundle(fs))).toEqual(['ai-not-approved']);
    const { approveDefinition } = await import('../src/write.js');
    const { bundle } = await loadBundle(fs);
    const { version } = await approveDefinition(fs, bundle!, 'TC-9', 'alex@shop.test');
    expect(version).toMatch(/^tcv:/);
    expect(codes(await checkBundle(fs))).toEqual([]);
    // editing a step after approval invalidates it again
    fs.files.set(TC9, new TextEncoder().encode(fs.text(TC9)!.replace('Post review', 'Publish review')));
    expect(codes(await checkBundle(fs))).toEqual(['ai-not-approved']);
  });

  it('an AI-proposed criterion keeps its [ai] table and counts only once a human approves it', async () => {
    const fs = memFs();
    const { createDefinition, approveDefinition } = await import('../src/write.js');
    const load = async () => (await loadBundle(fs)).bundle!;
    const ai = { model: 'test', skill: 'write-test-cases' };
    const now = new Date('2026-11-19T04:00:00Z');
    const fields = { text: 'The photo can be removed.' };
    const r = await createDefinition(fs, await load(), {
      kind: 'criterion',
      parent: 'UC-5',
      fields,
      origin: 'ai',
      ai,
      now,
    });
    const uc = parseToml(fs.text(r.file)!) as { criteria: Record<string, unknown>[] };
    expect(uc.criteria.at(-1)).toMatchObject({
      status: 'draft',
      origin: 'ai',
      ai: { ...ai, created_at: '2026-11-19T04:00:00Z' },
    });
    expect(codes(await checkBundle(fs))).toEqual([]);
    // a hand edit to ready does not count
    fs.files.set(
      r.file,
      new TextEncoder().encode(
        fs.text(r.file)!.replace(/status = "draft"\norigin = "ai"/, 'status = "ready"\norigin = "ai"'),
      ),
    );
    expect(codes(await checkBundle(fs))).toEqual(['ai-not-approved']);
    await approveDefinition(fs, await load(), r.key, 'alex@shop.test');
    const after = parseToml(fs.text(r.file)!) as { criteria: Record<string, unknown>[] };
    expect(after.criteria.at(-1)).toMatchObject({ status: 'ready', approved_by: 'alex@shop.test' });
    expect(codes(await checkBundle(fs))).toEqual([]);
  });

  it('unresolved covers and fixture refs', async () => {
    const fs = memFs();
    fs.files.set(
      TC3,
      new TextEncoder().encode(
        fs
          .text(TC3)!
          .replace('covers = ["AC-2.1"]', 'covers = ["AC-2.9"]')
          .replace('ref = "FX-1"', 'ref = "FX-99"'),
      ),
    );
    const r = await checkBundle(fs);
    expect(r.problems.filter((p) => p.code === 'unresolved-ref').map((p) => p.path)).toEqual([
      'covers[0]',
      'fixtures[0].ref',
    ]);
  });

  it('priority lower than the covered use case', async () => {
    const fs = memFs();
    fs.files.set(
      TC3,
      new TextEncoder().encode(
        fs.text(TC3)!.replace('covers = ["AC-2.1"]', 'covers = ["AC-2.1"]\npriority = "P3"'),
      ),
    );
    expect(codes(await checkBundle(fs))).toContain('priority-too-low');
  });

  it('duplicate plan item for the same environment', async () => {
    const fs = memFs();
    const plan = 'plans/PLAN-1-v1-2-0-regression.toml';
    fs.files.set(plan, new TextEncoder().encode(`${fs.text(plan)}\n[[items]]\ntest_case = "TC-7"\n`));
    expect(codes(await checkBundle(fs))).toEqual(['duplicate-plan-item']);
  });

  it('secret in a fixture CSV', async () => {
    const fs = memFs();
    const csv = 'fixtures/FX-1-coupons/coupons.csv';
    fs.files.set(
      csv,
      new TextEncoder().encode(`${fs.text(csv)}AKIAIOSFODNN7EXAMPL3,0.1,2099-12-31,password = "hunter22"\n`),
    );
    const r = await checkBundle(fs);
    expect(r.problems.filter((p) => p.code === 'secret').map((p) => p.message)).toEqual([
      'Possible secret (AWS access key ID); use a reference such as env:NAME',
      'Possible secret (value of "password"); use a reference such as env:NAME',
    ]);
    expect(r.problems.some((p) => p.message.includes('hunter22'))).toBe(false);
  });

  it('secrets in files the format does not know are errors too (what a snapshot packs)', async () => {
    const fs = memFs();
    const key = ['-----BEGIN OPENSSH', 'PRIVATE KEY-----'].join(' ');
    fs.files.set('fixtures/FX-1-coupons/creds.env', new TextEncoder().encode('AWS=AKIAIOSFODNN7EXAMPL3\n'));
    fs.files.set('specs/notes.md', new TextEncoder().encode(`${key}\n`));
    const r = await checkBundle(fs);
    expect(r.problems.filter((p) => p.code === 'secret').map((p) => p.file)).toEqual([
      'fixtures/FX-1-coupons/creds.env',
      'specs/notes.md',
    ]);
  });

  it('finds multi-line, URL, unquoted and PGP secrets', () => {
    const hits = (t: string) => scanSecrets('a.toml', t).length;
    expect(hits("password = '''hunter22'''")).toBe(1);
    expect(hits('password = """hunter22"""')).toBe(1);
    expect(hits('base_url = "https://admin:S3cretPassw0rd@staging.shop.test"')).toBe(1);
    expect(hits('{"password": 12345678}')).toBe(1);
    expect(hits('machine api.internal login deploy password Hunter2Prod')).toBe(1);
    expect(hits('password: hunter22')).toBe(1);
    expect(hits(['-----BEGIN PGP PRIVATE', 'KEY BLOCK-----'].join(' '))).toBe(1);
    // plain prose, references and placeholders stay quiet
    expect(hits('instruction = "Enter a wrong password and press Sign in"')).toBe(0);
    expect(hits('instruction = "Type the password from FX-3.password"')).toBe(0);
    expect(hits('base_url = "https://casey:{{FX-3.password}}@staging.shop.test"')).toBe(0);
    expect(hits('password_ref = "env:SHOP_PASSWORD"')).toBe(0);
  });

  it('secret scan ignores references and placeholders', () => {
    expect(
      scanSecrets(
        'a.toml',
        'secret_ref = "env:SHOP_PASSWORD"\npassword = "{{FX-3.password}}"\nkey = "TC-3"\n',
      ),
    ).toEqual([]);
    expect(scanSecrets('a.csv', 'username,password\ncasey,hunter22\n')).toHaveLength(1);
  });

  it('stale translations and missing literals are warnings', async () => {
    const fs = memFs();
    const tc4 = 'specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-4-expired-coupon.toml';
    fs.files.set(
      tc4,
      new TextEncoder().encode(
        fs
          .text(tc4)!
          .replace('「Apply」を押す', 'ボタンを押す')
          .replace('stays \\"40.00\\"', 'stays \\"40.50\\"'),
      ),
    );
    const r = await checkBundle(fs);
    expect(codes(r)).toEqual([]);
    expect(r.problems.map((p) => [p.code, p.path])).toEqual([
      ['stale-translation', 'steps[0].i18n.ja'],
      ['missing-literal', 'steps[0].i18n.ja'],
      ['missing-literal', 'steps[0].i18n.ja'],
    ]);
  });

  it('non-canonical files and templates with a schema line', async () => {
    const fs = memFs();
    fs.files.set(
      'releases/v1.2.0.toml',
      new TextEncoder().encode(fs.text('releases/v1.2.0.toml')!.replace('title =', 'title  =')),
    );
    const t = 'templates/test-case.web.toml';
    fs.files.set(t, new TextEncoder().encode(`#:schema x\n\n${fs.text(t)}`));
    const r = await checkBundle(fs);
    expect(r.problems.map((p) => [p.code, p.file])).toEqual([
      ['non-canonical', 'releases/v1.2.0.toml'],
      ['non-canonical', t],
    ]);
    const fixed = await checkBundle(fs, { fix: true });
    expect(fixed.changed.sort()).toEqual(['releases/v1.2.0.toml', t]);
    expect(fixed.problems).toEqual([]);
  });

  it('unknown files are warnings, README.md is allowed', async () => {
    const fs = memFs();
    fs.files.set('specs/README.md', new Uint8Array());
    fs.files.set('specs/notes.txt', new Uint8Array());
    expect((await checkBundle(fs)).problems.map((p) => [p.code, p.file])).toEqual([
      ['unknown-file', 'specs/notes.txt'],
    ]);
  });

  it('rejects a newer schema_version', async () => {
    const fs = memFs();
    fs.files.set(
      'project.toml',
      new TextEncoder().encode(fs.text('project.toml')!.replace('schema_version = 1', 'schema_version = 2')),
    );
    const r = await loadBundle(fs);
    expect(r.bundle).toBeNull();
    expect(r.problems[0]?.code).toBe('unsupported-schema-version');
  });
});

describe('check --fix renumbers duplicate keys', () => {
  const copyTc = (fs: ReturnType<typeof memFs>, id: string) => {
    const dir = 'specs/FEAT-2-checkout/UC-2-guest-applies-coupon';
    const text = fs
      .text(TC3)!
      .replace('tc_01JF3Q8M5X2V7K9D4R6T1W0Y33', id)
      .replace('Valid coupon', 'Other coupon');
    fs.files.set(`${dir}/TC-3-other-coupon.toml`, new TextEncoder().encode(text));
  };

  it('renumbers the later ID and rewrites @TC tags through the injected reader', async () => {
    const fs = memFs();
    copyTc(fs, 'tc_01JF3Q8M5X2V7K9D4R6T1W0Y3Z');
    expect(codes(await checkBundle(fs))).toEqual(['duplicate-key']);
    const repo = new Map([['examples/shop/tests/coupon.spec.ts', "test('x @TC-3', () => {}); // @TC-30"]]);
    const deps: CheckDeps = {
      fix: true,
      knownKeys: ['TC-10'],
      repo: { read: async (p) => repo.get(p) ?? null, write: async (p, t) => void repo.set(p, t) },
    };
    const r = await checkBundle(fs, deps);
    expect(r.renumbered).toEqual([{ from: 'TC-3', to: 'TC-11', id: 'tc_01JF3Q8M5X2V7K9D4R6T1W0Y3Z' }]);
    expect(r.errors).toBe(0);
    const moved = 'specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-11-other-coupon.toml';
    expect(parseToml(fs.text(moved)!).key).toBe('TC-11');
    expect(fs.files.has('specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-3-other-coupon.toml')).toBe(
      false,
    );
    expect(repo.get('examples/shop/tests/coupon.spec.ts')).toBe("test('x @TC-11', () => {}); // @TC-30");
  });

  it('prefers renumbering the item absent from the default branch', async () => {
    const fs = memFs();
    copyTc(fs, 'tc_01JF3Q8M5X2V7K9D4R6T1W0Y30');
    const r = await checkBundle(fs, {
      fix: true,
      onDefaultBranch: async (id) => id.endsWith('Y33'),
    } as CheckDeps);
    expect(r.renumbered).toEqual([{ from: 'TC-3', to: 'TC-10', id: 'tc_01JF3Q8M5X2V7K9D4R6T1W0Y30' }]);
  });

  const UC2 = 'specs/FEAT-2-checkout/UC-2-guest-applies-coupon/use-case.toml';
  const edit = (fs: ReturnType<typeof memFs>, path: string, f: (t: string) => string) =>
    fs.files.set(path, new TextEncoder().encode(f(fs.text(path)!)));

  it('renumbers a criterion numbered for another use case and moves the covers that point at it', async () => {
    const fs = memFs();
    edit(fs, UC2, (t) => t.replace('key = "AC-2.1"', 'key = "AC-9.1"'));
    edit(fs, TC3, (t) => t.replace('covers = ["AC-2.1"]', 'covers = ["AC-9.1"]'));
    expect(codes(await checkBundle(fs))).toEqual(['invalid-key']);
    const r = await checkBundle(fs, { fix: true });
    expect(r.renumbered.map((x) => `${x.from}>${x.to}`)).toEqual(['AC-9.1>AC-2.3']);
    expect(r.errors).toBe(0);
    expect(parseToml(fs.text(TC3)!).covers).toEqual(['AC-2.3']);
  });

  it('a duplicate criterion key keeps the default-branch one; only branch test cases follow', async () => {
    const fs = memFs();
    const branchAc = 'ac_01JF3Q8M5X2V7K9D4R6T1W0Z99';
    const block = `[[criteria]]\nid = "${branchAc}"\nkey = "AC-2.1"\ntext = "Branch criterion."\n\n`;
    edit(fs, UC2, (t) => t.replace('[[criteria]]', `${block}[[criteria]]`));
    const branchTc = 'specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-10-branch.toml';
    fs.files.set(
      branchTc,
      new TextEncoder().encode(
        fs
          .text(TC3)!
          .replace('tc_01JF3Q8M5X2V7K9D4R6T1W0Y33', 'tc_01JF3Q8M5X2V7K9D4R6T1W0Z98')
          .replace('key = "TC-3"', 'key = "TC-10"'),
      ),
    );
    const onDefaultBranch = async (id: string) => !id.includes('0Z9');
    const r = await checkBundle(fs, { fix: true, onDefaultBranch } as CheckDeps);
    expect(r.renumbered).toEqual([{ from: 'AC-2.1', to: 'AC-2.3', id: branchAc }]);
    expect(r.errors).toBe(0);
    expect(parseToml(fs.text(TC3)!).covers).toEqual(['AC-2.1']);
    expect(parseToml(fs.text(branchTc)!).covers).toEqual(['AC-2.3']);
  });

  it('renumbers a use case with its criteria, covers and directory', async () => {
    const fs = memFs();
    const src = 'specs/FEAT-3-account/UC-5-customer-adds-review-photo';
    const dst = 'specs/FEAT-3-account/UC-5-customer-edits-review';
    const ids = (t: string) =>
      t.replace(/0Y26"/, '0Y2Z"').replace(/0YA9"/, '0YAZ"').replace(/0Y39"/, '0Y3X"');
    fs.files.set(`${dst}/use-case.toml`, new TextEncoder().encode(ids(fs.text(`${src}/use-case.toml`)!)));
    const tc = fs.text(`${src}/TC-9-upload-review-photo.toml`)!.replace('key = "TC-9"', 'key = "TC-10"');
    fs.files.set(`${dst}/TC-10-edit.toml`, new TextEncoder().encode(ids(tc)));
    fs.files.set(`${dst}/README.md`, new TextEncoder().encode('notes'));
    const before = await checkBundle(fs);
    expect(codes(before)).toEqual(['duplicate-key', 'duplicate-key']);
    const r = await checkBundle(fs, { fix: true });
    expect(r.renumbered.map((x) => `${x.from}>${x.to}`)).toEqual(['UC-5>UC-6', 'AC-5.1>AC-6.1']);
    expect(r.errors).toBe(0);
    const moved = 'specs/FEAT-3-account/UC-6-customer-edits-review';
    expect(parseToml(fs.text(`${moved}/TC-10-edit.toml`)!).covers).toEqual(['AC-6.1']);
    expect(fs.text(`${moved}/README.md`)).toBe('notes');
    expect([...fs.files.keys()].some((k) => k.startsWith(`${dst}/`))).toBe(false);
  });
});
