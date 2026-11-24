/** `iw check` over ui/ with the app's real English texts (T-507). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { iwJson, shop } from './helpers.js';

const ui = (dir: string, file: string, text: string) => {
  mkdirSync(join(dir, '.indx-watch/ui'), { recursive: true });
  writeFileSync(join(dir, '.indx-watch/ui', file), text);
};

describe('iw check: ui/', () => {
  it('accepts overrides of keys the app has and rejects the rest', () => {
    const dir = shop();
    ui(dir, 'messages.en.json', '{ "nav.skip": "Jump to content" }');
    ui(dir, 'theme.toml', '[light]\naccent = "#0b6b50"\naccent-text = "#ffffff"\n');
    expect(iwJson(dir, 'check', ['check']).code).toBe(0);

    ui(dir, 'messages.ja.json', '{ "nav.skip": "<b>x</b>", "not.a.key": "x" }');
    const r = iwJson(dir, 'check', ['check']);
    expect(r.code).toBe(1);
    const codes = r.json.data.problems
      .map((p: { code: string }) => p.code)
      .filter((c: string) => c !== 'missing-blob')
      .sort();
    expect(codes).toEqual(['ui-markup', 'unknown-ui-key']);
  });
});
