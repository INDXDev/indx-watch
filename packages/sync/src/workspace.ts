/**
 * Workspace mode (docs/spec/sync.md#workspace-mode-v02): definition files as `file` record versions, the field-level
 * three-way merge of concurrent heads, and applying the result to a working tree.
 */
import {
  type Actor,
  type AnyRecord,
  type BundleFs,
  CONFLICT_FILE,
  canonicalBody,
  FILE_TYPES,
  FileRecord,
  type FileType,
  fileTypeOf,
  formatToml,
  newId,
  parseToml,
  sha256Hex,
} from '@indx-watch/bundle';
import type { LocalReplica } from '@indx-watch/store';
import { isoSeconds } from './phases.js';
import { definitionFiles } from './snapshot.js';

type Read = (sha256: string) => Promise<Uint8Array | null>;
/** One side of a merge: a path and its bytes (null: deleted). */
type Side = { path: string; data: Uint8Array | null; sha: string | null };
/** The current content of one entity. */
export interface Resolved extends Side {
  heads: string[];
  conflicts: { path: string; data: Uint8Array }[];
}
/** What the last apply wrote, per entity (sync state `workspace`). */
export type WorkspaceBase = Record<
  string,
  { heads: string[]; sha256: string | null; path: string; conflicts?: string[] }
>;
export interface WorkspaceResult {
  published: string[];
  written: string[];
  removed: string[];
  conflicts: string[];
  /** an agent's changes that are not AI drafts, kept local */
  held: string[];
}

const [enc, dec] = [new TextEncoder(), new TextDecoder()];
const entityOf = (r: { entity?: string; path: string }) => r.entity ?? `path:${r.path}`;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const tomlOf = (s: Side | undefined) => {
  try {
    return s?.data && s.path.endsWith('.toml') ? parseToml(dec.decode(s.data)) : undefined;
  } catch {
    return undefined;
  }
};

/** Live (not retracted) file records by entity. */
export function versionsByEntity(records: AnyRecord[]): Map<string, FileRecord[]> {
  const retracted = new Set(records.flatMap((r) => (r.kind === 'retraction' ? [r.target] : [])));
  const out = new Map<string, FileRecord[]>();
  for (const r of records)
    if (r.kind === 'file' && !retracted.has(r.id)) out.set(entityOf(r), [...(out.get(entityOf(r)) ?? []), r]);
  return out;
}

/** Versions no other version names as a parent, by record ID. */
export function headsOf(versions: FileRecord[]): FileRecord[] {
  const parents = new Set(versions.flatMap((v) => v.parents));
  return versions.filter((v) => !parents.has(v.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** The common ancestor (inclusive) with the greatest record ID, if any. */
function commonAncestor(of: FileRecord[], byId: Map<string, FileRecord>): FileRecord | undefined {
  const ancestors = (v: FileRecord) => {
    const [seen, todo] = [new Set<string>(), [v.id]];
    while (todo.length) {
      const r = byId.get(todo.pop()!);
      if (!r || seen.has(r.id)) continue;
      seen.add(r.id);
      todo.push(...r.parents);
    }
    return seen;
  };
  const [first, ...rest] = of.map(ancestors);
  const common = [...first!].filter((id) => rest.every((s) => s.has(id))).sort();
  return byId.get(common.at(-1) ?? '');
}

/** Field-level merge of parsed TOML: tables recurse, any other value is one field. */
function mergeValue(o: unknown, a: unknown, b: unknown, c: { conflict: boolean }): unknown {
  if (eq(a, b) || eq(o, b)) return a;
  if (eq(o, a)) return b;
  if (!isObj(a) || !isObj(b)) {
    c.conflict = true;
    return a;
  }
  const base = isObj(o) ? o : {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return Object.fromEntries([...keys].map((k) => [k, mergeValue(base[k], a[k], b[k], c)]));
}

/** Field-level merge of two changed sides into `path`; a side that is not TOML conflicts (keeping `a`). */
async function mergeFields(base: Side | undefined, a: Side, b: Side, path: string) {
  const [o, x, y] = [tomlOf(base) ?? {}, tomlOf(a), tomlOf(b)];
  if (!x || !y) return { side: { ...a, path }, conflict: true };
  const c = { conflict: false };
  const merged = mergeValue(o, x, y, c) as Record<string, unknown>;
  const type = fileTypeOf(path);
  const text = type && type in FILE_TYPES ? formatToml(type as FileType, merged) : canonicalBody(merged);
  return { side: { path, data: enc.encode(text), sha: await sha256Hex(text) }, conflict: c.conflict };
}

/** Three-way merge of two sides against their base; `conflict` when a field (or a non-TOML file) differs on both. */
async function merge3(base: Side | undefined, a: Side, b: Side) {
  const path = a.path === b.path || base?.path !== a.path ? a.path : b.path;
  const s0 = base?.sha ?? null;
  const pick = (s: Side) => ({ side: { ...s, path }, conflict: false });
  const moved = a.path !== b.path && base?.path !== a.path && base?.path !== b.path;
  if (a.sha === b.sha || s0 === b.sha || !b.data) return { ...pick(a), conflict: moved && !!b.data };
  if (s0 === a.sha || !a.data) return { ...pick(b), conflict: moved && !!a.data };
  const m = await mergeFields(base, a, b, path);
  return { side: m.side, conflict: m.conflict || moved };
}

/** `<stem>.conflict-<sha8>.<ext>` next to the file. */
const conflictPath = (path: string, sha: string) =>
  path.replace(/(\.[^./]+)?$/, (ext) => `.conflict-${sha.slice(0, 8)}${ext}`);

/** The current content of an entity: its head, or its heads folded by ID with three-way merges. */
export async function resolveEntity(versions: FileRecord[], read: Read): Promise<Resolved> {
  const byId = new Map(versions.map((v) => [v.id, v]));
  const side = async (v: FileRecord | undefined): Promise<Side | undefined> => {
    if (!v) return undefined;
    const data = v.sha256 && !v.deleted ? await read(v.sha256) : null;
    if (v.sha256 && !v.deleted && !data) throw new Error(`blob ${v.sha256} of ${v.path} is missing`);
    return { path: v.path, data, sha: data ? v.sha256! : null };
  };
  const heads = headsOf(versions);
  let acc = (await side(heads[0]))!;
  const conflicts: Resolved['conflicts'] = [];
  for (let i = 1; i < heads.length; i++) {
    const b = (await side(heads[i]))!;
    const m = await merge3(await side(commonAncestor(heads.slice(0, i + 1), byId)), acc, b);
    acc = m.side;
    if (m.conflict) conflicts.push({ path: conflictPath(acc.path, b.sha!), data: b.data! });
  }
  return { ...acc, heads: heads.map((h) => h.id), conflicts };
}

/** Current definition files (with conflict files) of the file records: the hosted view in workspace mode. */
export async function workspaceFiles(records: AnyRecord[], read: Read) {
  const files = new Map<string, Uint8Array>();
  const warnings: string[] = [];
  for (const versions of versionsByEntity(records).values()) {
    const r = await resolveEntity(versions, read).catch((e: Error) => void warnings.push(e.message));
    if (r?.data) files.set(r.path, r.data);
    for (const c of r?.conflicts ?? []) files.set(c.path, c.data);
  }
  return { files, warnings };
}

/** The working tree's definition files by entity (the `id` inside a TOML file, else the path); unparsable TOML is `broken`. */
async function localFiles(fs: BundleFs) {
  const [out, broken] = [new Map<string, Side>(), new Set<string>()];
  for (const [path, data] of await definitionFiles(fs)) {
    if (CONFLICT_FILE.test(path)) continue;
    const toml = tomlOf({ path, data, sha: null });
    if (path.endsWith('.toml') && !toml && broken.add(path)) continue;
    const id = toml?.id;
    const entity = typeof id === 'string' && id ? id : `path:${path}`;
    if (!out.has(entity)) out.set(entity, { path, data, sha: await sha256Hex(data) });
  }
  return { local: out, broken };
}

export interface ApplyOptions {
  fs: BundleFs;
  replica: LocalReplica;
  read: Read;
  base: WorkspaceBase;
  actor: Actor;
  project: string;
  sign?: <R extends AnyRecord>(record: R) => Promise<R>;
  now?: () => number;
}

/** A new version of entity `e` at `path` after `parents`: the working-tree file `l`, or a delete without it. */
async function publish(o: ApplyOptions, v: { e: string; path: string; l?: Side; parents: string[] }) {
  const { e, path, l, parents } = v;
  const [at, entity] = [isoSeconds(o.now?.() ?? Date.now()), e.startsWith('path:') ? undefined : e];
  const env = { kind: 'file', id: newId('rec'), v: 1, project: o.project, at, actor: o.actor, source: 'cli' };
  const rec = FileRecord.parse({
    ...env,
    path,
    entity,
    sha256: l?.sha,
    deleted: l ? undefined : true,
    parents,
  });
  if (l?.data) await o.replica.putBlob(l.data);
  const signed = o.sign ? await o.sign(rec) : rec;
  await o.replica.putRecord(signed);
  return signed;
}

type BaseEntry = WorkspaceBase[string];
/** One apply: its options, result and the sync state being rewritten. */
type Run = { o: ApplyOptions; res: WorkspaceResult; base: WorkspaceBase; broken: Set<string> };

/** Write the current content of an entity (and its conflict files) over the working-tree file `l`. */
async function writeCurrent({ o, res }: Run, r: Resolved, l?: Side, old: string[] = []) {
  const remove = (path: string) => o.fs.remove(path).then(() => void res.removed.push(path));
  if (!r.data && l) await remove(l.path);
  if (r.data && (!l || l.sha !== r.sha || l.path !== r.path)) {
    await o.fs.write(r.path, r.data);
    res.written.push(r.path);
    if (l && l.path !== r.path) await remove(l.path);
  }
  for (const c of r.conflicts) if ((await o.fs.read(c.path)) === null) await o.fs.write(c.path, c.data);
  const now = r.conflicts.map((c) => c.path);
  for (const p of old) if (!now.includes(p) && (await o.fs.read(p))) await remove(p);
  res.conflicts.push(...now);
  return now;
}

const missing = async (fs: BundleFs, paths: string[]) =>
  (await Promise.all(paths.map((p) => fs.read(p)))).some((d) => d === null);
const aiDraft = (l?: Side) =>
  tomlOf(l)?.origin === 'ai' && [undefined, 'draft'].includes(tomlOf(l)?.status as string);

/** Whether the working tree changed entity since the last apply (or its conflict files went), unless it already holds the current content. */
async function changed(fs: BundleFs, L: Side | undefined, B: BaseEntry | undefined, R: Resolved | undefined) {
  const gone = R && B?.conflicts?.length && eq(B.heads, R.heads) ? await missing(fs, B.conflicts) : false;
  const adopted = R && (L?.sha ?? null) === R.sha && (!L || L.path === R.path) && !gone;
  return !adopted && (gone || (L?.sha ?? null) !== (B?.sha256 ?? null) || (!!L && !!B && L.path !== B.path));
}

/** Publish the working-tree change of entity `e` (unless held), write its current content back and update its base. */
async function applyEntity(run: Run, e: string, L: Side | undefined, vs: FileRecord[]) {
  const { o, res, base, broken } = run;
  const B = base[e];
  let R = vs.length ? await resolveEntity(vs, o.read) : undefined;
  // a TOML file that does not parse (mid-edit) is held: neither a delete of its entity nor overwritten
  const was = L ? undefined : (B?.path ?? R?.path);
  if (was && broken.has(was)) return void res.held.push(was);
  if (await changed(o.fs, L, B, R)) {
    const path = L?.path ?? B?.path ?? R!.path;
    if (o.actor.kind === 'agent' && !aiDraft(L)) return void res.held.push(path);
    const rec = await publish(o, { e, path, l: L, parents: B?.heads ?? [] });
    res.published.push(path);
    R = await resolveEntity([...vs, rec], async (sha) => (sha === L?.sha ? L.data : o.read(sha)));
  }
  if (!R) return void delete base[e];
  const conflicts = await writeCurrent(run, R, L, B?.conflicts);
  base[e] = { heads: R.heads, sha256: R.sha, path: R.path, ...(conflicts.length && { conflicts }) };
}

/** Publish changed working-tree files as versions, then write the current content back (docs/spec/sync.md#workspace-mode-v02). */
export async function applyWorkspace(o: ApplyOptions) {
  const res: WorkspaceResult = { published: [], written: [], removed: [], conflicts: [], held: [] };
  const [versions, { local, broken }, base] = [
    versionsByEntity(await o.replica.records()),
    await localFiles(o.fs),
    { ...o.base },
  ];
  const run: Run = { o, res, base, broken };
  for (const e of new Set([...versions.keys(), ...local.keys(), ...Object.keys(base)]))
    await applyEntity(run, e, local.get(e), versions.get(e) ?? []);
  return { result: res, base };
}
