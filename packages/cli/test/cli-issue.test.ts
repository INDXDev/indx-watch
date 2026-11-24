/** `iw issue` and `iw import github-issue` (docs/spec/cli.md): prefilled URLs, links back, one draft use case per issue. */
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseToml } from '@indx-watch/bundle';
import { describe, expect, it } from 'vitest';
import { parseIssue } from '../src/commands/import-issue.js';
import { githubTemplates } from '../src/github.js';
import { AGENT, read, TC3 } from './cli-fixtures.js';
import { iw, iwJson, shop } from './helpers.js';

/** the shop with a GitHub repository and one failed run of TC-3 */
function withFailure() {
  const dir = shop();
  appendFileSync(join(dir, '.indx-watch/project.toml'), '\n[github]\nrepo = "shop-co/shop"\n');
  const r = iw(dir, [
    ...[
      'record',
      'TC-3',
      '--verdict',
      'fail',
      '--step',
      '1=fail:The total stayed 40.00',
      '--commit',
      '3f2a9c1',
    ],
    ...['--note', 'Coupon SUMMER10 was accepted but ignored'],
  ]);
  expect(r.code, r.stderr).toBe(0);
  return dir;
}
const param = (url: string, k: string) => new URL(url).searchParams.get(k);

describe('iw issue', () => {
  it('builds the prefilled failure issue of a test case from its latest run, without secrets', () => {
    const dir = withFailure();
    const r = iwJson(dir, 'issue', ['issue', 'TC-3']);
    expect(r.code, r.stderr).toBe(0);
    const { url, keys, repo } = r.json.data;
    expect(repo).toBe('shop-co/shop');
    expect(keys).toEqual(['TC-3']);
    expect(url).toMatch(
      /^https:\/\/github\.com\/shop-co\/shop\/issues\/new\?template=indx-watch-test-failure\.yml/,
    );
    expect(param(url, 'title')).toBe('TC-3: Valid coupon reduces the total');
    expect(param(url, 'actual')).toContain('The total stayed 40.00');
    expect(param(url, 'expected')).toContain('-4.00');
    expect(param(url, 'commit')).toBe('3f2a9c1');
    expect(url.length).toBeLessThan(6000);
  });

  it('accepts a run ID, UC and AC refs; keeps the account fixture out', () => {
    const dir = withFailure();
    const run = iwJson(dir, 'issue', ['issue', 'TC-3']).json.data.run as string;
    expect(run).toMatch(/^run_/);
    expect(iwJson(dir, 'issue', ['issue', run]).json.data.keys).toEqual(['TC-3']);
    expect(iwJson(dir, 'issue', ['issue', 'AC-2.1']).json.data.keys).toContain('TC-3');
    expect(iwJson(dir, 'issue', ['issue', 'UC-2']).code).toBe(0);
    const url = iwJson(dir, 'issue', ['issue', 'TC-3']).json.data.url as string;
    expect(url).not.toContain('qa-shopper'); // FX-3 (account) is not referenced here; usernames never leave
  });

  it('says how to set the repository when there is none', () => {
    const dir = shop();
    const r = iwJson(dir, 'issue', ['issue', 'TC-3']);
    expect(r.code).toBe(3);
    expect(r.json.error.message).toContain('[github] repo');
  });

  it('--link stores the issue URL on the test case, once, and a bad URL is a usage error', () => {
    const dir = withFailure();
    const url = 'https://github.com/shop-co/shop/issues/42';
    const first = iwJson(dir, 'issue', ['issue', 'TC-3', '--link', url]);
    expect(first.code, first.stderr).toBe(0);
    expect(first.json.data.link).toMatchObject({ key: 'TC-3', added: true, links: [url] });
    expect(parseToml(read(dir, TC3)).links).toEqual([url]);
    expect(iwJson(dir, 'issue', ['issue', 'TC-3', '--link', url]).json.data.link.added).toBe(false);
    expect(iw(dir, ['issue', 'TC-3', '--link', 'javascript:alert(1)']).code).toBe(2);
    expect(iwJson(dir, 'check', ['check']).json.data.errors).toBe(0);
  });

  it('refuses --open for an agent', () => {
    const dir = withFailure();
    const r = iw(dir, ['issue', 'TC-3', '--open'], { env: AGENT });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Agents cannot open pages');
  });
});

const ISSUE = {
  title: 'Gift cards at checkout',
  url: 'https://github.com/shop-co/shop/issues/42',
  labels: [{ name: 'Checkout' }],
  body: '## Goal\n- [ ] A gift card pays part of the total\n- [x] The balance is shown\nNot a task',
};

describe('iw import github-issue', () => {
  it('turns a gh issue view file into one draft use case with task-list criteria and the link; re-import changes nothing', () => {
    const dir = withFailure();
    const file = join(dir, 'issue.json');
    writeFileSync(file, JSON.stringify(ISSUE));
    const args = ['import', 'github-issue', '42', '--from', file, '--feature', 'FEAT-2'];
    const r = iwJson(dir, 'import', args);
    expect(r.code, r.stderr).toBe(0);
    const { created } = r.json.data;
    expect(r.json.data).toMatchObject({ issue: ISSUE.url, existing: null, criteria: 2 });
    const uc = parseToml(read(dir, created.file)) as Record<string, any>;
    expect(uc).toMatchObject({ title: ISSUE.title, status: 'draft', origin: 'import', links: [ISSUE.url] });
    expect(uc.criteria.map((c: any) => [c.text, c.status, c.origin])).toEqual([
      ['A gift card pays part of the total', 'draft', 'import'],
      ['The balance is shown', 'draft', 'import'],
    ]);
    expect(iwJson(dir, 'check', ['check']).json.data.errors).toBe(0);
    const again = iwJson(dir, 'import', args);
    expect(again.json.data).toMatchObject({ created: null, existing: created.key });
  });

  it('fails clearly without a task list or a feature', () => {
    const dir = withFailure();
    const file = join(dir, 'issue.json');
    writeFileSync(file, JSON.stringify({ ...ISSUE, labels: ['checkout'] }));
    expect(iw(dir, ['import', 'github-issue', '42', '--from', file, '--feature', 'Nope']).code).toBe(2);
    writeFileSync(file, JSON.stringify({ ...ISSUE, body: 'Please test gift cards.' }));
    const r = iw(dir, ['import', 'github-issue', '42', '--from', file, '--feature', 'FEAT-2']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('/iw-design');
  });
});

describe('parseIssue and githubTemplates', () => {
  it('reads the test request form by its labels', () => {
    const body =
      '### Actor\n\nshopper\n\n### Goal\n\nPay with a gift card\n\n### Priority\n\nP1\n\n### Acceptance criteria\n\n- [ ] Card accepted\n- [ ] Balance shown';
    expect(parseIssue({ number: 1, title: 't', body, labels: [], url: 'u' })).toEqual({
      ...{ actor: 'shopper', goal: 'Pay with a gift card', priority: 'P1' },
      criteria: ['Card accepted', 'Balance shown'],
    });
  });
  it('writes both issue forms with the fixed field ids', () => {
    const [request, failure] = githubTemplates();
    expect(request!.path).toBe('.github/ISSUE_TEMPLATE/indx-watch-test-request.yml');
    expect(failure!.path).toBe('.github/ISSUE_TEMPLATE/indx-watch-test-failure.yml');
    const ids = (c: string) => [...c.matchAll(/^ {4}id: (\w+)$/gm)].map((m) => m[1]);
    expect(ids(request!.content)).toEqual(['actor', 'goal', 'priority', 'criteria']);
    expect(ids(failure!.content)).toEqual([
      'keys',
      'steps',
      'expected',
      'actual',
      'run',
      'commit',
      'environment',
    ]);
  });
});
