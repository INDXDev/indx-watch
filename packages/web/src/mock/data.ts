/**
 * Mock data for `VITE_MOCK=1`. shop.json holds the examples/shop bundle (definitions copied from its TOML files)
 * plus a fixed set of sample results for release v1.2.0 on staging. Statuses there are fixed fixture values, not
 * computed: the real rules live only in packages/core.
 */
import type {
  FixtureDetail,
  ProjectInfo,
  RunDetail,
  SpecTree,
  StatusResult,
  TestCaseDetail,
} from '@indx-watch/server';
import type { PlanView } from '../api';
import shop from './shop.json';

type Run = RunDetail['record'];
const d = shop as unknown as {
  project: ProjectInfo;
  testCases: TestCaseDetail['data'][];
  specTree: SpecTree;
  status: StatusResult;
  fixtures: FixtureDetail[];
  fixtureValues: Record<string, Record<string, string>[]>;
  plans: PlanView[];
  runs: Run[];
  decisions: Record<string, RunDetail['decision']>;
  shots: Record<string, [string, string]>;
  useCaseOf: Record<string, string>;
  priority: Record<string, string>;
  tcStatus: Record<string, string>;
};

export const { project, testCases, fixtures, fixtureValues, plans, runs, decisions, tcStatus } = d;
export const SHOT_LABELS = d.shots;
/** test case number → use case key, and use case key → priority */
export const UC_OF = d.useCaseOf;
export const PRIO = d.priority;
export const specTree = (): SpecTree => structuredClone(d.specTree);
export const status = (): StatusResult => d.status;
/** Current (mock) version of TC-n; TC-8's sample run used an older one, so it is stale. */
export const tcv = (n: number) => `tcv:3f9a1c2b7e${String(n).padStart(2, '0')}`;
