// Builds the Worker that `iw deploy` publishes, with `wrangler deploy --dry-run` and the config `planDeploy`
// generates (docs/architecture.md#acceptance-criteria). No Cloudflare account needed. Needs `pnpm build` first.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { planDeploy, renderConfig } from '../packages/cli/src/deploy/plan.ts';

const dist = resolve(import.meta.dirname, '../packages/cli/dist');
const tmp = mkdtempSync(join(tmpdir(), 'iw-worker-'));
const configPath = join(tmp, 'wrangler.jsonc');
const plan = planDeploy(
  { name: 'indx-watch-check', access_team: 'example' },
  {
    r2: ['indx-watch-check'],
    d1: [{ name: 'indx-watch-check', uuid: '00000000-0000-4000-8000-000000000000' }],
  },
  { configPath, main: relative(tmp, join(dist, 'worker.js')), assetsDir: relative(tmp, join(dist, 'web')) },
);
writeFileSync(configPath, renderConfig(plan.wranglerConfig));
const out = join(tmp, 'out');
const args = ['--yes', 'wrangler@4', 'deploy', '--dry-run', '--outdir', out, '--config', configPath];
const r = spawnSync('npx', args, { stdio: 'inherit', cwd: tmp });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`Worker bundle builds: ${readdirSync(out).join(', ')}`);
