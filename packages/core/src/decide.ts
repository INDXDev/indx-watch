/**
 * 判定ポリシー（docs/spec/concepts.md#decision-policy, ADR 0013）。上から順に評価し、最初に当てはまった規則で決まる。
 */
import type { DecisionPolicy, Judgement, Priority } from '@indx-watch/bundle';
import type { Decision, TestCaseNode, Verdict } from './types.js';

const HUMAN_VERDICTS = new Set(['pass', 'fail', 'blocked', 'skipped']);

/** Timestamps compared as instants ('…:00Z' and '…:00.100Z' mix), then IDs; missing times sort first. */
export const byTimeThenId = (at: string | undefined, a: string, bt: string | undefined, b: string): number =>
  (Date.parse(at ?? '') || 0) - (Date.parse(bt ?? '') || 0) || (a < b ? -1 : a > b ? 1 : 0);

/** Judgement order: by `at`, then `id`. */
export const byAtThenId = (a: Judgement, b: Judgement): number => byTimeThenId(a.at, a.id, b.at, b.id);

/** The facts `decide` needs about a run of `tc`, with its declared judge kinds (rule 8); every caller passes these. */
export const runFacts = (tc: TestCaseNode, reported: 'blocked' | 'skipped' | null) => ({
  ...{ priority: tc.priority, mode: tc.data.mode, reported },
  judges: tc.data.judges?.map((j) => j.kind),
});

export function decide(
  judgements: readonly Judgement[],
  policy: Required<DecisionPolicy>,
  ctx: {
    priority: Priority;
    mode: string;
    reported: 'blocked' | 'skipped' | null;
    /** judge kinds the test case declares; rule 8 needs a judgement of each */
    judges?: readonly string[];
  },
): Decision {
  const js = [...judgements].sort(byAtThenId);
  const d = (verdict: Verdict, rule: number, reason: string): Decision => ({ verdict, rule, reason });
  const conf = (j: Judgement) => j.confidence ?? 0;

  const humans = js.filter((j) => j.kind === 'human');
  const lastHuman = humans.at(-1);
  if (lastHuman) {
    const v = HUMAN_VERDICTS.has(lastHuman.verdict) ? (lastHuman.verdict as Verdict) : 'needs_review';
    return d(
      v,
      1,
      `Human judgement by ${lastHuman.by?.id ?? 'unknown'}${lastHuman.reason ? `: ${lastHuman.reason}` : ''}`,
    );
  }
  const machine = js.filter((j) => j.kind !== 'human');
  const blocked = ctx.reported === 'blocked' || machine.some((j) => j.verdict === 'blocked');
  if (blocked || ctx.reported === 'skipped' || machine.some((j) => j.verdict === 'skipped'))
    return blocked
      ? d('blocked', 2, 'Reported or judged blocked')
      : d('skipped', 2, 'Reported or judged skipped');
  if (js.some((j) => j.kind === 'assert' && j.verdict === 'fail')) return d('fail', 3, 'An assertion failed');
  if (js.some((j) => j.kind === 'llm' && j.verdict === 'fail' && conf(j) >= policy.llm_fail_confidence))
    return d('fail', 4, `An LLM judge failed it with confidence ≥ ${policy.llm_fail_confidence}`);
  const overThreshold = (j: Judgement) =>
    j.diff_ratio === undefined || j.diff_ratio > policy.visual_threshold;
  if (
    js.some((j) => j.kind === 'visual' && (j.verdict === 'diff' || j.verdict === 'fail') && overThreshold(j))
  )
    return d('needs_review', 5, `Visual difference above ${policy.visual_threshold}`);
  if (
    js.some(
      (j) =>
        j.kind === 'llm' &&
        (conf(j) < policy.llm_pass_confidence || j.verdict === 'fail' || j.verdict === 'unknown'),
    )
  )
    return d(
      'needs_review',
      6,
      `An LLM judge is unsure (confidence < ${policy.llm_pass_confidence}) or did not pass`,
    );
  if (policy.require_human_for.includes(ctx.priority) || ctx.mode === 'hybrid')
    return d(
      'needs_review',
      7,
      ctx.mode === 'hybrid' ? 'Hybrid mode needs a human' : `${ctx.priority} needs a human`,
    );
  if (js.length === 0) return d('needs_review', 9, 'No judgements');
  const missing = (ctx.judges ?? []).filter((k) => !js.some((j) => j.kind === k));
  if (missing.length) return d('needs_review', 10, `No ${[...new Set(missing)].join(', ')} judgement yet`);
  if (js.every((j) => j.verdict === 'pass' || (j.kind === 'visual' && j.verdict === 'diff')))
    return d('pass', 8, 'Every judgement passed');
  return d('needs_review', 10, 'Judgements are inconclusive');
}
