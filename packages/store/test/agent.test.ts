/** The agent loop over fake ports, the Browser Run adapter over a fake Playwright, and real Chromium when installed. */
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fakeBrowserProvider, fakeLlmClient, runAgent } from '../src/index.js';
import { browserRun, type Chromium, loadChromium, playwrightBrowser } from '../src/node/index.js';
import { browserProviderContract } from './contract.js';

const png = (n: number) => new Uint8Array([137, 80, 78, 71, n]);
const pages = {
  'https://shop.test/': { title: 'Shop', tree: 'link "Sign in" [ref=e7]', screenshot: png(1) },
  'https://shop.test/sign-in': {
    title: 'Sign in',
    tree: 'textbox "Email" [ref=e29]\ntextbox "Password" [ref=e31]\nbutton "Sign in" [ref=e32]',
    screenshot: png(2),
  },
};
const steps = [
  { instruction: 'Open "Sign in" and enter casey@shop.test', expected: 'The sign-in form shows' },
  { instruction: 'Reload the page.', expected: 'The header still shows "Sign in".' },
];

describe('runAgent', () => {
  it('asks the LLM for each action, acts, and keeps a note and the screenshot of every step', async () => {
    const browser = fakeBrowserProvider(pages);
    const llm = fakeLlmClient(
      () => ({ verdict: 'pass', confidence: 0.9, reason: 'Both steps show their results' }),
      ({ step, history }) =>
        step.index === 1 && history.length === 0
          ? { type: 'navigate', url: '/sign-in' }
          : step.index === 1 && history.length === 1
            ? { type: 'fill', ref: 'e29', value: 'casey@shop.test' }
            : { type: 'step_done', status: 'pass', note: `Step ${step.index} done` },
    );
    const out = await runAgent({
      browser,
      llm,
      baseUrl: 'https://shop.test',
      goal: 'TC-8',
      steps,
      rubric: ['r'],
    });
    expect(browser.actions).toEqual([
      { type: 'navigate', url: '/sign-in' },
      { type: 'fill', ref: 'e29', value: 'casey@shop.test' },
    ]);
    expect(out.steps).toEqual([
      {
        index: 1,
        status: 'pass',
        note: 'Step 1 done\nActions: navigate /sign-in: ok; fill e29 "casey@shop.test": ok',
        screenshot: png(2),
      },
      { index: 2, status: 'pass', note: 'Step 2 done', screenshot: png(2) },
    ]);
    expect(llm.steps[0]).toMatchObject({ goal: 'TC-8', step: { index: 1, ...steps[0] }, history: [] });
    expect(llm.calls[0]!.rubric).toEqual(['r']);
    expect(llm.calls[0]!.observation.tree).toContain('Step 1: pass: Step 1 done');
    expect(out.judgement).toMatchObject({ verdict: 'pass', confidence: 0.9 });
  });

  it('blocks a step that runs out of actions, skips the rest and closes the browser', async () => {
    const browser = fakeBrowserProvider(pages);
    const llm = fakeLlmClient(undefined, () => ({ type: 'navigate', url: '/nowhere' }));
    const out = await runAgent({
      browser,
      llm,
      baseUrl: 'https://shop.test',
      goal: 'TC-8',
      steps,
      rubric: [],
      maxActions: 2,
    });
    expect(out.steps.map((s) => s.status)).toEqual(['blocked', 'skipped']);
    expect(out.steps[0]!.note).toMatch(
      /^No result after 2 actions\nActions: navigate \/nowhere: error: no page/,
    );
    expect(out.steps[0]!.screenshot).toEqual(png(1));
    expect(out.steps[1]).toEqual({
      index: 2,
      status: 'skipped',
      note: 'Not run: an earlier step did not pass',
    });
  });

  it('refuses an LlmClient without next()', async () => {
    const { judge } = fakeLlmClient();
    const input = {
      browser: fakeBrowserProvider(pages),
      baseUrl: 'https://shop.test',
      goal: '',
      steps,
      rubric: [],
    };
    await expect(runAgent({ ...input, llm: { judge } })).rejects.toThrow(/cannot drive a browser/);
  });
});

describe('browserRun', () => {
  it('connects to the Browser Run CDP endpoint with the API token (fake Playwright, no network)', async () => {
    const calls: unknown[] = [];
    const page = {
      goto: async () => null,
      url: () => 'https://shop.example/',
      title: async () => 'Shop',
      ariaSnapshot: async () => 'link "Sign in" [ref=e7]',
      screenshot: async () => png(3),
      locator: () => ({ click: async () => {}, fill: async () => {}, selectOption: async () => {} }),
      keyboard: { press: async () => {} },
      setDefaultTimeout: () => {},
      waitForLoadState: async () => {},
      waitForTimeout: async () => {},
    };
    const browser = { newContext: async () => ({ newPage: async () => page }), close: async () => {} };
    const chromium = {
      launch: async () => browser,
      connectOverCDP: async (url: string, o: unknown) => {
        calls.push([url, o]);
        return browser;
      },
    } as unknown as Chromium;
    const s = await browserRun({ accountId: 'acc 1', apiToken: 'tok', chromium }).open({
      baseUrl: 'https://shop.example',
    });
    expect(calls).toEqual([
      [
        'wss://api.cloudflare.com/client/v4/accounts/acc%201/browser-run/devtools/browser?keep_alive=600000',
        { headers: { Authorization: 'Bearer tok' } },
      ],
    ]);
    expect(await s.observe()).toEqual({
      url: 'https://shop.example/',
      title: 'Shop',
      tree: 'link "Sign in" [ref=e7]',
      screenshot: png(3),
    });
    await s.close();
  });
});

// Real Chromium through the local adapter; runs where Playwright's Chromium is installed (CI's e2e job installs it).
const chromium = await loadChromium().catch(() => null);
const executablePath = process.env.PW_CHROMIUM_PATH;
const installed =
  !!chromium &&
  existsSync(executablePath ?? (chromium as unknown as { executablePath(): string }).executablePath());

describe.runIf(installed)('playwrightBrowser (local Chromium)', () => {
  const html = (title: string, body: string) => `<!doctype html><title>${title}</title><main>${body}</main>`;
  const server = createServer((req, res) => {
    const page = {
      '/': html('Shop', '<a href="/cart">Cart</a>'),
      '/cart': html('Cart', '<h1>Cart</h1><p>Total: $90</p>'),
    }[req.url ?? ''];
    res.writeHead(page ? 200 : 404, { 'content-type': 'text/html' }).end(page ?? 'not found');
  });
  let baseUrl = '';
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  browserProviderContract('playwright', async () => ({
    provider: playwrightBrowser(executablePath ? { executablePath } : {}),
    baseUrl,
  }));

  it('observes the accessibility tree with refs and a PNG screenshot, and clicks by ref', async () => {
    const s = await playwrightBrowser(executablePath ? { executablePath } : {}).open({ baseUrl });
    const home = await s.observe();
    const ref = /link "Cart" \[ref=(e\d+)\]/.exec(home.tree)?.[1];
    expect(ref, home.tree).toBeDefined();
    expect([...home.screenshot!.slice(0, 4)]).toEqual([137, 80, 78, 71]);
    expect(await s.act({ type: 'click', ref: ref! })).toEqual({ ok: true });
    expect((await s.observe()).tree).toContain('Total: $90');
    await s.close();
  }, 30_000);

  it('navigates only within the base URL origin', async () => {
    const s = await playwrightBrowser(executablePath ? { executablePath } : {}).open({ baseUrl });
    expect(await s.act({ type: 'navigate', url: '/cart' })).toEqual({ ok: true });
    for (const url of ['file:///etc/passwd', 'http://localhost:9/', 'https://example.com/'])
      expect(await s.act({ type: 'navigate', url })).toMatchObject({
        ok: false,
        error: /navigate only within/,
      });
    expect((await s.observe()).tree).toContain('Total: $90');
    await s.close();
  }, 30_000);
});
