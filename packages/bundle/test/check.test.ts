import { describe, expect, it } from 'vitest';
import { type CheckDeps, checkBundle } from '../src/check.js';
import { loadBundle } from '../src/load.js';
import { nodeFs } from '../src/node/index.js';
import { parseToml } from '../src/toml.js';
import { codes, edit, TC3, TC9 } from './check-helpers.js';
import { memFs, SHOP } from './helpers.js';

describe('check on examples/shop', () => {
  it('loads every entity', async () => {
    const { bundle, problems } = await loadBundle(nodeFs(SHOP));
    expect(problems).toEqual([]);
    expect(bundle?.testCases.map((t) => t.data.key).sort()).toEqual([
      'TC-1',
      'TC-10',
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

describe('check problems: keys and references', () => {
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
});

describe('check problems: AI-written test cases and criteria', () => {
  it('ai-ready-without-approval and approval of the current version', async () => {
    const fs = memFs();
    edit(fs, TC9, (t) => t.replace('status = "draft"', 'status = "ready"'));
    expect(codes(await checkBundle(fs))).toEqual(['ai-not-approved']);
    const { approveDefinition } = await import('../src/write.js');
    const { bundle } = await loadBundle(fs);
    const { version } = await approveDefinition(fs, bundle!, 'TC-9', 'alex@shop.test');
    expect(version).toMatch(/^tcv:/);
    expect(codes(await checkBundle(fs))).toEqual([]);
    // editing a step after approval invalidates it again
    edit(fs, TC9, (t) => t.replace('Post review', 'Publish review'));
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
    edit(fs, r.file, (t) => t.replace(/status = "draft"\norigin = "ai"/, 'status = "ready"\norigin = "ai"'));
    expect(codes(await checkBundle(fs))).toEqual(['ai-not-approved']);
    await approveDefinition(fs, await load(), r.key, 'alex@shop.test');
    const after = parseToml(fs.text(r.file)!) as { criteria: Record<string, unknown>[] };
    expect(after.criteria.at(-1)).toMatchObject({ status: 'ready', approved_by: 'alex@shop.test' });
    expect(codes(await checkBundle(fs))).toEqual([]);
  });
});

describe('check problems: AI-written features, environments, releases and plans', () => {
  it('AI-written features, environments, releases and plans warn until approved; [ai] is required', async () => {
    const fs = memFs();
    const { createDefinition, approveDefinition } = await import('../src/write.js');
    const load = async () => (await loadBundle(fs)).bundle!;
    const ai = { model: 'test' };
    const made = [];
    for (const [kind, title] of [
      ['feature', 'Wishlist'],
      ['environment', 'Preview'],
      ['release', 'v9.0.0'],
      ['plan', 'Agent plan'],
    ] as const) {
      // an approval in the input (`iw new --from`) is dropped: only `iw approve`, by a human, records one
      const fields = { title, approved_by: 'lead@shop.test' };
      made.push(await createDefinition(fs, await load(), { kind, fields, origin: 'ai', ai }));
    }
    for (const m of made) expect(parseToml(fs.text(m.file)!)).toMatchObject({ origin: 'ai', ai });
    for (const m of made) expect(parseToml(fs.text(m.file)!)).not.toHaveProperty('approved_by');
    const r = await checkBundle(fs);
    expect(codes(r)).toEqual([]);
    const warned = r.problems.filter((p) => p.code === 'ai-not-approved');
    expect(warned.map((p) => [p.severity, p.file])).toEqual(made.map((m) => ['warning', m.file]));
    for (const m of made) await approveDefinition(fs, await load(), m.key, 'alex@shop.test');
    expect(codes(await checkBundle(fs), 'warning')).not.toContain('ai-not-approved');
    // without the [ai] table the origin mark is an error
    const f = made[0]!.file;
    edit(fs, f, (t) => t.replace(/\[ai\][^[]*/, ''));
    expect(codes(await checkBundle(fs))).toEqual(['missing-ai-meta']);
  });
});

describe('check problems: translations and file format', () => {
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

  it('checks and fixture notes are translations too', async () => {
    const fs = memFs();
    edit(fs, TC3, (t) =>
      t
        .replace('"合計が「36.00」になる。"]', '"合計が下がる。"]')
        .replace('note = "Type this code in the coupon field in step 1."', 'note = "Type it."'),
    );
    const r = await checkBundle(fs);
    expect(r.problems.map((p) => [p.code, p.path])).toEqual([
      ['missing-literal', 'steps[0].i18n.ja'],
      ['stale-translation', 'fixtures[0].i18n.ja'],
    ]);
  });

  it('a translated checks list needs one item per source check', async () => {
    const fs = memFs();
    edit(fs, TC3, (t) => t.replace(', "合計が「36.00」になる。"]', ']'));
    const r = await checkBundle(fs);
    expect(r.problems.map((p) => [p.code, p.path])).toEqual([
      ['translation-length', 'steps[0].i18n.ja'],
      ['missing-literal', 'steps[0].i18n.ja'],
    ]);
  });

  it('a ready manual test case without purpose or start is a missing-guidance warning', async () => {
    const fs = memFs();
    const tc8 = 'specs/FEAT-3-account/UC-4-customer-signs-in/TC-8-wrong-password.toml';
    edit(fs, tc8, (t) => t.replace(/^start(_note)? = .*\n/gm, ''));
    edit(fs, TC9, (t) => t.replace(/^purpose = .*\n/m, '')); // a draft: no warning
    const r = await checkBundle(fs);
    expect(r.problems.filter((p) => p.code === 'missing-guidance').map((p) => [p.file, p.path])).toEqual([
      [tc8, 'start'],
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
