/**
 * Test data from the web app (docs/spec/web.md#test-data): a fixture for any dropped file, and fixtures created,
 * edited and removed on the Test data screen. The file changes are pure; committing them follows the bundle's mode.
 */
import * as B from '@indx-watch/bundle';
import type { Model } from '@indx-watch/core';
import { headsOf, versionsByEntity } from '@indx-watch/sync';
import type { Context } from 'hono';
import type { Ctx } from './app.js';
import type { FixtureInput, FixtureSaved } from './contract.js';
import { bad, fail, HttpError, notFound } from './http.js';
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

/** A file that the edit adds: in git, or a pointer plus its blob when larger than `inline_max_bytes` and a store exists. */
async function addData(next: Files, dir: string, name: string, data: Uint8Array, blobs: Uint8Array[]) {
  if (!safePath(name) || name.includes('/') || name.endsWith('.blob.toml'))
    throw bad(`unsafe file name ${name}`);
  const project = tomlOf(next.get('project.toml')) ?? {};
  const max = (project.fixtures as { inline_max_bytes?: number } | undefined)?.inline_max_bytes ?? 1048576;
  next.delete(`${dir}/${name}`);
  next.delete(`${dir}/${name}.blob.toml`);
  if (data.byteLength <= max || !project.store) return void next.set(`${dir}/${name}`, data);
  blobs.push(data);
  const pointer = { sha256: await B.sha256Hex(data), size: data.byteLength, media_type: mediaOf(name) };
  next.set(`${dir}/${name}.blob.toml`, enc.encode(B.formatToml('blob-pointer', pointer)));
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
  await addData(next, file.slice(0, -'/fixture.toml'.length), name, data, blobs);
  return file;
}

const str = (v: unknown, what: string) =>
  typeof v === 'string' && v.trim() ? v.trim() : fail(bad(`${what} must be a non-empty string`));

/** Apply a create (no `file`) or an edit of the fixture at `file` to `next`. Pure apart from hashing; tested. */
export async function applyFixture(next: Files, input: FixtureInput, file?: string) {
  const blobs: Uint8Array[] = [];
  const old = file ? (tomlOf(next.get(file)) ?? fail(notFound(file))) : undefined;
  if (!old && !B.FixtureKind.safeParse(input.kind).success) throw bad('kind: dataset, seed, file or account');
  const title = input.title === undefined ? String(old?.title ?? '') : str(input.title, 'title');
  const at = file ?? newFixture(next, { title, kind: input.kind! });
  const dir = at.slice(0, -'/fixture.toml'.length);
  const data: Record<string, unknown> = { ...(old ?? tomlOf(next.get(at))), title };
  if (input.notes !== undefined) data.notes = input.notes?.trim() || undefined;
  const files = new Set((data.files as string[] | undefined) ?? []);
  for (const name of input.remove ?? []) {
    files.delete(name);
    next.delete(`${dir}/${name}`);
    next.delete(`${dir}/${name}.blob.toml`);
  }
  for (const f of input.add ?? []) {
    await addData(next, dir, String(f.name), decode(String(f.data ?? '')), blobs);
    files.add(String(f.name));
  }
  if (input.table) {
    const { columns, rows } = input.table;
    if (!Array.isArray(columns) || !columns.length || columns.some((c) => !String(c).trim()))
      throw bad('table: every column needs a name');
    const name = [...files].find((n) => /\.(csv|json)$/i.test(n)) ?? `${B.slugify(title) || 'data'}.csv`;
    const objects = rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? ''])));
    const text = name.endsWith('.json') ? `${JSON.stringify(objects, null, 2)}\n` : toCsv(columns, rows);
    await addData(next, dir, name, enc.encode(text), blobs);
    files.add(name);
    data.row_key =
      input.table.row_key && columns.includes(input.table.row_key) ? input.table.row_key : columns[0];
  }
  if (input.json !== undefined) {
    try {
      JSON.parse(input.json);
    } catch {
      throw bad('seed: the payload is not valid JSON');
    }
    const name = [...files].find((n) => n.endsWith('.json')) ?? 'seed.json';
    await addData(next, dir, name, enc.encode(input.json), blobs);
    files.add(name);
  }
  if (input.account) data.account = input.account;
  data.files = files.size ? [...files] : undefined;
  writeFixture(next, at, data);
  return { file: at, blobs };
}

const same = (a: Uint8Array | undefined, b: Uint8Array) =>
  !!a && a.byteLength === b.byteLength && a.every((v, i) => v === b[i]);
/** The paths of `next` that are new or differ from `base`, and the paths of `base` that `next` lacks. */
export const changesOf = (base: Files, next: Files) => ({
  changed: [...next.keys()].filter((p) => !same(base.get(p), next.get(p)!)),
  removed: [...base.keys()].filter((p) => !next.has(p)),
});

/**
 * Workspace mode: one `file` record per changed path (a `deleted` version per removed one), so the store stays the
 * source of truth and every `iw sync` brings the change into working copies (docs/spec/sync.md#workspace-mode-v02).
 */
export async function writeWorkspace(c: Context, x: Ctx, m: Model, base: Files, next: Files) {
  const records = (await x.deps.records?.()) ?? [];
  if (x.deps.mode === 'hosted' && !records.some((r) => r.kind === 'file'))
    throw new HttpError(
      409,
      'conflict',
      'no workspace in this store yet: run `iw sync` in a working copy first',
    );
  const [who, at, versions] = [await x.actor(c), x.now(), versionsByEntity(records)];
  const { changed, removed } = changesOf(base, next);
  for (const path of [...changed, ...removed]) {
    const data = next.get(path);
    const id = path.endsWith('.toml') ? tomlOf(data ?? base.get(path))?.id : undefined;
    const entity = typeof id === 'string' && id ? id : undefined;
    const parents = headsOf(versions.get(entity ?? `path:${path}`) ?? []).map((v) => v.id);
    const sha256 = data && (await x.deps.putBlob(data, 'application/octet-stream'));
    const record = B.FileRecord.parse({
      ...{ kind: 'file', id: B.newId('rec'), v: 1, project: m.project.id, at, actor: who, source: 'manual' },
      ...{ path, parents, ...(entity && { entity }), ...(sha256 ? { sha256 } : { deleted: true }) },
    });
    await x.deps.writeRecord(record);
    await (data ? x.deps.writeFile?.(path, data) : x.deps.removeFile?.(path));
  }
  return { changed, removed };
}

/** Check the result and write it: `file` records in workspace mode, else like an upload (files or a snapshot). */
async function commit(c: Context, x: Ctx, m: Model, base: Files, next: Files, blobs: Uint8Array[]) {
  const { problems } = await B.checkBundle(memoryBundleFs(next));
  const errors = problems.filter((p) => p.severity === 'error');
  if (errors.length) throw bad(errors.map((p) => `${p.file ?? ''} ${p.message}`.trim()).join('; '));
  for (const b of blobs) await x.deps.putBlob(b, 'application/octet-stream');
  if (workspaceMode(m)) return writeWorkspace(c, x, m, base, next);
  if (!x.deps.publishBundle) throw new HttpError(403, 'forbidden', 'this server cannot write');
  const out = changesOf(base, next);
  await x.deps.publishBundle(next, {
    actor: await x.actor(c),
    ...out,
    message: 'test data edited in the app',
  });
  return out;
}

/** POST /api/fixtures, PATCH and DELETE /api/fixtures/:key (docs/spec/web.md#test-data). */
export async function saveFixture(c: Context, x: Ctx, how: 'create' | 'edit' | 'delete') {
  const who = await x.actor(c);
  if (who.kind === 'agent') throw new HttpError(403, 'forbidden', 'agents write drafts with iw new');
  const { role } = await x.grant(c);
  if (role !== 'lead' && role !== 'tester')
    throw new HttpError(403, 'forbidden', 'a lead or tester edits test data');
  const m = await x.model(c);
  if (!x.deps.bundleFiles) throw new HttpError(403, 'forbidden', 'this server cannot write');
  const input =
    how === 'delete'
      ? {}
      : await c.req.json<FixtureInput>().catch(() => fail(bad('request body must be JSON')));
  const base = await x.deps.bundleFiles();
  const next = new Map(base);
  const want = c.req.param('key')?.toUpperCase();
  const found = [...base].find(([p, d]) => FX_FILE.test(p) && String(tomlOf(d)?.key).toUpperCase() === want);
  const fx = how === 'create' ? undefined : { file: found?.[0] ?? fail(notFound('fixture')) };
  let saved = { file: fx?.file ?? '', blobs: [] as Uint8Array[] };
  if (how === 'delete') {
    const dir = fx!.file.slice(0, fx!.file.lastIndexOf('/') + 1);
    for (const p of base.keys()) if (p.startsWith(dir)) next.delete(p);
  } else saved = await applyFixture(next, input, fx?.file);
  const out = await commit(c, x, m, base, next, saved.blobs);
  const key = String(tomlOf(next.get(saved.file))?.key ?? want ?? '');
  return c.json({ key, file: saved.file, ...out } satisfies FixtureSaved, how === 'create' ? 201 : 200);
}
