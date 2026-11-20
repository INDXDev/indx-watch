/**
 * `iw deploy`: the same server on Cloudflare Workers with R2 (store) and D1 (index), through wrangler.
 * Spec: docs/spec/cli.md#iw-deploy, guide: docs/guides/self-host-cloudflare.md.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HostingConfig, SigningKey } from '@indx-watch/bundle';
import { parse } from 'smol-toml';
import type { z } from 'zod';
import type { CommandData } from '../json.js';
import { type DeployPlan, planDeploy, renderConfig, resourceNames } from './plan.js';
import {
  DeployError,
  discover,
  type Exec,
  listD1,
  nodeExec,
  type Run,
  tail,
  wranglerRunner,
} from './wrangler.js';

export * from './plan.js';
export * from './wrangler.js';

export type DeployData = z.infer<(typeof CommandData)['deploy']>;

export interface DeployOptions {
  /** The `.indx-watch/` directory */
  dir: string;
  name?: string;
  dryRun?: boolean;
  public?: boolean;
  exec?: Exec;
  /** Progress and instructions (default: stderr, so `--json` stays clean) */
  log?: (line: string) => void;
  /** Warnings for the JSON envelope (default: log) */
  warn?: (message: string) => void;
  /** Directory holding `worker.js` and `web/` (default: the CLI's own dist) */
  distDir?: string;
  /** keys the Worker trusts; deploy() reads them from project.toml */
  signingKeys?: SigningKey[];
}

/** Read [hosting] from project.toml and deploy. */
export async function deploy(opts: DeployOptions): Promise<DeployData> {
  const keys = SigningKey.array().safeParse((await readToml(opts.dir)).signing_keys ?? []);
  if (!keys.success) throw new DeployError('INVALID_CONFIG', 'invalid [[signing_keys]] in project.toml');
  return runDeploy(await readHosting(opts.dir), { ...opts, signingKeys: keys.data });
}

async function readToml(dir: string): Promise<Record<string, unknown>> {
  const text = await readFile(join(dir, 'project.toml'), 'utf8').catch(() => {
    throw new DeployError('NO_BUNDLE', `no project.toml in ${dir}`);
  });
  try {
    return parse(text);
  } catch (e) {
    throw new DeployError('INVALID_CONFIG', `project.toml: ${(e as Error).message}`);
  }
}

export async function readHosting(dir: string): Promise<HostingConfig> {
  const raw = (await readToml(dir)).hosting;
  if (raw === undefined) {
    throw new DeployError(
      'INVALID_CONFIG',
      'project.toml has no [hosting] table (see docs/guides/self-host-cloudflare.md)',
    );
  }
  const parsed = HostingConfig.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `hosting.${i.path.join('.')}: ${i.message}`);
    throw new DeployError('INVALID_CONFIG', `invalid [hosting]: ${issues.join('; ')}`);
  }
  return parsed.data;
}

export async function runDeploy(hosting: HostingConfig, opts: DeployOptions): Promise<DeployData> {
  const log = opts.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  if (!hosting.access_team && !opts.public) {
    throw new DeployError(
      'INVALID_CONFIG',
      'refusing to deploy without Cloudflare Access: set [hosting].access_team in project.toml, or pass --public (not recommended)',
    );
  }
  const outDir = join(opts.dir, 'cache', 'deploy');
  const configPath = join(outDir, 'wrangler.jsonc');
  const dist = opts.distDir ?? defaultDistDir();
  const worker = join(dist, 'worker.js');
  const assets = join(dist, 'web');
  const planOpts = {
    configPath,
    main: posix(relative(outDir, worker)),
    assetsDir: posix(relative(outDir, assets)),
    ...(opts.name ? { name: opts.name } : {}),
    ...(opts.public ? { public: true } : {}),
    signingKeys: opts.signingKeys,
  };
  const names = resourceNames(hosting, opts.name);
  // names become wrangler arguments: no flags, no shell characters
  for (const [what, v] of Object.entries(names))
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(v))
      throw new DeployError('INVALID_CONFIG', `invalid ${what} "${v}"`);
  const { run } = await wranglerRunner(opts.exec ?? nodeExec);
  // a dry run also works without a Cloudflare login: it then plans as if nothing existed yet
  const existing = await discover(run, names).catch((e: unknown) => {
    if (!opts.dryRun || !(e instanceof DeployError)) throw e;
    (opts.warn ?? log)(`${e.message}. Resources are shown as missing; they may already exist.`);
    return { r2: [] as string[], d1: [] };
  });
  const plan = planDeploy(hosting, existing, planOpts);
  await writeConfig(configPath, plan);
  log(opts.public ? PUBLIC_WARNING : accessSteps(hosting, names.worker));
  const data = { resources: plan.resources, commands: plan.commands, url: null as string | null };
  if (opts.dryRun) {
    const rows = plan.resources.map((r) => {
      const verb = r.exists ? 'exists' : r.type === 'worker' ? 'deploy' : 'create';
      return `  ${LABEL[r.type].replace('%s', r.name)}: ${verb}`;
    });
    const [head, cmds] = ['Dry run: nothing was changed. Resources:', plan.commands.map((c) => `  ${c}`)];
    log([head, ...rows, `Config: ${configPath}`, 'Commands:', ...cmds].join('\n'));
    return data;
  }
  for (const path of [worker, join(assets, 'index.html')]) {
    if (!existsSync(path))
      throw new DeployError('INTERNAL', `missing build output ${path}: run \`pnpm build\` first`);
  }

  for (const args of plan.steps.slice(0, -1)) await must(run, args, log);
  const final = planDeploy(hosting, { ...existing, r2: [names.bucket], d1: await listD1(run) }, planOpts);
  if (!final.wranglerConfig.d1_databases[0]?.database_id.match(/^[0-9a-f-]{36}$/i)) {
    throw new DeployError('EXTERNAL_TOOL', `D1 database ${names.database} was not found after creating it`);
  }
  await writeConfig(configPath, final);

  const outputFile = join(outDir, 'wrangler-output.ndjson');
  await rm(outputFile, { force: true });
  const result = await must(run, final.steps.at(-1)!, log, {
    ...process.env,
    WRANGLER_OUTPUT_FILE_PATH: outputFile,
  });
  data.url =
    (await readDeployUrl(outputFile)) ?? result.stdout.match(/https:\/\/\S+\.workers\.dev\b/)?.[0] ?? null;
  log(`Deployed${data.url ? ` to ${data.url}` : ''}.`);
  return data;
}

async function must(run: Run, args: string[], log: (l: string) => void, env?: NodeJS.ProcessEnv) {
  log(`$ wrangler ${args.join(' ')}`);
  const r = await run(args, env);
  if (r.stdout.trim()) log(r.stdout.trimEnd());
  if (r.code !== 0) throw new DeployError('EXTERNAL_TOOL', `wrangler ${args.join(' ')} failed: ${tail(r)}`);
  return r;
}

async function writeConfig(path: string, plan: DeployPlan): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderConfig(plan.wranglerConfig));
}

/** First target URL from wrangler's ND-JSON output file (`type: "deploy"`). */
async function readDeployUrl(file: string): Promise<string | null> {
  const text = await readFile(file, 'utf8').catch(() => '');
  for (const line of text.split('\n')) {
    try {
      const entry = JSON.parse(line) as { type?: string; targets?: string[] };
      if (entry.type === 'deploy' && entry.targets?.[0]) return entry.targets[0];
    } catch {}
  }
  return null;
}

/** The bundled CLI lives in dist/; from source (src/deploy/) use the package's dist/. */
function defaultDistDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return basename(here) === 'deploy' ? join(here, '..', '..', 'dist') : here;
}

const posix = (p: string) => p.split(sep).join('/');
const LABEL = { r2: 'R2 bucket %s (binding STORE)', d1: 'D1 database %s (binding DB)', worker: 'Worker %s' };

const PUBLIC_WARNING =
  'WARNING: deploying with --public. Anyone who has the URL can read and write this project. Put Cloudflare Access in front of it as soon as possible.';

export function accessSteps(hosting: HostingConfig, worker: string): string {
  const team = `${hosting.access_team}.cloudflareaccess.com`;
  if (hosting.access_aud) {
    return `Cloudflare Access: team ${team}, audience set. Requests without a valid Access token get 401.`;
  }
  return [
    `Cloudflare Access is not finished: [hosting].access_aud is empty, so the Worker rejects every request until you set it.`,
    '  1. Cloudflare dashboard → Zero Trust → Access → Applications → Add an application → Self-hosted.',
    `  2. Domain: ${worker}.<your-subdomain>.workers.dev, or your custom domain.`,
    '     (Or: Workers & Pages → the Worker → Settings → Domains & Routes → enable Cloudflare Access.)',
    '  3. Add a policy, e.g. Allow → Emails ending in @your-company.com (Google Workspace login),',
    '     and for customers a second Allow policy with their emails and the One-time PIN login method.',
    '  4. For CI, create a service token and a "Service Auth" policy for it.',
    `  5. Copy the Application Audience (AUD) tag into [hosting].access_aud in project.toml (team: ${team}),`,
    '     then run `iw deploy` again.',
  ].join('\n');
}
