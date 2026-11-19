import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deploy,
  type Exec,
  type ExecResult,
  PENDING_ID,
  planDeploy,
  shellQuote,
  winArg,
} from '../src/deploy/index.js';
import { CommandData } from '../src/json.js';

const SHOP = join(import.meta.dirname, '../../../examples/shop/.indx-watch/project.toml');
const UUID = '7a1c3e2b-0d4f-4e8a-9b6c-1f2e3d4c5b6a';

/** A copy of the examples/shop project file plus a fake dist, in a temp dir. */
function setup(hostingOverride?: string) {
  const root = mkdtempSync(join(tmpdir(), 'iw-deploy-'));
  const dir = join(root, '.indx-watch');
  mkdirSync(dir);
  let project = readFileSync(SHOP, 'utf8');
  if (hostingOverride !== undefined)
    project = project.replace(/\[hosting\][\s\S]*?(?=\n\[|$)/, hostingOverride);
  writeFileSync(join(dir, 'project.toml'), project);
  const dist = join(root, 'dist');
  mkdirSync(join(dist, 'web'), { recursive: true });
  writeFileSync(join(dist, 'worker.js'), 'export default {}');
  writeFileSync(join(dist, 'web', 'index.html'), '<!doctype html>');
  return { root, dir, dist };
}

interface FakeState {
  loggedIn?: boolean;
  bucket?: boolean;
  d1?: { name: string; uuid: string }[];
  onPath?: boolean;
}

function fakeExec(state: FakeState) {
  const calls: string[] = [];
  const files: string[] = [];
  const d1 = [...(state.d1 ?? [])];
  let bucket = state.bucket ?? false;
  const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '' });
  const fail = (stderr: string): ExecResult => ({ code: 1, stdout: '', stderr });
  const exec: Exec = async (file, argv) => {
    if (file === 'wrangler' && !state.onPath)
      throw Object.assign(new Error('spawn wrangler ENOENT'), { code: 'ENOENT' });
    files.push([file, ...argv.slice(0, 2)].join(' '));
    const args = file === 'npx' ? argv.slice(2) : argv;
    const cmd = args.join(' ');
    calls.push(cmd);
    if (cmd === '--version') return ok('4.165.0');
    if (cmd === 'whoami')
      return state.loggedIn === false ? fail('You are not authenticated.') : ok('logged in');
    if (cmd === 'd1 list --json') return ok(JSON.stringify(d1.map((d) => ({ ...d, version: 'production' }))));
    if (cmd.startsWith('r2 bucket info'))
      return bucket ? ok('{}') : fail('The specified bucket does not exist.');
    if (cmd.startsWith('deployments list')) return fail('not found');
    if (cmd.startsWith('r2 bucket create')) {
      bucket = true;
      return ok('Created bucket');
    }
    if (cmd.startsWith('d1 create')) {
      d1.push({ name: args[2]!, uuid: UUID });
      return ok('Created database');
    }
    if (cmd.startsWith('deploy --config'))
      return ok('Deployed shop-watch\n  https://shop-watch.example.workers.dev\n');
    return fail(`unexpected: ${cmd}`);
  };
  return { exec, calls, files };
}

const mutating = (calls: string[]) => calls.filter((c) => /create|^deploy /.test(c));

describe('planDeploy', () => {
  const hosting = { provider: 'cloudflare' as const, name: 'shop-watch', access_team: 'example' };
  const opts = {
    configPath: '/p/.indx-watch/cache/deploy/wrangler.jsonc',
    main: '../w.js',
    assetsDir: '../web',
  };

  it('creates only the missing resources, with exact commands', () => {
    const plan = planDeploy(hosting, { r2: [], d1: [] }, opts);
    expect(plan.commands).toEqual([
      'wrangler r2 bucket create shop-watch',
      'wrangler d1 create shop-watch',
      'wrangler deploy --config /p/.indx-watch/cache/deploy/wrangler.jsonc',
    ]);
    expect(plan.wranglerConfig.d1_databases[0]?.database_id).toBe(PENDING_ID);
    expect(plan.wranglerConfig.vars).toEqual({ ACCESS_TEAM: 'example' });
  });

  it('builds the wrangler config with bindings, assets, vars and cron', () => {
    const plan = planDeploy(
      { ...hosting, access_aud: 'aud123', r2_bucket: 'b', d1_database: 'd' },
      { r2: ['b'], d1: [{ name: 'd', uuid: UUID }] },
      { ...opts, name: 'other', public: true },
    );
    expect(plan.commands).toEqual(['wrangler deploy --config /p/.indx-watch/cache/deploy/wrangler.jsonc']);
    expect(plan.resources).toEqual([
      { type: 'r2', name: 'b', exists: true },
      { type: 'd1', name: 'd', exists: true },
      { type: 'worker', name: 'other', exists: false },
    ]);
    expect(plan.wranglerConfig).toMatchObject({
      name: 'other',
      main: '../w.js',
      compatibility_flags: ['nodejs_compat'],
      assets: {
        directory: '../web',
        binding: 'ASSETS',
        not_found_handling: 'single-page-application',
        run_worker_first: ['/api/*', '/healthz', '/mcp', '/mcp/*'],
      },
      r2_buckets: [{ binding: 'STORE', bucket_name: 'b' }],
      d1_databases: [{ binding: 'DB', database_name: 'd', database_id: UUID }],
      vars: { ACCESS_TEAM: 'example', ACCESS_AUD: 'aud123', PUBLIC: 'true' },
      triggers: { crons: ['* * * * *'] },
    });
  });

  it('quotes arguments with spaces', () => {
    expect(shellQuote('/a b/wrangler.jsonc')).toBe("'/a b/wrangler.jsonc'");
    expect(shellQuote('shop-watch')).toBe('shop-watch');
  });
});

describe('deploy', () => {
  it('dry run prints the exact commands and changes nothing', async () => {
    const { dir, dist } = setup();
    const { exec, calls, files } = fakeExec({});
    const lines: string[] = [];
    const data = await deploy({ dir, distDir: dist, dryRun: true, exec, log: (l) => lines.push(l) });
    const config = join(dir, 'cache', 'deploy', 'wrangler.jsonc');
    expect(data).toEqual({
      resources: [
        { type: 'r2', name: 'shop-watch', exists: false },
        { type: 'd1', name: 'shop-watch', exists: false },
        { type: 'worker', name: 'shop-watch', exists: false },
      ],
      commands: [
        'wrangler r2 bucket create shop-watch',
        'wrangler d1 create shop-watch',
        `wrangler deploy --config ${shellQuote(config)}`,
      ],
      url: null,
    });
    expect(CommandData.deploy.parse(data)).toEqual(data);
    expect(mutating(calls)).toEqual([]);
    expect(files[0]).toBe('npx --yes wrangler@4'); // wrangler is not on PATH
    const out = lines.join('\n');
    expect(out).toContain('wrangler d1 create shop-watch');
    expect(out).toContain('Zero Trust → Access → Applications');
    expect(out).toContain('[hosting].access_aud');
    const written = JSON.parse(readFileSync(config, 'utf8').replace(/^\/\/.*\n/, ''));
    expect(written.main).toBe('../../../dist/worker.js');
    expect(written.assets.directory).toBe('../../../dist/web');
  });

  it('does not recreate existing resources', async () => {
    const { dir, dist } = setup();
    const { exec, calls } = fakeExec({
      onPath: true,
      bucket: true,
      d1: [{ name: 'shop-watch', uuid: UUID }],
    });
    const data = await deploy({ dir, distDir: dist, exec, log: () => {} });
    expect(mutating(calls)).toEqual([`deploy --config ${join(dir, 'cache', 'deploy', 'wrangler.jsonc')}`]);
    expect(data.resources.map((r) => r.exists)).toEqual([true, true, false]);
    expect(data.url).toBe('https://shop-watch.example.workers.dev');
  });

  it('creates missing resources, then deploys with the new D1 id', async () => {
    const { dir, dist } = setup();
    const { exec, calls } = fakeExec({ onPath: true });
    await deploy({ dir, distDir: dist, exec, log: () => {} });
    expect(mutating(calls).map((c) => c.split(' ').slice(0, 3).join(' '))).toEqual([
      'r2 bucket create',
      'd1 create shop-watch',
      `deploy --config ${join(dir, 'cache', 'deploy', 'wrangler.jsonc')}`,
    ]);
    const config = readFileSync(join(dir, 'cache', 'deploy', 'wrangler.jsonc'), 'utf8');
    expect(config).toContain(UUID);
  });

  it('refuses without access_team unless --public', async () => {
    const { dir, dist } = setup('[hosting]\nprovider = "cloudflare"\nname = "shop-watch"\n');
    const { exec, calls } = fakeExec({ onPath: true });
    await expect(deploy({ dir, distDir: dist, dryRun: true, exec, log: () => {} })).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
    });
    expect(calls).toEqual([]);
    const lines: string[] = [];
    const data = await deploy({
      dir,
      distDir: dist,
      dryRun: true,
      public: true,
      exec,
      log: (l) => lines.push(l),
    });
    expect(data.commands).toHaveLength(3);
    expect(lines.join('\n')).toContain('--public');
  });

  it('fails with EXTERNAL_TOOL when wrangler is not logged in', async () => {
    const { dir, dist } = setup();
    const { exec, calls } = fakeExec({ onPath: true, loggedIn: false });
    await expect(deploy({ dir, distDir: dist, exec, log: () => {} })).rejects.toMatchObject({
      code: 'EXTERNAL_TOOL',
      message: expect.stringContaining('wrangler login'),
    });
    expect(mutating(calls)).toEqual([]);
  });

  it('dry run without a Cloudflare login still prints the plan, with a warning', async () => {
    const { dir, dist } = setup();
    const { exec, calls } = fakeExec({ onPath: true, loggedIn: false });
    const lines: string[] = [];
    const warnings: string[] = [];
    const data = await deploy({
      ...{ dir, distDir: dist, dryRun: true, exec },
      ...{ log: (l: string) => lines.push(l), warn: (w: string) => warnings.push(w) },
    });
    expect(data.resources.map((r) => r.exists)).toEqual([false, false, false]);
    expect(data.commands).toHaveLength(3);
    expect(warnings).toEqual([expect.stringContaining('wrangler login')]);
    expect(mutating(calls)).toEqual([]);
    const config = join(dir, 'cache', 'deploy', 'wrangler.jsonc');
    expect(readFileSync(config, 'utf8')).toContain('"bucket_name": "shop-watch"');
    const out = lines.join('\n');
    expect(out).toContain('R2 bucket shop-watch (binding STORE): create');
    expect(out).toContain('D1 database shop-watch (binding DB): create');
    expect(out).toContain('Worker shop-watch: deploy');
    expect(out).toContain(`Config: ${config}`);
  });

  it('refuses resource names that are not plain names, before running wrangler', async () => {
    for (const [hosting, name] of [
      [
        '[hosting]\nprovider = "cloudflare"\nname = "w"\nr2_bucket = "x & calc.exe"\naccess_team = "t"\n',
        undefined,
      ],
      [
        '[hosting]\nprovider = "cloudflare"\nname = "w"\nd1_database = "--help"\naccess_team = "t"\n',
        undefined,
      ],
      [undefined, '-x'],
    ] as const) {
      const { dir, dist } = setup(hosting);
      const { exec, calls } = fakeExec({ onPath: true });
      const opts = { dir, distDir: dist, dryRun: true, exec, log: () => {}, ...(name ? { name } : {}) };
      await expect(deploy(opts)).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
      expect(calls).toEqual([]);
    }
  });

  it('quotes arguments for cmd.exe on Windows and refuses shell characters', () => {
    expect(winArg('deploy')).toBe('deploy');
    expect(winArg('C:\\Users\\Jo Do\\wrangler.jsonc')).toBe('"C:\\Users\\Jo Do\\wrangler.jsonc"');
    for (const bad of ['a&b', 'x|y', '%PATH%', 'a"b', 'a^b', 'a\nb']) expect(() => winArg(bad)).toThrow();
  });

  it('reports a missing [hosting] table as INVALID_CONFIG and a missing bundle as NO_BUNDLE', async () => {
    const { dir, root } = setup('');
    await expect(deploy({ dir, exec: fakeExec({}).exec })).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    await expect(deploy({ dir: join(root, 'nope'), exec: fakeExec({}).exec })).rejects.toMatchObject({
      code: 'NO_BUNDLE',
    });
  });

  it('refuses to deploy when the build output is missing', async () => {
    const { dir, root } = setup();
    const { exec, calls } = fakeExec({ onPath: true });
    await expect(deploy({ dir, distDir: join(root, 'nodist'), exec, log: () => {} })).rejects.toMatchObject({
      code: 'INTERNAL',
    });
    expect(mutating(calls)).toEqual([]);
  });
});
