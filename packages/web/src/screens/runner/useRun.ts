/** State, keyboard/paste handling and saving for the manual runner. */
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../App';
import { api, type TestCaseDetail } from '../../api';
import { useI18n } from '../../i18n';
import { href, leave, navigate } from '../../router';
import { placeholderValues } from '../guide';
import {
  buildRunInput,
  needsReason,
  nowIso,
  type Shot,
  type StepState,
  type StepStatus,
  stepStatus,
  suggestVerdict,
  tickCheck,
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

/** The first step without a result, else the step count (the Result block). Pure; tested. */
export const firstOpen = (steps: StepState[]) => {
  const i = steps.findIndex((s) => !stepStatus(s));
  return i < 0 ? steps.length : i;
};

/** Per-step results, ticks, notes and screenshots, and the open step (target of keys and paste). */
function useSteps(d: TestCaseDetail) {
  const [steps, setSteps] = useState<StepState[]>(() =>
    d.data.steps.map((s) => ({ note: '', shots: [], checks: (s.checks ?? []).map(() => false) })),
  );
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
  /** Records a step result; pass ticks every check and moves on to the next open step. */
  const mark = (i: number, v: StepStatus) => {
    const p = v === 'pass' ? { status: v, checks: steps[i]!.checks.map(() => true) } : { status: v };
    patch(i, p);
    if (v === 'pass') setActive(firstOpen(steps.map((s, j) => (j === i ? { ...s, ...p } : s))));
  };
  const tick = (i: number, j: number, on: boolean) =>
    setSteps((all) => all.map((s, k) => (k === i ? tickCheck(s, j, on) : s)));
  /** Next: the first step still without a result, or the Result block. */
  const advance = () => setActive(firstOpen(steps));
  useWindowEvent('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (files.length === 0 || active >= steps.length) return;
    e.preventDefault();
    addFiles(active, files);
  });
  return { steps, patch, addFiles, active, setActive, mark, tick, advance };
}

/** The environment of a run: the chosen one, else the project default (as the server records it). */
export function useEnv() {
  const { project, scope } = useApp();
  return project.environments.find((e) => e.name === (scope.env ?? project.project.default_environment));
}

/** The manual runner's state; `session` is the queue of test cases this run belongs to. */
export function useRun(d: TestCaseDetail, session: string[] | undefined) {
  const { locale, t } = useI18n();
  const { scope } = useApp();
  const env = useEnv();
  const started = useRef(nowIso());
  const saved = useRef(false);
  const stepState = useSteps(d);
  const { steps, active, mark } = stepState;
  const [chosen, setChosen] = useState<Verdict | undefined>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const verdict = chosen ?? suggestVerdict(steps.map(stepStatus));
  const at = session ? session.indexOf(d.key) : -1;
  const next = session?.[at + 1];
  const recorded = steps.filter(stepStatus).length;
  const uploading = steps.some((s) => s.shots.some((x) => !x.sha256 && !x.error));
  const dirty = recorded > 0 || steps.some((s) => s.note || s.shots.length || s.checks.includes(true));
  const canSave = !!verdict && (!needsReason(verdict) || note.trim() !== '') && !uploading && !busy;

  useWindowEvent('keydown', (e) => {
    if (typing(e) || e.altKey || e.ctrlKey || e.metaKey || active >= steps.length) return;
    const k = e.key.toLowerCase();
    if (KEYS[k]) mark(active, KEYS[k]);
    else if (k === 'n') {
      e.preventDefault();
      document.querySelector<HTMLTextAreaElement>('.run-step.active textarea')?.focus();
    }
  });
  useWindowEvent('beforeunload', (e) => {
    if (dirty && !busy) e.preventDefault();
  });
  // moving to another test case (← / →, swipe, links) asks before dropping unsaved work
  useEffect(() => {
    leave.stay = () => dirty && !saved.current && !window.confirm(t('runner.leave'));
    return () => {
      leave.stay = undefined;
    };
  });

  const save = async () => {
    if (!verdict) return;
    setBusy(true);
    setError(undefined);
    const environment = env?.name ?? scope.env;
    const head = { release: scope.release, environment, started_at: started.current, locale, verdict };
    try {
      const res = await api.createRun(buildRunInput(d, steps, head, note));
      saved.current = true;
      navigate(next ? href.runner(next, session) : href.run(res.run.id));
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };
  const form = { chosen, setChosen, note, setNote, busy, error, verdict, canSave, save, next, recorded };
  return { ...stepState, ...form, env, values: placeholderValues(d.fixtures), uploading };
}

/** What `useRun` returns; the runner's sections read from it. */
export type RunState = ReturnType<typeof useRun>;
