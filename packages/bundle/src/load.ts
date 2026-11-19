/**
 * Load a bundle through a BundleFs (docs/spec/bundle-format.md#layout).
 * CONTRACT: signatures frozen; implementation T-101.
 */
import type { z } from 'zod';
import { sha256Hex } from './hash.js';
import { SCHEMA_VERSION } from './schema/common.js';
import type {
  BlobPointer,
  Feature,
  FileType,
  Fixture,
  Project,
  TestCase,
  UseCase,
} from './schema/definitions.js';
import { FILE_TYPES } from './schema/definitions.js';
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
const dec = new TextDecoder();
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

/** loadBundle plus every file seen, for check and fmt. */
export async function loadDetailed(fs: BundleFs): Promise<LoadResult & { files: SeenFile[] }> {
  const problems: Problem[] = [];
  const files: SeenFile[] = [];
  const add = (severity: Problem['severity'], code: string, file: string, message: string) =>
    problems.push({ severity, code, file, message });
  const paths = await walk(fs, '');
  const all = new Set(paths);

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
    const schema = type === 'template' ? FILE_TYPES[kind].partial() : FILE_TYPES[kind];
    const res = (schema as z.ZodType).safeParse(seen.raw);
    if (!res.success) problems.push(...zodProblems(path, schema as z.ZodType, res.error));
    else seen.valid = true;
    return seen;
  }

  const byType = new Map<string, Loaded<never>[]>();
  const templates: LoadedTemplate[] = [];
  const unknownFiles: string[] = [];
  const fixtureFiles = new Set<string>();
  for (const path of paths) {
    const rule = RULES.find(([re]) => re.test(path));
    if (!rule) {
      if (/^fixtures\/[^/]+\/[^/]+$/.test(path)) fixtureFiles.add(path);
      else unknownFiles.push(path);
      continue;
    }
    if (!rule[1]) continue;
    const seen = await parse(path, rule[1]);
    if (!seen?.valid) continue;
    if (rule[1] === 'template') {
      const [, kind, name] = /^templates\/([a-z-]+)\.(.+)\.toml$/.exec(path)!;
      templates.push({ file: path, kind: kind as LoadedTemplate['kind'], name: name!, data: seen.raw! });
    } else {
      const data = FILE_TYPES[rule[1]].parse(seen.raw) as never;
      byType.set(rule[1], [...(byType.get(rule[1]) ?? []), { file: path, data }]);
    }
  }
  const of = <T>(type: FileType) => (byType.get(type) ?? []) as Loaded<T>[];

  const project = of<Project>('project')[0];
  const newer = `schema_version ${project?.data.schema_version} is newer than supported; upgrade`;
  if (project && project.data.schema_version > SCHEMA_VERSION)
    add('error', 'unsupported-schema-version', 'project.toml', newer);
  if (!project && !all.has('project.toml'))
    add('error', 'missing-file', 'project.toml', 'project.toml not found');
  if (!project || project.data.schema_version > SCHEMA_VERSION) return { bundle: null, problems, files };
  const need = (dir: string | undefined, f: string) =>
    dir &&
    !all.has(dir + f) &&
    !problems.some((x) => x.file === dir + f) &&
    add('error', 'missing-file', dir + f, f);
  for (const p of paths) {
    need(/^specs\/[^/]+\/(?=.)/.exec(p)?.[0], 'feature.toml');
    need(/^specs\/[^/]+\/[^/]+\/(?=.)/.exec(p)?.[0], 'use-case.toml');
  }

  const featureKey = new Map(of<Feature>('feature').map((f) => [dirOf(f.file), f.data.key]));
  const useCases = of<UseCase>('use-case').map((u) => {
    const dir = dirOf(dirOf(u.file));
    return { ...u, feature: featureKey.get(dir) ?? /FEAT-\d+/.exec(dir)?.[0] ?? dir };
  });
  const ucKey = new Map(useCases.map((u) => [dirOf(u.file), u.data.key]));
  const criterionText = new Map(
    useCases.flatMap((u) => u.data.criteria.map((c) => [c.key, c.text] as const)),
  );

  const fixtures: Bundle['fixtures'] = [];
  for (const fx of of<Fixture>('fixture')) {
    const dir = dirOf(fx.file);
    const dataFiles: Bundle['fixtures'][0]['dataFiles'] = [];
    for (const name of fx.data.files ?? []) {
      const file = `${dir}/${name}`;
      const bytes = all.has(file) ? await fs.read(file) : null;
      if (bytes) {
        files.push({ path: file, type: 'data', text: dec.decode(bytes), valid: true });
        dataFiles.push({ name, file, sha256: await sha256Hex(bytes), size: bytes.length });
      } else if (all.has(`${file}.blob.toml`)) {
        const seen = await parse(`${file}.blob.toml`, 'blob-pointer');
        const pointer = seen?.valid ? (seen.raw as BlobPointer) : undefined;
        if (pointer)
          dataFiles.push({ name, file: seen!.path, sha256: pointer.sha256, size: pointer.size, pointer });
      } else add('error', 'missing-file', file, `Data file ${name} not found`);
      fixtureFiles.delete(file);
      fixtureFiles.delete(`${file}.blob.toml`);
    }
    fixtures.push({ ...fx, dataFiles, version: await fixtureVersion(fx.data, dataFiles) });
  }
  unknownFiles.push(...fixtureFiles);
  for (const f of unknownFiles.sort()) add('warning', 'unknown-file', f, 'File is not part of the format');

  const testCases: Bundle['testCases'] = [];
  for (const t of of<TestCase>('test-case')) {
    const useCase = ucKey.get(dirOf(t.file)) ?? /UC-\d+/.exec(dirOf(t.file))?.[0] ?? '';
    testCases.push({ ...t, useCase, version: await testCaseVersion(t.data, criterionText) });
  }
  const bundle = { project, useCases, testCases, fixtures, templates, unknownFiles } as Bundle;
  for (const k of ['environment', 'release', 'feature', 'plan'])
    (bundle as never as Record<string, unknown>)[`${k}s`] = of(k as FileType);
  return { bundle, problems, files };
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
