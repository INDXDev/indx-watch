/**
 * Creating and rewriting definition files. CONTRACT: signatures frozen; implementation T-101.
 */
import { type KeyKind, newId, nextCriterionKey, nextKey, parseRef } from './ids.js';
import { zodProblems } from './load.js';
import type { IdPrefix } from './schema/common.js';
import { FILE_TYPES, type FileType } from './schema/definitions.js';
import { formatToml } from './toml.js';
import type { Bundle, BundleFs, Loaded } from './types.js';
import { useCaseVersion } from './versions.js';

/** Lowercase ASCII slug from a title, max 40 chars ('Valid coupon reduces the total' → 'valid-coupon-reduces-the-total'). */
export function slugify(title: string): string {
  const ascii = title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const s = ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  // at most 40 chars, cut at a word boundary
  const cut = s.length <= 40 ? s : s.slice(0, 41).replace(/-[^-]*$/, '') || s.slice(0, 40);
  return cut || 'untitled';
}

export type NewKind =
  | 'feature'
  | 'use-case'
  | 'criterion'
  | 'test-case'
  | 'fixture'
  | 'environment'
  | 'release'
  | 'plan';

export interface CreateInput {
  kind: NewKind;
  /** field values (validated); id/key are generated when absent */
  fields: Record<string, unknown>;
  /** parent key: feature for use cases, use case for criteria and test cases */
  parent?: string;
  template?: string;
  origin?: 'human' | 'ai' | 'import';
  ai?: { model: string; skill?: string };
  /** create as status 'ready' (humans only; rejected with origin 'ai'); default 'draft' */
  ready?: boolean;
  /** keys seen in results or elsewhere, so retired keys are not reused */
  knownKeys?: Iterable<string>;
  now?: Date;
}

export interface CreateResult {
  kind: NewKind;
  id: string;
  key: string;
  /** path relative to the bundle root */
  file: string;
}

/** Placeholder step written when a test case is created without steps (it stays draft). */
export const PLACEHOLDER_STEP = {
  instruction: 'Describe the step.',
  expected: 'Describe the expected result.',
};

/** File type, ID prefix, key kind and path ({d} parent dir, {k} key, {s} slug) of each kind with its own file. */
const KINDS: Record<Exclude<NewKind, 'criterion'>, [FileType, IdPrefix, KeyKind | null, string]> = {
  feature: ['feature', 'fea', 'feature', 'specs/{k}-{s}/feature.toml'],
  'use-case': ['use-case', 'uc', 'useCase', '{d}/{k}-{s}/use-case.toml'],
  'test-case': ['test-case', 'tc', 'testCase', '{d}/{k}-{s}.toml'],
  fixture: ['fixture', 'fx', 'fixture', 'fixtures/{k}-{s}/fixture.toml'],
  environment: ['environment', 'env', null, 'environments/{k}.toml'],
  release: ['release', 'rel', null, 'releases/{k}.toml'],
  plan: ['plan', 'pln', 'plan', 'plans/{k}-{s}.toml'],
};
const DEFAULTS: Partial<Record<NewKind, object>> = {
  'use-case': { actor: 'User', priority: 'P1' }, // P1 is gated: a new use case is never silently out of scope
  'test-case': { mode: 'manual' },
  fixture: { kind: 'file' },
  environment: { base_url: 'http://localhost:3000' },
  release: { state: 'planning' },
};
const dirOf = (file: string) => file.slice(0, file.lastIndexOf('/'));
const fail = (code: string, message: string): never => {
  throw new BundleError(code, message);
};
type Ref = { data: { id: string; key: string } };
const find = <T extends Ref>(xs: T[], ref: string | undefined, what = 'Use case') =>
  xs.find((x) => x.data.key === ref || x.data.id === ref) ?? fail('NOT_FOUND', `${what} ${ref} not found`);

/** Create a definition with a fresh ID and the next free key, write it canonically. Throws a BundleError on invalid input. */
export async function createDefinition(
  fs: BundleFs,
  bundle: Bundle,
  input: CreateInput,
): Promise<CreateResult> {
  const { kind, fields } = input;
  const now = input.now ?? new Date();
  const origin = input.origin ?? 'human';
  if (origin === 'ai' && input.ready)
    fail('INVALID_INPUT', 'AI-written items start as draft; humans approve');
  if (origin === 'ai' && !input.ai?.model) fail('INVALID_INPUT', 'origin "ai" needs the model ID');
  const keys = [
    ...bundle.useCases.flatMap((u) => u.data.criteria.map((c) => c.key)),
    ...[...bundle.features, ...bundle.useCases, ...bundle.testCases, ...bundle.fixtures, ...bundle.plans].map(
      (x) => x.data.key,
    ),
    ...(input.knownKeys ?? []),
  ];
  // only `iw approve` (a human) records an approval: AI-written input never arrives approved
  const life = origin === 'human' ? {} : { origin, ...(origin === 'ai' && { approved_by: undefined }) };
  const created_at = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const ai = input.ai && origin === 'ai' ? { ai: { ...input.ai, created_at } } : {};
  const title = String(fields.title ?? '');
  const given = (k: string) => fields[k] as string | undefined;

  if (kind === 'criterion') {
    const uc = find(bundle.useCases, input.parent);
    const [key, id] = [given('key') ?? nextCriterionKey(uc.data.key, keys), given('id') ?? newId('ac', +now)];
    const c = { id, key, ...fields, ...life, ...ai, ...(origin === 'ai' ? { status: 'draft' } : {}) };
    await writeDefinition(fs, uc.file, 'use-case', { ...uc.data, criteria: [...uc.data.criteria, c] });
    return { kind, id, key, file: uc.file };
  }
  const [type, prefix, keyKind, path] = KINDS[kind] ?? fail('USAGE', `Unknown kind ${String(kind)}`);
  const tpl = bundle.templates.find((t) => t.name === input.template && t.kind === kind);
  if (input.template && !tpl) fail('NOT_FOUND', `Template ${kind}.${input.template} not found`);
  const base: Record<string, unknown> = { ...DEFAULTS[kind], ...tpl?.data, ...fields, ...life, ...ai };
  if (['use-case', 'test-case', 'fixture'].includes(kind)) base.status = input.ready ? 'ready' : 'draft';
  const named = given('name') ?? given('version') ?? (kind === 'release' ? title : slugify(title));
  const key = given('key') ?? (keyKind ? nextKey(keyKind, keys) : named);
  let dir = '';
  if (kind === 'use-case') {
    const feats = bundle.features;
    dir = dirOf(
      find(feats, input.parent ?? (feats.length === 1 ? feats[0]!.data.key : 'FEAT-1'), 'Feature').file,
    );
    base.goal ??= title;
    base.criteria = ((base.criteria as unknown[] | undefined) ?? []).map((c, i) => ({
      id: newId('ac', +now),
      key: `AC-${key.slice(3)}.${i + 1}`,
      ...(typeof c === 'string' ? { text: c } : (c as object)),
      ...life,
    }));
  } else if (kind === 'test-case') {
    const uc = find(bundle.useCases, input.parent);
    dir = dirOf(uc.file);
    base.covers ??= uc.data.criteria.filter((c) => c.status !== 'retired').map((c) => c.key);
    if (!(base.steps as unknown[] | undefined)?.length)
      Object.assign(base, { steps: [PLACEHOLDER_STEP], status: 'draft' });
  }
  base[kind === 'environment' ? 'name' : kind === 'release' ? 'version' : 'key'] = key;
  const file = path.replace('{d}', dir).replace('{k}', key).replace('{s}', slugify(title));
  if (await fs.read(file)) fail('CONFLICT', `${file} already exists`);
  const id = given('id') ?? newId(prefix, +now);
  await writeDefinition(fs, file, type, { ...base, id });
  return { kind, id, key, file };
}
type Approvable = Loaded<{ id: string; key: string }>;

/**
 * `iw approve`: set status 'ready', approved_by = actor id (from the IdentityProvider, never a flag) and
 * approved_version = current version (tcv/fxv, or the use case's content hash). Returns the file written.
 */
export async function approveDefinition(
  fs: BundleFs,
  bundle: Bundle,
  ref: string,
  approver: string,
): Promise<{ file: string; version: string }> {
  const p = parseRef(ref);
  const match = (d: { id: string; key: string }) =>
    p?.type === 'id' ? d.id === p.id : d.key === (p?.key ?? ref);
  const tc = bundle.testCases.find((t) => match(t.data));
  const fx = bundle.fixtures.find((f) => match(f.data));
  const uc = bundle.useCases.find((u) => match(u.data));
  const targets: [FileType, Approvable | undefined, () => Promise<string>][] = [
    ['test-case', tc, async () => tc!.version],
    ['fixture', fx, async () => fx!.version],
    ['use-case', uc, () => useCaseVersion(uc!.data)],
  ];
  for (const [type, item, version] of targets) {
    if (!item) continue;
    const v = await version();
    await writeDefinition(fs, item.file, type, {
      ...item.data,
      status: 'ready',
      approved_by: approver,
      approved_version: v,
    });
    return { file: item.file, version: v };
  }
  // features, environments, releases and plans have no status or version: approval records the reviewer
  const named = (d: Record<string, unknown>) =>
    match({ id: d.id as string, key: String(d.key ?? d.name ?? d.version) });
  const { features, environments, releases, plans } = bundle;
  const other = { feature: features, environment: environments, release: releases, plan: plans };
  for (const [type, xs] of Object.entries(other) as [FileType, Loaded<Record<string, unknown>>[]][]) {
    const x = xs.find((x) => named(x.data));
    if (!x) continue;
    await writeDefinition(fs, x.file, type, { ...x.data, approved_by: approver });
    return { file: x.file, version: '' };
  }
  const owner =
    bundle.useCases.find((u) => u.data.criteria.some(match)) ?? fail('NOT_FOUND', `${ref} not found`);
  const criteria = owner.data.criteria.map((c) =>
    match(c) ? { ...c, status: 'ready' as const, approved_by: approver } : c,
  );
  await writeDefinition(fs, owner.file, 'use-case', { ...owner.data, criteria });
  return { file: owner.file, version: await useCaseVersion({ ...owner.data, criteria }) };
}

/** Validate and write data canonically to path. */
export async function writeDefinition(
  fs: BundleFs,
  path: string,
  type: FileType,
  data: Record<string, unknown>,
): Promise<void> {
  const res = FILE_TYPES[type].safeParse(data);
  if (!res.success) {
    const details = zodProblems(path, FILE_TYPES[type], res.error);
    const message = `Invalid ${type}: ${details.map((d) => `${d.path} ${d.message}`).join('; ')}`;
    throw new BundleError('INVALID_INPUT', message, details);
  }
  await fs.write(path, formatToml(type, res.data as Record<string, unknown>));
}

/** Error with a code and problems, thrown by write operations. */
export class BundleError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: unknown[] = [],
  ) {
    super(message);
  }
}
