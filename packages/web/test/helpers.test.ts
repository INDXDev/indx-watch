import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SpecTree, TestCaseDetail } from '../src/api';
import { api, query, reportPath, safeName, setTransport } from '../src/api';
import { pick } from '../src/i18n';
import { href, parseRoute } from '../src/router';
import { placeholderValues, sentences, startUrl, stepsUsing } from '../src/screens/guide';
import { queue } from '../src/screens/Home';
import { ciLinks } from '../src/screens/Run';
import {
  asksNote,
  buildRunInput,
  needsReason,
  type StepState,
  stepDone,
  stepStatus,
  suggestVerdict,
  tickCheck,
} from '../src/screens/runner/model';
import { firstOpen } from '../src/screens/runner/useRun';
import { testOrder } from '../src/screens/Tests';
import { cliCommands, startMine } from '../src/shell';
import { avatarOf, neighbours } from '../src/ui';
import { plan } from '../src/upload';

describe('design tokens', () => {
  it('the web UI and docs/design use the same tokens and component styles', () => {
    const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
    expect(read('packages/web/src/tokens.css')).toBe(read('docs/design/tokens.css'));
    expect(read('packages/web/src/app.css')).toBe(read('docs/design/app.css'));
  });
});

describe('parseRoute()', () => {
  it('parses every screen and the query', () => {
    const q = {};
    expect(parseRoute('')).toEqual({ name: 'home', query: q });
    expect(parseRoute('#/')).toEqual({ name: 'home', query: q });
    expect(parseRoute('#/specs')).toEqual({ name: 'tests', query: q });
    expect(parseRoute('#/tests?f=open')).toEqual({ name: 'tests', query: { f: 'open' } });
    expect(parseRoute('#/tc/TC-4')).toEqual({ name: 'testCase', key: 'TC-4', query: q });
    expect(parseRoute('#/tc/TC-4/run/?session=TC-4,TC-6')).toEqual({
      name: 'runner',
      key: 'TC-4',
      query: { session: 'TC-4,TC-6' },
    });
    expect(parseRoute('#/runs/run_01JFB2Q8M5X2V7K9D4R6T1W004')).toEqual({
      name: 'run',
      id: 'run_01JFB2Q8M5X2V7K9D4R6T1W004',
      query: q,
    });
    expect(parseRoute('#/fixtures')).toEqual({ name: 'fixtures', key: undefined, query: q });
    expect(parseRoute('#/fixtures/FX-1?x=1')).toEqual({ name: 'fixtures', key: 'FX-1', query: { x: '1' } });
    expect(parseRoute('#/activity')).toEqual({ name: 'activity', query: q });
    expect(parseRoute('#/uploads')).toEqual({ name: 'uploads', query: q });
    expect(parseRoute('#/report')).toEqual({ name: 'report', query: q });
    expect(parseRoute('#/insights')).toEqual({ name: 'insights', query: q });
  });
  it('reports unknown paths', () => {
    expect(parseRoute('#/tc/UC-2')).toEqual({ name: 'notFound', path: '/tc/UC-2', query: {} });
  });
  it('builds links with a session and filters', () => {
    expect(href.runner('TC-6', ['TC-6', 'TC-8'])).toBe('#/tc/TC-6/run?session=TC-6%2CTC-8');
    expect(href.runner('TC-6', ['TC-6'])).toBe('#/tc/TC-6/run');
    expect(href.testCase('TC-3', { f: 'open' })).toBe('#/tc/TC-3?f=open');
  });
});

describe('List and Focus', () => {
  const tc = (key: string, status: string) => ({
    key,
    title: key,
    mode: 'manual',
    status,
    lifecycle: 'ready',
  });
  const tree = {
    scope: {},
    features: [
      {
        key: 'FEAT-1',
        title: 'f',
        useCases: [
          {
            key: 'UC-1',
            title: 'u',
            priority: 'P0',
            status: 'fail',
            done: false,
            criteria: [
              {
                key: 'AC-1.1',
                text: 'a',
                status: 'pass',
                testCases: [tc('TC-1', 'pass'), tc('TC-2', 'fail')],
              },
              {
                key: 'AC-1.2',
                text: 'b',
                status: 'fail',
                testCases: [tc('TC-2', 'fail'), tc('TC-3', 'untested')],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as SpecTree;
  it('orders test cases like the tree, each once; f=open keeps the open ones', () => {
    expect(testOrder(tree)).toEqual(['TC-1', 'TC-2', 'TC-3']);
    expect(testOrder(tree, 'open')).toEqual(['TC-2', 'TC-3']);
  });
  it('f=flaky orders flaky test cases by flake rate, highest first, then by key', () => {
    const flaky = (key: string, rate?: number) =>
      ({ ...tc(key, 'pass'), ...(rate ? { flaky: { rate } } : {}) }) as never;
    const t2 = structuredClone(tree);
    t2.features[0]!.useCases[0]!.criteria[0]!.testCases = [
      flaky('TC-10', 0.2),
      flaky('TC-1'),
      flaky('TC-9', 0.2),
    ];
    t2.features[0]!.useCases[0]!.criteria[1]!.testCases = [flaky('TC-9', 0.2), flaky('TC-3', 0.5)];
    expect(testOrder(t2, 'flaky')).toEqual(['TC-3', 'TC-9', 'TC-10']);
  });
  it('finds neighbours', () => {
    expect(neighbours(['a', 'b', 'c'], 'b')).toEqual({ index: 1, prev: 'a', next: 'c' });
    expect(neighbours(['a'], 'a')).toEqual({ index: 0, prev: undefined, next: undefined });
    expect(neighbours(['a'], 'x').index).toBe(-1);
  });
  it('queues your items first, then unassigned, by priority and status', () => {
    const status = {
      testCases: ['TC-1:pass', 'TC-2:fail', 'TC-3:untested', 'TC-4:untested', 'TC-5:needs_review'].map(
        (s) => {
          const [key, st] = s.split(':');
          return { key, status: st } as never;
        },
      ),
    };
    const prio = new Map([
      ['TC-2', 'P1'],
      ['TC-3', 'P0'],
      ['TC-4', 'P0'],
      ['TC-5', 'P0'],
    ]);
    const plan = {
      key: 'PLAN-1',
      title: 'p',
      items: [
        { test_case: 'TC-4', assignee: 'alex@shop.test' },
        { test_case: 'TC-5', assignee: 'sam@shop.test' },
      ],
    };
    expect(queue(status, prio, plan, 'alex@shop.test')).toEqual(['TC-4', 'TC-3', 'TC-2', 'TC-5']);
  });
});

describe('people, uploads and the CLI panel', () => {
  it('derives initials and a stable hue', () => {
    expect(avatarOf({ kind: 'human', id: 'alex@shop.test', name: 'Alex Kim', via: 'git' }).initials).toBe(
      'AK',
    );
    expect(avatarOf({ kind: 'human', id: 'sam@shop.test', via: 'browser' }).initials).toBe('SA');
    const a = avatarOf({ kind: 'ci', id: 'github:octocat', via: 'github' });
    expect(a).toEqual(avatarOf({ kind: 'ci', id: 'github:octocat', via: 'github' }));
  });
  it('treats a folder with project.toml as a whole bundle', () => {
    expect(plan(['.indx-watch/project.toml', '.indx-watch/specs/a.toml'])).toEqual({
      replace: true,
      root: '.indx-watch/',
    });
    expect(plan(['project.toml'])).toEqual({ replace: true, root: '' });
    expect(plan(['TC-3.toml'])).toEqual({ replace: false, root: '' });
  });
  it('shows clone with this server URL, and test commands on a test case', () => {
    const info = { share: { clone: 'https://watch.shop.test' } } as never;
    const cmds = cliCommands(info, { name: 'testCase', key: 'TC-3', query: {} }, 'v1.2.0').map((c) => c.cmd);
    expect(cmds[0]).toBe('npx indx-watch clone https://watch.shop.test');
    expect(cmds).toContain('IW_REPORTER=1 npx playwright test --grep @TC-3');
    const local = cliCommands({ share: { clone: null } } as never, { name: 'home', query: {} }, 'v1.2.0');
    expect(local.map((c) => c.key)).toEqual(['cloneGit', 'push', 'report', 'sync', 'serve']);
  });
  it('flags machine translations', () => {
    const e = { title: 'Valid coupon', i18n: { ja: { title: '有効なクーポン', status: 'machine' } } };
    expect(pick(e, 'title', 'ja')).toEqual({
      text: '有効なクーポン',
      translated: true,
      outdated: false,
      machine: true,
    });
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

describe('test case page and in-place runner', () => {
  const st = (p: Partial<StepState>): StepState => ({ note: '', shots: [], checks: [], ...p });
  it('ticking every check suggests pass; a fail with an unticked check asks for a note', () => {
    expect(stepStatus(st({ checks: [true, true] }))).toBe('pass');
    expect(stepStatus(st({ checks: [true, false] }))).toBeUndefined();
    expect(stepStatus(st({}))).toBeUndefined();
    expect(stepStatus(st({ status: 'fail', checks: [true, true] }))).toBe('fail');
    const failed = st({ status: 'fail', checks: [true, false] });
    expect(asksNote(failed)).toBe(true);
    expect(stepDone(failed)).toBe(false);
    expect(stepDone({ ...failed, note: 'Total is 40.00' })).toBe(true);
    expect(asksNote(st({ status: 'fail' }))).toBe(false);
    expect(stepDone(st({ checks: [false] }))).toBe(false);
  });
  it('unticking a check after Pass drops the explicit pass', () => {
    const passed = st({ status: 'pass', checks: [true, true] });
    expect(tickCheck(passed, 1, false)).toEqual(st({ status: undefined, checks: [true, false] }));
    expect(stepStatus(tickCheck(passed, 1, false))).toBeUndefined();
    expect(tickCheck(st({ status: 'fail', checks: [true, true] }), 0, false).status).toBe('fail');
    expect(stepStatus(tickCheck(st({ checks: [true, false] }), 1, true))).toBe('pass');
  });
  it('Next opens the first step without a result, then the Result block', () => {
    expect(firstOpen([st({ status: 'pass' }), st({}), st({})])).toBe(1);
    expect(firstOpen([st({ checks: [true] }), st({ status: 'skipped' })])).toBe(2);
  });
  it('records the ticked checks on each recorded step', () => {
    const d = { key: 'TC-3', fixtures: [] } as unknown as TestCaseDetail;
    const head = { verdict: 'fail' as const };
    const input = buildRunInput(
      d,
      [st({ checks: [true, false], status: 'fail', note: 'x' }), st({ checks: [false] })],
      head,
      'Wrong total',
    );
    expect(input.steps).toEqual([{ index: 1, status: 'fail', note: 'x', checks: [true, false] }]);
    expect(buildRunInput(d, [st({ status: 'pass' })], head, '').steps).toEqual([
      { index: 1, status: 'pass' },
    ]);
  });
  it('builds the Open link, names the steps that use a fixture and splits preconditions', () => {
    expect(startUrl('http://localhost:4173', '/cart')).toBe('http://localhost:4173/cart');
    expect(startUrl('https://shop.example/app/', '/cart')).toBe('https://shop.example/app/cart');
    expect(startUrl('http://localhost:4173')).toBe('http://localhost:4173');
    // examples/shop TC-9
    const steps = [
      { instruction: 'Sign in with {{FX-3.username}} and open "Canvas Tote".' },
      { instruction: 'Attach the file from FX-4 and press "Post review".' },
    ];
    expect(stepsUsing(steps, 'FX-4')).toEqual([2]);
    expect(stepsUsing(steps, 'FX-3')).toEqual([1]);
    expect(stepsUsing([{ instruction: 'Use FX-40.' }], 'FX-4')).toEqual([]);
    expect(sentences('The cart contains one "Canvas Tote" (price 40.00). You are signed out.')).toEqual([
      'The cart contains one "Canvas Tote" (price 40.00).',
      'You are signed out.',
    ]);
    expect(sentences('カートに商品がある。サインアウトしている。')).toEqual([
      'カートに商品がある。',
      'サインアウトしている。',
    ]);
  });
});

describe('ciLinks()', () => {
  it('links the CI run and the pull request; web URLs only', () => {
    const url = 'https://github.com/acme/shop/actions/runs/987/attempts/2';
    expect(ciLinks({ url, pr: 12 })).toEqual({ url, pr: 'https://github.com/acme/shop/pull/12' });
    expect(ciLinks({ url })).toEqual({ url, pr: undefined });
    expect(ciLinks({ url: 'https://ci.example/build/1', pr: 3 })).toEqual({
      url: 'https://ci.example/build/1',
      pr: undefined,
    });
    expect(ciLinks({ url: 'javascript:alert(1)//actions/runs/1', pr: 1 })).toEqual({});
    expect(ciLinks(undefined)).toEqual({});
  });
});

describe('writes', () => {
  it('carry X-IW-Request so the server can refuse cross-site writes', async () => {
    const sent: RequestInit[] = [];
    setTransport({
      fetch: async (_path, init) => {
        sent.push(init ?? {});
        return Response.json({});
      },
      blobUrl: (sha) => sha,
    });
    await api.createRun({ test_case: 'TC-1', verdict: 'pass' } as never);
    await api.review('run_x', { verdict: 'pass', reason: 'ok' });
    await api.uploadBlob(new Blob(['x'], { type: 'image/png' }), 'a.png');
    for (const init of sent) expect((init.headers as Record<string, string>)['X-IW-Request']).toBe('1');
  });
});

describe('my features (docs/spec/web.md#my-features)', () => {
  it('starts in "My features" when the viewer owns a feature and has not chosen "All features"', () => {
    expect(startMine({ owns: ['FEAT-2'] }, null)).toBe(true);
    expect(startMine({ owns: ['FEAT-2'] }, 'mine')).toBe(true);
    expect(startMine({ owns: ['FEAT-2'] }, 'all')).toBe(false);
    expect(startMine({ owns: [] }, 'mine')).toBe(false);
    expect(startMine({}, null)).toBe(false);
  });

  it('asks status and specs with mine=1 only in "My features"; test cases never', async () => {
    const paths: string[] = [];
    setTransport({
      fetch: async (path) => {
        paths.push(path);
        return Response.json({});
      },
      blobUrl: (sha) => sha,
    });
    const mine = { release: 'v1.2.0', mine: true };
    await api.status(mine);
    await api.specs(mine);
    await api.specs({ ...mine, mine: false });
    await api.testCase('TC-3', mine);
    expect(paths).toEqual([
      'api/status?release=v1.2.0&mine=1',
      'api/specs?release=v1.2.0&mine=1',
      'api/specs?release=v1.2.0',
      'api/test-cases/TC-3?release=v1.2.0',
    ]);
  });
});
