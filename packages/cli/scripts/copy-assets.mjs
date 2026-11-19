#!/usr/bin/env node
// Copies what the published package needs besides the bundled code (run after tsup by `pnpm build`):
// the web build → dist/web, JSON Schemas → schemas/, agent skills → skills/, the shop example bundle →
// dist/example-bundle and its sample store → dist/example-store (for `iw init --example`), and the repository LICENSE.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(pkg, '../..');
const skip = /[/\\](runs|cache|node_modules)([/\\]|$)/;

function copy(from, to, required = true) {
  const src = join(root, from);
  if (!existsSync(src)) {
    if (required) throw new Error(`copy-assets: ${from} is missing`);
    console.warn(`copy-assets: ${from} is missing (run \`pnpm --filter @indx-watch/web build\` first)`);
    return;
  }
  rmSync(join(pkg, to), { recursive: true, force: true });
  cpSync(src, join(pkg, to), { recursive: true, filter: (s) => !skip.test(s.slice(src.length)) });
}

copy('packages/web/dist', 'dist/web', false);
copy('schemas', 'schemas');
copy('skills', 'skills');
copy('examples/shop/.indx-watch', 'dist/example-bundle');
copy('examples/shop/store', 'dist/example-store');
copy('LICENSE', 'LICENSE');
