/** Commands that read status or append records: status, show, list, record, review, waive, retract, deployment add. */
import { readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { type Build, newId, type Problem, StepStatus } from '@indx-watch/bundle';
import * as core from '@indx-watch/core';
import type { Spec } from '../cli.js';
import * as cx from '../context.js';
import { type Args, B, type Ctx, csv, fail, git, iso, many, P, pick, S, str } from '../util.js';

const VERDICT = S('pass | fail | blocked | skipped');
const verdictOf = (v: unknown) =>
  StepStatus.safeParse(v).success
    ? (v as StepStatus)
    : fail('USAGE', '--verdict: pass, fail, blocked or skipped');

const runSummary = (v: core.RunView) => ({
  ...pick(v.record, 'id at source release environment'),
  testCase: v.record.test_case.key,
  version: v.record.test_case.version,
  ...pick(v.decision, 'verdict rule'),
  actor: v.record.actor.id,
  commit: v.record.build.commit,
  ...pick(v, 'stale retracted'),
});
const newest = (x: core.RunView, y: core.RunView) =>
  x.record.at + x.record.id < y.record.at + y.record.id ? 1 : -1;
/** Runs of the given test cases, newest first. */
const runsOf = (m: core.Model, tcs: string[], limit = 10) =>
  [...m.runs.values()]
    .filter((v) => tcs.includes(v.record.test_case.key))
    .sort(newest)
    .slice(0, limit)
    .map(runSummary);

const MEDIA = Object.fromEntries(
  'png:image/png jpg:image/jpeg jpeg:image/jpeg gif:image/gif webp:image/webp svg:image/svg+xml mp4:video/mp4 webm:video/webm zip:application/zip json:application/json txt:text/plain log:text/plain html:text/html pdf:application/pdf csv:text/csv'
    .split(' ')
    .map((x) => [`.${x.split(':')[0]}`, x.split(':')[1]]),
);
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
function runRelease(ctx: Ctx, a: Args, m: core.Model, build: Build, ci: boolean) {
  const ref = build.ref?.replace(/^refs\/(heads|tags)\//, '');
  const byRef = ref ? m.releases.find((r) => r.refs?.includes(ref))?.version : undefined;
  const main = !ci || ref === (m.project.default_branch ?? 'main');
  return str(a.release) ?? ctx.env.IW_RELEASE ?? byRef ?? (main ? m.project.current_release : undefined);
}

async function buildOf(ctx: Ctx, a: Args): Promise<Build> {
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
    const kind = evidenceKind(abs, media_type);
    evidence.push({
      sha256,
      name: basename(abs),
      media_type,
      size: bytes.length,
      kind,
      step: step ? +step : undefined,
    });
  }
  return evidence;
}

function statusText(s: ReturnType<typeof core.computeStatus>, release?: string, env?: string) {
  const counts = Object.entries(s.counts).map(([k, n]) => `${k} ${n}`);
  return [
    `Release ${release ?? '(none)'} · environment ${env ?? 'any'} · gate ${s.gate.passed ? 'PASSED' : 'FAILED'}`,
    ...s.gate.checks.map(
      (c) => `  ${c.passed ? 'ok  ' : 'FAIL'} ${c.key}: ${c.actual} (expected ${c.expected})`,
    ),
    `Coverage: ${s.coverage.covered}/${s.coverage.total} ACs (${Math.round(s.coverage.ratio * 100)}%)`,
    ...s.useCases.flatMap((u) => [
      `${u.key} ${u.priority} ${u.status.padEnd(12)} ${u.title}`,
      ...u.criteria.map((c) => `  ${c.key} ${c.status.padEnd(12)} ${c.testCases.join(' ')}`),
    ]),
    `Counts: ${counts.join(', ')}`,
  ].join('\n');
}

export const resultCommands: Record<string, Spec> = {
  status: {
    description: 'Coverage, use case status and the readiness gate for a release',
    args: {
      ...{ release: S('Default: current_release'), env: S('Default: any') },
      ...{ gate: B('Exit 1 if the gate fails'), sync: B('Run iw sync first') },
    },
    async run(ctx, a) {
      const p = await cx.openProject(ctx, a);
      const store = p.bundle.project.data.store ?? ctx.env.IW_STORE;
      if (a.sync && store) await (await import('./data.js')).dataCommands.sync!.run(ctx, { dir: a.dir });
      const scope = { release: cx.releaseOf(ctx, p, a), environment: str(a.env) ?? ctx.env.IW_ENV };
      const m = await cx.loadModel(p);
      const warnings = cx.checkScope(m, a, scope);
      const s = core.computeStatus(m, scope);
      const data = {
        ...s,
        scope: { release: scope.release ?? null, environment: scope.environment ?? null },
      };
      const text = statusText(s, scope.release, scope.environment);
      const failed = s.gate.checks.filter((c) => !c.passed);
      if (a.gate && !s.gate.passed) fail('GATE_FAILED', 'The readiness gate failed', failed, data, text);
      return { data, warnings, text };
    },
  },

  show: {
    description: 'One entity with resolved references, version and recent runs',
    args: {
      ref: P('UC-n, AC-n.m, TC-n, FX-n, PLAN-n, FEAT-n, env, release or run'),
      versions: B('Git history'),
    },
    async run(ctx, a) {
      const p = await cx.openProject(ctx, a);
      const m = await cx.loadModel(p);
      const ref = str(a.ref)!;
      if (ref.startsWith('run_')) {
        const v = cx.resolveRun(m, ref);
        return { data: { id: v.record.id, ...v } };
      }
      const named = m.environments.find((e) => e.name === ref) ?? m.releases.find((r) => r.version === ref);
      if (named) return { data: { ...named, runs: [] } };
      const key = cx.resolveKey(m, ref);
      const scope = { release: cx.releaseOf(ctx, p, a) };
      const [tc, uc, fx] = [m.testCases.get(key), m.useCases.get(key), m.fixtures.get(key)];
      const plan = m.plans.find((x) => x.key === key);
      const feature = m.features.find((f) => f.data.key === key);
      const ac = [...m.useCases.values()].flatMap((u) => u.criteria).find((c) => c.data.key === key);
      const refs = (c: NonNullable<typeof ac>) => ({
        ...c.data,
        ...pick(c, 'useCase testCases draftTestCases'),
      });
      let e: Record<string, unknown>;
      if (tc)
        e = {
          ...tc.data,
          ...pick(tc, 'file useCase version priority'),
          result: core.testCaseStatus(m, key, scope),
        };
      else if (uc) {
        const result = core.computeStatus(m, scope).useCases.find((u) => u.key === key);
        e = { ...uc.data, ...pick(uc, 'file feature'), criteria: uc.criteria.map(refs), result };
      } else if (fx) e = { ...fx.data, ...pick(fx, 'file version dataFiles usedBy') };
      else if (plan)
        e = {
          ...plan,
          items: plan.items?.map((it, i) => ({ ...it, status: core.planItemStatus(m, key, i) })),
        };
      else if (feature)
        e = { ...feature.data, file: feature.file, useCases: feature.useCases.map((u) => u.data.key) };
      else e = refs(ac ?? fail('NOT_FOUND', `${ref} not found`));
      const covering = uc?.criteria.flatMap((c) => [...c.testCases, ...c.draftTestCases]);
      e.runs = runsOf(m, plan?.items?.map((i) => i.test_case) ?? covering ?? fx?.usedBy ?? [key]);
      if (a.versions && typeof e.file === 'string') {
        const log = git(p.dir, 'log', '--format=%H %cI %an', '--', e.file) ?? '';
        const line = (l: string) => ({ commit: l.slice(0, 40), at: l.split(' ')[1], author: l.slice(62) });
        e.versions = log.split('\n').filter(Boolean).map(line);
      }
      return { data: e };
    },
  },

  list: {
    description: 'List features, ucs, tcs, fixtures, envs, releases, plans or runs',
    args: {
      what: P('features | ucs | tcs | fixtures | envs | releases | plans | runs'),
      status: S('Definition status, computed status or verdict'),
      ...{ tag: S(), priority: S(), mode: S(), uc: S(), tc: S(), release: S(), limit: S() },
    },
    async run(ctx, a) {
      const p = await cx.openProject(ctx, a);
      const m = await cx.loadModel(p);
      const scope = { release: cx.releaseOf(ctx, p, a), environment: ctx.env.IW_ENV };
      const [uc, tc] = [str(a.uc) && cx.resolveKey(m, str(a.uc)!), str(a.tc) && cx.resolveKey(m, str(a.tc)!)];
      const inUc = (t: { useCase: string; data: { covers: string[] } }) =>
        !uc || t.useCase === uc || t.data.covers.some((c) => c.startsWith(`AC-${uc.slice(3)}.`));
      const lists: Record<string, () => Record<string, unknown>[]> = {
        tc: () =>
          [...m.testCases.values()].filter(inUc).map((t) => {
            const st = core.testCaseStatus(m, t.data.key, scope);
            const def = { status: 'draft', ...pick(t.data, 'key id title status mode covers tags') };
            return {
              ...def,
              ...pick(t, 'priority useCase file version'),
              result: st.status,
              latestRun: st.latestRun,
            };
          }),
        uc: () => {
          const st = core.computeStatus(m, scope).useCases;
          return [...m.useCases.values()].map((u) => ({
            ...{
              status: 'draft',
              ...pick(u.data, 'key id title status priority tags'),
              ...pick(u, 'feature file'),
            },
            criteria: u.criteria.map((c) => c.data.key),
            result: st.find((s) => s.key === u.data.key)?.status,
          }));
        },
        feature: () =>
          m.features.map((f) => ({ ...f.data, file: f.file, useCases: f.useCases.map((u) => u.data.key) })),
        fixture: () =>
          [...m.fixtures.values()].map((f) => ({
            ...{
              status: 'draft',
              ...pick(f.data, 'key id title status kind tags'),
              ...pick(f, 'file version usedBy'),
            },
            files: f.dataFiles.map((d) => d.name),
          })),
        env: () => m.environments,
        release: () => m.releases,
        plan: () => m.plans,
        run: () => runsOf(m, [...new Set([...m.runs.values()].map((v) => v.record.test_case.key))], Infinity),
      };
      const what = (str(a.what) ?? '').replace(/s$/, '');
      const list = lists[what] ?? fail('USAGE', `Unknown list ${a.what}; see iw list --help`);
      const has = (x: Record<string, unknown>, k: string, v?: string) =>
        !v || x[k] === v || (Array.isArray(x[k]) && (x[k] as unknown[]).includes(v));
      const s = str(a.status);
      let items = list().filter(
        (x) =>
          (!s || [x.status, x.result, x.verdict].includes(s)) &&
          has(x, 'tags', str(a.tag)) &&
          has(x, 'priority', str(a.priority)) &&
          has(x, 'mode', str(a.mode)) &&
          (what !== 'run' || ((!tc || x.testCase === tc) && has(x, 'release', str(a.release)))),
      );
      if (str(a.limit)) items = items.slice(0, Number(a.limit));
      const label = (x: Record<string, unknown>) => [
        x.key ?? x.id ?? x.name ?? x.version,
        x.result ?? x.verdict ?? x.status ?? x.state,
        x.title ?? x.testCase,
      ];
      return { data: { items }, text: items.map((x) => label(x).join('  ')).join('\n') || '(none)' };
    },
  },

  record: {
    description: 'Record a run executed outside the browser runner',
    repeat: ['step', 'evidence'],
    args: {
      tc: P('Test case (TC-n)'),
      verdict: VERDICT,
      step: S('<n>=<status>[:note] (repeatable)'),
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
      const conf = str(a.confidence) === undefined ? undefined : Number(a.confidence);
      if (conf !== undefined && !(conf >= 0 && conf <= 1))
        fail('USAGE', '--confidence must be between 0 and 1');
      const stepRe = /^(\d+)=(pass|fail|blocked|skipped)(?::([\s\S]*))?$/;
      const parsed = many(a.step).map(
        (s) => stepRe.exec(s) ?? fail('USAGE', `--step ${s}: use <n>=<status>[:note]`),
      );
      const evidence = await storeEvidence(ctx, p, many(a.evidence));
      const steps = parsed.map(([, n, status, note]) => {
        const shas = evidence.filter((e) => e.step === Number(n)).map((e) => e.sha256);
        return { index: Number(n), status, note, evidence: shas.length ? shas : undefined };
      });
      const actor = await cx.actorOf(ctx);
      const kind = actor.kind === 'agent' ? 'llm' : actor.kind === 'ci' ? 'assert' : 'human';
      const warnings: Problem[] = [];
      const warn = (code: string, message: string) => warnings.push({ severity: 'warning', code, message });
      if (kind === 'llm' && conf === undefined) warn('no-confidence', 'Agent verdicts need --confidence');
      if (kind === 'llm' && verdict === 'pass' && !evidence.length)
        warn('no-evidence', 'An agent pass needs evidence');
      const [build, ci] = [await buildOf(ctx, a), await cx.contextOf(ctx).ci()];
      const release = runRelease(ctx, a, m, build, !!ci);
      if (!release) warn('no-release', 'No release for this build; the run does not count towards one');
      const rows = csv(a.rows);
      const fixtures = (tc.data.fixtures ?? []).flatMap((f) => {
        const fx = m.fixtures.get(f.ref);
        const used = fx?.data.kind === 'dataset' && rows.length ? rows : f.rows;
        return fx ? [{ id: fx.data.id, key: fx.data.key, version: fx.version, rows: used }] : [];
      });
      const confidence = kind === 'llm' ? conf : kind === 'assert' ? 1 : undefined;
      const at = iso();
      const judgement = verdict
        ? [{ id: newId('jdg'), kind, verdict, confidence, reason: str(a.note), by: actor, at }]
        : [];
      const run = await cx.append(ctx, p, 'run', {
        test_case: { id: tc.data.id, key: tc.data.key, version: tc.version },
        ...{
          fixtures,
          build,
          ci,
          ended_at: at,
          reported: verdict === 'blocked' || verdict === 'skipped' ? verdict : null,
        },
        ...JSON.parse(
          JSON.stringify(
            pick(input, 'fixtures build started_at ended_at reported locale note steps automation'),
          ),
        ),
        release: release ?? input.release,
        environment: str(a.env) ?? ctx.env.IW_ENV ?? input.environment ?? m.project.default_environment,
        ...(str(a.note) ? { note: str(a.note) } : {}),
        ...(steps.length ? { steps } : {}),
        evidence: [...((input.evidence as unknown[]) ?? []), ...evidence],
        judgements: [...((input.judgements as unknown[]) ?? []), ...judgement],
      });
      const d = core.decide(run.judgements, tc.policy, {
        priority: tc.priority,
        mode: tc.data.mode,
        reported: run.reported,
      });
      const text = `Recorded ${run.id} for ${tc.data.key}: ${d.verdict} (rule ${d.rule}: ${d.reason})`;
      return { data: { run, verdict: d.verdict, rule: d.rule }, warnings, text };
    },
  },

  review: {
    description: 'Add a human judgement to a run (humans only)',
    args: { run: P('Run ID or prefix'), verdict: { ...VERDICT, required: true }, reason: S(undefined, true) },
    async run(ctx, a) {
      const by = await cx.humanOnly(ctx, 'review runs');
      const verdict = verdictOf(a.verdict);
      const p = await cx.openProject(ctx, a);
      const run = cx.resolveRun(await cx.loadModel(p), str(a.run)!).record.id;
      const judgement = { id: newId('jdg'), kind: 'human', verdict, reason: str(a.reason), by, at: iso() };
      const rec = await cx.append(ctx, p, 'judgement', { run, judgement });
      const after = (await cx.loadModel(p)).runs.get(run)!.decision.verdict;
      return { data: { judgement: rec.judgement, verdict: after }, text: `${run}: ${after}` };
    },
  },

  waive: {
    description: 'Accept a known failure of a test case for a release (humans only; not P0)',
    args: { tc: P('Test case (TC-n)', false), release: S(), reason: S(), revoke: S('Waiver ID to cancel') },
    async run(ctx, a) {
      await cx.humanOnly(ctx, 'waive failures');
      const p = await cx.openProject(ctx, a);
      const m = await cx.loadModel(p);
      const revoke = str(a.revoke);
      let fields: Record<string, unknown>;
      if (revoke) {
        const w = m.waivers.find((x) => x.id === revoke) ?? fail('NOT_FOUND', `Waiver ${revoke} not found`);
        fields = {
          ...pick(w, 'release test_case'),
          reason: str(a.reason) ?? `Revoked ${revoke}`,
          revokes: revoke,
        };
      } else {
        const key = cx.resolveKey(m, str(a.tc) ?? fail('USAGE', 'Which test case?'));
        const tc = m.testCases.get(key) ?? fail('NOT_FOUND', `${a.tc} is not a test case`);
        const release = str(a.release) ?? fail('USAGE', '--release is required');
        const reason = str(a.reason) ?? fail('USAGE', '--reason is required');
        if (tc.priority === 'P0') fail('INVALID_INPUT', `${key} is P0; P0 failures cannot be waived`);
        const st = core.testCaseStatus(m, key, { release });
        const run = st.variants?.find((x) => x.verdict === 'fail')?.run ?? st.latestRun;
        fields = { release, test_case: pick(tc.data, 'id key'), reason, version: tc.version, run };
      }
      const waiver = await cx.append(ctx, p, 'waiver', fields);
      return { data: { waiver }, text: `${revoke ? 'Revoked' : 'Waived'} (${waiver.id})` };
    },
  },

  retract: {
    description: 'Hide a run or other record recorded by mistake',
    args: { id: P('Record ID (runs: ID or prefix)'), reason: S(undefined, true) },
    async run(ctx, a) {
      const p = await cx.openProject(ctx, a);
      let target = str(a.id)!;
      if (target.startsWith('run_')) target = cx.resolveRun(await cx.loadModel(p), target).record.id;
      const rec =
        (await p.replica.getRecord(target).catch(() => null)) ??
        fail('NOT_FOUND', `Record ${target} not found`);
      // agents may only take back their own records: hiding someone else's result is a review
      const actor = await cx.actorOf(ctx);
      if (actor.kind === 'agent' && (rec.actor.kind !== 'agent' || rec.actor.id !== actor.id))
        fail('USAGE', `Agents can only retract their own records; ${target} was recorded by ${rec.actor.id}`);
      const retraction = await cx.append(ctx, p, 'retraction', { target, reason: str(a.reason) });
      return { data: { retraction }, text: `Retracted ${target}` };
    },
  },

  'deployment add': {
    description: 'Record that a build was deployed to an environment',
    args: { env: S('Environment', true), release: S(), url: S(), commit: S() },
    async run(ctx, a) {
      const p = await cx.openProject(ctx, a);
      const release = str(a.release) ?? ctx.env.IW_RELEASE;
      const fields = { environment: str(a.env), build: await buildOf(ctx, a), release, url: str(a.url) };
      const deployment = await cx.append(ctx, p, 'deployment', fields);
      return { data: { deployment }, text: `Recorded a deployment to ${fields.environment}` };
    },
  },
};
