/** Visual judge: PNG decoding, pixel diff, `iw baseline approve` and `iw judge --visual` (docs/spec/concepts.md#visual-baselines). */
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { compareShot, decodePng, diffRatio } from '../src/visual.js';
import { read, TC3 } from './cli-fixtures.js';
import { iwJson, shop } from './helpers.js';

/** A tiny RGBA (color type 6) or RGB (2) PNG; `px(x, y)` gives each pixel, rows use filter `filter`. */
function png(w: number, h: number, px: (x: number, y: number) => number[], color = 6, filter = 0) {
  const ch = color === 6 ? 4 : 3;
  const raw: number[] = [];
  for (let y = 0; y < h; y++) {
    const row = Array.from({ length: w }, (_, x) => px(x, y).slice(0, ch)).flat();
    // filter 1 (Sub): each byte minus the byte one pixel to the left
    raw.push(filter, ...(filter === 1 ? row.map((v, i) => (v - (i >= ch ? row[i - ch]! : 0)) & 255) : row));
  }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, color, 0, 0, 0], 8);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = deflateSync(Buffer.from(raw));
  return new Uint8Array(
    Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]),
  );
}

const white = () => [255, 255, 255, 255];
/** 10×10 white with the top-left `n` pixels of the first row red. */
const shot = (n: number) => png(10, 10, (x, y) => (y === 0 && x < n ? [255, 0, 0, 255] : white()));

describe('visual: PNG decoding and diff', () => {
  it('decodes RGBA and RGB with filters, and counts changed pixels', () => {
    const a = decodePng(png(3, 2, (x, y) => [x * 10, y * 20, 30, 200]));
    expect([a.width, a.height, ...a.rgba.subarray(4, 8)]).toEqual([3, 2, 10, 0, 30, 200]);
    const b = decodePng(png(3, 2, (x, y) => [x * 10, y * 20, 30], 2, 1));
    expect([...b.rgba.subarray(20, 24)]).toEqual([20, 20, 30, 255]);
    expect(diffRatio(decodePng(shot(0)), decodePng(shot(3)))).toBe(0.03);
    // differences within the tolerance (8 of 255) do not count
    expect(diffRatio(decodePng(shot(0)), decodePng(png(10, 10, () => [250, 250, 250, 255])))).toBe(0);
    expect(diffRatio(decodePng(shot(0)), decodePng(png(5, 5, white)))).toBe(1);
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow('not a PNG');
  });

  it('maps a comparison to judgement fields', () => {
    expect(compareShot(shot(0), shot(0))).toMatchObject({ verdict: 'pass', diff_ratio: 0 });
    expect(compareShot(shot(2), shot(0))).toMatchObject({ verdict: 'diff', diff_ratio: 0.02 });
    expect(compareShot(png(5, 5, white), shot(0)).reason).toBe('size 5×5, baseline 10×10');
    expect(compareShot(shot(0), undefined).reason).toMatch(/no approved baseline/);
    expect(compareShot(shot(0), null).reason).toBe('cannot compare: baseline blob not found');
    expect(compareShot(new Uint8Array([0]), shot(0))).toMatchObject({ verdict: 'unknown' });
  });
});

describe('commands: baseline approve and judge --visual', () => {
  it('a human approves a baseline; later runs get pass or diff visual judgements', () => {
    const dir = shop();
    writeFileSync(
      join(dir, '.indx-watch', TC3),
      `${read(dir, TC3)}\n[[judges]]\nkind = "assert"\n\n[[judges]]\nkind = "visual"\n`,
    );
    const ci = { env: { IW_ACTOR_KIND: 'ci' } };
    const runWith = (n: number) => {
      writeFileSync(join(dir, 'total.png'), shot(n));
      const args = ['record', 'TC-3', '--verdict', 'pass', '--evidence', 'total.png@2'];
      return iwJson(dir, 'record', args, ci).json.data.run.id as string;
    };
    const first = runWith(0);
    // no approved baseline yet: unknown, so the run needs review
    const none = iwJson(dir, 'judge', ['judge', first, '--visual'], ci).json.data;
    expect(none).toMatchObject({
      verdict: 'needs_review',
      judgements: [{ kind: 'visual', verdict: 'unknown' }],
    });

    const agent = iwJson(dir, 'baseline approve', ['baseline', 'approve', first], {
      env: { IW_ACTOR_KIND: 'agent' },
    });
    expect([agent.code, agent.json.error.code]).toEqual([2, 'USAGE']);
    expect(iwJson(dir, 'baseline approve', ['baseline', 'approve', first], ci).code).toBe(2);
    const ok = iwJson(dir, 'baseline approve', ['baseline', 'approve', first]).json.data.baselines;
    expect(ok).toMatchObject([
      { kind: 'baseline', name: 'total.png', test_case: { key: 'TC-3' }, run: first },
    ]);
    const missing = iwJson(dir, 'baseline approve', ['baseline', 'approve', first, '--name', 'nope.png']);
    expect(missing.code).toBe(2);

    const same = runWith(0);
    const pass = iwJson(dir, 'judge', ['judge', same, '--visual'], ci).json.data;
    expect(pass).toMatchObject({
      verdict: 'pass',
      recorded: true,
      judgement: { verdict: 'pass', test: 'total.png' },
    });
    expect(pass.judgement.baseline).toBe(ok[0].sha256);

    // a baseline blob that is not local (evidence = on-demand) is read from the store
    expect(iwJson(dir, 'sync', ['sync', '--push-only']).code).toBe(0);
    const sha = ok[0].sha256 as string;
    const local = join(dir, '.indx-watch/runs/blobs/sha256', sha.slice(0, 2), sha);
    rmSync(local);
    const again = iwJson(dir, 'judge', ['judge', same, '--visual', '--dry-run'], ci).json.data;
    expect(again.judgement).toMatchObject({ verdict: 'pass', baseline: sha });

    const changed = runWith(5); // 5% of pixels changed, over visual_threshold 0.01
    const dry = iwJson(dir, 'judge', ['judge', changed, '--visual', '--dry-run'], ci).json.data;
    expect(dry).toMatchObject({ recorded: false, judgement: { verdict: 'diff', diff_ratio: 0.05 } });
    const diff = iwJson(dir, 'judge', ['judge', changed, '--visual'], ci).json.data;
    expect(diff.verdict).toBe('needs_review');
    expect(iwJson(dir, 'show', ['show', changed]).json.data.decision.rule).toBe(5);
    // within the threshold a diff counts as a pass (rule 8)
    const small = runWith(1);
    expect(iwJson(dir, 'judge', ['judge', small, '--visual'], ci).json.data.verdict).toBe('pass');
    // missing everywhere: unknown, and the reason names the missing blob
    rmSync(join(dir, 'store/v1/blobs/sha256', sha.slice(0, 2), sha));
    const gone = iwJson(dir, 'judge', ['judge', runWith(2), '--visual', '--dry-run'], ci).json.data;
    expect(gone.judgement).toMatchObject({ verdict: 'unknown', baseline: sha });
    expect(gone.judgement.reason).toBe('cannot compare: baseline blob not found');

    const plain = iwJson(dir, 'record', ['record', 'TC-1', '--verdict', 'pass'], ci).json.data.run.id;
    expect(iwJson(dir, 'judge', ['judge', plain, '--visual'], ci).code).toBe(2);
  }, 60_000); // spawns the CLI a dozen times; 20 s was too tight on CI runners
});
