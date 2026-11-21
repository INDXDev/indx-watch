/** `iw impact`: suggested test cases from changed files (docs/spec/cli.md#iw-impact). */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { iw, iwJson, shop } from './helpers.js';

const COUPON = 'examples/shop/tests/coupon.spec.ts';
const keys = (r: { json: { data: { testCases: { key: string }[] } } }) =>
  r.json.data.testCases.map((t) => t.key);

describe('iw impact', () => {
  it('suggests TC-3 and TC-4 for the coupon spec; the human output is the PR comment section', () => {
    const dir = shop();
    const r = iwJson(dir, 'impact', ['impact', '--changed', `${COUPON},README.md`]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.json.data).toMatchObject({ base: null, changed: [COUPON, 'README.md'] });
    expect(keys(r)).toEqual(['TC-3', 'TC-4']);
    expect(r.json.data.testCases[0].reasons).toEqual([{ kind: 'automation', file: COUPON, pattern: COUPON }]);
    const text = iw(dir, ['impact', '--changed', COUPON]).stdout;
    expect(text).toContain('### Suggested test cases');
    expect(text).toContain(`- **TC-3** Valid coupon reduces the total (P0, ready): automation \`${COUPON}\``);
    expect(iw(dir, ['impact', '--changed', 'README.md']).stdout).toContain(
      'No test case is linked to the 1 changed file.',
    );
  });

  it('reads paths from stdin with --changed -; needs --changed or --base', () => {
    const dir = shop();
    const r = iwJson(dir, 'impact', ['impact', '--changed', '-'], {
      input: '.indx-watch/fixtures/FX-1-coupons/coupons.csv\n\n',
    });
    expect(keys(r)).toEqual(['TC-3', 'TC-4']);
    expect(r.json.data.testCases[0].reasons[0].kind).toBe('fixture');
    expect(iw(dir, ['impact']).code).toBe(2);
  });

  it('--base <ref> uses git diff from the repository root; a bad ref exits 4', () => {
    const dir = shop();
    const g = (...a: string[]) =>
      execFileSync('git', ['-c', 'user.email=qa@shop.test', '-c', 'user.name=qa', ...a], { cwd: dir });
    g('init', '-q');
    g('add', '.');
    g('commit', '-qm', 'shop');
    appendFileSync(join(dir, '.indx-watch/specs/FEAT-3-account/UC-4-customer-signs-in/use-case.toml'), '\n');
    appendFileSync(join(dir, '日本.ts'), '\n'); // non-ASCII paths come through unquoted
    g('add', '.');
    g('commit', '-qm', 'touch UC-4');
    const r = iwJson(dir, 'impact', ['impact', '--base', 'HEAD~1']);
    expect(r.json.data.base).toBe('HEAD~1');
    expect(r.json.data.changed).toContain('日本.ts');
    expect(keys(r)).toEqual(['TC-7', 'TC-8']);
    expect(r.json.data.testCases[0].reasons[0].kind).toBe('definition');
    expect(iw(dir, ['impact', '--base', 'no-such-ref']).code).toBe(4);
  });
});
