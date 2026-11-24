/**
 * Creating and rewriting definition files. CONTRACT: signatures frozen; implementation T-101.
 */
import { type KeyKind, newId, nextCriterionKey, nextKey, parseRef } from './ids.js';
import { zodProblems } from './load.js';
import type { IdPrefix } from './schema/common.js';
import { FILE_TYPES, type FileType } from './schema/definitions.js';
import { collapseSteps } from './steps.js';
import { formatToml, schemaRefOf } from './toml.js';
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

/** Kinds `iw new` creates: every definition file type plus criteria (written into their use case). */
export type NewKind = keyof typeof KINDS | 'criterion';

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

/**
 * File type, ID prefix, key kind, path ({d} parent dir, {k} key, {s} slug) and the field holding the key
 * of each kind with its own file.
 */
const KINDS = {
  feature: ['feature', 'fea', 'feature', 'specs/{k}-{s}/feature.toml', 'key'],
  'use-case': ['use-case', 'uc', 'useCase', '{d}/{k}-{s}/use-case.toml', 'key'],
  'test-case': ['test-case', 'tc', 'testCase', '{d}/{k}-{s}.toml', 'key'],
  'shared-step': ['shared-step', 'ss', 'sharedStep', 'steps/{k}-{s}.toml', 'key'],
  fixture: ['fixture', 'fx', 'fixture', 'fixtures/{k}-{s}/fixture.toml', 'key'],
  environment: ['environment', 'env', null, 'environments/{k}.toml', 'name'],
  release: ['release', 'rel', null, 'releases/{k}.toml', 'version'],
  plan: ['plan', 'pln', 'plan', 'plans/{k}-{s}.toml', 'key'],
} satisfies Record<string, [FileType, IdPrefix, KeyKind | null, string, string]>;
const DEFAULTS: Partial<Record<NewKind, object>> = {
  'use-case': { actor: 'User', priority: 'P1' }, // P1 is gated: a new use case is never silently out of scope
  'test-case': { mode: 'manual' },
  fixture: { kind: 'file' },
  environment: { base_url: 'http://localhost:3000' },
  release: { state: 'planning' },
};
/** Built-in templates, used when templates/ has none of that name (docs/spec/bundle-format.md#templates). */
const BUILTIN: Partial<Record<NewKind, Record<string, object>>> = {
  'test-case': {
    bdd: { style: 'bdd', preconditions: 'Describe the state the app is in before the scenario starts.' },
  },
};
const dirOf = (file: string) => file.slice(0, file.lastIndexOf('/'));
const fail = (code: string, message: string): never => {
  throw new BundleError(code, message);
};
type Ref = { data: { id: string; key: string } };
const find = <T extends Ref>(xs: T[], ref: string | undefined, what = 'Use case') =>
  xs.find((x) => x.data.key === ref || x.data.id === ref) ?? fail('NOT_FOUND', `${what} ${ref} not found`);

/** Validated provenance and the values every created kind shares: keys in use, lifecycle and AI fields. */
function context(fs: BundleFs, bundle: Bundle, input: CreateInput) {
  const now = input.now ?? new Date();
  const origin = input.origin ?? 'human';
  if (origin === 'ai' && input.ready)
    fail('INVALID_INPUT', 'AI-written items start as draft; humans approve');
  if (origin === 'ai' && !input.ai?.model) fail('INVALID_INPUT', 'origin "ai" needs the model ID');
  const { features, useCases, testCases, sharedSteps, fixtures, plans } = bundle;
  const items = [...features, ...useCases, ...testCases, ...sharedSteps, ...fixtures, ...plans];
  const keyed = items.map((x) => x.data);
  const keys = [...keyed, ...useCases.flatMap((u) => u.data.criteria)].map((x) => x.key);
  keys.push(...(input.knownKeys ?? []));
  // only `iw approve` (a human) records an approval: AI-written input never arrives approved
  const life = origin === 'human' ? {} : { origin, ...(origin === 'ai' && { approved_by: undefined }) };
  const created_at = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const ai = input.ai && origin === 'ai' ? { ai: { ...input.ai, created_at } } : {};
  const given = (k: string) => input.fields[k] as string | undefined;
  const title = String(input.fields.title ?? '');
  /** a new criterion: an AI one is a draft with its own [ai] table */
  const criterion = { ...life, ...ai, ...(origin === 'ai' && { status: 'draft' }) };
  return { fs, bundle, input, now, origin, keys, life, ai, criterion, given, title };
}
type Ctx = ReturnType<typeof context>;

/** Append an acceptance criterion to its use case. */
async function createCriterion(c: Ctx): Promise<CreateResult> {
  const uc = find(c.bundle.useCases, c.input.parent);
  const key = c.given('key') ?? nextCriterionKey(uc.data.key, c.keys);
  const id = c.given('id') ?? newId('ac', +c.now);
  const ac = { id, key, ...c.input.fields, ...c.criterion };
  await writeDefinition(c.fs, uc.file, 'use-case', { ...uc.data, criteria: [...uc.data.criteria, ac] });
  return { kind: 'criterion', id, key, file: uc.file };
}

/** A use case goes under its feature; goal defaults to the title and criteria get IDs and keys. Returns the dir. */
function placeUseCase(c: Ctx, base: Record<string, unknown>, key: string): string {
  const feats = c.bundle.features;
  const parent = c.input.parent ?? (feats.length === 1 ? feats[0]!.data.key : 'FEAT-1');
  const feature = find(feats, parent, 'Feature');
  base.goal ??= c.title;
  const ac = (i: number) => ({ id: newId('ac', +c.now), key: `AC-${key.slice(3)}.${i + 1}` });
  const text = (x: unknown) => (typeof x === 'string' ? { text: x } : (x as object));
  const given = (base.criteria as unknown[] | undefined) ?? [];
  base.criteria = given.map((x, i) => ({ ...ac(i), ...text(x), ...c.criterion }));
  return dirOf(feature.file);
}

/** A test case goes under its use case and covers its live criteria; without steps it gets a placeholder. */
function placeTestCase(c: Ctx, base: Record<string, unknown>): string {
  const uc = find(c.bundle.useCases, c.input.parent);
  base.covers ??= uc.data.criteria.filter((x) => x.status !== 'retired').map((x) => x.key);
  if (!(base.steps as unknown[] | undefined)?.length)
    Object.assign(base, { steps: [PLACEHOLDER_STEP], status: 'draft' });
  return dirOf(uc.file);
}

/** Create a definition with a fresh ID and the next free key, write it canonically. Throws a BundleError on invalid input. */
export async function createDefinition(
  fs: BundleFs,
  bundle: Bundle,
  input: CreateInput,
): Promise<CreateResult> {
  const c = context(fs, bundle, input);
  const { kind } = input;
  if (kind === 'criterion') return createCriterion(c);
  const [type, prefix, keyKind, path, field] = KINDS[kind] ?? fail('USAGE', `Unknown kind ${String(kind)}`);
  const base = baseFields(c, kind);
  const named = c.given('name') ?? c.given('version') ?? (kind === 'release' ? c.title : slugify(c.title));
  const key = c.given('key') ?? (keyKind ? nextKey(keyKind, c.keys) : named);
  if (kind === 'shared-step' && !(base.steps as unknown[] | undefined)?.length)
    base.steps = [PLACEHOLDER_STEP];
  const dir =
    kind === 'use-case' ? placeUseCase(c, base, key) : kind === 'test-case' ? placeTestCase(c, base) : '';
  const file = path.replace('{d}', dir).replace('{k}', key).replace('{s}', slugify(c.title));
  if (await fs.read(file)) fail('CONFLICT', `${file} already exists`);
  const id = c.given('id') ?? newId(prefix, +c.now);
  await writeDefinition(fs, file, type, { ...base, [field]: key, id });
  return { kind, id, key, file };
}

/** Defaults, the template, the given fields, then provenance; use cases, test cases and fixtures get a status. */
function baseFields({ input, life, ai, bundle }: Ctx, kind: keyof typeof KINDS): Record<string, unknown> {
  const tpl = bundle.templates.find((t) => t.name === input.template && t.kind === kind) ?? {
    data: input.template ? BUILTIN[kind]?.[input.template] : undefined,
  };
  if (input.template && !tpl.data) fail('NOT_FOUND', `Template ${kind}.${input.template} not found`);
  const base: Record<string, unknown> = { ...DEFAULTS[kind], ...tpl.data, ...input.fields, ...life, ...ai };
  if (['use-case', 'test-case', 'fixture'].includes(kind)) base.status = input.ready ? 'ready' : 'draft';
  return base;
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
  const uc = bundle.useCases.find((u) => match(u.data));
  const targets: [FileType, (Approvable & { version?: string }) | undefined][] = [
    ['test-case', bundle.testCases.find((t) => match(t.data))],
    ['fixture', bundle.fixtures.find((f) => match(f.data))],
    ['use-case', uc],
  ];
  for (const [type, item] of targets) {
    if (!item) continue;
    // test cases and fixtures carry their version (tcv/fxv); a use case's is its content hash
    const v = item.version ?? (await useCaseVersion(uc!.data));
    const approved = { status: 'ready', approved_by: approver, approved_version: v };
    await writeDefinition(fs, item.file, type, { ...item.data, ...approved });
    return { file: item.file, version: v };
  }
  // features, environments, releases and plans have no status or version: approval records the reviewer
  const named = (d: Record<string, unknown>) =>
    match({ id: d.id as string, key: String(d.key ?? d.name ?? d.version) });
  const { features, environments, releases, plans, sharedSteps } = bundle;
  const other = {
    ...{ feature: features, environment: environments, release: releases, plan: plans },
    'shared-step': sharedSteps,
  };
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
  // loaded steps carry the steps of shared steps: the file keeps the `use` they came from
  const steps = type === 'test-case' && Array.isArray(data.steps) ? collapseSteps(data.steps) : data.steps;
  const res = FILE_TYPES[type].safeParse(steps ? { ...data, steps } : data);
  if (!res.success) {
    const details = zodProblems(path, FILE_TYPES[type], res.error);
    const message = `Invalid ${type}: ${details.map((d) => `${d.path} ${d.message}`).join('; ')}`;
    throw new BundleError('INVALID_INPUT', message, details);
  }
  // a file keeps the schema ref of its first line; a new one takes the ref of project.toml (`iw update` sets both)
  const head = async (p: string) => {
    const bytes = await fs.read(p);
    return bytes ? new TextDecoder().decode(bytes.subarray(0, 200)) : undefined;
  };
  const ref = schemaRefOf(await head(path)) ?? schemaRefOf(await head('project.toml'));
  await fs.write(path, formatToml(type, res.data as Record<string, unknown>, ref));
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
