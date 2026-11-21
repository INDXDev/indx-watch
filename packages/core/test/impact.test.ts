// impactedTestCases and globMatch over examples/shop (docs/spec/concepts.md#impact-analysis).
import { beforeAll, describe, expect, it } from 'vitest';
import { buildModel, globMatch, impactedTestCases, type Model } from '../src/index.js';
import { shop } from './fixtures.js';

const P = 'examples/shop/.indx-watch/';
let m: Model;
beforeAll(async () => {
  m = buildModel(await shop(), []).model;
});
const keys = (changed: string[], prefix = P) => impactedTestCases(m, changed, prefix).map((s) => s.key);

describe('globMatch', () => {
  it('matches paths, * and ? within a segment, ** across segments and folders', () => {
    expect(globMatch('tests/a.spec.ts', 'tests/a.spec.ts')).toBe(true);
    expect(globMatch('tests/a.spec.ts', 'tests/aXspec.ts')).toBe(false); // . is literal
    expect(globMatch('tests/*.spec.ts', 'tests/a.spec.ts')).toBe(true);
    expect(globMatch('tests/*.spec.ts', 'tests/x/a.spec.ts')).toBe(false);
    expect(globMatch('tests/?.ts', 'tests/a.ts')).toBe(true);
    expect(globMatch('tests/**/*.ts', 'tests/a.ts')).toBe(true);
    expect(globMatch('tests/**/*.ts', 'tests/x/y/a.ts')).toBe(true);
    expect(globMatch('tests/', 'tests/x/a.ts')).toBe(true);
    expect(globMatch('tests/', 'other/tests/a.ts')).toBe(false);
  });
});

describe('impactedTestCases', () => {
  it('suggests the test cases whose [automation].files match, with the reason', () => {
    const s = impactedTestCases(m, ['examples/shop/tests/coupon.spec.ts'], P);
    expect(s.map((x) => x.key)).toEqual(['TC-3', 'TC-4']);
    expect(s[0]).toMatchObject({
      status: 'ready',
      reasons: [
        {
          kind: 'automation',
          file: 'examples/shop/tests/coupon.spec.ts',
          pattern: 'examples/shop/tests/coupon.spec.ts',
        },
      ],
    });
  });

  it('suggests a test case for its own file, its use case file and the fixtures it references', () => {
    expect(keys([`${P}specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-3-valid-coupon.toml`])).toEqual([
      'TC-3',
    ]);
    expect(keys([`${P}specs/FEAT-2-checkout/UC-2-guest-applies-coupon/use-case.toml`])).toEqual([
      'TC-3',
      'TC-4',
    ]);
    const fx = impactedTestCases(m, [`${P}fixtures/FX-1-coupons/coupons.csv`], P);
    expect(fx.map((x) => x.key)).toEqual(['TC-3', 'TC-4']);
    expect(fx[0]!.reasons).toEqual([{ kind: 'fixture', file: `${P}fixtures/FX-1-coupons/coupons.csv` }]);
    // without the bundle prefix the same bundle path is not the test case's file
    expect(keys([`${P}specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-3-valid-coupon.toml`], '')).toEqual(
      [],
    );
  });

  it('suggests nothing for unrelated paths and orders by priority, then key', () => {
    expect(keys(['README.md', 'examples/shop/tests/other.spec.ts'])).toEqual([]);
    const s = impactedTestCases(
      m,
      ['examples/shop/tests/catalog.spec.ts', 'examples/shop/tests/coupon.spec.ts'],
      P,
    );
    const order = s.map((x) => [x.priority, x.key].join(' '));
    expect(order).toEqual([...order].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })));
    expect(s.map((x) => x.key).sort()).toEqual(['TC-1', 'TC-2', 'TC-3', 'TC-4']);
  });
});
