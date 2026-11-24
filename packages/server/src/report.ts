/**
 * Report rendering (docs/spec/reports.md): one document model, rendered to Markdown or to a single
 * self-contained HTML file (inline CSS, no JavaScript, no external requests). Labels: report-labels.json.
 */
import { type Locale, TRANSLATABLE_FIELDS, translationSourceHash } from '@indx-watch/bundle';
import { localize, type Model, type ReportData } from '@indx-watch/core';
import { patchedLabel } from './build.js';
import type { RenderOptions } from './contract.js';
import LABELS from './report-labels.json' with { type: 'json' };
import STYLE from './report-style.json' with { type: 'json' };

type Text = { text: string; fallback?: string | undefined };
type Dict = Record<string, string>;
/** Localized content texts by key; attach to ReportData as `texts` (from reportTexts()). */
export interface ReportTexts {
  useCases: Record<string, Text>;
  criteria: Record<string, Text>;
  testCases: Record<string, Text>;
}

/** Titles and AC texts in `locale`: the source text when no current translation exists (`fallback` = its locale). */
export async function reportTexts(model: Model, locale: Locale): Promise<ReportTexts> {
  const tx = async (e: object, kind: keyof typeof TRANSLATABLE_FIELDS, field: string): Promise<Text> => {
    const currentSourceHash = await translationSourceHash(e as Dict, TRANSLATABLE_FIELDS[kind]);
    const opts = { sourceLocale: model.project.source_locale, currentSourceHash };
    const r = localize(e as Parameters<typeof localize>[0], field, locale, opts);
    return { text: r.text, fallback: r.locale !== locale ? r.locale : undefined };
  };
  const out: ReportTexts = { useCases: {}, criteria: {}, testCases: {} };
  for (const [k, u] of model.useCases) {
    out.useCases[k] = await tx(u.data, 'use-case', 'title');
    for (const c of u.criteria) out.criteria[c.data.key] = await tx(c.data, 'criterion', 'text');
  }
  for (const [k, t] of model.testCases) out.testCases[k] = await tx(t.data, 'test-case', 'title');
  return out;
}

/** CSS: design tokens (docs/design/tokens.css; dark on screen only, so prints stay light) + report styles. */
export const tokens = (list: string): Dict =>
  Object.fromEntries(list.split(',').map((p) => p.trim().split(' ') as [string, string]));
const vars = (list: string) => Object.entries(tokens(list)).map(([k, v]) => `--${k}:${v};`);
const CSS = [
  `:root{color-scheme:light;${vars(STYLE.light).join('')}}`,
  `@media screen and (prefers-color-scheme:dark){:root{color-scheme:dark;${vars(STYLE.dark).join('')}}}`,
  ...STYLE.css,
].join('\n');

/** the HTML file travels by mail and chat: no script, no requests, even without the server's header */
const CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

// ---------- document model ----------
type Kind = 'badge' | 'key' | 'code' | 'lit' | 'muted' | 'bold' | 'link' | 'img';
type Inline = string | Inline[] | { k: Kind; v: string; x?: string };
type Block =
  | { h: 1 | 2 | 3; c: Inline }
  | { p: Inline; muted?: boolean }
  | { meta: [string, Inline][] }
  | { verdict: string; title: string; detail: string }
  | { counts: { cls: string; n: number; label: string }[] }
  | { head: string[]; rows: Inline[][]; num?: number[] }
  | { box: Inline; items: Inline[] };

const ENTITY: Dict = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITY[c]!);
/** Markdown: no raw HTML from user text (renderers that allow HTML would run it) */
const md = (s: string) => s.replace(/[&<>]/g, (c) => ENTITY[c]!);
/** only web and relative links: a URL from a record must not run script (javascript:, data:) */
const safe = (url: string) => /^https?:\/\//i.test(url) || !/^[^/?#]*:/.test(url);
const mdUrl = (url: string) =>
  url.replace(/[()\s]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
/** a pull request link next to a GitHub Actions run URL */
export const prUrl = (ciUrl: string | undefined, pr: number) =>
  ciUrl?.includes('/actions/runs/') ? ciUrl.replace(/\/actions\/runs\/.*$/, `/pull/${pr}`) : undefined;
const LITERAL = /&quot;[^\n]+?&quot;|「[^」\n]+」/g;
type Fn = (v: string, x: string) => string;
/** [html, markdown] per inline kind; v = value, x = extra (badge text, link text, alt) */
const INLINE: Record<Kind, [Fn, Fn]> = {
  badge: [(v, x) => `<span class="badge s-${v}">${esc(x)}</span>`, (_v, x) => md(x)],
  key: [(v) => `<span class="key">${esc(v)}</span>`, md],
  code: [(v) => `<code>${esc(v)}</code>`, (v) => `\`${v}\``],
  lit: [(v) => esc(v).replace(LITERAL, (m) => `<span class="literal">${m}</span>`), md],
  muted: [(v) => `<span class="muted small">${esc(v)}</span>`, (v) => `_${md(v)}_`],
  bold: [(v) => `<strong>${esc(v)}</strong>`, (v) => `**${md(v)}**`],
  link: [
    (v, x) => (safe(v) ? `<a href="${esc(v)}">${esc(x)}</a>` : esc(x)),
    (v, x) => (safe(v) ? `[${md(x)}](${mdUrl(v)})` : md(x)),
  ],
  img: [(v, x) => `<img class="thumb" src="${esc(v)}" alt="${esc(x)}">`, (v, x) => `![${x}](${v})`],
};
function inline(x: Inline, html: boolean): string {
  if (typeof x === 'string') return html ? esc(x) : md(x);
  if (Array.isArray(x)) return x.map((y) => inline(y, html)).join('');
  return INLINE[x.k][html ? 0 : 1](x.v, x.x ?? '');
}

function toHtml(blocks: Block[], title: string, footer: string, locale: Locale, logo?: string): string {
  const h = (x: Inline) => inline(x, true);
  const all = <T>(xs: T[], f: (x: T, i: number) => string) => xs.map(f).join('');
  const body = blocks.map((b) => {
    if ('h' in b) return `<h${b.h}>${h(b.c)}</h${b.h}>`;
    if ('p' in b) return `<p${b.muted ? ' class="muted small"' : ''}>${h(b.p)}</p>`;
    if ('meta' in b)
      return `<dl class="meta">${all(b.meta, ([k, v]) => `<dt>${esc(k)}</dt><dd>${h(v)}</dd>`)}</dl>`;
    if ('verdict' in b) {
      const strong = `<strong>${esc(b.title)}</strong><p>${esc(b.detail)}</p>`;
      return `<div class="verdict s-${b.verdict}" role="status">${strong}</div>`;
    }
    const count = (c: { cls: string; n: number; label: string }) => `<b>${c.n}</b>${esc(c.label)}`;
    if ('counts' in b)
      return `<div class="counts">${all(b.counts, (c) => `<div class="count s-${c.cls}">${count(c)}</div>`)}</div>`;
    if ('box' in b)
      return `<div class="uc"><p>${h(b.box)}</p><ul>${all(b.items, (i) => `<li>${h(i)}</li>`)}</ul></div>`;
    const td = (tag: string, i: number, c: string) =>
      `<${tag}${b.num?.includes(i) ? ' class="num"' : ''}>${c}</${tag}>`;
    const rows = b.rows.map((r) => `<tr>${all(r, (c, i) => td('td', i, h(c)))}</tr>`).join('\n');
    const head = `<thead><tr>${all(b.head, (c, i) => td('th', i, esc(c)))}</tr></thead>`;
    return `<div class="wrap"><table>${head}<tbody>\n${rows}\n</tbody></table></div>`;
  });
  return `<!doctype html>\n<html lang="${locale}">\n<head>\n<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta http-equiv="Content-Security-Policy" content="${CSP}">\n<title>${esc(title)}</title>
<style>\n${CSS}\n</style>\n</head>\n<body>\n<main class="doc">\n${logo ? `<img src="${esc(logo)}" alt="" style="display:block;max-height:48px;max-width:200px;margin-bottom:12px">\n` : ''}${body.join('\n')}
<footer>${esc(footer)}</footer>\n</main>\n</body>\n</html>\n`;
}

function toMd(blocks: Block[], footer: string): string {
  const m = (x: Inline) => inline(x, false);
  const cell = (x: Inline) => m(x).replace(/\||\s*\n\s*/g, (c) => (c === '|' ? '\\|' : ' ')) || ' ';
  const out = blocks.map((b) => {
    if ('h' in b) return `${'#'.repeat(b.h)} ${m(b.c)}`;
    if ('p' in b) return b.muted ? `_${m(b.p)}_` : m(b.p);
    if ('meta' in b) return b.meta.map(([k, v]) => `- **${k}:** ${m(v)}`).join('\n');
    if ('verdict' in b) return `> **${b.title}** — ${b.detail}`;
    if ('counts' in b) return b.counts.map((c) => `${c.label}: **${c.n}**`).join(' · ');
    if ('box' in b) return [`**${m(b.box)}**`, ...b.items.map((i) => `- ${m(i)}`)].join('\n');
    const sep = b.head.map((_c, i) => (b.num?.includes(i) ? '---:' : '---'));
    const lines = [b.head, sep, ...b.rows.map((r) => r.map(cell))];
    return lines.map((r) => `| ${r.join(' | ')} |`).join('\n');
  });
  return `${out.join('\n\n')}\n\n---\n\n_${footer}_\n`;
}

// ---------- content (docs/spec/reports.md#contents) ----------
const shortRun = (id: string) => `${id.slice(0, 12)}…${id.slice(-4)}`;
const when = (at: string) => at.replace('T', ' ').replace(/:\d\d(\.\d+)?Z$/, '');
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const spaced = (xs: Inline[]): Inline[] => xs.flatMap((x, i) => (i ? [' ', x] : [x]));
const show = (v: unknown) => (Array.isArray(v) ? `[${v.join(', ')}]` : String(v));
const kv = (o: object) => Object.entries(o).map(([k, v]) => `${k} ${show(v)}`);
const IMAGES: Dict = LABELS.images;

/** Base64 data URI of a small PNG, JPEG or GIF (thumbnails embedded in the HTML report). */
async function dataUri(sha: string, getBlob: RenderOptions['getBlob']): Promise<string | undefined> {
  const b = await getBlob?.(sha);
  const type =
    b && b.byteLength <= 1_500_000 && IMAGES[[...b.slice(0, 4)].map((x) => x.toString(16)).join('')];
  if (!b || !type) return undefined;
  let bin = '';
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return `data:image/${type};base64,${btoa(bin)}`;
}

const key = (v: string): Inline => ({ k: 'key', v });
const code = (v: string): Inline => ({ k: 'code', v });
const COLS = ['pass', 'fail', 'needs_review', 'stale', 'untested', 'waived'] as const;
type Item = NonNullable<ReportData['planItems']>[number];
// ciPr: change request to core (reportData runs); shown when present
type Run = ReportData['runs'][number] & { ciPr?: number };

/** Labels, inline builders and lookups shared by the section renderers of one report. */
function context(data: ReportData, opts: RenderOptions) {
  const L: Dict = opts.locale === 'ja' ? LABELS.ja : LABELS.en;
  const t = (l: string, v: Record<string, number> = {}) =>
    (L[l] ?? l).replace(/\{(\w+)\}/g, (_m, k) => `${v[k]}`);
  const T = (keys: string) => keys.split(' ').map((k) => t(k));
  const icon = (s: string) => (LABELS.icons as Dict)[s] ?? '•';
  const label = (s: string, only = false) => (only ? icon(s) : `${icon(s)} ${t(s)}`);
  const CLASS: Dict = LABELS.classes;
  const badge = (s: string, only = false): Inline => ({ k: 'badge', v: CLASS[s] ?? s, x: label(s, only) });
  const texts = (data as ReportData & { texts?: ReportTexts }).texts;
  /** content text; the source text is marked with its locale when no translation is used */
  const tx = (x: Text | undefined, plain: string, lit = false): Inline => {
    const marker: Inline = x?.fallback ? [' ', { k: 'muted', v: `(${x.fallback})` }] : '';
    return x ? [lit ? { k: 'lit', v: x.text } : x.text, marker] : plain;
  };
  const tc = (k: string, title = ''): Inline => [key(k), ' ', tx(texts?.testCases[k], title)];
  const s = data.status;
  const tcStatus = (k: string) => s.testCases.find((x) => x.key === k)?.status ?? 'untested';
  /** a section heading with its block, or "none" when it has nothing to show */
  const none: Block = { p: t('none'), muted: true };
  const h2 = (h: string): Block => ({ h: 2, c: t(h) });
  const section = (h: string, empty: boolean, block: () => Block) => [h2(h), empty ? none : block()];
  const customer = data.audience === 'customer';
  return { data, opts, s, t, T, icon, badge, texts, tx, tc, tcStatus, h2, section, customer };
}
type Ctx = ReturnType<typeof context>;

/** 1–2. Header (title, scope, commit and cursor) and verdict (ready, not ready or ungated, with the gate checks) */
function header({ data, s, t, T, badge, customer }: Ctx, title: string): Block[] {
  const meta: [string, Inline][] = [];
  if (data.plan && data.scope.release) meta.push([t('release'), data.scope.release]);
  meta.push([t('scope'), data.scope.environment ?? t('all')]);
  meta.push([t('generated'), `${when(data.generatedAt)} UTC · ${t('by')} ${data.generatedBy}`]);
  if (data.bundleCommit) meta.push([t('commit'), code(data.bundleCommit)]);
  if (data.cursor) meta.push([t('cursor'), code(data.cursor)]);
  const kind = `${t('report')} · ${t(customer ? 'customer' : 'internal')}`;
  const top: Block[] = [{ p: kind, muted: true }, { h: 1, c: title }, { meta }];
  // 2. Verdict: ready, not ready or ungated, with the gate checks
  const [m, n] = [s.gate.checks.length, s.gate.checks.filter((c) => !c.passed).length];
  // nothing gated (no P0/P1 test case in scope): neutral, with what to do (docs/spec/concepts.md#gate)
  const ungated = s.gate.checks.some((c) => c.key === 'has_gated_tests' && !c.passed);
  const [v, msg] = ungated ? ['untested', 'ungated'] : n ? ['fail', 'notReady'] : ['pass', 'ready'];
  const detail = t(ungated ? 'ungatedDetail' : n ? 'failing' : 'passing', { n, m });
  const check = (c: (typeof s.gate.checks)[number]): Inline[] => {
    const items: Inline = c.items?.length ? [' ', { k: 'muted', v: c.items.join(', ') }] : '';
    return [[t(`gate.${c.key}`), items], code(c.actual), code(c.expected), badge(c.passed ? 'pass' : 'fail')];
  };
  const checks = { head: T('check now needed result'), num: [1, 2], rows: s.gate.checks.map(check) };
  return [...top, { verdict: v!, title: t(msg!), detail }, checks];
}

/** 3. Summary counts, overall and by priority */
function summary({ data, s, t, T, h2, icon }: Ctx): Block[] {
  const shown = [...COLS, ...(['blocked', 'skipped'] as const).filter((k) => s.counts[k] > 0)];
  const counts = shown.map((k) => ({ cls: k, n: s.counts[k], label: `${icon(k)} ${t(k)}` }));
  const cov = `${s.coverage.covered}/${s.coverage.total} (${Math.round(s.coverage.ratio * 100)}%)`;
  const prio = Object.entries(data.countsByPriority).filter(([, c]) => Object.keys(c).length > 0);
  const ac = (c: Record<string, number>) => `${c.ac_covered ?? 0}/${c.ac_total ?? 0}`;
  const rows = prio.map(([p, c]) => [p, ...COLS.map((k) => `${c[k] ?? 0}`), ac(c)]);
  const byPriority = { head: T(`priority ${COLS.join(' ')} acCoverage`), num: [1, 2, 3, 4, 5, 6, 7], rows };
  const coverage: Inline = [`${t('coverage')}: `, { k: 'bold', v: cov }];
  const a = data.automation;
  const mix =
    a && `${t('runBy')}: ${(['people', 'ci', 'agents'] as const).map((k) => `${t(k)} ${a[k]}`).join(' · ')}`;
  return [h2('summary'), { counts }, { p: coverage }, ...(mix ? [{ p: mix }] : []), byPriority];
}

/** 4. Use cases with their criteria and the latest status of each test case, or plan items grouped by assignee */
function items({ data, s, t, T, h2, tx, tc, texts, badge, tcStatus }: Ctx): Block[] {
  if (data.planItems) {
    const byWho = new Map<string, Item[]>();
    for (const i of data.planItems) byWho.set(i.assignee ?? '', [...(byWho.get(i.assignee ?? '') ?? []), i]);
    const row = (i: Item) => [tc(i.testCase), i.environment ?? '—', i.due ?? '—', badge(i.status)];
    const [B, head] = [[h2('planItems')], T('testCase env due status')];
    for (const [who, items] of byWho)
      B.push({ h: 3, c: who || t('unassigned') }, { head, rows: items.map(row) });
    return B;
  }
  const box = (u: (typeof s.useCases)[number]): Block => {
    const uc = tx(texts?.useCases[u.key], u.title);
    const head = [key(u.key), ' ', uc, ` · ${u.priority} · `, badge(u.status)];
    const items = u.criteria.map((c): Inline => {
      const tcs = c.testCases.map((k): Inline => [key(k), ' ', badge(tcStatus(k))]);
      const ac = tx(texts?.criteria[c.key], '', true);
      return [key(c.key), ' ', ac, ' — ', tcs.length ? spaced(tcs) : badge('uncovered')];
    });
    return { box: [head, u.done ? ` · ${t('done')}` : ''], items };
  };
  return [h2('useCases'), ...s.useCases.map(box)];
}

/** evidence cell: an embedded thumbnail, a link relative to `evidenceBase`, or the hash */
async function evidence(opts: RenderOptions & { evidenceBase?: string }, sha?: string): Promise<Inline> {
  const embed = opts.format === 'html' && opts.evidence === 'embed';
  const uri = sha && embed ? await dataUri(sha, opts.getBlob) : undefined;
  const short = sha?.slice(0, 12) ?? '';
  if (!sha || uri) return uri ? { k: 'img', v: uri, x: short } : '—';
  // links: relative to `evidenceBase` (iw report --evidence-base; change request: add it to RenderOptions)
  const base = opts.evidenceBase ?? (opts.format === 'html' ? 'api/blobs' : '');
  return base ? { k: 'link', v: `${base.replace(/\/+$/, '')}/${sha}`, x: short } : code(`sha256:${short}`);
}

/** 5. Failures and open items */
async function failures({ data, opts, T, tc, badge, section, customer }: Ctx): Promise<Block[]> {
  const ev = opts.evidence !== 'none';
  const failure = async (x: ReportData['failures'][number]): Promise<Inline[]> => [
    ...[tc(x.testCase, x.title), x.priority, badge(x.status), x.run ? code(shortRun(x.run)) : '—'],
    ...[x.step ? String(x.step) : '—', ...(customer ? [] : [x.note ?? ''])],
    ...(ev ? [await evidence(opts, x.evidence)] : []),
  ];
  const rows = await Promise.all(data.failures.map(failure));
  const head = T(`testCase priority status run step ${customer ? '' : 'note'} ${ev ? 'evidence' : ''}`);
  return section('failures', !rows.length, () => ({ head: head.filter(Boolean), num: [4], rows }));
}

/** 7. Coverage matrix: every criterion with the latest status of its test cases */
function matrix({ s, T, badge, tcStatus, section }: Ctx): Block[] {
  const latest = (tcs: string[]) =>
    tcs.length ? spaced(tcs.map((k) => badge(tcStatus(k), true))) : badge('uncovered', true);
  const rows = s.useCases.flatMap((u) =>
    u.criteria.map((c) => [u.key, c.key, c.testCases.join(', ') || '—', latest(c.testCases)]),
  );
  return section('matrix', false, () => ({ head: T('useCase criterion testCase latest'), rows }));
}

/** the CI cell of a run: its CI run and pull request links, or a dash */
const ciCell = ({ ciUrl, ciPr }: Run): Inline => {
  const url = ciPr && prUrl(ciUrl, ciPr);
  const pr: Inline[] = ciPr ? [url ? { k: 'link', v: url, x: `PR #${ciPr}` } : `PR #${ciPr}`] : [];
  const links: Inline[] = [...(ciUrl ? [{ k: 'link' as const, v: ciUrl, x: 'CI' }] : []), ...pr];
  return links.length ? spaced(links) : '—';
};

/** 8. Run log */
function runLog({ data, t, T, badge, section }: Ctx): Block[] {
  const ci = data.runs.some((r: Run) => r.ciUrl || r.ciPr);
  const run = (r: Run): Inline[] => {
    const [v = '', stale] = r.verdict.split(' (stale)');
    const verdict = stale === undefined ? badge(v) : spaced([badge(v), badge('stale')]);
    const build = r.commit ? code(r.commit.slice(0, 7)) : '—';
    const who = `${r.actor} (${r.actorKind})${r.unverified ? ` · ${t('unverified')}` : ''}`;
    const cells = [key(r.testCase), code(r.version), verdict, who, r.source, build];
    return [...cells, r.environment ?? '—', when(r.at), String(r.evidence), ...(ci ? [ciCell(r)] : [])];
  };
  const head = T(`testCase version verdict who source build env ended evidence${ci ? ' ci' : ''}`);
  return section('runLog', !data.runs.length, () => ({ head, num: [8], rows: data.runs.map(run) }));
}

/** 9. Appendix: status definitions, gate thresholds and decision policy */
function appendix({ data, t, h2, badge }: Ctx): Block[] {
  const statuses = { head: [t('status'), ''], rows: LABELS.statuses.map((k) => [badge(k), t(`def.${k}`)]) };
  const h3 = (h: string): Block => ({ h: 3, c: t(h) });
  const kvs = (o: object): Block => ({ p: code(kv(o).join(' · ')) });
  const head = [h2('appendix'), h3('statuses'), statuses];
  return [...head, h3('thresholds'), kvs(data.gateThresholds), h3('policy'), kvs(data.policy)];
}

/** Render a report (docs/spec/reports.md). Markdown or a single self-contained HTML file. */
export async function renderReport(data: ReportData, opts: RenderOptions): Promise<string> {
  const c = context(data, opts);
  const { t, T, section } = c;
  const subject = data.plan ? `${t('plan')} ${data.plan}` : `${t('release')} ${data.scope.release ?? '—'}`;
  const title = `${data.brand?.title ?? data.project.name} — ${subject}`;
  // a patched server always says so, even under a custom footer (docs/spec/reports.md#rendering-rules)
  const footer = [data.brand?.footer ?? t('footer'), patchedLabel()].filter(Boolean).join(' · ');
  // 6. Waivers
  const rows = data.waivers.map((w) => [key(w.testCase), w.reason, w.by, when(w.at)]);
  const waivers = section('waivers', !rows.length, () => ({ head: T('testCase reason who when'), rows }));
  const first = [header(c, title), summary(c), items(c), await failures(c), waivers];
  const B = [...first, matrix(c), runLog(c), appendix(c)].flat();
  const out =
    opts.format === 'html' ? toHtml(B, title, footer, opts.locale, data.brand?.logo) : toMd(B, footer);
  return c.customer ? out.replace(EMAIL, '[email removed]') : out;
}
