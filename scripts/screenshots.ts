// Regenerates the docs screenshots in docs/images/ from the web app loaded with examples/shop and its sample
// results (CONTRIBUTING.md#screenshots). Needs `pnpm build` first; never writes into examples/shop.
// Usage: pnpm screenshots [name ...]   (PW_CHROMIUM_PATH picks the Chromium binary, as in e2e/)
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Browser, type BrowserContextOptions, chromium, type Page } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const BIN = join(ROOT, 'packages/cli/dist/bin.js');
const OUT = join(ROOT, 'docs/images');
/** The sample runs were recorded on 2026-11-19; pin "now" to the next morning so relative times never drift. */
const NOW = '2026-11-20T09:00:00Z';
const MAX_BYTES = 600 * 1024;

if (!existsSync(BIN) || !existsSync(join(ROOT, 'packages/cli/dist/web/index.html'))) {
  console.error('packages/cli/dist is missing: run `pnpm build` first.');
  process.exit(1);
}

// A private copy of examples/shop (bundle + sample store), like e2e/helpers.ts shopCopy().
const tmp = mkdtempSync(join(tmpdir(), 'iw-screenshots-'));
cpSync(join(ROOT, 'examples/shop/.indx-watch'), join(tmp, '.indx-watch'), {
  recursive: true,
  filter: (src) => !/[/\\](runs|cache)([/\\]|$)/.test(src),
});
cpSync(join(ROOT, 'examples/shop/store'), join(tmp, 'store'), { recursive: true });

const env: NodeJS.ProcessEnv = {
  ...process.env,
  NO_COLOR: '1',
  IW_NOW: NOW,
  IW_ACTOR: 'alex@shop.test',
  IW_ACTOR_NAME: 'Alex',
};
delete env.IW_DIR;
delete env.CLAUDECODE;
const iw = (args: string[]) =>
  execFileSync(process.execPath, [BIN, ...args], { cwd: tmp, env, stdio: 'pipe' });
iw(['sync', '--pull-only', '--json']);

function serve(): Promise<{ url: string; stop(): void }> {
  const child = spawn(process.execPath, [BIN, 'serve', '--port', '0', '--no-sync', '--json'], {
    cwd: tmp,
    env,
  });
  return new Promise((ok, fail) => {
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      const m = /"url"\s*:\s*"([^"]+)"/.exec(out);
      if (m) ok({ url: m[1]!.replace(/\/?$/, '/'), stop: () => child.kill() });
    });
    child.stderr.on('data', (d) => {
      out += d;
    });
    child.on('exit', (code) => fail(new Error(`iw serve exited ${code}: ${out}`)));
    setTimeout(() => fail(new Error(`iw serve did not start: ${out}`)), 20_000);
  });
}

interface Shot {
  name: string;
  /** hash route, or a file URL for the HTML report */
  path: string;
  width?: number;
  height?: number;
  locale?: 'en' | 'ja';
  dark?: boolean;
  fullPage?: boolean;
  prepare?(page: Page): Promise<void>;
}

const shots: Shot[] = [
  { name: 'home', path: '#/' },
  { name: 'spec-tree', path: '#/tests' },
  { name: 'test-case', path: '#/tc/TC-9', fullPage: true },
  {
    name: 'manual-run',
    path: '#/tc/TC-3/run',
    fullPage: true,
    async prepare(page) {
      // tick every check of step 1; nothing is recorded until "Save result"
      const step = page.locator('.run-step.active').first();
      for (const box of await step.getByRole('checkbox').all()) await box.check();
    },
  },
  { name: 'test-data', path: '#/fixtures', height: 520 },
  {
    name: 'readiness',
    path: '#/',
    async prepare(page) {
      const details = page.locator('details.details-card').first();
      await details.locator('summary').click();
      await details.scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        const el = document.querySelector('details.details-card');
        if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 72);
      });
    },
  },
  { name: 'report', path: '#/report' },
  { name: 'test-case-mobile', path: '#/tc/TC-6', width: 390, height: 844, fullPage: true },
  { name: 'home-ja-dark', path: '#/', locale: 'ja', dark: true },
  { name: 'report-html', path: 'report.html' },
];

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.locator('[aria-busy="true"]').first().waitFor({ state: 'detached', timeout: 15_000 });
  const iframe = page.locator('iframe').first();
  if (await iframe.count()) {
    await iframe.contentFrame().locator('body *').first().waitFor();
    await page.waitForLoadState('networkidle');
  }
  if (await page.getByRole('alert').count()) throw new Error(`error on ${page.url()}`);
  await page.evaluate(() => document.fonts.ready);
}

async function take(browser: Browser, base: string, s: Shot, scale: number) {
  const locale = s.locale ?? 'en';
  const opts: BrowserContextOptions = {
    viewport: { width: s.width ?? 1280, height: s.height ?? 800 },
    deviceScaleFactor: scale,
    locale: locale === 'ja' ? 'ja-JP' : 'en-US',
    timezoneId: 'UTC',
    colorScheme: s.dark ? 'dark' : 'light',
    reducedMotion: 'reduce',
  };
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(
    ([l]) => {
      localStorage.setItem('indx-watch.locale', l!);
      localStorage.setItem('indx-watch.features', 'all');
    },
    [locale],
  );
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  // `iw serve` renders the report preview with the real time; pin its "Generated" line like IW_NOW does for `iw report`
  await page.route('**/api/report?*', async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(
      /\d{4}-\d\d-\d\d \d\d:\d\d UTC/g,
      `${NOW.slice(0, 10)} ${NOW.slice(11, 16)} UTC`,
    );
    await route.fulfill({ response: res, body });
  });
  await page.goto(s.path.startsWith('#') ? base + s.path : pathToFileURL(join(tmp, s.path)).href);
  await settle(page);
  await s.prepare?.(page);
  await page.addStyleTag({ content: '*{caret-color:transparent!important}' });
  if (s.fullPage) {
    // grow the viewport to the whole page instead of `fullPage`, so sticky and fixed bars stay at the edges
    // (plus room for a bar fixed to the bottom, the phone tab bar, so it covers nothing)
    const height = await page.evaluate(() => {
      const bars = [...document.querySelectorAll('body *')].filter((el) => {
        const cs = getComputedStyle(el);
        return cs.position === 'fixed' && cs.bottom === '0px' && cs.display !== 'none';
      });
      return document.documentElement.scrollHeight + Math.max(0, ...bars.map((el) => el.clientHeight));
    });
    await page.setViewportSize({ width: opts.viewport!.width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  const file = join(OUT, `${s.name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  await ctx.close();
  return statSync(file).size;
}

const only = process.argv.slice(2);
const server = await serve();
const launchOptions = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};
const browser = await chromium.launch(launchOptions);
try {
  mkdirSync(OUT, { recursive: true });
  iw(['report', '--release', 'v1.2.0', '--format', 'html', '--out', join(tmp, 'report.html')]);
  for (const s of shots.filter((x) => !only.length || only.includes(x.name))) {
    let size = await take(browser, server.url, s, 2);
    if (size > MAX_BYTES) size = await take(browser, server.url, s, 1.5);
    console.log(`docs/images/${s.name}.png  ${Math.round(size / 1024)} KB`);
  }
} finally {
  await browser.close();
  server.stop();
  rmSync(tmp, { recursive: true, force: true });
}
