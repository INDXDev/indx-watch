import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { ROOT, tempDir } from './helpers';

const SHOP = join(ROOT, 'examples/shop');

function runRecords(): {
  id: string;
  test_case: { key: string; version: string };
  fixtures: unknown[];
  build: { commit?: string };
  actor: unknown;
}[] {
  const dir = join(SHOP, '.indx-watch/runs/records');
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
    .filter((r) => r.kind === 'run');
}

test('reporter links runs to test cases', { tag: ['@TC-7'] }, async () => {
  test.setTimeout(180_000);
  await test.step('1. run the shop tests with the INDX Watch reporter', async () => {
    let before: string[] = [];
    try {
      before = runRecords().map((r) => r.id);
    } catch {}
    execFileSync('pnpm', ['exec', 'playwright', 'test', '--grep', '@TC-3|@TC-7'], {
      cwd: SHOP,
      stdio: 'pipe',
      env: { ...process.env, IW_REPORTER: '1', IW_STORE: `file://${tempDir('iw-store-')}`, PORT: '4199' },
    });
    const fresh = runRecords().filter((r) => !before.includes(r.id));
    const keys = fresh.map((r) => r.test_case.key).sort();
    expect(keys).toEqual(['TC-3', 'TC-7']);
    for (const r of fresh) {
      expect(r.test_case.version).toMatch(/^tcv:[0-9a-f]{12}$/);
      expect(r.fixtures.length).toBeGreaterThan(0);
      expect(r.build.commit).toMatch(/^[0-9a-f]{7,}$/);
      expect(r.actor).toBeTruthy();
    }
  });
});
