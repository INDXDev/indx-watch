/**
 * Pure domain logic. CONTRACT: signatures frozen; implementation T-103.
 */
import type { Bundle, DecisionPolicy, Judgement, Locale, Priority } from '@indx-watch/bundle';
import type {
  AnyRecord,
  Decision,
  GateResult,
  Model,
  PlanItemStatus,
  Scope,
  StatusResult,
  TestCaseStatus,
} from './types.js';

export * from './types.js';

const todo = (): never => {
  throw new Error('not implemented (T-103)');
};

/** Build the model; unknown/invalid records are skipped and reported. */
export function buildModel(bundle: Bundle, records: Iterable<AnyRecord>): { model: Model; warnings: string[] } {
  void bundle;
  void records;
  return todo();
}

/** The decision policy (docs/spec/concepts.md#decision-policy). */
export function decide(
  judgements: readonly Judgement[],
  policy: Required<DecisionPolicy>,
  ctx: { priority: Priority; mode: string; reported: 'blocked' | 'skipped' | null },
): Decision {
  void judgements;
  void policy;
  void ctx;
  return todo();
}

/** Latest relevant result of one test case in a scope. */
export function testCaseStatus(model: Model, key: string, scope: Scope): TestCaseStatus {
  void model;
  void key;
  void scope;
  return todo();
}

/** Everything `iw status` shows. */
export function computeStatus(model: Model, scope: Scope): StatusResult {
  void model;
  void scope;
  return todo();
}

/** The readiness gate (docs/spec/concepts.md#readiness-gate). */
export function evaluateGate(model: Model, scope: Scope): GateResult {
  void model;
  void scope;
  return todo();
}

/** Status of plan item #itemIndex; scope = (plan.release, item.environment ?? plan.environment). */
export function planItemStatus(model: Model, planKey: string, itemIndex: number): PlanItemStatus {
  void model;
  void planKey;
  void itemIndex;
  return todo();
}

/** Resolve a translated field (docs/spec/i18n.md). */
export function localize(
  entity: { i18n?: Partial<Record<Locale, Record<string, unknown>>> | undefined } & Record<string, unknown>,
  field: string,
  locale: Locale,
  opts?: { currentSourceHash?: string; allowStale?: boolean },
): { text: string; locale: Locale; fallback: boolean; stale: boolean } {
  void entity;
  void field;
  void locale;
  void opts;
  return todo();
}

/** Data for a release or plan report (docs/spec/reports.md#contents); rendering lives in the server package. */
export interface ReportData {
  project: { key: string; name: string };
  scope: Scope;
  plan?: string | undefined;
  audience: 'internal' | 'customer';
  generatedAt: string;
  generatedBy: string;
  bundleCommit?: string | undefined;
  cursor?: string | undefined;
  policy: Required<DecisionPolicy>;
  gateThresholds: Record<string, number | boolean>;
  countsByPriority: Record<Priority, Record<string, number>>;
  planItems?: { testCase: string; assignee?: string | undefined; due?: string | undefined; environment?: string | undefined; status: PlanItemStatus }[];
  status: StatusResult;
  failures: { testCase: string; title: string; priority: Priority; status: string; run?: string | undefined; step?: number | undefined; note?: string | undefined; evidence?: string | undefined }[];
  waivers: { testCase: string; reason: string; by: string; at: string }[];
  runs: {
    id: string;
    testCase: string;
    version: string;
    verdict: string;
    actor: string;
    actorKind: string;
    source: string;
    commit?: string | undefined;
    environment?: string | undefined;
    at: string;
    evidence: number;
    ciUrl?: string | undefined;
  }[];
}

export function reportData(
  model: Model,
  scope: Scope,
  opts: { plan?: string; audience: 'internal' | 'customer'; generatedBy: string; now: Date; commit?: string; cursor?: string },
): ReportData {
  void model;
  void scope;
  void opts;
  return todo();
}
