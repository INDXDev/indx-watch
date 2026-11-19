/**
 * The Hono app shared by `iw serve` (Node) and the Worker (docs/architecture.md#http-api).
 * Routes and shapes: contract.ts. The actor always comes from deps.identity, never from a request body.
 */
import * as B from '@indx-watch/bundle';
import { computeStatus, decide, type Model, reportData, type Scope } from '@indx-watch/core';
import { type ContextProvider, StoreError } from '@indx-watch/store';
import { type Context, Hono } from 'hono';
import type { AppDeps, ManualRunInput, ProjectInfo, ReviewInput, RunDetail } from './contract.js';
import { renderReport, reportTexts } from './report.js';
import * as V from './views.js';

/** Optional extras of AppDeps (change request: fold into AppDeps). */
export interface ServerDeps extends AppDeps {
  /** build and CI context recorded on manual runs and reports (Node: processContext) */
  context?: ContextProvider;
  /** read a bundle file, e.g. dataset rows; path relative to the bundle root */
  readFile?(path: string): Promise<Uint8Array | null>;
  /** clock for tests */
  now?(): Date;
}

export const MAX_BLOB_BYTES = 25 * 1024 * 1024;
const CSP_APP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'";
const CSP_BLOB = "default-src 'none'; sandbox";
const CSP_REPORT = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'";
/** raster images are shown inline; everything else (SVG and HTML included) is downloaded */
const INLINE_MEDIA = /^image\/(png|jpeg|gif|webp|avif)$/;
const VERDICTS = ['pass', 'fail', 'blocked', 'skipped'];

/** An error with an HTTP status and a code for the { error: { code, message } } body. */
export class HttpError extends Error {
  status: 400 | 401 | 403 | 404 | 412 | 413 | 503;
  code: string;
  constructor(status: HttpError['status'], code: string, message: string) {
    super(message);
    [this.status, this.code] = [status, code];
  }
}
const bad = (message: string) => new HttpError(400, 'invalid', message);
const notFound = (what: string) => new HttpError(404, 'not-found', `${what} not found`);
const STORE_STATUS: Record<string, number> = { 'not-found': 404, unauthorized: 401, invalid: 400 };

export function errorResponse(e: unknown): Response {
  const message = e instanceof Error ? e.message : String(e);
  const store = e instanceof StoreError ? ([STORE_STATUS[e.code] ?? 500, e.code] as const) : undefined;
  const other =
    (e as Error)?.name === 'ZodError' ? ([400, 'invalid'] as const) : ([500, 'internal'] as const);
  const [status, code] = e instanceof HttpError ? [e.status, e.code] : (store ?? other);
  return Response.json({ error: { code, message } }, { status });
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Release of a manual run (docs/spec/bundle-format.md#releasesversiontoml). */
export function resolveRelease(m: Model, explicit: string | undefined, build: B.Build, ci?: B.CiContext) {
  if (explicit && !m.releases.some((r) => r.version === explicit)) throw bad(`unknown release ${explicit}`);
  const name = build.ref?.replace(/^refs\/(heads|tags)\//, '');
  const byRef = m.releases.find((r) => r.refs?.some((x) => x === build.ref || x === name));
  const onMain = build.ref === `refs/heads/${m.project.default_branch ?? 'main'}`;
  return explicit ?? byRef?.version ?? (!ci || onMain ? m.project.current_release : undefined);
}

const MAGIC = Object.entries({ '89504e47': 'image/png', ffd8ff: 'image/jpeg', '47494638': 'image/gif' });
/** Media type from the first bytes (uploads without a usable Content-Type). */
const sniff = (b: Uint8Array) => {
  const hex = [...b.slice(0, 4)].map((x) => x.toString(16).padStart(2, '0')).join('');
  return MAGIC.find(([m]) => hex.startsWith(m))?.[1] ?? 'application/octet-stream';
};

export function createApp(deps: AppDeps): { fetch(request: Request): Promise<Response> } {
  const d = deps as ServerDeps;
  const now = () => iso(d.now?.() ?? new Date());
  const read = d.readFile ?? (async () => null);
  /** name and media type of blobs uploaded through this server (bounded) */
  const uploads = new Map<string, { name: string; type: string }>();
  const actors = new WeakMap<Request, Promise<B.Actor>>();
  const actor = (c: Context) => {
    const a = actors.get(c.req.raw) ?? deps.identity.current(c.req.raw);
    actors.set(c.req.raw, a);
    return a;
  };
  const model = async () => (await deps.loadModel()).model;
  const q = (c: Context, k: string) => c.req.query(k) || undefined;
  const scopeOf = (c: Context, m: Model, r = m.project.current_release): Scope =>
    Object.assign({ release: q(c, 'release') ?? r, environment: q(c, 'env') });
  const tcOf = (m: Model, k: string) => m.testCases.get(m.keyOf(k) ?? k) ?? fail(notFound(`test case ${k}`));
  const runOf = (m: Model, id: string) => m.runs.get(id) ?? fail(notFound(`run ${id}`));
  const body = async (c: Context) => {
    const big = () => new HttpError(413, 'too-large', 'over 25 MB');
    if (Number(c.req.header('content-length') ?? 0) > MAX_BLOB_BYTES) throw big();
    const data = new Uint8Array(await c.req.arrayBuffer());
    return data.byteLength > MAX_BLOB_BYTES ? fail(big()) : data;
  };
  const json = <T>(c: Context) => c.req.json<T>().catch(() => fail(bad('request body must be JSON')));

  const app = new Hono();
  app.onError((e) => errorResponse(e));
  const spa = (c: Context) => deps.assets && !c.req.path.startsWith('/api/');
  app.notFound((c) => (spa(c) ? deps.assets!(c.req.raw) : errorResponse(notFound(c.req.path))));
  app.use('*', async (c, next) => {
    if (deps.mode === 'hosted' && c.req.path !== '/healthz') await actor(c);
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    const html = c.res.headers.get('content-type')?.startsWith('text/html');
    if (html && !c.res.headers.has('content-security-policy')) c.header('Content-Security-Policy', CSP_APP);
  });
  app.get('/healthz', (c) => c.json({ ok: true }));

  app.get('/api/project', async (c) => {
    const { model: m, problems } = await deps.loadModel();
    const { key, name, source_locale, locales, default_environment, current_release } = m.project;
    const env = async (e: Model['environments'][number]) => {
      const { name, title, base_url, guide, i18n } = await V.markStale(e, 'environment');
      return { name, title, base_url, guide, access: e.access?.method, i18n };
    };
    const info: ProjectInfo = {
      project: { key, name, source_locale, locales, default_environment, current_release },
      releases: m.releases.map(({ version, title, state }) => ({ version, title, state })),
      environments: await Promise.all(m.environments.map(env)),
      ...{ identity: await actor(c), mode: deps.mode, problems },
      sync: deps.syncInfo?.() ?? { configured: false },
    };
    return c.json(info);
  });
  app.get('/api/status', async (c) => {
    const m = await model();
    return c.json(computeStatus(m, scopeOf(c, m)));
  });
  app.get('/api/specs', async (c) => {
    const m = await model();
    return c.json(await V.specTree(m, scopeOf(c, m)));
  });
  app.get('/api/test-cases/:key', async (c) => {
    const m = await model();
    return c.json(await V.testCaseDetail(m, tcOf(m, c.req.param('key')).data.key, scopeOf(c, m), read));
  });
  app.get('/api/fixtures', async (c) => {
    const fixtures = [...(await model()).fixtures.values()];
    return c.json(await Promise.all(fixtures.map((f) => V.fixtureDetail(f, read))));
  });
  app.get('/api/fixtures/:key', async (c) => {
    const [m, key] = [await model(), c.req.param('key')];
    const fx = m.fixtures.get(m.keyOf(key) ?? key) ?? fail(notFound(`fixture ${key}`));
    return c.json(await V.fixtureDetail(fx, read));
  });
  app.get('/api/plans', async (c) => c.json(V.planViews(await model())));
  app.get('/api/plans/:key', async (c) => {
    const key = c.req.param('key');
    return c.json(V.planViews(await model()).find((p) => p.key === key) ?? fail(notFound(`plan ${key}`)));
  });
  app.get('/api/runs', async (c) => {
    const [m, tc] = [await model(), q(c, 'tc')];
    const f = { release: q(c, 'release'), environment: q(c, 'env'), tcId: tc && tcOf(m, tc).data.id };
    const limit = Math.min(Math.max(Number(q(c, 'limit')) || 100, 1), 1000);
    const runs = V.listRuns(m, f).slice(0, limit);
    return c.json(runs.map((v) => V.runSummary(v, m)));
  });
  app.get('/api/runs/:id', async (c) => {
    const m = await model();
    const { record, judgements, decision, stale } = runOf(m, c.req.param('id'));
    const t = m.testCases.get(m.keyOf(record.test_case.id) ?? '');
    const { key = record.test_case.key, title = key } = t?.data ?? {};
    const testCase = { key, title, currentVersion: t?.version ?? record.test_case.version };
    return c.json({ record, judgements, decision, stale, testCase } satisfies RunDetail);
  });

  app.post('/api/runs', async (c) => {
    const [input, m] = [await json<ManualRunInput>(c), await model()];
    const t = tcOf(m, String(input.test_case ?? ''));
    if (!VERDICTS.includes(input.verdict)) throw bad('verdict must be pass, fail, blocked or skipped');
    const note = input.note?.trim() || undefined;
    if (input.verdict !== 'pass' && !note) throw bad(`a reason (note) is required for ${input.verdict}`);
    if (input.environment && !m.environments.some((e) => e.name === input.environment))
      throw bad(`unknown environment ${input.environment}`);
    const evidence: B.Evidence[] = [];
    const steps = Array.isArray(input.steps) ? input.steps : [];
    for (const { index: i, status, evidence: shas = [] } of steps) {
      if (!(Number.isInteger(i) && i >= 1 && i <= t.data.steps.length)) throw bad(`no step ${i}`);
      if (!B.StepStatus.safeParse(status).success) throw bad(`step ${i}: invalid status`);
      for (const sha of shas.filter((x) => !evidence.some((e) => e.sha256 === x))) {
        const data = /^[0-9a-f]{64}$/.test(sha) ? await deps.getBlob(sha) : null;
        if (!data) throw bad(`step ${i}: evidence ${sha} was not uploaded`);
        const { type = sniff(data), name = `step-${i}.${type.split('/')[1]}` } = uploads.get(sha) ?? {};
        const kind = type.startsWith('image/') ? 'screenshot' : 'file';
        evidence.push({ sha256: sha, name, media_type: type, size: data.byteLength, kind, step: i });
      }
    }
    const [who, at, ci] = [await actor(c), now(), await d.context?.ci()];
    const build = (await d.context?.build()) ?? {};
    const rows = Array.isArray(input.rows) ? input.rows : undefined;
    const fixtures = (t.data.fixtures ?? []).flatMap(({ ref, rows: wanted }) => {
      const fx = m.fixtures.get(ref);
      const used = wanted?.filter((r) => !rows || rows.includes(r));
      const ok = used?.length ? used : undefined;
      return fx ? [{ id: fx.data.id, key: ref, version: fx.version, rows: ok }] : [];
    });
    const reported = input.verdict === 'blocked' || input.verdict === 'skipped' ? input.verdict : null;
    const judgement = { id: B.newId('jdg'), kind: 'human', verdict: input.verdict, reason: note, by: who };
    const release = resolveRelease(m, input.release, build, ci);
    const environment = input.environment || m.project.default_environment;
    const started = new Date(input.started_at ?? '');
    const started_at = Number.isNaN(started.getTime()) ? undefined : iso(started);
    const locale = ['en', 'ja'].includes(input.locale ?? '') ? input.locale : undefined;
    const results = steps.map(({ index, status, note, evidence }) => ({ index, status, evidence, note }));
    const run = B.RunRecord.parse({
      ...{ kind: 'run', id: B.newId('run'), v: 1, project: m.project.id, at, actor: who, source: 'manual' },
      ...{ test_case: { id: t.data.id, key: t.data.key, version: t.version }, fixtures, release },
      ...{ environment, build, ci, started_at, ended_at: at, reported, locale, note, steps: results },
      ...{ evidence, judgements: [{ ...judgement, at }] },
    });
    await deps.writeRecord(run);
    const decision = decide(run.judgements, t.policy, { priority: t.priority, mode: t.data.mode, reported });
    return c.json({ run, decision }, 201);
  });

  app.post('/api/runs/:id/judgements', async (c) => {
    const [input, m] = [await json<ReviewInput>(c), await model()];
    const v = runOf(m, c.req.param('id'));
    if (!VERDICTS.includes(input.verdict)) throw bad('verdict must be pass, fail, blocked or skipped');
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (!reason) throw bad('a reason is required for a review');
    const [who, at] = [await actor(c), now()];
    if (who.kind === 'agent') throw new HttpError(403, 'forbidden', 'agents cannot review runs');
    const judgement = { id: B.newId('jdg'), kind: 'human', verdict: input.verdict, reason, by: who, at };
    const env = { kind: 'judgement', id: B.newId('rec'), v: 1, project: m.project.id, at, actor: who };
    const record = B.JudgementRecord.parse({ ...env, source: 'manual', run: v.record.id, judgement });
    await deps.writeRecord(record);
    const t = tcOf(m, v.record.test_case.id);
    const ctx = { priority: t.priority, mode: t.data.mode, reported: v.record.reported ?? null };
    const decision = decide([...v.judgements, record.judgement], t.policy, ctx);
    return c.json({ judgement: record.judgement, decision }, 201);
  });

  app.post('/api/blobs', async (c) => {
    const data = await body(c);
    if (!data.byteLength) throw bad('empty upload');
    const declared = c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase();
    const type = declared && declared !== 'application/octet-stream' ? declared : sniff(data);
    const sha256 = await deps.putBlob(data, type);
    if (uploads.size >= 5000) uploads.delete(uploads.keys().next().value!);
    const name = (c.req.header('x-filename') ?? '').replace(/[^\w.-]+/g, '_').slice(-120);
    uploads.set(sha256, { name: name || 'file', type });
    return c.json({ sha256, size: data.byteLength, media_type: type }, 201);
  });
  app.get('/api/blobs/:sha', async (c) => {
    const sha = c.req.param('sha');
    const data = /^[0-9a-f]{64}$/.test(sha) ? await deps.getBlob(sha) : fail(bad('invalid sha256'));
    if (!data) throw notFound(`blob ${sha}`);
    const { type = sniff(data), name = sha.slice(0, 12) } = uploads.get(sha) ?? {};
    const headers = new Headers({ 'Content-Type': type, 'Content-Security-Policy': CSP_BLOB });
    if (!INLINE_MEDIA.test(type)) headers.set('Content-Disposition', `attachment; filename="${name}"`);
    return new Response(data as Uint8Array<ArrayBuffer>, { headers });
  });

  app.get('/api/report', async (c) => {
    const [m, a, plan] = [await model(), await actor(c), q(c, 'plan')];
    const [format = 'md', audience = 'internal', locale = m.project.source_locale] = [
      ...[q(c, 'format'), q(c, 'audience'), q(c, 'locale')],
    ];
    if (format !== 'md' && format !== 'html') throw bad('format must be md or html');
    if (audience !== 'internal' && audience !== 'customer') throw bad('audience: internal or customer');
    if (locale !== 'en' && locale !== 'ja') throw bad('locale must be en or ja');
    const p = plan ? (m.plans.find((x) => x.key === plan) ?? fail(notFound(`plan ${plan}`))) : undefined;
    const fallback = audience === 'customer' ? 'none' : format === 'html' ? 'embed' : 'links';
    const evidence = q(c, 'evidence') ?? fallback;
    const [commit, cursor] = [(await d.context?.build())?.commit, [...m.runs.keys()].sort().at(-1)];
    const scope = scopeOf(c, m, p?.release ?? m.project.current_release);
    const who = {
      audience: audience as 'customer',
      generatedBy: a.name ?? a.id,
      now: d.now?.() ?? new Date(),
    };
    const data = reportData(m, scope, {
      ...who,
      ...(plan && { plan }),
      ...(commit && { commit }),
      ...(cursor && { cursor }),
    });
    const texts = await reportTexts(m, locale);
    const ro = { format, locale, evidence: evidence as 'none', getBlob: deps.getBlob } as const;
    const text = await renderReport(Object.assign(data, { texts }), ro);
    const html = { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP_REPORT };
    return c.body(text, 200, format === 'md' ? { 'Content-Type': 'text/markdown; charset=utf-8' } : html);
  });

  // ---------- /api/store/* (docs/spec/sync.md#store-http-endpoints) ----------
  const store = () => deps.objects ?? fail(notFound('store endpoint'));
  const storeKey = (c: Context) => decodeURIComponent(c.req.path.slice('/api/store/objects/'.length));
  app.on(['GET', 'HEAD'], '/api/store/objects/*', async (c) => {
    if (c.req.method === 'HEAD') {
      const h = await store().head(storeKey(c));
      const headers = h ? { 'Content-Length': `${h.size}`, ...(h.etag && { ETag: h.etag }) } : {};
      return c.body(null, h ? 200 : 404, headers);
    }
    const data = (await store().get(storeKey(c))) ?? fail(notFound(storeKey(c)));
    return c.body(data as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': 'application/octet-stream' });
  });
  app.put('/api/store/objects/*', async (c) => {
    const [key, data] = [storeKey(c), await body(c)];
    if (key.startsWith('v1/blobs/') && !key.endsWith(`/${await B.sha256Hex(data)}`))
      throw bad('blob does not match its key');
    const opts = {
      ifNoneMatch: c.req.header('if-none-match') === '*',
      contentType: c.req.header('content-type'),
    };
    if (!(await store().put(key, data, opts)))
      return errorResponse(new HttpError(412, 'conflict', `${key} exists`));
    if (key.startsWith('v1/log/')) await deps.onLogObject?.(key);
    return c.body(null, 201);
  });
  app.get('/api/store/list', async (c) => {
    const limit = Math.min(Number(q(c, 'limit')) || 1000, 1000);
    const r = await store().list({
      prefix: c.req.query('prefix') ?? '',
      startAfter: q(c, 'startAfter'),
      limit,
    });
    return c.json({
      keys: r.keys.map(({ key, size, etag }) => ({ key, size, ...(etag && { etag }) })),
      truncated: r.truncated,
    });
  });

  return { fetch: async (request: Request) => app.fetch(request) };
}

function fail(e: Error): never {
  throw e;
}
