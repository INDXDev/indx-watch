/**
 * Bundle checks (docs/spec/cli.md#iw-check). CONTRACT: signatures frozen; implementation T-102.
 */
import { canonicalText, fix } from './check-fix.js';
import { loadDetailed, walk } from './load.js';
import { type Priority, SecretRef } from './schema/common.js';
import type { Bundle, BundleFs, Problem } from './types.js';
import { TRANSLATABLE_FIELDS as TF, translationSourceHash, useCaseVersion } from './versions.js';

export interface CheckOptions {
  /** canonicalize, fix the key part of names, renumber duplicate keys (slugs are cosmetic and kept) */
  fix?: boolean;
  /** keys known from the result store (retired keys must not be reused) */
  knownKeys?: Iterable<string>;
}

/**
 * Optional helpers a caller may pass in the same options object (read at run time, so the frozen
 * CheckOptions stays unchanged). Without them `check` works on the BundleFs alone.
 */
export interface CheckDeps extends CheckOptions {
  /** true when an item with this ID exists on the default branch (git): the other duplicate is renumbered */
  onDefaultBranch?: (id: string) => Promise<boolean>;
  /** repository files as named in [automation].files, for rewriting @TC-n tags when renumbering */
  repo?: { read(path: string): Promise<string | null>; write(path: string, text: string): Promise<void> };
  /** whether a blob is available (local replica or cache/blobs/); a missing pointer blob is a warning */
  hasBlob?: (sha256: string) => Promise<boolean>;
}

export interface CheckResult {
  files: number;
  errors: number;
  warnings: number;
  problems: Problem[];
  /** files rewritten by fix */
  changed: string[];
  renumbered: { from: string; to: string; id: string }[];
}

export async function checkBundle(fs: BundleFs, opts?: CheckOptions): Promise<CheckResult> {
  const deps = (opts ?? {}) as CheckDeps;
  const result: CheckResult = { files: 0, errors: 0, warnings: 0, problems: [], changed: [], renumbered: [] };
  let loaded = await loadDetailed(fs);
  if (deps.fix && loaded.bundle) {
    await fix({ fs, b: loaded.bundle, files: loaded.files, deps, res: result });
    if (result.changed.length) loaded = await loadDetailed(fs);
  }
  const problems = [...loaded.problems];
  if (loaded.bundle) problems.push(...(await semanticChecks(loaded.bundle, deps)));
  problems.push(...(await scanBundleSecrets(fs)));
  for (const f of loaded.files) {
    const canonical = canonicalText(f);
    if (canonical === null || canonical === f.text) continue;
    const schema = f.type === 'template' && f.text.startsWith('#:schema');
    const message = `Not in canonical form; run iw fmt.${schema ? ' Templates have no #:schema line.' : ''}`;
    problems.push({ severity: 'warning', code: 'non-canonical', file: f.path, message });
  }
  result.files = loaded.files.length;
  result.problems = problems;
  result.errors = problems.filter((p) => p.severity === 'error').length;
  result.warnings = problems.length - result.errors;
  return result;
}

// ---------- secrets ----------
const TOKENS: [string, RegExp][] = [
  ['AWS access key ID', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----/],
  ['password in a URL', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:(?!\{\{)[^\s/@]+@/i],
  ['JWT', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI API key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
  ['INDX Watch signing key (IW_SIGNING_KEY)', /\biwsk1:[A-Za-z0-9._-]{1,64}:[A-Za-z0-9_-]{40,}/],
  ['INDX Watch secrets key (IW_SECRETS_KEY)', /\biwsec1:[A-Za-z0-9_-]{43}/],
];
const SENSITIVE =
  /(passw|pwd|passphrase|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential)/i;
const ALWAYS = /(passw|pwd|passphrase)/i;
const ASSIGN = /["']?([A-Za-z0-9_.-]+)["']?\s*[:=]\s*(?:"{3}|'{3}|["'])([^"'\n]*)["']/g;
/** unquoted values: `password: hunter22`, `"pin": 12345678`, .netrc `password Hunter2Prod` (needs a digit) */
const BARE = /([A-Za-z0-9_.-]+)["']?(?:[ \t]*[:=][ \t]*|[ \t]+)([^\s"'`,;{}()[\]<>]{6,})/g;

function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.values()].reduce((h, n) => h - (n / s.length) * Math.log2(n / s.length), 0);
}

/** A value in a field named like a secret: any literal password, or a high-entropy token. */
function suspicious(name: string, value: string): boolean {
  if (!SENSITIVE.test(name) || !value || SecretRef.safeParse(value).success || /^\{\{.*\}\}$/.test(value))
    return false;
  return ALWAYS.test(name) || (value.length >= 16 && entropy(value) >= 3.5);
}

/** Secret scan of one file's text (docs/spec/security.md#secrets). Messages never contain the value. */
export function scanSecrets(file: string, text: string): Problem[] {
  const lines = text.split('\n');
  const header = file.endsWith('.csv') ? lines[0]!.split(',').map((h) => h.trim()) : [];
  return lines.flatMap((l, i) =>
    lineSecrets(l, i > 0 ? header : []).map((what): Problem => {
      const message = `Possible secret (${what}); use a reference such as env:NAME`;
      return { severity: 'error', code: 'secret', file, path: `line ${i + 1}`, message };
    }),
  );
}

/** What looks like a secret on one line: token shapes, values of sensitive names, sensitive CSV columns. */
function lineSecrets(l: string, header: string[]): string[] {
  const value = (m: RegExpMatchArray) => `value of "${m[1]}"`;
  const column = (v: string, c: number) =>
    suspicious(header[c] ?? '', v.trim()) ? [`column "${header[c]}"`] : [];
  const bare = (m: RegExpMatchArray) => /\d/.test(m[2]!) && !/^[A-Z]+-\d/.test(m[2]!);
  return [
    ...TOKENS.filter(([, re]) => re.test(l)).map(([what]) => what),
    ...[...l.matchAll(ASSIGN)].filter((m) => suspicious(m[1]!, m[2]!)).map(value),
    ...[...l.matchAll(BARE)].filter((m) => bare(m) && suspicious(m[1]!, m[2]!)).map(value),
    ...l.split(',').flatMap(column),
  ];
}

const dec = new TextDecoder();
/**
 * Secret scan of every file under the bundle (what a snapshot or an export packs: unknown files, README.md and
 * dot files too), not only the files the format recognises. Binary files (with a NUL byte) are skipped.
 */
export async function scanBundleSecrets(fs: BundleFs): Promise<Problem[]> {
  const out: Problem[] = [];
  for (const p of await walk(fs, '')) {
    const bytes = await fs.read(p);
    if (bytes && !bytes.includes(0)) out.push(...scanSecrets(p, dec.decode(bytes)));
  }
  return out;
}

// ---------- semantic checks ----------
const RANK: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
/** A translatable value as one text (`checks` is a list). */
const textOf = (v: unknown) => (Array.isArray(v) ? v.join('\n') : v);
const literals = (v: unknown, s = textOf(v)) =>
  typeof s === 'string' ? [...s.matchAll(/"([^"\n]+)"|「([^」\n]+)」/g)].map((m) => m[1] ?? m[2]!) : [];
type Life = Partial<Record<'origin' | 'status' | 'approved_by' | 'approved_version' | 'ai', unknown>>;
type Report = (code: string, file: string, message: string, path?: string) => void;
/** What every rule family reports to: problems, unresolved references (`ref`) and the reference targets. */
type Ctx = ReturnType<typeof targets> & { b: Bundle; err: Report; warn: Report; ref: Ref };
type Ref = (ok: boolean, file: string, path: string, what: string) => unknown;
function sink(out: Problem[], severity: Problem['severity']): Report {
  return (code, file, message, path) =>
    out.push({ severity, code, file, message, ...(path ? { path } : {}) });
}

async function semanticChecks(b: Bundle, deps: CheckDeps): Promise<Problem[]> {
  const out: Problem[] = [];
  const err = sink(out, 'error');
  const ref: Ref = (ok, f, at, what) => ok || err('unresolved-ref', f, `${what} does not resolve`, at);
  const c: Ctx = { ...targets(b), b, err, warn: sink(out, 'warning'), ref };
  checkNames(c);
  checkProjectRefs(c);
  for (const pl of b.plans) checkPlan(c, pl);
  checkFixtures(c);
  for (const t of b.testCases) checkTestCase(c, t);
  await checkAi(c);
  await checkTranslations(c);
  const fetch = 'Blob is not available locally; run iw fixture fetch or iw sync';
  for (const df of b.fixtures.flatMap((f) => f.dataFiles))
    if (df.pointer && deps.hasBlob && !(await deps.hasBlob(df.pointer.sha256)))
      c.warn('missing-blob', df.file, fetch);
  return out;
}

/** IDs and keys are unique; names start with the key (environments and releases: are the name); AC-n.m in UC-n. */
function checkNames({ b, err, warn }: Ctx) {
  const last = (f: string, up = 0) => f.split('/').at(-1 - up)!;
  const rows = [
    ['project', b.project.data.id, b.project.data.key, b.project.file, ''] as const,
    ...b.environments.map((x) => ['environment', x.data.id, x.data.name, x.file, last(x.file)] as const),
    ...b.releases.map((x) => ['release', x.data.id, x.data.version, x.file, last(x.file)] as const),
    ...b.features.map((x) => ['feature', x.data.id, x.data.key, x.file, last(x.file, 1)] as const),
    ...b.useCases.map((x) => ['use case', x.data.id, x.data.key, x.file, last(x.file, 1)] as const),
    ...b.testCases.map((x) => ['test case', x.data.id, x.data.key, x.file, last(x.file)] as const),
    ...b.sharedSteps.map((x) => ['shared step', x.data.id, x.data.key, x.file, last(x.file)] as const),
    ...b.fixtures.map((x) => ['fixture', x.data.id, x.data.key, x.file, last(x.file, 1)] as const),
    ...b.plans.map((x) => ['plan', x.data.id, x.data.key, x.file, last(x.file)] as const),
    ...b.useCases.flatMap((x) => x.data.criteria.map((c) => ['criterion', c.id, c.key, x.file, ''] as const)),
  ];
  const ids = new Map<string, string>();
  const keys = new Map<string, string>();
  for (const [kind, id, key, file, name] of rows) {
    const k = `${kind} ${key}`;
    if (ids.has(id)) err('duplicate-id', file, `ID ${id} is also used in ${ids.get(id)}`);
    if (keys.has(k))
      err('duplicate-key', file, `Duplicate ${k} (also in ${keys.get(k)}); iw check --fix renumbers it`);
    ids.set(id, file);
    keys.set(k, file);
    const mismatch = nameMismatch(kind, key, name);
    if (mismatch) warn('path-mismatch', file, mismatch);
  }
  // criterion keys are numbered for their use case: AC-n.m inside UC-n
  for (const uc of b.useCases) {
    const want = `AC-${uc.data.key.slice(3)}.`;
    for (const [i, { key }] of uc.data.criteria.entries())
      if (!key.startsWith(want)) err('invalid-key', uc.file, `${key} must be ${want}n`, `criteria[${i}].key`);
  }
}

/** The path-mismatch message when a name does not carry its key, else false (also for rows without a name). */
function nameMismatch(kind: string, key: string, name: string): string | false {
  const exact = kind === 'environment' || kind === 'release';
  const want = exact ? `${key}.toml` : `${key}-`;
  const ok = !name || (exact ? name === want : name.startsWith(want));
  return !ok && `Name should ${exact ? 'be' : 'start with'} ${want} (iw check --fix)`;
}

/** Reference targets by key (docs/spec/concepts.md#invariants). */
function targets(b: Bundle) {
  return {
    envs: new Set(b.environments.map((e) => e.data.name)),
    rels: new Set(b.releases.map((r) => r.data.version)),
    fxs: new Map(b.fixtures.map((f) => [f.data.key, f.data])),
    acs: new Map(b.useCases.flatMap((u) => u.data.criteria.map((c) => [c.key, [c, u.data]] as const))),
    plans: new Set(b.plans.map((x) => x.data.key)),
    tcs: new Set(b.testCases.map((t) => t.data.key)),
  };
}

function checkProjectRefs({ b, ref, envs, rels, plans, fxs }: Ctx) {
  const [p, pf] = [b.project.data, b.project.file];
  if (p.default_environment)
    ref(envs.has(p.default_environment), pf, 'default_environment', p.default_environment);
  if (p.current_release) ref(rels.has(p.current_release), pf, 'current_release', p.current_release);
  for (const r of b.releases) if (r.data.plan) ref(plans.has(r.data.plan), r.file, 'plan', r.data.plan);
  for (const e of b.environments)
    for (const [i, a] of (e.data.accounts ?? []).entries())
      ref(fxs.get(a)?.kind === 'account', e.file, `accounts[${i}]`, `Account fixture ${a}`);
}

function checkPlan({ err, ref, envs, rels, tcs }: Ctx, { file, data: pl }: Bundle['plans'][number]) {
  if (pl.release) ref(rels.has(pl.release), file, 'release', pl.release);
  if (pl.environment) ref(envs.has(pl.environment), file, 'environment', pl.environment);
  const pairs = new Set<string>();
  for (const [i, it] of (pl.items ?? []).entries()) {
    ref(tcs.has(it.test_case), file, `items[${i}].test_case`, it.test_case);
    if (it.environment) ref(envs.has(it.environment), file, `items[${i}].environment`, it.environment);
    const pair = `${it.test_case} on ${it.environment ?? pl.environment ?? 'any environment'}`;
    if (pairs.has(pair)) err('duplicate-plan-item', file, `${pair} is planned twice`, `items[${i}]`);
    pairs.add(pair);
  }
}

function checkFixtures({ b, err }: Ctx) {
  for (const { file, data: d } of b.fixtures) {
    const other = !d.files?.length ? 'files' : d.kind === 'dataset' && !d.row_key && 'row_key';
    const need = d.kind === 'account' ? !d.account && '[account]' : other;
    if (need) err('invalid-value', file, `A ${d.kind} fixture needs ${need}`);
  }
}

function checkTestCase(c: Ctx, { file, data: d }: Bundle['testCases'][number]) {
  let top: Priority | undefined;
  for (const [i, k] of d.covers.entries()) {
    const [ac, uc] = c.acs.get(k) ?? [];
    c.ref(!!ac && ac.status !== 'retired', file, `covers[${i}]`, `Criterion ${k}`);
    if (uc && (!top || RANK[uc.priority] < RANK[top])) top = uc.priority;
  }
  for (const [i, fr] of (d.fixtures ?? []).entries()) {
    const fx = c.fxs.get(fr.ref);
    const hook = fx?.hook ?? 'seed';
    c.ref(!!fx, file, `fixtures[${i}].ref`, `Fixture ${fr.ref}`);
    const hooked = c.b.environments.some((e) => e.data.hooks?.[hook]);
    if (fx?.kind === 'seed' && fr.apply === 'before_run')
      c.ref(hooked, file, `fixtures[${i}]`, `Hook "${hook}"`);
  }
  const guide = 'A ready manual test case needs purpose and start (or start_note) to guide the tester';
  const manual = d.mode === 'manual' || d.mode === 'hybrid';
  if (manual && d.status === 'ready' && (!d.purpose || !(d.start || d.start_note)))
    c.warn('missing-guidance', file, guide, d.purpose ? 'start' : 'purpose');
  const msg = `Priority ${d.priority} is lower than ${top} of the covered use cases`;
  if (d.priority && top && RANK[d.priority] > RANK[top]) c.err('priority-too-low', file, msg, 'priority');
}

/** AI-written items are ready only with a human approval of their current version. */
async function checkAi(c: Ctx) {
  for (const t of c.b.testCases) await aiReady(c, t.data, t.file, async () => t.version);
  for (const f of c.b.fixtures) await aiReady(c, f.data, f.file, async () => f.version);
  for (const u of c.b.useCases) await aiReady(c, u.data, u.file, () => useCaseVersion(u.data));
  const reviewed = [...c.b.features, ...c.b.environments, ...c.b.releases, ...c.b.plans, ...c.b.sharedSteps];
  for (const x of reviewed) aiReviewed(c, x);
  for (const u of c.b.useCases) aiCriteria(c, u);
}

/** True when the item is AI-written; reports a missing [ai] table (`at` prefixes the path). */
function aiWritten({ err }: Ctx, d: Life, file: string, at = ''): boolean {
  const ai = d.origin === 'ai';
  if (ai && !d.ai) err('missing-ai-meta', file, 'origin "ai" requires an [ai] table', `${at}ai`);
  return ai;
}

/** Test cases, fixtures and use cases: ready needs an approval of the current version. */
async function aiReady(c: Ctx, d: Life, file: string, version: () => Promise<string>) {
  const message = 'AI-written item is ready without approval of its current version; run iw approve';
  if (!aiWritten(c, d, file) || d.status !== 'ready') return;
  if (!d.approved_by || d.approved_version !== (await version()))
    c.err('ai-not-approved', file, message, 'status');
}

/** Features, environments, releases and plans decide no verdict and have no status: an unreviewed one only warns. */
function aiReviewed(c: Ctx, { file, data: d }: { file: string; data: Life }) {
  const message = 'AI-written item has not been reviewed by a human; run iw approve';
  if (aiWritten(c, d, file) && !d.approved_by) c.warn('ai-not-approved', file, message, 'approved_by');
}

/** AI-proposed criteria count (status ready, the default) only once a human approves them. */
function aiCriteria(c: Ctx, { file, data }: Bundle['useCases'][number]) {
  const message = 'AI-proposed criterion is ready without approval; run iw approve';
  for (const [i, cr] of data.criteria.entries())
    if (aiWritten(c, cr, file, `criteria[${i}].`) && (cr.status ?? 'ready') === 'ready' && !cr.approved_by)
      c.err('ai-not-approved', file, message, `criteria[${i}].status`);
}

type Source = { file: string; src: Record<string, unknown>; fields: readonly string[]; at: string };

async function checkTranslations(c: Ctx) {
  const { b } = c;
  const locales = new Set<string>(b.project.data.locales.filter((l) => l !== b.project.data.source_locale));
  const i18n = (file: string, src: Record<string, unknown>, fields: readonly string[], at = '') =>
    checkTranslation(c, locales, { file, src, fields, at });
  for (const x of b.features) await i18n(x.file, x.data, TF.feature);
  for (const x of b.environments) await i18n(x.file, x.data, TF.environment);
  for (const x of b.fixtures) await i18n(x.file, x.data, TF.fixture);
  for (const x of b.releases) await i18n(x.file, x.data, TF.release);
  for (const x of b.plans) await i18n(x.file, x.data, TF.plan);
  for (const x of b.useCases) {
    await i18n(x.file, x.data, TF['use-case']);
    for (const [i, cr] of x.data.criteria.entries()) await i18n(x.file, cr, TF.criterion, `criteria[${i}].`);
  }
  for (const x of b.testCases) {
    await i18n(x.file, x.data, TF['test-case']);
    // steps from a shared step are checked in its own file
    for (const [i, s] of x.data.steps.entries()) if (!s.from) await i18n(x.file, s, TF.step, `steps[${i}].`);
    for (const [i, f] of (x.data.fixtures ?? []).entries())
      await i18n(x.file, f, TF['fixture-use'], `fixtures[${i}].`);
  }
  for (const x of b.sharedSteps) {
    await i18n(x.file, x.data, TF['shared-step']);
    for (const [i, s] of x.data.steps.entries()) if (!s.use) await i18n(x.file, s, TF.step, `steps[${i}].`);
  }
}

/** Translations: stale source hash, unexpected locale, dropped literals. */
async function checkTranslation(c: Ctx, locales: Set<string>, { file, src, fields, at }: Source) {
  const hash = await translationSourceHash(src, fields);
  for (const [loc, tr] of Object.entries((src.i18n ?? {}) as Record<string, Record<string, unknown>>)) {
    const warn = (code: string, msg: string) => c.warn(code, file, msg, `${at}i18n.${loc}`);
    if (!locales.has(loc)) warn('unexpected-locale', `${loc} is not a translation locale of the project`);
    if (tr.source_hash !== hash) warn('stale-translation', 'Translation is outdated: the source changed');
    for (const f of fields.filter(
      (f) => Array.isArray(tr[f]) && (tr[f] as []).length !== (src[f] as [])?.length,
    ))
      warn('translation-length', `Translation of ${f} needs one item per source item, in order`);
    for (const f of fields.filter((f) => typeof textOf(tr[f]) === 'string'))
      for (const lit of literals(src[f]).filter((l) => !(textOf(tr[f]) as string).includes(l)))
        warn('missing-literal', `Translation of ${f} lacks "${lit}"`);
  }
}
