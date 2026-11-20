/**
 * Upload of definition files from the web app (docs/spec/web.md#upload): place dropped files in the bundle,
 * check the result and report every change. Pure apart from the BundleFs it builds in memory.
 */
import { type BundleFs, checkBundle, type Problem, parseToml, slugify } from '@indx-watch/bundle';

/** BundleFs over a map of paths (a bundle snapshot unpacked in memory, or an upload being checked). */
export function memoryBundleFs(files: Map<string, Uint8Array>): BundleFs {
  const children = (dir: string) => {
    const prefix = dir ? `${dir.replace(/\/+$/, '')}/` : '';
    const inside = [...files.keys()].filter((k) => k.startsWith(prefix));
    const parts = inside.map((k) => k.slice(prefix.length).split('/'));
    return new Map(parts.map(([n = '', ...r]) => [n, r.length > 0]));
  };
  return {
    read: async (p) => files.get(p) ?? null,
    write: async (p, d) => void files.set(p, typeof d === 'string' ? new TextEncoder().encode(d) : d),
    remove: async (p) => {
      for (const k of files.keys()) if (k === p || k.startsWith(`${p}/`)) files.delete(k);
    },
    list: async (dir) => [...children(dir)].sort().map(([name, d]) => ({ name, dir: d })),
  };
}

export interface UploadFile {
  /** file name as dropped */
  name: string;
  /** path relative to the bundle root, for a dropped folder that contains project.toml */
  path?: string;
  /** base64 */
  data: string;
}
export interface UploadInput {
  files: UploadFile[];
  /** the files form a whole bundle and replace the current one */
  replace?: boolean;
  message?: string;
  dryRun?: boolean;
}
export type Change = 'added' | 'changed' | 'removed' | 'unchanged';
export interface UploadResult {
  ok: boolean;
  changes: { path: string; change: Change }[];
  unplaced: { name: string; reason: string }[];
  problems: Problem[];
  /** bundle record ID (hosted) once published */
  snapshot?: string;
}

export const MAX_UPLOAD_FILES = 2000;
const SAFE = /^(?!\.)[^\\:*?"<>|]+$/;
/** A relative path inside the bundle that is not hidden, not cache/ or runs/ and has no `..`. Pure; tested. */
export function safePath(path: string): boolean {
  const parts = path.split('/');
  if (parts.some((p) => !p || p === '..' || !SAFE.test(p))) return false;
  return parts[0] !== 'cache' && parts[0] !== 'runs';
}

const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const text = (d: Uint8Array) => new TextDecoder().decode(d);
const tomlOf = (d: Uint8Array): Record<string, unknown> | undefined => {
  try {
    return parseToml(text(d));
  } catch {
    return undefined;
  }
};
const dirOf = (p: string) => p.split('/').slice(0, -1).join('/');
const same = (a: Uint8Array | undefined, b: Uint8Array) =>
  !!a && a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

const CANNOT_PLACE = 'cannot place this file: drop the whole .indx-watch folder instead';

/**
 * Where a dropped file goes in `base`: its own path when that file exists, a non-TOML file by name, a TOML file by
 * `id`, a new test case next to the use case of its first covered criterion; otherwise the reason it cannot go.
 */
function place(base: Map<string, Uint8Array>, f: UploadFile, data: Uint8Array): string | { reason: string } {
  if (f.path && base.has(f.path) && safePath(f.path)) return f.path;
  if (!f.name.endsWith('.toml')) return placeByName(base, f.name);
  const doc = tomlOf(data);
  if (!doc) return { reason: 'not valid TOML' };
  return placeById(base, doc) ?? placeNewTestCase(base, doc) ?? { reason: CANNOT_PLACE };
}

/** The one file of `base` with this name. */
function placeByName(base: Map<string, Uint8Array>, name: string): string | { reason: string } {
  const hits = [...base.keys()].filter((p) => p.split('/').pop() === name);
  if (hits.length === 1) return hits[0]!;
  return { reason: hits.length ? 'ambiguous name' : 'no file with this name' };
}

/** The TOML file of `base` with the same non-empty `id`. */
function placeById(base: Map<string, Uint8Array>, doc: Record<string, unknown>) {
  if (typeof doc.id !== 'string' || !doc.id) return undefined;
  return [...base.keys()].find((p) => p.endsWith('.toml') && tomlOf(base.get(p)!)?.id === doc.id);
}

/** A new test case (`tc_` id, `key`, `covers`) goes next to the use case that holds its first covered criterion. */
function placeNewTestCase(base: Map<string, Uint8Array>, doc: Record<string, unknown>) {
  const covers = Array.isArray(doc.covers) ? String(doc.covers[0] ?? '') : '';
  const isTestCase = typeof doc.id === 'string' && doc.id.startsWith('tc_') && typeof doc.key === 'string';
  if (!isTestCase || !covers) return undefined;
  const holds = (p: string) => {
    const criteria = tomlOf(base.get(p)!)?.criteria;
    return Array.isArray(criteria) && criteria.some((c) => (c as { key?: unknown }).key === covers);
  };
  const uc = [...base.keys()].find((p) => p.endsWith('/use-case.toml') && holds(p));
  return uc && `${dirOf(uc)}/${doc.key}-${slugify(String(doc.title ?? ''))}.toml`;
}

/** Every path of `base` and `next` with its change, sorted by path. */
function diff(base: Map<string, Uint8Array>, next: Map<string, Uint8Array>): UploadResult['changes'] {
  const changeOf = (path: string, data: Uint8Array): Change =>
    !base.has(path) ? 'added' : same(base.get(path), data) ? 'unchanged' : 'changed';
  const changes = [...next].map(([path, data]) => ({ path, change: changeOf(path, data) }));
  for (const path of base.keys()) if (!next.has(path)) changes.push({ path, change: 'removed' });
  return changes.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/**
 * Merge the dropped files into `base` (or replace it with them when `input.replace`), check the result and list the
 * changes. The result is ok when something changed and the merged bundle has no errors.
 */
export async function prepareUpload(base: Map<string, Uint8Array>, input: UploadInput) {
  const files = Array.isArray(input.files) ? input.files.slice(0, MAX_UPLOAD_FILES) : [];
  const next = new Map(input.replace ? [] : base);
  const unplaced: UploadResult['unplaced'] = [];
  for (const f of files) {
    const data = decode(String(f.data ?? ''));
    const name = String(f.name ?? '').split('/').at(-1) ?? '';
    // a replacing upload keeps the paths of the dropped folder; a merge places each file in the current bundle
    const replaced = f.path && safePath(f.path) ? f.path : { reason: 'unsafe path' };
    const at = input.replace ? replaced : place(base, { ...f, name }, data);
    if (typeof at === 'string') next.set(at, data);
    else unplaced.push({ name, ...at });
  }
  const changes = diff(base, next);
  const { problems } = await checkBundle(memoryBundleFs(next));
  if (input.replace && !next.has('project.toml'))
    problems.unshift({ severity: 'error', code: 'no-project', message: 'The folder has no project.toml' });
  const ok = changes.some((c) => c.change !== 'unchanged') && !problems.some((p) => p.severity === 'error');
  return { next, result: { ok, changes, unplaced, problems } satisfies UploadResult };
}
