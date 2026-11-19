import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { query, reportPath, safeName } from '../src/api';
import { parseRoute } from '../src/router';
import { needsReason, suggestVerdict } from '../src/screens/Runner';
import { placeholderValues } from '../src/screens/TestCase';

describe('design tokens', () => {
  it('the web UI and docs/design use the same tokens and component styles', () => {
    const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
    expect(read('packages/web/src/tokens.css')).toBe(read('docs/design/tokens.css'));
    expect(read('packages/web/src/app.css')).toBe(read('docs/design/app.css'));
  });
});

describe('parseRoute()', () => {
  it('parses every screen', () => {
    expect(parseRoute('')).toEqual({ name: 'dashboard' });
    expect(parseRoute('#/')).toEqual({ name: 'dashboard' });
    expect(parseRoute('#/specs')).toEqual({ name: 'specs' });
    expect(parseRoute('#/tc/TC-4')).toEqual({ name: 'testCase', key: 'TC-4' });
    expect(parseRoute('#/tc/TC-4/run/')).toEqual({ name: 'runner', key: 'TC-4' });
    expect(parseRoute('#/runs/run_01JFB2Q8M5X2V7K9D4R6T1W004')).toEqual({
      name: 'run',
      id: 'run_01JFB2Q8M5X2V7K9D4R6T1W004',
    });
    expect(parseRoute('#/fixtures')).toEqual({ name: 'fixtures', key: undefined });
    expect(parseRoute('#/fixtures/FX-1?x=1')).toEqual({ name: 'fixtures', key: 'FX-1' });
    expect(parseRoute('#/report')).toEqual({ name: 'report' });
  });
  it('reports unknown paths', () => {
    expect(parseRoute('#/tc/UC-2')).toEqual({ name: 'notFound', path: '/tc/UC-2' });
  });
});

describe('api helpers', () => {
  it('builds query strings from defined values only', () => {
    expect(query({ release: 'v1.2.0', env: undefined, tc: '' })).toBe('?release=v1.2.0');
    expect(query({})).toBe('');
  });
  it('builds the report URL', () => {
    expect(
      reportPath({
        release: 'v1.2.0',
        env: 'staging',
        plan: 'PLAN-1',
        format: 'html',
        audience: 'customer',
        locale: 'ja',
      }),
    ).toBe('api/report?release=v1.2.0&env=staging&plan=PLAN-1&format=html&audience=customer&locale=ja');
  });
  it('makes ASCII-only file names for the X-Filename header', () => {
    expect(safeName('step-1.png')).toBe('step-1.png');
    expect(safeName('スクリーンショット 2026-11-19.png')).toBe('_2026-11-19.png');
    expect(safeName('')).toBe('file');
  });
});

describe('manual runner', () => {
  it('suggests a verdict from the step results', () => {
    expect(suggestVerdict(['pass', 'pass'])).toBe('pass');
    expect(suggestVerdict(['pass', undefined])).toBeUndefined();
    expect(suggestVerdict(['pass', 'fail', undefined])).toBe('fail');
    expect(suggestVerdict(['blocked', undefined])).toBe('blocked');
    expect(suggestVerdict(['skipped', 'pass'])).toBe('pass');
    expect(suggestVerdict(['skipped'])).toBe('skipped');
  });
  it('requires a reason for every verdict except pass', () => {
    expect(needsReason('pass')).toBe(false);
    expect(needsReason(undefined)).toBe(false);
    for (const v of ['fail', 'blocked', 'skipped'] as const) expect(needsReason(v)).toBe(true);
  });
  it('fills fixture placeholders from the first selected row', () => {
    const values = placeholderValues([
      {
        key: 'FX-1',
        title: 'Coupon codes',
        kind: 'dataset',
        version: 'fxv:91be03d2a401',
        rows: ['OLD5'],
        values: [{ code: 'OLD5', discount: '0.05' }],
      },
      { key: 'FX-2', title: 'Catalog with three products', kind: 'seed', version: 'fxv:91be03d2a402' },
    ]);
    expect(values).toEqual({ 'FX-1.code': 'OLD5', 'FX-1.discount': '0.05' });
  });
});
