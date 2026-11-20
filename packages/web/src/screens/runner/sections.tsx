/** The manual runner's page sections: session bar, heading, "before you start", the step cards and finish. */
import { useApp } from '../../App';
import type { TestCaseDetail } from '../../api';
import { useI18n } from '../../i18n';
import { href } from '../../router';
import { Chip, Icon, Section, Seg, Tx } from '../../ui';
import { needsReason, STEP_STATUSES, type StepState } from './model';
import type { RunState } from './useRun';

/** Position in the session queue with a link that skips to the next test case. */
export function SessionBar({ session, r }: { session: string[]; r: RunState }) {
  const { t } = useI18n();
  return (
    <div className="session" role="status">
      <span>
        <strong>{t('runner.session', { n: r.at + 1, total: session.length })}</strong>
      </span>
      <span className="session-bar" aria-hidden="true">
        <span style={{ width: `${Math.round((r.at / session.length) * 100)}%` }} />
      </span>
      {r.next && (
        <a className="btn btn-sm btn-ghost" href={href.runner(r.next, session)}>
          {t('runner.skip')} →
        </a>
      )}
    </div>
  );
}

/** Title of the test case with the release, environment, reading language and version. */
export function RunHead({ d, r }: { d: TestCaseDetail; r: RunState }) {
  const { t, locale } = useI18n();
  const { scope } = useApp();
  return (
    <div className="page-head">
      <div>
        <p className="eyebrow">
          {t('runner.eyebrow')} · <a href={href.testCase(d.key)}>{d.key}</a>
        </p>
        <h1>
          <Tx of={d.data} field="title" mark />
        </h1>
        <p className="chips">
          <Chip>{scope.release ?? t('scope.noRelease')}</Chip>
          <Chip>{r.env?.title ?? t('scope.allEnvironments')}</Chip>
          <Chip>{t('runner.readingIn', { locale: locale === 'ja' ? '日本語' : 'English' })}</Chip>
          <code>{d.version}</code>
        </p>
      </div>
    </div>
  );
}

/** The fixtures the test case uses, with the first row's values. */
function FixtureList({ fixtures }: { fixtures: TestCaseDetail['fixtures'] }) {
  const { t } = useI18n();
  return (
    <ul className="list small">
      {fixtures.map((fx) => (
        <li key={fx.key}>
          <span className="key">{fx.key}</span> <Tx of={fx} field="title" />
          {fx.values?.[0] &&
            Object.entries(fx.values[0]).map(([k, v]) => (
              <span key={k}>
                {' '}
                {k}: <code>{v}</code>
              </span>
            ))}
          {fx.kind === 'account' && <span className="muted"> · {t('runner.secretHint')}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Where to run, preconditions and fixtures. */
export function Before({ d, r }: { d: TestCaseDetail; r: RunState }) {
  const { t } = useI18n();
  const { env } = r;
  return (
    <Section title={t('runner.before')}>
      <div className="before">
        {env && (
          <div>
            <h3>{t('runner.where')}</h3>
            <p>
              <a href={env.base_url} target="_blank" rel="noreferrer">
                {env.base_url} ↗
              </a>
            </p>
            {env.guide && <p className="pre">{env.guide}</p>}
          </div>
        )}
        {d.data.preconditions && (
          <div>
            <h3>{t('tc.preconditions')}</h3>
            <p>
              <Tx of={d.data} field="preconditions" values={r.values} />
            </p>
          </div>
        )}
        {d.fixtures.length > 0 && (
          <div>
            <h3>{t('tc.fixtures')}</h3>
            <FixtureList fixtures={d.fixtures} />
          </div>
        )}
      </div>
    </Section>
  );
}

/** Progress, the run verdict (suggested from the steps), the reason and the save button. */
export function Finish({ d, r }: { d: TestCaseDetail; r: RunState }) {
  const { t } = useI18n();
  const { verdict } = r;
  return (
    <Section title={t('runner.finish')} id="finish">
      <p className="muted">{t('runner.progress', { done: r.recorded, total: r.steps.length })}</p>
      <Seg
        label={t('runner.verdict')}
        value={verdict}
        options={STEP_STATUSES}
        text={(v) => t(`status.${v}`)}
        onChange={r.setChosen}
        status
        lg
      />
      {r.chosen === undefined && verdict && <p className="muted small">{t('runner.suggested')}</p>}
      <label className="field">
        <span>{t(needsReason(verdict) ? 'runner.reasonRequired' : 'runner.reasonOptional')}</span>
        <textarea
          rows={3}
          value={r.note}
          onChange={(e) => r.setNote(e.target.value)}
          aria-required={needsReason(verdict)}
        />
      </label>
      {r.error && (
        <div className="callout s-fail" role="alert">
          {t('common.error', { message: r.error })}
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={!r.canSave} onClick={r.save}>
          {r.busy ? t('runner.saving') : r.next ? t('runner.saveNext') : t('runner.save')}
        </button>
        <a className="btn btn-ghost" href={href.testCase(d.key)}>
          {t('common.cancel')}
        </a>
        {r.uploading && <span className="muted small">{t('runner.waitUploads')}</span>}
      </div>
      <p className="muted small kbd-hint">{t('runner.keys')}</p>
    </Section>
  );
}

type Step = TestCaseDetail['data']['steps'][number];

/** Thumbnails of a step's screenshots plus the file picker that adds more. */
function Shots({ i, st, r }: { i: number; st: StepState; r: RunState }) {
  const { t } = useI18n();
  return (
    <div className="shots">
      {st.shots.map((x) => (
        <figure key={x.url} className={x.error ? 'shot shot-error' : 'shot'}>
          <img src={x.url} alt={x.name} />
          <figcaption>
            {x.error ? `✕ ${x.error}` : x.sha256 ? `✓ ${x.name}` : t('runner.uploading')}
            <button
              type="button"
              className="link"
              onClick={() => r.patch(i, { shots: st.shots.filter((y) => y !== x) })}
              aria-label={t('runner.removeShot', { name: x.name })}
            >
              ✕
            </button>
          </figcaption>
        </figure>
      ))}
      <label className="drop">
        <input
          type="file"
          accept="image/*"
          multiple
          className="sr"
          onChange={(e) => {
            r.addFiles(i, [...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <span>＋ {t('runner.addShot')}</span>
        <span className="muted small">{t(i === r.active ? 'runner.pasteHere' : 'runner.pasteHint')}</span>
      </label>
    </div>
  );
}

/** A step card; clicking or focusing it makes it the active step (target of keys and paste). */
export function StepCard({ s, i, r }: { s: Step; i: number; r: RunState }) {
  const { t } = useI18n();
  const st = r.steps[i]!;
  const problem = st.status === 'fail' || st.status === 'blocked';
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: focus also sets the active step
    <li
      className={`card run-step${i === r.active ? ' active' : ''}${st.status ? ` done s-${st.status}` : ''}`}
      onClick={() => r.setActive(i)}
      onFocus={() => r.setActive(i)}
    >
      <div className="step-n" aria-hidden="true">
        {st.status ? <Icon status={st.status} /> : i + 1}
      </div>
      <div className="grow stack-sm">
        <h3 className="sr">{t('runner.step', { n: i + 1 })}</h3>
        <p className="instruction">
          <Tx of={s} field="instruction" values={r.values} />
        </p>
        <p className="expected">
          <span className="label">{t('tc.expected')}</span> <Tx of={s} field="expected" values={r.values} />
        </p>
        <Seg
          label={t('runner.stepResult', { n: i + 1 })}
          value={st.status}
          options={STEP_STATUSES}
          text={(v) => t(`status.${v}`)}
          onChange={(v) => r.mark(i, v)}
          status
        />
        <label className="field">
          <span className="sr">{t('runner.note', { n: i + 1 })}</span>
          <textarea
            rows={problem ? 3 : 1}
            placeholder={t(problem ? 'runner.notePlaceholderFail' : 'runner.notePlaceholder')}
            value={st.note}
            onChange={(e) => r.patch(i, { note: e.target.value })}
          />
        </label>
        <Shots i={i} st={st} r={r} />
      </div>
    </li>
  );
}
