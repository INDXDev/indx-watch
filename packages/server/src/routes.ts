/**
 * The API routes of createApp (docs/architecture.md#http-api), in two groups: reads and writes (bundle upload, manual
 * runs, reviews, blob uploads). Reports: reports.ts; store endpoints: store-routes.ts.
 */
import * as B from '@indx-watch/bundle';
import {
  approvedBaseline,
  computeStatus,
  decide,
  type FixtureNode,
  type Model,
  ownedFeatures,
  ownedModel,
  runFacts,
} from '@indx-watch/core';
import type { Context, Hono } from 'hono';
import type { Ctx } from './app.js';
import type { BaselineInput, ManualRunInput, ProjectInfo, ReviewInput, RunDetail } from './contract.js';
import { changesOf, guardSharing, saveFixture, writeWorkspace } from './fixtures.js';
import { bad, fail, HttpError, iso, notFound, q, readBody, readJson, scopeOf, sniff } from './http.js';
import { type IssueResult, issueFor } from './issue.js';
import { report } from './reports.js';
import { accessOf } from './secrets.js';
import { checksError } from './tools.js';
import { prepareUpload, type UploadInput } from './upload.js';
import * as V from './views.js';
import { editTestCase, invite, workspaceMode } from './workspace.js';

const VERDICTS = ['pass', 'fail', 'blocked', 'skipped'];
/** A test case by key or ID, else 404. */
const tcOf = (m: Model, k: string) => m.testCases.get(m.keyOf(k) ?? k) ?? fail(notFound(`test case ${k}`));
/** A run by ID, else 404. */
const runOf = (m: Model, id: string) => m.runs.get(id) ?? fail(notFound(`run ${id}`));
const CSP_BLOB = "default-src 'none'; sandbox";
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
  /** a fixture with who has access; a customer is not told, nor the names it is shared with (docs/spec/security.md#sharing) */
  const fixture = async (f: FixtureNode, c: Context) => {
    if ((await x.grant(c)).role !== 'customer')
      return V.fixtureDetail(f, read, accessOf(f.data.shared_with, x.deps.roles));
    return V.fixtureDetail(f.data.shared_with ? { ...f, data: { ...f.data, shared_with: [] } } : f, read);
  };
  get('/api/fixtures', (m, c) => Promise.all([...m.fixtures.values()].map((f) => fixture(f, c))));
  get('/api/fixtures/:key', (m, c) => {
    const key = c.req.param('key')!;
    return fixture(m.fixtures.get(m.keyOf(key) ?? key) ?? fail(notFound(`fixture ${key}`)), c);
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
  app.get('/api/issue', async (c) => {
    if ((await x.grant(c)).role === 'customer')
      throw new HttpError(403, 'forbidden', 'customers cannot open issues');
    const m = await model(c);
    const repo = m.project.github?.repo ?? x.deps.githubRepo;
    const hosted = x.deps.mode === 'hosted' ? new URL(c.req.url).origin : undefined;
    try {
      return c.json(issueFor(m, q(c, 'ref') ?? '', { repo, appUrl: hosted }) satisfies IssueResult);
    } catch (e) {
      const code = (e as { code?: string }).code;
      throw code === 'NOT_FOUND'
        ? notFound(String((e as Error).message))
        : code === 'INVALID_CONFIG'
          ? new HttpError(409, 'conflict', (e as Error).message)
          : e;
    }
  });
  app.get('/api/blobs/:sha', (c) => blob(c, x));
  app.get('/api/report', (c) => report(c, x));
}

/** What the web app offers this role (docs/spec/security.md#roles). */
function abilities({ deps, sharer }: Ctx, m: Model, who: B.Actor, role?: B.Role) {
  const [lead, writer] = [role === 'lead', role === 'lead' || role === 'tester'];
  const files = !!deps.bundleFiles && (workspaceMode(m) || !!deps.publishBundle);
  return {
    ...{ declare: !!deps.declaredIdentity, upload: writer && files, share: sharer(who) && lead },
    ...{ run: role !== 'viewer', review: writer, approve: lead },
    edit: workspaceMode(m) && !!deps.bundleFiles && lead,
    data: writer && files,
    secrets: !!deps.secretsKey,
  };
}

async function projectInfo(c: Context, x: Ctx) {
  const { deps, actor, grant, model } = x;
  // a customer's model has no environment guides or access methods (docs/spec/security.md#roles)
  const [{ problems }, m, { role, who: principal }] = [
    await deps.loadModel(),
    await model(c),
    await grant(c),
  ];
  const customer = role === 'customer';
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
  const github = m.project.github?.repo ?? deps.githubRepo;
  const info: ProjectInfo = {
    project: { key, name, source_locale, locales, default_environment, current_release },
    releases: await Promise.all(m.releases.map(release)),
    environments: await Promise.all(m.environments.map(env)),
    ...{ identity: who, mode: deps.mode, problems: customer ? [] : problems, role },
    ...(github && !customer && { github: { repo: github } }),
    owns: ownedFeatures(m, principal),
    sync: deps.syncInfo?.() ?? { configured: false },
    share: { clone: customer ? null : clone },
    can: abilities(x, m, who, role),
    ...(!customer && deps.roles && { team: deps.roles }),
    ...(deps.readOnly && { readOnly: true }),
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
  const testCase = {
    ...{ key, title, currentVersion },
    ...(i18n && { i18n }),
    ...(t?.data.links && { links: t.data.links }),
  };
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
  // the files of a fixture not shared with this identity are not served (docs/spec/security.md#sharing)
  const all = [...(await model(null)).fixtures.values()];
  const owner = all.find((f) => f.dataFiles.some((d) => (d.pointer?.sha256 ?? d.sha256) === sha));
  const evidence = () => [...m.runs.values()].some((v) => v.record.evidence.some((e) => e.sha256 === sha));
  if (!fx && owner && m.fixtures.get(owner.data.key)?.hidden && !uploads.has(sha) && !evidence())
    throw notFound(`blob ${sha}`);
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
  app.post('/api/fixtures', (c) => saveFixture(c, x, 'create'));
  app.patch('/api/fixtures/:key', (c) => saveFixture(c, x, 'edit'));
  app.delete('/api/fixtures/:key', (c) => saveFixture(c, x, 'delete'));
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

async function uploadBundle(c: Context, x: Ctx) {
  const { deps: d, actor, model } = x;
  const input = await readJson<UploadInput>(c);
  // an empty bucket has no model yet: its first upload is a whole bundle
  const m = await model(c).catch(() => undefined);
  const who = await actor(c);
  const workspace = workspaceMode(m);
  if ((!d.publishBundle && !workspace) || !d.bundleFiles)
    throw new HttpError(403, 'forbidden', 'this server cannot write');
  if (who.kind === 'agent') throw new HttpError(403, 'forbidden', 'agents write drafts with iw new');
  // a tester may add test data, not replace or change specs (docs/spec/security.md#roles)
  const g = await x.grant(c);
  const tester = g.role === 'tester';
  const base = await d.bundleFiles();
  const { next, result, blobs } = await prepareUpload(base, input);
  const specs = result.changes.some((ch) => ch.change !== 'unchanged' && !ch.path.startsWith('fixtures/'));
  if (tester && specs) throw new HttpError(403, 'forbidden', 'a tester uploads test data only');
  guardSharing(base, next, g.who, g.role);
  if (input.dryRun || !result.ok) return c.json(result, input.dryRun || result.ok ? 200 : 422);
  for (const b of blobs) await d.putBlob(b, 'application/octet-stream');
  // workspace mode: the store is the source of truth, so an upload is a set of file records
  if (workspace) return c.json({ ...result, ...(await writeWorkspace(c, x, { m: m!, base, next })) }, 201);
  const snapshot = await d.publishBundle!(next, uploadInfo(who, input.message, changesOf(base, next)));
  return c.json({ ...result, ...(snapshot && { snapshot }) }, 201);
}

/** What publishBundle records of an upload: who, the changed and removed paths and a short message. */
function uploadInfo(actor: B.Actor, message: unknown, changes: ReturnType<typeof changesOf>) {
  const text = typeof message === 'string' ? message.trim().slice(0, 500) : '';
  return { actor, ...changes, ...(text && { message: text }) };
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
