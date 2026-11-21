/** Home: verdict hero, summary cards, your queue, recent activity, release details (docs/spec/web.md#home). */
import type { ReactNode } from 'react';
import { useApp } from '../App';
import {
  api,
  type PlanView,
  type RunSummary,
  type SnapshotSummary,
  type SpecTree,
  type StatusResult,
} from '../api';
import { type MsgKey, useI18n } from '../i18n';
import { href } from '../router';
import { Badge, FeedItem, Icon, Load, Priority, txt, useAgo, useApi, Who } from '../ui';
import { ReleaseDetails } from './Dashboard';

export const OPEN = ['fail', 'needs_review', 'blocked', 'stale', 'untested'];
const PRIO: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/**
 * Open test cases in the order a tester should take them: assigned to you, unassigned, the rest;
 * then by priority and status. Pure; tested.
 */
export function queue(
  status: Pick<StatusResult, 'testCases'>,
  prio: Map<string, string>,
  plan: PlanView | undefined,
  me: string,
): string[] {
  const assignee = new Map((plan?.items ?? []).map((i) => [i.test_case, i.assignee]));
  const group = (k: string) => (assignee.get(k) === me ? 0 : assignee.get(k) ? 2 : 1);
  return status.testCases
    .filter((x) => OPEN.includes(x.status))
    .sort(
      (a, b) =>
        group(a.key) - group(b.key) ||
        (PRIO[prio.get(a.key) ?? 'P3'] ?? 3) - (PRIO[prio.get(b.key) ?? 'P3'] ?? 3) ||
        OPEN.indexOf(a.status) - OPEN.indexOf(b.status) ||
        a.key.localeCompare(b.key, undefined, { numeric: true }),
    )
    .map((x) => x.key);
}

export function Home() {
  const { scope } = useApp();
  const deps = [scope.release, scope.env];
  const status = useApi(() => api.status(scope), deps);
  const specs = useApi(() => api.specs(scope), deps);
  const plans = useApi(api.plans, []);
  const runs = useApi(() => api.runs({ release: scope.release, env: scope.env, limit: 6 }), deps);
  return (
    <Load state={status}>
      {(s) => <Ready status={s} specs={specs.data} plans={plans.data ?? []} runs={runs.data ?? []} />}
    </Load>
  );
}

/** What the home cards share: titles, priorities, the queue and the counts. */
function useHome(status: StatusResult, specs: SpecTree | undefined, plans: PlanView[]) {
  const { locale } = useI18n();
  const { project, scope } = useApp();
  const tcs = (specs?.features ?? []).flatMap((f) =>
    f.useCases.flatMap((u) => u.criteria.flatMap((c) => c.testCases.map((tc) => ({ tc, prio: u.priority })))),
  );
  const title = new Map(tcs.map(({ tc }) => [tc.key, txt(tc, 'title', locale)]));
  const prio = new Map(tcs.map(({ tc, prio }) => [tc.key, prio]));
  const plan = plans.find((p) => p.release === scope.release);
  const me = project.identity.id;
  const todo = queue(status, prio, plan, me);
  const byKey = new Map(status.testCases.map((x) => [x.key, x]));
  const total = status.testCases.length;
  const passing = status.counts.pass + status.counts.waived;
  return { status, title, prio, plan, me, todo, byKey, total, passing };
}
type HomeData = ReturnType<typeof useHome>;

type Props = { status: StatusResult; specs?: SpecTree | undefined; plans: PlanView[]; runs: RunSummary[] };

function Ready({ status, specs, plans, runs }: Props) {
  const { t } = useI18n();
  const d = useHome(status, specs, plans);
  if (useApp().project.role === 'customer')
    return (
      <div className="home">
        <Hero d={d} />
        <Assigned d={d} plans={plans} />
      </div>
    );
  return (
    <div className="home">
      <Hero d={d} />

      <Cards d={d} />

      <div className="grid-2">
        <Queue d={d} />
        <Activity d={d} runs={runs} />
      </div>

      <details className="details-card">
        <summary>
          <span>{t('home.details')}</span>
          <span className="muted small">{t('home.detailsHint')}</span>
        </summary>
        <ReleaseDetails status={status} specs={specs} plans={plans} />
      </details>
    </div>
  );
}

/** The release verdict, progress and the main call to action. */
function Hero({ d: { status, todo, passing, total } }: { d: HomeData }) {
  const { t, locale } = useI18n();
  const { project, scope } = useApp();
  const release = project.releases.find((r) => r.version === scope.release);
  const failing = status.gate.checks.filter((c) => !c.passed);
  const ungated = failing.some((c) => c.key === 'has_gated_tests');
  const tone = ungated ? 'untested' : status.gate.passed ? 'pass' : 'fail';
  return (
    <section className={`hero hero-${tone}`} aria-labelledby="hero-h">
      <div className="hero-text">
        <p className="eyebrow">{t('dash.eyebrow')}</p>
        <h1 id="hero-h">
          {scope.release ?? t('scope.noRelease')}{' '}
          {release?.title && <span className="muted">{txt(release, 'title', locale)}</span>}
        </h1>
        <p className="hero-verdict" role="status">
          <Icon status={tone} />{' '}
          {ungated
            ? t('dash.ungated')
            : status.gate.passed
              ? t('dash.ready')
              : t('dash.notReady', { failed: failing.length, total: status.gate.checks.length })}
        </p>
        <div className="progress" role="img" aria-label={t('home.progress', { passing, total })}>
          <span style={{ width: `${total ? Math.round((passing / total) * 100) : 0}%` }} />
        </div>
        <p className="muted small">{t('home.progress', { passing, total })}</p>
      </div>
      <div className="hero-actions">
        {todo.length > 0 && project.can.run !== false && (
          <a className="btn btn-primary btn-lg" href={href.runner(todo[0]!, todo)}>
            ▶ {t('home.start', { count: todo.length })}
          </a>
        )}
        <a className={todo.length > 0 ? 'btn btn-lg' : 'btn btn-primary btn-lg'} href={href.report()}>
          {t('home.share')}
        </a>
      </div>
    </section>
  );
}

function Cards({ d: { status, passing, total } }: { d: HomeData }) {
  const { t } = useI18n();
  const snap = useApp().project.snapshot;
  const ago = useAgo();
  const c = status.counts;
  const attention = c.fail + c.needs_review + c.blocked + c.stale;
  return (
    <div className="cards">
      <a className="stat" href={href.tests()}>
        <span className="stat-label">{t('home.card.passing')}</span>
        <span className="stat-n">
          {passing}
          <small> / {total}</small>
        </span>
      </a>
      <a className={`stat${attention ? ' stat-warn' : ''}`} href={href.tests({ f: 'open' })}>
        <span className="stat-label">{t('home.card.attention')}</span>
        <span className="stat-n">{attention}</span>
      </a>
      <a className="stat" href={href.tests()}>
        <span className="stat-label">{t('home.card.coverage')}</span>
        <span className="stat-n">
          {status.coverage.covered}
          <small> / {status.coverage.total}</small>
        </span>
      </a>
      <a className="stat" href={href.uploads()}>
        <span className="stat-label">{t('home.card.upload')}</span>
        {snap ? (
          <span className="stat-who">
            <Who who={snap.actor} unverified={snap.unverified} />{' '}
            <span className="muted small">{ago(snap.at)}</span>
          </span>
        ) : (
          <span className="muted small">{t('home.card.noUpload')}</span>
        )}
      </a>
    </div>
  );
}

/** The first open test cases in queue order, each with its next action. */
function Queue({ d: { todo, byKey, title, prio, plan, me } }: { d: HomeData }) {
  const { t } = useI18n();
  const canRun = useApp().project.can.run !== false;
  const action = (key: string) => {
    const x = byKey.get(key);
    if (x?.latestRun && (x.status === 'fail' || x.status === 'needs_review'))
      return {
        to: href.run(x.latestRun),
        label: t(x.status === 'fail' ? 'dash.action.inspect' : 'dash.action.review'),
      };
    return canRun
      ? { to: href.runner(key, todo.slice(todo.indexOf(key))), label: t('dash.action.run') }
      : null;
  };
  return (
    <section className="card" aria-labelledby="queue-h">
      <header className="card-head">
        <h2 id="queue-h">{t('home.queue')}</h2>
        {todo.length > 5 && (
          <a className="btn btn-sm btn-ghost" href={href.testCase(todo[0]!, { f: 'open' })}>
            {t('home.seeAll', { count: todo.length })}
          </a>
        )}
      </header>
      {todo.length === 0 ? (
        <p className="muted">{t('home.queue.empty')}</p>
      ) : (
        <ul className="list">
          {todo.slice(0, 5).map((k) => {
            const a = action(k);
            const mine = plan?.items?.find((i) => i.test_case === k)?.assignee === me;
            return (
              <li key={k} className="queue-item">
                <Badge status={byKey.get(k)!.status} />
                <a href={href.testCase(k, { f: 'open' })}>
                  <span className="key">{k}</span> {title.get(k)}
                </a>
                <span className="queue-actions">
                  {prio.get(k) && <Priority p={prio.get(k)!} />}
                  {mine && <span className="chip chip-accent">{t('plan.you')}</span>}
                  {a && (
                    <a className="btn btn-sm" href={a.to}>
                      {a.label}
                    </a>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** A customer's Home: every plan item assigned to them, by plan (docs/spec/web.md#customer-view). */
function Assigned({ d: { title, byKey }, plans }: { d: HomeData; plans: PlanView[] }) {
  const { t, locale } = useI18n();
  const keys = plans.flatMap((p) => (p.items ?? []).map((i) => i.test_case));
  const row = (i: NonNullable<PlanView['items']>[number]) => {
    const x = byKey.get(i.test_case);
    const failed = x?.latestRun && x.status === 'fail' ? x.latestRun : undefined;
    const to = failed ? href.run(failed) : href.runner(i.test_case, keys.slice(keys.indexOf(i.test_case)));
    return (
      <li key={i.test_case} className="queue-item">
        <Badge status={x?.status ?? 'untested'} />
        <span>
          <span className="key">{i.test_case}</span> {title.get(i.test_case)}
        </span>
        <span className="queue-actions">
          {i.due && <span className="muted small">{i.due}</span>}
          <a className="btn btn-sm" href={to}>
            {t(failed ? 'dash.action.inspect' : 'dash.action.run')}
          </a>
        </span>
      </li>
    );
  };
  return (
    <section className="card" aria-labelledby="uat-h">
      <header className="card-head">
        <h2 id="uat-h">{t('home.uat')}</h2>
      </header>
      {keys.length === 0 && <p className="muted">{t('home.uat.empty')}</p>}
      {plans.map((p) => (
        <div key={p.key}>
          <h3>{txt(p, 'title', locale)}</h3>
          <ul className="list">{(p.items ?? []).map(row)}</ul>
        </div>
      ))}
    </section>
  );
}

/** Recent runs and the latest upload, newest first. */
function Activity({ d: { title }, runs }: { d: HomeData; runs: RunSummary[] }) {
  const { t } = useI18n();
  const snap = useApp().project.snapshot;
  const activity: { at: string; node: ReactNode }[] = runs.slice(0, 5).map((r) => ({
    at: r.at,
    node: (
      <FeedItem key={r.id} who={r.actor} at={r.at} unverified={r.unverified}>
        {t(`home.did.${r.verdict}` as MsgKey)}{' '}
        <a href={href.run(r.id)}>
          <span className="key">{r.testCase}</span> {title.get(r.testCase)}
        </a>
      </FeedItem>
    ),
  }));
  if (snap) activity.push({ at: snap.at, node: <UploadRow key={snap.id} s={snap} /> });
  activity.sort((a, b) => (a.at < b.at ? 1 : -1));
  return (
    <section className="card" aria-labelledby="act-h">
      <header className="card-head">
        <h2 id="act-h">{t('home.activity')}</h2>
        <a className="btn btn-sm btn-ghost" href={href.activity()}>
          {t('home.seeActivity')}
        </a>
      </header>
      {activity.length === 0 ? (
        <p className="muted">{t('home.activity.empty')}</p>
      ) : (
        <ul className="list feed">{activity.slice(0, 5).map((a) => a.node)}</ul>
      )}
    </section>
  );
}

export function UploadRow({ s }: { s: SnapshotSummary }) {
  const { t } = useI18n();
  return (
    <FeedItem who={s.actor} at={s.at} unverified={s.unverified}>
      <a href={href.uploads()}>{t('home.uploaded', { count: s.files })}</a>
      {s.message && <span className="muted"> — {s.message}</span>}
    </FeedItem>
  );
}
