/**
 * BrowserProvider adapters over Playwright (docs/spec/agents.md#agent-execution-mode-v02): Chromium on this machine, or
 * Cloudflare Browser Run over its CDP endpoint. Playwright is not a dependency of the package: it is imported when a
 * browser opens, from `playwright`, `playwright-core` or `@playwright/test`, whichever the project has.
 */
import type { BrowserType, Page } from '@playwright/test'; // types only: nothing is imported at run time
import type { BrowserAction, BrowserProvider, BrowserSession } from '../ports.js';
import { StoreError } from '../ports.js';

export type Chromium = Pick<BrowserType, 'launch' | 'connectOverCDP'>;
type Browser = Awaited<ReturnType<Chromium['launch']>>;
type Options = {
  chromium?: Chromium;
  executablePath?: string;
  cdp?: { url: string; headers: Record<string, string> };
};

const MAX_TREE = 30_000;

/** Chromium from whichever Playwright package resolves. */
export async function loadChromium(): Promise<Chromium> {
  for (const name of ['playwright', 'playwright-core', '@playwright/test']) {
    const mod = await import(name).catch(() => null);
    if (mod?.chromium) return mod.chromium as Chromium;
  }
  throw new StoreError(
    'invalid',
    'Playwright is not installed: run `npm install -D playwright` and `npx playwright install chromium`',
  );
}

/** `navigate` stays on the base URL's origin: page text must not send the agent to file:// or other hosts. */
async function act(page: Page, a: BrowserAction, baseUrl: string) {
  const el = 'ref' in a ? page.locator(`aria-ref=${a.ref}`) : undefined;
  if (a.type === 'navigate') {
    const to = new URL(a.url, /^https?:/.test(page.url()) ? page.url() : baseUrl);
    if (to.origin !== new URL(baseUrl).origin) throw new Error(`navigate only within ${baseUrl}`);
    const status = (await page.goto(to.href))?.status() ?? 200;
    if (status >= 400) throw new Error(`HTTP ${status}`);
  } else if (a.type === 'press') await page.keyboard.press(a.key);
  else if (a.type === 'click') await el!.click();
  else if (a.type === 'fill') await el!.fill(a.value);
  else await el!.selectOption(a.option);
}

/** A session on a new page of `browser`; closing it closes the browser (or the Browser Run session). */
async function session(browser: Browser, baseUrl: string, viewport?: { width: number; height: number }) {
  const page = await (await browser.newContext(viewport ? { viewport } : {})).newPage();
  page.setDefaultTimeout(5_000);
  // after navigating or acting, let the page render what it started (client-side routes fetch after the click)
  const settle = () =>
    page.waitForTimeout(300).then(() => page.waitForLoadState('networkidle').catch(() => {}));
  await page.goto(baseUrl);
  await settle();
  return {
    async observe() {
      const tree = (await page.ariaSnapshot({ mode: 'ai' })).slice(0, MAX_TREE);
      const screenshot = new Uint8Array(await page.screenshot());
      return { url: page.url(), title: await page.title(), tree, screenshot };
    },
    async act(a) {
      try {
        await act(page, a, baseUrl);
        await settle();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String((e as Error).message).split('\n')[0] };
      }
    },
    close: () => browser.close(),
  } satisfies BrowserSession;
}

/** Local headless Chromium (`executablePath`: an installed Chromium instead of Playwright's), or a CDP endpoint. */
export function playwrightBrowser(opts: Options = {}): BrowserProvider {
  return {
    async open({ baseUrl, viewport }) {
      const { chromium = await loadChromium(), cdp, executablePath } = opts;
      const browser = cdp
        ? await chromium.connectOverCDP(cdp.url, { headers: cdp.headers })
        : await chromium.launch(executablePath ? { executablePath } : {});
      return session(browser, baseUrl, viewport);
    },
  };
}

/** Cloudflare Browser Run over CDP: an API token with "Browser Rendering - Edit" for the account. */
export function browserRun({
  accountId,
  apiToken,
  ...opts
}: { accountId: string; apiToken: string } & Options) {
  const url = `wss://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/browser-run/devtools/browser?keep_alive=600000`;
  return playwrightBrowser({ ...opts, cdp: { url, headers: { Authorization: `Bearer ${apiToken}` } } });
}
