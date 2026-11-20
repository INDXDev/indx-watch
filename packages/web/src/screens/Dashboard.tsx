/** Release details on Home: gate checks, counts, coverage, P0/P1 use cases and the plan (docs/spec/web.md#home). */
import { useState } from 'react';
import { useApp } from '../App';
import type { PlanView, SpecTree, StatusResult } from '../api';
import { type MsgKey, useI18n } from '../i18n';
import { href } from '../router';
import { Badge, Chip, Icon, Priority, Section, THead, Tx, txt } from '../ui';
import { allTestCases } from './Tests';

const COUNT_KEYS = [
  'pass',
  'fail',
  'needs_review',
  'stale',
  'blocked',
  'untested',
  'waived',
  'uncovered',
] as const;

type Props = { status: StatusResult; specs?: SpecTree | undefined; plans: PlanView[] };

/** Gate checks, counts and coverage, the P0/P1 (or all) use cases and the plan of the release in scope. */
export function ReleaseDetails({ status, specs, plans }: Props) {
  const { locale } = useI18n();
  const { scope } = useApp();
  const titles = new Map((specs ? allTestCases(specs) : []).map((tc) => [tc.key, txt(tc, 'title', locale)]));
  const plan = plans.find((p) => p.release === scope.release);
  return (
    <>
      <div className="grid-2">
        <GatePanel status={status} />
        <CountsPanel status={status} />
      </div>
      <UseCasesPanel status={status} specs={specs} />
      {plan && <PlanPanel plan={plan} titles={titles} />}
    </>
  );
}

function GatePanel({ status }: { status: StatusResult }) {
  const { t } = useI18n();
  return (
    <Section title={t('dash.gate')} id="gate">
      <div className="table-wrap">
        <table>
          <THead cols={['dash.check', ['dash.actual', 'num'], ['dash.expected', 'num'], 'dash.result']} />
          <tbody>
            {status.gate.checks.map((c) => (
              <tr key={c.key} className={c.passed ? '' : 'row-fail'}>
                <td>
                  {t(`gate.${c.key}` as MsgKey)}
                  {!!c.items?.length && (
                    <div className="items">
                      {c.items.map((k) => (
                        <a key={k} href={k.startsWith('TC-') ? href.testCase(k) : href.specs()}>
                          {k}
                        </a>
                      ))}
                    </div>
                  )}
                </td>
                <td className="num mono">{c.actual}</td>
                <td className="num mono">{c.expected}</td>
                <td>
                  <Badge status={c.passed ? 'pass' : 'fail'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function CountsPanel({ status }: { status: StatusResult }) {
  const { t } = useI18n();
  return (
    <Section title={t('dash.counts')} id="counts">
      <div className="tiles">
        {COUNT_KEYS.map((k) => (
          <div key={k} className={`tile s-${k}${status.counts[k] ? '' : ' tile-zero'}`}>
            <span className="tile-n">{status.counts[k]}</span>
            <span className="tile-l">
              <Icon status={k} /> {t(`status.${k}`)}
            </span>
          </div>
        ))}
      </div>
      <div className="meter-row">
        <span>{t('dash.acCoverage')}</span>
        <span className="bar" role="presentation">
          <span style={{ width: `${Math.round(status.coverage.ratio * 100)}%` }} />
        </span>
        <span className="mono">
          {status.coverage.covered}/{status.coverage.total} ({Math.round(status.coverage.ratio * 100)}%)
        </span>
      </div>
    </Section>
  );
}

function UseCasesPanel({ status, specs }: Omit<Props, 'plans'>) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const useCases = status.useCases.filter((u) => all || u.priority === 'P0' || u.priority === 'P1');
  const nodes = specs?.features.flatMap((f) => f.useCases);
  return (
    <Section
      title={t(all ? 'dash.useCasesAll' : 'dash.useCases')}
      id="ucs"
      actions={
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAll(!all)}>
          {t(all ? 'dash.showP0P1' : 'dash.showAll')}
        </button>
      }
    >
      <div className="table-wrap">
        <table>
          <THead
            cols={[
              'common.useCase',
              'common.priority',
              'common.criteria',
              'common.status',
              ['dash.done', 'hide-sm'],
            ]}
          />
          <tbody>
            {useCases.map((u) => (
              <UseCaseRow key={u.key} u={u} node={nodes?.find((x) => x.key === u.key)} />
            ))}
            {useCases.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {t('dash.useCases.empty')}{' '}
                  {!all && status.useCases.length > 0 && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAll(true)}>
                      {t('dash.showAll')}
                    </button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function UseCaseRow({ u, node }: { u: StatusResult['useCases'][number]; node: unknown }) {
  const { t } = useI18n();
  return (
    <tr>
      <td>
        <span className="key">{u.key}</span> {node ? <Tx of={node} field="title" /> : u.title}
      </td>
      <td>
        <Priority p={u.priority} />
      </td>
      <td>
        <div className="minis">
          {u.criteria.map((c) => (
            <span key={c.key} className={`mini s-${c.status}`} title={`${c.key}: ${t(`status.${c.status}`)}`}>
              <Icon status={c.status} />
              {c.key}
            </span>
          ))}
        </div>
      </td>
      <td>
        <Badge status={u.status} />
      </td>
      <td className="hide-sm">{u.done ? <span className="ok">✓ {t('common.yes')}</span> : t('common.no')}</td>
    </tr>
  );
}

function PlanPanel({ plan, titles }: { plan: PlanView; titles: Map<string, string> }) {
  const { t, day, locale } = useI18n();
  const { project } = useApp();
  const me = project.identity.id;
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
      <div className="table-wrap">
        <table>
          <THead cols={['common.testCase', 'plan.assignee', ['plan.due.col', 'hide-sm'], 'common.status']} />
          <tbody>
            {(plan.items ?? []).map((it) => (
              <tr
                key={`${it.test_case}@${it.environment ?? ''}`}
                className={it.assignee === me ? 'row-mine' : ''}
              >
                <td>
                  <a className="key" href={href.testCase(it.test_case)}>
                    {it.test_case}
                  </a>{' '}
                  {titles.get(it.test_case)}
                </td>
                <td>
                  {it.assignee ?? '—'} {it.assignee === me && <Chip tone="accent">{t('plan.you')}</Chip>}
                </td>
                <td className="hide-sm">{day(it.due ?? plan.due)}</td>
                <td>{it.status ? <Badge status={it.status} /> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
