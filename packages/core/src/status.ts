/**
 * Computed done, coverage, readiness gate and plan items (docs/spec/concepts.md#computed-done).
 */
import { GATE_DEFAULTS, type Priority, type WaiverRecord } from '@indx-watch/bundle';
import { byTimeThenId } from './decide.js';
import { byKey } from './model.js';
import {
  type CriterionStatus,
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
  type UseCaseNode,
  type UseCaseStatus,
  type Verdict,
} from './types.js';

const rank = (s: Status) => STATUS_ORDER.indexOf(s);
export const worst = <S extends Status>(xs: readonly S[]): S =>
  xs.reduce((a, b) => (rank(b) < rank(a) ? b : a));
const later = (a: RunView, b: RunView) =>
  byTimeThenId(a.record.ended_at, a.record.id, b.record.ended_at, b.record.id) > 0;
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
    .sort((a, b) => byTimeThenId(a.at, a.id, b.at, b.id))
    .at(-1);
}

/** Decided runs considered for the flake rate (docs/spec/concepts.md#flaky-tests). */
const FLAKY_WINDOW = 10;
function flakiness(runs: RunView[]): TestCaseStatus['flaky'] {
  const decided = runs
    .filter((r) => r.decision.verdict === 'pass' || r.decision.verdict === 'fail')
    .sort((a, b) => byTimeThenId(a.record.ended_at, a.record.id, b.record.ended_at, b.record.id));
  const key = (x: RunView) => `${x.variant}#${x.record.test_case.version}`;
  const seen: { r: RunView; flip: boolean }[] = [];
  const flakes = decided.map((r) => {
    // p: previous run, same variant and version, other execution. A flip counts on the same build or when it
    // reverts p's own flip (p f p); a lone change is a regression or a fix (docs/spec/concepts.md#flaky-tests).
    const p = seen.findLast(({ r: x }) => key(x) === key(r) && x.group !== r.group);
    const flip = !!p && p.r.decision.verdict !== r.decision.verdict;
    seen.push({ r, flip });
    const sameBuild = !!r.record.build.commit && p?.r.record.build.commit === r.record.build.commit;
    return (flip && (sameBuild || !!p?.flip)) || r.judgements.some((j) => j.flaky);
  });
  const window = flakes.slice(-FLAKY_WINDOW);
  const n = window.filter(Boolean).length;
  return n ? { rate: n / window.length, flakes: n, runs: window.length } : undefined;
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
    flaky: flakiness(runs),
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

type Table = Map<string, TestCaseStatus>;

/** Ready criteria of a use case: uncovered without test cases, else the worst non-skipped result. */
function criteriaStatus(uc: UseCaseNode, table: Table): CriterionStatus[] {
  if (!uc.data.criteria.length) return [];
  return uc.criteria
    .filter((c) => acReady(c.data.status))
    .map((c) => {
      const results = c.testCases
        .map((k) => table.get(k)?.status ?? 'untested')
        .filter((s) => s !== 'skipped');
      const status: Status = !c.testCases.length ? 'uncovered' : results.length ? worst(results) : 'untested';
      return { key: c.data.key, status, testCases: c.testCases };
    });
}

/** Computed done: every criterion passes or is waived, with evidence on passes when the gate requires it. */
function isDone(criteria: CriterionStatus[], table: Table, requireEvidence: boolean): boolean {
  const proven = (k: string) => table.get(k)?.status !== 'pass' || table.get(k)?.hasEvidence;
  return (
    criteria.length > 0 &&
    criteria.every((c) => c.status === 'pass' || c.status === 'waived') &&
    (!requireEvidence || criteria.every((c) => c.testCases.every(proven)))
  );
}

/** Use case statuses by key; coverage and `uncovered` count only ready use cases. */
function useCaseStatuses(model: Model, table: Table) {
  const requireEvidence = gateOf(model).require_evidence;
  const useCases: UseCaseStatus[] = [];
  const coverage = { covered: 0, total: 0, uncovered: 0 };
  for (const uc of [...model.useCases.values()].sort((a, b) => byKey(a.data.key, b.data.key))) {
    if (uc.data.status === 'deprecated') continue;
    const criteria = criteriaStatus(uc, table);
    if (isReady(uc.data.status)) {
      coverage.total += criteria.length;
      coverage.covered += criteria.filter((c) => c.testCases.length > 0).length;
      coverage.uncovered += criteria.filter((c) => c.status === 'uncovered').length;
    }
    const { key, title, priority } = uc.data;
    const status = criteria.length ? worst(criteria.map((c) => c.status)) : 'uncovered';
    useCases.push({ key, title, priority, status, done: isDone(criteria, table, requireEvidence), criteria });
  }
  return { useCases, ...coverage };
}

const ZERO_COUNTS = {
  pass: 0,
  fail: 0,
  needs_review: 0,
  untested: 0,
  stale: 0,
  waived: 0,
  uncovered: 0,
  blocked: 0,
  skipped: 0,
};

/** Counts by status of ready test cases; drafts are listed but not counted, like the gate and coverage. */
function countStatuses(model: Model, testCases: TestCaseStatus[], uncovered: number): StatusResult['counts'] {
  const counts = { ...ZERO_COUNTS, uncovered };
  for (const t of testCases)
    if (isReady(model.testCases.get(t.key)!.data.status)) counts[t.status as keyof typeof counts]++;
  return counts;
}

/** Everything `iw status` shows. An empty scope has coverage ratio 1 (nothing to cover). */
export function computeStatus(model: Model, scope: Scope): StatusResult {
  const table = statusTable(model, scope);
  const { useCases, covered, total, uncovered } = useCaseStatuses(model, table);
  const testCases = [...table.values()].sort((a, b) => byKey(a.key, b.key));
  return {
    scope,
    gate: gateFrom(model, scope, table),
    coverage: { covered, total, ratio: total ? covered / total : 1 },
    useCases,
    testCases,
    counts: countStatuses(model, testCases, uncovered),
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

/** A gate check; `items` (offending keys) is kept only when it fails. */
const check = ({ items, ...c }: Required<GateCheck>): GateCheck => (c.passed ? c : { ...c, items });
/** A check over an empty denominator: passes with actual `n/a`. */
const na = (key: string, expected: string): GateCheck => ({ key, passed: true, actual: 'n/a', expected });

/** Inputs of a check over the keys `den`; `bad` are the offending keys listed when it fails. */
interface Over {
  key: string;
  den: string[];
  bad: string[];
}

/** num/den ≥ min; `withRatio` adds the ratio to `actual`. */
type RatioCheck = Over & { num: string[]; min: number; withRatio: boolean };
function ratio({ key, den, bad, num, min, withRatio }: RatioCheck) {
  const expected = `≥ ${min.toFixed(2)}`;
  if (!den.length) return na(key, expected);
  const r = num.length / den.length;
  const actual = `${num.length}/${den.length}${withRatio ? ` (${r.toFixed(2)})` : ''}`;
  return check({ key, passed: r >= min, actual, expected, items: bad });
}

/** At most `max` bad keys; a disabled check reports but always passes. */
function atMost({ key, den, bad, max, enabled = true }: Over & { max: number; enabled?: boolean }) {
  const expected = `≤ ${max}`;
  if (!den.length) return na(key, expected);
  const passed = !enabled || bad.length <= max;
  return check({ key, passed, actual: String(bad.length), expected, items: bad });
}

/** Every key of `den` is good; a disabled check reports but always passes. */
function all(key: string, den: string[], good: string[], enabled: boolean) {
  if (!den.length) return na(key, 'n/a');
  const [actual, expected] = [`${good.length}/${den.length}`, `${den.length}/${den.length}`];
  const items = den.filter((k) => !good.includes(k));
  return check({ key, passed: !enabled || good.length === den.length, actual, expected, items });
}

/** Gated test cases by priority, ready P0 criteria and status lookups for the checks. */
function gateInputs(model: Model, scope: Scope, table: Table) {
  const keys = gateTestCases(model, scope);
  const st = (k: string) => table.get(k) ?? testCaseStatus(model, k, scope);
  const pr = (...ps: Priority[]) => keys.filter((k) => ps.includes(model.testCases.get(k)!.priority));
  const is = (k: string, ...s: Status[]) => s.includes(st(k).status);
  const p0Acs = [...model.useCases.values()]
    .filter((u) => isReady(u.data.status) && u.data.priority === 'P0')
    .flatMap((u) => u.criteria.filter((c) => acReady(c.data.status)));
  const p0 = pr('P0');
  return { p0, p1: pr('P1'), p01: pr('P0', 'P1'), p0Pass: p0.filter((k) => is(k, 'pass')), p0Acs, st, is };
}

function gateFrom(model: Model, scope: Scope, table: Table): GateResult {
  // gate.ignore_unverified: the gate sees only verified records (docs/spec/concepts.md#readiness-gate)
  if (model.verifiedOnly) return evaluateGate(model.verifiedOnly, scope);
  const g = gateOf(model);
  const { p0, p1, p01, p0Pass, p0Acs, st, is } = gateInputs(model, scope, table);
  const acKeys = (cs: typeof p0Acs) => cs.map((c) => c.data.key);
  const p1Ok = (k: string) => is(k, 'pass', 'waived');
  const gated = String(p01.length);
  const needsReview = p01.filter((k) => is(k, 'needs_review'));
  const untested = p01.filter((k) => is(k, 'untested', 'blocked'));
  const stale = p01.filter((k) => st(k).stale);
  const proven = p0Pass.filter((k) => st(k).hasEvidence);
  const checks: GateCheck[] = [
    // nothing gated is never "ready": an empty or P2-only scope fails here, not as n/a everywhere
    check({ key: 'has_gated_tests', passed: p01.length > 0, actual: gated, expected: '≥ 1', items: [] }),
    ratio({
      key: 'p0_coverage',
      num: acKeys(p0Acs.filter((c) => c.testCases.length > 0)),
      den: acKeys(p0Acs),
      min: g.p0_coverage,
      withRatio: false,
      bad: acKeys(p0Acs.filter((c) => !c.testCases.length)),
    }),
    all('p0_all_pass', p0, p0Pass, g.p0_all_pass),
    ratio({
      key: 'p1_pass_rate',
      num: p1.filter(p1Ok),
      den: p1,
      min: g.p1_pass_rate,
      withRatio: true,
      bad: p1.filter((k) => !p1Ok(k)),
    }),
    atMost({ key: 'max_needs_review', den: p01, bad: needsReview, max: g.max_needs_review }),
    atMost({ key: 'max_untested', den: p01, bad: untested, max: g.max_untested }),
    atMost({ key: 'allow_stale', den: p01, bad: stale, max: 0, enabled: !g.allow_stale }),
    all('require_evidence', p0Pass, proven, g.require_evidence),
  ];
  // a definition file that does not load is missing from the model: never ready while one does not
  const bad = model.invalidFiles ?? [];
  const loads = { key: 'valid_definitions', passed: false, actual: `${bad.length}`, expected: '≤ 0' };
  if (bad.length) checks.unshift(check({ ...loads, items: bad }));
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
