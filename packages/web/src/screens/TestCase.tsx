/** The test case page (docs/spec/web.md#test-case-page): what it tests, before you start, steps and result. */

import { useState } from 'react';
import { useApp } from '../App';
import { api, type RunSummary, type SpecTree, type TestCaseDetail } from '../api';
import { useI18n } from '../i18n';
import { href } from '../router';
import { SecretValue } from '../share';
import {
  Badge,
  Chip,
  Copy,
  fmtBytes,
  Load,
  Meta,
  Priority,
  Rich,
  THead,
  Tx,
  useAgo,
  useApi,
  useChecks,
  useTxt,
  Who,
} from '../ui';
import { placeholderValues, sentences, startUrl, stepsUsing } from './guide';
import { InlineRun } from './Runner';
import { useEnv } from './runner/useRun';
import { BddGuide, isBdd, Kw } from './testcase/bdd';
import { EditForm } from './testcase/EditForm';

/** The runner opened in place: the session it belongs to, and how to close it. */
export type InPlaceRun = { session?: string[] | undefined; close(): void };

export function TestCaseView({ tcKey, run }: { tcKey: string; run?: InPlaceRun | undefined }) {
  const { scope } = useApp();
  const tc = useApi(() => api.testCase(tcKey, scope), [tcKey, scope.release, scope.env]);
  const specs = useApi(() => api.specs({ ...scope, mine: false }), [scope.release, scope.env]);
  const [editing, setEditing] = useState(false);
  const done = (saved: boolean) => [setEditing(false), saved && tc.reload()];
  return (
    <Load state={tc}>
      {(d) =>
        editing ? (
          <EditForm d={d} done={done} />
        ) : (
          <Detail d={d} tree={specs.data} run={run} edit={() => setEditing(true)} />
        )
      }
    </Load>
  );
}

type Tree = SpecTree | undefined;
type Props = { d: TestCaseDetail; tree: Tree; run?: InPlaceRun | undefined; edit(): void };

/** One test case, top to bottom: what it tests, before you start, the steps (or the runner) and the result. */
function Detail({ d, tree, run, edit }: Props) {
  const { t } = useI18n();
  const { project } = useApp();
  const tc = d.data;
  return (
    <article className="tc-focus">
      <DetailHead d={d} />
      {project.can.edit && !run && (
        <button type="button" className="btn btn-sm" onClick={edit}>
          {t('tc.edit')}
        </button>
      )}
      {tc.origin === 'ai' && tc.status !== 'ready' && (
        <div className="callout s-needs_review">
          {t('tc.aiDraft', { model: tc.ai?.model ?? 'AI' })} <code>iw approve {d.key}</code>
        </div>
      )}
      <WhatItTests d={d} tree={tree} />
      <BeforeYouStart d={d} />
      {run ? (
        <InlineRun d={d} session={run.session} close={run.close} />
      ) : (
        <>
          <Steps d={d} />
          <Result d={d} />
        </>
      )}
    </article>
  );
}

/** The purpose, the feature and use case, and the covered criteria in plain words with their status. */
function WhatItTests({ d, tree }: { d: TestCaseDetail; tree: Tree }) {
  const { t } = useI18n();
  const feature = tree?.features.find((f) => f.useCases.some((u) => u.key === d.useCase));
  const uc = feature?.useCases.find((u) => u.key === d.useCase);
  const criteria = new Map(uc?.criteria.map((c) => [c.key, c] as const));
  return (
    <section className="tc-block" aria-labelledby="what-h">
      <h2 id="what-h">{t('tc.what')}</h2>
      {d.data.purpose && (
        <p className="lead">
          <Tx of={d.data} field="purpose" />
        </p>
      )}
      {feature && uc && (
        <p className="muted small">
          {t('tc.feature')}: <Tx of={feature} field="title" /> · {t('tc.useCase')}:{' '}
          <Tx of={uc} field="title" />
        </p>
      )}
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
    </section>
  );
}

/** Where to open the app, the test data cards and the preconditions as a checklist. */
function BeforeYouStart({ d }: { d: TestCaseDetail }) {
  const { t } = useI18n();
  const env = useEnv();
  const tc = d.data;
  const values = placeholderValues(d.fixtures);
  const pre = useTxt()(tc, 'preconditions');
  const bdd = isBdd(d);
  return (
    <section className="tc-block before-card" aria-labelledby="before-h">
      <h2 id="before-h">{t('runner.before')}</h2>
      {bdd && <BddGuide />}
      {(env || tc.start_note) && (
        <div className="open-at">
          {env && (
            <a className="btn" href={startUrl(env.base_url, tc.start)} target="_blank" rel="noreferrer">
              {t('tc.open', { url: startUrl(env.base_url, tc.start) })} ↗
            </a>
          )}
          {tc.start_note && (
            <p>
              <Tx of={tc} field="start_note" values={values} />
            </p>
          )}
          {env?.guide && (
            <details className="more">
              <summary>{t('tc.guide', { env: env.title ?? env.name })}</summary>
              <p className="pre small">{env.guide}</p>
            </details>
          )}
        </div>
      )}
      {d.fixtures.length > 0 && (
        <div className="data-cards">
          {d.fixtures.map((fx) => (
            <DataCard key={fx.key} fx={fx} d={d} />
          ))}
        </div>
      )}
      {pre && (
        <div>
          <h3>{t(bdd ? 'bdd.givenHeading' : 'tc.preconditions')}</h3>
          <ul className="checklist">
            {sentences(pre).map((x, i) => (
              <li key={x}>
                <label>
                  <input type="checkbox" />
                  <span>
                    <Kw on={bdd} k={i ? 'and' : 'given'} />
                    <Rich text={x} values={values} />
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const USE = {
  download: 'tc.use.download',
  upload: 'tc.use.upload',
  enter: 'tc.use.enter',
  seeded: 'tc.use.seeded',
} as const;

/** A fixture as test data: what it is for, what to do with it, its values and a download button per file. */
function DataCard({ fx, d }: { fx: TestCaseDetail['fixtures'][number]; d: TestCaseDetail }) {
  const { t } = useI18n();
  const ref = d.data.fixtures?.find((r) => r.ref === fx.key);
  const use = ref?.use;
  const at = use === 'upload' || use === 'enter' ? stepsUsing(d.data.steps, fx.key) : [];
  const files = use === 'download' || use === 'upload' || !use ? (fx.files ?? []) : [];
  const values = use === 'seeded' ? [] : Object.entries(fx.values?.[0] ?? {}).filter(([, v]) => v);
  return (
    <div className="data-card stack-sm">
      <p>
        <a className="key" href={href.fixtures(fx.key)}>
          {fx.key}
        </a>{' '}
        <strong>
          <Tx of={fx} field="title" />
        </strong>
      </p>
      {ref?.note && (
        <p>
          <Tx of={ref} field="note" />
        </p>
      )}
      {use && <p className="data-use">{t(USE[use])}</p>}
      {at.map((n) => (
        <p key={n} className="muted small">
          {t('runner.step', { n })}:{' '}
          <Tx of={d.data.steps[n - 1]} field="instruction" values={placeholderValues(d.fixtures)} />
        </p>
      ))}
      {fx.hidden && <p className="muted small">🔒 {t('sharing.notSharedHint')}</p>}
      {values.map(([k, v]) => (
        <Copy key={k} label={k} text={v} />
      ))}
      {fx.secret_ref?.startsWith('iw:') ? (
        <p className="copy">
          <span className="copy-label">{t('fx.secret')}</span> <SecretValue secretRef={fx.secret_ref} />
        </p>
      ) : (
        fx.kind === 'account' && <p className="muted small">{t('runner.secretHint')}</p>
      )}
      {files.map((f) => (
        <a key={f.name} className="btn btn-sm" href={api.blobUrl(f.sha256)} download={f.name}>
          ⇩ {t('tc.download', { name: f.name })} <span className="muted">({fmtBytes(f.size)})</span>
        </a>
      ))}
    </div>
  );
}

/** The numbered steps with the expected result and the checks to look at. */
function Steps({ d }: { d: TestCaseDetail }) {
  const { t } = useI18n();
  const checks = useChecks();
  const values = placeholderValues(d.fixtures);
  const bdd = isBdd(d);
  return (
    <section className="tc-block" aria-labelledby="steps-h">
      <h2 id="steps-h">{t(bdd ? 'bdd.scenario' : 'tc.steps', { count: d.data.steps.length })}</h2>
      <ol className="steps steps-lg">
        {d.data.steps.map((s, i) => (
          <li key={`${s.instruction}|${s.expected}`} className="step">
            <span className="step-n" aria-hidden="true">
              {i + 1}
            </span>
            <div className="grow stack-sm">
              <p className="instruction">
                <Kw on={bdd} k="when" />
                <Tx of={s} field="instruction" values={values} />
              </p>
              <p className="expected">
                <span className={bdd ? 'label gwt' : 'label'}>{t(bdd ? 'bdd.then' : 'tc.expected')}</span>{' '}
                <Tx of={s} field="expected" values={values} />
              </p>
              {s.checks && (
                <ul className="checklist checklist-static">
                  {checks(s).map((x) => (
                    <li key={x}>
                      <span className="box" aria-hidden="true" /> <Kw on={bdd} k="and" />
                      <Rich text={x} values={values} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The status in scope with the last run, then the collapsed details. */
function Result({ d }: { d: TestCaseDetail }) {
  const { t } = useI18n();
  const ago = useAgo();
  const last = d.runs[0];
  return (
    <section className="tc-block" aria-labelledby="result-h">
      <h2 id="result-h">{t('tc.resultBlock')}</h2>
      {last ? (
        <p className="muted last-run">
          <Badge status={d.status.status} /> {t('tc.lastRun')}{' '}
          <Who who={last.actor} unverified={last.unverified} /> · <Badge status={last.verdict} /> ·{' '}
          <a href={href.run(last.id)}>{ago(last.at)}</a>
          {d.status.stale && <Chip tone="warn">{t('tc.staleHint')}</Chip>}
        </p>
      ) : (
        <p className="muted">
          <Badge status={d.status.status} /> {t('tc.noRuns')}
        </p>
      )}
      <MoreDetails d={d} />
    </section>
  );
}

/** Key, status chips and the title. */
function DetailHead({ d }: { d: TestCaseDetail }) {
  const { t } = useI18n();
  return (
    <header className="tc-head">
      <p className="chips">
        <span className="key">{d.key}</span>
        <Badge status={d.status.status} />
        <Priority p={d.priority} />
        <Chip>{d.data.mode}</Chip>
        {isBdd(d) && <Chip>{t('bdd.chip')}</Chip>}
        {d.data.status === 'draft' && <Chip tone="warn">{t('tc.draft')}</Chip>}
      </p>
      <h1>
        <Tx of={d.data} field="title" mark />
      </h1>
    </header>
  );
}

/** Collapsed details: covered criteria, metadata and the run history. */
function MoreDetails({ d }: { d: TestCaseDetail }) {
  const { t } = useI18n();
  return (
    <details className="more">
      <summary>{t('tc.details')}</summary>
      <div className="stack">
        <Meta
          items={[
            [t('tc.covers'), d.data.covers.join(', ')],
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
