/** Test case: steps, fixtures, covered criteria with status, result in scope and run history. */

import { useApp } from '../App';
import { api, type RunSummary, type TestCaseDetail } from '../api';
import { useI18n } from '../i18n';
import { href } from '../router';
import { Badge, Chip, Load, Meta, Priority, Section, Tx, useApi } from '../ui';

/** `FX-1.code` → value, from the first selected row of each fixture (used to fill {{…}} placeholders). Pure. */
export function placeholderValues(fixtures: TestCaseDetail['fixtures']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const fx of fixtures)
    for (const [k, v] of Object.entries(fx.values?.[0] ?? {})) out[`${fx.key}.${k}`] = v;
  return out;
}

export function TestCaseView({ tcKey }: { tcKey: string }) {
  const { scope } = useApp();
  const tc = useApi(() => api.testCase(tcKey, scope), [tcKey, scope.release, scope.env]);
  const specs = useApi(() => api.specs(scope), [scope.release, scope.env]);
  const criteria = new Map(
    (specs.data?.features ?? []).flatMap((f) =>
      f.useCases.flatMap((u) => u.criteria.map((c) => [c.key, c] as const)),
    ),
  );
  return <Load state={tc}>{(d) => <Detail d={d} criteria={criteria} />}</Load>;
}

type CriterionLite = { key: string; text: string; status: string; i18n?: unknown };

function Detail({ d, criteria }: { d: TestCaseDetail; criteria: Map<string, CriterionLite> }) {
  const { t } = useI18n();
  const tc = d.data;
  const values = placeholderValues(d.fixtures);
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">
            <a href={href.specs()}>{t('nav.specs')}</a> › {d.useCase}
          </p>
          <h1>
            <span className="key">{d.key}</span> <Tx of={tc} field="title" />
          </h1>
          <p className="chips">
            <Chip tone={tc.status === 'draft' ? 'warn' : undefined}>{tc.status ?? 'ready'}</Chip>
            <Priority p={d.priority} />
            <Chip>{tc.mode}</Chip>
            {tc.tags?.map((x) => (
              <Chip key={x}>#{x}</Chip>
            ))}
            <code title={t('tc.versionHint')}>{d.version}</code>
          </p>
        </div>
        <a className="btn btn-primary" href={href.runner(d.key)}>
          ▶ {t('tc.runManually')}
        </a>
      </div>
      {tc.origin === 'ai' && tc.status !== 'ready' && (
        <div className="callout s-needs_review">
          {t('tc.aiDraft', { model: tc.ai?.model ?? 'AI' })} <code>iw approve {d.key}</code>
        </div>
      )}
      <div className="split">
        <div className="stack">
          {tc.preconditions && (
            <Section title={t('tc.preconditions')}>
              <p>
                <Tx of={tc} field="preconditions" values={values} />
              </p>
            </Section>
          )}
          <Section title={t('tc.steps', { count: tc.steps.length })}>
            <ol className="steps">
              {tc.steps.map((s, i) => (
                <li key={`${s.instruction}|${s.expected}`} className="step">
                  <span className="step-n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div className="grow">
                    <p>
                      <Tx of={s} field="instruction" values={values} />
                    </p>
                    <p className="expected">
                      <span className="label">{t('tc.expected')}</span>{' '}
                      <Tx of={s} field="expected" values={values} />
                    </p>
                    {s.evidence && (
                      <p className="muted small">
                        {t('tc.evidence')}: {s.evidence.join(', ')}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Section>
          <Section title={t('tc.history', { count: d.runs.length })}>
            <RunTable runs={d.runs} />
          </Section>
        </div>
        <div className="stack">
          <Section title={t('tc.result')}>
            <p className="result-line">
              <Badge status={d.status.status} size="lg" />
              {d.status.stale && <Chip tone="warn">{t('tc.staleHint')}</Chip>}
            </p>
            {d.status.latestRun && <a href={href.run(d.status.latestRun)}>{t('tc.latestRun')} →</a>}
            {(d.status.variants?.length ?? 0) > 1 && (
              <ul className="list small">
                {d.status.variants?.map((v) => (
                  <li key={v.variant}>
                    <Badge status={v.verdict} /> <code>{v.variant || t('tc.defaultVariant')}</code>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title={t('tc.covers')}>
            <ul className="list">
              {tc.covers.map((k) => {
                const c = criteria.get(k);
                return (
                  <li key={k}>
                    <span className="key">{k}</span>
                    <span className="grow">{c && <Tx of={c} field="text" />}</span>
                    {c && <Badge status={c.status} />}
                  </li>
                );
              })}
            </ul>
          </Section>
          <Section title={t('tc.fixtures')}>
            {d.fixtures.length === 0 && <p className="muted">{t('tc.noFixtures')}</p>}
            {d.fixtures.map((fx) => (
              <div key={fx.key} className="fx-mini">
                <p>
                  <a className="key" href={href.fixtures(fx.key)}>
                    {fx.key}
                  </a>{' '}
                  {fx.title} <Chip>{fx.kind}</Chip>
                </p>
                <p className="muted small mono">{fx.version}</p>
                {fx.rows && (
                  <p className="small">
                    {t('tc.rows')}:{' '}
                    {fx.rows.map((r) => (
                      <code key={r}>{r}</code>
                    ))}
                  </p>
                )}
              </div>
            ))}
          </Section>
          <Section title={t('tc.details')}>
            <Meta
              items={[
                [t('tc.judges'), tc.judges?.map((j) => j.kind).join(', ') ?? '—'],
                [t('tc.automation'), tc.automation?.files?.map((f) => <code key={f}>{f}</code>)],
                [t('tc.file'), <code key="f">{d.file}</code>],
              ]}
            />
          </Section>
        </div>
      </div>
    </>
  );
}

export function RunTable({ runs }: { runs: RunSummary[] }) {
  const { t, date } = useI18n();
  if (runs.length === 0) return <p className="muted">{t('tc.noRuns')}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t('run.when')}</th>
            <th>{t('run.verdict')}</th>
            <th>{t('run.actor')}</th>
            <th>{t('run.where')}</th>
            <th>{t('run.version')}</th>
            <th className="num">{t('run.evidenceCount')}</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td>
                <a href={href.run(r.id)}>{date(r.at)}</a>
              </td>
              <td>
                <Badge status={r.verdict} />
              </td>
              <td>
                {r.actor.name ?? r.actor.id} <span className="muted small">· {r.source}</span>
              </td>
              <td className="small">
                {r.environment ?? '—'} {r.commit && <code>{r.commit.slice(0, 7)}</code>}
              </td>
              <td>
                <code className="small">{r.version}</code>{' '}
                {r.stale && <Chip tone="warn">{t('status.stale')}</Chip>}
              </td>
              <td className="num">{r.evidence}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
