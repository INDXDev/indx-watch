import { describe, expect, it } from 'vitest';
import { ISSUE_URL_MAX, issueUrl, parseIssueUrl, repoOfRemote } from '../src/index.js';

const base = {
  repo: 'shop-co/shop',
  title: 'TC-3 fails: total does not drop',
  keys: ['TC-3', 'AC-2.1'],
  priority: 'P1',
  steps: '1. Open the cart\n2. Apply SAVE10',
  expected: 'Total drops by 10%',
  actual: 'Total unchanged',
  run: 'https://watch.shop.test/#/runs/run_01JF7Z3K0W8N2Q4R6S8T0V2X4Y',
  commit: '3f2a9c1',
  environment: 'staging',
};
const param = (url: string, k: string) => new URL(url).searchParams.get(k);

describe('issueUrl', () => {
  it('prefills the failure form by field id', () => {
    const r = issueUrl(base);
    expect(r.url.startsWith('https://github.com/shop-co/shop/issues/new?')).toBe(true);
    expect(param(r.url, 'template')).toBe('indx-watch-test-failure.yml');
    expect(param(r.url, 'keys')).toBe('TC-3, AC-2.1, P1');
    expect(param(r.url, 'steps')).toBe(base.steps);
    expect(param(r.url, 'run')).toBe(base.run);
    expect(r.trimmed).toEqual([]);
    expect(r.secrets).toEqual([]);
  });
  it('stays under the length limit and keeps the essentials', () => {
    const r = issueUrl({ ...base, actual: 'x y '.repeat(5000), steps: 'step '.repeat(3000) });
    expect(r.url.length).toBeLessThanOrEqual(ISSUE_URL_MAX);
    expect(r.trimmed).toContain('actual');
    expect(param(r.url, 'run')).toBe(base.run);
    expect(param(r.url, 'commit')).toBe('3f2a9c1');
  });
  it('drops fields that look like secrets and removes redacted values', () => {
    const r = issueUrl({
      ...base,
      actual: 'api_key = AKIAIOSFODNN7EXAMPLE1234',
      steps: 'Log in as qa-shopper@shop.test',
      redact: ['qa-shopper@shop.test'],
    });
    expect(r.secrets).toEqual(['actual']);
    expect(param(r.url, 'actual')).toBeNull();
    expect(param(r.url, 'steps')).toBe('Log in as [redacted]');
    expect(r.url).not.toContain('AKIA');
  });
});

describe('repoOfRemote and parseIssueUrl', () => {
  it('reads GitHub remotes', () => {
    expect(repoOfRemote('git@github.com:INDXDev/indx-watch.git')).toBe('INDXDev/indx-watch');
    expect(repoOfRemote('https://github.com/INDXDev/indx-watch')).toBe('INDXDev/indx-watch');
    expect(repoOfRemote('https://gitlab.com/a/b.git')).toBeUndefined();
    expect(repoOfRemote(null)).toBeUndefined();
  });
  it('reads issue URLs', () => {
    expect(parseIssueUrl('https://github.com/o/n/issues/42')).toEqual({ repo: 'o/n', number: 42 });
    expect(parseIssueUrl('https://github.com/o/n/pull/42')).toBeUndefined();
  });
});
