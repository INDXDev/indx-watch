import { defineConfig, devices, type ReporterDescription } from '@playwright/test';

const port = Number(process.env.PORT ?? 4173);
const baseURL = process.env.SHOP_BASE_URL ?? `http://localhost:${port}`;

// The INDX Watch reporter records one run per tagged test case. Set IW_REPORTER=0 to run without it.
// 'indx-watch/playwright' comes from the `indx-watch` npm package; in this monorepo it is the workspace CLI package
// (run `pnpm build` first, which writes packages/cli/dist/playwright.js).
const reporter: ReporterDescription[] = [['list']];
// Results stay in the local replica unless IW_STORE is set, so local runs never touch the committed sample store.
if (process.env.IW_REPORTER !== '0')
  reporter.push(['indx-watch/playwright', { sync: Boolean(process.env.IW_STORE) }]);

export default defineConfig({
  testDir: './tests',
  reporter,
  use: { baseURL, screenshot: 'on', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      // PW_CHROMIUM_PATH: use an already installed Chromium instead of `npx playwright install`.
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } },
    },
  ],
  webServer: process.env.SHOP_BASE_URL
    ? undefined
    : { command: 'node app/server.mjs', url: baseURL, reuseExistingServer: !process.env.CI },
});
