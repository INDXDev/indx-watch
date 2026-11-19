/** Manual runner: step-by-step pass/fail/blocked/skip with screenshots (upload or paste), notes and the final verdict. */

import type { ManualRunInput } from '@indx-watch/server';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../App';
import { api, type TestCaseDetail } from '../api';
import { useI18n } from '../i18n';
import { href, navigate } from '../router';
import { Chip, Icon, Load, Section, Seg, Tx, useApi } from '../ui';
import { placeholderValues } from './TestCase';

type StepStatus = 'pass' | 'fail' | 'blocked' | 'skipped';
type Verdict = ManualRunInput['verdict'];
const STEP_STATUSES: StepStatus[] = ['pass', 'fail', 'blocked', 'skipped'];
interface Shot {
  sha256?: string;
  url: string;
  name: string;
  error?: string;
}
interface StepState {
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
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

export function Runner({ tcKey }: { tcKey: string }) {
  const { scope } = useApp();
  const tc = useApi(() => api.testCase(tcKey, scope), [tcKey, scope.release, scope.env]);
  return <Load state={tc}>{(d) => <Run d={d} />}</Load>;
}

function Run({ d }: { d: TestCaseDetail }) {
  const { t, locale } = useI18n();
  const { project, scope } = useApp();
  const env = project.environments.find((e) => e.name === scope.env);
  const values = placeholderValues(d.fixtures);
  const started = useRef(nowIso());
  const [steps, setSteps] = useState<StepState[]>(() => d.data.steps.map(() => ({ note: '', shots: [] })));
  const [active, setActive] = useState(0);
  const [chosen, setChosen] = useState<Verdict | undefined>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const verdict = chosen ?? suggestVerdict(steps.map((s) => s.status));
  const recorded = steps.filter((s) => s.status).length;
  const uploading = steps.some((s) => s.shots.some((x) => !x.sha256 && !x.error));
  const dirty = recorded > 0 || steps.some((s) => s.note || s.shots.length);
  const canSave = !!verdict && (!needsReason(verdict) || note.trim() !== '') && !uploading && !busy;

  const patch = (i: number, p: Partial<StepState>) =>
    setSteps((all) => all.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const addFiles = (i: number, files: File[]) => {
    for (const file of files) {
      const name = file.name && file.name !== 'image.png' ? file.name : `step-${i + 1}-${Date.now()}.png`;
      const shot: Shot = { url: URL.createObjectURL(file), name };
      const update = (p: Partial<Shot>) =>
        setSteps((all) =>
          all.map((s, j) =>
            j === i ? { ...s, shots: s.shots.map((x) => (x.url === shot.url ? { ...x, ...p } : x)) } : s,
          ),
        );
      setSteps((all) => all.map((s, j) => (j === i ? { ...s, shots: [...s.shots, shot] } : s)));
      api.uploadBlob(file, name).then(
        (r) => update({ sha256: r.sha256 }),
        (e: unknown) => update({ error: e instanceof Error ? e.message : String(e) }),
      );
    }
  };
  const addRef = useRef(addFiles);
  addRef.current = addFiles;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (files.length === 0) return;
      e.preventDefault();
      addRef.current(active, files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [active]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty && !busy) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);

  const save = async () => {
    if (!verdict) return;
    setBusy(true);
    setError(undefined);
    const input: ManualRunInput = {
      test_case: d.key,
      release: scope.release,
      environment: scope.env,
      started_at: started.current,
      locale,
      steps: steps.flatMap((s, i) => {
        if (!s.status) return [];
        const evidence = s.shots.flatMap((x) => (x.sha256 ? [x.sha256] : []));
        return [
          {
            index: i + 1,
            status: s.status,
            ...(s.note ? { note: s.note } : {}),
            ...(evidence.length ? { evidence } : {}),
          },
        ];
      }),
      verdict,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(d.fixtures.some((f) => f.rows) ? { rows: d.fixtures.flatMap((f) => f.rows ?? []) } : {}),
    };
    try {
      const res = await api.createRun(input);
      navigate(href.run(res.run.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {t('runner.eyebrow')} · <a href={href.testCase(d.key)}>{d.key}</a>
          </p>
          <h1>
            <Tx of={d.data} field="title" />
          </h1>
          <p className="chips">
            <Chip>{scope.release ?? t('scope.noRelease')}</Chip>
            <Chip>{env?.title ?? t('scope.allEnvironments')}</Chip>
            <Chip>{t('runner.readingIn', { locale: locale === 'ja' ? '日本語' : 'English' })}</Chip>
            <code>{d.version}</code>
          </p>
        </div>
      </div>

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
                <Tx of={d.data} field="preconditions" values={values} />
              </p>
            </div>
          )}
          {d.fixtures.length > 0 && (
            <div>
              <h3>{t('tc.fixtures')}</h3>
              <ul className="list small">
                {d.fixtures.map((fx) => (
                  <li key={fx.key}>
                    <span className="key">{fx.key}</span> {fx.title}
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
            </div>
          )}
        </div>
      </Section>

      <ol className="run-steps">
        {d.data.steps.map((s, i) => {
          const st = steps[i]!;
          return (
            // biome-ignore lint/a11y/useKeyWithClickEvents: focus also sets the active step
            <li
              key={`${s.instruction}|${s.expected}`}
              className={`card run-step${i === active ? ' active' : ''}${st.status ? ` done s-${st.status}` : ''}`}
              onClick={() => setActive(i)}
              onFocus={() => setActive(i)}
            >
              <div className="step-n" aria-hidden="true">
                {st.status ? <Icon status={st.status} /> : i + 1}
              </div>
              <div className="grow stack-sm">
                <h3 className="sr">{t('runner.step', { n: i + 1 })}</h3>
                <p className="instruction">
                  <Tx of={s} field="instruction" values={values} />
                </p>
                <p className="expected">
                  <span className="label">{t('tc.expected')}</span>{' '}
                  <Tx of={s} field="expected" values={values} />
                </p>
                <Seg
                  label={t('runner.stepResult', { n: i + 1 })}
                  value={st.status}
                  options={STEP_STATUSES}
                  text={(v) => t(`status.${v}`)}
                  onChange={(v) => {
                    patch(i, { status: v });
                    if (v === 'pass' && i === active && i < steps.length - 1) setActive(i + 1);
                  }}
                  status
                />
                <label className="field">
                  <span className="sr">{t('runner.note', { n: i + 1 })}</span>
                  <textarea
                    rows={st.status === 'fail' || st.status === 'blocked' ? 3 : 1}
                    placeholder={t(
                      st.status === 'fail' || st.status === 'blocked'
                        ? 'runner.notePlaceholderFail'
                        : 'runner.notePlaceholder',
                    )}
                    value={st.note}
                    onChange={(e) => patch(i, { note: e.target.value })}
                  />
                </label>
                <div className="shots">
                  {st.shots.map((x) => (
                    <figure key={x.url} className={x.error ? 'shot shot-error' : 'shot'}>
                      <img src={x.url} alt={x.name} />
                      <figcaption>
                        {x.error ? `✕ ${x.error}` : x.sha256 ? `✓ ${x.name}` : t('runner.uploading')}
                        <button
                          type="button"
                          className="link"
                          onClick={() => patch(i, { shots: st.shots.filter((y) => y !== x) })}
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
                        addFiles(i, [...(e.target.files ?? [])]);
                        e.target.value = '';
                      }}
                    />
                    <span>＋ {t('runner.addShot')}</span>
                    <span className="muted small">
                      {t(i === active ? 'runner.pasteHere' : 'runner.pasteHint')}
                    </span>
                  </label>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <Section title={t('runner.finish')} id="finish">
        <p className="muted">{t('runner.progress', { done: recorded, total: steps.length })}</p>
        <Seg
          label={t('runner.verdict')}
          value={verdict}
          options={STEP_STATUSES}
          text={(v) => t(`status.${v}`)}
          onChange={setChosen}
          status
          lg
        />
        {chosen === undefined && verdict && <p className="muted small">{t('runner.suggested')}</p>}
        <label className="field">
          <span>{t(needsReason(verdict) ? 'runner.reasonRequired' : 'runner.reasonOptional')}</span>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-required={needsReason(verdict)}
          />
        </label>
        {error && (
          <div className="callout s-fail" role="alert">
            {t('common.error', { message: error })}
          </div>
        )}
        <div className="actions">
          <button type="button" className="btn btn-primary" disabled={!canSave} onClick={save}>
            {busy ? t('runner.saving') : t('runner.save')}
          </button>
          <a className="btn btn-ghost" href={href.testCase(d.key)}>
            {t('common.cancel')}
          </a>
          {uploading && <span className="muted small">{t('runner.waitUploads')}</span>}
        </div>
      </Section>
    </>
  );
}
