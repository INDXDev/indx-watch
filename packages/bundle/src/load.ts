/**
 * Load a bundle through a BundleFs (docs/spec/bundle-format.md#layout).
 * CONTRACT: signatures frozen; implementation T-101.
 */
import type { z } from 'zod';
import { sha256Hex } from './hash.js';
import { SCHEMA_VERSION } from './schema/common.js';
import type { BlobPointer, Feature, FileType, Fixture } from './schema/definitions.js';
import { FILE_TYPES, type Project, type TestCase, type UseCase } from './schema/definitions.js';
import { parseToml } from './toml.js';
import type { Bundle, BundleFs, Loaded, LoadedTemplate, Problem } from './types.js';
import { fixtureVersion, testCaseVersion } from './versions.js';
import { dotted, schemaAt, shapeOf } from './zwalk.js';

export interface LoadResult {
  /** null when project.toml is missing or invalid */
  bundle: Bundle | null;
  problems: Problem[];
}

/** Parse and validate every file; never throws for content errors (they become problems). */
export async function loadBundle(fs: BundleFs): Promise<LoadResult> {
  const { bundle, problems } = await loadDetailed(fs);
  return { bundle, problems };
}

/** One file seen while loading: its text, type and parsed data (when it parsed and validated). */
export interface SeenFile {
  path: string;
  /** 'data' for fixture data files */
  type: FileType | 'template' | 'data';
  text: string;
  raw?: Record<string, unknown>;
  valid: boolean;
}

/** Path rules of the layout; null = allowed and ignored. */
const RULES: [RegExp, FileType | 'template' | null][] = [
  [/^project\.toml$/, 'project'],
  [/^environments\/[^/]+\.toml$/, 'environment'],
  [/^releases\/[^/]+\.toml$/, 'release'],
  [/^plans\/[^/]+\.toml$/, 'plan'],
  [/^specs\/[^/]+\/feature\.toml$/, 'feature'],
  [/^specs\/[^/]+\/[^/]+\/use-case\.toml$/, 'use-case'],
  [/^specs\/[^/]+\/[^/]+\/TC-[^/]*\.toml$/, 'test-case'],
  [/^fixtures\/[^/]+\/fixture\.toml$/, 'fixture'],
  [/^templates\/(test-case|use-case|fixture)\.[a-z0-9][a-z0-9-]*\.toml$/, 'template'],
  [/(^|\/)README\.md$|^\.gitignore$/, null],
];
/** A conflict file left by a workspace-mode merge (docs/spec/sync.md#workspace-mode-v02). */
export const CONFLICT_FILE = /\.conflict-[0-9a-f]{8}(\.[^./]+)?$/;
/** The file type of a bundle path by the layout (null: allowed, not a definition; undefined: not in the layout). */
export const fileTypeOf = (path: string) => RULES.find(([re]) => re.test(path))?.[1];
const dec = new TextDecoder();
const TEXT = /\.(csv|tsv|json|ndjson|txt|md|toml|ya?ml|xml|html?|sql)$/i;
const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/'));

/** Every file under dir (cache/ and runs/ at the root are skipped). */
export async function walk(fs: BundleFs, dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.list(dir)) {
    const p = dir ? `${dir}/${e.name}` : e.name;
    if (e.dir && !(dir === '' && (e.name === 'cache' || e.name === 'runs'))) out.push(...(await walk(fs, p)));
    else if (!e.dir) out.push(p);
  }
  return out;
}

/** Shared state of one load: every path, the problems found and the files seen so far. */
function loader(fs: BundleFs, paths: string[]) {
  const problems: Problem[] = [];
  const files: SeenFile[] = [];
  const add = (severity: Problem['severity'], code: string, file: string, message: string) =>
    problems.push({ severity, code, file, message });

  /** Read, parse and validate one file; null when it is not TOML. */
  async function parse(path: string, type: FileType | 'template'): Promise<SeenFile | null> {
    const text = dec.decode((await fs.read(path)) ?? new Uint8Array());
    const seen: SeenFile = { path, type, text, valid: false };
    files.push(seen);
    try {
      seen.raw = parseToml(text);
    } catch (e) {
      add('error', 'invalid-toml', path, (e as Error).message.split('\n')[0]!);
      return null;
    }
    const kind = type === 'template' ? (path.split('/')[1]!.split('.')[0] as FileType) : type;
    const schema = (type === 'template' ? FILE_TYPES[kind].partial() : FILE_TYPES[kind]) as z.ZodType;
    const res = schema.safeParse(seen.raw);
    if (!res.success) problems.push(...zodProblems(path, schema, res.error));
    else seen.valid = true;
    return seen;
  }
  return { fs, paths, all: new Set(paths), problems, files, add, parse };
}
type Loader = ReturnType<typeof loader>;

/** Parse every path by its layout rule; collect templates, valid definitions by type and stray files. */
async function classify(l: Loader) {
  const byType = new Map<string, Loaded<never>[]>();
  const templates: LoadedTemplate[] = [];
  const unknownFiles: string[] = [];
  const fixtureFiles = new Set<string>();
  for (const path of l.paths) {
    if (CONFLICT_FILE.test(path)) {
      l.add(
        'error',
        'workspace-conflict',
        path,
        'Concurrent edits conflict: merge this file into the original, then delete it',
      );
      continue;
    }
    const type = fileTypeOf(path);
    if (type === undefined && /^fixtures\/[^/]+\/[^/]+$/.test(path)) fixtureFiles.add(path);
    else if (type === undefined) unknownFiles.push(path);
    if (!type) continue;
    const seen = await l.parse(path, type);
    if (!seen?.valid) continue;
    if (type === 'template') {
      const [, kind, name] = /^templates\/([a-z-]+)\.(.+)\.toml$/.exec(path)!;
      templates.push({ file: path, kind: kind as LoadedTemplate['kind'], name: name!, data: seen.raw! });
    } else {
      const data = FILE_TYPES[type].parse(seen.raw) as never;
      byType.set(type, [...(byType.get(type) ?? []), { file: path, data }]);
    }
  }
  const of = <T>(type: FileType) => (byType.get(type) ?? []) as Loaded<T>[];
  return { of, templates, unknownFiles, fixtureFiles };
}

/** The project when present and supported; also reports spec folders missing feature.toml or use-case.toml. */
function checkProject(l: Loader, project: Loaded<Project> | undefined) {
  const newer = project && project.data.schema_version > SCHEMA_VERSION;
  const message = `schema_version ${project?.data.schema_version} is newer than supported; upgrade`;
  if (newer) l.add('error', 'unsupported-schema-version', 'project.toml', message);
  if (!project && !l.all.has('project.toml'))
    l.add('error', 'missing-file', 'project.toml', 'project.toml not found');
  if (!project || newer) return undefined;
  const need = (dir: string | undefined, f: string) =>
    dir &&
    !l.all.has(dir + f) &&
    !l.problems.some((x) => x.file === dir + f) &&
    l.add('error', 'missing-file', dir + f, f);
  for (const p of l.paths) {
    need(/^specs\/[^/]+\/(?=.)/.exec(p)?.[0], 'feature.toml');
    need(/^specs\/[^/]+\/[^/]+\/(?=.)/.exec(p)?.[0], 'use-case.toml');
  }
  return project;
}

/** One fixture data file (inline or behind a blob pointer) and, for text, its CRLF → LF hash. */
async function dataFile(l: Loader, name: string, file: string) {
  const bytes = l.all.has(file) ? await l.fs.read(file) : null;
  if (bytes) {
    l.files.push({ path: file, type: 'data', text: dec.decode(bytes), valid: true });
    const d = { name, file, sha256: await sha256Hex(bytes), size: bytes.length };
    // text data files hash with CRLF → LF (same version on Windows)
    const lf = TEXT.test(name) ? bytes.filter((x, i) => x !== 13 || bytes[i + 1] !== 10) : null;
    return { d, lf: lf && (await sha256Hex(lf)) };
  }
  if (!l.all.has(`${file}.blob.toml`))
    return void l.add('error', 'missing-file', file, `Data file ${name} not found`);
  const seen = await l.parse(`${file}.blob.toml`, 'blob-pointer');
  const pointer = seen?.valid ? (seen.raw as BlobPointer) : undefined;
  return pointer && { d: { name, file: seen!.path, sha256: pointer.sha256, size: pointer.size, pointer } };
}

/** A fixture with its data files and version; claimed files are removed from `stray`. */
async function loadFixture(l: Loader, fx: Loaded<Fixture>, stray: Set<string>) {
  const loaded: NonNullable<Awaited<ReturnType<typeof dataFile>>>[] = [];
  for (const name of fx.data.files ?? []) {
    const file = `${dirOf(fx.file)}/${name}`;
    const one = await dataFile(l, name, file);
    if (one) loaded.push(one);
    stray.delete(file);
    stray.delete(`${file}.blob.toml`);
  }
  const forVersion = loaded.map(({ d, lf }) => ({ ...d, sha256: lf ?? d.sha256 }));
  const dataFiles = loaded.map((x) => x.d);
  return { ...fx, dataFiles, version: await fixtureVersion(fx.data, forVersion) };
}

/** Use cases with their feature key and test cases with their use case key and version. */
async function specs(of: Awaited<ReturnType<typeof classify>>['of']) {
  const featureKey = new Map(of<Feature>('feature').map((f) => [dirOf(f.file), f.data.key]));
  const useCases = of<UseCase>('use-case').map((u) => {
    const dir = dirOf(dirOf(u.file));
    return { ...u, feature: featureKey.get(dir) ?? /FEAT-\d+/.exec(dir)?.[0] ?? dir };
  });
  const ucKey = new Map(useCases.map((u) => [dirOf(u.file), u.data.key]));
  const criterionText = new Map(
    useCases.flatMap((u) => u.data.criteria.map((c) => [c.key, c.text] as const)),
  );
  const testCases: Bundle['testCases'] = [];
  for (const t of of<TestCase>('test-case')) {
    const useCase = ucKey.get(dirOf(t.file)) ?? /UC-\d+/.exec(dirOf(t.file))?.[0] ?? '';
    testCases.push({ ...t, useCase, version: await testCaseVersion(t.data, criterionText) });
  }
  return { useCases, testCases };
}

/** loadBundle plus every file seen, for check and fmt. */
export async function loadDetailed(fs: BundleFs): Promise<LoadResult & { files: SeenFile[] }> {
  const l = loader(fs, await walk(fs, ''));
  const { of, templates, unknownFiles, fixtureFiles } = await classify(l);
  const project = checkProject(l, of<Project>('project')[0]);
  if (!project) return { bundle: null, problems: l.problems, files: l.files };
  const fixtures: Bundle['fixtures'] = [];
  for (const fx of of<Fixture>('fixture')) fixtures.push(await loadFixture(l, fx, fixtureFiles));
  unknownFiles.push(...fixtureFiles);
  for (const f of unknownFiles.sort()) l.add('warning', 'unknown-file', f, 'File is not part of the format');
  const { useCases, testCases } = await specs(of);
  const bundle = { project, useCases, testCases, fixtures, templates, unknownFiles } as Bundle;
  for (const k of ['environment', 'release', 'feature', 'plan'])
    (bundle as never as Record<string, unknown>)[`${k}s`] = of(k as FileType);
  return { bundle, problems: l.problems, files: l.files };
}

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + +(a[i - 1] !== b[j - 1]));
    row = next;
  }
  return row[b.length]!;
}

/** Zod issues → problems ('unknown-key' with a suggestion, otherwise 'invalid-value'). */
export function zodProblems(file: string, schema: z.ZodType, error: z.ZodError): Problem[] {
  return error.issues.flatMap((issue): Problem[] => {
    if (issue.code !== 'unrecognized_keys')
      return [
        { severity: 'error', code: 'invalid-value', file, path: dotted(issue.path), message: issue.message },
      ];
    const sh = shapeOf(schemaAt(schema, issue.path));
    const known = sh.t === 'object' ? Object.keys(sh.shape) : [];
    return issue.keys.map((key) => {
      const best = known.map((k) => [k, distance(key, k)] as const).sort((x, y) => x[1] - y[1])[0];
      const hint = best && best[1] <= 2 ? ` Did you mean "${best[0]}"?` : '';
      const path = dotted([...issue.path, key]);
      return { severity: 'error', code: 'unknown-key', file, path, message: `Unknown key "${key}".${hint}` };
    });
  });
}
