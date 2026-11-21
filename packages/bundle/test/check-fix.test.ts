import { describe, expect, it } from 'vitest';
import { type CheckDeps, checkBundle } from '../src/check.js';
import { parseToml } from '../src/toml.js';
import { codes, edit, TC3, UC2 } from './check-helpers.js';
import { memFs } from './helpers.js';

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
      knownKeys: ['TC-11'],
      repo: { read: async (p) => repo.get(p) ?? null, write: async (p, t) => void repo.set(p, t) },
    };
    const r = await checkBundle(fs, deps);
    expect(r.renumbered).toEqual([{ from: 'TC-3', to: 'TC-12', id: 'tc_01JF3Q8M5X2V7K9D4R6T1W0Y3Z' }]);
    expect(r.errors).toBe(0);
    const moved = 'specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-12-other-coupon.toml';
    expect(parseToml(fs.text(moved)!).key).toBe('TC-12');
    expect(fs.files.has('specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-3-other-coupon.toml')).toBe(
      false,
    );
    expect(repo.get('examples/shop/tests/coupon.spec.ts')).toBe("test('x @TC-12', () => {}); // @TC-30");
  });

  it('prefers renumbering the item absent from the default branch', async () => {
    const fs = memFs();
    copyTc(fs, 'tc_01JF3Q8M5X2V7K9D4R6T1W0Y30');
    const r = await checkBundle(fs, {
      fix: true,
      onDefaultBranch: async (id) => id.endsWith('Y33'),
    } as CheckDeps);
    expect(r.renumbered).toEqual([{ from: 'TC-3', to: 'TC-11', id: 'tc_01JF3Q8M5X2V7K9D4R6T1W0Y30' }]);
  });
  it('renumbers a use case with its criteria, covers and directory', async () => {
    const fs = memFs();
    const src = 'specs/FEAT-3-account/UC-5-customer-adds-review-photo';
    const dst = 'specs/FEAT-3-account/UC-5-customer-edits-review';
    const ids = (t: string) =>
      t.replace(/0Y26"/, '0Y2Z"').replace(/0YA9"/, '0YAZ"').replace(/0Y39"/, '0Y3X"');
    fs.files.set(`${dst}/use-case.toml`, new TextEncoder().encode(ids(fs.text(`${src}/use-case.toml`)!)));
    const tc = fs.text(`${src}/TC-9-upload-review-photo.toml`)!.replace('key = "TC-9"', 'key = "TC-11"');
    fs.files.set(`${dst}/TC-11-edit.toml`, new TextEncoder().encode(ids(tc)));
    fs.files.set(`${dst}/README.md`, new TextEncoder().encode('notes'));
    const before = await checkBundle(fs);
    expect(codes(before)).toEqual(['duplicate-key', 'duplicate-key']);
    const r = await checkBundle(fs, { fix: true });
    expect(r.renumbered.map((x) => `${x.from}>${x.to}`)).toEqual(['UC-5>UC-6', 'AC-5.1>AC-6.1']);
    expect(r.errors).toBe(0);
    const moved = 'specs/FEAT-3-account/UC-6-customer-edits-review';
    expect(parseToml(fs.text(`${moved}/TC-11-edit.toml`)!).covers).toEqual(['AC-6.1']);
    expect(fs.text(`${moved}/README.md`)).toBe('notes');
    expect([...fs.files.keys()].some((k) => k.startsWith(`${dst}/`))).toBe(false);
  });
});

describe('check --fix renumbers criteria', () => {
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
    const branchTc = 'specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-11-branch.toml';
    fs.files.set(
      branchTc,
      new TextEncoder().encode(
        fs
          .text(TC3)!
          .replace('tc_01JF3Q8M5X2V7K9D4R6T1W0Y33', 'tc_01JF3Q8M5X2V7K9D4R6T1W0Z98')
          .replace('key = "TC-3"', 'key = "TC-11"'),
      ),
    );
    const onDefaultBranch = async (id: string) => !id.includes('0Z9');
    const r = await checkBundle(fs, { fix: true, onDefaultBranch } as CheckDeps);
    expect(r.renumbered).toEqual([{ from: 'AC-2.1', to: 'AC-2.3', id: branchAc }]);
    expect(r.errors).toBe(0);
    expect(parseToml(fs.text(TC3)!).covers).toEqual(['AC-2.1']);
    expect(parseToml(fs.text(branchTc)!).covers).toEqual(['AC-2.3']);
  });
});
