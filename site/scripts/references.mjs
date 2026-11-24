#!/usr/bin/env node
// Saves screenshots of the landing pages site/DESIGN.md copies, one per viewport down each page, into
// references/ (gitignored: these are other companies' pages, kept only for side-by-side comparison).
// Needs Playwright with Chromium (npx playwright install chromium) and network access to the hosts.
// Usage: pnpm references [url …]
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT = [
  'https://clerk.com',
  'https://linear.app',
  'https://vercel.com',
  'https://supabase.com',
  'https://stripe.com',
  'https://sentry.io',
  'https://resend.com',
];

let chromium;
try {
  // require() also finds a global install through NODE_PATH; import() would not
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  console.error('Playwright is not installed: npm i -g playwright && npx playwright install chromium');
  process.exit(1);
}

const out = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'references');
mkdirSync(out, { recursive: true });
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const browser = await chromium.launch(proxy ? { proxy } : {});
for (const url of process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT) {
  const name = new URL(url).hostname.replace(/^www\./, '').split('.')[0];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const outline = await page.evaluate(() =>
      [...document.querySelectorAll('h1, h2, h3')]
        .filter((el) => el.getBoundingClientRect().width)
        .map((el) => `${el.tagName} ${getComputedStyle(el).fontSize} ${el.innerText.replace(/\s+/g, ' ').trim().slice(0, 100)}`),
    );
    writeFileSync(join(out, `${name}.txt`), `${url}\n\n${outline.join('\n')}\n`);
    let i = 0;
    for (let y = 0; y < Math.min(height, 9000); y += 900, i++) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(out, `${name}-${String(i).padStart(2, '0')}.png`) });
    }
    console.log(`${name}: ${i} screenshots, ${outline.length} headings`);
  } catch (e) {
    console.log(`${name}: ${e.message.split('\n')[0]}`);
  }
  await page.close();
}
await browser.close();
console.log(`Saved to ${out}`);
