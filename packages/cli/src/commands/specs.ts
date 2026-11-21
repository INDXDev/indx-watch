/** Commands that write definitions: init, check, fmt, new, approve, migrate, reindex. */
import { existsSync } from 'node:fs';
import { cp, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import * as iwb from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { indexedRecords, openNodeIndex, openReplica } from '@indx-watch/store/node';
import { fileStateStore } from '@indx-watch/sync/node';
import { problemLine, type Spec } from '../cli.js';
import * as cx from '../context.js';
import { type Args, asset, B, type Ctx, csv, fail, git, iso, many, P, S, str } from '../util.js';

/** Keys used by records (test cases and fixtures), so retired keys are never reused. */
const used = (r: iwb.AnyRecord) =>
  r.kind === 'run' ? [r.test_case, ...(r.fixtures ?? [])] : r.kind === 'waiver' ? [r.test_case] : [];
export const knownKeys = (records: iwb.AnyRecord[]) => records.flatMap(used).map((x) => x.key);
/** Where `iw fixture fetch` puts a pointer blob. */
export const cacheBlob = (p: cx.Project, sha: string) => join(p.dir, 'cache', 'blobs', sha);

const KINDS: Record<string, iwb.NewKind> = {
  ...{ feature: 'feature', uc: 'use-case', ac: 'criterion', tc: 'test-case', fixture: 'fixture' },
  ...{ env: 'environment', release: 'release', plan: 'plan' },
};
const parseStep = (s: string) =>
  s.includes('=>')
    ? { instruction: s.split('=>')[0]!.trim(), expected: s.slice(s.indexOf('=>') + 2).trim() }
    : fail('USAGE', `--step "${s}" must look like "<instruction> => <expected>"`);

/** `iw init --example`: the shop bundle and its sample store, with the store's blobs in the replica. */
async function copyExample(fs: iwb.BundleFs, dir: string, target: string) {
  // test paths relative to the source: the package itself may live under a folder named cache/
  const from = asset('example-bundle', 'examples/shop/.indx-watch');
  const filter = (src: string) => !/(^|[/\\])(runs|cache)([/\\]|$)/.test(relative(from, src));
  await cp(from, dir, { recursive: true, filter });
  await fs.write('.gitignore', 'cache/\nruns/\n'); // npm drops .gitignore from packages
  // the sample store ([store] url = "file://../store") with its results; its blobs go into the replica
  const store = join(target, 'store');
  await cp(asset('example-store', 'examples/shop/store'), store, { recursive: true, force: false });
  const replica = openReplica(dir);
  for (const f of await readdir(join(store, 'v1/blobs'), { recursive: true, withFileTypes: true }))
    if (f.isFile()) await replica.putBlob(new Uint8Array(await readFile(join(f.parentPath, f.name))));
  const files = await iwb.walk(fs, '');
  if (!files.includes('project.toml')) fail('INTERNAL', `Nothing was copied to ${dir}; reinstall`);
  return { data: { dir, files }, text: `Copied the shop example to ${dir} and its store to ${store}` };
}

/** Fields of `iw new`: --from input merged with the flags. */
async function newFields(ctx: Ctx, a: Args, kind: iwb.NewKind) {
  const fields: Record<string, unknown> = { ...(await cx.fromInput(ctx, a)) };
  const set = (k: string, v: unknown) => {
    if (v !== undefined && !(Array.isArray(v) && !v.length)) fields[k] = v;
  };
  for (const k of ['title', 'actor', 'goal', 'priority', 'mode']) set(k, str(a[k]));
  set('covers', csv(a.covers));
  set('steps', many(a.step).map(parseStep));
  if (kind === 'fixture') set('kind', str(a.kind));
  if (kind === 'use-case') set('criteria', [...((fields.criteria as unknown[]) ?? []), ...many(a.ac)]);
  if (kind === 'use-case' && !fields.criteria) fail('USAGE', 'A use case needs at least one --ac');
  if (kind === 'criterion') {
    set('text', str(a.text) ?? fields.title);
    delete fields.title;
  }
  if (!fields.title && !fields.text && !fields.version && !fields.name) fail('USAGE', '--title is required');
  return fields;
}

/** Origin and AI model of `iw new`; agents always write AI-marked items. */
export async function originOf(ctx: Ctx, a: Args) {
  let origin = str(a.origin) as 'human' | 'ai' | 'import' | undefined;
  if (origin && !['human', 'ai', 'import'].includes(origin))
    fail('USAGE', '--origin must be human, ai or import');
  // agents always write AI-marked items, drafts where the kind has a status (docs/spec/agents.md#rules)
  if ((await cx.actorOf(ctx)).kind === 'agent') {
    if (a.ready) fail('USAGE', 'Agents cannot create ready items');
    if (origin && origin !== 'ai') fail('USAGE', `Agents write AI drafts, not --origin ${origin}`);
    origin = 'ai';
  }
  const model = str(a.model) ?? (origin === 'ai' ? ctx.env.IW_AGENT_MODEL : undefined);
  if (origin === 'ai' && !model)
    fail('USAGE', 'AI drafts need the model ID: pass --model or set IW_AGENT_MODEL');
  return { origin, model };
}

export const specCommands: Record<string, Spec> = {
  init: {
    description: 'Create .indx-watch/ with a project, an environment, a release and a feature',
    args: {
      target: P('Directory (default: current)', false),
      ...{ key: S('cx.Project key (default: from the directory name)'), name: S('cx.Project name') },
      ...{ locale: S('Source locale: en or ja'), example: B('Copy the examples/shop bundle') },
    },
    async run(ctx, a) {
      const target = resolve(ctx.cwd, str(a.target) ?? '.');
      const dir = join(target, '.indx-watch');
      if (existsSync(join(dir, 'project.toml'))) fail('CONFLICT', `${dir} already has a project.toml`);
      const fs = nodeFs(dir);
      if (a.example) return copyExample(fs, dir, target);
      // letters and digits, without leading digits, at most 10
      const guess = /^\d*(.{0,10})/.exec(
        basename(target)
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, ''),
      )![1]!;
      const key = str(a.key) ?? (guess.length >= 2 ? guess : 'APP');
      if (!iwb.KEY_PATTERNS.project.test(key)) fail('USAGE', `Invalid project key ${key} (2–10 of A-Z, 0-9)`);
      const locale =
        iwb.Locale.safeParse(str(a.locale) ?? 'en').data ?? fail('USAGE', '--locale must be en or ja');
      const project = {
        schema_version: iwb.SCHEMA_VERSION,
        id: iwb.newId('prj'),
        key,
        name: str(a.name) ?? basename(target),
      };
      const defaults = { default_environment: 'local', current_release: 'v0.1.0' };
      await fs.write(
        'project.toml',
        iwb.formatToml('project', { ...project, source_locale: locale, locales: [locale], ...defaults }),
      );
      await fs.write('.gitignore', 'cache/\nruns/\n');
      const { bundle } = await iwb.loadBundle(fs);
      const files = ['project.toml', '.gitignore'];
      for (const [kind, fields] of [
        ['environment', { name: 'local', title: 'Local', base_url: 'http://localhost:3000' }],
        ['release', { version: 'v0.1.0' }],
        ['feature', { title: 'General' }],
      ] as const)
        files.push((await iwb.createDefinition(fs, bundle!, { kind, fields })).file);
      const bin = /(^|[/\\])iw(\.js)?$/.test(process.argv[1] ?? '') ? 'iw' : 'npx indx-watch';
      const text = `Created ${dir} (${key}). Next: ${bin} new uc --title "…" --ac "…"`;
      return { data: { dir, files }, text };
    },
  },

  check: {
    description: 'Validate the whole bundle (schemas, format, references, secrets)',
    args: {
      fix: B('Canonicalize, fix key parts of names, renumber duplicate keys'),
      strict: B('Warnings are errors'),
    },
    async run(ctx, a) {
      const p = await cx.openProject(ctx, a);
      const branch = p.bundle.project.data.default_branch ?? 'main';
      const sub = relative(p.root, p.dir) || '.';
      const deps: iwb.CheckDeps = {
        fix: !!a.fix,
        knownKeys: knownKeys(await p.replica.records()),
        hasBlob: async (sha) => (await p.replica.hasBlob(sha)) || existsSync(cacheBlob(p, sha)),
        onDefaultBranch: async (id) => !!git(p.root, 'grep', '-l', '-F', id, branch, '--', sub),
        repo: {
          read: (path) => readFile(join(p.root, path), 'utf8').catch(() => null),
          write: (path, text) => writeFile(join(p.root, path), text),
        },
      };
      const r = await iwb.checkBundle(p.fs, deps);
      // records the store has two bodies of, as of the last sync (docs/spec/sync.md#merge-rules)
      const url = ctx.env.IW_STORE ?? p.bundle.project.data.store?.url;
      const conflicts = url ? ((await (await fileStateStore(p.dir, url)).load()).conflicts ?? {}) : {};
      for (const message of Object.values(conflicts))
        r.problems.push({ severity: 'warning', code: 'record-conflict', file: 'runs/', message });
      r.warnings += Object.keys(conflicts).length;
      const summary = `${r.files} files, ${r.errors} errors, ${r.warnings} warnings`;
      const text = [
        ...r.problems.map(problemLine),
        ...r.renumbered.map((x) => `renumbered ${x.from} → ${x.to} (${x.id})`),
        ...r.changed.map((f) => `rewrote ${f}`),
        summary,
      ].join('\n');
      if (r.errors || (a.strict && r.warnings)) fail('CHECK_FAILED', summary, r.problems, r, text);
      return { data: r, text };
    },
  },

  fmt: {
    description: 'Rewrite files in canonical form',
    args: { paths: P('Files or folders (default: all)', false) },
    async run(ctx, a) {
      const p = await cx.openProject(ctx, a);
      const only = many(a._).map((x) => relative(p.dir, resolve(ctx.cwd, x)).replaceAll('\\', '/'));
      const changed: string[] = [];
      for (const f of (await iwb.loadDetailed(p.fs)).files) {
        if (!f.valid || !f.raw || f.type === 'data') continue;
        if (only.length && !only.some((o) => !o || f.path === o || f.path.startsWith(`${o}/`))) continue;
        const kind = (f.path.split('/')[1] ?? '').split('.')[0] as iwb.FileType;
        const text = f.type === 'template' ? iwb.formatTomlBody(kind, f.raw) : iwb.formatToml(f.type, f.raw);
        if (text !== f.text) await p.fs.write(f.path, text).then(() => changed.push(f.path));
      }
      return { data: { changed }, text: changed.join('\n') || 'Nothing to change' };
    },
  },

  new: {
    description: 'Create a definition: feature, uc, ac, tc, fixture, env, release, plan',
    repeat: ['ac', 'step'],
    args: {
      entity: P('feature | uc | ac | tc | fixture | env | release | plan'),
      title: S('Title (required)'),
      ...{ feature: S('Parent feature of a uc'), actor: S('Use case actor'), goal: S('Use case goal') },
      ac: S('Acceptance criterion of a new uc (repeatable)'),
      step: S('"<instruction> => <expected>" (repeatable)'),
      ...{ uc: S('Parent use case of an ac or tc'), text: S('Criterion text') },
      covers: S('AC keys, comma-separated (default: all ACs of --uc)'),
      ...{ mode: S('manual | playwright | agent | hybrid'), priority: S('P0-P3') },
      ...{
        kind: S('Fixture kind: dataset | seed | file | account'),
        template: S('Template from templates/'),
      },
      from: S('Merge fields from a JSON/TOML file, or - for stdin'),
      ready: B('Create as ready (humans only)'),
      ...{
        origin: S('human | ai | import'),
        model: S('Model ID (with --origin ai)'),
        skill: S('Skill name'),
      },
    },
    async run(ctx, a) {
      const kind = KINDS[str(a.entity) ?? ''] ?? fail('USAGE', `Unknown kind ${a.entity}; see iw new --help`);
      const p = await cx.openProject(ctx, a);
      const fields = await newFields(ctx, a, kind);
      const { origin, model } = await originOf(ctx, a);
      const r = await iwb.createDefinition(p.fs, p.bundle, {
        ...{
          kind,
          fields,
          parent: kind === 'use-case' ? str(a.feature) : str(a.uc),
          template: str(a.template),
        },
        ...{ origin, ai: model ? { model, ...(str(a.skill) ? { skill: str(a.skill) } : {}) } : undefined },
        ...{ ready: !!a.ready, knownKeys: knownKeys(await p.replica.records()) },
      });
      return { data: r, text: `Created ${r.key} (${r.id}) in ${r.file}` };
    },
  },

  approve: {
    description: 'Approve a draft or an AI-written item (humans only)',
    args: { ref: P('UC-n, AC-n.m, TC-n, FX-n, FEAT-n, PLAN-n, environment name or release version') },
    async run(ctx, a) {
      const actor = await cx.humanOnly(ctx, 'approve');
      const p = await cx.openProject(ctx, a);
      const ref = str(a.ref)!;
      const pr = iwb.parseRef(ref);
      const r = await iwb.approveDefinition(p.fs, p.bundle, pr?.type === 'key' ? pr.key : ref, actor.id);
      const data = { ref, file: r.file, version: r.version, approved_by: actor.id };
      return { data, text: `Approved ${ref} at ${r.version} as ${actor.id}` };
    },
  },

  migrate: {
    description: 'Upgrade the bundle to the current schema_version',
    async run(ctx, a) {
      const from = (await cx.openProject(ctx, a)).bundle.project.data.schema_version;
      return {
        data: { from, to: iwb.SCHEMA_VERSION, changed: [] },
        text: `schema_version ${from} is current`,
      };
    },
  },

  reindex: {
    description: 'Rebuild the local index from the bundle and the local replica',
    async run(ctx, a) {
      const t0 = Date.now();
      const p = await cx.openProject(ctx, a);
      const index = await openNodeIndex(p.dir);
      await index.reset();
      const records = await indexedRecords(index, join(p.dir, 'runs'))(); // also what `iw serve` reads next
      const files = new Map<string, string>();
      for (const path of (await iwb.walk(p.fs, '')).filter((f) => f.endsWith('.toml')))
        files.set(path, new TextDecoder().decode((await p.fs.read(path))!));
      await index.setDefinitions(files, { source: 'bundle', at: iso() });
      const data = { records: records.length, definitions: files.size, ms: Date.now() - t0 };
      return { data, text: `Indexed ${data.records} records and ${data.definitions} definition files` };
    },
  },
};
