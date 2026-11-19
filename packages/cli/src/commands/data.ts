/** Data movement: fixture add/fetch, sync, export --full, import. */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import * as zlib from 'node:zlib';
import * as iwb from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { blobRefs, checkRecord, createResultStore } from '@indx-watch/store';
import { openObjectStore, openReplica } from '@indx-watch/store/node';
import { type SyncOptions, type SyncResult, syncOnce, watch } from '@indx-watch/sync';
import { fileStateStore, writerId } from '@indx-watch/sync/node';
import type { Spec } from '../cli.js';
import * as cx from '../context.js';
import { type Args, B, type Ctx, fail, git, iso, P, S, str } from '../util.js';
import { mediaType } from './results.js';
import { cacheBlob } from './specs.js';

const dec = new TextDecoder();
/** Refuse when the secret scan finds errors in any of the files (exit 1). */
function scan(files: { path: string; text: string }[], what: string) {
  const found = files.flatMap((f) => iwb.scanSecrets(f.path, f.text)).filter((x) => x.severity === 'error');
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
  };
}

const fixtureOf = (p: cx.Project, ref: string) =>
  p.bundle.fixtures.find((f) => f.data.key === ref.replace(/^[A-Z0-9]+:/, '') || f.data.id === ref) ??
  fail('NOT_FOUND', `Fixture ${ref} not found`);
const syncText = (r: SyncResult) =>
  `pushed ${r.pushed.records} records, ${r.pushed.blobs} blobs; pulled ${r.pulled.records} records, ${r.pulled.blobs} blobs`;
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
      scan([{ path: name, text: dec.decode(bytes) }], `add ${name}`);
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
    args: { fixture: P('Fixture (FX-n)'), store: S('Store URL override') },
    async run(ctx, a) {
      const p = await cx.openProject(ctx, a);
      const fx = fixtureOf(p, str(a.fixture)!);
      for (const f of fx.dataFiles.filter((d) => d.pointer)) {
        const path = cacheBlob(p, f.sha256);
        if (existsSync(path) && (await iwb.sha256Hex(await readFile(path))) === f.sha256) continue;
        const local = await p.replica.getBlob(f.sha256);
        const data = local ?? (await (await openStore(ctx, p, a)).store.getBlob(f.sha256));
        if (!data) fail('NOT_FOUND', `The blob of ${f.name} (${f.sha256}) is not in the store`);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, data!);
      }
      const files = fx.dataFiles.map((f) => ({ name: f.name, sha256: f.sha256, pointer: !!f.pointer }));
      return { data: { files }, text: files.map((f) => `${f.name} ${f.sha256.slice(0, 12)}`).join('\n') };
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
      const records = (await p.replica.records()).map((r) => ({
        path: `runs/${r.id}`,
        text: JSON.stringify(r),
      }));
      scan([...(await iwb.loadDetailed(p.fs)).files, ...records], 'sync');
      const evidence = str(a.evidence) ?? p.bundle.project.data.store?.evidence;
      if (evidence && !['on-demand', 'all', 'none'].includes(evidence))
        fail('USAGE', '--evidence: on-demand, all or none');
      const time = git(p.dir, 'log', '-1', '--format=%cI');
      const snapshot = {
        fs: p.fs,
        commit: git(p.dir, 'rev-parse', 'HEAD') ?? undefined,
        ref: git(p.dir, 'symbolic-ref', '-q', 'HEAD') ?? undefined,
        clean: git(p.dir, 'status', '--porcelain', '--', '.') === '',
        commitTime: time ? iso(new Date(time)) : undefined,
        actor: await cx.actorOf(ctx),
      };
      const opts: SyncOptions = {
        ...{ replica: p.replica, ...(await openStore(ctx, p, a)), projectId: p.bundle.project.data.id },
        direction: a['pull-only'] ? 'pull' : a['push-only'] ? 'push' : 'both',
        ...{
          evidence: evidence as SyncOptions['evidence'],
          full: !!a.full,
          bundle: a.snapshot ? snapshot : undefined,
        },
      };
      if (!a.watch) {
        const r = await syncOnce(opts);
        return { data: r, text: syncText(r) };
      }
      let last: SyncResult = {
        pushed: { records: 0, blobs: 0 },
        pulled: { records: 0, blobs: 0 },
        snapshot: null,
        cursor: null,
      };
      const stop = watch({
        ...{ ...opts, intervalMs: Number(str(a.interval) ?? 3) * 1000 },
        onResult: (r) => {
          last = r;
          if (r.pushed.records + r.pulled.records) ctx.log(syncText(r));
        },
        onError: (e) => ctx.log(`sync error: ${(e as Error).message}`),
      });
      ctx.log('Watching the store (Ctrl+C to stop)');
      await new Promise((res) => process.once('SIGINT', res).once('SIGTERM', res));
      await stop();
      return { data: last, text: syncText(last) };
    },
  },

  export: {
    description: 'Write a portable archive of the bundle, records and blobs',
    args: { full: B('Everything (required in v0.1)'), out: S('Archive path') },
    async run(ctx, a) {
      if (!a.full) fail('USAGE', 'v0.1 writes full archives only: pass --full');
      const p = await cx.openProject(ctx, a);
      const paths = (await iwb.walk(p.fs, '')).filter((f) => !basename(f).startsWith('.'));
      const bundleFiles = await Promise.all(
        paths.map(async (path) => ({ path, data: (await p.fs.read(path))! })),
      );
      scan(
        bundleFiles.map((f) => ({ path: f.path, text: dec.decode(f.data) })),
        'export',
      );
      const records = await p.replica.records();
      const pointers = p.bundle.fixtures.flatMap((f) =>
        f.dataFiles.filter((d) => d.pointer).map((d) => d.sha256),
      );
      const [blobs, warnings]: [{ path: string; data: Uint8Array }[], iwb.Problem[]] = [[], []];
      for (const sha of new Set([...records.flatMap(blobRefs), ...pointers])) {
        const data = (await p.replica.getBlob(sha)) ?? (await readFile(cacheBlob(p, sha)).catch(() => null));
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
      const ext = z.zstdCompressSync ? 'zst' : 'gz';
      const archive = resolve(
        ctx.cwd,
        str(a.out) ?? `${key.toLowerCase()}-${iso(now).slice(0, 10)}.tar.${ext}`,
      );
      await writeFile(archive, z.zstdCompressSync ? z.zstdCompressSync(tar) : zlib.gzipSync(tar));
      const manifest = { sha256: m.sha256, files: m.files.length, records: m.records, blobs: m.blobs };
      return {
        data: { archive, manifest },
        warnings,
        text: `Wrote ${archive} (${m.records} records, ${m.blobs} blobs)`,
      };
    },
  },

  import: {
    description: 'Read an archive written by iw export --full into the current directory',
    args: {
      archive: P('.tar.zst, .tar.gz or .tar'),
      'dry-run': B('Report what would change'),
      merge: B('Into an existing bundle'),
    },
    async run(ctx, a) {
      const archive = resolve(ctx.cwd, str(a.archive)!);
      const raw = new Uint8Array(
        await readFile(archive).catch(() => fail('NOT_FOUND', `${a.archive} not found`)),
      );
      if (isZstd(raw) && !z.zstdDecompressSync)
        fail('INVALID_INPUT', 'This Node.js cannot read zstd; use Node ≥ 22.15');
      const tar = isZstd(raw)
        ? z.zstdDecompressSync!(raw)
        : raw[0] === 0x1f && raw[1] === 0x8b
          ? zlib.gunzipSync(raw)
          : raw;
      const x = await iwb
        .readArchive(new Uint8Array(tar))
        .catch((e: Error) => fail('INVALID_INPUT', e.message));
      const dir = str(a.dir) ? resolve(ctx.cwd, str(a.dir)!) : join(ctx.cwd, '.indx-watch');
      if (existsSync(join(dir, 'project.toml')) && !a.merge)
        fail('CONFLICT', `${dir} already has a bundle; pass --merge`);
      const [fs, replica] = [nodeFs(dir), openReplica(dir)];
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
      const m = x.manifest;
      const manifest = { sha256: m.sha256, files: m.files.length, records: m.records, blobs: m.blobs };
      const data = { archive, manifest, dryRun: !!a['dry-run'], changes };
      if (conflicts.length)
        fail('CONFLICT', `${conflicts.length} files differ from the archive`, conflicts, data);
      if (!a['dry-run']) {
        for (const f of x.bundleFiles) await fs.write(f.path, f.data);
        if (!(await fs.read('.gitignore'))) await fs.write('.gitignore', 'cache/\nruns/\n');
        for (const r of fresh) await replica.putRecord(r);
        for (const b of x.blobs) await replica.putBlob(b.data);
      }
      return { data, text: changes.join('\n') };
    },
  },
};
