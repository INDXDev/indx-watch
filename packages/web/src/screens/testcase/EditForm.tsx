/** Workspace mode: edit a test case's title, priority and steps (docs/spec/web.md#editing-in-workspace-mode). */
import { type FormEvent, useState } from 'react';
import { api, type TestCaseDetail } from '../../api';
import { useI18n } from '../../i18n';
import { isBdd } from './bdd';

type StepDraft = { instruction: string; expected: string; k: number };
let nextStep = 0;
const draftsOf = (d: TestCaseDetail): StepDraft[] =>
  d.data.steps.map(({ instruction, expected }) => ({ instruction, expected, k: nextStep++ }));
const plain = (steps: StepDraft[]) => steps.map(({ instruction, expected }) => ({ instruction, expected }));

/** Saves only what changed. */
export function EditForm({ d, done }: { d: TestCaseDetail; done(saved: boolean): void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState(d.data.title);
  const [priority, setPriority] = useState(d.data.priority ?? '');
  const [steps, setSteps] = useState(() => draftsOf(d));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const changed = JSON.stringify(plain(steps)) !== JSON.stringify(plain(draftsOf(d)));
    const input = {
      ...(title !== d.data.title && { title }),
      ...(priority !== (d.data.priority ?? '') && { priority: priority || null }),
      ...(changed && { steps: plain(steps) }),
    };
    setBusy(true);
    await api.editTestCase(d.key, input).then(
      () => done(true),
      (x: Error) => setError(x.message),
    );
    setBusy(false);
  };
  return (
    <form className="tc-focus stack" onSubmit={save}>
      <label className="field">
        <span>{t('tc.titleField')}</span>
        <input value={title} required onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>{t('common.priority')}</span>
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          {['', 'P0', 'P1', 'P2', 'P3'].map((p) => (
            <option key={p} value={p}>
              {p || '—'}
            </option>
          ))}
        </select>
      </label>
      {d.data.steps.some((s) => s.from) ? (
        <p className="callout">{t('ss.editNote')}</p>
      ) : (
        <StepsField steps={steps} setSteps={setSteps} bdd={isBdd(d)} />
      )}
      {error && <p className="callout s-fail">{error}</p>}
      <p className="chips">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {t('tc.save')}
        </button>
        <button type="button" className="btn" onClick={() => done(false)}>
          {t('common.cancel')}
        </button>
      </p>
    </form>
  );
}

/** Each step's instruction and expected result, with remove (but not the last one) and add. */
function StepsField(p: { steps: StepDraft[]; setSteps(s: StepDraft[]): void; bdd: boolean }) {
  const { steps, setSteps, bdd } = p;
  const { t } = useI18n();
  const set = (k: number, field: 'instruction' | 'expected', v: string) =>
    setSteps(steps.map((s) => (s.k === k ? { ...s, [field]: v } : s)));
  const label = {
    instruction: bdd ? 'bdd.when' : 'tc.instruction',
    expected: bdd ? 'bdd.then' : 'tc.expected',
  } as const;
  return (
    <>
      {bdd && <p className="muted small">{t('bdd.editHint')}</p>}
      <ol className="steps">
        {steps.map((s) => (
          <li key={s.k} className="step stack-sm">
            {(['instruction', 'expected'] as const).map((f) => (
              <label key={f} className="field">
                <span>{t(label[f])}</span>
                <textarea value={s[f]} required onChange={(e) => set(s.k, f, e.target.value)} />
              </label>
            ))}
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={steps.length === 1}
              onClick={() => setSteps(steps.filter((x) => x.k !== s.k))}
            >
              {t('tc.removeStep')}
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => setSteps([...steps, { instruction: '', expected: '', k: nextStep++ }])}
      >
        {t('tc.addStep')}
      </button>
    </>
  );
}
