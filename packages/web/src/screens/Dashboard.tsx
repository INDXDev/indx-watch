/** Release readiness: gate verdict and checks, counts, coverage, open items, P0/P1 use cases and the plan. */
import { useState } from 'react';
import { useApp } from '../App';
import { api, type PlanView, type SpecTree, type StatusResult } from '../api';
import { type MsgKey, useI18n } from '../i18n';
import { href } from '../router';
import { Badge, Chip, Icon, Load, Priority, Section, Tx, useApi } from '../ui';

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
const OPEN = new Set(['fail', 'needs_review', 'stale', 'blocked', 'untested']);

export function Dashboard() {
  const { scope } = useApp();
  const status = useApi(() => api.status(scope), [scope.release, scope.env]);
  const specs = useApi(() => api.specs(scope), [scope.release, scope.env]);
  const plans = useApi(api.plans, []);
  return (
    <Load state={status}>{(s) => <Readiness status={s} specs={specs.data} plans={plans.data ?? []} />}</Load>
  );
}

function Readiness({
  status,
  specs,
  plans,
}: {
  status: StatusResult;
  specs?: SpecTree | undefined;
  plans: PlanView[];
}) {
  const { t } = useI18n();
  const { project, scope } = useApp();
  const [all, setAll] = useState(false);
  const release = project.releases.find((r) => r.version === scope.release);
  const env = project.environments.find((e) => e.name === scope.env);
  const failing = status.gate.checks.filter((c) => !c.passed);
  // nothing gated (no P0/P1 test case in scope): neutral, not "ready" (docs/spec/concepts.md#gate)
  const ungated = failing.some((c) => c.key === 'has_gated_tests');
  const tone = ungated ? 'untested' : status.gate.passed ? 'pass' : 'fail';
  const titles = new Map<string, string>();
  for (const f of specs?.features ?? [])
    for (const uc of f.useCases)
      for (const ac of uc.criteria) for (const tc of ac.testCases) titles.set(tc.key, tc.title);
  const tcStatus = new Map(status.testCases.map((x) => [x.key, x]));
  const open = [...new Set(failing.flatMap((c) => c.items ?? []))]
    .map((k) => tcStatus.get(k))
    .filter((x): x is NonNullable<typeof x> => x !== undefined && OPEN.has(x.status));
  const next = open[0];
  const useCases = status.useCases.filter((u) => all || u.priority === 'P0' || u.priority === 'P1');
  const plan = plans.find((p) => p.release === scope.release);
  const action = (key: string, st: string, run?: string) =>
    run && (st === 'fail' || st === 'needs_review') ? (
      <a className="btn btn-sm" href={href.run(run)}>
        {t(st === 'fail' ? 'dash.action.inspect' : 'dash.action.review')}
      </a>
    ) : (
      <a className="btn btn-sm" href={href.runner(key)}>
        {t('dash.action.run')}
      </a>
    );

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{t('dash.eyebrow')}</p>
          <h1>
            {scope.release ?? t('scope.noRelease')}{' '}
            {release?.title && <span className="muted">{release.title}</span>}
          </h1>
          <p className="muted">
            {release && <Chip>{release.state}</Chip>}{' '}
            <strong>{t('dash.scope', { env: env ? env.title : t('scope.allEnvironments') })}</strong> ·{' '}
            {t('dash.coverage', { covered: status.coverage.covered, total: status.coverage.total })}
          </p>
        </div>
        <a className="btn" href={href.report()}>
          {t('dash.openReport')}
        </a>
      </div>

      <div className={`verdict s-${tone}`} role="status">
        <Icon status={tone} />
        <div>
          <strong>
            {ungated
              ? t('dash.ungated')
              : status.gate.passed
                ? t('dash.ready')
                : t('dash.notReady', { failed: failing.length, total: status.gate.checks.length })}
          </strong>
          {ungated && <p>{t('dash.ungated.detail')}</p>}
          {next ? (
            <p>
              {t('dash.next')}{' '}
              <a
                href={
                  next.latestRun && next.status !== 'stale' ? href.run(next.latestRun) : href.runner(next.key)
                }
              >
                {t(`dash.next.${next.status}` as MsgKey, {
                  key: next.key,
                  title: titles.get(next.key) ?? '',
                })}
              </a>
            </p>
          ) : (
            status.gate.passed && <p>{t('dash.next.share')}</p>
          )}
        </div>
      </div>

      <div className="grid-2">
        <Section title={t('dash.gate')} id="gate">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('dash.check')}</th>
                  <th className="num">{t('dash.actual')}</th>
                  <th className="num">{t('dash.expected')}</th>
                  <th>{t('dash.result')}</th>
                </tr>
              </thead>
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
      </div>

      {open.length > 0 && (
        <Section title={t('dash.open', { count: open.length })} id="open">
          <ul className="list">
            {open.map((x) => (
              <li key={x.key}>
                <Badge status={x.status} />
                <a href={href.testCase(x.key)} className="key">
                  {x.key}
                </a>
                <span className="grow">{titles.get(x.key)}</span>
                {action(x.key, x.status, x.latestRun)}
              </li>
            ))}
          </ul>
        </Section>
      )}

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
            <thead>
              <tr>
                <th>{t('common.useCase')}</th>
                <th>{t('common.priority')}</th>
                <th>{t('common.criteria')}</th>
                <th>{t('common.status')}</th>
                <th className="hide-sm">{t('dash.done')}</th>
              </tr>
            </thead>
            <tbody>
              {useCases.map((u) => {
                const node = specs?.features.flatMap((f) => f.useCases).find((x) => x.key === u.key);
                return (
                  <tr key={u.key}>
                    <td>
                      <span className="key">{u.key}</span> {node ? <Tx of={node} field="title" /> : u.title}
                    </td>
                    <td>
                      <Priority p={u.priority} />
                    </td>
                    <td>
                      <div className="minis">
                        {u.criteria.map((c) => (
                          <span
                            key={c.key}
                            className={`mini s-${c.status}`}
                            title={`${c.key}: ${t(`status.${c.status}`)}`}
                          >
                            <Icon status={c.status} />
                            {c.key}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <Badge status={u.status} />
                    </td>
                    <td className="hide-sm">
                      {u.done ? <span className="ok">✓ {t('common.yes')}</span> : t('common.no')}
                    </td>
                  </tr>
                );
              })}
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

      {plan && <PlanPanel plan={plan} titles={titles} />}
    </>
  );
}

function PlanPanel({ plan, titles }: { plan: PlanView; titles: Map<string, string> }) {
  const { t, day } = useI18n();
  const { project } = useApp();
  const me = project.identity.id;
  return (
    <Section
      title={
        <>
          <span className="key">{plan.key}</span> {plan.title}
        </>
      }
      id="plan"
      actions={plan.due && <span className="muted">{t('plan.due', { date: day(plan.due) })}</span>}
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('common.testCase')}</th>
              <th>{t('plan.assignee')}</th>
              <th className="hide-sm">{t('plan.due.col')}</th>
              <th>{t('common.status')}</th>
            </tr>
          </thead>
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
