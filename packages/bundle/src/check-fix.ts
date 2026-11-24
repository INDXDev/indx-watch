/**
 * iw check --fix (docs/spec/cli.md#iw-check): renumber duplicate keys, rename paths whose key part is wrong,
 * canonicalize every valid file.
 */
import type { CheckDeps, CheckResult } from './check.js';
import { type KeyKind, nextCriterionKey, nextKey } from './ids.js';
import { type SeenFile, walk } from './load.js';
import type { FileType } from './schema/definitions.js';
import { formatToml, formatTomlBody } from './toml.js';
import type { Bundle, BundleFs } from './types.js';
import { slugify } from './write.js';

type Rec = Record<string, unknown>;
type Item = { file: string; data: { id: string; key: string; title: string } };
type Group = [KeyKind, Item[]];
type Moved = { from: string; to: string; id: string };
/** What a fix run works on; `res` collects the changed files and renumbered keys. */
export type FixInput = { fs: BundleFs; b: Bundle; files: SeenFile[]; deps: CheckDeps; res: CheckResult };
/** One fix run: `seen` holds every taken (or retired) key, `data` the new data per file to write. */
type Fix = FixInput & { seen: Set<string>; data: Map<string, Rec> };

const dirOf = (f: string) => f.slice(0, f.lastIndexOf('/'));
/** The data to write for a file so far (a copy of `d` when it has none yet). */
const get = <T>(x: Fix, file: string, d: T) => (x.data.get(file) ?? { ...d }) as T & Rec;
const renumber = (x: Fix, m: Moved) => x.seen.add(m.to) && x.res.renumbered.push(m);

/** Canonical text of a valid TOML file (with `data` in place of its contents), or null when it has none. */
export function canonicalText(f: SeenFile, data = f.raw): string | null {
  if (!f.valid || !data || f.type === 'data') return null;
  if (f.type !== 'template') return formatToml(f.type, data);
  return formatTomlBody(f.path.split('/').pop()!.split('.')[0] as FileType, data);
}

/** Renumber duplicate keys, rename paths whose key part is wrong, and canonicalize every valid file. */
export async function fix(input: FixInput) {
  const { b, deps } = input;
  const groups: Group[] = [['feature', b.features]];
  groups.push(['useCase', b.useCases], ['testCase', b.testCases], ['sharedStep', b.sharedSteps]);
  groups.push(['fixture', b.fixtures], ['plan', b.plans]);
  const seen = new Set([...(deps.knownKeys ?? []), ...groups.flatMap(([, xs]) => xs.map((x) => x.data.key))]);
  for (const c of b.useCases.flatMap((u) => u.data.criteria)) seen.add(c.key);
  const x: Fix = { ...input, seen, data: new Map() };
  // a shared step is not renumbered: the `use` that names it would not know which one it meant
  for (const [kind, items] of groups.filter(([k]) => k !== 'sharedStep'))
    for (const key of new Set(items.map((it) => it.data.key))) {
      const dups = items.filter((it) => it.data.key === key);
      const keep = await keeper(dups, (it) => it.data.id, deps);
      for (const it of dups) if (it !== keep) await renumberItem(x, kind, it, key);
    }
  const moved: Moved[] = [];
  for (const uc of b.useCases) await renumberCriteria(x, uc, moved);
  if (moved.length) await followCovers(x, moved);
  await writeFiles(x, renames(x, groups));
}

/** The duplicate that keeps its key: the one on the default branch, else the smallest ID (sorts `dups`). */
async function keeper<T>(dups: T[], id: (x: T) => string, deps: CheckDeps): Promise<T> {
  dups.sort((x, y) => (id(x) < id(y) ? -1 : 1));
  const onBranch = await Promise.all(dups.map((x) => deps.onDefaultBranch?.(id(x))));
  return dups[Math.max(0, onBranch.indexOf(true))]!;
}

/** Give one item the next free key; its criteria, the covers in its directory and its @TC-n tags follow. */
async function renumberItem(x: Fix, kind: KeyKind, it: Item, key: string) {
  const m = { from: key, to: nextKey(kind, x.seen), id: it.data.id };
  renumber(x, m);
  const d: Rec = { ...get(x, it.file, it.data), key: m.to };
  x.data.set(it.file, d);
  if (kind === 'useCase') followUseCase(x, it.file, m);
  // @TC-n tags in the automated tests, when the caller can read them
  const repo = kind === 'testCase' ? x.deps.repo : undefined;
  for (const f of repo ? ((d.automation as { files?: string[] })?.files ?? []) : []) {
    const text = await repo!.read(f);
    const next = text?.replace(new RegExp(`@${m.from}(?![0-9])`, 'g'), `@${m.to}`);
    if (text && next !== text) await repo!.write(f, next!);
  }
}

/** A renumbered use case's criteria follow, and so do the covers of test cases in its directory. */
function followUseCase(x: Fix, file: string, m: Moved) {
  const d = x.data.get(file)!;
  const [a, z] = [`AC-${m.from.slice(3)}.`, `AC-${m.to.slice(3)}.`];
  const map = new Map<string, string>();
  d.criteria = (d.criteria as { id: string; key: string }[]).map((c) => {
    if (!c.key.startsWith(a)) return c;
    const key = z + c.key.slice(a.length);
    map.set(c.key, key);
    renumber(x, { from: c.key, to: key, id: c.id });
    return { ...c, key };
  });
  for (const t of map.size ? x.b.testCases.filter((t) => dirOf(t.file) === dirOf(file)) : []) {
    const td = get(x, t.file, t.data);
    x.data.set(t.file, { ...td, covers: td.covers.map((k) => map.get(k) ?? k) });
  }
}

/**
 * Criteria numbered for another use case, or duplicated inside one → the next free number.
 * Duplicates keep the one on the default branch (else the smaller ID); covers follow the renumbered one.
 */
async function renumberCriteria(x: Fix, uc: Bundle['useCases'][number], moved: Moved[]) {
  const d = get(x, uc.file, uc.data);
  const own = `AC-${d.key.slice(3)}.`;
  const keeps = new Map<string, string>(); // key → ID that keeps it
  for (const key of new Set(d.criteria.map((c) => c.key).filter((k) => k.startsWith(own)))) {
    const dups = d.criteria.filter((c) => c.key === key);
    keeps.set(key, (await keeper(dups, (c) => c.id, x.deps)).id);
  }
  const used = new Set(keeps.keys());
  const criteria = d.criteria.map((c) => {
    if (keeps.get(c.key) === c.id) return c;
    const m = { from: c.key, to: nextCriterionKey(d.key, [...x.seen, ...used]), id: c.id };
    used.add(m.to);
    renumber(x, m);
    moved.push(m);
    return { ...c, key: m.to };
  });
  if (criteria.some((c, i) => c !== d.criteria[i])) x.data.set(uc.file, { ...d, criteria });
}

/**
 * A key that no longer exists anywhere moves in every test case; a key that is still taken moves only
 * in test cases not on the default branch (without git: created after the renumbered criterion).
 */
async function followCovers(x: Fix, moved: Moved[]) {
  const left = new Set(x.b.useCases.flatMap((u) => get(x, u.file, u.data).criteria.map((c) => c.key)));
  for (const t of x.b.testCases) {
    const td = get(x, t.file, t.data);
    const branch = x.deps.onDefaultBranch ? !(await x.deps.onDefaultBranch(t.data.id)) : undefined;
    const follows = (k: string, m: Moved) => m.from === k && (!left.has(k) || (branch ?? t.data.id > m.id));
    const covers = td.covers.map((k) => moved.find((m) => follows(k, m))?.to ?? k);
    if (covers.some((k, i) => k !== td.covers[i])) x.data.set(t.file, { ...td, covers });
  }
}

/** Directories and files whose name does not match the key: original path → new last segment. */
function renames(x: Fix, groups: Group[]): Map<string, string> {
  const renamed = new Map<string, string>();
  for (const [kind, items] of groups) for (const it of items) renameToKey(x, kind, it, renamed);
  for (const { file, data: d } of [...x.b.environments, ...x.b.releases]) {
    const name = `${'name' in d ? d.name : d.version}.toml`;
    if (!file.endsWith(`/${name}`)) renamed.set(file, name);
  }
  return renamed;
}

/** An item's file (test cases, plans) or directory not starting with its (new) key: key + kept slug, or title slug. */
function renameToKey(x: Fix, kind: KeyKind, it: Item, renamed: Map<string, string>) {
  const path = ['testCase', 'plan', 'sharedStep'].includes(kind) ? it.file : dirOf(it.file);
  const key = (x.data.get(it.file)?.key as string | undefined) ?? it.data.key;
  const [last, ext] = [path.split('/').at(-1)!, path.endsWith('.toml') ? '.toml' : ''];
  if (last.startsWith(`${key}-`)) return;
  const slug = /^[A-Z]+-\d+(-.+)$/.exec(last.slice(0, last.length - ext.length))?.[1];
  renamed.set(path, `${key}${slug ?? `-${slugify(it.data.title)}`}${ext}`);
}

/** Write every changed or moved file at its final path, then move the other files of renamed directories. */
async function writeFiles({ fs, files, data, res }: Fix, renamed: Map<string, string>) {
  const finalPath = (p: string) => {
    const seg = p.split('/');
    return seg.map((s, i) => renamed.get(seg.slice(0, i + 1).join('/')) ?? s).join('/');
  };
  for (const f of files) {
    const target = finalPath(f.path);
    const moved = target !== f.path;
    // canonical text when it changed or the file moved; the bytes as they are when a non-TOML file moved
    const out = canonicalText(f, data.get(f.path) ?? f.raw) ?? (moved && (await fs.read(f.path)));
    if (!out || (out === f.text && !moved)) continue;
    await fs.write(target, out);
    if (moved) await fs.remove(f.path);
    res.changed.push(target);
  }
  // other files inside renamed directories (README.md, unknown files)
  for (const dir of [...renamed.keys()].filter((k) => !files.some((f) => f.path === k)))
    await moveDir(fs, dir, finalPath);
}

/** Move every file of a renamed directory to its final path, then remove the directory. */
async function moveDir(fs: BundleFs, dir: string, finalPath: (p: string) => string) {
  for (const p of await walk(fs, dir)) {
    const bytes = await fs.read(p);
    if (bytes) await fs.write(finalPath(p), bytes);
  }
  await fs.remove(dir);
}
