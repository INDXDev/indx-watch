/**
 * Real run: the shop's Playwright tests with the reporter (docs/spec/integrations.md#acceptance-criteria).
 * Needs a Chromium: PW_CHROMIUM_PATH, or the pre-installed /opt/pw-browsers/chromium. Records land in the
 * git-ignored examples/shop/.indx-watch/runs/; the push goes to a temporary store, not examples/shop/store.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadBundle, newUlid, type RunRecord } from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { openReplica } from '@indx-watch/store/node';
import { afterAll, describe, expect, it } from 'vitest';

const SHOP = resolve(import.meta.dirname, '../../../examples/shop');
const chromium = process.env.PW_CHROMIUM_PATH || ['/opt/pw-browsers/chromium'].find((p) => existsSync(p));
const store = mkdtempSync(join(tmpdir(), 'iw-pw-store-'));
afterAll(() => rmSync(store, { recursive: true, force: true }));

describe.skipIf(!chromium)('examples/shop with the reporter', () => {
  it('writes one run per tagged test case with versions, commit, actor and screenshots', async () => {
    const group = `vitest-${newUlid()}`;
    const res = spawnSync(join(SHOP, 'node_modules/.bin/playwright'), ['test'], {
      cwd: SHOP,
      encoding: 'utf8',
      timeout: 180_000,
      env: {
        ...process.env,
        IW_REPORTER: '1',
        IW_RUN_GROUP: group,
        IW_STORE: `file://${store}`,
        PW_CHROMIUM_PATH: chromium,
        PORT: String(4400 + Math.floor(Math.random() * 500)),
      },
    });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toContain('[indx-watch] 6 run(s)');

    const dir = join(SHOP, '.indx-watch');
    const replica = openReplica(dir);
    const runs = ((await replica.records()) as RunRecord[]).filter((r) => r.automation?.group === group);
    expect(runs.map((r) => r.test_case.key).sort()).toEqual(['TC-1', 'TC-2', 'TC-3', 'TC-4', 'TC-5', 'TC-7']);
    const { bundle } = await loadBundle(nodeFs(dir));
    for (const run of runs) {
      const tc = bundle!.testCases.find((t) => t.data.key === run.test_case.key)!;
      expect(run.test_case.version).toBe(tc.version);
      expect(run.build.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(run.actor.id).toBeTruthy();
      expect(run.automation).toMatchObject({ framework: 'playwright', project: 'chromium' });
      expect(run.judgements).toMatchObject([{ kind: 'assert', verdict: 'pass' }]);
      const shot = run.evidence.find((e) => e.kind === 'screenshot');
      expect(shot && (await replica.hasBlob(shot.sha256))).toBe(true);
      for (const fx of run.fixtures)
        expect(fx.version).toBe(bundle!.fixtures.find((f) => f.data.key === fx.key)!.version);
    }
    const tc3 = runs.find((r) => r.test_case.key === 'TC-3')!;
    expect(tc3.fixtures.find((f) => f.key === 'FX-1')?.rows).toEqual(['SUMMER10']);
    expect(tc3.steps.map((s) => s.index)).toEqual([1, 2]);
    expect(readdirSync(join(store, 'v1', 'log')).length).toBeGreaterThan(0);
  }, 200_000);
});
