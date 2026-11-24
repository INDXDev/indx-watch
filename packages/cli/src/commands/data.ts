/** Data movement: fixture add/fetch, sync, export --full, import. */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import * as zlib from 'node:zlib';
import * as iwb from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { blobRefs, checkRecord, createResultStore, type LocalReplica } from '@indx-watch/store';
import { openObjectStore, openReplica } from '@indx-watch/store/node';
import {
  compactLog,
  pointerBlobs,
  type SyncOptions,
  type SyncResult,
  syncOnce,
  watch,
} from '@indx-watch/sync';
import { fileStateStore, writerId } from '@indx-watch/sync/node';
import { problemLine, type Spec } from '../cli.js';
import * as cx from '../context.js';
import { type Args, B, type Ctx, fail, git, iso, P, S, str } from '../util.js';
import { importGithubIssue } from './import-issue.js';
import { importPlaywrightPlan } from './playwright-plan.js';
import { mediaType } from './results.js';
import { cacheBlob } from './specs.js';

const dec = new TextDecoder();
/** Refuse when the secret scan problems include errors (exit 1). */
function refuse(problems: iwb.Problem[], what: string) {
  const found = problems.filter((x) => x.severity === 'error');
  if (found.length)
    fail('SECRETS_FOUND', `Refusing to ${what}: the secret scan found ${found.length} problem(s)`, found);
}

/** The result store of the project (or --store / IW_STORE). */
export async function openStore(ctx: Ctx, p: cx.Project, a: Args) {
  const config = p.bundle.project.data.store;
  const url = str(a.store) ?? ctx.env.IW_STORE ?? config?.url;
  if (!url) return fail('INVALID_CONFIG', 'No [store] in project.toml; add one or pass --store <url>');
  const objects = openObjectStore({ ...config, url }, { bundleDir: p.dir, env: ctx.env });
  return {
    store: createResultStore(objects),
    state: await fileStateStore(p.dir, url),
    writer: await writerId(p.dir),
    keys: p.bundle.project.data.signing_keys,
  };
}

/** Read blobs from the local replica, else from the result store (null when absent or unreachable). */
export const blobReader = (ctx: Ctx, p: cx.Project, a: Args) => async (sha: string) =>
  (await p.replica.getBlob(sha)) ??
  openStore(ctx, p, a).then(
    (s) => s.store.getBlob(sha),
    () => null,
  );

/** Git facts, actor and signer for publishing a bundle snapshot of the project (iw sync --snapshot, iw push). */
export async function snapshotOf(ctx: Ctx, p: cx.Project) {
  const time = git(p.dir, 'log', '-1', '--format=%cI');
  return {
    fs: p.fs,
    commit: git(p.dir, 'rev-parse', 'HEAD') ?? undefined,
    ref: git(p.dir, 'symbolic-ref', '-q', 'HEAD') ?? undefined,
    clean: git(p.dir, 'status', '--porcelain', '--', '.') === '',
    commitTime: time ? iso(new Date(time)) : undefined,
    actor: await cx.actorOf(ctx),
    sign: cx.signerOf(ctx),
  };
}
/** Log the warnings of a sync pass. */
export const logWarnings = (ctx: Ctx, r: SyncResult) => {
  for (const w of r.warnings ?? []) ctx.log(`warning: ${w}`);
};

/** Make sure cache/blobs/ holds a verified copy of a pointer blob, from the replica or else the store. */
async function cachePointer(ctx: Ctx, p: cx.Project, a: Args, f: { name: string; sha256: string }) {
  const path = cacheBlob(p, f.sha256);
  if (existsSync(path) && (await iwb.sha256Hex(await readFile(path))) === f.sha256) return;
  const local = await p.replica.getBlob(f.sha256);
  const data = local ?? (await (await openStore(ctx, p, a)).store.getBlob(f.sha256));
  if (!data) fail('NOT_FOUND', `The blob of ${f.name} (${f.sha256}) is not in the store`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data!);
}

const GIT_OWNS =
  'Workspace mode, but git tracks files of this bundle: choose one owner of the definitions. Set [store] mode = "git", or stop tracking them (git rm -r --cached .indx-watch) and sync again';
const held = (n: number) => `Held back records: the secret scan found ${n} problem(s); retract them`;
/** iw sync --watch: sync every intervalMs until SIGINT / SIGTERM and return the last result. */
async function watchSync(ctx: Ctx, opts: SyncOptions, intervalMs: number) {
  const none = { records: 0, blobs: 0 };
  let last: SyncResult = { pushed: none, pulled: { ...none }, snapshot: null, cursor: null };
  const stop = watch({
    ...{ ...opts, intervalMs },
    onResult: (r) => {
      last = r;
      if (r.pushed.records + r.pulled.records) ctx.log(syncText(r));
      logWarnings(ctx, r);
      if (r.held?.length) ctx.log([held(r.held.length), ...r.held.map(problemLine)].join('\n  '));
    },
    onError: (e) => ctx.log(`sync error: ${(e as Error).message}`),
  });
  ctx.log('Watching the store (Ctrl+C to stop)');
  await new Promise((res) => process.once('SIGINT', res).once('SIGTERM', res));
  await stop();
  return { data: last, text: syncText(last) };
}

/** The tar inside an archive file: zstd, gzip or plain. */
async function readTar(archive: string, name: unknown) {
  const raw = new Uint8Array(await readFile(archive).catch(() => fail('NOT_FOUND', `${name} not found`)));
  if (!isZstd(raw)) return raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw;
  if (!z.zstdDecompressSync) fail('INVALID_INPUT', 'This Node.js cannot read zstd; use Node ≥ 22.15');
  return z.zstdDecompressSync!(raw);
}
/** Never write outside the bundle ("zip slip"): plain relative paths only. */
const unsafePath = (path: string) =>
  /^[/\\]|[\\:]/.test(path) || path.split('/').some((s) => ['', '.', '..'].includes(s));
const manifestOf = ({ sha256, files, records, blobs }: iwb.ArchiveManifest) => ({
  sha256,
  files: files.length,
  records,
  blobs,
});
type Archive = Awaited<ReturnType<typeof iwb.readArchive>>;

/** What an import changes: bundle files added or updated, files that conflict, and records the replica lacks. */
async function importPlan(fs: iwb.BundleFs, replica: LocalReplica, x: Archive) {
  const [changes, conflicts]: [string[], string[]] = [[], []];
  for (const f of x.bundleFiles) {
    const cur = await fs.read(f.path);
    if (cur && !Buffer.from(cur).equals(Buffer.from(f.data))) conflicts.push(f.path);
    if (!cur || conflicts.includes(f.path)) changes.push(`${cur ? 'update' : 'add'} bundle/${f.path}`);
  }
  const fresh = [];
  for (const r of x.records) {
    const c = checkRecord(r);
    if ('error' in c) fail('INVALID_INPUT', `Invalid record in the archive: ${c.error}`);
    else if (!(await replica.getRecord(c.record.id))) fresh.push(c.record);
  }
  changes.push(`add ${fresh.length} records`, `add ${x.blobs.length} blobs`);
  return { changes, conflicts, fresh };
}

/** Write an import: the bundle files, the blobs, then the records that use them. */
async function applyImport(fs: iwb.BundleFs, replica: LocalReplica, x: Archive, fresh: iwb.AnyRecord[]) {
  for (const f of x.bundleFiles) await fs.write(f.path, f.data);
  if (!(await fs.read('.gitignore'))) await fs.write('.gitignore', 'cache/\nruns/\n');
  for (const b of x.blobs) await replica.putBlob(b.data); // blobs before the records that use them
  for (const r of fresh) await replica.putRecord(r);
}

const fixtureOf = (p: cx.Project, ref: string) =>
  p.bundle.fixtures.find((f) => f.data.key === ref.replace(/^[A-Z0-9]+:/, '') || f.data.id === ref) ??
  fail('NOT_FOUND', `Fixture ${ref} not found`);
const syncText = ({ pushed, pulled, workspace: w }: SyncResult) =>
  `pushed ${pushed.records} records, ${pushed.blobs} blobs; pulled ${pulled.records} records, ${pulled.blobs} blobs${
    w
      ? `; files: ${w.published.length} published, ${w.written.length} written, ${w.removed.length} removed`
      : ''
  }${w?.conflicts.length ? `\nconflicts to resolve (then delete them): ${w.conflicts.join(', ')}` : ''}`;
const z = zlib as unknown as Partial<
  Record<'zstdCompressSync' | 'zstdDecompressSync', (b: Uint8Array) => Uint8Array>
>;
const isZstd = (b: Uint8Array) => b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd;

export const dataCommands: Record<string, Spec> = {
  'fixture add': {
    description: 'Add a data file to a fixture (a pointer when large or with --blob)',
    args: {
      ...{ path: P('File to add'), to: S('Fixture (FX-n)', true), blob: B('Store as a pointer to a blob') },
      'local-only': B('Allow a pointer without a [store]'),
    },
    async run(ctx, a) {
      const p = await cx.openProject(ctx, a);
      const fx = fixtureOf(p, str(a.to)!);
      const abs = resolve(ctx.cwd, str(a.path)!);
      const bytes = new Uint8Array(await readFile(abs).catch(() => fail('NOT_FOUND', `${a.path} not found`)));
      const name = basename(abs);
      refuse(iwb.scanSecrets(name, dec.decode(bytes)), `add ${name}`);
      const project = p.bundle.project.data;
      const pointer = !!a.blob || bytes.length > (project.fixtures?.inline_max_bytes ?? 1048576);
      if (pointer && !project.store && !a['local-only'])
        fail(
          'INVALID_CONFIG',
          'A pointer needs a [store] so others can fetch it; pass --local-only to allow it',
        );
      const [dir, sha256] = [dirname(fx.file), await iwb.sha256Hex(bytes)];
      if (pointer) await p.replica.putBlob(bytes, mediaType(abs));
      const pointerToml = iwb.formatToml('blob-pointer', {
        sha256,
        size: bytes.length,
        media_type: mediaType(abs),
      });
      await p.fs.write(
        pointer ? `${dir}/${name}.blob.toml` : `${dir}/${name}`,
        pointer ? pointerToml : bytes,
      );
      await p.fs.remove(pointer ? `${dir}/${name}` : `${dir}/${name}.blob.toml`);
      if (!fx.data.files?.includes(name))
        await iwb.writeDefinition(p.fs, fx.file, 'fixture', {
          ...fx.data,
          files: [...(fx.data.files ?? []), name],
        });
      const text = `Added ${name} to ${fx.data.key}${pointer ? ' as a pointer' : ''}`;
      return { data: { files: [{ name, sha256, pointer }] }, text };
    },
  },

  'fixture fetch': {
    description: 'Download pointer blobs of a fixture into cache/blobs/ and verify them',
    args: {
      ...{ fixture: P('Fixture (FX-n)'), store: S('Store URL override') },
      out: S('Also copy the files into this folder under their own names'),
    },
    async run(ctx, a) {
      const p = await cx.openProject(ctx, a);
      const fx = fixtureOf(p, str(a.fixture)!);
      for (const f of fx.dataFiles.filter((d) => d.pointer)) await cachePointer(ctx, p, a, f);
      const out = str(a.out) ? resolve(ctx.cwd, str(a.out)!) : undefined;
      if (out) await mkdir(out, { recursive: true });
      const files = [];
      for (const f of fx.dataFiles) {
        const at = f.pointer ? cacheBlob(p, f.sha256) : join(p.dir, dirname(fx.file), f.name);
        if (out) await writeFile(join(out, f.name), await readFile(at));
        files.push({
          name: f.name,
          sha256: f.sha256,
          pointer: !!f.pointer,
          path: out ? join(out, f.name) : at,
        });
      }
      const text = files.map((f) => `${f.name} ${f.sha256.slice(0, 12)} ${f.path}`).join('\n');
      return { data: { files }, text };
    },
  },

  sync: {
    description: 'Exchange records and blobs between the local replica and the store',
    args: {
      ...{ watch: B('Keep running'), interval: S('Poll interval in seconds (default 3)') },
      ...{ 'pull-only': B(), 'push-only': B(), evidence: S('on-demand | all | none'), store: S('Store URL') },
      ...{ snapshot: B('Also publish a bundle snapshot'), full: B('List the whole store log') },
    },
    async run(ctx, a) {
      const p = await cx.openProject(ctx, a);
      if (!a['pull-only']) refuse(await iwb.scanBundleSecrets(p.fs), 'sync');
      const evidence = str(a.evidence) ?? p.bundle.project.data.store?.evidence;
      if (evidence && !['on-demand', 'all', 'none'].includes(evidence))
        fail('USAGE', '--evidence: on-demand, all or none');
      const snapshot = await snapshotOf(ctx, p);
      const store = await openStore(ctx, p, a);
      const workspace = p.bundle.project.data.store?.mode === 'workspace';
      if (workspace && git(p.dir, 'ls-files', '--', '.')) fail('CONFLICT', GIT_OWNS);
      const opts: SyncOptions = {
        ...{ ...store, replica: p.replica, projectId: p.bundle.project.data.id },
        direction: a['pull-only'] ? 'pull' : a['push-only'] ? 'push' : 'both',
        ...{
          evidence: evidence as SyncOptions['evidence'],
          full: !!a.full,
          bundle: a.snapshot ? snapshot : undefined,
          extraBlobs: pointerBlobs(p.bundle),
          workspace: workspace ? { fs: p.fs, actor: snapshot.actor, sign: snapshot.sign } : undefined,
        },
      };
      if (a.watch) return watchSync(ctx, opts, Number(str(a.interval) ?? 3) * 1000);
      const r = await syncOnce(opts);
      logWarnings(ctx, r);
      if (r.held?.length) fail('SECRETS_FOUND', held(r.held.length), r.held, r, syncText(r));
      return { data: r, text: syncText(r) };
    },
  },

  compact: {
    description: 'Write a log snapshot to the store so fresh clones pull fast',
    args: { store: S('Store URL') },
    async run(ctx, a) {
      const p = await cx.openProject(ctx, a);
      const r = await compactLog({
        store: (await openStore(ctx, p, a)).store,
        projectId: p.bundle.project.data.id,
      });
      for (const w of r.warnings ?? []) ctx.log(`warning: ${w}`);
      const what = `${r.logs} log object(s), ${r.records} record(s)`;
      return { data: r, text: r.written ? `wrote ${r.snapshot}: ${what}` : `no new log objects (${what})` };
    },
  },

  export: {
    description: 'Write a portable archive of the bundle, records and blobs',
    args: {
      ...{ full: B('Everything (required in v0.1)'), out: S('Archive path') },
      zstd: B('Compress with zstd (needs Node ≥ 22.15 to import) instead of gzip'),
    },
    async run(ctx, a) {
      if (!a.full) fail('USAGE', 'v0.1 writes full archives only: pass --full');
      const p = await cx.openProject(ctx, a);
      const paths = (await iwb.walk(p.fs, '')).filter((f) => !basename(f).startsWith('.'));
      const bundleFiles = await Promise.all(
        paths.map(async (path) => ({ path, data: (await p.fs.read(path))! })),
      );
      refuse(
        bundleFiles.flatMap((f) => iwb.scanSecrets(f.path, dec.decode(f.data))),
        'export',
      );
      const records = await p.replica.records();
      const pointers = p.bundle.fixtures.flatMap((f) =>
        f.dataFiles.filter((d) => d.pointer).map((d) => d.sha256),
      );
      const [blobs, warnings]: [{ path: string; data: Uint8Array }[], iwb.Problem[]] = [[], []];
      for (const sha of new Set([...records.flatMap(blobRefs), ...pointers])) {
        const data = (await p.replica.getBlob(sha)) ?? (await readFile(cacheBlob(p, sha)).catch(() => null)); // not cached: warned below
        if (data) blobs.push({ path: sha, data: new Uint8Array(data) });
        else
          warnings.push({
            severity: 'warning',
            code: 'missing-blob',
            message: `Blob ${sha} is not available locally`,
          });
      }
      const key = p.bundle.project.data.key;
      const now = ctx.env.IW_NOW ? new Date(ctx.env.IW_NOW) : new Date();
      const { tar, manifest: m } = await iwb.createArchive({
        project: key,
        bundleFiles,
        records,
        blobs,
        now,
      });
      if (a.zstd && !z.zstdCompressSync) fail('USAGE', '--zstd needs Node ≥ 22.15');
      const ext = a.zstd ? 'zst' : 'gz';
      const archive = resolve(
        ctx.cwd,
        str(a.out) ?? `${key.toLowerCase()}-${iso(now).slice(0, 10)}.tar.${ext}`,
      );
      await writeFile(archive, a.zstd ? z.zstdCompressSync!(tar) : zlib.gzipSync(tar));
      return {
        data: { archive, manifest: manifestOf(m) },
        warnings,
        text: `Wrote ${archive} (${m.records} records, ${m.blobs} blobs)`,
      };
    },
  },

  import: {
    description:
      'Read an archive from iw export --full, or: iw import playwright-plan <file.md> --uc <UC>, iw import github-issue <n|URL>',
    args: {
      archive: P('.tar.zst, .tar.gz or .tar (or playwright-plan, then the plan file)'),
      'dry-run': B('Report what would change'),
      merge: B('Into an existing bundle'),
      ...{ uc: S('Plan: use case of the new test cases'), mode: S('Plan: test case mode (default manual)') },
      ...{ model: S('Plan: model ID of the planner (or IW_AGENT_MODEL)'), skill: S('Plan: skill name') },
      ...{
        from: S('github-issue: gh issue view --json file'),
        feature: S('github-issue: feature of the use case'),
      },
    },
    async run(ctx, a) {
      if (str(a.archive) === 'playwright-plan') return importPlaywrightPlan(ctx, a);
      if (str(a.archive) === 'github-issue') return importGithubIssue(ctx, a);
      if (a.uc || a.mode || a.model || a.skill || a.from || a.feature)
        fail('USAGE', '--uc, --mode, --model, --skill, --from and --feature apply to plans and issues only');
      const archive = resolve(ctx.cwd, str(a.archive)!);
      const x = await iwb
        .readArchive(new Uint8Array(await readTar(archive, a.archive)))
        .catch((e: Error) => fail('INVALID_INPUT', e.message));
      const unsafe = x.bundleFiles.find((f) => unsafePath(f.path));
      if (unsafe) fail('INVALID_INPUT', `Unsafe path in the archive: bundle/${unsafe.path}`);
      const dir = str(a.dir) ? resolve(ctx.cwd, str(a.dir)!) : join(ctx.cwd, '.indx-watch');
      if (existsSync(join(dir, 'project.toml')) && !a.merge)
        fail('CONFLICT', `${dir} already has a bundle; pass --merge`);
      const [fs, replica] = [nodeFs(dir), openReplica(dir)];
      const { changes, conflicts, fresh } = await importPlan(fs, replica, x);
      const data = { archive, manifest: manifestOf(x.manifest), dryRun: !!a['dry-run'], changes };
      if (conflicts.length)
        fail('CONFLICT', `${conflicts.length} files differ from the archive`, conflicts, data);
      if (!a['dry-run']) await applyImport(fs, replica, x, fresh);
      return { data, text: changes.join('\n') };
    },
  },
};
