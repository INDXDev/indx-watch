/** `iw run` (agent mode) on the shop's agent test case TC-10: fake ports, then real Chromium against the shop app. */
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunRecord } from '@indx-watch/bundle';
import { type AgentAction, type AgentStepInput, fakeBrowserProvider, fakeLlmClient } from '@indx-watch/store';
import { loadChromium, openReplica, playwrightBrowser } from '@indx-watch/store/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAgentCase } from '../src/commands/results-run.js';
import type { Ctx } from '../src/util.js';
import { cleanEnv, iwJson, ROOT, shop } from './helpers.js';

const ctx = (cwd: string): Ctx => ({ cwd, env: cleanEnv(), log: () => {}, stdin: async () => '' });
const png = (n: number) => new Uint8Array([137, 80, 78, 71, n]);
const BASE = 'http://localhost:4173';
const pages = {
  [`${BASE}/`]: { title: 'Shop', tree: 'searchbox "Search" [ref=e11]', screenshot: png(1) },
  [`${BASE}/?q=cap`]: { title: 'Shop', tree: 'link "Wool Cap" [ref=e22]', screenshot: png(2) },
};
/** Step 1 passes at once; step 2 fills the search box, moves to the results, and passes. */
const plan = ({ step, history }: AgentStepInput): AgentAction =>
  step.index === 2 && !history.length
    ? { type: 'fill', ref: 'e11', value: 'cap' }
    : step.index === 2 && history.length === 1
      ? { type: 'navigate', url: '/?q=cap' }
      : { type: 'step_done', status: 'pass', note: `Step ${step.index} shows its expected result` };

describe('iw run (fake browser and LLM)', () => {
  it('records an agent run with a note and a screenshot per step and an llm judgement', async () => {
    const dir = shop();
    const browser = fakeBrowserProvider(pages);
    const pass = () => ({ verdict: 'pass' as const, confidence: 0.9, reason: 'Both rubric items hold' });
    const llm = fakeLlmClient(pass, plan);
    const out = await runAgentCase(ctx(dir), { tc: 'TC-10' }, async () => ({ browser, llm }));
    const run = out.data.run as RunRecord;
    expect(out.data).toMatchObject({ verdict: 'pass', rule: 8 });
    expect(run).toMatchObject({ source: 'agent', release: 'v1.2.0', environment: 'staging', reported: null });
    expect(run.steps.map((s) => [s.index, s.status])).toEqual([
      [1, 'pass'],
      [2, 'pass'],
    ]);
    expect(run.steps[0]!.note).toBe('Step 1 shows its expected result');
    expect(run.steps[1]!.note).toContain('Actions: fill e11 "cap": ok; navigate /?q=cap: ok');
    expect(run.evidence.map((e) => [e.step, e.kind, e.media_type])).toEqual([
      [1, 'screenshot', 'image/png'],
      [2, 'screenshot', 'image/png'],
    ]);
    const replica = openReplica(join(dir, '.indx-watch'));
    for (const [i, s] of run.steps.entries()) {
      expect(s.evidence).toEqual([run.evidence[i]!.sha256]);
      expect(await replica.getBlob(s.evidence![0]!)).toEqual(png(i + 1));
    }
    expect(run.judgements).toEqual([
      expect.objectContaining({
        ...{ kind: 'llm', verdict: 'pass', confidence: 0.9 },
        by: expect.objectContaining({ kind: 'agent', model: 'fake' }),
      }),
    ]);
    expect(llm.calls[0]!.rubric[1]).toContain('"Wool Cap" at "25.00" is the only product listed');
    // the run is a normal run: iw show computes the same verdict
    expect(iwJson(dir, 'show', ['show', run.id]).json.data).toMatchObject({ decision: { verdict: 'pass' } });
  });

  it('fills placeholders (never secrets) and judges by the expected results without a rubric', async () => {
    const dir = shop();
    const tc8 = join(dir, '.indx-watch/specs/FEAT-3-account/UC-4-customer-signs-in/TC-8-wrong-password.toml');
    writeFileSync(tc8, readFileSync(tc8, 'utf8').replace('mode = "manual"', 'mode = "agent"'));
    const llm = fakeLlmClient(undefined, () => ({ type: 'step_done', status: 'pass', note: 'ok' }));
    await runAgentCase(ctx(dir), { tc: 'TC-8' }, async () => ({ browser: fakeBrowserProvider(pages), llm }));
    expect(llm.steps[0]!.step.instruction).toBe(
      'Open "Sign in", enter casey@shop.test and the password "wrong-password", and press "Sign in".',
    );
    expect(llm.calls[0]!.rubric).toEqual([
      'The message "Email or password is incorrect" appears.',
      'The header still shows "Sign in".',
    ]);
  });

  it('a low-confidence judgement is needs_review; a blocked step marks the run blocked', async () => {
    const dir = shop();
    const unsure = fakeLlmClient(() => ({ verdict: 'pass', confidence: 0.5 }), plan);
    const browser = fakeBrowserProvider(pages);
    const out = await runAgentCase(ctx(dir), { tc: 'TC-10' }, async () => ({ browser, llm: unsure }));
    expect(out.data.verdict).toBe('needs_review');
    const stuck = fakeLlmClient(undefined, () => ({ type: 'click', ref: 'e7' }));
    const blocked = await runAgentCase(ctx(dir), { tc: 'TC-10', 'max-actions': '2' }, async () => ({
      browser: fakeBrowserProvider(pages),
      llm: stuck,
    }));
    expect(blocked.data).toMatchObject({ verdict: 'blocked', run: { reported: 'blocked' } });
  });

  it('refuses test cases that are not agent or hybrid, and Browser Run without credentials', async () => {
    const dir = shop();
    const r = iwJson(dir, 'run', ['run', 'TC-3']);
    expect(r.code).toBe(2);
    expect(r.json.error.message).toMatch(/TC-3 is a playwright test case/);
    const noToken = { env: { CLOUDFLARE_ACCOUNT_ID: '', CLOUDFLARE_API_TOKEN: '' } };
    const cf = iwJson(dir, 'run', ['run', 'TC-10', '--browser', 'cloudflare'], noToken);
    expect(cf.json.error.code).toBe('INVALID_CONFIG');
  });
});

// Real Chromium against the shop app, with a scripted LLM that picks refs from the real accessibility tree.
const chromium = await loadChromium().catch(() => null);
const exe = process.env.PW_CHROMIUM_PATH;
const installed =
  !!chromium && existsSync(exe ?? (chromium as unknown as { executablePath(): string }).executablePath());

describe.runIf(installed)('iw run (local Chromium, shop app)', () => {
  const port = 4300 + Math.floor(Math.random() * 500);
  let app: ChildProcess;
  beforeAll(async () => {
    app = spawn(process.execPath, [join(ROOT, 'examples/shop/app/server.mjs')], {
      env: { ...process.env, PORT: String(port) },
    });
    await new Promise((r) => app.stdout!.once('data', r));
  });
  afterAll(() => app.kill());

  it('walks TC-10 in a browser and records the real screenshots per step', async () => {
    const ref = (tree: string, what: string) =>
      new RegExp(`${what} \\[ref=(\\w+)\\]`).exec(tree)?.[1] ?? 'none';
    const real = ({ step, observation: o, history }: AgentStepInput): AgentAction => {
      const done = (pass: boolean): AgentAction => ({
        type: 'step_done',
        status: pass ? 'pass' : 'fail',
        note: o.url,
      });
      if (step.index === 1) return done(o.tree.includes('link "Wool Cap"'));
      if (!history.length) return { type: 'fill', ref: ref(o.tree, 'searchbox "Search"'), value: 'cap' };
      return done(o.tree.includes('link "Wool Cap"') && !o.tree.includes('Canvas Tote'));
    };
    const verdict = (i: { observation: { tree: string } }) =>
      i.observation.tree.includes('Step 2: pass') ? ('pass' as const) : ('fail' as const);
    const llm = fakeLlmClient((i) => ({ verdict: verdict(i), confidence: 0.95 }), real);
    const browser = playwrightBrowser(exe ? { executablePath: exe } : {});
    const out = await runAgentCase(
      ctx(shop()),
      { tc: 'TC-10', 'base-url': `http://localhost:${port}` },
      async () => ({ browser, llm }),
    );
    const run = out.data.run as RunRecord;
    expect(
      run.steps.map((s) => s.status),
      run.steps.map((s) => s.note).join('\n'),
    ).toEqual(['pass', 'pass']);
    expect(run.evidence.map((e) => [e.step, e.kind])).toEqual([
      [1, 'screenshot'],
      [2, 'screenshot'],
    ]);
    expect(run.evidence[0]!.size).toBeGreaterThan(1000); // a real PNG
    expect(out.data.verdict).toBe('pass');
  }, 60_000);
});
