/**
 * Definitions between a git working copy and the hosted app (docs/spec/sync.md#data-flow-and-conflicts):
 * `iw deploy` publishes them merged with the newest snapshot, `iw pull` brings the hosted changes into the
 * working tree. Both use one three-way merge by file whose base is the merge base of HEAD and the
 * snapshot's commit, so changes on different files combine and the same file changed twice is a conflict.
 */
import { createHash } from 'node:crypto';
import * as iwb from '@indx-watch/bundle';
import { isOlderVersion } from '@indx-watch/core';
import { memoryBundleFs } from '@indx-watch/server';
import { accessHeaders } from '@indx-watch/store/node';
import { definitionFiles, pointerBlobs, syncOnce } from '@indx-watch/sync';
import { unpackTar } from 'modern-tar';
import type * as cx from '../context.js';
import { gitFs } from '../github.js';
import { type Args, type Ctx, fail, git, iso } from '../util.js';
import { logWarnings, openStore, snapshotOf } from './data.js';

export interface Published {
  snapshot: string | null;
  files: number;
  unchanged: boolean;
  /** files kept from the newest snapshot because only the hosted side changed them */
  merged: string[];
  /** files whose published content differs from HEAD: not in git yet */
  unsynced: string[];
  url: string | null;
}

type Files = Map<string, Uint8Array>;
type Store = Awaited<ReturnType<typeof openStore>>;
const same = (a?: Uint8Array, b?: Uint8Array) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]));
const order = (r: iwb.BundleRecord) => `${r.commit_time ?? ''}|${r.at}|${r.id}`;
const RESOLVE = 'run `iw pull`, resolve the .conflict files, commit, git push and deploy again';

/** Committed and on a remote branch, so the next publisher can merge it with git. Skipped in CI. */
function requirePushed(ctx: Ctx, p: cx.Project, what: string): void {
  if (ctx.env.CI || git(p.dir, 'rev-parse', '--is-inside-work-tree') !== 'true') return;
  if (git(p.dir, 'status', '--porcelain', '--', '.'))
    fail('CONFLICT', `Commit your changes to .indx-watch/ first (git commit), then ${what}`);
  if (what === 'deploy' && !git(p.dir, 'branch', '-r', '--contains', 'HEAD'))
    fail('CONFLICT', 'Push your commit first (git push), so the next person can merge it, then deploy');
}

/** The Worker must read what this CLI writes: refuse when it runs an older version than the project pins. */
async function requireCurrentWorker(ctx: Ctx, url: string, pin: string): Promise<void> {
  if (!/^https:\/\//.test(url)) return;
  const headers = await accessHeaders(url.replace(/\/+$/, ''), ctx.env).catch(() => ({}));
  const signal = AbortSignal.timeout(5000);
  const res = await fetch(new URL('/healthz', url), { headers, signal }).catch(() => null);
  const version = res?.ok
    ? ((await res.json().catch(() => ({}))) as { version?: string }).version
    : undefined;
  if (!version) return ctx.log(`warning: could not read ${url}/healthz; publishing anyway`);
  if (isOlderVersion(version, pin))
    fail(
      'CONFLICT',
      `The hosted app runs INDX Watch ${version} and this publish needs ${pin}: run the version the project pins (npx indx-watch@<[tool] indx_watch>), or ask someone with a Cloudflare login to run \`iw deploy\` (or the indx-watch-deploy workflow) first`,
    );
}

/** Pull records, then the newest bundle snapshot and its files (what the hosted app shows). */
async function newestSnapshot(ctx: Ctx, p: cx.Project, store: Store) {
  const base = { ...store, replica: p.replica, projectId: p.bundle.project.data.id };
  logWarnings(ctx, await syncOnce({ ...base, direction: 'pull' }));
  const record = (await p.replica.records())
    .filter((r): r is iwb.BundleRecord => r.kind === 'bundle')
    .sort((x, y) => (order(x) < order(y) ? 1 : -1))[0];
  if (!record) return null;
  const tar = (await p.replica.getBlob(record.sha256)) ?? (await store.store.getBlob(record.sha256));
  if (!tar) return fail('STORE_ERROR', `Snapshot ${record.id} has no tarball`);
  const files: Files = new Map();
  for (const e of await unpackTar(tar))
    if ((e.header.type ?? 'file') === 'file') files.set(e.header.name, new Uint8Array(e.data ?? []));
  return { record, files };
}

/** The bundle's definition files at a git revision; null outside a git repository. */
async function filesAt(p: cx.Project, rev: string): Promise<Files | null> {
  const root = git(p.dir, 'rev-parse', '--show-toplevel');
  if (!root) return null;
  const prefix = (git(p.dir, 'rev-parse', '--show-prefix') ?? '').replace(/\/$/, '');
  return definitionFiles(gitFs(root, rev, prefix));
}

/**
 * Three-way merge by file: mine (the working tree), theirs (the snapshot), base (the merge base of HEAD and
 * the snapshot's commit). `merged`: changed only on their side; `conflicts`: changed on both sides differently.
 */
async function threeWay(p: cx.Project, theirs: Files, commit?: string) {
  const has = (c: string) => git(p.dir, 'cat-file', '-t', c) === 'commit';
  // a shallow CI checkout lacks the history the merge base is in
  const shallow = git(p.dir, 'rev-parse', '--is-shallow-repository') === 'true';
  if (commit && !has(commit)) git(p.dir, 'fetch', '--quiet', ...(shallow ? ['--unshallow'] : []));
  const base = (commit && has(commit) && git(p.dir, 'merge-base', 'HEAD', commit)) || null;
  const old = (base && (await filesAt(p, base))) || (new Map() as Files);
  // after a squash or rebase merge the base is too old: theirs that HEAD's history already had is not news
  const blob = (t: Uint8Array) => createHash('sha1').update(`blob ${t.length}\0`).update(t).digest('hex');
  const log = (path: string) => git(p.dir, 'log', '--raw', '--no-abbrev', '--format=', 'HEAD', '--', path);
  const known = (path: string, t?: Uint8Array) => !!t && !!log(path)?.includes(blob(t));
  const mine = await definitionFiles(p.fs);
  const out: Files = new Map(mine);
  const merged: string[] = [];
  const conflicts: string[] = [];
  for (const path of new Set([...mine.keys(), ...theirs.keys()])) {
    const [m, t, b] = [mine.get(path), theirs.get(path), old.get(path)];
    if (same(m, t) || same(t, b) || known(path, t)) continue;
    if (!same(m, b)) conflicts.push(path);
    else {
      merged.push(path);
      if (t) out.set(path, t);
      else out.delete(path);
    }
  }
  return { out, merged, conflicts };
}

/** Files that differ between two sets: present in one only, or with other bytes. */
const differing = (a: Files, b: Files) =>
  [...new Set([...a.keys(), ...b.keys()])].filter((k) => !same(a.get(k), b.get(k))).sort();

/** Publish the definitions (and push results), merged with the newest snapshot unless `force`. */
export async function publishDefinitions(
  ctx: Ctx,
  p: cx.Project,
  a: Args,
  o: { force?: boolean; pin?: string; message?: string },
): Promise<Published> {
  const checked = await iwb.checkBundle(p.fs);
  if (checked.errors)
    fail('CHECK_FAILED', `Refusing to publish: iw check found ${checked.errors} error(s)`, checked.problems);
  if (!o.force) requirePushed(ctx, p, 'deploy');
  const store = await openStore(ctx, p, a);
  const url = store.store.objects.url;
  if (o.pin) await requireCurrentWorker(ctx, url, o.pin);
  const newest = await newestSnapshot(ctx, p, store);
  const merge = newest && !o.force ? await threeWay(p, newest.files, newest.record.commit) : null;
  if (merge?.conflicts.length)
    fail('CONFLICT', `The hosted app and your branch both changed ${merge.conflicts.join(', ')}: ${RESOLVE}`);
  const fs = merge?.merged.length ? memoryBundleFs(merge.out) : p.fs;
  if (merge?.merged.length) {
    const after = await iwb.checkBundle(fs);
    if (after.errors)
      fail(
        'CONFLICT',
        `Merging the hosted changes (${merge.merged.join(', ')}) gives ${after.errors} error(s), e.g. a key used twice: ${RESOLVE}`,
        after.problems,
      );
    ctx.log(
      `Kept changes the hosted app has and your branch lacks: ${merge.merged.join(', ')}.\nRun \`iw pull\` to bring them into this working copy, then commit and push.`,
    );
  }
  const head = await filesAt(p, 'HEAD');
  const unsynced = head ? differing(await definitionFiles(fs), head) : [];
  // ordered by publish time, so this snapshot, which holds the merge, is the newest (docs/spec/sync.md#data-flow-and-conflicts)
  const snap = { ...(await snapshotOf(ctx, p)), commitTime: iso(new Date()) };
  const bundle = {
    ...snap,
    fs,
    ...(unsynced.length && { clean: false, unsynced }),
    manual: true,
    ...(o.message && { message: o.message }),
  };
  const base = { ...store, replica: p.replica, projectId: p.bundle.project.data.id };
  const r = await syncOnce({ ...base, bundle, extraBlobs: pointerBlobs(p.bundle) });
  logWarnings(ctx, r);
  if (r.held?.length) fail('SECRETS_FOUND', `Held back ${r.held.length} record(s): retract them`, r.held);
  const hosted = /^https?:\/\//.test(url) ? `${url.replace(/\/+$/, '')}/#/uploads` : null;
  const files = checked.files;
  return {
    snapshot: r.snapshot,
    files,
    unchanged: !r.snapshot,
    merged: merge?.merged ?? [],
    unsynced,
    url: hosted,
  };
}

/**
 * `iw pull`: write the hosted changes the working tree lacks into it. A file both sides changed keeps
 * yours and gets the hosted version beside it as `<name>.conflict-<sha8>.<ext>`, which `iw check` fails on.
 */
export async function pullDefinitions(ctx: Ctx, p: cx.Project, a: Args) {
  requirePushed(ctx, p, 'pull');
  const store = await openStore(ctx, p, a);
  const newest = await newestSnapshot(ctx, p, store);
  const data = {
    snapshot: newest?.record.id ?? null,
    written: [] as string[],
    removed: [] as string[],
    conflicts: [] as string[],
  };
  if (!newest) return data;
  const { merged, conflicts } = await threeWay(p, newest.files, newest.record.commit);
  for (const path of merged) {
    const file = newest.files.get(path);
    if (file) await p.fs.write(path, file);
    else await p.fs.remove(path);
    (file ? data.written : data.removed).push(path);
  }
  for (const path of conflicts) {
    const file = newest.files.get(path);
    if (!file) {
      data.conflicts.push(`${path} (deleted in the hosted app: delete it here too, or keep it)`);
      continue;
    }
    const sha8 = (await iwb.sha256Hex(file)).slice(0, 8);
    const dot = path.lastIndexOf('.');
    const name =
      dot > path.lastIndexOf('/')
        ? `${path.slice(0, dot)}.conflict-${sha8}${path.slice(dot)}`
        : `${path}.conflict-${sha8}`;
    await p.fs.write(name, file);
    data.conflicts.push(name);
  }
  return data;
}
