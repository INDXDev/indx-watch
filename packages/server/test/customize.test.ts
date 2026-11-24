/** Customizing (T-507) and patched builds (T-509): ui/ and [report] through /api/project and reports, the patch marker. */

import { nodeFs } from '@indx-watch/bundle/node';
import { buildModel, reportData } from '@indx-watch/core';
import { definitionFiles } from '@indx-watch/sync';
import { afterEach, describe, expect, it } from 'vitest';
import { buildVersion, patchedLabel } from '../src/build.js';
import { type ProjectInfo, renderReport, reportTexts } from '../src/index.js';
import { memoryBundleFs } from '../src/worker.js';
import { app, get } from './app-helpers.js';
import { NOW, req, SHOP, sampleRecords, shop } from './helpers.js';
import { bucket, getJson, publicEnv } from './worker-helpers.js';

const LOGO = 'data:image/png;base64,iVBORw0KGgo=';
const patched = (hash: string | undefined) =>
  Object.assign(globalThis, { __IW_PATCHES__: hash }) as { __IW_PATCHES__?: string };
afterEach(() => void patched(undefined));

/** examples/shop with a ui/ folder and a [report] table, as loadBundle would give it. */
async function branded() {
  const bundle = await shop();
  bundle.ui = {
    messages: { en: { 'nav.tests': 'Checks' } },
    theme: { light: { accent: '#0b6b50' }, dark: { accent: '#6fd3b0' } },
    logo: LOGO,
  };
  bundle.project.data.report = { title: 'Shop QA', footer: 'Shop QA team' };
  return bundle;
}

async function render(format: 'md' | 'html') {
  const bundle = await branded();
  const model = buildModel(bundle, sampleRecords(bundle)).model;
  const scope = { release: 'v1.2.0', environment: 'staging' };
  const data = reportData(model, scope, { audience: 'internal', generatedBy: 'qa@shop.test', now: NOW });
  const texts = await reportTexts(model, 'en');
  return renderReport(Object.assign(data, { texts }), { format, locale: 'en', evidence: 'none' });
}

describe('ui/ through GET /api/project', () => {
  it('serves message overrides and the theme as CSS, never the logo', async () => {
    const f = await app({ bundle: await branded() });
    const p = await get<ProjectInfo>(f.app, '/api/project');
    expect(p.ui?.messages).toEqual({ en: { 'nav.tests': 'Checks' } });
    expect(p.ui?.css).toContain(':root{--accent:#0b6b50;}');
    expect(p.ui?.css).toContain('@media (prefers-color-scheme:dark)');
    expect(JSON.stringify(p)).not.toContain('base64');
  });

  it('has no ui for a project without ui/', async () => {
    const p = await get<ProjectInfo>((await app()).app, '/api/project');
    expect(p.ui).toBeUndefined();
    expect(p.server?.patches).toBeUndefined();
  });
});

describe('ui/ on the Worker', () => {
  it('is loaded from the published snapshot and served through /api/project', async () => {
    const files = await definitionFiles(nodeFs(SHOP));
    const enc = new TextEncoder();
    files.set('ui/messages.ja.json', enc.encode('{"nav.tests":"確認"}'));
    files.set('ui/theme.toml', enc.encode('[common]\nradius = "2px"\n'));
    files.set('patches/0001-x.patch', enc.encode('diff --git a/x b/x\n'));
    const { r2 } = await bucket([], memoryBundleFs(files));
    const p = await getJson<ProjectInfo>(publicEnv(r2), '/api/project');
    expect(p.ui?.messages).toEqual({ ja: { 'nav.tests': '確認' } });
    expect(p.ui?.css).toBe(':root{--radius:2px;}');
    expect(p.problems.map((x) => x.message).join()).not.toContain('patch');
  });
});

describe('[report] branding', () => {
  it('shows title, footer and logo in HTML, title and footer in Markdown', async () => {
    const html = await render('html');
    expect(html).toContain('<title>Shop QA — ');
    expect(html).toContain(`<img src="${LOGO}"`);
    expect(html).toContain('<footer>Shop QA team</footer>');
    const md = await render('md');
    expect(md).toContain('# Shop QA — ');
    expect(md.trimEnd().endsWith('_Shop QA team_')).toBe(true);
    expect(md).not.toContain('(patched)');
  });
});

describe('a patched build', () => {
  it('says so in /healthz, /api/project and the report footer', async () => {
    patched('ab12cd34');
    const f = await app({ bundle: await branded() });
    expect(await get(f.app, '/healthz')).toMatchObject({ ok: true, patches: 'ab12cd34' });
    const p = await get<ProjectInfo>(f.app, '/api/project');
    expect(p.server).toMatchObject({ patches: 'ab12cd34' });
    expect(await render('md')).toMatch(/_Shop QA team · INDX Watch \S+\+p\.ab12cd34 \(patched\)_\n$/);
  });

  it('marks the records it writes and leaves an unpatched server alone', async () => {
    const body = { test_case: 'TC-8', steps: [{ index: 1, status: 'pass' }], verdict: 'pass' };
    const plain = await app();
    expect((await plain.app.fetch(req('/api/runs', { json: body }))).status).toBe(201);
    expect(plain.written[0]).not.toHaveProperty('client');
    patched('ab12cd34');
    const f = await app();
    expect((await f.app.fetch(req('/api/runs', { json: body }))).status).toBe(201);
    expect(f.written[0]).toMatchObject({ client: { patches: 'ab12cd34' } });
  });
});

describe('the build id', () => {
  it('adds the patch hash to the version of an MCP server and a footer', () => {
    expect(buildVersion('0.1.3', undefined)).toBe('0.1.3');
    expect(buildVersion('0.1.3', 'ab12cd34')).toBe('0.1.3+p.ab12cd34');
    expect(patchedLabel('0.1.3', 'ab12cd34')).toBe('INDX Watch 0.1.3+p.ab12cd34 (patched)');
    expect(patchedLabel('0.1.3', undefined)).toBeUndefined();
  });
});
