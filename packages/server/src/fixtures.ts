/**
 * Test data from the web app (docs/spec/web.md#test-data): a fixture for any dropped file, and fixtures created,
 * edited and removed on the Test data screen. The file changes are pure; committing them follows the bundle's mode.
 */
import * as B from '@indx-watch/bundle';
import { canSee, type Model, type Principal } from '@indx-watch/core';
import { headsOf, versionsByEntity } from '@indx-watch/sync';
import type { Context } from 'hono';
import type { Ctx } from './app.js';
import type { FixtureInput, FixtureSaved } from './contract.js';
import { bad, fail, HttpError, notFound, readJson } from './http.js';
import { memoryBundleFs, safePath } from './upload.js';
import { mediaOf } from './views.js';
import { workspaceMode } from './workspace.js';

type Files = Map<string, Uint8Array>;
const [enc, dec] = [new TextEncoder(), new TextDecoder()];
const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const tomlOf = (d: Uint8Array | undefined) => {
  try {
    return d && (B.parseToml(dec.decode(d)) as Record<string, unknown>);
  } catch {
    return undefined;
  }
};
const FX_FILE = /^fixtures\/[^/]+\/fixture\.toml$/;

/** Where an edit writes a fixture's data: the bundle files, the fixture's folder and file list, blobs to upload. */
type Target = { next: Files; dir: string; files: Set<string>; blobs: Uint8Array[] };
/** Remove a data file of the fixture (in git or a pointer). */
const unlink = ({ next, dir }: Target, name: string) => {
  next.delete(`${dir}/${name}`);
  next.delete(`${dir}/${name}.blob.toml`);
};

/** A file that the edit adds: in git, or a pointer plus its blob when larger than `inline_max_bytes` and a store exists. */
async function addData(t: Target, name: string, data: Uint8Array) {
  if (!safePath(name) || name.includes('/') || name.endsWith('.blob.toml'))
    throw bad(`unsafe file name ${name}`);
  const project = tomlOf(t.next.get('project.toml')) ?? {};
  const max = (project.fixtures as { inline_max_bytes?: number } | undefined)?.inline_max_bytes ?? 1048576;
  unlink(t, name);
  t.files.add(name);
  if (data.byteLength <= max || !project.store) return void t.next.set(`${t.dir}/${name}`, data);
  t.blobs.push(data);
  const pointer = { sha256: await B.sha256Hex(data), size: data.byteLength, media_type: mediaOf(name) };
  t.next.set(`${t.dir}/${name}.blob.toml`, enc.encode(B.formatToml('blob-pointer', pointer)));
}

const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
/** CSV text of a table (header row first). Pure; tested. */
export const toCsv = (columns: string[], rows: string[][]) =>
  `${[columns, ...rows].map((r) => columns.map((_, i) => csvCell(r[i] ?? '')).join(',')).join('\n')}\n`;
const firstLine = (text: string) => text.split(/\r?\n/, 1)[0] ?? '';

/** The fixture fields a dropped data file gets: a dataset for a CSV or a JSON array of objects, else a file. */
function guessKind(name: string, data: Uint8Array): Pick<B.Fixture, 'kind' | 'row_key'> {
  const text = data.byteLength < 5_000_000 ? dec.decode(data) : '';
  if (/\.csv$/i.test(name)) {
    const head = firstLine(text).split(',')[0]?.replace(/^"|"$/g, '').trim();
    if (head) return { kind: 'dataset', row_key: head };
  }
  if (/\.json$/i.test(name)) {
    try {
      const rows = JSON.parse(text) as unknown;
      const key = Array.isArray(rows) && rows[0] && typeof rows[0] === 'object' && Object.keys(rows[0])[0];
      if (key) return { kind: 'dataset', row_key: key };
    } catch {
      // not JSON: an ordinary file
    }
  }
  return { kind: 'file' };
}

const keysIn = (next: Files) =>
  [...next].flatMap(([p, d]) => (FX_FILE.test(p) ? [String(tomlOf(d)?.key ?? '')] : []));
const writeFixture = (next: Files, file: string, data: Record<string, unknown>) => {
  const parsed = B.Fixture.safeParse(data);
  if (!parsed.success)
    throw bad(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  next.set(file, enc.encode(B.formatToml('fixture', parsed.data as Record<string, unknown>)));
};

/** A new draft fixture in `next` (key FX-n, folder from the title); returns its fixture.toml path. */
function newFixture(next: Files, fields: Record<string, unknown> & { title: string }) {
  const key = B.nextKey('fixture', keysIn(next));
  const file = `fixtures/${key}-${B.slugify(fields.title) || 'data'}/fixture.toml`;
  writeFixture(next, file, { id: B.newId('fx'), key, status: 'draft', ...fields });
  return file;
}

/** A dropped file that is not part of the bundle becomes a new fixture of its own (docs/spec/web.md#upload). */
export async function fixtureForFile(next: Files, name: string, data: Uint8Array, blobs: Uint8Array[]) {
  const title = name.replace(/\.[^.]+$/, '') || name;
  const file = newFixture(next, { title, ...guessKind(name, data), files: [name] });
  await addData({ next, dir: file.slice(0, -'/fixture.toml'.length), files: new Set(), blobs }, name, data);
  return file;
}

const str = (v: unknown, what: string) =>
  typeof v === 'string' && v.trim() ? v.trim() : fail(bad(`${what} must be a non-empty string`));

/** Write the table edited in the app to the fixture's CSV or JSON file; returns the row key. */
async function writeTable(t: Target, table: NonNullable<FixtureInput['table']>, title: string) {
  const { columns, rows, row_key } = table;
  if (!Array.isArray(columns) || !columns.length || columns.some((c) => !String(c).trim()))
    throw bad('table: every column needs a name');
  if (!Array.isArray(rows) || rows.some((r) => !Array.isArray(r))) throw bad('table: rows must be lists');
  const name = [...t.files].find((n) => /\.(csv|json)$/i.test(n)) ?? `${B.slugify(title) || 'data'}.csv`;
  const objects = rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? ''])));
  const text = name.endsWith('.json') ? `${JSON.stringify(objects, null, 2)}\n` : toCsv(columns, rows);
  await addData(t, name, enc.encode(text));
  return row_key && columns.includes(row_key) ? row_key : columns[0];
}

/** Write a seed payload to the fixture's JSON file. */
async function writeSeed(t: Target, json: string) {
  try {
    JSON.parse(json);
  } catch {
    throw bad('seed: the payload is not valid JSON');
  }
  await addData(t, [...t.files].find((n) => n.endsWith('.json')) ?? 'seed.json', enc.encode(json));
}

/** The fixture.toml path and fields of the fixture at `file`, or of a new draft fixture (create). */
function fixtureOf(next: Files, input: FixtureInput, file?: string) {
  const old = file ? (tomlOf(next.get(file)) ?? fail(notFound(file))) : undefined;
  if (!old && !B.FixtureKind.safeParse(input.kind).success) throw bad('kind: dataset, seed, file or account');
  const title = input.title === undefined ? String(old?.title ?? '') : str(input.title, 'title');
  const at = file ?? newFixture(next, { title, kind: input.kind! });
  const data: Record<string, unknown> = { ...(old ?? tomlOf(next.get(at))), title };
  return { at, data, title };
}

/** Apply the data file changes of `input`: files removed and added, the table and the seed payload. */
async function applyData(t: Target, input: FixtureInput, data: Record<string, unknown>, title: string) {
  for (const name of input.remove ?? []) {
    t.files.delete(name);
    unlink(t, name);
  }
  for (const f of input.add ?? []) await addData(t, String(f.name), decode(String(f.data ?? '')));
  if (input.table) data.row_key = await writeTable(t, input.table, title);
  if (input.json !== undefined) await writeSeed(t, input.json);
}

/** Apply a create (no `file`) or an edit of the fixture at `file` to `next`. Pure apart from hashing; tested. */
export async function applyFixture(next: Files, input: FixtureInput, file?: string) {
  const { at, data, title } = fixtureOf(next, input, file);
  if (input.notes !== undefined) data.notes = input.notes?.trim() || undefined;
  const files = new Set((data.files as string[] | undefined) ?? []);
  const t: Target = { next, dir: at.slice(0, -'/fixture.toml'.length), files, blobs: [] };
  await applyData(t, input, data, title);
  if (input.account) data.account = input.account;
  if (input.shared_with !== undefined)
    data.shared_with = input.shared_with && [...new Set(input.shared_with.map((e) => String(e).trim()))];
  data.files = files.size ? [...files] : undefined;
  writeFixture(next, at, data);
  return { file: at, blobs: t.blobs };
}

const same = (a: Uint8Array | undefined, b: Uint8Array) =>
  !!a && a.byteLength === b.byteLength && a.every((v, i) => v === b[i]);
/** The paths of `next` that are new or differ from `base`, and the paths of `base` that `next` lacks. */
export const changesOf = (base: Files, next: Files) => ({
  changed: [...next.keys()].filter((p) => !same(base.get(p), next.get(p)!)),
  removed: [...base.keys()].filter((p) => !next.has(p)),
});

/** A change to the bundle files that model `m` was loaded from: the files before and after. */
export type BundleEdit = { m: Model; base: Files; next: Files };
/** Who writes the `file` records of an edit, when, and the versions they build on. */
type Stamp = { actor: B.Actor; at: string; versions: ReturnType<typeof versionsByEntity> };

/** One `file` record for a changed or removed path, then the same change in the working tree (Node). */
async function writeFileRecord(x: Ctx, { m, base, next }: BundleEdit, s: Stamp, path: string) {
  const data = next.get(path);
  const id = path.endsWith('.toml') ? tomlOf(data ?? base.get(path))?.id : undefined;
  const entity = typeof id === 'string' && id ? id : undefined;
  const parents = headsOf(s.versions.get(entity ?? `path:${path}`) ?? []).map((v) => v.id);
  const sha256 = data && (await x.deps.putBlob(data, 'application/octet-stream'));
  const record = B.FileRecord.parse({
    ...{
      kind: 'file',
      id: B.newId('rec'),
      v: 1,
      project: m.project.id,
      at: s.at,
      actor: s.actor,
      source: 'manual',
    },
    ...{ path, parents, ...(entity && { entity }), ...(sha256 ? { sha256 } : { deleted: true }) },
  });
  await x.deps.writeRecord(record);
  await (data ? x.deps.writeFile?.(path, data) : x.deps.removeFile?.(path));
}

/**
 * Workspace mode: one `file` record per changed path (a `deleted` version per removed one), so the store stays the
 * source of truth and every `iw sync` brings the change into working copies (docs/spec/sync.md#workspace-mode-v02).
 */
export async function writeWorkspace(c: Context, x: Ctx, edit: BundleEdit) {
  const records = (await x.deps.records?.()) ?? [];
  if (x.deps.mode === 'hosted' && !records.some((r) => r.kind === 'file'))
    throw new HttpError(
      409,
      'conflict',
      'no workspace in this store yet: run `iw sync` in a working copy first',
    );
  const stamp = { actor: await x.actor(c), at: x.now(), versions: versionsByEntity(records) };
  const { changed, removed } = changesOf(edit.base, edit.next);
  for (const path of [...changed, ...removed]) await writeFileRecord(x, edit, stamp, path);
  return { changed, removed };
}

/** Check the result and write it: `file` records in workspace mode, else like an upload (files or a snapshot). */
async function commit(c: Context, x: Ctx, edit: BundleEdit, blobs: Uint8Array[]) {
  const { problems } = await B.checkBundle(memoryBundleFs(edit.next));
  const errors = problems.filter((p) => p.severity === 'error');
  if (errors.length) throw bad(errors.map((p) => `${p.file ?? ''} ${p.message}`.trim()).join('; '));
  for (const b of blobs) await x.deps.putBlob(b, 'application/octet-stream');
  if (workspaceMode(edit.m)) return writeWorkspace(c, x, edit);
  if (!x.deps.publishBundle) throw new HttpError(403, 'forbidden', 'this server cannot write');
  const out = changesOf(edit.base, edit.next);
  await x.deps.publishBundle(edit.next, {
    actor: await x.actor(c),
    ...out,
    message: 'test data edited in the app',
  });
  return out;
}

/**
 * A non-lead may not change test data that is not shared with them, nor share it so that they would lose access
 * (docs/spec/security.md#sharing); used by bundle uploads, which reach the same files as the fixture routes.
 */
export function guardSharing(base: Files, next: Files, who: Principal, role: B.Role | undefined) {
  if (role === 'lead') return;
  const { changed, removed } = changesOf(base, next);
  const dirs = new Set(
    [...changed, ...removed].filter((p) => p.startsWith('fixtures/')).map((p) => p.split('/', 2).join('/')),
  );
  for (const dir of dirs) {
    const sharing = (f: Files) => tomlOf(f.get(`${dir}/fixture.toml`))?.shared_with as string[] | undefined;
    const [before, after] = [base.has(`${dir}/fixture.toml`), next.has(`${dir}/fixture.toml`)];
    if (before && !canSee(sharing(base), who, role)) throw notFound(`fixture ${dir}`);
    if (after && !canSee(sharing(next), who, role))
      throw bad(`${dir}: you would lose access: share it with yourself too`);
  }
}

/** The fixture.toml path of fixture `key` (upper case), else 404, also when it is not `visible` to this identity. */
function fixtureFile(files: Files, key: string | undefined, visible: (file: string) => boolean) {
  const found = [...files].find(([p, d]) => FX_FILE.test(p) && String(tomlOf(d)?.key).toUpperCase() === key);
  return found && visible(found[0]) ? found[0] : fail(notFound('fixture'));
}

/** Remove the folder of the fixture at `file` from `next`. */
function removeFixture(next: Files, file: string) {
  const dir = file.slice(0, file.lastIndexOf('/') + 1);
  for (const p of [...next.keys()]) if (p.startsWith(dir)) next.delete(p);
  return { file, blobs: [] as Uint8Array[] };
}

/** POST /api/fixtures, PATCH and DELETE /api/fixtures/:key (docs/spec/web.md#test-data). */
export async function saveFixture(c: Context, x: Ctx, how: 'create' | 'edit' | 'delete') {
  const who = await x.actor(c);
  if (who.kind === 'agent') throw new HttpError(403, 'forbidden', 'agents write drafts with iw new');
  const { role, who: principal } = await x.grant(c);
  if (role !== 'lead' && role !== 'tester')
    throw new HttpError(403, 'forbidden', 'a lead or tester edits test data');
  const m = await x.model(c);
  if (!x.deps.bundleFiles) throw new HttpError(403, 'forbidden', 'this server cannot write');
  const input = how === 'delete' ? {} : await readJson<FixtureInput>(c);
  const base = await x.deps.bundleFiles();
  const next = new Map(base);
  const want = c.req.param('key')?.toUpperCase();
  // a fixture not shared with this identity cannot be changed, nor shared so that it would lose access
  const mine = (p: string) =>
    canSee(tomlOf(next.get(p))?.shared_with as string[] | undefined, principal, role);
  const file = how === 'create' ? undefined : fixtureFile(base, want, mine);
  const saved = how === 'delete' ? removeFixture(next, file!) : await applyFixture(next, input, file);
  if (how !== 'delete' && !mine(saved.file)) throw bad('you would lose access: share it with yourself too');
  const out = await commit(c, x, { m, base, next }, saved.blobs);
  const key = String(tomlOf(next.get(saved.file))?.key ?? want ?? '');
  return c.json({ key, file: saved.file, ...out } satisfies FixtureSaved, how === 'create' ? 201 : 200);
}
