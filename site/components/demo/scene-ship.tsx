'use client';

/**
 * Chapter 4 — Ship. The home screen picks up Sam's result, the readiness gate turns green, the agent
 * answers "can we ship?", and the product manager opens the customer report. Layout and words follow the
 * real Home and Report screens (packages/web/src/screens/Home.tsx, Report.tsx).
 */
import type { DemoText } from '@/content/types';
import { Rich } from '../rich';
import { AppHeader, at, Browser, Pill, Pointer, Priority, Terminal, typed, typeTime, useMs } from './kit';

export function shipTimes(t: DemoText) {
  const arrive = 1000;
  const ready = 1700;
  const chat = 3000;
  const ask = chat + 400;
  const answer = ask + typeTime(t.ship.ask, 28) + 1300;
  const chatOut = answer + 3600;
  const pointShare = chatOut + 300;
  const share = pointShare + 600;
  const report = share + 350;
  const pointHtml = report + 1500;
  return { arrive, ready, chat, ask, answer, chatOut, pointShare, share, report, pointHtml, end: pointHtml + 3000 };
}

export function ShipScene({ t }: { t: DemoText }) {
  const ms = useMs();
  const s = t.ship;
  const a = t.app;
  const T = shipTimes(t);
  const ready = ms >= T.ready;
  const onReport = ms >= T.report;
  const items = ms >= T.arrive ? s.activityItems : s.activityItems.slice(1);
  const pointer = at<string | null>(
    ms,
    [
      [T.pointShare, 'sh-share'],
      [T.report + 200, null],
      [T.pointHtml, 'sh-html'],
    ],
    null,
  );
  const click = ms >= T.share - 120 && ms < T.share + 180;

  return (
    <div className="dm-desk dm-desk-plain">
      <Browser url={onReport ? 'watch.shop.test/#/report' : 'watch.shop.test/#/'} className="dm-full">
        <AppHeader app={a} active={onReport ? 4 : 0} avatar="AL" />
        <div className="app-page app-page-wide">
          {!onReport ? (
            <div className="sh-home">
              <section className={`sh-hero ${ready ? 'is-ready' : ''}`}>
                <div>
                  <p className="sh-eyebrow">{s.eyebrow}</p>
                  <h3>
                    <b>v1.2.0</b> {s.release}
                  </h3>
                  <p className="sh-verdict">
                    <span>{ready ? '✓' : '✕'}</span> {ready ? s.ready : s.notReady}
                  </p>
                  <div className="sh-progress">
                    <i style={{ width: ready ? '100%' : '88.9%' }} />
                  </div>
                  <p className="sh-progress-label">{ready ? s.progressAfter : s.progressBefore}</p>
                </div>
                <div className="sh-actions">
                  {!ready && <span className="app-btn app-btn-primary">▶ {s.start}</span>}
                  <span className="app-btn" data-target="sh-share">
                    {s.share}
                  </span>
                </div>
              </section>
              <div className="sh-cards">
                <div className="sh-card">
                  <p>{s.cards[0]}</p>
                  <b>
                    {ready ? 9 : 8}
                    <small> / 9</small>
                  </b>
                </div>
                <div className="sh-card">
                  <p>{s.cards[1]}</p>
                  <b className={ready ? '' : 'bad'}>{ready ? 0 : 1}</b>
                </div>
                <div className="sh-card">
                  <p>{s.cards[2]}</p>
                  <b>
                    9<small> / 10</small>
                  </b>
                </div>
                <div className="sh-card">
                  <p>{s.cards[3]}</p>
                  <span className="sh-latest">
                    <i className="sh-av">{ms >= T.arrive ? 'SA' : 'CI'}</i>
                    {ms >= T.arrive ? 'Sam' : 'CI'} <small>{ms >= T.arrive ? a.justNow : '12 min'}</small>
                  </span>
                </div>
              </div>
              <div className="sh-grid">
                <section className="sh-panel">
                  <h4>{s.queue}</h4>
                  {ready ? (
                    <p className="sh-empty">{s.queueEmpty}</p>
                  ) : (
                    <p className="sh-row">
                      <Pill tone="fail">{a.fail}</Pill>
                      <span className="sh-link">
                        <code>TC-8</code> {t.run.title}
                      </span>
                      <Priority p="P0" />
                      <span className="app-btn app-btn-sm">{s.seeFailure}</span>
                    </p>
                  )}
                </section>
                <section className="sh-panel">
                  <h4>{s.activity}</h4>
                  <ul className="sh-activity">
                    {items.map((item, i) => (
                      <li key={item.key} className={i === 0 && ms >= T.arrive ? 'is-new' : ''}>
                        <i className={`sh-av ${item.ci ? 'sh-av-ci' : ''}`}>{item.ci ? '⚙' : item.initials}</i>
                        <span>
                          <b>{item.who}</b> {item.did}{' '}
                          <span className="sh-link">
                            <code>{item.key}</code> {item.title}
                          </span>
                          <small>{i === 0 && ms >= T.arrive ? a.justNow : a.hoursAgo}</small>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </div>
          ) : (
            <div className="sh-report">
              <div className="sh-report-bar">
                <h3>{s.reportScreen}</h3>
                <span className="sh-label">{s.audience}</span>
                <span className="sh-seg">
                  <span className="on">{s.reportActions[0]}</span>
                  <span>{s.reportActions[1]}</span>
                </span>
                <span className="app-btn app-btn-primary" data-target="sh-html">
                  {s.reportActions[2]}
                </span>
                <span className="app-btn">{s.reportActions[3]}</span>
              </div>
              <p className="sh-hint">{s.customerHint}</p>
              <div className="sh-paper">
                <p className="sh-paper-kicker">Test report · customer</p>
                <h3>{s.reportTitle}</h3>
                <p className="sh-paper-meta">{s.reportMeta}</p>
                <p className="sh-paper-verdict">{s.reportVerdict}</p>
                <table>
                  <tbody>
                    {s.reportChecks.map((c) => (
                      <tr key={c.label}>
                        <td>{c.label}</td>
                        <td className="num">{c.now}</td>
                        <td className="num">{c.needed}</td>
                        <td className="ok">✓ {a.pass}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <Pointer target={pointer} click={click} />
        </div>
      </Browser>

      <Terminal title="claude — ~/shop" className={`dm-chat ${ms >= T.chat && ms < T.chatOut ? 'is-open' : ''}`}>
        <div className="cc-user">&gt; {ms < T.answer - 900 ? typed(s.ask, ms, T.ask, 28) : s.ask}</div>
        {ms >= T.answer - 900 && ms < T.answer && <div className="cc-spin">✻ Thinking…</div>}
        {ms >= T.answer && (
          <div className="cc-text cc-in">
            <span className="cc-dot">⏺</span>
            <span>
              <Rich text={s.answer} />
            </span>
          </div>
        )}
      </Terminal>
    </div>
  );
}
