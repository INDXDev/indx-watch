import { cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { iw, shopCopy, tempDir } from './helpers';

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
});
