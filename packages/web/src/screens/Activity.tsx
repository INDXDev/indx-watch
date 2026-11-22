import { useState } from 'react';
/** Activity: runs and uploads with who did them (List), and one run per screen (Focus). docs/spec/web.md#screens */
import { useApp } from '../App';
import { api, type RunSummary, type SpecTree } from '../api';
import { useI18n } from '../i18n';
import { href, navigate } from '../router';
import { Badge, FeedItem, Focus, Load, Seg, Tx, useApi, ViewSwitch } from '../ui';
import { UploadRow } from './Home';
import { RunView } from './Run';

type Filter = 'all' | 'review';
const pickRuns = (runs: RunSummary[], f?: string) =>
  f === 'review' ? runs.filter((r) => r.verdict === 'needs_review') : runs;
const tcIndex = (tree?: SpecTree) =>
  new Map(
    (tree?.features ?? []).flatMap((f) =>
      f.useCases.flatMap((u) => u.criteria.flatMap((c) => c.testCases.map((x) => [x.key, x] as const))),
    ),
  );

export function Activity({ filter }: { filter?: string | undefined }) {
  const { t } = useI18n();
  const { scope } = useApp();
  const deps = [scope.release, scope.env];
  const runs = useApi(() => api.runs({ release: scope.release, env: scope.env, limit: 200 }), deps);
  const specs = useApi(() => api.specs({ ...scope, mine: false }), deps);
  const snaps = useApi(api.snapshots, []);
  const f: Filter = filter === 'review' ? 'review' : 'all';
  const [shown, setShown] = useState(50);
  const tcs = tcIndex(specs.data);
  const q = f === 'review' ? { f } : undefined;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('activity.title')}</h1>
          <p className="muted">{t('activity.intro')}</p>
        </div>
        <div className="filters">
          <ViewSwitch
            view="list"
            list={href.activity(q)}
            focus={
              runs.data && pickRuns(runs.data, f)[0] ? href.run(pickRuns(runs.data, f)[0]!.id, q) : undefined
            }
          />
          <Seg
            label={t('activity.filter')}
            value={f}
            options={['all', 'review'] as const}
            text={(x) => t(`activity.filter.${x}`)}
            onChange={(x) => navigate(href.activity(x === 'review' ? { f: x } : undefined))}
          />
          <a className="btn btn-ghost" href={href.uploads()}>
            {t('nav.uploads')}
          </a>
        </div>
      </div>
      <Load state={runs}>
        {(all) => {
          const list = pickRuns(all, f).slice(0, shown);
          return (
            <section className="card">
              {list.length === 0 && (
                <p className="muted">{t(f === 'review' ? 'activity.noReview' : 'home.activity.empty')}</p>
              )}
              <ul className="list feed">
                {f === 'all' && snaps.data?.[0] && <UploadRow s={snaps.data[0]} />}
                {list.map((r) => {
                  const tc = tcs.get(r.testCase);
                  return (
                    <FeedItem key={r.id} who={r.actor} at={r.at} unverified={r.unverified}>
                      <Badge status={r.verdict} />{' '}
                      <a href={href.run(r.id, q)}>
                        <span className="key">{r.testCase}</span> {tc ? <Tx of={tc} field="title" /> : null}
                      </a>{' '}
                      <span className="muted small">
                        {[r.release, r.environment, r.source].filter(Boolean).join(' · ')}
                      </span>
                    </FeedItem>
                  );
                })}
              </ul>
              {pickRuns(all, f).length > shown && (
                <button type="button" className="btn btn-ghost" onClick={() => setShown(shown + 50)}>
                  {t('activity.more')}
                </button>
              )}
            </section>
          );
        }}
      </Load>
    </>
  );
}

/** #/runs/<id>: one run per screen, with ← / → over the activity list (or the review queue with f=review). */
export function RunFocus({ id, filter }: { id: string; filter?: string | undefined }) {
  const { t } = useI18n();
  const { scope } = useApp();
  const runs = useApi(
    () => api.runs({ release: scope.release, env: scope.env, limit: 200 }),
    [scope.release, scope.env],
  );
  const items = pickRuns(runs.data ?? [], filter).map((r) => r.id);
  const list = items.includes(id) ? items : [id];
  const q = filter === 'review' ? { f: 'review' } : undefined;
  return (
    <>
      <div className="page-head page-head-tight">
        <p className="eyebrow">
          <a href={href.activity(q)}>{t('nav.activity')}</a>
          {filter === 'review' && ` · ${t('activity.filter.review')}`}
        </p>
        <ViewSwitch view="focus" list={href.activity(q)} />
      </div>
      <Focus items={list} at={id} go={(k) => href.run(k, q)}>
        <RunView id={id} />
      </Focus>
    </>
  );
}
