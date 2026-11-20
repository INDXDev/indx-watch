import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { iw, ROOT, serve, shopCopy, tempDir } from './helpers';

const SHOP = join(ROOT, 'examples/shop');

/** Every file under `dir` whose bytes contain `needle` (binary files included). */
function filesContaining(dir: string, needle: string): string[] {
  const bytes = Buffer.from(needle);
  return readdirSync(dir, { recursive: true, encoding: 'utf8', withFileTypes: false })
    .map((f) => join(dir, f))
    .filter((f) => {
      try {
        return readFileSync(f).includes(bytes);
      } catch {
        return false; // a directory
      }
    });
}

// docs/spec/security.md, acceptance criterion: no resolved secret value in records, the index or reports.
test('secret values never leave as values', { tag: ['@TC-11'] }, async () => {
  test.setTimeout(180_000);
  // Shaped like a real password, not like a token, so it tests leaks rather than the secret scan.
  const sentinel = `Sentinel-${randomBytes(9).toString('hex')}`;
  const dir = shopCopy();
  const store = tempDir('iw-secret-store-');
  const reports = tempDir('iw-secret-reports-');

  await test.step('1. run the shop sign-in test with the reporter, a folder store and the sentinel password', async () => {
    const out = execFileSync(
      'pnpm', // own --output: reporter.spec.ts runs the shop tests in parallel and Playwright clears its output folder
      ['exec', 'playwright', 'test', '--grep', '@TC-7', '--output', tempDir('iw-secret-results-')],
      {
        cwd: SHOP,
        encoding: 'utf8',
        stdio: 'pipe',
        env: {
          ...process.env,
          IW_REPORTER: '1',
          IW_DIR: join(dir, '.indx-watch'),
          IW_STORE: `file://${store}`,
          IW_RELEASE: 'v1.2.0',
          SHOP_CUSTOMER_PASSWORD: sentinel,
          PORT: '4198',
        },
      },
    );
    expect(out).toContain('TC-7');
    expect(out).toMatch(/pushed 1 record/);
  });

  await test.step('2. search the replica, store, cache, server views and reports for the sentinel', async () => {
    const env = { IW_STORE: `file://${store}`, SHOP_CUSTOMER_PASSWORD: sentinel };
    expect(iw(['sync'], { cwd: dir, env }).code).toBe(0);
    expect(iw(['reindex'], { cwd: dir, env }).code).toBe(0);
    for (const format of ['html', 'md', 'json'])
      for (const audience of ['internal', 'customer'])
        expect(
          iw(
            ['report', '--release', 'v1.2.0', '--format', format, '--audience', audience, '--out'].concat(
              join(reports, `${audience}.${format}`),
            ),
            { cwd: dir, env },
          ).code,
        ).toBe(0);
    const server = await serve(dir, env);
    const views: string[] = [];
    try {
      const get = async (path: string) => {
        const res = await fetch(`${server.url}${path}`);
        expect(res.ok, path).toBe(true);
        return res.text();
      };
      for (const path of ['/api/project', '/api/status', '/api/specs', '/api/fixtures', '/api/runs'])
        views.push(await get(path));
      views.push(await get('/api/fixtures/FX-3'));
      const runs = JSON.parse(views.at(-2)!) as { id: string }[] | { items: { id: string }[] };
      for (const r of (Array.isArray(runs) ? runs : runs.items).slice(0, 20))
        views.push(await get(`/api/runs/${r.id}`));
      views.push(await get('/api/report?release=v1.2.0&format=html'));
    } finally {
      server.stop();
    }
    expect(views.filter((v) => v.includes(sentinel))).toEqual([]);
    expect(filesContaining(dir, sentinel)).toEqual([]); // replica, cache, bundle
    expect(filesContaining(store, sentinel)).toEqual([]);
    expect(filesContaining(reports, sentinel)).toEqual([]);
    expect(readdirSync(reports)).toHaveLength(6);
  });
});
