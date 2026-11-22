/**
 * The API routes of createApp (docs/architecture.md#http-api), in three groups: reads, writes (bundle upload,
 * manual runs, reviews, blob uploads) and the store endpoints (docs/spec/sync.md#store-http-endpoints).
 */
import * as B from '@indx-watch/bundle';
import {
  approvedBaseline,
  computeStatus,
  decide,
  type Model,
  ownedFeatures,
  ownedModel,
  reportData,
  runFacts,
  type Scope,
} from '@indx-watch/core';
import { checkRecord, ulidTime } from '@indx-watch/store';
import type { Context, Hono } from 'hono';
import type { Ctx } from './app.js';
import type { BaselineInput, ManualRunInput, ProjectInfo, ReviewInput, RunDetail } from './contract.js';
import { bad, errorResponse, fail, HttpError, iso, MAX_BLOB_BYTES, notFound, sniff } from './http.js';
import { renderReport, reportTexts } from './report.js';
import { checksError } from './tools.js';
import { prepareUpload, type UploadInput } from './upload.js';
import * as V from './views.js';
import { editTestCase, invite, workspaceMode } from './workspace.js';

const VERDICTS = ['pass', 'fail', 'blocked', 'skipped'];
/** A non-empty query parameter. */
const q = (c: Context, k: string) => c.req.query(k) || undefined;
/** Scope from `?release=` and `?env=`. */
const scopeOf = (c: Context, m: Model, r = m.project.current_release): Scope =>
  Object.assign({ release: q(c, 'release') ?? r, environment: q(c, 'env') });
/** A test case by key or ID, else 404. */
const tcOf = (m: Model, k: string) => m.testCases.get(m.keyOf(k) ?? k) ?? fail(notFound(`test case ${k}`));
/** A run by ID, else 404. */
const runOf = (m: Model, id: string) => m.runs.get(id) ?? fail(notFound(`run ${id}`));
/** The JSON request body, else 400. */
const readJson = <T>(c: Context) => c.req.json<T>().catch(() => fail(bad('request body must be JSON')));

/** The raw request body, refused with 413 over MAX_BLOB_BYTES. */
async function readBody(c: Context) {
  const big = () => new HttpError(413, 'too-large', 'over 25 MB');
  if (Number(c.req.header('content-length') ?? 0) > MAX_BLOB_BYTES) throw big();
  // count while reading: a chunked body has no Content-Length
  const [reader, chunks] = [c.req.raw.body?.getReader(), [] as Uint8Array<ArrayBuffer>[]];
  for (let r = await reader?.read(), n = 0; r && !r.done; r = await reader!.read()) {
    n += r.value.byteLength;
    if (n > MAX_BLOB_BYTES) await reader!.cancel().then(() => fail(big()));
    chunks.push(r.value);
  }
  return new Uint8Array(await new Blob(chunks).arrayBuffer());
}

const CSP_BLOB = "default-src 'none'; sandbox";
const CSP_REPORT = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'";
/** raster images are shown inline; everything else (SVG and HTML included) is downloaded */
const INLINE_MEDIA = /^image\/(png|jpeg|gif|webp|avif)$/;

/** Register the read-only routes. */
export function registerReadRoutes(app: Hono, x: Ctx) {
  const { model, read } = x;
  /** a JSON response computed from the current model */
  const get = (path: string, view: (m: Model, c: Context) => unknown) =>
    app.get(path, async (c) => c.json(await view(await model(c), c)));
  /** with `?mine=1`, the model narrowed to the features the request's identity owns (docs/spec/web.md#my-features) */
  const mine = async (m: Model, c: Context) =>
    q(c, 'mine') === '1' ? ownedModel(m, ownedFeatures(m, (await x.grant(c)).who)) : m;
  app.get('/api/project', (c) => projectInfo(c, x));
  get('/api/status', async (m, c) => computeStatus(await mine(m, c), scopeOf(c, m)));
  get('/api/specs', async (m, c) => V.specTree(await mine(m, c), scopeOf(c, m)));
  get('/api/test-cases/:key', (m, c) =>
    V.testCaseDetail(m, tcOf(m, c.req.param('key')!).data.key, scopeOf(c, m), read),
  );
  get('/api/fixtures', (m) => Promise.all([...m.fixtures.values()].map((f) => V.fixtureDetail(f, read))));
  get('/api/fixtures/:key', (m, c) => {
    const key = c.req.param('key')!;
    return V.fixtureDetail(m.fixtures.get(m.keyOf(key) ?? key) ?? fail(notFound(`fixture ${key}`)), read);
  });
  get('/api/plans', (m) => V.planViews(m));
  get('/api/snapshots', (m) => m.snapshots.map((r) => V.snapshotSummary(r, m)));
  get('/api/plans/:key', async (m, c) => {
    const key = c.req.param('key');
    return (await V.planViews(m)).find((p) => p.key === key) ?? fail(notFound(`plan ${key}`));
  });
  app.get('/api/runs', async (c) => {
    const [m, tc] = [await model(c), q(c, 'tc')];
    const f = { release: q(c, 'release'), environment: q(c, 'env'), tcId: tc && tcOf(m, tc).data.id };
    const limit = Math.min(Math.max(Number(q(c, 'limit')) || 100, 1), 1000);
    const runs = V.listRuns(m, f).slice(0, limit);
    return c.json(runs.map((v) => V.runSummary(v, m)));
  });
  get('/api/runs/:id', (m, c) => runDetail(m, c.req.param('id')!));
  app.get('/api/blobs/:sha', (c) => blob(c, x));
  app.get('/api/report', (c) => report(c, x));
}

async function projectInfo(c: Context, { deps, actor, sharer, grant, model }: Ctx) {
  // a customer's model has no environment guides or access methods (docs/spec/security.md#roles)
  const [{ problems }, m, { role, who: principal }] = [
    await deps.loadModel(),
    await model(c),
    await grant(c),
  ];
  const [lead, customer] = [role === 'lead', role === 'customer'];
  const { key, name, source_locale, locales, default_environment, current_release } = m.project;
  const env = async (e: Model['environments'][number]) => {
    const { name, title, base_url, guide, i18n } = await V.markStale(e, 'environment');
    return { name, title, base_url, guide, access: e.access?.method, i18n };
  };
  const release = async (r: Model['releases'][number]) => {
    const { version, title, state, i18n } = await V.markStale(r, 'release');
    return { version, title, state, i18n };
  };
  const clone = deps.mode === 'hosted' ? new URL(c.req.url).origin : (deps.syncInfo?.().store ?? null);
  const who = await actor(c);
  const info: ProjectInfo = {
    project: { key, name, source_locale, locales, default_environment, current_release },
    releases: await Promise.all(m.releases.map(release)),
    environments: await Promise.all(m.environments.map(env)),
    ...{ identity: who, mode: deps.mode, problems: customer ? [] : problems, role },
    owns: ownedFeatures(m, principal),
    sync: deps.syncInfo?.() ?? { configured: false },
    share: { clone: customer ? null : clone },
    can: {
      ...{
        declare: !!deps.declaredIdentity,
        upload: !!deps.publishBundle && lead && !workspaceMode(m),
        share: sharer(who) && lead,
      },
      ...{ run: role !== 'viewer', review: lead || role === 'tester', approve: lead },
      edit: workspaceMode(m) && !!deps.bundleFiles && lead,
    },
    snapshot: customer || !m.snapshots[0] ? undefined : V.snapshotSummary(m.snapshots[0], m),
  };
  return c.json(info);
}

async function runDetail(m: Model, id: string): Promise<RunDetail> {
  const { record, judgements, decision, stale } = runOf(m, id);
  const t = m.testCases.get(m.keyOf(record.test_case.id) ?? '');
  const { key = record.test_case.key, title = key } = t?.data ?? {};
  const i18n = t?.data.i18n && (await V.markStale(t.data, 'test-case')).i18n;
  const currentVersion = t?.version ?? record.test_case.version;
  const testCase = { key, title, currentVersion, ...(i18n && { i18n }) };
  // judgements are flagged per run (`<run id>#<judgement id>`): their IDs are not unique across records
  const flagged = (jid: string, i: number) => m.unverified?.has(i ? `${record.id}#${jid}` : jid);
  const ids = [record.id, ...judgements.map((j) => j.id)].filter(flagged);
  const project = record.automation?.project;
  const current = (e: B.Evidence) => approvedBaseline(m, record.test_case.id, e.name, project)?.sha256;
  const baselines = record.evidence.filter((e) => current(e) === e.sha256).map((e) => e.sha256);
  const extra = { ...(ids.length && { unverified: ids }), ...(baselines.length && { baselines }) };
  return { record, judgements, decision, stale, testCase, ...extra };
}

async function blob(c: Context, { deps, uploads, grant, model, read }: Ctx) {
  const sha = c.req.param('sha')!;
  const m = await model(c);
  const runs = (await grant(c)).role === 'customer' && [...m.runs.values()];
  // a fixture file of the bundle (in git or behind a pointer) is test data for whoever sees the fixture
  const fx = [...m.fixtures.values()]
    .flatMap((f) => f.dataFiles)
    .find((x) => (x.pointer?.sha256 ?? x.sha256) === sha);
  // a customer gets only the evidence of runs they see, test data, or a blob uploaded here
  if (runs && !fx && !uploads.has(sha) && !runs.some((v) => v.record.evidence.some((e) => e.sha256 === sha)))
    throw notFound(`blob ${sha}`);
  if (!/^[0-9a-f]{64}$/.test(sha)) throw bad('invalid sha256');
  const data = fx && !fx.pointer ? await read(fx.file) : await deps.getBlob(sha);
  if (!data) throw notFound(`blob ${sha}`);
  const known = fx && { type: fx.pointer?.media_type ?? V.mediaOf(fx.name) ?? sniff(data), name: fx.name };
  const { type = sniff(data), name = sha.slice(0, 12) } = uploads.get(sha) ?? known ?? {};
  const headers = new Headers({ 'Content-Type': type, 'Content-Security-Policy': CSP_BLOB });
  if (!INLINE_MEDIA.test(type)) headers.set('Content-Disposition', `attachment; filename="${name}"`);
  return new Response(data as Uint8Array<ArrayBuffer>, { headers });
}

/** Validated `?format=&audience=&locale=&evidence=` of a report (`format` fixed for share links). */
function reportOptions(c: Context, m: Model, fixed?: 'html', customer = false) {
  const format = fixed ?? q(c, 'format') ?? 'md';
  // a customer's reports are always customer reports (docs/spec/security.md#roles)
  const audience = customer ? 'customer' : (q(c, 'audience') ?? (fixed ? 'customer' : 'internal'));
  const locale = q(c, 'locale') ?? m.project.source_locale;
  if (format !== 'md' && format !== 'html') throw bad('format must be md or html');
  if (audience !== 'internal' && audience !== 'customer') throw bad('audience: internal or customer');
  if (locale !== 'en' && locale !== 'ja') throw bad('locale must be en or ja');
  const evidence =
    q(c, 'evidence') ?? (audience === 'customer' ? 'none' : format === 'html' ? 'embed' : 'links');
  if (fixed && evidence === 'links') throw bad('share links embed evidence or leave it out');
  return { format, audience, locale, evidence: evidence as 'none' } as const;
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
async function report(c: Context, x: Ctx) {
  const { format, text } = await reportFor(c, x);
  return c.body(
    text,
    200,
    format === 'md' ? { 'Content-Type': 'text/markdown; charset=utf-8' } : HTML_REPORT,
  );
}

// ---------- writes ----------

type TestCase = Model['testCases'] extends Map<string, infer T> ? T : never;
const localeOf = <L extends string>(l?: L) => (['en', 'ja'].includes(l ?? '') ? l : undefined);

/** Register the write routes. */
export function registerWriteRoutes(app: Hono, x: Ctx) {
  app.post('/api/bundle', (c) => uploadBundle(c, x));
  app.post('/api/runs', (c) => createRun(c, x));
  app.post('/api/runs/:id/judgements', (c) => review(c, x));
  app.post('/api/runs/:id/baselines', (c) => approveBaseline(c, x));
  app.post('/api/blobs', (c) => uploadBlob(c, x));
  app.patch('/api/test-cases/:key', (c) => editTestCase(c, x));
  app.post('/api/plans/:key/invites', (c) => invite(c, x, false));
  app.delete('/api/plans/:key/invites/:email', (c) => invite(c, x, true));
}

/** Release of a manual run (docs/spec/bundle-format.md#releasesversiontoml). */
export function resolveRelease(m: Model, explicit: string | undefined, build: B.Build, ci?: B.CiContext) {
  if (explicit && !m.releases.some((r) => r.version === explicit)) throw bad(`unknown release ${explicit}`);
  const name = build.ref?.replace(/^refs\/(heads|tags)\//, '');
  const byRef = m.releases.find((r) => r.refs?.some((x) => x === build.ref || x === name));
  const onMain = build.ref === `refs/heads/${m.project.default_branch ?? 'main'}`;
  return explicit ?? byRef?.version ?? (!ci || onMain ? m.project.current_release : undefined);
}

async function uploadBundle(c: Context, { deps: d, actor, model }: Ctx) {
  const input = await readJson<UploadInput>(c);
  if (workspaceMode(await model(c).catch(() => undefined)))
    throw new HttpError(409, 'conflict', 'workspace mode: edit definitions instead of uploading');
  const who = await actor(c);
  if (!d.publishBundle || !d.bundleFiles) throw new HttpError(403, 'forbidden', 'this server cannot write');
  if (who.kind === 'agent') throw new HttpError(403, 'forbidden', 'agents write drafts with iw new');
  const { next, result } = await prepareUpload(await d.bundleFiles(), input);
  if (input.dryRun || !result.ok) return c.json(result, input.dryRun || result.ok ? 200 : 422);
  const changed = result.changes.filter((x) => x.change === 'added' || x.change === 'changed');
  const removed = result.changes.filter((x) => x.change === 'removed').map((x) => x.path);
  const message = typeof input.message === 'string' ? input.message.trim().slice(0, 500) : '';
  const info = { actor: who, changed: changed.map((x) => x.path), removed, ...(message && { message }) };
  const snapshot = await d.publishBundle(next, info);
  return c.json({ ...result, ...(snapshot && { snapshot }) }, 201);
}

/** The note of a manual run, after checking its verdict, note and environment. */
function checkManualRun(input: ManualRunInput, m: Model) {
  if (!VERDICTS.includes(input.verdict)) throw bad('verdict must be pass, fail, blocked or skipped');
  const note = input.note?.trim() || undefined;
  if (input.verdict !== 'pass' && !note) throw bad(`a reason (note) is required for ${input.verdict}`);
  if (input.environment && !m.environments.some((e) => e.name === input.environment))
    throw bad(`unknown environment ${input.environment}`);
  return note;
}

/** Evidence of one step: a blob uploaded before, named and typed by its upload. */
export async function evidenceOf({ deps, uploads }: Ctx, sha: string, i?: number): Promise<B.Evidence> {
  const data = /^[0-9a-f]{64}$/.test(sha) ? await deps.getBlob(sha) : null;
  if (!data) throw bad(`${i ? `step ${i}: ` : ''}evidence ${sha} was not uploaded`);
  const { type = sniff(data), name = `${i ? `step-${i}` : 'evidence'}.${type.split('/')[1]}` } =
    uploads.get(sha) ?? {};
  const kind = type.startsWith('image/') ? 'screenshot' : 'file';
  return { sha256: sha, name, media_type: type, size: data.byteLength, kind, step: i };
}

/** Evidence of all steps (each blob once), after checking step indexes and statuses. */
async function stepEvidence(x: Ctx, t: TestCase, steps: ManualRunInput['steps']) {
  const evidence: B.Evidence[] = [];
  for (const { index: i, status, evidence: shas = [], checks } of steps) {
    if (!(Number.isInteger(i) && i >= 1 && i <= t.data.steps.length)) throw bad(`no step ${i}`);
    if (!B.StepStatus.safeParse(status).success) throw bad(`step ${i}: invalid status`);
    const wrong = checksError(t.data.steps, { index: i, checks });
    if (wrong) throw bad(wrong);
    for (const sha of shas.filter((s) => !evidence.some((e) => e.sha256 === s)))
      evidence.push(await evidenceOf(x, sha, i));
  }
  return evidence;
}

/** Fixtures the test case uses, limited to the rows the tester ran. */
export function runFixtures(m: Model, t: TestCase, input: unknown) {
  const rows = Array.isArray(input) ? (input as string[]) : undefined;
  return (t.data.fixtures ?? []).flatMap(({ ref, rows: wanted }) => {
    const fx = m.fixtures.get(ref);
    const used = wanted?.filter((r) => !rows || rows.includes(r));
    const ok = used?.length ? used : undefined;
    return fx ? [{ id: fx.data.id, key: ref, version: fx.version, rows: ok }] : [];
  });
}

async function createRun(c: Context, x: Ctx) {
  const [input, m] = [await readJson<ManualRunInput>(c), await x.model(c)];
  const t = tcOf(m, String(input.test_case ?? ''));
  const note = checkManualRun(input, m);
  const steps = Array.isArray(input.steps) ? input.steps : [];
  const evidence = await stepEvidence(x, t, steps);
  const [who, at, ci] = [await x.actor(c), x.now(), await x.deps.context?.ci()];
  const build = (await x.deps.context?.build()) ?? {};
  const fixtures = runFixtures(m, t, input.rows);
  const reported = input.verdict === 'blocked' || input.verdict === 'skipped' ? input.verdict : null;
  const judgement = { id: B.newId('jdg'), kind: 'human', verdict: input.verdict, reason: note, by: who };
  const release = resolveRelease(m, input.release, build, ci);
  const environment = input.environment || m.project.default_environment;
  const started = new Date(input.started_at ?? '');
  const started_at = Number.isNaN(started.getTime()) ? undefined : iso(started);
  const locale = localeOf(input.locale);
  const results = steps.map(({ index, status, note, evidence, checks }) => ({
    index,
    status,
    evidence,
    note,
    checks,
  }));
  const run = B.RunRecord.parse({
    ...{ kind: 'run', id: B.newId('run'), v: 1, project: m.project.id, at, actor: who, source: 'manual' },
    ...{ test_case: { id: t.data.id, key: t.data.key, version: t.version }, fixtures, release },
    ...{ environment, build, ci, started_at, ended_at: at, reported, locale, note, steps: results },
    ...{ evidence, judgements: [{ ...judgement, at }] },
  });
  await x.deps.writeRecord(run);
  return c.json({ run, decision: decide(run.judgements, t.policy, runFacts(t, reported)) }, 201);
}

async function review(c: Context, x: Ctx) {
  const [input, m] = [await readJson<ReviewInput>(c), await x.model(c)];
  const v = runOf(m, c.req.param('id')!);
  if (!VERDICTS.includes(input.verdict)) throw bad('verdict must be pass, fail, blocked or skipped');
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason) throw bad('a reason is required for a review');
  const [who, at] = [await x.actor(c), x.now()];
  if (who.kind === 'agent') throw new HttpError(403, 'forbidden', 'agents cannot review runs');
  const signed = { by: who, at, locale: localeOf(input.locale) };
  const judgement = { id: B.newId('jdg'), kind: 'human', verdict: input.verdict, reason, ...signed };
  const env = { kind: 'judgement', id: B.newId('rec'), v: 1, project: m.project.id, at, actor: who };
  const record = B.JudgementRecord.parse({ ...env, source: 'manual', run: v.record.id, judgement });
  await x.deps.writeRecord(record);
  const t = tcOf(m, v.record.test_case.id);
  const facts = runFacts(t, v.record.reported ?? null);
  const decision = decide([...v.judgements, record.judgement], t.policy, facts);
  return c.json({ judgement: record.judgement, decision }, 201);
}

/** A person approves one PNG screenshot of a run as its visual baseline (docs/spec/web.md#visual-baselines). */
async function approveBaseline(c: Context, x: Ctx) {
  const [input, m] = [await readJson<BaselineInput>(c), await x.model(c)];
  const run = runOf(m, c.req.param('id')!).record;
  const e = run.evidence.find((e) => e.sha256 === input.sha256 && e.media_type === 'image/png');
  if (!e) throw bad('sha256 must name a PNG screenshot of this run');
  const [who, at] = [await x.actor(c), x.now()];
  if (who.kind !== 'human') throw new HttpError(403, 'forbidden', 'only people can approve baselines');
  const env = { kind: 'baseline', id: B.newId('rec'), v: 1, project: m.project.id, at, actor: who };
  const fields = {
    test_case: { id: run.test_case.id, key: run.test_case.key },
    name: e.name,
    sha256: e.sha256,
  };
  const baseline = B.BaselineRecord.parse({
    ...{ ...env, source: 'manual', ...fields, automation_project: run.automation?.project, run: run.id },
  });
  await x.deps.writeRecord(baseline);
  return c.json({ baseline }, 201);
}

async function uploadBlob(c: Context, { deps, uploads }: Ctx) {
  const data = await readBody(c);
  if (!data.byteLength) throw bad('empty upload');
  const declared = c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase();
  const type = declared && declared !== 'application/octet-stream' ? declared : sniff(data);
  const sha256 = await deps.putBlob(data, type);
  if (uploads.size >= 5000) uploads.delete(uploads.keys().next().value!);
  const name = (c.req.header('x-filename') ?? '').replace(/[^\w.-]+/g, '_').slice(-120);
  uploads.set(sha256, { name: name || 'file', type });
  return c.json({ sha256, size: data.byteLength, media_type: type }, 201);
}

// ---------- /api/store/* ----------

const MANIFEST = 'indx-watch-store.json';
const LOG_KEY = /^v1\/log\/[0-9A-HJKMNP-TV-Z]{26}\.json$/;
const BLOB_KEY = /^v1\/blobs\/sha256\/([0-9a-f]{2})\/\1[0-9a-f]{62}$/;
const storeKey = (c: Context) => decodeURIComponent(c.req.path.slice('/api/store/objects/'.length));
const parsed = (d: Uint8Array | null) => new Response(d as BodyInit).json().catch(() => undefined);
const objects = (x: Ctx) => x.deps.objects ?? fail(notFound('store endpoint'));

/** Register the store endpoints; they answer 404 when deps.objects is not set. */
export function registerStoreRoutes(app: Hono, x: Ctx) {
  const store = () => objects(x);
  app.on(['GET', 'HEAD'], '/api/store/objects/*', async (c) => {
    if (c.req.method === 'HEAD') {
      const h = await store().head(storeKey(c));
      const headers = h ? { 'Content-Length': `${h.size}`, ...(h.etag && { ETag: h.etag }) } : {};
      return c.body(null, h ? 200 : 404, headers);
    }
    const data = (await store().get(storeKey(c))) ?? fail(notFound(storeKey(c)));
    return c.body(data as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': 'application/octet-stream' });
  });
  app.put('/api/store/objects/*', (c) => putObject(c, x));
  app.post('/api/sign', (c) => signRecords(c, x));
  app.get('/api/store/list', async (c) => {
    const limit = Math.min(Number(q(c, 'limit')) || 1000, 1000);
    const [prefix, startAfter] = [c.req.query('prefix') ?? '', q(c, 'startAfter')];
    const r = await store().list({ prefix, startAfter, limit });
    const keys = r.keys.map(({ key, size, etag }) => ({ key, size, ...(etag && { etag }) }));
    return c.json({ keys, truncated: r.truncated });
  });
}

/** GitHub OIDC exchange (docs/spec/security.md#github-oidc): signs the records for the token; stores nothing. */
async function signRecords(c: Context, x: Ctx) {
  const exchange = x.deps.signForGithub ?? fail(notFound('GitHub OIDC signing'));
  const auth = /^Bearer (\S+)$/i.exec(c.req.header('authorization') ?? '')?.[1];
  const token = auth ?? fail(new HttpError(401, 'unauthorized', 'missing GitHub OIDC token'));
  const raw = (await readJson<{ records?: unknown }>(c)).records;
  if (!Array.isArray(raw) || !raw.length || raw.length > 1000) throw bad('records: 1 to 1000 records');
  const records = raw.map((r) => {
    const checked = checkRecord(r);
    return 'error' in checked ? fail(bad(checked.error)) : checked.record;
  });
  const project = (await storeProject(x, true)) ?? fail(notFound('project'));
  return c.json({ records: await exchange(token, records, project) });
}

/** project of the served model (none before the first snapshot), else of the store manifest */
async function storeProject(x: Ctx, manifest: boolean) {
  const id = (await x.model(null).catch(() => undefined))?.project.id;
  const m = !id && manifest && B.StoreManifest.safeParse(await parsed(await objects(x).get(MANIFEST)));
  return id ?? (m ? m.data?.project : undefined);
}

/** Records only a lead may write through the store endpoint (docs/spec/security.md#roles). */
const LEAD_KINDS = ['waiver', 'baseline', 'bundle'];
/** Refuse a log object that is far from now, malformed, holds records of another project or beyond the role. */
async function checkLog(key: string, data: Uint8Array, project: string | undefined, lead: boolean) {
  // the earliest log key wins a merge, so a writer may not pick one far from now (docs/spec/sync.md#merge-rules)
  if (Math.abs(ulidTime(key.slice(7, 33)) - Date.now()) > 3600_000)
    throw bad(`${key}: not within an hour of now`);
  const log = B.LogObject.safeParse(await parsed(data));
  if (!log.success) throw bad(`${key} is not a log object`);
  for (const raw of log.data.records) {
    const r = checkRecord(raw);
    if ('error' in r) throw bad(`${key}: ${r.error}`);
    if (project && r.record.project !== project) throw bad(`${r.record.id} belongs to another project`);
    if (r.record.kind === 'share') throw bad(`${r.record.id}: share records are written by the server only`);
    if (!lead && LEAD_KINDS.includes(r.record.kind))
      throw new HttpError(403, 'forbidden', `${r.record.id}: ${r.record.kind} records need the lead role`);
  }
}

/** Refuse anything but the manifest, valid log objects and matching blobs. */
async function checkObject(x: Ctx, key: string, data: Uint8Array, lead: boolean) {
  if (BLOB_KEY.test(key)) {
    if (!key.endsWith(`/${await B.sha256Hex(data)}`)) throw bad('blob does not match its key');
    return;
  }
  const project = await storeProject(x, key !== MANIFEST);
  if (LOG_KEY.test(key)) return checkLog(key, data, project, lead);
  if (key !== MANIFEST) throw bad(`${key}: only the manifest, log objects and blobs can be written`);
  const m = B.StoreManifest.safeParse(await parsed(data));
  if (!m.success) throw bad(`${key} is not a store manifest`);
  if (project && m.data.project !== project) throw bad(`this store belongs to ${project}`);
}

/** Create-only writes of the manifest, valid log objects and matching blobs (docs/spec/sync.md#store-layout). */
async function putObject(c: Context, x: Ctx) {
  const [key, data] = [storeKey(c), await readBody(c)];
  const store = objects(x);
  const exists = () => errorResponse(new HttpError(412, 'conflict', `${key} exists`));
  if (await store.head(key)) return exists();
  await checkObject(x, key, data, (await x.grant(c)).role === 'lead');
  const opts = { ifNoneMatch: true, contentType: c.req.header('content-type') };
  if (!(await store.put(key, data, opts))) return exists();
  if (key.startsWith('v1/log/')) await x.deps.onLogObject?.(key);
  return c.body(null, 201);
}
