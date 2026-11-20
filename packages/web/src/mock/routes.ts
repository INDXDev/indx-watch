/** Route table and per-endpoint handlers of the mock API (dev only). */
import type { ManualRunInput, ReviewInput, RunDetail } from '@indx-watch/server';
import * as D from './data';
import type { MockState, Run } from './state';

/** A JSON response. */
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
/** The API's not-found error. */
export const notFound = (what: string) =>
  json({ error: { code: 'not-found', message: `${what} not found` } }, 404);
const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ulid = () => Array.from({ length: 26 }, () => B32[Math.floor(Math.random() * 32)]).join('');

type Handler = (s: MockState, m: RegExpMatchArray, url: URL, body: unknown) => Response;
type Verdict = ManualRunInput['verdict'];

const humanJudgement = (verdict: Verdict, reason: string | undefined, at: string) => ({
  id: `jdg_${ulid()}`,
  kind: 'human' as const,
  verdict,
  reason,
  by: D.project.identity,
  at,
});

/** Records a human verdict as the run's decision and the test case's status. */
function decideByHuman(s: MockState, r: Run, verdict: Verdict) {
  s.decisions[r.id] = { verdict, rule: 1, reason: `human judgement by ${D.project.identity.name}` };
  s.tcStatus[r.test_case.key] = verdict;
}

const project: Handler = () =>
  json({ ...D.project, share: { clone: null }, can: { declare: true, upload: false } });
const testCase: Handler = (s, m) => (s.testCase(m[1]!) ? json(s.testCase(m[1]!)) : notFound(m[1]!));
const fixture: Handler = (_s, m) => {
  const f = D.fixtures.find((x) => x.key === m[1]);
  return f ? json(f) : notFound(m[1]!);
};
const runs: Handler = (s, _m, url) => {
  const tc = url.searchParams.get('tc');
  return json(
    s
      .ordered()
      .filter((r) => !tc || r.test_case.key === tc)
      .map(s.summary),
  );
};
const report: Handler = (_s, _m, url) =>
  new Response(reportHtml(url), { headers: { 'Content-Type': 'text/html' } });

const specs: Handler = ({ tcStatus }) => {
  const tree = D.specTree();
  for (const f of tree.features)
    for (const u of f.useCases)
      for (const c of u.criteria)
        for (const x of c.testCases) x.status = (tcStatus[x.key] ?? x.status) as 'pass';
  return json(tree);
};

const runDetail: Handler = (s, m) => {
  const r = s.runs.find((x) => x.id === m[1]);
  if (!r) return notFound(m[1]!);
  const tc = D.testCases.find((x) => x.key === r.test_case.key)!;
  return json({
    record: r,
    judgements: r.judgements,
    decision: s.decision(r),
    stale: s.summary(r).stale,
    testCase: { key: tc.key, title: tc.title, currentVersion: D.tcv(Number(tc.key.slice(3))) },
  } satisfies RunDetail);
};

/** The run record the server would write for a manual run. */
function manualRun(input: ManualRunInput, tc: { id: string; key: string; version: string }): Run {
  const at = now();
  const reported = input.verdict === 'blocked' || input.verdict === 'skipped' ? input.verdict : null;
  const evidence = input.steps.flatMap((s) =>
    (s.evidence ?? []).map((sha) => {
      const shot = { sha256: sha, name: `step-${s.index}.png`, media_type: 'image/png', size: 0 };
      return { ...shot, kind: 'screenshot' as const, step: s.index };
    }),
  );
  return {
    kind: 'run',
    id: `run_${ulid()}`,
    v: 1,
    project: 'prj_01JF3Q8M5X2V7K9D4R6T1W0Y00',
    at,
    actor: D.project.identity,
    source: 'manual',
    test_case: tc,
    fixtures: [],
    release: input.release,
    environment: input.environment,
    build: {},
    started_at: input.started_at,
    ended_at: at,
    reported,
    locale: input.locale,
    note: input.note,
    steps: input.steps,
    evidence,
    judgements: [humanJudgement(input.verdict, input.note, at)],
  };
}

const createRun: Handler = (s, _m, _u, body) => {
  const input = body as ManualRunInput;
  const tc = s.testCase(input.test_case)!;
  const run = manualRun(input, { id: tc.data.id, key: tc.key, version: tc.version });
  s.runs.push(run);
  decideByHuman(s, run, input.verdict);
  return json({ run, decision: s.decisions[run.id] }, 201);
};

const review: Handler = (s, m, _u, body) => {
  const r = s.runs.find((x) => x.id === m[1]);
  const input = body as ReviewInput;
  if (!r) return notFound(m[1]!);
  if (!input.reason) return json({ error: { code: 'invalid', message: 'reason is required' } }, 400);
  r.judgements = [...r.judgements, humanJudgement(input.verdict, input.reason, now())];
  decideByHuman(s, r, input.verdict);
  return json({ ok: true }, 201);
};

/** Method, path pattern (without the leading slash) and handler, matched in order. */
export const routes: [string, RegExp, Handler][] = [
  ['GET', /^api\/project$/, project],
  ['GET', /^api\/snapshots$/, () => json([])],
  ['GET', /^api\/status$/, () => json(D.status())],
  ['GET', /^api\/specs$/, specs],
  ['GET', /^api\/test-cases\/(TC-\d+)$/, testCase],
  ['GET', /^api\/fixtures$/, () => json(D.fixtures)],
  ['GET', /^api\/fixtures\/(FX-\d+)$/, fixture],
  ['GET', /^api\/plans$/, () => json(D.plans)],
  ['GET', /^api\/plans\/(PLAN-\d+)$/, (_s, m) => json(D.plans.find((p) => p.key === m[1]))],
  ['GET', /^api\/runs$/, runs],
  ['GET', /^api\/runs\/(run_\w+)$/, runDetail],
  ['POST', /^api\/runs$/, createRun],
  ['POST', /^api\/runs\/(run_\w+)\/judgements$/, review],
  ['GET', /^api\/report$/, report],
];

/** A stand-in for the server-rendered report (docs/spec/reports.md); the real one comes from packages/server. */
function reportHtml(url: URL): string {
  const s = D.status();
  const customer = url.searchParams.get('audience') === 'customer';
  const ja = url.searchParams.get('locale') === 'ja';
  const L = (en: string, jp: string) => (ja ? jp : en);
  const rows = s.gate.checks
    .map(
      (c) =>
        `<tr><td>${c.key}</td><td>${c.actual}</td><td>${c.expected}</td><td class="${c.passed ? 'p' : 'f'}">${c.passed ? '✓ pass' : '✕ fail'}</td></tr>`,
    )
    .join('');
  const ucs = s.useCases
    .map((u) => `<tr><td>${u.key}</td><td>${u.title}</td><td>${u.priority}</td><td>${u.status}</td></tr>`)
    .join('');
  return `<!doctype html><html lang="${ja ? 'ja' : 'en'}"><meta charset="utf-8"><title>Shop v1.2.0</title><style>
body{font:14px/1.5 system-ui,sans-serif;margin:32px;color:#1a1e24;background:#fff}h1{font-size:22px;margin:0}h2{font-size:16px;margin-top:28px}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #dce0e6;padding:6px 8px;text-align:left}.f{color:#b8231b;font-weight:600}.p{color:#1a7334}
.v{padding:12px 16px;border-radius:6px;background:#fce9e7;color:#b8231b;font-weight:600;margin-top:16px}.m{color:#555e6b}
@media (prefers-color-scheme:dark){body{background:#181c21;color:#e6e9ed}.v{background:#3d1a18;color:#ff8a80}.f{color:#ff8a80}.p{color:#6fd08c}.m{color:#a3acb8}td,th{border-color:#2e353e}}</style>
<h1>Shop — ${L('Release', 'リリース')} v1.2.0</h1><p class="m">${L('Scope', '範囲')}: staging · ${L('Generated', '作成')} 2026-11-19 · ${customer ? 'QA team' : 'alex@shop.test'}${url.searchParams.get('plan') ? ` · ${url.searchParams.get('plan')}` : ''}</p>
<div class="v">✕ ${L('Not ready: 3 of 7 gate checks fail', '未達: ゲート 7 項目中 3 項目が不合格')}</div>
<h2>${L('Readiness gate', 'リリース判定')}</h2><table><tr><th>Check</th><th>Actual</th><th>Expected</th><th></th></tr>${rows}</table>
<h2>${L('Use cases', 'ユースケース')}</h2><table>${ucs}</table>
${customer ? '' : `<h2>${L('Run log', '実行ログ')}</h2><p class="m">${D.runs.length} runs · CI: github-actions</p>`}`;
}
