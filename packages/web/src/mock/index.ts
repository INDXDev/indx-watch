/** In-browser mock of the HTTP API (dev only, `VITE_MOCK=1`). Writes live in memory until the page reloads. */
import type { ManualRunInput, ReviewInput, RunDetail, TestCaseDetail } from '@indx-watch/server';
import type { Transport } from '../api';
import * as D from './data';

type Run = RunDetail['record'];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const notFound = (what: string) => json({ error: { code: 'not-found', message: `${what} not found` } }, 404);
const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const ulid = () =>
  Array.from({ length: 26 }, () => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[Math.floor(Math.random() * 32)]).join(
    '',
  );

/** A fake app screenshot so evidence thumbnails have something to show. */
export function fakeShot(title: string, line: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="#f4f1ea"/><rect width="640" height="48" fill="#2b2f36"/><text x="20" y="31" font-family="sans-serif" font-size="18" fill="#fff">${esc(title)}</text><rect x="20" y="80" width="600" height="120" rx="8" fill="#fff" stroke="#d9d4c7"/><text x="40" y="148" font-family="sans-serif" font-size="20" fill="#2b2f36">${esc(line)}</text><rect x="20" y="230" width="220" height="44" rx="6" fill="#2f6f4e"/><text x="44" y="258" font-family="sans-serif" font-size="16" fill="#fff">Place order</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function mockTransport(): Transport {
  const runs: Run[] = [...D.runs];
  const decisions = { ...D.decisions };
  const blobs = new Map<string, string>();
  const tcStatus = { ...D.tcStatus };

  const decision = (r: Run): RunDetail['decision'] =>
    decisions[r.id] ?? { verdict: 'pass', rule: 8, reason: 'every judgement passed' };
  const summary = (r: Run) => ({
    id: r.id,
    testCase: r.test_case.key,
    version: r.test_case.version,
    verdict: decision(r).verdict,
    rule: decision(r).rule,
    stale: r.test_case.version !== D.tcv(Number(r.test_case.key.slice(3))),
    actor: r.actor,
    source: r.source,
    release: r.release,
    environment: r.environment,
    commit: r.build.commit,
    at: r.ended_at,
    evidence: r.evidence.length,
  });
  const ordered = () => [...runs].sort((a, b) => b.ended_at.localeCompare(a.ended_at));
  const testCase = (key: string): TestCaseDetail | undefined => {
    const n = Number(key.slice(3));
    const data = D.testCases.find((x) => x.key === key);
    if (!data) return undefined;
    const mine = ordered().filter((r) => r.test_case.key === key);
    return {
      key,
      file: `specs/…/${D.UC_OF[n]}/${key}.toml`,
      version: D.tcv(n),
      priority: D.PRIO[D.UC_OF[n]!]!,
      useCase: D.UC_OF[n]!,
      data,
      fixtures: (data.fixtures ?? []).map((f) => {
        const fx = D.fixtures.find((x) => x.key === f.ref)!;
        const vals = D.fixtureValues[f.ref];
        const values = f.rows ? vals?.filter((v) => f.rows?.includes(v.code ?? '')) : vals;
        return {
          key: fx.key,
          title: fx.data.title,
          kind: fx.data.kind,
          version: fx.version,
          rows: f.rows,
          values,
        };
      }),
      status: {
        key,
        status: tcStatus[key] as 'pass',
        stale: tcStatus[key] === 'stale',
        waived: false,
        hasEvidence: true,
        latestRun: mine[0]?.id,
      },
      runs: mine.map(summary),
    };
  };
  const setStatus = (key: string, verdict: string) => {
    tcStatus[key] = verdict;
  };

  const routes: [string, RegExp, (m: RegExpMatchArray, url: URL, body: unknown) => Response][] = [
    ['GET', /^api\/project$/, () => json(D.project)],
    ['GET', /^api\/status$/, () => json(D.status())],
    [
      'GET',
      /^api\/specs$/,
      () => {
        const tree = D.specTree();
        for (const f of tree.features)
          for (const u of f.useCases)
            for (const c of u.criteria)
              for (const x of c.testCases) x.status = (tcStatus[x.key] ?? x.status) as 'pass';
        return json(tree);
      },
    ],
    [
      'GET',
      /^api\/test-cases\/(TC-\d+)$/,
      (m) => (testCase(m[1]!) ? json(testCase(m[1]!)) : notFound(m[1]!)),
    ],
    ['GET', /^api\/fixtures$/, () => json(D.fixtures)],
    [
      'GET',
      /^api\/fixtures\/(FX-\d+)$/,
      (m) => {
        const f = D.fixtures.find((x) => x.key === m[1]);
        return f ? json(f) : notFound(m[1]!);
      },
    ],
    ['GET', /^api\/plans$/, () => json(D.plans)],
    ['GET', /^api\/plans\/(PLAN-\d+)$/, (m) => json(D.plans.find((p) => p.key === m[1]))],
    [
      'GET',
      /^api\/runs$/,
      (_m, url) =>
        json(
          ordered()
            .filter((r) => !url.searchParams.get('tc') || r.test_case.key === url.searchParams.get('tc'))
            .map(summary),
        ),
    ],
    [
      'GET',
      /^api\/runs\/(run_\w+)$/,
      (m) => {
        const r = runs.find((x) => x.id === m[1]);
        if (!r) return notFound(m[1]!);
        const tc = D.testCases.find((x) => x.key === r.test_case.key)!;
        const later = r.judgements;
        return json({
          record: r,
          judgements: later,
          decision: decision(r),
          stale: summary(r).stale,
          testCase: { key: tc.key, title: tc.title, currentVersion: D.tcv(Number(tc.key.slice(3))) },
        } satisfies RunDetail);
      },
    ],
    [
      'POST',
      /^api\/runs$/,
      (_m, _u, body) => {
        const input = body as ManualRunInput;
        const tc = testCase(input.test_case)!;
        const at = now();
        const run: Run = {
          kind: 'run',
          id: `run_${ulid()}`,
          v: 1,
          project: 'prj_01JF3Q8M5X2V7K9D4R6T1W0Y00',
          at,
          actor: D.project.identity,
          source: 'manual',
          test_case: { id: tc.data.id, key: tc.key, version: tc.version },
          fixtures: [],
          release: input.release,
          environment: input.environment,
          build: {},
          started_at: input.started_at,
          ended_at: at,
          reported: input.verdict === 'blocked' || input.verdict === 'skipped' ? input.verdict : null,
          locale: input.locale,
          note: input.note,
          steps: input.steps,
          evidence: input.steps.flatMap((s) =>
            (s.evidence ?? []).map((sha) => ({
              sha256: sha,
              name: `step-${s.index}.png`,
              media_type: 'image/png',
              size: 0,
              kind: 'screenshot' as const,
              step: s.index,
            })),
          ),
          judgements: [
            {
              id: `jdg_${ulid()}`,
              kind: 'human',
              verdict: input.verdict,
              reason: input.note,
              by: D.project.identity,
              at,
            },
          ],
        };
        runs.push(run);
        decisions[run.id] = {
          verdict: input.verdict,
          rule: 1,
          reason: `human judgement by ${D.project.identity.name}`,
        };
        setStatus(tc.key, input.verdict);
        return json({ run, decision: decisions[run.id] }, 201);
      },
    ],
    [
      'POST',
      /^api\/runs\/(run_\w+)\/judgements$/,
      (m, _u, body) => {
        const r = runs.find((x) => x.id === m[1]);
        const input = body as ReviewInput;
        if (!r) return notFound(m[1]!);
        if (!input.reason) return json({ error: { code: 'invalid', message: 'reason is required' } }, 400);
        r.judgements = [
          ...r.judgements,
          {
            id: `jdg_${ulid()}`,
            kind: 'human',
            verdict: input.verdict,
            reason: input.reason,
            by: D.project.identity,
            at: now(),
          },
        ];
        decisions[r.id] = {
          verdict: input.verdict,
          rule: 1,
          reason: `human judgement by ${D.project.identity.name}`,
        };
        setStatus(r.test_case.key, input.verdict);
        return json({ ok: true }, 201);
      },
    ],
    [
      'GET',
      /^api\/report$/,
      (_m, url) => new Response(reportHtml(url), { headers: { 'Content-Type': 'text/html' } }),
    ],
  ];

  return {
    async fetch(path, init) {
      const url = new URL(path, 'http://mock/');
      const method = init?.method ?? 'GET';
      const p = url.pathname.slice(1);
      await new Promise((r) => setTimeout(r, 80));
      if (method === 'POST' && p === 'api/blobs') {
        const blob = init?.body as Blob;
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
        const sha = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
        blobs.set(sha, URL.createObjectURL(blob));
        return json({ sha256: sha, size: blob.size, media_type: blob.type }, 201);
      }
      for (const [m, re, handle] of routes) {
        const match = method === m ? p.match(re) : null;
        if (match) return handle(match, url, init?.body ? JSON.parse(String(init.body)) : undefined);
      }
      return notFound(`${method} ${p}`);
    },
    blobUrl: (sha) => blobs.get(sha) ?? fakeShot(...(D.SHOT_LABELS[sha] ?? ['Evidence', sha.slice(0, 12)])),
  };
}

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
