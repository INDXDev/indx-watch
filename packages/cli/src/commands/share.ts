/** Sharing definitions: push (upload a snapshot), clone (download one), translate (content i18n). */
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import * as iwb from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { createResultStore } from '@indx-watch/store';
import { openObjectStore } from '@indx-watch/store/node';
import { pointerBlobs, syncOnce } from '@indx-watch/sync';
import { unpackTar } from 'modern-tar';
import type { Spec } from '../cli.js';
import * as cx from '../context.js';
import { type Args, B, type Ctx, fail, many, P, S, str } from '../util.js';
import { logWarnings, openStore, snapshotOf } from './data.js';

/** relative, no `..` or hidden segments, outside cache/, runs/ and patches/ */
const SAFE_PATH = /^(?!(?:cache|runs|patches)\/)(?:(?!\.)[^/\\:]+\/)*(?!\.)[^/\\:]+$/;
const order = (r: iwb.BundleRecord) => `${r.commit_time ?? ''}|${r.at}|${r.id}`;

/** Every bundle record in a store, newest first. */
async function snapshots(store: ReturnType<typeof createResultStore>): Promise<iwb.BundleRecord[]> {
  const out: iwb.BundleRecord[] = [];
  for (let after: string | undefined, more = true; more; ) {
    const page = await store.listLog({ startAfter: after, limit: 1000 });
    for (const key of page.keys)
      for (const r of (await store.readLog(key)).records) if (r.kind === 'bundle') out.push(r);
    [after, more] = [page.keys.at(-1), page.truncated && page.keys.length > 0];
  }
  return out.sort((a, b) => (order(a) < order(b) ? 1 : -1));
}

// ---------- translate ----------
type Target = {
  ref: string;
  prefix: string;
  source: Record<string, unknown>;
  kind: keyof typeof iwb.TRANSLATABLE_FIELDS;
};
type Owner = {
  ref: string;
  file: string;
  type: iwb.FileType;
  data: Record<string, unknown>;
  targets: Target[];
};
type Def = { file: string; data: object };
type Into = { locale: string; status: string; owner: string };
const TF = iwb.TRANSLATABLE_FIELDS;

/** Every translatable entity with its sub-targets (steps, criteria). */
function owners(b: iwb.Bundle): Owner[] {
  // the file type doubles as the translation kind of the entity itself
  const one = (ref: string, x: Def, type: iwb.FileType & Target['kind']): Owner => {
    const d = x.data as Record<string, unknown>;
    return { ref, file: x.file, type, data: d, targets: [{ ref, prefix: '', source: d, kind: type }] };
  };
  const out = [
    ...b.features.map((x) => one(x.data.key, x, 'feature')),
    ...b.environments.map((x) => one(x.data.name, x, 'environment')),
    ...b.releases.map((x) => one(x.data.version, x, 'release')),
    ...b.plans.map((x) => one(x.data.key, x, 'plan')),
    ...b.fixtures.map((x) => one(x.data.key, x, 'fixture')),
  ];
  for (const x of b.useCases) {
    const o = one(x.data.key, x, 'use-case');
    for (const c of x.data.criteria)
      o.targets.push({ ref: x.data.key, prefix: `criteria.${c.key}.`, source: c, kind: 'criterion' });
    out.push(o);
  }
  for (const x of b.sharedSteps) {
    const o = one(x.data.key, x, 'shared-step');
    x.data.steps.forEach((s, i) => {
      if (!s.use) o.targets.push({ ref: x.data.key, prefix: `steps.${i + 1}.`, source: s, kind: 'step' });
    });
    out.push(o);
  }
  for (const x of b.testCases) {
    const o = one(x.data.key, x, 'test-case');
    x.data.steps.forEach((s, i) => {
      // steps of a shared step are translated in its own file
      if (!s.from) o.targets.push({ ref: x.data.key, prefix: `steps.${i + 1}.`, source: s, kind: 'step' });
    });
    x.data.fixtures?.forEach((f, i) => {
      o.targets.push({ ref: x.data.key, prefix: `fixtures.${i + 1}.`, source: f, kind: 'fixture-use' });
    });
    out.push(o);
  }
  return out;
}

type Tr = Record<string, unknown> & { status?: string; source_hash?: string };
const tableOf = (t: Target, locale: string) => (t.source.i18n as Record<string, Tr> | undefined)?.[locale];

/** Source text, translation and state of every translatable field of a target that has source text. */
async function fieldsOf(t: Target, locale: string) {
  const hash = await iwb.translationSourceHash(t.source, TF[t.kind]);
  const tr = tableOf(t, locale);
  const one = (path: string, source: unknown, tx: unknown) => {
    if (typeof source !== 'string' || !source) return [];
    const text = typeof tx === 'string' && tx ? tx : undefined;
    const state = !text ? 'missing' : tr?.source_hash !== hash ? 'stale' : (tr?.status ?? 'machine');
    return [{ ref: t.ref, path, source, ...(text && { text }), state }];
  };
  return TF[t.kind].flatMap((f) => {
    const [source, text] = [t.source[f], tr?.[f]];
    // a list (step checks) has one path per item: steps.1.checks.1
    if (!Array.isArray(source)) return one(`${t.prefix}${f}`, source, text);
    return source.flatMap((s, i) => one(`${t.prefix}${f}.${i + 1}`, s, (text as unknown[] | undefined)?.[i]));
  });
}

/** `<field>` or `<list field>.<n>` of a target; null for anything else. */
const pathOf = (rest: string) => /^([a-z_]+)(?:\.([1-9]\d*))?$/.exec(rest);

/** Fields of every target of the owners, in order. */
const fieldsOfAll = async (targets: Target[], locale: string) =>
  (await Promise.all(targets.map((t) => fieldsOf(t, locale)))).flat();

/** The translations given by --from (a JSON file or - for stdin) and --set <path>=<text>. */
async function givenOf(ctx: Ctx, a: Args) {
  const raw = str(a.from) && (await cx.readFrom(ctx, str(a.from)!));
  let given: Record<string, string> = {};
  try {
    given = raw ? JSON.parse(raw) : {};
  } catch (e) {
    fail('INVALID_INPUT', `--from: ${(e as Error).message}`);
  }
  for (const kv of many(a.set)) {
    const at = kv.indexOf('=');
    if (at < 1) fail('USAGE', `--set ${kv}: use <path>=<text>`);
    given[kv.slice(0, at)] = kv.slice(at + 1);
  }
  return given;
}

/**
 * Write the given fields that belong to one target into its i18n table (status, fresh source_hash) and return their
 * paths. Refuses unknown fields and a partial update of a table whose source changed.
 */
async function translateTarget(t: Target, given: Record<string, string>, to: Into) {
  const at = (k: string) => (k.startsWith(t.prefix) ? pathOf(k.slice(t.prefix.length)) : null);
  const mine = Object.entries(given).filter(([k]) => at(k));
  if (!mine.length) return [];
  const names = TF[t.kind] as readonly string[];
  const hash = await iwb.translationSourceHash(t.source, TF[t.kind]);
  const old = tableOf(t, to.locale) ?? {};
  const fresh = old.source_hash === hash;
  // only a field with source text is translated; a translation of a removed field is dropped
  const has = (f: string) => !!(t.source[f] as { length?: number } | undefined)?.length;
  const fields: Record<string, unknown> = {};
  for (const [k, v] of mine) {
    const [, f = '', n] = at(k)!;
    const src = t.source[f];
    if (!names.includes(f) || !has(f) || Array.isArray(src) !== !!n || Number(n) > (src as string[]).length)
      fail('USAGE', `${k} is not a translatable field of ${to.owner} with source text`);
    const list = (fields[f] ?? (fresh && Array.isArray(old[f]) ? [...old[f]] : [])) as string[];
    fields[f] = n ? Object.assign(list, { [Number(n) - 1]: v }) : v;
  }
  // a stale table is translated whole, and a list (checks) has every item
  const outdated = names.flatMap((f) => {
    const [src, mine] = [t.source[f], fields[f] as string[] | undefined];
    if (Array.isArray(src) && mine)
      return src.flatMap((_, i) => (typeof mine[i] === 'string' ? [] : [`${f}.${i + 1}`]));
    return !fresh && old[f] !== undefined && !mine && has(f) ? [f] : [];
  });
  if (outdated.length) fail('USAGE', `Also translate ${outdated.map((f) => `${t.prefix}${f}`).join(', ')}`);
  const kept = Object.fromEntries(Object.entries(old).filter(([f]) => !names.includes(f) || has(f)));
  const i18n = {
    ...(t.source.i18n as object),
    [to.locale]: { ...kept, ...fields, status: to.status, source_hash: hash },
  };
  Object.assign(t.source, { i18n }); // targets alias owner.data (or its steps / criteria)
  return mine.map(([k]) => k);
}

/** iw sharing commands: push, clone, translate. */
export const shareCommands: Record<string, Spec> = {
  push: {
    description: 'Upload the definitions (a bundle snapshot) and results to the store',
    args: { store: S('Store URL override'), message: S('Shown on the Uploads screen') },
    async run(ctx, a) {
      const p = await cx.openProject(ctx, a);
      const checked = await iwb.checkBundle(p.fs);
      if (checked.errors)
        fail('CHECK_FAILED', `Refusing to push: iw check found ${checked.errors} error(s)`, checked.problems);
      const store = await openStore(ctx, p, a);
      const bundle = {
        ...(await snapshotOf(ctx, p)),
        manual: true,
        ...(str(a.message) && { message: str(a.message) }),
      };
      const r = await syncOnce({
        ...{ ...store, replica: p.replica, projectId: p.bundle.project.data.id },
        ...{ bundle, extraBlobs: pointerBlobs(p.bundle) },
      });
      logWarnings(ctx, r);
      if (r.held?.length) fail('SECRETS_FOUND', `Held back ${r.held.length} record(s): retract them`, r.held);
      const url = store.store.objects.url;
      const hosted = /^https?:\/\//.test(url) ? `${url.replace(/\/+$/, '')}/#/uploads` : null;
      const data = {
        snapshot: r.snapshot,
        files: checked.files,
        unchanged: !r.snapshot,
        pushed: r.pushed,
        url: hosted,
      };
      const text = r.snapshot
        ? `Uploaded ${checked.files} files as ${r.snapshot}${hosted ? `\nView: ${hosted}` : ''}`
        : 'Definitions unchanged since the newest snapshot; pushed results only';
      return { data, text };
    },
  },

  clone: {
    description: 'Create a working copy from a hosted app or a store (newest snapshot + results)',
    args: { source: P('Hosted app URL or store URL (s3://, file://)'), target: P('Directory', false) },
    async run(ctx, a) {
      const source = str(a.source)!;
      const objects = openObjectStore({ url: source }, { bundleDir: ctx.cwd, env: ctx.env });
      const store = createResultStore(objects);
      const snap = (await snapshots(store))[0];
      if (!snap) return fail('STORE_ERROR', `No bundle snapshot in ${source}: run iw push there first`);
      const tar =
        (await store.getBlob(snap.sha256)) ?? fail('STORE_ERROR', `Snapshot ${snap.id} has no tarball`);
      const files = new Map<string, Uint8Array>();
      for (const e of await unpackTar(tar))
        if ((e.header.type ?? 'file') === 'file') files.set(e.header.name, new Uint8Array(e.data ?? []));
      const project = iwb.Project.safeParse(
        iwb.parseToml(new TextDecoder().decode(files.get('project.toml'))),
      );
      if (!project.success) return fail('INVALID_CONFIG', `Snapshot ${snap.id} has no valid project.toml`);
      const dir = resolve(ctx.cwd, str(a.target) ?? project.data.key.toLowerCase());
      if (existsSync(dir) && (await readdir(dir)).length)
        fail('CONFLICT', `${dir} is not empty; pass an empty or new directory`);
      const bundleDir = join(dir, '.indx-watch');
      await mkdir(bundleDir, { recursive: true });
      const fs = nodeFs(bundleDir);
      for (const [path, data] of files) if (SAFE_PATH.test(path)) await fs.write(path, data);
      await fs.write('.gitignore', 'cache/\nruns/\n');
      if (project.data.store?.url !== source) {
        const store = { ...project.data.store, url: source };
        await iwb.writeDefinition(fs, 'project.toml', 'project', { ...project.data, store });
      }
      const p = await cx.openProject({ ...ctx, cwd: dir }, {});
      const pulled = await syncOnce({
        ...{ ...(await openStore({ ...ctx, cwd: dir }, p, {})), replica: p.replica },
        ...{ projectId: p.bundle.project.data.id, direction: 'pull' },
      });
      const data = { dir, snapshot: snap.id, files: files.size, pulled: pulled.pulled };
      const text = `Cloned ${files.size} files and ${pulled.pulled.records} records into ${dir}\nNext: cd ${dir} && npx indx-watch serve`;
      return { data, text };
    },
  },

  translate: {
    description: 'List or write content translations with the right source_hash',
    repeat: ['set'],
    args: {
      ...{ ref: P('Entity (TC-3, UC-2, FEAT-1, FX-1, PLAN-1, a release or an environment)', false) },
      ...{ locale: S('Translation locale (ja)', true), set: S('<path>=<text>, repeatable') },
      ...{ from: S('JSON file ({ "<path>": "<text>" }) or - for stdin'), reviewed: B('Mark as reviewed') },
      missing: B('List missing or stale translations of every entity'),
    },
    async run(ctx, a) {
      const p = await cx.openProject(ctx, a);
      const locale = str(a.locale)!;
      if (
        !p.bundle.project.data.locales.includes(locale as iwb.Locale) ||
        locale === p.bundle.project.data.source_locale
      )
        fail('USAGE', `${locale} is not a translation locale of this project (project.locales)`);
      const all = owners(p.bundle);
      const ref = str(a.ref);
      if (!ref) {
        if (!a.missing) fail('USAGE', 'Pass a ref, or --missing');
        const fields = await fieldsOfAll(
          all.flatMap((o) => o.targets),
          locale,
        );
        const open = fields.filter((f) => f.state === 'missing' || f.state === 'stale');
        const text = open.map((f) => `${f.ref} ${f.path}: ${f.state}`).join('\n') || 'Nothing missing';
        return { data: { ref: null, locale, fields: open }, text };
      }
      const owner =
        all.find((o) => o.ref === ref.replace(/^[A-Z0-9]+:/, '')) ?? fail('NOT_FOUND', `${ref} not found`);
      const given = await givenOf(ctx, a);
      if (!Object.keys(given).length) {
        const fields = await fieldsOfAll(owner.targets, locale);
        const text = fields
          .map((f) => `${f.path} [${f.state}]\n  ${f.source}\n  ${f.text ?? '—'}`)
          .join('\n');
        return { data: { ref: owner.ref, locale, fields }, text };
      }
      if (a.reviewed) await cx.humanOnly(ctx, 'mark translations as reviewed');
      const status = a.reviewed ? 'reviewed' : 'machine';
      const written: string[] = [];
      for (const t of owner.targets)
        written.push(...(await translateTarget(t, given, { locale, status, owner: owner.ref })));
      const unknown = Object.keys(given).filter((k) => !written.includes(k));
      if (unknown.length) fail('USAGE', `Unknown field path(s): ${unknown.join(', ')}`);
      await iwb.writeDefinition(p.fs, owner.file, owner.type, owner.data);
      const text = `Wrote ${written.length} ${locale} field(s) of ${owner.ref} (${status}) to ${owner.file}`;
      return { data: { ref: owner.ref, locale, file: owner.file, status, written }, text };
    },
  },
};
