/**
 * What to tell a team since the last notification (docs/spec/integrations.md#notifications). Messages only repeat
 * what decide(), evaluateGate() and planItemStatus() say; nothing here is a verdict.
 */
import { evaluateGate } from './status.js';
import type { Model } from './types.js';

export interface NotifyMessage {
  event: 'gate_changed' | 'run_failed' | 'run_needs_review' | 'assigned' | 'approval_waiting';
  text: string;
  url?: string | undefined;
}
/** The part of the project the last notification saw (`cache/notify-state.json`). */
export interface NotifyState {
  v: 1;
  at: string;
  gates: Record<string, boolean>;
  assigned: Record<string, string>;
  drafts: string[];
}

/** Texts in the two languages of the web app; any other language reads English. */
const TEXT = {
  en: {
    ready: (v: string) => `Release ${v} is ready to ship.`,
    notReady: (v: string, n: number) =>
      `Release ${v} is not ready: ${n} ${n === 1 ? 'check fails' : 'checks fail'}.`,
    failed: (k: string, where: string) => `${k} failed${where}.`,
    review: (k: string, where: string) => `${k} needs a review${where}.`,
    assigned: (n: number, plan: string, who: string, keys: string) =>
      `${n} ${n === 1 ? 'test case' : 'test cases'} in ${plan} ${n === 1 ? 'is' : 'are'} assigned to ${who}: ${keys}.`,
    drafts: (n: number, keys: string) =>
      `${n} ${n === 1 ? 'draft waits' : 'drafts wait'} for approval: ${keys}.`,
    in: ' in ',
  },
  ja: {
    ready: (v: string) => `リリース ${v} は出荷できます。`,
    notReady: (v: string, n: number) => `リリース ${v} はまだ出荷できません（満たしていない条件: ${n}）。`,
    failed: (k: string, where: string) => `${k} が失敗しました${where}。`,
    review: (k: string, where: string) => `${k} は確認が必要です${where}。`,
    assigned: (n: number, plan: string, who: string, keys: string) =>
      `${plan} の ${n} 件のテストケースが ${who} に割り当てられました: ${keys}。`,
    drafts: (n: number, keys: string) => `承認待ちの下書きが ${n} 件あります: ${keys}。`,
    in: ' ',
  },
};

/** The state a model is in, to compare with next time. */
export function notifyState(model: Model, at: string): NotifyState {
  const assigned: Record<string, string> = {};
  for (const p of model.plans)
    for (const it of p.items ?? []) if (it.assignee) assigned[`${p.key}#${it.test_case}`] = it.assignee;
  return {
    v: 1,
    at,
    gates: Object.fromEntries(
      open(model).map((r) => [r.version, evaluateGate(model, { release: r.version }).passed]),
    ),
    assigned,
    drafts: drafts(model),
  };
}
const open = (m: Model) => m.releases.filter((r) => r.state !== 'released');
/** Keys of the use cases and test cases that an agent or an import drafted and nobody approved. */
const drafts = (m: Model) =>
  [...m.useCases.values(), ...m.testCases.values()]
    .map((n) => n.data)
    .filter((d) => d.status === 'draft' && (d.origin ?? 'human') !== 'human')
    .map((d) => d.key);

/** The messages for what changed in `model` since `prev`; runs count when recorded after `since` (default `prev.at`). */
export function notifyEvents(
  model: Model,
  prev: NotifyState,
  o: { locale?: string | undefined; appUrl?: string | undefined; since?: string | undefined } = {},
): NotifyMessage[] {
  const x = o.locale === 'ja' ? TEXT.ja : TEXT.en;
  const link = (hash: string) => (o.appUrl ? `${o.appUrl.replace(/\/+$/, '')}/#${hash}` : undefined);
  const out: NotifyMessage[] = [];

  for (const r of open(model)) {
    const gate = evaluateGate(model, { release: r.version });
    if (prev.gates[r.version] === undefined || prev.gates[r.version] === gate.passed) continue;
    const bad = gate.checks.filter((c) => !c.passed).length;
    out.push({
      event: 'gate_changed',
      text: gate.passed ? x.ready(r.version) : x.notReady(r.version, bad),
      url: link('/'),
    });
  }

  const cutoff = o.since ?? prev.at;
  const runs = [...model.runs.values()]
    .filter(
      (v) => !v.retracted && v.record.at > cutoff && ['fail', 'needs_review'].includes(v.decision.verdict),
    )
    .sort((a, b) => (a.record.at + a.record.id < b.record.at + b.record.id ? -1 : 1));
  for (const v of runs) {
    const r = v.record;
    const scope = [r.release, r.environment && `(${r.environment})`].filter(Boolean).join(' ');
    const where = scope ? x.in + scope : '';
    const failed = v.decision.verdict === 'fail';
    out.push({
      event: failed ? 'run_failed' : 'run_needs_review',
      text: (failed ? x.failed : x.review)(r.test_case.key, where),
      url: link(`/runs/${r.id}`),
    });
  }

  const groups = new Map<string, string[]>();
  for (const p of model.plans)
    for (const it of p.items ?? [])
      if (it.assignee && prev.assigned[`${p.key}#${it.test_case}`] !== it.assignee) {
        const k = `${p.key}\n${it.assignee}`;
        groups.set(k, [...(groups.get(k) ?? []), it.test_case]);
      }
  for (const [k, keys] of groups) {
    const [plan = '', who = ''] = k.split('\n');
    out.push({
      event: 'assigned',
      text: x.assigned(keys.length, plan, who, keys.join(', ')),
      url: link(`/tc/${keys[0]}`),
    });
  }

  const fresh = drafts(model).filter((k) => !prev.drafts.includes(k));
  if (fresh.length)
    out.push({
      event: 'approval_waiting',
      text: x.drafts(fresh.length, fresh.join(', ')),
      url: link('/tests'),
    });
  return out;
}
