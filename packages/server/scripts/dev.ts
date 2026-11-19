/**
 * Dev server until `pnpm iw serve` exists: the examples/shop bundle on http://127.0.0.1:4321 with the built SPA
 * (run `pnpm --filter @indx-watch/web build` first, or `pnpm --filter @indx-watch/web dev` for a proxied Vite server).
 * Background sync is off unless IW_SYNC=1, so the sample store stays untouched.
 * Usage: pnpm exec tsx packages/server/scripts/dev.ts [bundle-dir]
 */
import { startNodeServer } from '../src/node.js';

const dir = process.argv[2] ?? 'examples/shop/.indx-watch';
const port = Number(process.env.PORT ?? 4321);
const server = await startNodeServer({ dir, port, sync: process.env.IW_SYNC === '1' });
console.log(`INDX Watch on ${server.url} (bundle: ${dir})`);
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => void server.close().then(() => process.exit(0)));
