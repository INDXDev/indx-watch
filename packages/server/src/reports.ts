/** Report requests (docs/spec/reports.md): GET /api/report, share links (shares.ts) and the MCP `report` tool. */
import type * as B from '@indx-watch/bundle';
import { type Model, reportData, type Scope } from '@indx-watch/core';
import type { Context } from 'hono';
import type { Ctx } from './app.js';
import { bad, fail, notFound, q, scopeOf } from './http.js';
import { renderReport, reportTexts } from './report.js';

const CSP_REPORT = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'";

const EVIDENCE = ['none', 'embed', 'links'] as const;

/** `v` when it is one of `allowed`, else 400 with `message`. */
const oneOf = <T extends string>(v: string, allowed: readonly T[], message: string) =>
  (allowed as readonly string[]).includes(v) ? (v as T) : fail(bad(message));

/** Validated `?format=&audience=&locale=&evidence=` of a report (`format` fixed for share links). */
function reportOptions(c: Context, m: Model, fixed?: 'html', customer = false) {
  const format = oneOf(fixed ?? q(c, 'format') ?? 'md', ['md', 'html'], 'format must be md or html');
  // a customer's reports are always customer reports (docs/spec/security.md#roles)
  const asked = customer ? 'customer' : (q(c, 'audience') ?? (fixed ? 'customer' : 'internal'));
  const audience = oneOf(asked, ['internal', 'customer'], 'audience: internal or customer');
  const locale = oneOf(q(c, 'locale') ?? m.project.source_locale, ['en', 'ja'], 'locale must be en or ja');
  const byDefault = audience === 'customer' ? 'none' : format === 'html' ? 'embed' : 'links';
  const evidence = oneOf(q(c, 'evidence') ?? byDefault, EVIDENCE, 'evidence: none, embed or links');
  if (fixed && evidence === 'links') throw bad('share links embed evidence or leave it out');
  return { format, audience, locale, evidence } as const;
}

type ReportOf = { scope: Scope; audience: 'internal' | 'customer'; locale: B.Locale; plan?: string };
/** Report data with its texts (also the MCP `report` tool). */
export async function reportOf({ deps }: Ctx, m: Model, a: B.Actor, o: ReportOf) {
  const [commit, cursor] = [(await deps.context?.build())?.commit, [...m.runs.keys()].sort().at(-1)];
  const by = { audience: o.audience, generatedBy: a.name ?? a.id, now: deps.now?.() ?? new Date() };
  const extra = { ...(o.plan && { plan: o.plan }), ...(commit && { commit }), ...(cursor && { cursor }) };
  return Object.assign(reportData(m, o.scope, { ...by, ...extra }), {
    texts: await reportTexts(m, o.locale),
  });
}

/** The report a request asks for, rendered (GET /api/report; POST /api/shares fixes `html`). */
export async function reportFor(c: Context, x: Ctx, fixed?: 'html') {
  const [m, a, plan, { role }] = [await x.model(c), await x.actor(c), q(c, 'plan'), await x.grant(c)];
  const { format, audience, locale, evidence } = reportOptions(c, m, fixed, role === 'customer');
  const p = plan ? (m.plans.find((x) => x.key === plan) ?? fail(notFound(`plan ${plan}`))) : undefined;
  const scope = scopeOf(c, m, p?.release ?? m.project.current_release);
  const data = await reportOf(x, m, a, { scope, audience, locale, plan });
  const text = await renderReport(data, { format, locale, evidence, getBlob: x.deps.getBlob });
  return { m, format, audience, locale, plan, scope, text };
}

export const HTML_REPORT = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': CSP_REPORT,
};
/** GET /api/report */
export async function report(c: Context, x: Ctx) {
  const { format, text } = await reportFor(c, x);
  return c.body(
    text,
    200,
    format === 'md' ? { 'Content-Type': 'text/markdown; charset=utf-8' } : HTML_REPORT,
  );
}
