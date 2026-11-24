#!/usr/bin/env node
// Copies the product screenshots from ../docs/images into public/images (gitignored), so the site never
// holds its own copy of the binaries. A name missing from docs/images falls back to the older
// docs/design/screenshots; a name with neither is skipped and the page leaves that picture out.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = resolve(site, '..', 'docs');
const images = join(docs, 'images');
const out = join(site, 'public', 'images');

/** Page name → older screenshot used until docs/images has it. */
const FALLBACK = {
  'home.png': 'live-dashboard-1280.png',
  'readiness.png': 'readiness-1280.png',
  'test-case.png': 'test-case-1280.png',
  'manual-run.png': 'test-case-run-1280.png',
  'test-case-mobile.png': 'test-case-390.png',
  'home-ja-dark.png': 'test-case-1280-ja-dark.png',
};
const NAMES = [
  'home.png',
  'test-case.png',
  'manual-run.png',
  'test-data.png',
  'readiness.png',
  'spec-tree.png',
  'test-case-mobile.png',
  'home-ja-dark.png',
];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const extra = existsSync(images) ? readdirSync(images).filter((f) => f.endsWith('.png')) : [];
const report = [];
for (const name of new Set([...NAMES, ...extra])) {
  const primary = join(images, name);
  const fallback = FALLBACK[name] && join(docs, 'design', 'screenshots', FALLBACK[name]);
  const source = existsSync(primary) ? primary : fallback && existsSync(fallback) ? fallback : null;
  if (!source) {
    report.push(`  ${name}: missing (left out of the page)`);
    continue;
  }
  copyFileSync(source, join(out, name));
  report.push(`  ${name} ← ${source.slice(docs.length - 4)}`);
}
console.log(`Screenshots for the site (public/images):\n${report.join('\n')}`);
