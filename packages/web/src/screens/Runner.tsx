/** Manual runner: step-by-step pass/fail/blocked/skip with screenshots (upload or paste), notes and the final verdict. */

import { useApp } from '../App';
import { api, type TestCaseDetail } from '../api';
import { Load, useApi } from '../ui';
import { Before, Finish, RunHead, SessionBar, StepCard } from './runner/sections';
import { useRun } from './runner/useRun';

export { needsReason, suggestVerdict } from './runner/model';

/** The manual runner; `session` is the queue of test cases this run belongs to (docs/spec/web.md#list-and-focus). */
export function Runner({ tcKey, session }: { tcKey: string; session?: string[] | undefined }) {
  const { scope } = useApp();
  const tc = useApi(() => api.testCase(tcKey, scope), [tcKey, scope.release, scope.env]);
  return (
    <Load state={tc}>{(d) => <Run d={d} session={session?.includes(tcKey) ? session : undefined} />}</Load>
  );
}

function Run({ d, session }: { d: TestCaseDetail; session?: string[] | undefined }) {
  const r = useRun(d, session);
  return (
    <>
      {session && <SessionBar session={session} r={r} />}
      <RunHead d={d} r={r} />
      <Before d={d} r={r} />
      <ol className="run-steps">
        {d.data.steps.map((s, i) => (
          <StepCard key={`${s.instruction}|${s.expected}`} s={s} i={i} r={r} />
        ))}
      </ol>
      <Finish d={d} r={r} />
    </>
  );
}
