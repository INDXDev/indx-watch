/** The manual runner's sections: session bar, run info, the open step, recorded steps and the Result block. */
import { useApp } from '../../App';
import type { TestCaseDetail } from '../../api';
import { useI18n } from '../../i18n';
import { href } from '../../router';
import { Chip, Icon, Rich, Seg, Tx, useChecks } from '../../ui';
import { Kw } from '../testcase/bdd';
import { asksNote, needsReason, STEP_STATUSES, type StepState, stepDone, stepStatus } from './model';
import type { RunState } from './useRun';

/** Position in the session queue with a link that skips to the next test case. */
export function SessionBar({ session, at }: { session: string[]; at: string }) {
  const { t } = useI18n();
  const n = session.indexOf(at);
  const next = session[n + 1];
  return (
    <div className="session" role="status">
      <span>
        <strong>{t('runner.session', { n: n + 1, total: session.length })}</strong>
      </span>
      <span className="session-bar" aria-hidden="true">
        <span style={{ width: `${Math.round((n / session.length) * 100)}%` }} />
      </span>
      {next && (
        <a className="btn btn-sm btn-ghost" href={href.runner(next, session)}>
          {t('runner.skip')} →
        </a>
      )}
    </div>
  );
}

/** The run's release, environment, reading language and version, with Cancel. */
export function RunInfo({ d, r, close }: { d: TestCaseDetail; r: RunState; close(): void }) {
  const { t, locale } = useI18n();
  const { scope } = useApp();
  return (
    <div className="run-info">
      <p className="chips">
        <strong>{t('runner.eyebrow')}</strong>
        <Chip>{scope.release ?? t('scope.noRelease')}</Chip>
        <Chip>{r.env?.title ?? t('scope.allEnvironments')}</Chip>
        <Chip>{t('runner.readingIn', { locale: locale === 'ja' ? '日本語' : 'English' })}</Chip>
        <code className="small">{d.version}</code>
      </p>
      <button type="button" className="btn btn-sm btn-ghost" onClick={close}>
        {t('runner.cancel')}
      </button>
    </div>
  );
}

/** Progress, the run verdict (suggested from the steps), the reason and the save button. */
export function Finish({ r, close }: { r: RunState; close(): void }) {
  const { t } = useI18n();
  const { verdict } = r;
  return (
    <section className="tc-block" aria-labelledby="finish-h">
      <h2 id="finish-h">{t('tc.resultBlock')}</h2>
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
        <button type="button" className="btn btn-ghost" onClick={close}>
          {t('common.cancel')}
        </button>
        {r.uploading && <span className="muted small">{t('runner.waitUploads')}</span>}
      </div>
      <p className="muted small kbd-hint">{t('runner.keys')}</p>
    </section>
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

/** The step's checks as checkboxes; ticking every one suggests pass. */
function Checks({ s, i, r, bdd }: { s: Step; i: number; r: RunState; bdd: boolean }) {
  const texts = useChecks()(s);
  const ticks = r.steps[i]!.checks;
  if (ticks.length === 0) return null;
  return (
    <ul className="checklist">
      {ticks.map((on, j) => (
        <li key={s.checks?.[j] ?? j}>
          <label>
            <input type="checkbox" checked={on} onChange={(e) => r.tick(i, j, e.target.checked)} />
            <span>
              <Kw on={bdd} k="and" />
              <Rich text={texts[j] ?? ''} values={r.values} />
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

/** A recorded step, collapsed to one line; a click reopens it. */
export function DoneStep({ s, i, r }: { s: Step; i: number; r: RunState }) {
  const { t } = useI18n();
  const status = stepStatus(r.steps[i]!);
  return (
    <li className={`run-step done s-${status}`}>
      <button type="button" className="done-line" onClick={() => r.setActive(i)}>
        <span className="step-n" aria-hidden="true">
          {status && <Icon status={status} />}
        </span>
        <span className="grow">
          <span className="sr">{t('runner.step', { n: i + 1 })}: </span>
          <Tx of={s} field="instruction" values={r.values} />
        </span>
        <span className="muted small">{status && t(`status.${status}`)}</span>
      </button>
    </li>
  );
}

/** The open step: instruction, expected result, checks, result, note, screenshots and Next. */
export function StepCard({ s, i, r, bdd }: { s: Step; i: number; r: RunState; bdd: boolean }) {
  const { t } = useI18n();
  const st = r.steps[i]!;
  const status = stepStatus(st);
  const ask = asksNote(st);
  const problem = status === 'fail' || status === 'blocked';
  return (
    <li className={`card run-step active${status ? ` s-${status}` : ''}`}>
      <div className="step-n" aria-hidden="true">
        {i + 1}
      </div>
      <div className="grow stack-sm">
        <h3 className="sr">{t('runner.step', { n: i + 1 })}</h3>
        <p className="instruction">
          <Kw on={bdd} k="when" />
          <Tx of={s} field="instruction" values={r.values} />
        </p>
        <p className="expected">
          <span className={bdd ? 'label gwt' : 'label'}>{t(bdd ? 'bdd.then' : 'tc.expected')}</span>{' '}
          <Tx of={s} field="expected" values={r.values} />
        </p>
        <Checks s={s} i={i} r={r} bdd={bdd} />
        <Seg
          label={t('runner.stepResult', { n: i + 1 })}
          value={status}
          options={STEP_STATUSES}
          text={(v) => t(`status.${v}`)}
          onChange={(v) => r.mark(i, v)}
          status
        />
        {st.status === undefined && status === 'pass' && (
          <p className="muted small">{t('runner.allChecked')}</p>
        )}
        <label className="field">
          <span className={ask ? undefined : 'sr'}>
            {t(ask ? 'runner.noteRequired' : 'runner.note', { n: i + 1 })}
          </span>
          <textarea
            rows={problem ? 3 : 1}
            placeholder={t(problem ? 'runner.notePlaceholderFail' : 'runner.notePlaceholder')}
            value={st.note}
            aria-required={ask}
            onChange={(e) => r.patch(i, { note: e.target.value })}
          />
        </label>
        <Shots i={i} st={st} r={r} />
        <div className="actions">
          <button type="button" className="btn btn-primary" disabled={!stepDone(st)} onClick={r.advance}>
            {t('runner.next')} →
          </button>
          {!status && <span className="muted small">{t('runner.pickResult')}</span>}
        </div>
      </div>
    </li>
  );
}
