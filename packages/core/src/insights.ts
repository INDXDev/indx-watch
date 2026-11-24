/**
 * Insights: trends and progress, counted from status and plan items (docs/spec/concepts.md#insights).
 */
import { byKey } from './model.js';
import { computeStatus, evaluateGate, planItemStatus } from './status.js';
import type { Model, PlanItemStatus, RunView } from './types.js';

export interface ReleaseInsight {
  version: string;
  state: string;
  /** ready test cases */
  tests: number;
  passRate: number | null;
  coverage: number;
  flaky: number;
  gate: boolean;
}
export type AssigneeInsight = { assignee: string | null } & Record<PlanItemStatus, number>;
export interface FeatureInsight {
  key: string;
  title: string;
  tests: number;
  pass: number;
  fail: number;
  open: number;
}
export interface ManualDuration {
  median: number | null;
  samples: number;
}
export interface Insights {
  release: string | null;
  releases: ReleaseInsight[];
  assignees: AssigneeInsight[];
  features: FeatureInsight[];
  manual: ManualDuration & { byRelease: (ManualDuration & { version: string })[] };
}

const RESULT = ['pass', 'fail', 'needs_review', 'stale', 'blocked'];
const DAY = 86400;

/** Median of numbers (mean of the two middle ones for an even count); null when empty. */
const median = (xs: number[]): number | null => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : null;
};

/** Seconds of a finished manual run by a person; undefined for any other run. */
function manualSeconds(v: RunView): number | undefined {
  const r = v.record;
  if (v.retracted || r.automation || r.reported || r.actor.kind !== 'human' || !r.started_at) return;
  const s = (Date.parse(r.ended_at) - Date.parse(r.started_at)) / 1000;
  return s >= 0 && s <= DAY ? s : undefined;
}

const order = (r: { target_date?: string | undefined; version: string }) =>
  `${r.target_date ?? '9999'}|${r.version}`;
const rank = (a: string | null) => (a === null ? 2 : /^(ci|agent:)/.test(a) ? 1 : 0);
const sum = (r: AssigneeInsight) => r.todo + r.review + r.blocked + r.done;

/** The Insights view and `iw insights`; `release` picks the one the assignee and feature tables describe. */
export function insights(model: Model, opts: { release?: string | undefined } = {}): Insights {
  const release = opts.release ?? null;
  const releases = [...model.releases].sort((a, b) =>
    order(a).localeCompare(order(b), 'en', { numeric: true }),
  );
  const rows = releases.map((r): ReleaseInsight => {
    const s = computeStatus(model, { release: r.version });
    const ready = s.testCases.filter((t) => model.testCases.get(t.key)?.data.status === 'ready');
    const decided = ready.filter((t) => RESULT.includes(t.status));
    return {
      version: r.version,
      state: r.state,
      tests: ready.length,
      passRate: decided.length ? decided.filter((t) => t.status === 'pass').length / decided.length : null,
      coverage: s.coverage.ratio,
      flaky: ready.filter((t) => t.flaky).length,
      gate: evaluateGate(model, { release: r.version }).passed,
    };
  });

  const byAssignee = new Map<string | null, AssigneeInsight>();
  for (const p of model.plans.filter((p) => !release || p.release === release))
    (p.items ?? []).forEach((it, i) => {
      const who = it.assignee ?? null;
      const row = byAssignee.get(who) ?? { assignee: who, todo: 0, review: 0, blocked: 0, done: 0 };
      row[planItemStatus(model, p.key, i)]++;
      byAssignee.set(who, row);
    });
  const assignees = [...byAssignee.values()].sort(
    (a, b) =>
      rank(a.assignee) - rank(b.assignee) ||
      sum(b) - sum(a) ||
      String(a.assignee).localeCompare(String(b.assignee)),
  );

  const status = computeStatus(model, { release: release ?? undefined });
  const features = model.features
    .map((f): FeatureInsight => {
      const mine = status.testCases.filter((t) => {
        const node = model.testCases.get(t.key)!;
        return node.data.status === 'ready' && model.useCases.get(node.useCase)?.feature === f.data.key;
      });
      const n = (...xs: string[]) => mine.filter((t) => xs.includes(t.status)).length;
      const [pass, fail] = [n('pass', 'waived'), n('fail')];
      return {
        key: f.data.key,
        title: f.data.title,
        tests: mine.length,
        pass,
        fail,
        open: mine.length - pass - fail,
      };
    })
    .sort((a, b) => byKey(a.key, b.key));

  const per = new Map<string, number[]>();
  for (const v of model.runs.values()) {
    const s = manualSeconds(v);
    if (s !== undefined) per.set(v.record.release ?? '', [...(per.get(v.record.release ?? '') ?? []), s]);
  }
  const all = [...per.values()].flat();
  const byRelease = rows
    .filter((r) => per.has(r.version))
    .map((r) => ({
      version: r.version,
      median: median(per.get(r.version)!),
      samples: per.get(r.version)!.length,
    }));
  return {
    release,
    releases: rows,
    assignees,
    features,
    manual: { median: median(all), samples: all.length, byRelease },
  };
}
