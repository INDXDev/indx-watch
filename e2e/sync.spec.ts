import { type ChildProcess, spawn } from 'node:child_process';
import { cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { iw, ROOT, shopCopy, tempDir } from './helpers';

/** `iw sync --watch` in cwd; resolves once it watches the store. */
function syncWatch(cwd: string, env: Record<string, string>): Promise<ChildProcess> {
  const bin = join(ROOT, 'packages/cli/dist/bin.js');
  const { IW_DIR: _, ...parent } = process.env; // the clone is found from cwd
  const child = spawn(process.execPath, [bin, 'sync', '--watch'], {
    cwd,
    env: { ...parent, NO_COLOR: '1', IW_ACTOR: 'e2e@indx.dev', ...env },
  });
  return new Promise((ok, fail) => {
    let out = '';
    const seen = (d: Buffer) => {
      out += String(d);
      if (out.includes('Watching the store')) ok(child);
    };
    child.stdout.on('data', seen);
    child.stderr.on('data', seen);
    child.once('exit', (code) => fail(new Error(`iw sync --watch exited ${code}: ${out}`)));
  });
}

test('two clones sync through a folder store', { tag: ['@TC-6'] }, async () => {
  const store = tempDir('iw-store-');
  const a = shopCopy();
  const b = tempDir('iw-clone-');
  cpSync(join(a, '.indx-watch'), join(b, '.indx-watch'), { recursive: true });
  const env = { IW_STORE: `file://${store}` };
  await test.step('1. record in A, sync both, B sees the run', async () => {
    const shot = join(a, 'shot.png');
    writeFileSync(shot, Buffer.from('89504e470d0a1a0a', 'hex'));
    const rec = iw(
      [
        'record',
        'TC-8',
        '--verdict',
        'pass',
        '--step',
        '1=pass',
        '--step',
        '2=pass',
        '--evidence',
        `${shot}@1`,
        '--release',
        'v1.2.0',
        '--json',
      ],
      { cwd: a, env },
    );
    expect(rec.code, rec.stderr).toBe(0);
    expect(iw(['sync', '--json'], { cwd: a, env }).code).toBe(0);
    expect(iw(['sync', '--json'], { cwd: b, env }).code).toBe(0);
    const runs = iw(['list', 'runs', '--json'], { cwd: b, env });
    expect(runs.json.data.items.some((r: { id: string }) => r.id === rec.json.data.run.id)).toBe(true);
  });
  await test.step('2. a second sync transfers nothing', async () => {
    const again = iw(['sync', '--json'], { cwd: a, env });
    expect(again.json.data.pushed).toEqual({ records: 0, blobs: 0 });
    expect(again.json.data.pulled.records).toBe(0);
  });
  await test.step('3. with iw sync --watch in both, a run recorded in A shows in B within 5 s', async () => {
    const spawned = await Promise.allSettled([syncWatch(a, env), syncWatch(b, env)]);
    const watchers = spawned.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
    const failed = spawned.find((s) => s.status === 'rejected');
    if (failed) for (const w of watchers) w.kill('SIGTERM');
    if (failed) throw failed.reason;
    try {
      const tc1 = () =>
        iw(['status', '--release', 'v1.2.0', '--json'], { cwd: b, env }).json.data.testCases.find(
          (t: { key: string }) => t.key === 'TC-1',
        ).status;
      expect(tc1()).toBe('untested');
      const started = Date.now();
      const rec = iw(['record', 'TC-1', '--verdict', 'pass', '--release', 'v1.2.0', '--json'], {
        cwd: a,
        env,
      });
      expect(rec.code, rec.stderr).toBe(0);
      await expect.poll(tc1, { timeout: 5000, intervals: [100] }).toBe('pass');
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      for (const w of watchers) w.kill('SIGTERM');
    }
  });
});
