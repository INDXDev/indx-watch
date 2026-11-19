/** Run viewer: verdict and the decision rule that produced it, steps with evidence, judgements, and the review form. */

import type { ReviewInput } from '@indx-watch/server';
import { useState } from 'react';
import { api, type RunDetail } from '../api';
import { type MsgKey, useI18n } from '../i18n';
import { href } from '../router';
import { Badge, Chip, fmtBytes, Load, Meta, Section, Seg, useApi } from '../ui';

type Evidence = RunDetail['record']['evidence'][number];
const VERDICTS = ['pass', 'fail', 'blocked', 'skipped'] as const;
const RULES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export function RunView({ id }: { id: string }) {
  const run = useApi(() => api.run(id), [id]);
  return <Load state={run}>{(r) => <Detail r={r} reload={run.reload} />}</Load>;
}

function Detail({ r, reload }: { r: RunDetail; reload: () => void }) {
  const { t, date } = useI18n();
  const rec = r.record;
  const review = r.decision.verdict === 'needs_review';
  const byStep = new Map<number, Evidence[]>();
  for (const e of rec.evidence) byStep.set(e.step ?? 0, [...(byStep.get(e.step ?? 0) ?? []), e]);
  const ev = (sha: string) => rec.evidence.find((e) => e.sha256 === sha);
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {t('run.eyebrow')} · <a href={href.testCase(r.testCase.key)}>{r.testCase.key}</a>
          </p>
          <h1>{r.testCase.title}</h1>
          <p className="muted mono small">{rec.id}</p>
        </div>
      </div>

      <div className={`verdict s-${r.decision.verdict}`}>
        <Badge status={r.decision.verdict} size="lg" />
        <div className="grow">
          <strong>
            {t('run.rule', { n: r.decision.rule, rule: t(`rule.${r.decision.rule}` as MsgKey) })}
          </strong>
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
      {r.stale && (
        <div className="callout s-stale">
          {t('run.stale', { version: rec.test_case.version, current: r.testCase.currentVersion })}{' '}
          <a href={href.runner(r.testCase.key)}>{t('dash.action.run')}</a>
        </div>
      )}
      {review && <ReviewForm id={rec.id} onDone={reload} prominent />}

      <div className="split">
        <div className="stack">
          <Section title={t('run.steps')}>
            {rec.steps.length === 0 && <p className="muted">{t('run.noSteps')}</p>}
            <ol className="steps">
              {rec.steps.map((s) => (
                <li key={s.index} className="step">
                  <span className="step-n">{s.index}</span>
                  <div className="grow stack-sm">
                    <Badge status={s.status} />
                    {s.note && <p className="pre">{s.note}</p>}
                    <Shots
                      items={(s.evidence ?? []).map(
                        (sha) => ev(sha) ?? { sha256: sha, name: sha.slice(0, 12) },
                      )}
                    />
                  </div>
                </li>
              ))}
            </ol>
            {(byStep.get(0)?.length ?? 0) > 0 && (
              <>
                <h3>{t('run.otherEvidence')}</h3>
                <Shots items={byStep.get(0) ?? []} />
              </>
            )}
          </Section>
          <Section title={t('run.judgements', { count: r.judgements.length })}>
            {r.judgements.length === 0 && <p className="muted">{t('run.noJudgements')}</p>}
            <div className="table-wrap" hidden={r.judgements.length === 0}>
              <table>
                <thead>
                  <tr>
                    <th>{t('run.judge')}</th>
                    <th>{t('run.verdict')}</th>
                    <th>{t('run.reason')}</th>
                    <th>{t('run.by')}</th>
                  </tr>
                </thead>
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
                      </td>
                      <td className="pre">{j.reason ?? '—'}</td>
                      <td className="small">
                        {j.by?.name ?? j.by?.id ?? '—'}
                        <br />
                        <span className="muted">{date(j.at)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          {!review && <ReviewForm id={rec.id} onDone={reload} />}
        </div>
        <div className="stack">
          <Section title={t('run.details')}>
            <Meta
              items={[
                [t('run.actor'), `${rec.actor.name ?? rec.actor.id} (${rec.actor.kind})`],
                [t('run.source'), rec.source],
                [t('scope.release'), rec.release],
                [t('scope.environment'), rec.environment],
                [t('run.build'), rec.build.commit && <code>{rec.build.commit.slice(0, 12)}</code>],
                [t('run.ci'), rec.ci?.url && <a href={rec.ci.url}>{rec.ci.job ?? rec.ci.provider} ↗</a>],
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
        </div>
      </div>
    </>
  );
}

function Shots({ items }: { items: { sha256: string; name: string; media_type?: string; size?: number }[] }) {
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
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

function ReviewForm({ id, onDone, prominent }: { id: string; onDone: () => void; prominent?: boolean }) {
  const { t } = useI18n();
  const [verdict, setVerdict] = useState<ReviewInput['verdict']>();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async () => {
    if (!verdict) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.review(id, { verdict, reason: reason.trim() });
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
