/** The manual runner, opened in place on the test case page (docs/spec/web.md#manual-run-in-place). */

import type { TestCaseDetail } from '../api';
import { useI18n } from '../i18n';
import { stepStatus } from './runner/model';
import { DoneStep, Finish, RunInfo, StepCard } from './runner/sections';
import { useRun } from './runner/useRun';

/** The Steps block as a runner: recorded steps on one line each, the open step, then the Result block. */
export function InlineRun(props: { d: TestCaseDetail; session?: string[] | undefined; close(): void }) {
  const { d, session, close } = props;
  const { t } = useI18n();
  const r = useRun(d, session?.includes(d.key) ? session : undefined);
  const steps = d.data.steps;
  const later = steps.filter((_, i) => i > r.active && !stepStatus(r.steps[i]!)).length;
  return (
    <section className="tc-block" aria-labelledby="steps-h">
      <h2 id="steps-h">{t('tc.steps', { count: steps.length })}</h2>
      <RunInfo d={d} r={r} close={close} />
      <ol className="run-steps">
        {steps.map((s, i) =>
          i === r.active ? (
            <StepCard key={`${s.instruction}|${s.expected}`} s={s} i={i} r={r} />
          ) : i < r.active || stepStatus(r.steps[i]!) ? (
            <DoneStep key={`${s.instruction}|${s.expected}`} s={s} i={i} r={r} />
          ) : null,
        )}
      </ol>
      {later > 0 && <p className="muted small">{t('runner.later', { count: later })}</p>}
      {r.active >= steps.length && <Finish r={r} close={close} />}
    </section>
  );
}
