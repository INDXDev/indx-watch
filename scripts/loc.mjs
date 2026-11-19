#!/usr/bin/env node
// Counts non-blank, non-comment lines in packages/*/src and compares them with the budget table in
// docs/architecture.md#line-budget. Usage: node scripts/loc.mjs [--json]. Exit 1 when over budget.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|css|sql)$/;

function budgets() {
  const doc = readFileSync(join(root, 'docs/architecture.md'), 'utf8');
  const section = doc.split(/^## Line budget\s*$/m)[1]?.split(/^## /m)[0] ?? '';
  const table = new Map();
  let total = null;
  for (const m of section.matchAll(/^\|\s*(\**)([\w-]+)[^|]*\|\s*\**([\d,]+)\**\s*\|/gm)) {
    const n = Number(m[3].replaceAll(',', ''));
    if (m[2].toLowerCase() === 'total') total = n;
    else table.set(m[2], n);
  }
  if (!table.size) throw new Error('no budget table under "## Line budget" in docs/architecture.md');
  return { table, total };
}

function files(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && CODE.test(e.name) && !/\.test\.\w+$/.test(e.name))
    .map((e) => join(e.parentPath, e.name));
}

/** Non-blank lines that are not only comments (`//`, `/* … *\/`, `--` in SQL). */
function countLines(text, sql = false) {
  let inBlock = false;
  let count = 0;
  for (const raw of text.split('\n')) {
    let line = raw.trim();
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end < 0) continue;
      inBlock = false;
      line = line.slice(end + 2).trim();
    }
    while (line.startsWith('/*')) {
      const end = line.indexOf('*/', 2);
      if (end < 0) {
        inBlock = true;
        line = '';
      } else line = line.slice(end + 2).trim();
    }
    if (!line || line.startsWith('//') || (sql && line.startsWith('--'))) continue;
    count++;
  }
  return count;
}

const { table, total } = budgets();
const pkgDir = join(root, 'packages');
const rows = readdirSync(pkgDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(pkgDir, e.name, 'src')))
  .map((e) => {
    const lines = files(join(pkgDir, e.name, 'src')).reduce(
      (sum, f) => sum + countLines(readFileSync(f, 'utf8'), f.endsWith('.sql')),
      0,
    );
    const budget = table.get(e.name) ?? null;
    return { package: e.name, lines, budget, over: budget !== null && lines > budget };
  })
  .sort((a, b) => a.package.localeCompare(b.package));
const sum = rows.reduce((s, r) => s + r.lines, 0);
const totalRow = { package: 'total', lines: sum, budget: total, over: total !== null && sum > total };
const ok = !rows.some((r) => r.over) && !totalRow.over;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ok, packages: rows, total: totalRow }, null, 2));
} else {
  const fmt = (r) =>
    `${r.package.padEnd(12)}${String(r.lines).padStart(7)}${String(r.budget ?? '-').padStart(8)}  ${r.over ? 'OVER' : 'ok'}`;
  console.log(`${'package'.padEnd(12)}${'lines'.padStart(7)}${'budget'.padStart(8)}`);
  for (const r of [...rows, totalRow]) console.log(fmt(r));
  if (!ok) console.error('\nOver the line budget (docs/architecture.md#line-budget).');
}
process.exit(ok ? 0 : 1);
