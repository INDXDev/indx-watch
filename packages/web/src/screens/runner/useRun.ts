/** State, keyboard/paste handling and saving for the manual runner. */
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../App';
import { api, type TestCaseDetail } from '../../api';
import { useI18n } from '../../i18n';
import { href, navigate } from '../../router';
import { placeholderValues } from '../TestCase';
import {
  buildRunInput,
  needsReason,
  nowIso,
  type Shot,
  type StepState,
  type StepStatus,
  suggestVerdict,
  type Verdict,
} from './model';

const KEYS: Record<string, StepStatus> = { p: 'pass', f: 'fail', b: 'blocked', s: 'skipped' };
const typing = (e: KeyboardEvent) =>
  /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '');
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Listens on `window` for the component's lifetime; the latest `handler` always runs. */
function useWindowEvent<K extends keyof WindowEventMap>(type: K, handler: (e: WindowEventMap[K]) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listener = (e: WindowEventMap[K]) => ref.current(e);
    window.addEventListener(type, listener);
    return () => window.removeEventListener(type, listener);
  }, [type]);
}

/** Per-step results, notes and screenshots, and the active step (target of keys and paste). */
function useSteps(d: TestCaseDetail) {
  const [steps, setSteps] = useState<StepState[]>(() => d.data.steps.map(() => ({ note: '', shots: [] })));
  const [active, setActive] = useState(0);
  const patch = (i: number, p: Partial<StepState>) =>
    setSteps((all) => all.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const patchShots = (i: number, f: (shots: Shot[]) => Shot[]) =>
    setSteps((all) => all.map((s, j) => (j === i ? { ...s, shots: f(s.shots) } : s)));
  /** Adds screenshots to step `i` and uploads them right away. */
  const addFiles = (i: number, files: File[]) => {
    for (const file of files) {
      const name = file.name && file.name !== 'image.png' ? file.name : `step-${i + 1}-${Date.now()}.png`;
      const shot: Shot = { url: URL.createObjectURL(file), name };
      const update = (p: Partial<Shot>) =>
        patchShots(i, (shots) => shots.map((x) => (x.url === shot.url ? { ...x, ...p } : x)));
      patchShots(i, (shots) => [...shots, shot]);
      api.uploadBlob(file, name).then(
        (r) => update({ sha256: r.sha256 }),
        (e: unknown) => update({ error: message(e) }),
      );
    }
  };
  /** Records a step result; a pass on the active step moves on to the next one. */
  const mark = (i: number, v: StepStatus) => {
    patch(i, { status: v });
    if (v === 'pass' && i === active && i < steps.length - 1) setActive(i + 1);
  };
  useWindowEvent('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(active, files);
  });
  return { steps, patch, addFiles, active, setActive, mark };
}

/** The manual runner's state; `session` is the queue of test cases this run belongs to. */
export function useRun(d: TestCaseDetail, session: string[] | undefined) {
  const { locale } = useI18n();
  const { project, scope } = useApp();
  // a run happens in one environment: the chosen one, else the project default (as the server records it)
  const env = project.environments.find((e) => e.name === (scope.env ?? project.project.default_environment));
  const started = useRef(nowIso());
  const stepState = useSteps(d);
  const { steps, active, mark } = stepState;
  const [chosen, setChosen] = useState<Verdict | undefined>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const verdict = chosen ?? suggestVerdict(steps.map((s) => s.status));
  const at = session ? session.indexOf(d.key) : -1;
  const next = session?.[at + 1];
  const prev = at > 0 ? session?.[at - 1] : undefined;
  const recorded = steps.filter((s) => s.status).length;
  const uploading = steps.some((s) => s.shots.some((x) => !x.sha256 && !x.error));
  const dirty = recorded > 0 || steps.some((s) => s.note || s.shots.length);
  const canSave = !!verdict && (!needsReason(verdict) || note.trim() !== '') && !uploading && !busy;

  useWindowEvent('keydown', (e) => {
    if (typing(e) || e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    const to = e.key === 'ArrowRight' ? next : e.key === 'ArrowLeft' ? prev : undefined;
    if (KEYS[k]) mark(active, KEYS[k]);
    else if (k === 'n') {
      e.preventDefault();
      document.querySelectorAll<HTMLTextAreaElement>('.run-step textarea')[active]?.focus();
    } else if (to) navigate(href.runner(to, session));
  });
  useWindowEvent('beforeunload', (e) => {
    if (dirty && !busy) e.preventDefault();
  });

  const save = async () => {
    if (!verdict) return;
    setBusy(true);
    setError(undefined);
    const environment = env?.name ?? scope.env;
    const head = { release: scope.release, environment, started_at: started.current, locale, verdict };
    try {
      const res = await api.createRun(buildRunInput(d, steps, head, note));
      navigate(next ? href.runner(next, session) : href.run(res.run.id));
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };
  const values = placeholderValues(d.fixtures);
  const form = { chosen, setChosen, note, setNote, busy, error, verdict, canSave, save };
  return { ...stepState, ...form, env, values, at, next, recorded, uploading };
}

/** What `useRun` returns; the runner's sections read from it. */
export type RunState = ReturnType<typeof useRun>;
