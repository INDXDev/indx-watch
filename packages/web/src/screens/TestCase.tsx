/** Test case: steps, fixtures, covered criteria with status, result in scope and run history. */

import { useApp } from '../App';
import { api, type RunSummary, type TestCaseDetail } from '../api';
import { useI18n } from '../i18n';
import { href } from '../router';
import { Badge, Chip, Load, Meta, Priority, THead, Tx, useAgo, useApi, Who } from '../ui';

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
  const acs = (specs.data?.features ?? []).flatMap((f) => f.useCases.flatMap((u) => u.criteria));
  const criteria = new Map(acs.map((c) => [c.key, c] as const));
  return <Load state={tc}>{(d) => <Detail d={d} criteria={criteria} />}</Load>;
}

type CriterionLite = { key: string; text: string; status: string; i18n?: unknown };

/** One test case: header, the "before you start" card, the steps and the collapsed details. */
function Detail({ d, criteria }: { d: TestCaseDetail; criteria: Map<string, CriterionLite> }) {
  const { t } = useI18n();
  const tc = d.data;
  const values = placeholderValues(d.fixtures);
  return (
    <article className="tc-focus">
      <DetailHead d={d} />
      {tc.origin === 'ai' && tc.status !== 'ready' && (
        <div className="callout s-needs_review">
          {t('tc.aiDraft', { model: tc.ai?.model ?? 'AI' })} <code>iw approve {d.key}</code>
        </div>
      )}
      {(tc.preconditions || d.fixtures.length > 0) && (
        <section className="before-card">
          <h2>{t('runner.before')}</h2>
          {tc.preconditions && (
            <p>
              <Tx of={tc} field="preconditions" values={values} />
            </p>
          )}
          {d.fixtures.map((fx) => (
            <p key={fx.key} className="small">
              <a className="key" href={href.fixtures(fx.key)}>
                {fx.key}
              </a>{' '}
              <Tx of={fx} field="title" />
              {Object.entries(fx.values?.[0] ?? {}).map(([k, v]) => (
                <span key={k}>
                  {' '}
                  {k}: <code>{v}</code>
                </span>
              ))}
            </p>
          ))}
        </section>
      )}
      <ol className="steps steps-lg">
        {tc.steps.map((s, i) => (
          <li key={`${s.instruction}|${s.expected}`} className="step">
            <span className="step-n" aria-hidden="true">
              {i + 1}
            </span>
            <div className="grow">
              <p className="instruction">
                <Tx of={s} field="instruction" values={values} />
              </p>
              <p className="expected">
                <span className="label">{t('tc.expected')}</span>{' '}
                <Tx of={s} field="expected" values={values} />
              </p>
            </div>
          </li>
        ))}
      </ol>
      <MoreDetails d={d} criteria={criteria} />
    </article>
  );
}

/** Key, status chips, title and the last run. */
function DetailHead({ d }: { d: TestCaseDetail }) {
  const { t } = useI18n();
  const ago = useAgo();
  const last = d.runs[0];
  return (
    <header className="tc-head">
      <p className="chips">
        <span className="key">{d.key}</span>
        <Badge status={d.status.status} />
        <Priority p={d.priority} />
        <Chip>{d.data.mode}</Chip>
        {d.data.status === 'draft' && <Chip tone="warn">{d.data.status}</Chip>}
      </p>
      <h1>
        <Tx of={d.data} field="title" mark />
      </h1>
      {last ? (
        <p className="muted last-run">
          {t('tc.lastRun')} <Who who={last.actor} unverified={last.unverified} /> ·{' '}
          <Badge status={last.verdict} /> · <a href={href.run(last.id)}>{ago(last.at)}</a>
          {d.status.stale && <Chip tone="warn">{t('tc.staleHint')}</Chip>}
        </p>
      ) : (
        <p className="muted">{t('tc.noRuns')}</p>
      )}
    </header>
  );
}

/** Collapsed details: covered criteria with status, metadata and the run history. */
function MoreDetails({ d, criteria }: { d: TestCaseDetail; criteria: Map<string, CriterionLite> }) {
  const { t } = useI18n();
  return (
    <details className="more">
      <summary>{t('tc.details')}</summary>
      <div className="stack">
        <ul className="list">
          {d.data.covers.map((k) => {
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
        <Meta
          items={[
            [t('tc.useCase'), d.useCase],
            [t('tc.judges'), d.data.judges?.map((j) => j.kind).join(', ') ?? '—'],
            [t('tc.automation'), d.data.automation?.files?.map((f) => <code key={f}>{f}</code>)],
            [t('tc.file'), <code key="f">{d.file}</code>],
            [t('tc.version'), <code key="v">{d.version}</code>],
            [t('tc.tags'), d.data.tags?.map((x) => `#${x}`).join(' ')],
          ]}
        />
        <h3>{t('tc.history', { count: d.runs.length })}</h3>
        <RunTable runs={d.runs} />
      </div>
    </details>
  );
}

export function RunTable({ runs }: { runs: RunSummary[] }) {
  const { t, date } = useI18n();
  if (runs.length === 0) return <p className="muted">{t('tc.noRuns')}</p>;
  return (
    <div className="table-wrap">
      <table>
        <THead
          cols={[
            'run.when',
            'run.verdict',
            'run.actor',
            'run.where',
            'run.version',
            ['run.evidenceCount', 'num'],
          ]}
        />
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
                <Who who={r.actor} unverified={r.unverified} />{' '}
                <span className="muted small">· {r.source}</span>
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
