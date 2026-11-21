/** Commands that read status or append records: status, impact, show, list, record, review, judge, waive, retract, deployment add. */
import { relative } from 'node:path';
import { newId } from '@indx-watch/bundle';
import * as core from '@indx-watch/core';
import { listItems, showEntity, statusData } from '@indx-watch/server';
import type { Spec } from '../cli.js';
import * as cx from '../context.js';
import { B, csv, fail, git, iso, P, pick, S, str } from '../util.js';

const FILTERS = ['status', 'tag', 'priority', 'mode', 'uc', 'tc', 'release'] as const;

import { buildOf, runCommands, VERDICT, verdictOf } from './results-run.js';

export { mediaType } from './results-run.js';

function statusText(s: ReturnType<typeof statusData>, release?: string, env?: string) {
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
      const data = statusData(m, scope);
      const text = statusText(data, scope.release, scope.environment);
      const failed = data.gate.checks.filter((c) => !c.passed);
      if (a.gate && !data.gate.passed) fail('GATE_FAILED', 'The readiness gate failed', failed, data, text);
      return { data, warnings, text };
    },
  },

  impact: {
    description: 'Suggest the test cases a change touches (changed files, [automation].files)',
    args: {
      changed: S('Changed paths from the repository root, comma-separated or repeated; - reads stdin'),
      base: S('Use git diff --name-only <ref>...HEAD'),
    },
    repeat: ['changed'],
    async run(ctx, a) {
      const p = await cx.openProject(ctx, a);
      const base = str(a.base);
      const given = csv(a.changed);
      const diff = base
        ? git(p.root, '-c', 'core.quotePath=false', 'diff', '--name-only', `${base}...HEAD`)
        : '';
      if (diff === null) fail('EXTERNAL_TOOL', `git diff --name-only ${base}...HEAD failed in ${p.root}`);
      if (!base && !given.length) fail('USAGE', 'Pass --changed <paths> or --base <ref>');
      const stdin = given.includes('-') ? (await ctx.stdin()).split('\n') : [];
      const all = [...given, ...stdin, ...diff!.split('\n')]
        .map((f) => f.trim())
        .filter((f) => f && f !== '-');
      const changed = [...new Set(all)];
      const rel = relative(p.root, p.dir).replaceAll('\\', '/');
      const m = core.buildModel(p.bundle, []).model;
      const testCases = core.impactedTestCases(m, changed, rel && `${rel}/`);
      const n = (k: number, what: string) => `${k} ${what}${k === 1 ? '' : 's'}`;
      const why = (t: core.ImpactSuggestion) => t.reasons.map((r) => `${r.kind} \`${r.file}\``).join(', ');
      const text = [
        '### Suggested test cases\n',
        testCases.length
          ? `${n(testCases.length, 'test case')} relate to the ${n(changed.length, 'changed file')}:\n`
          : `No test case is linked to the ${n(changed.length, 'changed file')}.`,
        ...testCases.map((t) => `- **${t.key}** ${t.title} (${t.priority}, ${t.status}): ${why(t)}`),
      ].join('\n');
      return { data: { base: base ?? null, changed, testCases }, text };
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
      const e = showEntity(await cx.loadModel(p), str(a.ref)!, { release: cx.releaseOf(ctx, p, a) });
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
      const scope = { release: cx.releaseOf(ctx, p, a), environment: ctx.env.IW_ENV };
      const f = Object.fromEntries(FILTERS.map((k) => [k, str(a[k])]));
      const limit = str(a.limit) ? Number(a.limit) : undefined;
      const items = listItems(await cx.loadModel(p), str(a.what) ?? '', f, scope, limit);
      const label = (x: Record<string, unknown>) => [
        x.key ?? x.id ?? x.name ?? x.version,
        x.result ?? x.verdict ?? x.status ?? x.state,
        x.title ?? x.testCase,
      ];
      return { data: { items }, text: items.map((x) => label(x).join('  ')).join('\n') || '(none)' };
    },
  },

  record: runCommands.record,

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

  judge: runCommands.judge,

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
