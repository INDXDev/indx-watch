/**
 * Computed done, coverage, readiness gate and plan items (docs/spec/concepts.md#computed-done).
 */
import { GATE_DEFAULTS, type Priority, type WaiverRecord } from '@indx-watch/bundle';
import { byKey } from './model.js';
import {
  type GateCheck,
  type GateResult,
  type Model,
  type PlanItemStatus,
  type RunView,
  type Scope,
  STATUS_ORDER,
  type Status,
  type StatusResult,
  type TestCaseStatus,
  type UseCaseStatus,
  type Verdict,
} from './types.js';

const rank = (s: Status) => STATUS_ORDER.indexOf(s);
export const worst = <S extends Status>(xs: readonly S[]): S =>
  xs.reduce((a, b) => (rank(b) < rank(a) ? b : a));
const later = (a: RunView, b: RunView) =>
  a.record.ended_at > b.record.ended_at ||
  (a.record.ended_at === b.record.ended_at && a.record.id > b.record.id);
export const gateOf = (model: Model) => ({ ...GATE_DEFAULTS, ...model.project.gate });

const runIndex = new WeakMap<Model, Map<string, RunView[]>>();
/** Non-retracted runs of a test case (by ID) in a scope. */
export function runsInScope(model: Model, tcId: string, scope: Scope): RunView[] {
  let idx = runIndex.get(model);
  if (!idx) {
    idx = new Map();
    for (const v of model.runs.values())
      idx.set(v.record.test_case.id, [...(idx.get(v.record.test_case.id) ?? []), v]);
    runIndex.set(model, idx);
  }
  return (idx.get(tcId) ?? []).filter(
    (v) =>
      !v.retracted &&
      (scope.release === undefined || v.record.release === scope.release) &&
      (scope.environment === undefined || v.record.environment === scope.environment),
  );
}

/** Latest non-revoked waiver for (release, test case ID), by at then id. */
export function activeWaiver(model: Model, release: string, tcId: string): WaiverRecord | undefined {
  const revoked = new Set(model.waivers.map((w) => w.revokes).filter(Boolean));
  return model.waivers
    .filter((w) => !w.revokes && !revoked.has(w.id) && w.release === release && w.test_case.id === tcId)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1))
    .at(-1);
}

const hasProof = (runs: RunView[]) =>
  runs.some((r) => (r.record.evidence?.length ?? 0) > 0 || r.judgements.some((j) => j.kind === 'assert'));

/** Latest relevant result of one test case in a scope. */
export function testCaseStatus(model: Model, key: string, scope: Scope): TestCaseStatus {
  const node = model.testCases.get(key);
  const empty: TestCaseStatus = { key, status: 'untested', stale: false, waived: false, hasEvidence: false };
  if (!node) return empty;
  const runs = runsInScope(model, node.data.id, scope);
  if (!runs.length) return empty;

  // executions = (variant, group); per variant the execution with the latest run wins
  const execs = new Map<string, RunView[]>();
  for (const r of runs)
    execs.set(`${r.variant}\u0000${r.group}`, [...(execs.get(`${r.variant}\u0000${r.group}`) ?? []), r]);
  const latestOf = (xs: RunView[]) => xs.reduce((a, b) => (later(b, a) ? b : a));
  const perVariant = new Map<string, RunView[]>();
  for (const ex of execs.values()) {
    const v = ex[0]!.variant;
    const cur = perVariant.get(v);
    if (!cur || later(latestOf(ex), latestOf(cur))) perVariant.set(v, ex);
  }
  const allowStale = gateOf(model).allow_stale;
  const variants = [...perVariant.entries()].map(([variant, ex]) => {
    const verdict = worst(ex.map((r) => r.decision.verdict));
    const stale = ex.some((r) => r.stale);
    const worstRun = ex.find((r) => r.decision.verdict === verdict)!;
    const status = (stale && !allowStale ? 'stale' : verdict) as Status;
    return { variant, run: latestOf(ex), worstRun, verdict, stale, status, proof: hasProof(ex) };
  });
  let status = worst(variants.map((v) => v.status));
  const verdict = worst(variants.map((v) => v.verdict)) as Verdict;
  let waived = false;
  if (status === 'fail' && scope.release && node.priority !== 'P0') {
    const w = activeWaiver(model, scope.release, node.data.id);
    const failing = variants.filter((v) => v.status === 'fail');
    if (w?.version && failing.every((v) => v.worstRun.record.test_case.version === w.version)) {
      waived = true;
      status = worst(variants.map((v) => (v.status === 'fail' ? 'waived' : v.status)));
    }
  }
  const passing = variants.filter((v) => v.verdict === 'pass');
  return {
    key,
    status,
    verdict,
    variants: variants.map((v) => ({
      variant: v.variant,
      run: v.run.record.id,
      verdict: v.verdict,
      stale: v.stale,
    })),
    latestRun: variants.map((v) => v.run).reduce((a, b) => (later(b, a) ? b : a)).record.id,
    stale: variants.some((v) => v.stale),
    waived,
    hasEvidence: passing.length > 0 && passing.every((v) => v.proof),
  };
}

const isReady = (s: string | undefined) => (s ?? 'draft') === 'ready';
const acReady = (s: string | undefined) => (s ?? 'ready') === 'ready';

/** Status of every non-deprecated test case, memoized for one computation. */
function statusTable(model: Model, scope: Scope): Map<string, TestCaseStatus> {
  const out = new Map<string, TestCaseStatus>();
  for (const [k, t] of model.testCases)
    if (t.data.status !== 'deprecated') out.set(k, testCaseStatus(model, k, scope));
  return out;
}

/** Everything `iw status` shows. */
export function computeStatus(model: Model, scope: Scope): StatusResult {
  const table = statusTable(model, scope);
  const requireEvidence = gateOf(model).require_evidence;
  const useCases: UseCaseStatus[] = [];
  let covered = 0;
  let total = 0;
  let uncovered = 0;
  for (const uc of [...model.useCases.values()].sort((a, b) => byKey(a.data.key, b.data.key))) {
    if (uc.data.status === 'deprecated') continue;
    const criteria = uc.data.criteria.length
      ? uc.criteria
          .filter((c) => acReady(c.data.status))
          .map((c) => {
            const results = c.testCases
              .map((k) => table.get(k)?.status ?? 'untested')
              .filter((s) => s !== 'skipped');
            const status: Status = !c.testCases.length
              ? 'uncovered'
              : results.length
                ? worst(results)
                : 'untested';
            return { key: c.data.key, status, testCases: c.testCases };
          })
      : [];
    if (isReady(uc.data.status)) {
      total += criteria.length;
      covered += criteria.filter((c) => c.testCases.length > 0).length;
      uncovered += criteria.filter((c) => c.status === 'uncovered').length;
    }
    const done =
      criteria.length > 0 &&
      criteria.every((c) => c.status === 'pass' || c.status === 'waived') &&
      (!requireEvidence ||
        criteria.every((c) =>
          c.testCases.every((k) => table.get(k)?.status !== 'pass' || table.get(k)?.hasEvidence),
        ));
    useCases.push({
      key: uc.data.key,
      title: uc.data.title,
      priority: uc.data.priority,
      status: criteria.length ? worst(criteria.map((c) => c.status)) : 'uncovered',
      done,
      criteria,
    });
  }
  const testCases = [...table.values()].sort((a, b) => byKey(a.key, b.key));
  const counts = {
    pass: 0,
    fail: 0,
    needs_review: 0,
    untested: 0,
    stale: 0,
    waived: 0,
    uncovered,
    blocked: 0,
    skipped: 0,
  };
  for (const t of testCases) counts[t.status as keyof typeof counts]++;
  return {
    scope,
    gate: gateFrom(model, scope, table),
    coverage: { covered, total, ratio: total ? covered / total : 1 },
    useCases,
    testCases,
    counts,
  };
}

/** The readiness gate (docs/spec/concepts.md#readiness-gate). */
export function evaluateGate(model: Model, scope: Scope): GateResult {
  return gateFrom(model, scope, statusTable(model, scope));
}

/** Ready test cases that count towards the gate: the release's plan, when it names one. */
export function gateTestCases(model: Model, scope: Scope): string[] {
  const rel = model.releases.find((r) => r.version === scope.release);
  const plan = rel?.plan ? model.plans.find((p) => p.key === rel.plan) : undefined;
  const inPlan = plan ? new Set((plan.items ?? []).map((i) => i.test_case)) : undefined;
  return [...model.testCases.values()]
    .filter((t) => t.data.status === 'ready' && (!inPlan || inPlan.has(t.data.key)))
    .map((t) => t.data.key)
    .sort(byKey);
}

function gateFrom(model: Model, scope: Scope, table: Map<string, TestCaseStatus>): GateResult {
  const g = gateOf(model);
  const keys = gateTestCases(model, scope);
  const st = (k: string) => table.get(k) ?? testCaseStatus(model, k, scope);
  const pr = (...ps: Priority[]) => keys.filter((k) => ps.includes(model.testCases.get(k)!.priority));
  const check = (
    key: string,
    passed: boolean,
    actual: string,
    expected: string,
    items: string[],
  ): GateCheck => (passed ? { key, passed, actual, expected } : { key, passed, actual, expected, items });
  const na = (key: string, expected: string): GateCheck => ({ key, passed: true, actual: 'n/a', expected });
  const ratio = (
    key: string,
    num: string[],
    den: string[],
    min: number,
    withRatio: boolean,
    bad: string[],
  ) => {
    if (!den.length) return na(key, `≥ ${min.toFixed(2)}`);
    const r = num.length / den.length;
    const actual = `${num.length}/${den.length}${withRatio ? ` (${r.toFixed(2)})` : ''}`;
    return check(key, r >= min, actual, `≥ ${min.toFixed(2)}`, bad);
  };
  const atMost = (key: string, den: string[], bad: string[], max: number, enabled = true) =>
    !den.length
      ? na(key, `≤ ${max}`)
      : check(key, !enabled || bad.length <= max, String(bad.length), `≤ ${max}`, bad);
  const all = (key: string, den: string[], good: string[], enabled: boolean) =>
    !den.length
      ? na(key, 'n/a')
      : check(
          key,
          !enabled || good.length === den.length,
          `${good.length}/${den.length}`,
          `${den.length}/${den.length}`,
          den.filter((k) => !good.includes(k)),
        );

  const p0Acs = [...model.useCases.values()]
    .filter((u) => isReady(u.data.status) && u.data.priority === 'P0')
    .flatMap((u) => u.criteria.filter((c) => acReady(c.data.status)));
  const coveredAcs = p0Acs.filter((c) => c.testCases.length > 0).map((c) => c.data.key);
  const p0 = pr('P0');
  const p1 = pr('P1');
  const p01 = pr('P0', 'P1');
  const is = (k: string, ...s: Status[]) => s.includes(st(k).status);
  const p0Pass = p0.filter((k) => is(k, 'pass'));
  const checks: GateCheck[] = [
    ratio(
      'p0_coverage',
      coveredAcs,
      p0Acs.map((c) => c.data.key),
      g.p0_coverage,
      false,
      p0Acs.filter((c) => !c.testCases.length).map((c) => c.data.key),
    ),
    all('p0_all_pass', p0, p0Pass, g.p0_all_pass),
    ratio(
      'p1_pass_rate',
      p1.filter((k) => is(k, 'pass', 'waived')),
      p1,
      g.p1_pass_rate,
      true,
      p1.filter((k) => !is(k, 'pass', 'waived')),
    ),
    atMost(
      'max_needs_review',
      p01,
      p01.filter((k) => is(k, 'needs_review')),
      g.max_needs_review,
    ),
    atMost(
      'max_untested',
      p01,
      p01.filter((k) => is(k, 'untested', 'blocked')),
      g.max_untested,
    ),
    atMost(
      'allow_stale',
      p01,
      p01.filter((k) => st(k).stale),
      0,
      !g.allow_stale,
    ),
    all(
      'require_evidence',
      p0Pass,
      p0Pass.filter((k) => st(k).hasEvidence),
      g.require_evidence,
    ),
  ];
  return { passed: checks.every((c) => c.passed), checks };
}

/** Status of plan item #itemIndex (0-based); scope = (plan.release, item.environment ?? plan.environment). */
export function planItemStatus(model: Model, planKey: string, itemIndex: number): PlanItemStatus {
  const plan = model.plans.find((p) => p.key === planKey);
  const item = plan?.items?.[itemIndex];
  if (!plan || !item) throw new Error(`Plan item ${planKey}#${itemIndex} not found`);
  const { status } = testCaseStatus(model, item.test_case, {
    release: plan.release,
    environment: item.environment ?? plan.environment,
  });
  if (status === 'untested') return 'todo';
  if (status === 'blocked') return 'blocked';
  if (status === 'needs_review' || status === 'stale') return 'review';
  return 'done';
}
