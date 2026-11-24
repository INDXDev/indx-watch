/**
 * `iw patch` (docs/spec/cli.md#iw-patch): keep changes to INDX Watch as patches against the upstream source at tag
 * `v<base>`. git and pnpm run through an injectable `Exec`; the source repository is `[tool] source` (a GitHub
 * `owner/name`) or, for tests and mirrors, the path in IW_PATCH_REPO.
 */
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalBody, parseToml, sha256Hex } from '@indx-watch/bundle';
import type { Spec } from './cli.js';
import * as cx from './context.js';
import { type Exec, nodeExec, tail } from './deploy/wrangler.js';
import { B, type Ctx, type Env, fail, P, S, str } from './util.js';

/** Files no patch may touch: verdict, gate and status rules, signing and identity, the secret scan (docs/spec/cli.md#iw-patch). */
export const REFUSED: RegExp[] = [
  /^packages\/core\/src\/(decide|status|roles)\.ts$/,
  /^packages\/bundle\/src\/(sign|seal|check)\.ts$/,
  /^packages\/server\/src\/(oidc|store-routes)\.ts$/,
  /^packages\/store\/src\/(node\/identity|workers\/index|adapters\/github-oidc)\.ts$/,
];
const SOURCE = 'github:INDXDev/indx-watch';

export interface PatchOptions {
  /** the `.indx-watch/` directory */
  dir: string;
  exec?: Exec;
  env?: Env;
  log?: (line: string) => void;
}
export interface PatchData {
  action: 'create' | 'apply' | 'check';
  base: string;
  to: string | null;
  patches: { file: string; files: string[]; refused: string[]; applies: boolean | null }[];
  conflicts: string[];
  patch_hash: string | null;
  dist: string | null;
}

const filesOf = (patch: string) => [...patch.matchAll(/^diff --git a\/(\S+) b\/\S+$/gm)].map((m) => m[1]!);
const refusedOf = (files: string[]) => files.filter((f) => REFUSED.some((re) => re.test(f)));
const names = async (dir: string) =>
  (await readdir(join(dir, 'patches')).catch(() => [])).filter((f) => f.endsWith('.patch')).sort();
const read = (path: string) => readFile(path, 'utf8').catch(() => null);

/** SHA-256 of the patch files in order (name and text); `short` is what a patched build shows. */
export async function patchSetHash(dir: string): Promise<{ hash: string; short: string } | null> {
  const files = await names(dir);
  if (!files.length) return null;
  const parts = await Promise.all(files.map(async (f) => `${f}\n${await read(join(dir, 'patches', f))}\n`));
  const hash = await sha256Hex(parts.join(''));
  return { hash, short: hash.slice(0, 8) };
}

/** The deploy output of `iw patch apply` when the project has patches: its `dist/`; null without patches. Stale: INVALID_CONFIG. */
export async function patchedDist(dir: string): Promise<string | null> {
  if (!existsSync(join(dir, 'patches', 'patches.toml'))) return null;
  const dist = join(dir, 'cache', 'patched', 'dist');
  const built = JSON.parse((await read(join(dist, 'patched.json'))) ?? '{}') as { patch_hash?: string };
  if (built.patch_hash !== (await patchSetHash(dir))?.hash)
    fail('INVALID_CONFIG', 'The patched build is missing or out of date: run `iw patch apply` first');
  return dist;
}

/** The pieces every action shares: where the source is, which version, and running git and pnpm. */
async function setup({ dir, exec = nodeExec, env = process.env, log = () => {} }: PatchOptions) {
  const tool = (parseToml((await read(join(dir, 'project.toml'))) ?? '').tool ?? {}) as Record<
    string,
    string
  >;
  const base =
    (parseToml((await read(join(dir, 'patches', 'patches.toml'))) ?? '').base as string | undefined) ??
    tool.indx_watch ??
    fail('INVALID_CONFIG', 'Pin the version first: `[tool] indx_watch = "x.y.z"` in project.toml');
  const url = env.IW_PATCH_REPO ?? `https://github.com/${(tool.source ?? SOURCE).slice(7)}.git`;
  const sh = async (file: string, args: string[], what = `${file} ${args[0]}`) => {
    const r = await exec(file, args).catch(() => null);
    if (!r) return fail('EXTERNAL_TOOL', `iw patch needs ${file} on the PATH (could not start it)`);
    return Object.assign(r, { ok: r.code === 0, what });
  };
  const git = async (cwd: string, ...args: string[]) => {
    const r = await sh('git', ['-C', cwd, ...args]);
    return r.ok ? r.stdout : fail('EXTERNAL_TOOL', `git ${args[0]} failed: ${tail(r)}`);
  };
  /** the upstream source at `v<version>`, cloned once into cache/src/<version> */
  const pristine = async (version: string) => {
    const path = join(dir, 'cache', 'src', version);
    if (existsSync(join(path, '.git'))) return path;
    log(`Fetching INDX Watch v${version} from ${url}`);
    await mkdir(join(path, '..'), { recursive: true });
    const r = await sh('git', ['clone', '--quiet', '--depth', '1', '--branch', `v${version}`, url, path]);
    if (!r.ok) fail('NOT_FOUND', `cannot fetch tag v${version} from ${url}: ${tail(r)}`);
    return path;
  };
  /** a fresh copy of the pristine source at `to`, with the patches applied in order until one fails */
  async function applied(to: string, files: string[]) {
    const out = join(dir, 'cache', 'patched', 'src');
    await rm(out, { recursive: true, force: true });
    await mkdir(join(out, '..'), { recursive: true });
    await git(dir, 'clone', '--quiet', await pristine(to), out);
    const rows: PatchData['patches'] = [];
    for (const f of files) {
      const text = (await read(join(dir, 'patches', f))) ?? '';
      const list = filesOf(text);
      // after a failure the later patches are not tried (they may build on it)
      const r = rows.some((x) => x.applies === false)
        ? null
        : await sh('git', ['-C', out, 'apply', '--3way', join(dir, 'patches', f)]);
      const hit = r && !r.ok ? list.filter((x) => `${r.stderr}${r.stdout}`.includes(x)) : list;
      rows.push({
        file: `patches/${f}`,
        files: hit.length ? hit : list,
        refused: refusedOf(list),
        applies: r ? r.ok : null,
      });
    }
    return { out, rows };
  }
  return { dir, base, sh, git, pristine, applied, log };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const refuse = (rows: PatchData['patches']) => {
  const files = rows.flatMap((r) => r.refused);
  if (files.length)
    fail(
      'INVALID_INPUT',
      `Patches may not change ${[...new Set(files)].join(', ')} (verdict, gate, signing and secret-scan code)`,
    );
};
const data = (s: Setup, action: PatchData['action'], rest: Partial<PatchData>): PatchData => ({
  ...{ action, base: s.base, to: null, patches: [], conflicts: [], patch_hash: null, dist: null },
  ...rest,
});

/** Edit the upstream source in cache/upstream, then run again: the edits become the next patch. */
export async function createPatch(o: PatchOptions, name: string): Promise<PatchData> {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(name))
    fail('INVALID_INPUT', `invalid patch name "${name}" (a-z, 0-9, -)`);
  const s = await setup(o);
  const ws = join(s.dir, 'cache', 'upstream');
  if (!existsSync(join(ws, '.git'))) {
    await s.git(s.dir, 'clone', '--quiet', await s.pristine(s.base), ws);
    for (const f of await names(s.dir)) await s.git(ws, 'apply', join(s.dir, 'patches', f));
    await s.git(ws, 'add', '-A');
    await s.git(
      ws,
      '-c',
      'user.name=iw',
      '-c',
      'user.email=iw@localhost',
      'commit',
      '--quiet',
      '--allow-empty',
      '-m',
      'patches',
    );
  }
  if (!(await s.git(ws, 'status', '--porcelain')).trim()) {
    s.log(`Edit the source in ${ws}, then run \`iw patch create ${name}\` again.`);
    return data(s, 'create', {});
  }
  await s.git(ws, 'add', '-A');
  const files = (await s.git(ws, 'diff', '--cached', '--name-only')).split('\n').filter(Boolean);
  refuse([{ file: name, files, refused: refusedOf(files), applies: null }]);
  const n = Math.max(0, ...(await names(s.dir)).map((f) => Number.parseInt(f, 10) || 0)) + 1;
  const file = `${String(n).padStart(4, '0')}-${name}.patch`;
  await mkdir(join(s.dir, 'patches'), { recursive: true });
  await writeFile(join(s.dir, 'patches', file), await s.git(ws, 'diff', '--cached', '--binary'));
  await writeFile(join(s.dir, 'patches', 'patches.toml'), canonicalBody({ base: s.base }));
  await s.git(ws, '-c', 'user.name=iw', '-c', 'user.email=iw@localhost', 'commit', '--quiet', '-m', name);
  const set = await patchSetHash(s.dir);
  return data(s, 'create', {
    patches: [{ file: `patches/${file}`, files, refused: [], applies: true }],
    patch_hash: set?.hash ?? null,
  });
}

/** Apply the patches to a clean copy of `v<base>`, build it and keep `cache/patched/dist` for `iw deploy`. */
export async function applyPatches(o: PatchOptions, dryRun = false): Promise<PatchData> {
  const s = await setup(o);
  const files = await names(s.dir);
  if (!files.length)
    fail('NOT_FOUND', 'No patches in .indx-watch/patches/; create one with `iw patch create <name>`');
  const { out, rows } = await s.applied(s.base, files);
  refuse(rows);
  const bad = rows.find((r) => r.applies === false);
  if (bad)
    fail(
      'CONFLICT',
      `${bad.file} does not apply to v${s.base}: ${bad.files.join(', ')}`,
      undefined,
      data(s, 'apply', { patches: rows, conflicts: bad.files }),
    );
  const set = (await patchSetHash(s.dir))!;
  if (dryRun) return data(s, 'apply', { patches: rows, patch_hash: set.hash });
  for (const step of [['install', '--frozen-lockfile'], ['build']]) {
    s.log(`$ pnpm ${step.join(' ')}`);
    const r = await s.sh('pnpm', ['--dir', out, ...step]);
    if (!r.ok) fail('EXTERNAL_TOOL', `pnpm ${step.join(' ')} failed: ${tail(r)}`);
  }
  const dist = join(s.dir, 'cache', 'patched', 'dist');
  await rm(dist, { recursive: true, force: true });
  await cp(join(out, 'packages', 'cli', 'dist'), dist, { recursive: true });
  const worker = join(dist, 'worker.js');
  await writeFile(worker, `globalThis.__IW_PATCHES__="${set.short}";\n${await readFile(worker, 'utf8')}`);
  await writeFile(join(dist, 'patched.json'), `${JSON.stringify({ base: s.base, patch_hash: set.hash })}\n`);
  return data(s, 'apply', { patches: rows, patch_hash: set.hash, dist });
}

/** Do the patches still apply to `v<to>` (default: the base)? CONFLICT (exit 1) with the conflicting files when not. */
export async function checkPatches(o: PatchOptions, to?: string): Promise<PatchData> {
  const s = await setup(o);
  const target = to ?? s.base;
  const { rows } = await s.applied(target, await names(s.dir));
  const [conflicts, refused] = [
    rows.filter((r) => r.applies === false).flatMap((r) => r.files),
    rows.flatMap((r) => r.refused),
  ];
  const result = data(s, 'check', {
    to: target,
    patches: rows,
    conflicts,
    patch_hash: (await patchSetHash(s.dir))?.hash ?? null,
  });
  if (refused.length) refuse(rows);
  if (conflicts.length)
    fail('CONFLICT', `The patches do not apply to v${target}: ${conflicts.join(', ')}`, undefined, result);
  return result;
}

const opts = (ctx: Ctx, p: cx.Project): PatchOptions => ({ dir: p.dir, env: ctx.env, log: ctx.log });

/** `iw patch create | apply | check` */
export const patchCommands: Record<string, Spec> = {
  'patch create': {
    description: 'Turn your edits to the upstream source into a patch (run once to prepare, again to save)',
    args: { name: P('Patch name, e.g. shorter-nav') },
    async run(ctx, a) {
      const d = await createPatch(opts(ctx, await cx.openProject(ctx, a)), str(a.name)!);
      return {
        data: d,
        text: d.patches.map((p) => `Wrote ${p.file}`).join('\n') || 'Prepared cache/upstream',
      };
    },
  },
  'patch apply': {
    description: 'Apply the patches to the upstream source, build it and keep it for iw deploy',
    args: { 'dry-run': B('Only check that the patches apply, build nothing') },
    async run(ctx, a) {
      const d = await applyPatches(opts(ctx, await cx.openProject(ctx, a)), !!a['dry-run']);
      return {
        data: d,
        text: d.dist ? `Built ${d.dist}` : `${d.patches.length} patches apply to v${d.base}`,
      };
    },
  },
  'patch check': {
    description:
      'Do the patches still apply to another INDX Watch version? Exit 1 with the conflicting files',
    args: { to: S('Version to check against (default: the base)') },
    async run(ctx, a) {
      const d = await checkPatches(opts(ctx, await cx.openProject(ctx, a)), str(a.to));
      return { data: d, text: `${d.patches.length} patches apply to v${d.to}` };
    },
  },
};
