/** Visual judge: PNG decoding and pixel diff against approved baselines (docs/spec/concepts.md#visual-baselines). */
import { inflateSync } from 'node:zlib';
import type { RunRecord } from '@indx-watch/bundle';

export interface Image {
  width: number;
  height: number;
  /** 4 bytes per pixel */
  rgba: Uint8Array;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** channels per color type (gray, RGB, palette, gray + alpha, RGBA) */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Reverses the scanline filters in place; returns the raw rows without filter bytes. */
function unfilter(data: Uint8Array, height: number, stride: number, bpp: number) {
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const type = data[y * (stride + 1)]!;
    const [src, row, prev] = [y * (stride + 1) + 1, y * stride, (y - 1) * stride];
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[row + x - bpp]! : 0;
      const b = y > 0 ? out[prev + x]! : 0;
      const c = x >= bpp && y > 0 ? out[prev + x - bpp]! : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][type];
      if (pred === undefined) throw new Error(`invalid PNG filter ${type}`);
      out[row + x] = (data[src + x]! + pred) & 0xff;
    }
  }
  return out;
}

/** Decodes an 8-bit, non-interlaced PNG (what browsers and Playwright write) to RGBA. */
export function decodePng(buf: Uint8Array): Image {
  if (!SIGNATURE.every((b, i) => buf[i] === b)) throw new Error('not a PNG');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const chunks = new Map<string, Uint8Array[]>();
  for (let at = 8; at + 8 <= buf.length; at += view.getUint32(at) + 12) {
    const type = String.fromCharCode(...buf.subarray(at + 4, at + 8));
    chunks.set(type, [...(chunks.get(type) ?? []), buf.subarray(at + 8, at + 8 + view.getUint32(at))]);
  }
  const [h = new Uint8Array(13), palette = new Uint8Array(), alpha = new Uint8Array()] = [
    'IHDR',
    'PLTE',
    'tRNS',
  ].map((t) => chunks.get(t)?.[0]);
  const hv = new DataView(h.buffer, h.byteOffset, h.byteLength);
  const [width, height, depth, color, interlace] = [hv.getUint32(0), hv.getUint32(4), h[8]!, h[9]!, h[12]];
  const ch = CHANNELS[color];
  if (!width || !height || !ch) throw new Error('invalid PNG header');
  if (depth !== 8 || interlace) throw new Error('only 8-bit, non-interlaced PNGs are supported');
  const raw = unfilter(inflateSync(Buffer.concat(chunks.get('IDAT') ?? [])), height, width * ch, ch);
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = raw.subarray(i * ch, i * ch + ch);
    const px =
      color === 3
        ? [...palette.subarray(s[0]! * 3, s[0]! * 3 + 3), alpha[s[0]!] ?? 255]
        : ch < 3
          ? [s[0]!, s[0]!, s[0]!, ch === 2 ? s[1]! : 255]
          : [s[0]!, s[1]!, s[2]!, ch === 4 ? s[3]! : 255];
    rgba.set(px, i * 4);
  }
  return { width, height, rgba };
}

/** A pixel counts as changed when any RGBA channel differs by more than this (of 255). */
const TOLERANCE = 8;

/** Changed pixels / all pixels, rounded to 6 decimals; 1 when the sizes differ. */
export function diffRatio(a: Image, b: Image): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let changed = 0;
  for (let i = 0; i < a.rgba.length; i += 4)
    for (let c = 0; c < 4; c++)
      if (Math.abs(a.rgba[i + c]! - b.rgba[i + c]!) > TOLERANCE) {
        changed++;
        break;
      }
  return Math.round((changed / (a.width * a.height)) * 1e6) / 1e6;
}

/** Verdict fields of one visual judgement: the screenshot compared with its baseline (null: none approved). */
export function compareShot(shot: Uint8Array | null, base: Uint8Array | null) {
  if (!base)
    return { verdict: 'unknown' as const, reason: 'no approved baseline (iw baseline approve <run>)' };
  try {
    if (!shot) throw new Error('screenshot blob not found');
    const [a, b] = [decodePng(shot), decodePng(base)];
    const diff_ratio = diffRatio(a, b);
    const size = (x: Image) => `${x.width}×${x.height}`;
    if (!diff_ratio) return { verdict: 'pass' as const, diff_ratio, reason: 'identical to the baseline' };
    const why = diff_ratio === 1 && size(a) !== size(b) ? `size ${size(a)}, baseline ${size(b)}` : '';
    const reason = why || `${(diff_ratio * 100).toFixed(2)}% of pixels changed`;
    return { verdict: 'diff' as const, diff_ratio, reason };
  } catch (e) {
    return { verdict: 'unknown' as const, reason: `cannot compare: ${(e as Error).message}` };
  }
}

/** PNG screenshots of a run, optionally only the one with this evidence name. */
export const pngShots = (run: RunRecord, name?: string) =>
  run.evidence.filter((e) => e.media_type === 'image/png' && (!name || e.name === name));
