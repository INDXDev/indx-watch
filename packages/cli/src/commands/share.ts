/** Sharing definitions: push (upload a snapshot), clone (download one), translate (content i18n). */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import * as iwb from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { createResultStore } from '@indx-watch/store';
import { openObjectStore } from '@indx-watch/store/node';
import { pointerBlobs, syncOnce } from '@indx-watch/sync';
import { unpackTar } from 'modern-tar';
import type { Spec } from '../cli.js';
import * as cx from '../context.js';
import { B, fail, git, iso, many, P, S, str } from '../util.js';
import { openStore } from './data.js';

/** relative, no `..` or hidden segments, outside cache/ and runs/ */
const SAFE_PATH = /^(?!(?:cache|runs)\/)(?:(?!\.)[^/\\:]+\/)*(?!\.)[^/\\:]+$/;
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
const TF = iwb.TRANSLATABLE_FIELDS;

/** Every translatable entity with its sub-targets (steps, criteria). */
function owners(b: iwb.Bundle): Owner[] {
  const one = (ref: string, file: string, type: iwb.FileType, data: object, kind: Target['kind']): Owner => {
    const d = data as Record<string, unknown>;
    return { ref, file, type, data: d, targets: [{ ref, prefix: '', source: d, kind }] };
  };
  const out = [
    ...b.features.map((x) => one(x.data.key, x.file, 'feature', x.data, 'feature')),
    ...b.environments.map((x) => one(x.data.name, x.file, 'environment', x.data, 'environment')),
    ...b.releases.map((x) => one(x.data.version, x.file, 'release', x.data, 'release')),
    ...b.plans.map((x) => one(x.data.key, x.file, 'plan', x.data, 'plan')),
    ...b.fixtures.map((x) => one(x.data.key, x.file, 'fixture', x.data, 'fixture')),
  ];
  for (const x of b.useCases) {
    const o = one(x.data.key, x.file, 'use-case', x.data, 'use-case');
    for (const c of x.data.criteria)
      o.targets.push({ ref: x.data.key, prefix: `criteria.${c.key}.`, source: c, kind: 'criterion' });
    out.push(o);
  }
  for (const x of b.testCases) {
    const o = one(x.data.key, x.file, 'test-case', x.data, 'test-case');
    x.data.steps.forEach((s, i) => {
      o.targets.push({ ref: x.data.key, prefix: `steps.${i + 1}.`, source: s, kind: 'step' });
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
  return TF[t.kind].flatMap((f) => {
    const source = t.source[f];
    if (typeof source !== 'string' || !source) return [];
    const text = typeof tr?.[f] === 'string' ? (tr[f] as string) : undefined;
    const state = !text ? 'missing' : tr?.source_hash !== hash ? 'stale' : (tr?.status ?? 'machine');
    return [{ ref: t.ref, path: `${t.prefix}${f}`, source, ...(text && { text }), state }];
  });
}

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
      const time = git(p.dir, 'log', '-1', '--format=%cI');
      const bundle = {
        fs: p.fs,
        commit: git(p.dir, 'rev-parse', 'HEAD') ?? undefined,
        ref: git(p.dir, 'symbolic-ref', '-q', 'HEAD') ?? undefined,
        clean: git(p.dir, 'status', '--porcelain', '--', '.') === '',
        commitTime: time ? iso(new Date(time)) : undefined,
        actor: await cx.actorOf(ctx),
        sign: cx.signerOf(ctx),
        manual: true,
        ...(str(a.message) && { message: str(a.message) }),
      };
      const r = await syncOnce({
        ...{ ...store, replica: p.replica, projectId: p.bundle.project.data.id },
        ...{ bundle, extraBlobs: pointerBlobs(p.bundle) },
      });
      for (const w of r.warnings ?? []) ctx.log(`warning: ${w}`);
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
        const fields = [];
        for (const o of all) for (const t of o.targets) fields.push(...(await fieldsOf(t, locale)));
        const open = fields.filter((f) => f.state === 'missing' || f.state === 'stale');
        const text = open.map((f) => `${f.ref} ${f.path}: ${f.state}`).join('\n') || 'Nothing missing';
        return { data: { ref: null, locale, fields: open }, text };
      }
      const owner =
        all.find((o) => o.ref === ref.replace(/^[A-Z0-9]+:/, '')) ?? fail('NOT_FOUND', `${ref} not found`);
      const raw =
        str(a.from) === '-'
          ? await new Response(process.stdin as never).text()
          : str(a.from) && (await readFile(resolve(ctx.cwd, str(a.from)!), 'utf8'));
      const given: Record<string, string> = raw ? JSON.parse(raw) : {};
      for (const kv of many(a.set)) {
        const at = kv.indexOf('=');
        if (at < 1) fail('USAGE', `--set ${kv}: use <path>=<text>`);
        given[kv.slice(0, at)] = kv.slice(at + 1);
      }
      if (!Object.keys(given).length) {
        const fields = [];
        for (const t of owner.targets) fields.push(...(await fieldsOf(t, locale)));
        const text = fields
          .map((f) => `${f.path} [${f.state}]\n  ${f.source}\n  ${f.text ?? '—'}`)
          .join('\n');
        return { data: { ref: owner.ref, locale, fields }, text };
      }
      if (a.reviewed) await cx.humanOnly(ctx, 'mark translations as reviewed');
      const status = a.reviewed ? 'reviewed' : 'machine';
      const written: string[] = [];
      for (const t of owner.targets) {
        const mine = Object.entries(given).filter(
          ([k]) => k.startsWith(t.prefix) && !k.slice(t.prefix.length).includes('.'),
        );
        if (!mine.length) continue;
        const names = TF[t.kind] as readonly string[];
        for (const [k] of mine)
          if (!names.includes(k.slice(t.prefix.length)))
            fail('USAGE', `${k} is not a translatable field of ${owner.ref}`);
        const hash = await iwb.translationSourceHash(t.source, TF[t.kind]);
        const old = tableOf(t, locale) ?? {};
        const outdated =
          old.source_hash && old.source_hash !== hash
            ? names.filter((f) => typeof old[f] === 'string' && !mine.some(([k]) => k === `${t.prefix}${f}`))
            : [];
        if (outdated.length)
          fail(
            'USAGE',
            `Also translate ${outdated.map((f) => `${t.prefix}${f}`).join(', ')}: the source changed`,
          );
        const fields = Object.fromEntries(mine.map(([k, v]) => [k.slice(t.prefix.length), v]));
        const i18n = {
          ...(t.source.i18n as object),
          [locale]: { ...old, ...fields, status, source_hash: hash },
        };
        Object.assign(t.source, { i18n }); // targets alias owner.data (or its steps / criteria)
        written.push(...mine.map(([k]) => k));
      }
      const unknown = Object.keys(given).filter((k) => !written.includes(k));
      if (unknown.length) fail('USAGE', `Unknown field path(s): ${unknown.join(', ')}`);
      await iwb.writeDefinition(p.fs, owner.file, owner.type, owner.data);
      const text = `Wrote ${written.length} ${locale} field(s) of ${owner.ref} (${status}) to ${owner.file}`;
      return { data: { ref: owner.ref, locale, file: owner.file, status, written }, text };
    },
  },
};
