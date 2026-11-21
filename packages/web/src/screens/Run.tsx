/** Run viewer: verdict and the decision rule that produced it, steps with evidence, judgements, and the review form. */

import type { ReviewInput } from '@indx-watch/server';
import { useState } from 'react';
import { useApp } from '../App';
import { api, type RunDetail } from '../api';
import { type MsgKey, useI18n } from '../i18n';
import { href } from '../router';
import { Badge, Chip, fmtBytes, Load, Mark, Meta, Section, Seg, THead, Tx, useApi, Who } from '../ui';

const VERDICTS = ['pass', 'fail', 'blocked', 'skipped'] as const;
const RULES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** CI run and pull request links of a record: web URLs only; the PR next to a GitHub Actions run. Pure; tested. */
export function ciLinks(ci?: { url?: string | undefined; pr?: number | undefined }) {
  const url = ci?.url && /^https?:\/\//i.test(ci.url) ? ci.url : undefined;
  const github = ci?.pr && url?.includes('/actions/runs/');
  return { url, pr: github ? url!.replace(/\/actions\/runs\/.*$/, `/pull/${ci!.pr}`) : undefined };
}

export function RunView({ id }: { id: string }) {
  const run = useApi(() => api.run(id), [id]);
  return <Load state={run}>{(r) => <Detail r={r} reload={run.reload} />}</Load>;
}

function Detail({ r, reload }: { r: RunDetail; reload: () => void }) {
  const { t, date } = useI18n();
  const rec = r.record;
  const can = useApp().project.can;
  const [canReview, canRun] = [can.review !== false, can.run !== false];
  const review = r.decision.verdict === 'needs_review' && canReview;
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {t('run.eyebrow')} · <a href={href.testCase(r.testCase.key)}>{r.testCase.key}</a>
          </p>
          <h1>
            <Tx of={r.testCase} field="title" mark />
          </h1>
          <p className="muted last-run">
            <Who who={rec.actor} unverified={r.unverified?.includes(rec.id)} /> · {date(rec.ended_at)} ·{' '}
            <span className="mono small">{rec.id}</span>
          </p>
        </div>
      </div>

      <Verdict r={r} />
      {r.stale && (
        <div className="callout s-stale">
          {t('run.stale', { version: rec.test_case.version, current: r.testCase.currentVersion })}{' '}
          {canRun && <a href={href.runner(r.testCase.key)}>{t('dash.action.run')}</a>}
        </div>
      )}
      {review && <ReviewForm id={rec.id} onDone={reload} prominent />}

      <div className="split">
        <div className="stack">
          <Steps r={r} reload={reload} />
          <Judgements r={r} />
          {!review && canReview && <ReviewForm id={rec.id} onDone={reload} />}
        </div>
        <div className="stack">
          <RunMeta r={r} />
        </div>
      </div>
    </>
  );
}

/** The verdict and the decision rule that produced it. */
function Verdict({ r }: { r: RunDetail }) {
  const { t } = useI18n();
  return (
    <div className={`verdict s-${r.decision.verdict}`}>
      <Badge status={r.decision.verdict} size="lg" />
      <div className="grow">
        <strong>{t('run.rule', { n: r.decision.rule, rule: t(`rule.${r.decision.rule}` as MsgKey) })}</strong>
        <p>{r.decision.reason}</p>
        <details>
          <summary>{t('run.howDecided')}</summary>
          <ol className="rules">
            {RULES.map((n) => (
              <li
                key={n}
                className={n === r.decision.rule ? 'hit' : ''}
                aria-current={n === r.decision.rule ? 'step' : undefined}
              >
                {t(`rule.${n}` as MsgKey)}
              </li>
            ))}
          </ol>
        </details>
      </div>
    </div>
  );
}

/** Steps with their evidence, then evidence not tied to a step. */
function Steps({ r, reload }: { r: RunDetail; reload: () => void }) {
  const { t } = useI18n();
  const { steps, evidence } = r.record;
  const base = { run: r.record.id, baselines: r.baselines ?? [], reload };
  const loose = evidence.filter((e) => (e.step ?? 0) === 0);
  const ev = (sha: string) => evidence.find((e) => e.sha256 === sha);
  return (
    <Section title={t('run.steps')}>
      {steps.length === 0 && <p className="muted">{t('run.noSteps')}</p>}
      <ol className="steps">
        {steps.map((s) => (
          <li key={s.index} className="step">
            <span className="step-n">{s.index}</span>
            <div className="grow stack-sm">
              <Badge status={s.status} />
              {s.note && <p className="pre">{s.note}</p>}
              <Shots
                items={(s.evidence ?? []).map((sha) => ev(sha) ?? { sha256: sha, name: sha.slice(0, 12) })}
                base={base}
              />
            </div>
          </li>
        ))}
      </ol>
      {loose.length > 0 && (
        <>
          <h3>{t('run.otherEvidence')}</h3>
          <Shots items={loose} base={base} />
        </>
      )}
    </Section>
  );
}

function Judgements({ r }: { r: RunDetail }) {
  const { t, date } = useI18n();
  return (
    <Section title={t('run.judgements', { count: r.judgements.length })}>
      {r.judgements.length === 0 && <p className="muted">{t('run.noJudgements')}</p>}
      <div className="table-wrap" hidden={r.judgements.length === 0}>
        <table>
          <THead cols={['run.judge', 'run.verdict', 'run.reason', 'run.by']} />
          <tbody>
            {r.judgements.map((j) => (
              <tr key={j.id}>
                <td>
                  <Chip>{j.kind}</Chip>
                </td>
                <td>
                  {['pass', 'fail', 'blocked', 'skipped'].includes(j.verdict) ? (
                    <Badge status={j.verdict} />
                  ) : (
                    <Chip>{j.verdict}</Chip>
                  )}
                  {j.confidence !== undefined && (
                    <span className="muted small"> {Math.round(j.confidence * 100)}%</span>
                  )}
                  {j.diff_ratio !== undefined && (
                    <span className="muted small">
                      {' '}
                      {t('run.diff', { ratio: +(j.diff_ratio * 100).toFixed(2) })}
                    </span>
                  )}
                </td>
                <td className="pre">{j.reason ?? '—'}</td>
                <td className="small">
                  {j.by?.name ?? j.by?.id ?? '—'}{' '}
                  {j.by && <Mark who={j.by} unverified={r.unverified?.includes(j.id)} />}
                  <br />
                  <span className="muted">{date(j.at)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** Who ran it, where, on which build, with which fixtures. */
function RunMeta({ r: { record: rec } }: { r: RunDetail }) {
  const { t, date } = useI18n();
  const ci = ciLinks(rec.ci);
  return (
    <Section title={t('run.details')}>
      <Meta
        items={[
          [t('run.actor'), `${rec.actor.name ?? rec.actor.id} (${rec.actor.kind})`],
          [t('run.source'), rec.source],
          [t('scope.release'), rec.release],
          [t('scope.environment'), rec.environment],
          [t('run.build'), rec.build.commit && <code>{rec.build.commit.slice(0, 12)}</code>],
          [t('run.ci'), ci.url && <a href={ci.url}>{rec.ci?.job ?? rec.ci?.provider} ↗</a>],
          [t('run.pr'), rec.ci?.pr && (ci.pr ? <a href={ci.pr}>#{rec.ci.pr} ↗</a> : `#${rec.ci.pr}`)],
          [t('run.started'), date(rec.started_at)],
          [t('run.ended'), date(rec.ended_at)],
          [t('run.locale'), rec.locale],
          [t('run.version'), <code key="v">{rec.test_case.version}</code>],
        ]}
      />
      {rec.fixtures.length > 0 && (
        <ul className="list small">
          {rec.fixtures.map((f) => (
            <li key={f.id}>
              <a className="key" href={href.fixtures(f.key)}>
                {f.key}
              </a>
              <code>{f.version}</code> {f.rows?.join(', ')}
            </li>
          ))}
        </ul>
      )}
      {rec.note && <p className="pre">{rec.note}</p>}
    </Section>
  );
}

type Shot = { sha256: string; name: string; media_type?: string; size?: number };
type Base = { run: string; baselines: string[]; reload: () => void };

function Shots({ items, base }: { items: Shot[]; base: Base }) {
  if (items.length === 0) return null;
  return (
    <div className="shots">
      {items.map((e) => {
        const url = api.blobUrl(e.sha256);
        const img = !e.media_type || e.media_type.startsWith('image/');
        return (
          <figure key={e.sha256} className="shot">
            <a href={url} target="_blank" rel="noreferrer">
              {img ? <img src={url} alt={e.name} loading="lazy" /> : <span className="file">{e.name}</span>}
            </a>
            <figcaption>
              {e.name}
              {e.size !== undefined && <span className="muted"> · {fmtBytes(e.size)}</span>}
              {e.media_type === 'image/png' && <BaselineMark e={e} base={base} />}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

/** "Baseline" on the approved visual baseline, else "Approve as baseline" (docs/spec/web.md#visual-baselines). */
function BaselineMark({ e, base }: { e: Shot; base: Base }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const canApprove = useApp().project.can.approve !== false;
  if (base.baselines.includes(e.sha256)) return <Chip>{t('run.baseline')}</Chip>;
  if (!canApprove) return null;
  const approve = () => {
    setBusy(true);
    api
      .approveBaseline(base.run, e.sha256)
      .then(base.reload, (x) => setError(x instanceof Error ? x.message : String(x)))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={approve}>
        {t('run.approveBaseline')}
      </button>
      {error && <span role="alert">{t('common.error', { message: error })}</span>}
    </>
  );
}

function ReviewForm({ id, onDone, prominent }: { id: string; onDone: () => void; prominent?: boolean }) {
  const { t, locale } = useI18n();
  const [verdict, setVerdict] = useState<ReviewInput['verdict']>();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async () => {
    if (!verdict) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.review(id, { verdict, reason: reason.trim(), locale });
      setVerdict(undefined);
      setReason('');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={t(prominent ? 'review.needed' : 'review.add')} id="review">
      <p className="muted">{t('review.hint')}</p>
      <Seg
        label={t('run.verdict')}
        value={verdict}
        options={VERDICTS}
        text={(v) => t(`status.${v}`)}
        onChange={setVerdict}
        status
      />
      <label className="field">
        <span>{t('review.reason')}</span>
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-required="true" />
      </label>
      {error && (
        <div className="callout s-fail" role="alert">
          {t('common.error', { message: error })}
        </div>
      )}
      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!verdict || !reason.trim() || busy}
          onClick={submit}
        >
          {t('review.submit')}
        </button>
      </div>
    </Section>
  );
}
