/** The plan in Release details: who has what, bulk assign, Split, Take and Give back (docs/spec/web.md#home). */
import { type FormEvent, useState } from 'react';
import { useApp } from '../App';
import { type AssignResult, api, type PlanView } from '../api';
import { type MsgKey, useI18n } from '../i18n';
import { href } from '../router';
import { Badge, Chip, Dialog, Section, THead, txt } from '../ui';

type Item = NonNullable<PlanView['items']>[number];
type Counts = { total: number; todo: number; done: number; blocked: number; review: number };
const SEGMENTS = ['done', 'review', 'blocked', 'todo'] as const;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One row of the board: the count, a bar split by status and the same numbers as text. */
function BoardRow({ name, c, me }: { name: string; c: Counts; me?: boolean }) {
  const { t } = useI18n();
  const text = t('assign.counts', c);
  return (
    <li>
      <span className="board-name">
        {name} {me && <Chip tone="accent">{t('plan.you')}</Chip>}
      </span>
      <strong className="board-n">{c.total}</strong>
      <span className="board-bar">
        <span className="stack-bar" role="img" aria-label={text}>
          {SEGMENTS.map((k) => c[k] > 0 && <i key={k} className={`seg-${k}`} style={{ flex: c[k] }} />)}
        </span>
        <span className="small muted">{text}</span>
      </span>
    </li>
  );
}

function Board({ plan }: { plan: PlanView }) {
  const { t } = useI18n();
  const me = useApp().project.identity.id;
  const b = plan.board;
  if (!b) return null;
  return (
    <div className="board-wrap">
      <ul className="board" aria-label={t('assign.board')}>
        {b.rows.map((r) => (
          <BoardRow key={r.assignee} name={r.assignee} c={r} me={r.assignee === me} />
        ))}
        {b.unassigned.total > 0 && <BoardRow name={t('assign.unassigned')} c={b.unassigned} />}
      </ul>
      {plan.mix && plan.mix.total > 0 && (
        <p className="small muted board-mix">{t('assign.mix', { ...plan.mix })}</p>
      )}
    </div>
  );
}

/** Weights for a split, from who already has items, as `who:1,…`. */
const suggest = (plan: PlanView) => (plan.board?.rows ?? []).map((r) => `${r.assignee}:1`).join(', ');

function SplitDialog({ plan, open, onClose, onDone }: DialogProps) {
  const { t } = useI18n();
  const [spec, setSpec] = useState(() => suggest(plan));
  const [keep, setKeep] = useState(false);
  const [proposal, setProposal] = useState<AssignResult>();
  const [error, setError] = useState('');
  const body = { split: spec, only_unassigned: keep };
  /** a changed spec or option makes the shown proposal stale */
  const edit = <T,>(set: (v: T) => void, v: T) => {
    set(v);
    setProposal(undefined);
  };
  const preview = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    api.assign(plan.key, { ...body, dry_run: true }).then(setProposal, (x) => setError(errorText(x)));
  };
  const apply = () =>
    api.assign(plan.key, body).then(
      () => {
        onDone();
        onClose();
      },
      (x) => setError(errorText(x)),
    );
  return (
    <Dialog open={open} title={t('assign.splitTitle')} onClose={onClose}>
      <form className="stack-sm" onSubmit={preview}>
        <p className="muted small">{t('assign.splitHelp')}</p>
        <label className="field">
          <span>{t('assign.splitField')}</span>
          <input value={spec} required onChange={(e) => edit(setSpec, e.target.value)} />
        </label>
        <label className="field-inline">
          <input type="checkbox" checked={keep} onChange={(e) => edit(setKeep, e.target.checked)} />
          {t('assign.splitKeep')}
        </label>
        {proposal && (
          <div>
            <p>
              {proposal.assignments.length
                ? t('assign.proposal', { n: proposal.assignments.length, left: proposal.unassigned })
                : t('assign.nothing')}
            </p>
            <ul className="small">
              {proposal.assignments.map((c) => (
                <li key={`${c.test_case}@${c.environment ?? ''}`}>
                  <span className="key">{c.test_case}</span> {c.from ?? '—'} → {c.assignee}
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="callout s-fail">{error}</p>}
        <p className="chips">
          <button type="submit" className="btn">
            {t('assign.preview')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!proposal?.assignments.length}
            onClick={apply}
          >
            {t('assign.applyProposal')}
          </button>
        </p>
      </form>
    </Dialog>
  );
}
type DialogProps = { plan: PlanView; open: boolean; onClose(): void; onDone(): void };

/** Bulk actions of a lead: assign the selected rows to someone, take the assignee off, or open Split. */
function Toolbar(props: {
  plan: PlanView;
  selected: string[];
  save(to: string | null): void;
  split(): void;
}) {
  const { t } = useI18n();
  const [who, setWho] = useState('');
  const { selected, save } = props;
  const names = [...new Set((props.plan.items ?? []).flatMap((i) => (i.assignee ? [i.assignee] : [])))];
  return (
    <div className="assign-bar">
      <span className="small muted">{t('assign.selected', { n: selected.length })}</span>
      <input
        list="assignees"
        value={who}
        placeholder={t('assign.toHint')}
        aria-label={t('assign.to')}
        onChange={(e) => setWho(e.target.value.trim())}
      />
      <datalist id="assignees">
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <button
        type="button"
        className="btn btn-sm btn-primary"
        disabled={!selected.length || !who}
        onClick={() => save(who)}
      >
        {t('assign.apply')}
      </button>
      <button type="button" className="btn btn-sm" disabled={!selected.length} onClick={() => save(null)}>
        {t('assign.unassign')}
      </button>
      <button type="button" className="btn btn-sm" onClick={props.split}>
        {t('assign.split')}
      </button>
    </div>
  );
}

/** The plan of the release: board, the lead's tools and one row per item with Take or Give back. */
export function PlanPanel(props: {
  plan: PlanView;
  titles: Map<string, string>;
  drafts: Set<string>;
  reload?: (() => void) | undefined;
}) {
  const { plan, titles, drafts } = props;
  const { t, day, locale } = useI18n();
  const { project } = useApp();
  const me = project.identity.id;
  const [only, setOnly] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [split, setSplit] = useState(false);
  const [lead, can] = [!project.role || project.role === 'lead', !!project.can.assign];
  const boxes = can && lead;
  const cols: (MsgKey | [MsgKey, string])[] = [
    ...(boxes ? ([['assign.col', 'check-col']] as [MsgKey, string][]) : []),
    ...(['common.testCase', 'plan.assignee', ['plan.due.col', 'hide-sm'], 'common.status'] as (
      | MsgKey
      | [MsgKey, string]
    )[]),
    ...(can ? (['assign.action'] as MsgKey[]) : []),
  ];
  const rows = (plan.items ?? []).filter((i) => !only || !i.assignee);
  const save = (items: string[], to: string | null) => {
    setError('');
    api.assign(plan.key, { to, items }).then(
      () => {
        setPicked([]);
        props.reload?.();
      },
      (e) => setError(errorText(e)),
    );
  };
  const toggle = (k: string) =>
    setPicked(picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k]);
  const mine = (i: Item) => i.assignee?.toLowerCase() === me.toLowerCase();
  return (
    <Section
      title={
        <>
          <span className="key">{plan.key}</span> {txt(plan, 'title', locale)}
        </>
      }
      id="plan"
      actions={plan.due && <span className="muted">{t('plan.due', { date: day(plan.due) })}</span>}
    >
      <Board plan={plan} />
      {!can && <p className="small muted board-mix">{t('assign.readOnly', { plan: plan.key })}</p>}
      <div className="assign-bar">
        <label className="field-inline">
          <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />
          {t('assign.only')}
        </label>
      </div>
      {boxes && (
        <Toolbar plan={plan} selected={picked} save={(to) => save(picked, to)} split={() => setSplit(true)} />
      )}
      {error && <p className="callout s-fail">{error}</p>}
      <div className="table-wrap">
        <table>
          <THead cols={cols} />
          <tbody>
            {rows.map((it) => {
              const k = it.test_case;
              return (
                <tr key={`${k}@${it.environment ?? ''}`} className={mine(it) ? 'row-mine' : ''}>
                  {boxes && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={t('assign.select', { key: k })}
                        checked={picked.includes(k)}
                        onChange={() => toggle(k)}
                      />
                    </td>
                  )}
                  <td>
                    <a className="key" href={href.testCase(k)}>
                      {k}
                    </a>{' '}
                    {titles.get(k)} {drafts.has(k) && <Chip tone="warn">{t('tc.draft')}</Chip>}
                  </td>
                  <td>
                    {it.assignee ?? '—'} {mine(it) && <Chip tone="accent">{t('plan.you')}</Chip>}
                  </td>
                  <td className="hide-sm">{day(it.due ?? plan.due)}</td>
                  <td>{it.status ? <Badge status={it.status} /> : '—'}</td>
                  {can && (
                    <td>
                      {!it.assignee && (
                        <button type="button" className="btn btn-sm" onClick={() => save([k], me)}>
                          {t('assign.take')}
                        </button>
                      )}
                      {mine(it) && (
                        <button type="button" className="btn btn-sm" onClick={() => save([k], null)}>
                          {t('assign.giveBack')}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {boxes && (
        <SplitDialog
          key={split ? plan.key : 'closed'}
          plan={plan}
          open={split}
          onClose={() => setSplit(false)}
          onDone={() => props.reload?.()}
        />
      )}
    </Section>
  );
}
