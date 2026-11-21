/** Run and query commands on a temp copy of examples/shop: status, show, list, record, judge, review, waive, retract, deployment. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fakeMessagesApi, read, TC3 } from './cli-fixtures.js';
import { iw, iwJson, shop } from './helpers.js';

describe('commands: status, show and list', () => {
  it('status and report: an unknown --release or --env is NOT_FOUND, from the environment a warning', () => {
    const dir = shop();
    for (const args of [
      ['status', '--release', 'v9'],
      ['status', '--env', 'nope'],
      ['report', '--release', 'v9'],
    ])
      expect(iwJson(dir, args[0] as 'status', [...args]).json.error.code).toBe('NOT_FOUND');
    const env = iwJson(dir, 'status', ['status'], { env: { IW_RELEASE: 'v9' } });
    expect(env.json.warnings).toEqual([expect.objectContaining({ code: 'unknown-release' })]);
    expect(
      iwJson(dir, 'status', ['status', '--release', 'v1.2.0', '--env', 'staging']).json.warnings,
    ).toEqual([]);
  });

  it('status and status --gate', () => {
    const dir = shop();
    const s = iwJson(dir, 'status', ['status']);
    expect(s.json.data.scope).toEqual({ release: 'v1.2.0', environment: null });
    expect(s.json.data.counts.uncovered).toBe(1);
    const g = iwJson(dir, 'status', ['status', '--gate', '--env', 'staging']);
    expect([g.code, g.json.error.code, g.json.data.scope.environment]).toEqual([1, 'GATE_FAILED', 'staging']);
    // pass → fail → pass: the verdict went back and forth, so TC-4 has a flake rate (concepts.md#flaky-tests)
    for (const v of ['pass', 'fail', 'pass']) iwJson(dir, 'record', ['record', 'TC-4', '--verdict', v]);
    const tcs = iwJson(dir, 'status', ['status']).json.data.testCases;
    expect(tcs.find((t: { key: string }) => t.key === 'TC-4').flaky).toMatchObject({ flakes: 1 });
  });

  it('show: use case, test case, fixture, plan, environment and a run by prefix', () => {
    const dir = shop();
    expect(iwJson(dir, 'show', ['show', 'UC-2']).json.data.criteria[0]).toMatchObject({
      key: 'AC-2.1',
      testCases: ['TC-3'],
    });
    expect(iwJson(dir, 'show', ['show', 'SHOP:TC-3']).json.data).toMatchObject({
      key: 'TC-3',
      priority: 'P0',
    });
    expect(iwJson(dir, 'show', ['show', 'FX-1']).json.data.usedBy).toContain('TC-3');
    expect(iwJson(dir, 'show', ['show', 'PLAN-1']).json.data.items[0].status).toBe('todo');
    expect(iwJson(dir, 'show', ['show', 'staging']).json.data.base_url).toBe('http://localhost:4173');
    const id = iwJson(dir, 'record', ['record', 'TC-4', '--verdict', 'fail']).json.data.run.id as string;
    const run = iwJson(dir, 'show', ['show', id.slice(0, 12)]).json.data;
    expect([run.id, run.decision.verdict]).toEqual([id, 'fail']);
    expect(iwJson(dir, 'show', ['show', 'TC-99']).code).toBe(2);
  });

  it('list with filters', () => {
    const dir = shop();
    const tcs = iwJson(dir, 'list', ['list', 'tcs', '--uc', 'UC-2']).json.data.items;
    expect(tcs.map((t: { key: string }) => t.key)).toEqual(['TC-3', 'TC-4']);
    expect(
      iwJson(dir, 'list', ['list', 'fixtures', '--status', 'ready']).json.data.items.length,
    ).toBeGreaterThan(0);
    for (const k of ['features', 'ucs', 'envs', 'releases', 'plans'])
      expect(iwJson(dir, 'list', ['list', k]).code).toBe(0);
    iwJson(dir, 'record', ['record', 'TC-1', '--verdict', 'pass']);
    expect(
      iwJson(dir, 'list', ['list', 'runs', '--tc', 'TC-1', '--limit', '5']).json.data.items,
    ).toHaveLength(1);
    expect(iw(dir, ['list', 'nope']).code).toBe(2);
  });
});

/** The first request the fake Messages API logged. */
const firstRequest = (log: string) =>
  readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))[0];

describe('commands: judge and record', () => {
  it('judge: asks Claude (a fake Messages API) with the llm rubric and appends an llm judgement', async () => {
    const dir = shop();
    writeFileSync(
      join(dir, '.indx-watch', TC3),
      `${read(dir, TC3)}\n[[judges]]\nkind = "llm"\nrubric = ["The total drops by 10%"]\n`,
    );
    const log = join(dir, 'requests.jsonl');
    const { server, port } = await fakeMessagesApi(log);
    try {
      const env = { ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_API_KEY: 'test-key' };
      const run = iwJson(dir, 'record', ['record', 'TC-3', '--verdict', 'pass'], {
        env: { IW_ACTOR_KIND: 'ci' },
      }).json.data.run.id;
      const r = iwJson(dir, 'judge', ['judge', run], { env });
      expect(r.json.data).toMatchObject({
        verdict: 'fail', // a confident llm fail outweighs the assert pass (decision policy rule 4)
        recorded: true,
        judgement: {
          kind: 'llm',
          verdict: 'fail',
          confidence: 0.9,
          by: { kind: 'agent', model: 'claude-opus-5-5' },
        },
      });
      const req = firstRequest(log);
      expect(req).toMatchObject({
        url: '/v1/messages',
        auth: 'Bearer test-key',
        body: { model: 'claude-opus-5-5' },
      });
      expect(JSON.stringify(req.body.messages)).toContain('1. The total drops by 10%');
      expect(iwJson(dir, 'show', ['show', run]).json.data.decision.verdict).toBe('fail');
      const dry = iwJson(dir, 'judge', ['judge', run, '--dry-run', '--model', 'claude-sonnet-5-5'], { env });
      expect(dry.json.data).toMatchObject({
        recorded: false,
        judgement: { by: { model: 'claude-sonnet-5-5' } },
      });
      const plain = iwJson(dir, 'record', ['record', 'TC-1', '--verdict', 'pass']).json.data.run.id;
      const none = iwJson(dir, 'judge', ['judge', plain], { env });
      expect([none.code, none.json.error.code]).toEqual([2, 'USAGE']);
    } finally {
      server.kill();
    }
  });

  it('record as an agent: an llm judgement whose confidence decides', () => {
    const dir = shop();
    const env = { IW_ACTOR_KIND: 'agent', IW_AGENT_MODEL: 'm' };
    const args = [
      'record',
      'TC-9',
      '--verdict',
      'pass',
      '--step',
      '1=pass',
      '--step',
      '2=pass:Thumbnail shown',
    ];
    const low = iwJson(dir, 'record', [...args, '--confidence', '0.6'], { env });
    expect(low.json.data).toMatchObject({ verdict: 'needs_review', rule: 6 });
    expect(low.json.data.run.judgements[0]).toMatchObject({ kind: 'llm', confidence: 0.6 });
    expect(low.json.data.run.steps[1]).toMatchObject({ index: 2, note: 'Thumbnail shown' });
    expect(low.json.warnings.map((w: { code: string }) => w.code)).toContain('no-evidence');
    const ci = iwJson(dir, 'record', ['record', 'TC-1', '--verdict', 'blocked'], {
      env: { IW_ACTOR_KIND: 'ci' },
    });
    expect(ci.json.data).toMatchObject({ verdict: 'blocked', rule: 2 });
  });
});

describe('commands: review, waive, retract and deployment', () => {
  it('review appends a human judgement; agents are refused', () => {
    const dir = shop();
    const env = { IW_ACTOR_KIND: 'agent', IW_AGENT_MODEL: 'm' };
    const id = iwJson(dir, 'record', ['record', 'TC-9', '--verdict', 'pass', '--confidence', '0.5'], { env })
      .json.data.run.id;
    expect(iw(dir, ['review', id, '--verdict', 'pass', '--reason', 'ok'], { env }).code).toBe(2);
    const r = iwJson(dir, 'review', ['review', id, '--verdict', 'fail', '--reason', 'Thumbnail missing']);
    expect(r.json.data).toMatchObject({
      verdict: 'fail',
      judgement: { kind: 'human', reason: 'Thumbnail missing' },
    });
  });

  it('waive: refuses P0 and agents; --revoke cancels', () => {
    const dir = shop();
    expect(iwJson(dir, 'waive', ['waive', 'TC-3', '--release', 'v1.2.0', '--reason', 'x']).code).toBe(2);
    expect(
      iw(dir, ['waive', 'TC-1', '--release', 'v1.2.0', '--reason', 'x'], { env: { IW_ACTOR_KIND: 'agent' } })
        .code,
    ).toBe(2);
    const w = iwJson(dir, 'waive', ['waive', 'TC-1', '--release', 'v1.2.0', '--reason', 'Known']).json.data
      .waiver;
    expect(w).toMatchObject({ kind: 'waiver', release: 'v1.2.0', test_case: { key: 'TC-1' } });
    expect(iwJson(dir, 'waive', ['waive', '--revoke', w.id]).json.data.waiver.revokes).toBe(w.id);
  });

  it('retract hides a run', () => {
    const dir = shop();
    const id = iwJson(dir, 'record', ['record', 'TC-1', '--verdict', 'fail']).json.data.run.id;
    expect(
      iwJson(dir, 'retract', ['retract', id, '--reason', 'wrong release']).json.data.retraction.target,
    ).toBe(id);
    expect(iwJson(dir, 'show', ['show', id]).json.data.retracted).toBe(true);
    expect(iw(dir, ['retract', 'rec_01JF3Q8M5X2V7K9D4R6T1W0Y00', '--reason', 'x']).code).toBe(2);
    // agents may only retract their own records
    const human = iwJson(dir, 'record', ['record', 'TC-8', '--verdict', 'fail']).json.data.run.id;
    const bot = { IW_ACTOR: 'bot@shop.test', IW_ACTOR_KIND: 'agent', IW_AGENT_MODEL: 'm' };
    const hide = iwJson(dir, 'retract', ['retract', human, '--reason', 'x'], { env: bot });
    expect([hide.code, hide.json.error.code]).toEqual([2, 'USAGE']);
    const own = iwJson(dir, 'record', ['record', 'TC-8', '--verdict', 'pass', '--confidence', '0.9'], {
      env: bot,
    }).json.data.run.id;
    const peer = { ...bot, IW_ACTOR: 'other-bot@shop.test' };
    expect(iw(dir, ['retract', own, '--reason', 'x'], { env: peer }).code).toBe(2);
    expect(iwJson(dir, 'retract', ['retract', own, '--reason', 'mine'], { env: bot }).code).toBe(0);
  });

  it('deployment add records a deployment', () => {
    const r = iwJson(shop(), 'deployment add', [
      'deployment',
      'add',
      '--env',
      'staging',
      '--commit',
      'a1b2c3d',
      '--url',
      'https://shop.test',
    ]);
    expect(r.json.data.deployment).toMatchObject({
      kind: 'deployment',
      environment: 'staging',
      build: { commit: 'a1b2c3d' },
    });
  });
});
