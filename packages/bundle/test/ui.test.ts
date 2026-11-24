/** ui/, [report] and patches/ (docs/spec/bundle-format.md#customizing-v05). */
import { describe, expect, it } from 'vitest';
import { checkBundle } from '../src/check.js';
import { loadBundle } from '../src/load.js';
import { themeCss } from '../src/ui.js';
import { codes, edit } from './check-helpers.js';
import { memFs } from './helpers.js';

const enc = new TextEncoder();
const EN = { 'nav.tests': 'Tests', 'problems.title': '{count, plural, one {# problem} other {# problems}}' };
const put = (fs: ReturnType<typeof memFs>, path: string, text: string | Uint8Array) =>
  fs.files.set(path, typeof text === 'string' ? enc.encode(text) : text);
const check = (fs: ReturnType<typeof memFs>) => checkBundle(fs, { uiMessages: EN } as never);

describe('ui/messages.<locale>.json', () => {
  it('loads valid overrides and the shop stays clean', async () => {
    const fs = memFs();
    put(fs, 'ui/messages.ja.json', '{ "nav.tests": "確認" }');
    const { bundle, problems } = await loadBundle(fs);
    expect(problems).toEqual([]);
    expect(bundle?.ui?.messages).toEqual({ ja: { 'nav.tests': '確認' } });
    expect((await check(fs)).problems).toEqual([]);
    expect((await loadBundle(memFs())).bundle?.ui).toBeUndefined();
  });

  it('rejects unknown keys, changed placeholders, markup, bad JSON and unknown locales', async () => {
    const fs = memFs();
    put(
      fs,
      'ui/messages.en.json',
      '{ "nav.nope": "x", "nav.tests": "<b>Checks</b>", "problems.title": "{n} issues" }',
    );
    put(fs, 'ui/messages.fr.json', '{}');
    put(fs, 'ui/messages.ja.json', '{ nope');
    const r = await check(fs);
    expect(codes(r).sort()).toEqual([
      'invalid-ui',
      'invalid-ui',
      'ui-markup',
      'ui-placeholder',
      'unknown-ui-key',
    ]);
    // customizing problems never fail the gate: the bundle still loads and no file counts as invalid
    const { bundle } = await loadBundle(fs);
    expect(bundle?.invalidFiles).toEqual([]);
    expect(bundle?.ui?.messages.en).toEqual({ 'nav.nope': 'x', 'problems.title': '{n} issues' });
  });
});

describe('ui/theme.toml', () => {
  it('turns allowlisted tokens into CSS for light, dark and the rest', async () => {
    const fs = memFs();
    put(
      fs,
      'ui/theme.toml',
      '[light]\naccent = "#0b6b50"\n\n[dark]\naccent = "#6fd3b0"\n\n[common]\nradius = "4px"\n',
    );
    const { bundle, problems } = await loadBundle(fs);
    expect(problems).toEqual([]);
    expect(themeCss(bundle?.ui?.theme)).toBe(
      [
        ':root{--radius:4px;--accent:#0b6b50;}',
        '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--accent:#6fd3b0;}}',
        ':root[data-theme="dark"]{--accent:#6fd3b0;}',
      ].join('\n'),
    );
    expect(themeCss(undefined)).toBe('');
  });

  it('rejects unknown tokens and tables and anything but plain values', async () => {
    const fs = memFs();
    put(
      fs,
      'ui/theme.toml',
      '[light]\npass = "#000000"\naccent = "red; } body { display:none"\nbg = "url(x)"\n\n[sepia]\nbg = "#fff"\n\n[common]\nfont-sans = "x; y"\n',
    );
    const r = await check(fs);
    expect(codes(r).sort()).toEqual([
      'invalid-ui',
      'invalid-ui',
      'invalid-ui',
      'invalid-ui',
      'unknown-ui-key',
    ]);
    expect(themeCss((await loadBundle(fs)).bundle?.ui?.theme)).toBe('');
  });

  it('warns about a low contrast pair', async () => {
    const fs = memFs();
    put(fs, 'ui/theme.toml', '[light]\ntext = "#cccccc"\nbg = "#ffffff"\n');
    const r = await check(fs);
    expect(codes(r, 'warning')).toEqual(['low-contrast']);
    expect(codes(r)).toEqual([]);
  });
});

describe('[report]', () => {
  const withReport = (fs: ReturnType<typeof memFs>, logo: string) =>
    edit(fs, 'project.toml', (t) => `${t}\n[report]\ntitle = "Shop QA"\nlogo = "${logo}"\n`);

  it('embeds a usable logo and rejects a missing, misplaced or large one', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const ok = memFs();
    put(ok, 'ui/logo.png', png);
    withReport(ok, 'ui/logo.png');
    expect((await loadBundle(ok)).bundle?.ui?.logo).toMatch(/^data:image\/png;base64,/);
    expect(codes(await check(ok))).toEqual([]);

    const missing = memFs();
    withReport(missing, 'ui/none.png');
    expect(codes(await check(missing))).toEqual(['invalid-logo']);
    const outside = memFs();
    put(outside, 'logo.png', png);
    withReport(outside, 'logo.png');
    expect(codes(await check(outside))).toContain('invalid-logo');
    const big = memFs();
    put(big, 'ui/logo.png', new Uint8Array(200_001));
    withReport(big, 'ui/logo.png');
    expect(codes(await check(big))).toEqual(['invalid-logo']);
  });
});

describe('patches/', () => {
  it('is not loaded, scanned or warned about', async () => {
    const fs = memFs();
    put(fs, 'patches/patches.toml', 'base = "0.1.2"\n');
    put(fs, 'patches/0001-x.patch', '+const password = "hunter2hunter2"\n');
    const r = await check(fs);
    expect(r.problems).toEqual([]);
  });
});
