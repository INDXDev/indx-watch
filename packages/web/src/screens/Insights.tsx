/** Insights: trends and progress as plain SVG and CSS, each with its numbers as a table (docs/spec/web.md#insights). */
import type { ReactNode } from 'react';
import { useApp } from '../App';
import { api, type Insights as Data } from '../api';
import { type MsgKey, useI18n } from '../i18n';
import { Load, useApi } from '../ui';

const W = 360;
const H = 180;
const PAD = { l: 30, r: 100, t: 12, b: 28 };

/** Seconds as "1 min 35 s"; the unit words come from the messages. */
function useDuration() {
  const { t } = useI18n();
  return (s: number) => {
    const n = Math.round(s);
    return n < 60
      ? t('insights.dur.s', { s: n })
      : t('insights.dur.ms', { m: Math.floor(n / 60), s: n % 60 });
  };
}

/** The numbers of a chart, for people who do not see it. */
function Numbers({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  const { t } = useI18n();
  return (
    <details className="ins-numbers">
      <summary>{t('insights.numbers')}</summary>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r[0])}>
                {r.map((c, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed columns
                  <td key={i}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)} %`);

/** Where the label of a line sits: at its last point, pushed down when the other line ends right next to it. */
function labelY(id: string, lines: { id: string; pts: readonly (readonly [number, number])[] }[]) {
  const ends = lines.map((l) => ({ id: l.id, y: l.pts.at(-1)?.[1] }));
  const mine = ends.find((e) => e.id === id)!.y!;
  const other = ends.find((e) => e.id !== id)?.y;
  const gap = other === undefined ? 14 : Math.abs(mine - other);
  const below = other !== undefined && gap < 14 && (mine > other || (mine === other && id === 'coverage'));
  return mine + 4 + (below ? 14 - gap : 0);
}

/** Pass rate and coverage by release: two lines, labelled where they end. */
function Trend({ rows }: { rows: Data['releases'] }) {
  const { t } = useI18n();
  const x = (i: number) =>
    PAD.l + (rows.length < 2 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (rows.length - 1));
  const y = (v: number) => PAD.t + (1 - v) * (H - PAD.t - PAD.b);
  const lines = [
    { id: 'pass', label: t('insights.passRate'), pick: (r: Data['releases'][number]) => r.passRate },
    { id: 'coverage', label: t('insights.coverage'), pick: (r: Data['releases'][number]) => r.coverage },
  ].map((l) => ({
    ...l,
    pts: rows.flatMap((r, i) => (l.pick(r) === null ? [] : [[x(i), y(l.pick(r)!)] as const])),
  }));
  const last = rows.at(-1);
  const summary = t('insights.trend.summary', {
    count: rows.length,
    pass: pct(last?.passRate ?? null),
    coverage: pct(last?.coverage ?? null),
  });
  return (
    <section className="card" aria-labelledby="ins-trend">
      <h2 id="ins-trend">{t('insights.trend')}</h2>
      <svg className="ins-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        {[0, 0.5, 1].map((g) => (
          <g key={g}>
            <line className="ins-grid" x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} />
            <text className="ins-axis" x={PAD.l - 6} y={y(g) + 4} textAnchor="end">
              {g * 100}
            </text>
          </g>
        ))}
        {rows.map((r, i) => (
          <text key={r.version} className="ins-axis" x={x(i)} y={H - 8} textAnchor="middle">
            {r.version}
          </text>
        ))}
        {lines.map((l) => (
          <g key={l.id} className={`ins-line ins-${l.id}`}>
            <polyline points={l.pts.map((p) => p.join(',')).join(' ')} fill="none" />
            {l.pts.map(([px, py]) => (
              <circle key={`${px}`} cx={px} cy={py} r="3.5" />
            ))}
            {l.pts.length > 0 && (
              <text x={l.pts.at(-1)![0] + 8} y={labelY(l.id, lines)}>
                {l.label} {pct(l.pick(last!))}
              </text>
            )}
          </g>
        ))}
      </svg>
      <Numbers
        head={[
          t('insights.release'),
          t('insights.passRate'),
          t('insights.coverage'),
          t('insights.flaky'),
          t('insights.gate'),
        ]}
        rows={rows.map((r) => [
          r.version,
          pct(r.passRate),
          pct(r.coverage),
          r.flaky,
          t(r.gate ? 'insights.gate.pass' : 'insights.gate.fail'),
        ])}
      />
    </section>
  );
}

interface Part {
  n: number;
  cls: string;
  label: string;
}
/** One bar per row, split into parts; the counts are written at the end of the row. */
function Bars({
  id,
  title,
  rows,
  head,
}: {
  id: string;
  title: string;
  rows: { label: string; parts: Part[] }[];
  head: string[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.parts.reduce((a, p) => a + p.n, 0)));
  const legend = rows[0]?.parts ?? [];
  return (
    <section className="card" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <p className="ins-legend muted small" aria-hidden="true">
        {legend.map((p) => (
          <span key={p.cls}>
            <i className={`ins-key ${p.cls}`} /> {p.label}
          </span>
        ))}
      </p>
      <ul className="ins-bars">
        {rows.map((r) => {
          const total = r.parts.reduce((a, p) => a + p.n, 0);
          return (
            <li key={r.label}>
              <span className="ins-label">{r.label}</span>
              <span className="ins-bar" style={{ width: `${(total / max) * 100}%` }}>
                {r.parts.map((p) => (
                  <span
                    key={p.cls}
                    className={p.cls}
                    style={{ flexGrow: p.n }}
                    title={`${p.label}: ${p.n}`}
                  />
                ))}
              </span>
              <span className="ins-n">{r.parts.map((p) => p.n).join(' / ')}</span>
            </li>
          );
        })}
      </ul>
      <Numbers head={head} rows={rows.map((r) => [r.label, ...r.parts.map((p) => p.n)])} />
    </section>
  );
}

export function Insights() {
  const { t } = useI18n();
  const { scope } = useApp();
  const dur = useDuration();
  const state = useApi(() => api.insights(scope.release), [scope.release]);
  const part = (n: number, cls: string, key: MsgKey): Part => ({ n, cls, label: t(key) });
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('insights.title')}</h1>
          <p className="muted">{t('insights.intro')}</p>
        </div>
      </div>
      <Load state={state}>
        {(d) =>
          d.releases.every((r) => r.passRate === null) &&
          d.manual.samples === 0 &&
          d.assignees.length === 0 ? (
            <p className="muted">{t('insights.empty')}</p>
          ) : (
            <div className="ins-grid-cards">
              <Trend rows={d.releases} />
              <Bars
                id="ins-assignee"
                title={t('insights.assignees', { release: d.release ?? '' })}
                head={[
                  t('insights.assignee'),
                  t('insights.done'),
                  t('insights.review'),
                  t('insights.blocked'),
                  t('insights.todo'),
                ]}
                rows={d.assignees.map((a) => ({
                  label: a.assignee ?? t('insights.unassigned'),
                  parts: [
                    part(a.done, 'ins-done', 'insights.done'),
                    part(a.review, 'ins-review', 'insights.review'),
                    part(a.blocked, 'ins-blocked', 'insights.blocked'),
                    part(a.todo, 'ins-todo', 'insights.todo'),
                  ],
                }))}
              />
              <Bars
                id="ins-feature"
                title={t('insights.features')}
                head={[t('insights.feature'), t('insights.pass'), t('insights.fail'), t('insights.open')]}
                rows={d.features.map((f) => ({
                  label: `${f.key} ${f.title}`,
                  parts: [
                    part(f.pass, 'ins-done', 'insights.pass'),
                    part(f.fail, 'ins-blocked', 'insights.fail'),
                    part(f.open, 'ins-todo', 'insights.open'),
                  ],
                }))}
              />
              <section className="card" aria-labelledby="ins-manual">
                <h2 id="ins-manual">{t('insights.manual')}</h2>
                {d.manual.median === null ? (
                  <p className="muted">{t('insights.noSamples')}</p>
                ) : (
                  <>
                    <p className="ins-big">{dur(d.manual.median)}</p>
                    <p className="muted small">{t('insights.samples', { count: d.manual.samples })}</p>
                  </>
                )}
                {d.manual.samples > 0 && (
                  <Numbers
                    head={[t('insights.release'), t('insights.median'), t('insights.runs')]}
                    rows={d.manual.byRelease.map((r) => [
                      r.version,
                      r.median === null ? '–' : dur(r.median),
                      r.samples,
                    ])}
                  />
                )}
              </section>
              <Bars
                id="ins-flaky"
                title={t('insights.flakyTitle')}
                head={[t('insights.release'), t('insights.flaky'), t('insights.steady')]}
                rows={d.releases.map((r) => ({
                  label: r.version,
                  parts: [
                    part(r.flaky, 'ins-review', 'insights.flaky'),
                    part(r.tests - r.flaky, 'ins-todo', 'insights.steady'),
                  ],
                }))}
              />
            </div>
          )
        }
      </Load>
    </>
  );
}
