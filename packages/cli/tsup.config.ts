/**
 * Build of the published `indx-watch` package: every @indx-watch/* workspace package is bundled in;
 * the runtime dependencies in package.json stay external.
 *   dist/bin.js        `iw` / `indx-watch` (shebang from src/bin.ts)
 *   dist/api.js        'indx-watch' and 'indx-watch/api'
 *   dist/playwright.js 'indx-watch/playwright' (the reporter from packages/playwright)
 *   dist/worker.js     the Cloudflare Worker for `iw deploy`, with every dependency bundled
 */
import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
const reporter = '../playwright/src/index.ts';
if (!existsSync(reporter))
  console.warn('packages/playwright/src/index.ts not found: dist/playwright.js is skipped');

export default defineConfig([
  {
    entry: {
      bin: 'src/bin.ts',
      api: 'src/api.ts',
      ...(existsSync(reporter) ? { playwright: reporter } : {}),
    },
    format: 'esm',
    platform: 'node',
    target: 'node22',
    splitting: true,
    dts: false,
    noExternal: [/^@indx-watch\//],
    external: ['@playwright/test', 'playwright', 'playwright-core'],
    removeNodeProtocol: false, // node:sqlite has no unprefixed name
    define: { __IW_VERSION__: JSON.stringify(version) },
  },
  {
    entry: { worker: 'src/worker.ts' },
    format: 'esm',
    platform: 'neutral',
    target: 'es2023',
    splitting: false,
    noExternal: [/.*/],
    external: [/^node:/, 'cloudflare:workers'],
    esbuildOptions(o) {
      o.conditions = ['workerd', 'worker', 'browser', 'import', 'default'];
      o.mainFields = ['module', 'main'];
    },
  },
]);
