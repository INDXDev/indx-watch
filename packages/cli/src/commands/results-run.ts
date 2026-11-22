/** Commands that add a run or a judgement to one: record, run and judge, with the helpers they share with results.ts. */
import { readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { type Build, type Judgement, newId, type RunRecord, StepStatus } from '@indx-watch/bundle';
import * as core from '@indx-watch/core';
import { checksError, recordWarnings, testCaseDetail } from '@indx-watch/server';
import { type BrowserProvider, type LlmClient, runAgent } from '@indx-watch/store';
import type { Spec } from '../cli.js';
import * as cx from '../context.js';
import { type Args, B, type Ctx, csv, fail, iso, many, P, pick, S, str } from '../util.js';
import { compareShot, pngShots } from '../visual.js';

export const VERDICT = S('pass | fail | blocked | skipped');
export const verdictOf = (v: unknown) =>
  StepStatus.safeParse(v).data ?? fail('USAGE', '--verdict: pass, fail, blocked or skipped');

const MEDIA = Object.fromEntries(
  'png:image/png jpg:image/jpeg jpeg:image/jpeg gif:image/gif webp:image/webp svg:image/svg+xml mp4:video/mp4 webm:video/webm zip:application/zip json:application/json txt:text/plain log:text/plain html:text/html pdf:application/pdf csv:text/csv'
    .split(' ')
    .map((x) => [`.${x.split(':')[0]}`, x.split(':')[1]]),
);
/** Media type of a file by its extension. */
export const mediaType = (path: string) => MEDIA[extname(path).toLowerCase()] ?? 'application/octet-stream';
const KIND_OF: [RegExp, string][] = [
  [/^image\//, 'screenshot'],
  [/^video\//, 'video'],
  [/^text\/plain/, 'log'],
];
const evidenceKind = (path: string, media: string) =>
  media === 'application/zip' && /trace/i.test(path)
    ? 'trace'
    : (KIND_OF.find(([re]) => re.test(media))?.[1] ?? 'file');

/** Release of a new run (docs/spec/bundle-format.md#releasesversiontoml). */
function runRelease(ctx: Ctx, a: Args, m: core.Model, at: { build: Build; ci: boolean }) {
  const ref = at.build.ref?.replace(/^refs\/(heads|tags)\//, '');
  const byRef = ref ? m.releases.find((r) => r.refs?.includes(ref))?.version : undefined;
  const main = !at.ci || ref === (m.project.default_branch ?? 'main');
  return str(a.release) ?? ctx.env.IW_RELEASE ?? byRef ?? (main ? m.project.current_release : undefined);
}

/** The build of this checkout, with --commit if given. */
export async function buildOf(ctx: Ctx, a: Args): Promise<Build> {
  const build = await cx.contextOf(ctx).build();
  const commit = str(a.commit);
  if (commit && !/^[0-9a-f]{7,64}$/.test(commit)) fail('USAGE', '--commit must be a hex commit SHA');
  return commit ? { ...build, commit } : build;
}

/** Evidence files (<path>[@step]) → blobs in the local replica. */
async function storeEvidence(ctx: Ctx, p: cx.Project, specs: string[]) {
  const evidence = [];
  for (const e of specs) {
    const [, path = e, step] = /^(.*?)(?:@(\d+))?$/.exec(e) ?? [];
    const abs = resolve(ctx.cwd, path);
    const bytes = await readFile(abs).catch(() => fail('NOT_FOUND', `Evidence file ${path} not found`));
    const media_type = mediaType(abs);
    const sha256 = await p.replica.putBlob(new Uint8Array(bytes), media_type);
    const meta = { name: basename(abs), media_type, size: bytes.length, kind: evidenceKind(abs, media_type) };
    evidence.push({ sha256, ...meta, step: step ? +step : undefined });
  }
  return evidence;
}
type Evidence = Awaited<ReturnType<typeof storeEvidence>>;

/** --confidence, between 0 and 1. */
function confidenceOf(a: Args) {
  if (str(a.confidence) === undefined) return undefined;
  const conf = Number(a.confidence);
  if (!(conf >= 0 && conf <= 1)) fail('USAGE', '--confidence must be between 0 and 1');
  return conf;
}

const STEP = /^(\d+)=(pass|fail|blocked|skipped)(?::([\s\S]*))?$/;
const parseSteps = (a: Args) =>
  many(a.step).map((s) => STEP.exec(s) ?? fail('USAGE', `--step ${s}: use <n>=<status>[:note]`));
const TICKS = /^(\d+)=([01](?:,[01])*)$/;
const tick = (s: string) => TICKS.exec(s) ?? fail('USAGE', `--checks ${s}: use <n>=<1|0>[,<1|0>…]`);
/** Parsed --step values with the evidence and the ticked checks (--checks <n>=1,0) of each step. */
function stepsOf(a: Args, tc: core.TestCaseNode, evidence: Evidence) {
  const ticks = new Map(
    many(a.checks)
      .map(tick)
      .map(([, n, t]) => [+n!, t!.split(',').map((x) => x === '1')]),
  );
  const steps = parseSteps(a).map(([, n, status, note]) => {
    const [index, shas] = [+n!, evidence.filter((e) => e.step === +n!).map((e) => e.sha256)];
    return { index, status, note, evidence: shas.length ? shas : undefined, checks: ticks.get(index) };
  });
  for (const n of ticks.keys())
    if (!steps.some((s) => s.index === n)) fail('USAGE', `--checks ${n}=…: give --step ${n}=<status> too`);
  const wrong = steps.map((s) => checksError(tc.data.steps, s)).find(Boolean);
  return wrong ? fail('USAGE', wrong) : steps;
}

/** Fixtures of the test case at their current versions; --rows replaces the rows of a dataset. */
const fixturesOf = (m: core.Model, tc: core.TestCaseNode, rows: string[]) =>
  (tc.data.fixtures ?? []).flatMap((f) => {
    const fx = m.fixtures.get(f.ref);
    const used = fx?.data.kind === 'dataset' && rows.length ? rows : f.rows;
    return fx ? [{ id: fx.data.id, key: fx.data.key, version: fx.version, rows: used }] : [];
  });

/** Judgement kind by actor kind, and the confidence it carries. */
const JUDGE_KIND = { agent: 'llm', ci: 'assert', human: 'human' } as const;
const confidences = (conf?: number) => ({ llm: conf, assert: 1, human: undefined });

/** Run input fields kept from --from (flags given override them). */
const CARRIED = 'fixtures build started_at ended_at reported locale note steps automation';

const record: Spec = {
  description: 'Record a run executed outside the browser runner',
  repeat: ['step', 'evidence', 'checks'],
  args: {
    tc: P('Test case (TC-n)'),
    verdict: VERDICT,
    step: S('<n>=<status>[:note] (repeatable)'),
    checks: S("<n>=1,0,… which of step n's checks hold (repeatable)"),
    evidence: S('<path>[@step] (repeatable)'),
    ...{ note: S(), confidence: S('0-1 (agents)'), release: S(), env: S(), commit: S() },
    rows: S('Dataset rows used, comma-separated'),
    from: S('Run input as JSON (file or -)'),
  },
  async run(ctx, a) {
    const p = await cx.openProject(ctx, a);
    const m = await cx.loadModel(p);
    const tc =
      m.testCases.get(cx.resolveKey(m, str(a.tc)!)) ?? fail('NOT_FOUND', `${a.tc} is not a test case`);
    const input = await cx.fromInput(ctx, a);
    const verdict = str(a.verdict) ? verdictOf(a.verdict) : undefined;
    if (!verdict && !input.judgements) fail('USAGE', '--verdict is required');
    const conf = confidenceOf(a);
    const evidence = await storeEvidence(ctx, p, many(a.evidence));
    const actor = await cx.actorOf(ctx);
    const kind = JUDGE_KIND[actor.kind];
    const [build, ci] = [await buildOf(ctx, a), await cx.contextOf(ctx).ci()];
    const release = runRelease(ctx, a, m, { build, ci: !!ci });
    const warnings = recordWarnings({ kind, conf, verdict, evidence: evidence.length, release });
    const at = iso();
    const confidence = confidences(conf)[kind];
    const judgement = verdict
      ? [{ id: newId('jdg'), kind, verdict, confidence, reason: str(a.note), by: actor, at }]
      : [];
    const steps = stepsOf(a, tc, evidence);
    const reported = verdict === 'blocked' || verdict === 'skipped' ? verdict : null;
    const run = await cx.append(ctx, p, 'run', {
      test_case: { id: tc.data.id, key: tc.data.key, version: tc.version },
      ...{ fixtures: fixturesOf(m, tc, csv(a.rows)), build, ci, ended_at: at, reported },
      ...JSON.parse(JSON.stringify(pick(input, CARRIED))),
      release: release ?? input.release,
      environment: str(a.env) ?? ctx.env.IW_ENV ?? input.environment ?? m.project.default_environment,
      ...(!!str(a.note) && { note: str(a.note) }),
      ...(steps.length > 0 && { steps }),
      evidence: [...((input.evidence as unknown[]) ?? []), ...evidence],
      judgements: [...((input.judgements as unknown[]) ?? []), ...judgement],
    });
    const d = core.decide(run.judgements, tc.policy, core.runFacts(tc, run.reported));
    const text = `Recorded ${run.id} for ${tc.data.key}: ${d.verdict} (rule ${d.rule}: ${d.reason})`;
    return { data: { run, verdict: d.verdict, rule: d.rule }, warnings, text };
  },
};

/** The test case's expected steps and what the run observed, as text for the judge. */
function judgeInput(tc: core.TestCaseNode, view: core.RunView) {
  const run = view.record;
  const results = new Map(run.steps.map((r) => [r.index, r]));
  const expected = tc.data.steps.map((st, i) => `${i + 1}. ${st.instruction} => ${st.expected}`).join('\n');
  const observed = [
    ...tc.data.steps.map((_, i) => {
      const r = results.get(i + 1);
      return `Step ${i + 1}: ${r?.status ?? 'not recorded'}${r?.note ? ` (note: ${r.note})` : ''}`;
    }),
    ...(run.note ? [`Run note: ${run.note}`] : []),
    `Verdict so far: ${view.decision.verdict}`,
  ].join('\n');
  return { expected, observed };
}

type LlmJudge = ReturnType<typeof import('@indx-watch/store/llm').anthropicJudge>;
/** A missing or rejected Anthropic credential is a config error. */
async function claudeErrors<T>(call: Promise<T>) {
  try {
    return await call;
  } catch (e) {
    const msg = (e as Error).message;
    if (/api ?key|auth|credential/i.test(msg))
      fail('INVALID_CONFIG', `No usable Anthropic credential: ${msg}`);
    throw e;
  }
}
/** Ask Claude to judge. */
async function askClaude(model: string | undefined, req: Parameters<LlmJudge['judge']>[0]) {
  const { anthropicJudge } = await import('@indx-watch/store/llm');
  return claudeErrors(anthropicJudge(model ? { model } : {}).judge(req));
}

/** Claude's answer as an llm judgement by the model. */
const llmJudgement = (answer: Awaited<ReturnType<typeof askClaude>>) => ({
  id: newId('jdg'),
  kind: 'llm' as const,
  ...pick(answer, 'verdict confidence reason'),
  by: { kind: 'agent' as const, id: `anthropic:${answer.model}`, via: 'env' as const, model: answer.model },
  at: iso(),
});

/** One visual judgement per PNG screenshot, compared with its approved baseline (docs/spec/concepts.md#visual-baselines). */
async function visualJudgements(
  ctx: Ctx,
  blob: (sha: string) => Promise<Uint8Array | null>,
  m: core.Model,
  tc: core.TestCaseNode,
  run: RunRecord,
) {
  const judge = tc.data.judges?.find((j) => j.kind === 'visual');
  if (!judge) fail('USAGE', `${tc.data.key} declares no visual judge`);
  const shots = pngShots(run, judge!.baseline);
  if (!shots.length) fail('USAGE', `${run.id} has no PNG screenshot ${judge!.baseline ?? ''} to compare`);
  const [by, at] = [await cx.actorOf(ctx), iso()];
  const out = [];
  for (const e of shots) {
    const base = core.approvedBaseline(m, tc.data.id, e.name, run.automation?.project);
    const verdict = compareShot(await blob(e.sha256), base && (await blob(base.sha256)));
    out.push({
      id: newId('jdg'),
      kind: 'visual' as const,
      ...verdict,
      test: e.name,
      baseline: base?.sha256,
      by,
      at,
    });
  }
  return out;
}

const judge: Spec = {
  description:
    "Judge a run: Claude against the test case's llm rubric, or --visual against approved baselines",
  args: {
    run: P('Run ID or prefix'),
    model: S('Claude model (default IW_LLM_MODEL or claude-opus-5-5)'),
    visual: B('Compare the PNG screenshots with their approved baselines (visual judgements)'),
    'dry-run': B('Print the judgement without recording it'),
  },
  async run(ctx, a) {
    const p = await cx.openProject(ctx, a);
    const m = await cx.loadModel(p);
    const view = cx.resolveRun(m, str(a.run)!);
    const run = view.record;
    const blob = (await import('./data.js')).blobReader(ctx, p, a); // lazy: data.ts imports this module
    const tc =
      m.testCases.get(run.test_case.key) ?? fail('NOT_FOUND', `${run.test_case.key} is not in the bundle`);
    if (a.visual) return visualJudge(ctx, a, p, await visualJudgements(ctx, blob, m, tc, run), view);
    const rubric = tc.data.judges?.find((j) => j.kind === 'llm')?.rubric?.filter(Boolean);
    if (!rubric?.length) return fail('USAGE', `${tc.data.key} declares no llm judge with a rubric`);
    const { expected, observed } = judgeInput(tc, view);
    const shot = run.evidence.filter((e) => e.kind === 'screenshot' && e.media_type === 'image/png').at(-1);
    const screenshot = shot ? ((await blob(shot.sha256)) ?? undefined) : undefined;
    const title = `${tc.data.key} ${tc.data.title}`;
    const observation = { url: run.ci?.url ?? '', title, tree: observed, screenshot };
    const answer = await askClaude(str(a.model) ?? ctx.env.IW_LLM_MODEL, { rubric, expected, observation });
    const judgement = llmJudgement(answer);
    const dry = { judgement, verdict: view.decision.verdict, recorded: false };
    if (a['dry-run'])
      return { data: dry, text: `${answer.verdict} (${answer.confidence}): ${answer.reason}` };
    const rec = await cx.append(ctx, p, 'judgement', { run: run.id, judgement });
    const after = (await cx.loadModel(p)).runs.get(run.id)!.decision.verdict;
    const text = `${run.id}: llm ${answer.verdict} (${answer.confidence}) → ${after}: ${answer.reason}`;
    return { data: { judgement: rec.judgement, verdict: after, recorded: true }, text };
  },
};

/** {{FX-3.username}} (first selected row; account fixtures give only the username) and {{env.base_url}}. */
async function placeholders(p: cx.Project, m: core.Model, tc: core.TestCaseNode, env?: object) {
  const values = new Map(Object.entries(env ?? {}).map(([k, v]) => [`env.${k}`, String(v)]));
  const { fixtures } = await testCaseDetail(m, tc.data.key, {}, (f) => p.fs.read(f));
  for (const fx of fixtures)
    for (const [k, v] of Object.entries(fx.values?.[0] ?? {})) values.set(`${fx.key}.${k}`, v);
  return (text: string) => text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (all, ref) => values.get(ref) ?? all);
}

/** A step the agent reported failed is the model's own fail judgement, so the final judge cannot overrule it. */
const agentFail = ({ steps, judgement: j }: Awaited<ReturnType<typeof runAgent>>) =>
  steps.flatMap((r) =>
    r.status === 'fail'
      ? [{ ...j, verdict: 'fail' as const, confidence: 1, reason: `Step ${r.index}: ${r.note}` }]
      : [],
  );

export type AgentPorts = { browser: BrowserProvider; llm: LlmClient };

/** iw run with the given ports (tests pass fakes); the run is recorded with source "agent" and evidence per step. */
export async function runAgentCase(ctx: Ctx, a: Args, ports: () => Promise<AgentPorts>) {
  const p = await cx.openProject(ctx, a);
  const m = await cx.loadModel(p);
  const tc = m.testCases.get(cx.resolveKey(m, str(a.tc)!)) ?? fail('NOT_FOUND', `${a.tc} is not a test case`);
  if (tc.data.mode !== 'agent' && tc.data.mode !== 'hybrid')
    fail('USAGE', `${tc.data.key} is a ${tc.data.mode} test case; iw run executes agent and hybrid ones`);
  const environment = str(a.env) ?? ctx.env.IW_ENV ?? m.project.default_environment;
  const env = m.environments.find((e) => e.name === environment);
  const baseUrl = str(a['base-url']) ?? env?.base_url ?? fail('USAGE', 'No base URL: pass --base-url');
  const max = str(a['max-actions']) === undefined ? 15 : Number(a['max-actions']);
  if (!Number.isInteger(max) || max < 1) fail('USAGE', '--max-actions must be a positive integer');
  const fill = await placeholders(p, m, tc, env);
  const steps = tc.data.steps.map((s) => ({ instruction: fill(s.instruction), expected: fill(s.expected) }));
  const rubric = tc.data.judges?.find((j) => j.kind === 'llm')?.rubric?.filter(Boolean) ?? [];
  const goal = `${tc.data.key} ${tc.data.title}`;
  const started_at = iso();
  const input = { baseUrl, goal, steps, rubric: rubric.length ? rubric : steps.map((s) => s.expected) };
  const out = await runAgent({ ...(await ports()), ...input, maxActions: max });
  const evidence: Evidence = [];
  for (const { index, screenshot } of out.steps.filter((r) => r.screenshot)) {
    const sha256 = await p.replica.putBlob(screenshot!, 'image/png');
    const meta = { name: `step-${index}.png`, media_type: 'image/png', size: screenshot!.length };
    evidence.push({ sha256, ...meta, kind: 'screenshot', step: index });
  }
  const [build, ci] = [await buildOf(ctx, a), await cx.contextOf(ctx).ci()];
  const run = await cx.append(ctx, p, 'run', {
    ...{ test_case: { id: tc.data.id, key: tc.data.key, version: tc.version }, source: 'agent' },
    ...{ fixtures: fixturesOf(m, tc, []), build, ci, started_at, ended_at: iso(), environment },
    release: runRelease(ctx, a, m, { build, ci: !!ci }),
    reported: out.steps.some((r) => r.status === 'blocked') ? 'blocked' : null,
    steps: out.steps.map(({ index, status, note }) => {
      const shas = evidence.filter((e) => e.step === index).map((e) => e.sha256);
      return { index, status, note, evidence: shas.length ? shas : undefined };
    }),
    ...{ evidence, judgements: [out.judgement, ...agentFail(out)].map(llmJudgement) },
  });
  const { decision } = (await cx.loadModel(p)).runs.get(run.id)!;
  const text = `Ran ${tc.data.key}: ${run.steps.map((r) => `step ${r.index} ${r.status}`).join(', ')}; llm ${out.judgement.verdict} (${out.judgement.confidence}): ${out.judgement.reason}\nRecorded ${run.id}: ${decision.verdict} (rule ${decision.rule}: ${decision.reason})`;
  return { data: { run, verdict: decision.verdict, rule: decision.rule }, text };
}

/** The ports of --browser and --model: Playwright or Browser Run, and Claude. */
async function agentPorts(ctx: Ctx, a: Args): Promise<AgentPorts> {
  const { browserRun, playwrightBrowser } = await import('@indx-watch/store/node');
  const where = str(a.browser) ?? 'local';
  const {
    CLOUDFLARE_ACCOUNT_ID: accountId,
    CLOUDFLARE_API_TOKEN: apiToken,
    PW_CHROMIUM_PATH: path,
  } = ctx.env;
  if (where === 'cloudflare' && !(accountId && apiToken))
    fail('INVALID_CONFIG', 'Browser Run needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
  if (where !== 'local' && where !== 'cloudflare') fail('USAGE', '--browser: local or cloudflare');
  const browser =
    where === 'cloudflare'
      ? browserRun({ accountId: accountId!, apiToken: apiToken! })
      : playwrightBrowser(path ? { executablePath: path } : {});
  const { anthropicJudge } = await import('@indx-watch/store/llm');
  const model = str(a.model) ?? ctx.env.IW_LLM_MODEL;
  return { browser, llm: anthropicJudge(model ? { model } : {}) };
}

const run: Spec = {
  description:
    'Run an agent test case: Claude follows its steps in a browser; records the run with evidence per step',
  args: {
    tc: P('Test case (TC-n) with mode agent or hybrid'),
    browser: S('local (Playwright, default) or cloudflare (Browser Run)'),
    'base-url': S('Default: base_url of the environment'),
    model: S('Claude model (default IW_LLM_MODEL or claude-opus-5-5)'),
    'max-actions': S('Actions per step before it is blocked (default 15)'),
    ...{ release: S(), env: S(), commit: S() },
  },
  run: (ctx, a) => claudeErrors(runAgentCase(ctx, a, () => agentPorts(ctx, a))),
};

/** Records (unless --dry-run) the visual judgements of one run. */
async function visualJudge(ctx: Ctx, a: Args, p: cx.Project, judgements: Judgement[], view: core.RunView) {
  const id = view.record.id;
  const line = (j: Judgement) => `${j.test}: visual ${j.verdict}${j.diff_ratio ? ` (${j.diff_ratio})` : ''}`;
  if (a['dry-run'])
    return {
      data: { judgement: judgements[0]!, judgements, verdict: view.decision.verdict, recorded: false },
      text: judgements.map(line).join('\n'),
    };
  for (const judgement of judgements) await cx.append(ctx, p, 'judgement', { run: id, judgement });
  const verdict = (await cx.loadModel(p)).runs.get(id)!.decision.verdict;
  const text = [...judgements.map(line), `${id}: ${verdict}`].join('\n');
  return { data: { judgement: judgements[0]!, judgements, verdict, recorded: true }, text };
}

/** record, run and judge, registered in results.ts. */
export const runCommands = { record, run, judge };
