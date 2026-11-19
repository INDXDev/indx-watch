import { defineConfig } from '@playwright/test';

// Dogfooding: these tests implement the test cases in /.indx-watch (tagged @TC-n) and are recorded with our own reporter.
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list'], ['@indx-watch/playwright', { dir: '../.indx-watch' }]],
  use: {
    screenshot: 'on',
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
});
