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

describe('renderReport on examples/shop', () => {
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
    for (const html of [
      await render({ format: 'html' }),
      await render({ format: 'html', audience: 'customer' }),
    ]) {
      expect(html).not.toMatch(/<script|<link|@import|url\(/i);
      expect(html).not.toMatch(/\ssrc="(?!data:)/);
      expect(html).toContain('@media screen and (prefers-color-scheme:dark)');
      expect(html).toContain('@media print');
    }
  });

  it('customer audience: no emails, notes, judgement reasons, environment details or CI links', async () => {
    for (const format of ['md', 'html'] as const)
      for (const locale of ['en', 'ja'] as const) {
        const out = await render({ format, audience: 'customer', locale, evidence: 'embed' });
        expect(out).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
        for (const secret of [
          'internal note',
          'Total stayed',
          'VPN',
          'Layout looks fine',
          'Matches the copy deck',
          'localhost:4173',
          'No VPN is needed',
          'github.com',
          'SHOP_CUSTOMER_PASSWORD',
        ])
          expect(out, `${format}/${locale}: ${secret}`).not.toContain(secret);
        expect(out).toContain('QA team');
      }
  });

  it('internal audience keeps notes and CI links', async () => {
    const md = await render({ format: 'md' });
    expect(md).toContain('Total stayed 40.00, no message (internal note)');
    expect(md).toContain('[CI](https://github.com/INDXDev/indx-watch/actions/runs/1)');
    expect(md).toContain(`\`sha256:${SHOT_SHA.slice(0, 12)}\``);
  });

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

  it('Japanese labels and content translations, with the source text marked', async () => {
    const md = await render({ format: 'md', locale: 'ja' });
    expect(md).toContain('# Shop — リリース v1.2.0');
    expect(md).toContain('誤ったパスワードではサインインできない');
    expect(md).toMatch(/AC-1\.1 .+ _\(en\)_/);
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
