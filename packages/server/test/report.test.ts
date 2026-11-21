// renderReport over the examples/shop bundle and sample records: snapshots, audiences, evidence, locales and CSS.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildModel, type Model, reportData } from '@indx-watch/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderReport, reportTexts } from '../src/index.js';
import { tokens } from '../src/report.js';
import STYLE from '../src/report-style.json' with { type: 'json' };
import { NOW, ROOT, SHOT, SHOT_SHA, sampleRecords, shop } from './helpers.js';

let model: Model;
beforeAll(async () => {
  const b = await shop();
  model = buildModel(b, sampleRecords(b)).model;
});

const getBlob = async (sha: string) => (sha === SHOT_SHA ? SHOT : null);
async function render(o: {
  format: 'md' | 'html';
  audience?: 'internal' | 'customer';
  locale?: 'en' | 'ja';
  evidence?: 'none' | 'links' | 'embed';
  plan?: string;
}) {
  const locale = o.locale ?? 'en';
  const data = reportData(
    model,
    { release: 'v1.2.0', environment: 'staging' },
    {
      audience: o.audience ?? 'internal',
      generatedBy: 'qa@shop.test',
      now: NOW,
      ...(o.plan ? { plan: o.plan } : {}),
    },
  );
  return renderReport(Object.assign(data, { texts: await reportTexts(model, locale) }), {
    format: o.format,
    locale,
    evidence: o.evidence ?? (o.format === 'html' ? 'embed' : 'links'),
    getBlob,
  });
}

const FORMATS = ['md', 'html'] as const;
const LOCALES = ['en', 'ja'] as const;
/** every format × locale pair */
const formatsAndLocales = FORMATS.flatMap((format) => LOCALES.map((locale) => ({ format, locale })));

/** Strings of the shop's records and bundle that a customer report must not contain. */
const INTERNAL_ONLY = [
  'internal note',
  'Total stayed',
  'VPN',
  'Layout looks fine',
  'Matches the copy deck',
  'localhost:4173',
  'No VPN is needed',
  'github.com',
  'SHOP_CUSTOMER_PASSWORD',
];

/** The shop bundle with a "Bundle note …" on the project, every feature, use case, criterion, test case, fixture and plan item. */
async function shopWithNotes() {
  const b = await shop();
  const set = (o: { notes?: string }, n: string) =>
    Object.assign(o, { notes: `Bundle note ${n} (do not share)` });
  set(b.project.data, 'project');
  for (const f of b.features) set(f.data, f.data.key);
  for (const u of b.useCases) {
    set(u.data, u.data.key);
    for (const c of u.data.criteria) set(c, c.key);
  }
  for (const t of b.testCases) set(t.data, t.data.key);
  for (const x of b.fixtures) set(x.data, x.data.key);
  for (const p of b.plans)
    for (const [i, item] of (p.data.items ?? []).entries()) set(item, `${p.data.key}#${i}`);
  return b;
}

/** A customer report of `m` with embedded evidence, for the whole release or one plan. */
async function customerReport(m: Model, o: { plan?: string; format: 'md' | 'html'; locale: 'en' | 'ja' }) {
  const scope = { release: 'v1.2.0', environment: 'staging' };
  const opts = {
    audience: 'customer',
    generatedBy: 'qa@shop.test',
    now: NOW,
    ...(o.plan ? { plan: o.plan } : {}),
  } as const;
  const data = Object.assign(reportData(m, scope, opts), { texts: await reportTexts(m, o.locale) });
  return renderReport(data, { format: o.format, locale: o.locale, evidence: 'embed', getBlob });
}

describe('renderReport on examples/shop: snapshots', () => {
  it('Markdown (internal, en)', async () => {
    await expect(await render({ format: 'md' })).toMatchFileSnapshot('__snapshots__/shop-v1.2.0.md');
  });

  it('Markdown plan report (customer, ja)', async () => {
    const md = await render({ format: 'md', audience: 'customer', locale: 'ja', plan: 'PLAN-1' });
    await expect(md).toMatchFileSnapshot('__snapshots__/shop-plan-1.customer.ja.md');
  });

  it('HTML (internal, embedded evidence)', async () => {
    const html = await render({ format: 'html' });
    await expect(html).toMatchFileSnapshot('__snapshots__/shop-v1.2.0.html');
    expect(html).toContain(`src="data:image/png;base64,`);
  });

  it('HTML is one self-contained file: no scripts, no external resources, light and dark, printable', async () => {
    for (const audience of ['internal', 'customer'] as const) {
      const html = await render({ format: 'html', audience });
      expect(html).not.toMatch(/<script|<link|@import|url\(/i);
      expect(html).not.toMatch(/\ssrc="(?!data:)/);
      expect(html).toContain('@media screen and (prefers-color-scheme:dark)');
      expect(html).toContain('@media print');
    }
  });
});

describe('renderReport on examples/shop: audiences', () => {
  it('customer audience: no emails, notes, judgement reasons, environment details or CI links', async () => {
    for (const { format, locale } of formatsAndLocales) {
      const out = await render({ format, audience: 'customer', locale, evidence: 'embed' });
      expect(out).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      for (const secret of INTERNAL_ONLY) expect(out, `${format}/${locale}: ${secret}`).not.toContain(secret);
      expect(out).toContain('QA team');
    }
  });

  it('customer audience: no notes from the bundle', async () => {
    const b = await shopWithNotes();
    const m = buildModel(b, sampleRecords(b)).model;
    for (const plan of [undefined, 'PLAN-1'])
      for (const { format, locale } of formatsAndLocales) {
        const out = await customerReport(m, { plan, format, locale });
        expect(out, `${plan}/${format}/${locale}`).not.toContain('Bundle note');
      }
  });

  it('internal audience keeps notes and CI links', async () => {
    const md = await render({ format: 'md' });
    expect(md).toContain('Total stayed 40.00, no message (internal note)');
    expect(md).toContain('[CI](https://github.com/INDXDev/indx-watch/actions/runs/1)');
    expect(md).toContain(`\`sha256:${SHOT_SHA.slice(0, 12)}\``);
  });
});

describe('renderReport on examples/shop: evidence, locale and gate', () => {
  it('evidence links use the evidence base when given', async () => {
    const data = reportData(
      model,
      { release: 'v1.2.0' },
      { audience: 'internal', generatedBy: 'x', now: NOW },
    );
    const opts = {
      format: 'md',
      locale: 'en',
      evidence: 'links',
      evidenceBase: 'https://ci.example/evidence/',
    } as const;
    const md = await renderReport(data, opts);
    expect(md).toContain(`[${SHOT_SHA.slice(0, 12)}](https://ci.example/evidence/${SHOT_SHA})`);
  });

  it('evidence none leaves the evidence column out', async () => {
    const md = await render({ format: 'md', evidence: 'none' });
    expect(md).not.toContain('sha256:');
  });

  it('Japanese labels and content translations', async () => {
    const md = await render({ format: 'md', locale: 'ja' });
    expect(md).toContain('# Shop — リリース v1.2.0');
    expect(md).toContain('誤ったパスワードではサインインできない');
    expect(md).toContain('トップページにすべての商品が名前と価格つきで並ぶ。');
  });

  it('a criterion without a translation falls back to the source text, marked with its locale', async () => {
    const b = await shop();
    const ac = b.useCases.find((u) => u.data.key === 'UC-1')!.data.criteria[0]!;
    delete ac.i18n;
    const saved = model;
    model = buildModel(b, sampleRecords(b)).model;
    try {
      expect(await render({ format: 'md', locale: 'ja' })).toMatch(/AC-1\.1 .+ _\(en\)_/);
    } finally {
      model = saved;
    }
  });

  it('the gate section equals the status gate', async () => {
    const data = reportData(
      model,
      { release: 'v1.2.0', environment: 'staging' },
      { audience: 'internal', generatedBy: 'x', now: NOW },
    );
    const md = await renderReport(data, { format: 'md', locale: 'en', evidence: 'none' });
    for (const c of data.status.gate.checks)
      expect(md).toContain(`| \`${c.actual}\` | \`${c.expected}\` | ${c.passed ? '✓ Pass' : '✕ Fail'} |`);
  });
});

describe('content from records', () => {
  const data = () =>
    reportData(model, { release: 'v1.2.0' }, { audience: 'internal', generatedBy: 'x', now: NOW });
  const opts = (format: 'md' | 'html') => ({ format, locale: 'en', evidence: 'none' }) as const;

  it('renders only web links and no raw HTML from notes', async () => {
    const d = data();
    Object.assign(d.runs[0]!, { ciUrl: 'javascript:alert(document.domain)//' });
    Object.assign(d.runs[1]!, { ciUrl: ' JavaScript:alert(1)' });
    Object.assign(d.failures[0]!, { note: '<svg onload=alert(3)> | a & b' });
    const html = await renderReport(d, opts('html'));
    expect(html).not.toMatch(/href="\s*javascript/i);
    expect(html).toContain('<meta http-equiv="Content-Security-Policy" content="default-src \'none\';');
    const md = await renderReport(d, opts('md'));
    expect(md).not.toMatch(/\]\(\s*javascript/i);
    expect(md).toContain('&lt;svg onload=alert(3)&gt; \\| a &amp; b');
    expect(md).not.toContain('<svg');
  });

  it('links the pull request next to the CI run', async () => {
    const d = data();
    const url = 'https://github.com/acme/shop/actions/runs/987/attempts/2';
    Object.assign(d.runs[0]!, { ciUrl: url, ciPr: 12 });
    Object.assign(d.runs[1]!, { ciUrl: undefined, ciPr: 13 });
    const md = await renderReport(d, opts('md'));
    expect(md).toContain(`[CI](${url}) [PR #12](https://github.com/acme/shop/pull/12)`);
    expect(md).toMatch(/\| PR #13 \|$/m);
  });

  it('shows a neutral verdict when nothing is gated', async () => {
    const d = data();
    d.status.gate.checks.push({ key: 'has_gated_tests', passed: false, actual: '0', expected: '≥ 1' });
    const md = await renderReport(d, opts('md'));
    expect(md).toContain('> **○ Not ready: nothing is gated yet** — No P0 or P1 test case is in scope');
    expect(md).toContain('At least one P0/P1 test case is in scope');
    const html = await renderReport(d, { ...opts('html'), locale: 'ja' });
    expect(html).toContain('<div class="verdict s-untested" role="status"><strong>○ まだ判定できません');
  });
});

describe('report CSS', () => {
  it('uses the design tokens of docs/design/tokens.css', () => {
    const css = readFileSync(join(ROOT, 'docs/design/tokens.css'), 'utf8');
    const [light = '', dark = ''] = css.split('@media (prefers-color-scheme: dark)');
    const value = (block: string, name: string) =>
      new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`).exec(block)?.[1];
    for (const [k, v] of Object.entries(tokens(STYLE.light))) expect(value(light, k), k).toBe(v);
    for (const [k, v] of Object.entries(tokens(STYLE.dark))) expect(value(dark, k), k).toBe(v);
  });
});
