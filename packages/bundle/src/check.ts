/**
 * Bundle checks (docs/spec/cli.md#iw-check). CONTRACT: signatures frozen; implementation T-102.
 */
import { type KeyKind, nextCriterionKey, nextKey } from './ids.js';
import { loadDetailed, type SeenFile, walk } from './load.js';
import { type Priority, SecretRef } from './schema/common.js';
import type { FileType } from './schema/definitions.js';
import { formatToml, formatTomlBody } from './toml.js';
import type { Bundle, BundleFs, Problem } from './types.js';
import { TRANSLATABLE_FIELDS as TF, translationSourceHash, useCaseVersion } from './versions.js';
import { slugify } from './write.js';

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
    await fix(fs, loaded.bundle, loaded.files, deps, result);
    if (result.changed.length) loaded = await loadDetailed(fs);
  }
  const problems = [...loaded.problems];
  if (loaded.bundle) problems.push(...(await semanticChecks(loaded.bundle, deps)));
  problems.push(...(await scanBundleSecrets(fs)));
  for (const f of loaded.files) {
    const canonical = canonicalText(f);
    if (canonical === null || canonical === f.text) continue;
    const hint =
      f.type === 'template' && f.text.startsWith('#:schema') ? ' Templates have no #:schema line.' : '';
    const message = `Not in canonical form; run iw fmt.${hint}`;
    problems.push({ severity: 'warning', code: 'non-canonical', file: f.path, message });
  }
  result.files = loaded.files.length;
  result.problems = problems;
  result.errors = problems.filter((p) => p.severity === 'error').length;
  result.warnings = problems.length - result.errors;
  return result;
}

function canonicalText(f: SeenFile, data = f.raw): string | null {
  if (!f.valid || !data || f.type === 'data') return null;
  if (f.type !== 'template') return formatToml(f.type, data);
  return formatTomlBody(f.path.split('/').pop()!.split('.')[0] as FileType, data);
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
  const out: Problem[] = [];
  const found = (n: number, what: string) => {
    const message = `Possible secret (${what}); use a reference such as env:NAME`;
    out.push({ severity: 'error', code: 'secret', file, path: `line ${n}`, message });
  };
  const lines = text.split('\n');
  const header = file.endsWith('.csv') ? lines[0]!.split(',').map((h) => h.trim()) : [];
  for (const [i, l] of lines.entries()) {
    for (const [what, re] of TOKENS) if (re.test(l)) found(i + 1, what);
    for (const m of l.matchAll(ASSIGN)) if (suspicious(m[1]!, m[2]!)) found(i + 1, `value of "${m[1]}"`);
    for (const m of l.matchAll(BARE))
      if (/\d/.test(m[2]!) && !/^[A-Z]+-\d/.test(m[2]!) && suspicious(m[1]!, m[2]!))
        found(i + 1, `value of "${m[1]}"`);
    if (i > 0)
      for (const [c, v] of l.split(',').entries())
        if (suspicious(header[c] ?? '', v.trim())) found(i + 1, `column "${header[c]}"`);
  }
  return out;
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
const literals = (s: unknown) =>
  typeof s === 'string' ? [...s.matchAll(/"([^"\n]+)"|「([^」\n]+)」/g)].map((m) => m[1] ?? m[2]!) : [];
type Life = { origin?: string; status?: string; approved_by?: string; approved_version?: string };

async function semanticChecks(b: Bundle, deps: CheckDeps): Promise<Problem[]> {
  const out: Problem[] = [];
  const add = (severity: Problem['severity'], code: string, file: string, message: string, path?: string) =>
    out.push({ severity, code, file, message, ...(path ? { path } : {}) });
  const err = (code: string, file: string, msg: string, path?: string) => add('error', code, file, msg, path);
  const p = b.project.data;
  const last = (f: string, up = 0) => f.split('/').at(-1 - up)!;

  // IDs, keys and names
  type Row = readonly [kind: string, id: string, key: string, file: string, name: string];
  const items: Row[] = [
    ['project', p.id, p.key, b.project.file, ''],
    ...b.environments.map((x) => ['environment', x.data.id, x.data.name, x.file, last(x.file)] as const),
    ...b.releases.map((x) => ['release', x.data.id, x.data.version, x.file, last(x.file)] as const),
    ...b.features.map((x) => ['feature', x.data.id, x.data.key, x.file, last(x.file, 1)] as const),
    ...b.useCases.map((x) => ['use case', x.data.id, x.data.key, x.file, last(x.file, 1)] as const),
    ...b.testCases.map((x) => ['test case', x.data.id, x.data.key, x.file, last(x.file)] as const),
    ...b.fixtures.map((x) => ['fixture', x.data.id, x.data.key, x.file, last(x.file, 1)] as const),
    ...b.plans.map((x) => ['plan', x.data.id, x.data.key, x.file, last(x.file)] as const),
    ...b.useCases.flatMap((x) => x.data.criteria.map((c) => ['criterion', c.id, c.key, x.file, ''] as const)),
  ];
  const ids = new Map<string, string>();
  const keys = new Map<string, string>();
  for (const [kind, id, key, file, name] of items) {
    const k = `${kind} ${key}`;
    if (ids.has(id)) err('duplicate-id', file, `ID ${id} is also used in ${ids.get(id)}`);
    if (keys.has(k))
      err('duplicate-key', file, `Duplicate ${k} (also in ${keys.get(k)}); iw check --fix renumbers it`);
    ids.set(id, file);
    keys.set(k, file);
    const exact = kind === 'environment' || kind === 'release';
    const want = exact ? `${key}.toml` : `${key}-`;
    const msg = `Name should ${exact ? 'be' : 'start with'} ${want} (iw check --fix)`;
    if (name && (exact ? name !== want : !name.startsWith(want))) add('warning', 'path-mismatch', file, msg);
  }
  for (const uc of b.useCases)
    for (const [i, c] of uc.data.criteria.entries()) {
      const want = `AC-${uc.data.key.slice(3)}.`;
      if (!c.key.startsWith(want))
        err('invalid-key', uc.file, `${c.key} must be ${want}n`, `criteria[${i}].key`);
    }

  // references (docs/spec/concepts.md#invariants)
  const envs = new Set(b.environments.map((e) => e.data.name));
  const rels = new Set(b.releases.map((r) => r.data.version));
  const fxs = new Map(b.fixtures.map((f) => [f.data.key, f.data]));
  const acs = new Map(b.useCases.flatMap((u) => u.data.criteria.map((c) => [c.key, [c, u.data]] as const)));
  const plans = new Set(b.plans.map((x) => x.data.key));
  const tcs = new Set(b.testCases.map((t) => t.data.key));
  const ref = (ok: boolean, file: string, path: string, what: string) =>
    ok || err('unresolved-ref', file, `${what} does not resolve`, path);
  const pf = b.project.file;
  if (p.default_environment)
    ref(envs.has(p.default_environment), pf, 'default_environment', p.default_environment);
  if (p.current_release) ref(rels.has(p.current_release), pf, 'current_release', p.current_release);
  if (p.store?.mode === 'workspace') err('unsupported', pf, 'store mode "workspace" is v0.2', 'store.mode');
  for (const r of b.releases) if (r.data.plan) ref(plans.has(r.data.plan), r.file, 'plan', r.data.plan);
  for (const e of b.environments)
    for (const [i, a] of (e.data.accounts ?? []).entries())
      ref(fxs.get(a)?.kind === 'account', e.file, `accounts[${i}]`, `Account fixture ${a}`);
  for (const { file, data: pl } of b.plans) {
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
  for (const { file, data: d } of b.fixtures) {
    const files = d.files?.length ? '' : 'files';
    const need =
      d.kind === 'account'
        ? !d.account && '[account]'
        : files || (d.kind === 'dataset' && !d.row_key && 'row_key');
    if (need) err('invalid-value', file, `A ${d.kind} fixture needs ${need}`);
  }
  for (const { file, data: d } of b.testCases) {
    let top: Priority | undefined;
    for (const [i, k] of d.covers.entries()) {
      const [c, uc] = acs.get(k) ?? [];
      ref(!!c && c.status !== 'retired', file, `covers[${i}]`, `Criterion ${k}`);
      if (uc && (!top || RANK[uc.priority] < RANK[top])) top = uc.priority;
    }
    for (const [i, fr] of (d.fixtures ?? []).entries()) {
      const fx = fxs.get(fr.ref);
      const hook = fx?.hook ?? 'seed';
      ref(!!fx, file, `fixtures[${i}].ref`, `Fixture ${fr.ref}`);
      const hooked = b.environments.some((e) => e.data.hooks?.[hook]);
      if (fx?.kind === 'seed' && fr.apply === 'before_run')
        ref(hooked, file, `fixtures[${i}]`, `Hook "${hook}"`);
    }
    if (d.priority && top && RANK[d.priority] > RANK[top])
      err(
        'priority-too-low',
        file,
        `Priority ${d.priority} is lower than ${top} of the covered use cases`,
        'priority',
      );
  }

  // AI-written items are ready only with a human approval of their current version
  const ai = async (d: Life & { ai?: unknown }, file: string, version: () => Promise<string>) => {
    if (d.origin !== 'ai') return;
    if (!d.ai) err('missing-ai-meta', file, 'origin "ai" requires an [ai] table', 'ai');
    const message = 'AI-written item is ready without approval of its current version; run iw approve';
    if (d.status === 'ready' && (!d.approved_by || d.approved_version !== (await version())))
      err('ai-not-approved', file, message, 'status');
  };
  for (const t of b.testCases) await ai(t.data, t.file, async () => t.version);
  for (const f of b.fixtures) await ai(f.data, f.file, async () => f.version);
  for (const u of b.useCases) await ai(u.data, u.file, () => useCaseVersion(u.data));
  // they decide no verdict and have no status: an unreviewed AI-written one is only a warning
  for (const x of [...b.features, ...b.environments, ...b.releases, ...b.plans]) {
    const d: Life & { ai?: unknown } = x.data;
    if (d.origin !== 'ai') continue;
    if (!d.ai) err('missing-ai-meta', x.file, 'origin "ai" requires an [ai] table', 'ai');
    const message = 'AI-written item has not been reviewed by a human; run iw approve';
    if (!d.approved_by) add('warning', 'ai-not-approved', x.file, message, 'approved_by');
  }
  for (const u of b.useCases)
    for (const [i, c] of u.data.criteria.entries()) {
      if (c.origin !== 'ai') continue;
      if (!c.ai) err('missing-ai-meta', u.file, 'origin "ai" requires an [ai] table', `criteria[${i}].ai`);
      if ((c.status ?? 'ready') === 'ready' && !c.approved_by)
        err(
          'ai-not-approved',
          u.file,
          'AI-proposed criterion is ready without approval; run iw approve',
          `criteria[${i}].status`,
        );
    }

  // translations: stale source hash, unexpected locale, dropped literals
  const locales = new Set<string>(p.locales.filter((l) => l !== p.source_locale));
  const i18n = async (file: string, src: Record<string, unknown>, fields: readonly string[], at = '') => {
    const hash = await translationSourceHash(src, fields);
    const warn = (code: string, msg: string, loc: string) =>
      add('warning', code, file, msg, `${at}i18n.${loc}`);
    for (const [loc, tr] of Object.entries((src.i18n ?? {}) as Record<string, Record<string, unknown>>)) {
      if (!locales.has(loc))
        warn('unexpected-locale', `${loc} is not a translation locale of the project`, loc);
      if (tr.source_hash !== hash)
        warn('stale-translation', 'Translation is outdated: the source changed', loc);
      for (const f of fields)
        for (const lit of typeof tr[f] === 'string' ? literals(src[f]) : [])
          if (!(tr[f] as string).includes(lit))
            warn('missing-literal', `Translation of ${f} lacks "${lit}"`, loc);
    }
  };
  for (const x of b.features) await i18n(x.file, x.data, TF.feature);
  for (const x of b.environments) await i18n(x.file, x.data, TF.environment);
  for (const x of b.fixtures) await i18n(x.file, x.data, TF.fixture);
  for (const x of b.releases) await i18n(x.file, x.data, TF.release);
  for (const x of b.plans) await i18n(x.file, x.data, TF.plan);
  for (const x of b.useCases) {
    await i18n(x.file, x.data, TF['use-case']);
    for (const [i, c] of x.data.criteria.entries()) await i18n(x.file, c, TF.criterion, `criteria[${i}].`);
  }
  for (const x of b.testCases) {
    await i18n(x.file, x.data, TF['test-case']);
    for (const [i, s] of x.data.steps.entries()) await i18n(x.file, s, TF.step, `steps[${i}].`);
  }
  const fetch = 'Blob is not available locally; run iw fixture fetch or iw sync';
  for (const df of b.fixtures.flatMap((f) => f.dataFiles))
    if (df.pointer && deps.hasBlob && !(await deps.hasBlob(df.pointer.sha256)))
      add('warning', 'missing-blob', df.file, fetch);
  return out;
}

// ---------- --fix ----------
type Item = { file: string; data: { id: string; key: string; title: string } };
const dirOf = (f: string) => f.slice(0, f.lastIndexOf('/'));

/** Renumber duplicate keys, rename paths whose key part is wrong, and canonicalize every valid file. */
async function fix(fs: BundleFs, b: Bundle, files: SeenFile[], deps: CheckDeps, res: CheckResult) {
  const groups: [KeyKind, Item[]][] = [
    ['feature', b.features],
    ['useCase', b.useCases],
  ];
  groups.push(['testCase', b.testCases], ['fixture', b.fixtures], ['plan', b.plans]);
  const seen = new Set([...(deps.knownKeys ?? []), ...groups.flatMap(([, xs]) => xs.map((x) => x.data.key))]);
  for (const uc of b.useCases) for (const c of uc.data.criteria) seen.add(c.key);
  const data = new Map<string, Record<string, unknown>>(); // file → data to write
  const get = <T>(file: string, d: T) => (data.get(file) ?? { ...d }) as T & Record<string, unknown>;
  const renumber = (from: string, to: string, id: string) =>
    seen.add(to) && res.renumbered.push({ from, to, id });

  for (const [kind, items] of groups)
    for (const key of new Set(items.map((x) => x.data.key))) {
      const dups = items.filter((x) => x.data.key === key).sort((x, y) => (x.data.id < y.data.id ? -1 : 1));
      const onBranch = await Promise.all(dups.map((x) => deps.onDefaultBranch?.(x.data.id)));
      const keep = Math.max(0, onBranch.indexOf(true));
      for (const it of dups.filter((_, i) => i !== keep)) {
        const to = nextKey(kind, seen);
        renumber(key, to, it.data.id);
        const d: Record<string, unknown> = { ...get(it.file, it.data), key: to };
        data.set(it.file, d);
        // a use case's criteria follow, and so do the covers of test cases in its directory
        const [a, z] = [`AC-${key.slice(3)}.`, `AC-${to.slice(3)}.`];
        const map = new Map<string, string>();
        if (kind === 'useCase')
          d.criteria = (d.criteria as { id: string; key: string }[]).map((c) => {
            if (!c.key.startsWith(a)) return c;
            map.set(c.key, z + c.key.slice(a.length));
            renumber(c.key, z + c.key.slice(a.length), c.id);
            return { ...c, key: z + c.key.slice(a.length) };
          });
        for (const t of map.size ? b.testCases.filter((x) => dirOf(x.file) === dirOf(it.file)) : []) {
          const td = get(t.file, t.data);
          data.set(t.file, { ...td, covers: td.covers.map((k) => map.get(k) ?? k) });
        }
        // @TC-n tags in the automated tests, when the caller can read them
        const auto = kind === 'testCase' ? ((d.automation as { files?: string[] })?.files ?? []) : [];
        for (const f of deps.repo ? auto : []) {
          const text = await deps.repo!.read(f);
          const next = text?.replace(new RegExp(`@${key}(?![0-9])`, 'g'), `@${to}`);
          if (text && next !== text) await deps.repo!.write(f, next!);
        }
      }
    }
  // criteria numbered for another use case, or duplicated inside one → the next free number.
  // Duplicates keep the one on the default branch (else the smaller ID); covers follow the renumbered one.
  const moved: { from: string; to: string; id: string }[] = [];
  for (const uc of b.useCases) {
    const d = get(uc.file, uc.data);
    const own = `AC-${d.key.slice(3)}.`;
    const keeper = new Map<string, string>(); // key → ID that keeps it
    for (const key of new Set(d.criteria.map((c) => c.key).filter((k) => k.startsWith(own)))) {
      const dups = d.criteria.filter((c) => c.key === key).sort((x, y) => (x.id < y.id ? -1 : 1));
      const onBranch = await Promise.all(dups.map((c) => deps.onDefaultBranch?.(c.id)));
      keeper.set(key, dups[Math.max(0, onBranch.indexOf(true))]!.id);
    }
    const used = new Set(keeper.keys());
    const criteria = d.criteria.map((c) => {
      if (keeper.get(c.key) === c.id) return c;
      const to = nextCriterionKey(d.key, [...seen, ...used]);
      used.add(to);
      renumber(c.key, to, c.id);
      moved.push({ from: c.key, to, id: c.id });
      return { ...c, key: to };
    });
    if (criteria.some((c, i) => c !== d.criteria[i])) data.set(uc.file, { ...d, criteria });
  }
  // a key that no longer exists anywhere moves in every test case; a key that is still taken moves only
  // in test cases not on the default branch (without git: created after the renumbered criterion)
  const left = new Set(b.useCases.flatMap((u) => get(u.file, u.data).criteria.map((c) => c.key)));
  for (const t of moved.length ? b.testCases : []) {
    const td = get(t.file, t.data);
    const branch = deps.onDefaultBranch ? !(await deps.onDefaultBranch(t.data.id)) : undefined;
    const covers = td.covers.map((k) => {
      const m = moved.find((x) => x.from === k && (!left.has(k) || (branch ?? t.data.id > x.id)));
      return m?.to ?? k;
    });
    if (covers.some((k, i) => k !== td.covers[i])) data.set(t.file, { ...td, covers });
  }

  // rename the key part of directories and files (original path → new last segment)
  const renamed = new Map<string, string>();
  for (const [kind, items] of groups)
    for (const it of items) {
      const path = kind === 'testCase' || kind === 'plan' ? it.file : dirOf(it.file);
      const key = (data.get(it.file)?.key as string | undefined) ?? it.data.key;
      const [last, ext] = [path.split('/').at(-1)!, path.endsWith('.toml') ? '.toml' : ''];
      const slug = /^[A-Z]+-\d+(-.+)$/.exec(last.slice(0, last.length - ext.length))?.[1];
      if (!last.startsWith(`${key}-`))
        renamed.set(path, `${key}${slug ?? `-${slugify(it.data.title)}`}${ext}`);
    }
  for (const { file, data: d } of [...b.environments, ...b.releases]) {
    const name = `${'name' in d ? d.name : d.version}.toml`;
    if (!file.endsWith(`/${name}`)) renamed.set(file, name);
  }
  const finalPath = (p: string) => {
    const seg = p.split('/');
    return seg.map((s, i) => renamed.get(seg.slice(0, i + 1).join('/')) ?? s).join('/');
  };
  for (const f of files) {
    const target = finalPath(f.path);
    const canonical = canonicalText(f, data.get(f.path) ?? f.raw);
    const moved = target !== f.path;
    const out =
      canonical === null ? moved && (await fs.read(f.path)) : (canonical !== f.text || moved) && canonical;
    if (!out) continue;
    await fs.write(target, out);
    if (moved) await fs.remove(f.path);
    res.changed.push(target);
  }
  // other files inside renamed directories (README.md, unknown files)
  for (const dir of [...renamed.keys()].filter((k) => !files.some((f) => f.path === k))) {
    for (const p of await walk(fs, dir)) {
      const bytes = await fs.read(p);
      if (bytes) await fs.write(finalPath(p), bytes);
    }
    await fs.remove(dir);
  }
}
