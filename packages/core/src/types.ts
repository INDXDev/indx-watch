/**
 * Domain model computed from a Bundle plus records (docs/architecture.md#core-model).
 * FROZEN CONTRACT for v0.1: additive changes only.
 */
import type {
  AnyRecord,
  Criterion,
  DecisionPolicy,
  DeploymentRecord,
  Environment,
  Feature,
  Fixture,
  FixtureDataFile,
  Judgement,
  Plan,
  Priority,
  Project,
  Release,
  RunRecord,
  TestCase,
  UseCase,
  VerdictValue,
  WaiverRecord,
} from '@indx-watch/bundle';

export type Verdict = VerdictValue;

/** Status of a test case / AC / use case within a scope (docs/spec/concepts.md#computed-done). */
export type Status = 'pass' | 'fail' | 'needs_review' | 'stale' | 'untested' | 'waived' | 'uncovered' | 'blocked' | 'skipped';
/** Order used to pick the worst status: earlier = worse. */
export const STATUS_ORDER: readonly Status[] = [
  'uncovered',
  'fail',
  'needs_review',
  'stale',
  'untested',
  'blocked',
  'waived',
  'skipped',
  'pass',
];

export interface Scope {
  release?: string | undefined;
  environment?: string | undefined;
}

export interface Decision {
  verdict: Verdict;
  /** 1-based rule number in the decision policy table */
  rule: number;
  reason: string;
}

export interface RunView {
  record: RunRecord;
  /** run judgements + later judgement records, in time order */
  judgements: Judgement[];
  decision: Decision;
  /** test case version or a fixture version differs from the current bundle */
  stale: boolean;
}

export interface CriterionNode {
  data: Criterion;
  useCase: string; // UC key
  /** ready test cases covering this AC (keys) */
  testCases: string[];
  /** draft test cases covering it (do not count) */
  draftTestCases: string[];
}

export interface UseCaseNode {
  data: UseCase;
  file: string;
  feature: string; // FEAT key
  criteria: CriterionNode[];
}

export interface FeatureNode {
  data: Feature;
  file: string;
  useCases: UseCaseNode[];
}

export interface TestCaseNode {
  data: TestCase;
  file: string;
  useCase: string;
  version: string;
  /** own priority or highest of covered use cases */
  priority: Priority;
  policy: Required<DecisionPolicy>;
}

export interface FixtureNode {
  data: Fixture;
  file: string;
  version: string;
  dataFiles: FixtureDataFile[];
  /** keys of test cases that reference it */
  usedBy: string[];
}

export interface Model {
  project: Project;
  environments: Environment[];
  releases: Release[];
  plans: Plan[];
  features: FeatureNode[];
  useCases: Map<string, UseCaseNode>; // by key
  testCases: Map<string, TestCaseNode>; // by key
  fixtures: Map<string, FixtureNode>; // by key
  runs: Map<string, RunView>; // by run ID
  waivers: WaiverRecord[];
  deployments: DeploymentRecord[];
  /** any ID or key → key (for parseRef resolution) */
  keyOf(ref: string): string | undefined;
}

export interface TestCaseStatus {
  key: string;
  status: Status;
  latestRun?: string | undefined;
  stale: boolean;
  waived: boolean;
  hasEvidence: boolean;
}

export interface CriterionStatus {
  key: string;
  status: Status;
  testCases: string[];
}

export interface UseCaseStatus {
  key: string;
  title: string;
  priority: Priority;
  status: Status;
  done: boolean;
  criteria: CriterionStatus[];
}

export interface GateCheck {
  key: string;
  passed: boolean;
  actual: string;
  expected: string;
  /** keys of offending test cases / ACs */
  items?: string[];
}

export interface GateResult {
  passed: boolean;
  checks: GateCheck[];
}

export interface StatusResult {
  scope: Scope;
  gate: GateResult;
  coverage: { covered: number; total: number; ratio: number };
  useCases: UseCaseStatus[];
  testCases: TestCaseStatus[];
  counts: Record<'pass' | 'fail' | 'needs_review' | 'untested' | 'stale' | 'waived' | 'uncovered' | 'blocked' | 'skipped', number>;
}

export type PlanItemStatus = 'todo' | 'done' | 'blocked' | 'review';

export type { AnyRecord };
