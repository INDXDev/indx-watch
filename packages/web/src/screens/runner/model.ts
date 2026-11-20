/** Pure model of the manual runner: step state, the suggested verdict and the run input it saves. */
import type { ManualRunInput } from '@indx-watch/server';
import type { TestCaseDetail } from '../../api';

/** A step's recorded result. */
export type StepStatus = 'pass' | 'fail' | 'blocked' | 'skipped';
/** The tester's verdict for the whole run. */
export type Verdict = ManualRunInput['verdict'];
/** Results offered for a step and for the run, in display order. */
export const STEP_STATUSES: StepStatus[] = ['pass', 'fail', 'blocked', 'skipped'];
/** A screenshot attached to a step; `sha256` is set once uploaded. */
export interface Shot {
  sha256?: string;
  url: string;
  name: string;
  error?: string;
}
/** What the tester has recorded for one step. */
export interface StepState {
  status?: StepStatus | undefined;
  note: string;
  shots: Shot[];
}

/** Default for the tester's verdict from the step results (they can change it). Pure; tested. */
export function suggestVerdict(statuses: (StepStatus | undefined)[]): Verdict | undefined {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('blocked')) return 'blocked';
  if (statuses.some((s) => s === undefined)) return undefined;
  return statuses.every((s) => s === 'skipped') ? 'skipped' : 'pass';
}
/** A reason is required for every verdict except pass (docs/spec/concepts.md#decision-policy). */
export const needsReason = (v: Verdict | undefined) => v !== undefined && v !== 'pass';
/** Now as an ISO timestamp without milliseconds. */
export const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

/** A recorded step as the API takes it; unrecorded steps are left out. */
function stepResult(s: StepState, i: number): ManualRunInput['steps'] {
  if (!s.status) return [];
  const evidence = s.shots.flatMap((x) => (x.sha256 ? [x.sha256] : []));
  const extra = { ...(s.note ? { note: s.note } : {}), ...(evidence.length ? { evidence } : {}) };
  return [{ index: i + 1, status: s.status, ...extra }];
}

/** Run fields that come from the scope, the session and the tester's verdict. */
export type RunHeader = Pick<ManualRunInput, 'release' | 'environment' | 'started_at' | 'locale' | 'verdict'>;

/** The `POST /api/runs` body for the test case, its recorded steps and the tester's (trimmed) note. */
export function buildRunInput(
  d: TestCaseDetail,
  steps: StepState[],
  head: RunHeader,
  note: string,
): ManualRunInput {
  const reason = note.trim();
  return {
    test_case: d.key,
    ...head,
    steps: steps.flatMap(stepResult),
    ...(reason ? { note: reason } : {}),
    ...(d.fixtures.some((f) => f.rows) ? { rows: d.fixtures.flatMap((f) => f.rows ?? []) } : {}),
  };
}
