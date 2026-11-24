'use client';

/**
 * Chapter 3 — Run. Sam opens TC-8 in the web app, starts a manual run, ticks each check, pastes a
 * screenshot and saves: the failed P0 test now passes, with evidence. Layout and words follow the real test
 * case page (packages/web/src/screens/TestCase.tsx, messages/en.json and ja.json).
 */
import type { DemoText } from '@/content/types';
import { AppHeader, AppText, at, Browser, Pill, Pointer, Priority, ScrollView, useMs } from './kit';

const T = {
  pointRun: 700,
  run: 1300,
  pointCheck1: 2300,
  check1: 2800,
  pointShot: 3600,
  shot: 4100,
  shotDone: 4500,
  pointNext: 5300,
  next: 5800,
  pointCheck2: 6600,
  check2: 7100,
  pointSave: 7900,
  save: 8400,
  saved: 8900,
  end: 12800,
};
export const runTimes = () => T;

/** The screenshot Sam pastes: the shop's sign-in form with the error. */
function Shot({ t }: { t: DemoText }) {
  return (
    <div className="rn-shot" aria-hidden="true">
      <div className="rn-shot-bar">
        <span>Shop</span>
        <span>Cart (0)</span>
        <span>{t.run.signIn}</span>
      </div>
      <div className="rn-shot-form">
        <b>{t.run.signIn}</b>
        <i>casey@shop.test</i>
        <i>••••••••••••••</i>
        <em>{t.run.error}</em>
      </div>
    </div>
  );
}

export function RunScene({ t }: { t: DemoText }) {
  const ms = useMs();
  const r = t.run;
  const a = t.app;
  const running = ms >= T.run && ms < T.saved;
  const step = ms >= T.next ? 2 : 1;
  const checked1 = ms >= T.check1;
  const checked2 = ms >= T.check2;
  const passed = ms >= T.saved;
  const click = [T.run, T.check1, T.shot, T.next, T.check2, T.save].some((c) => ms >= c - 120 && ms < c + 180);
  const pointer = at<string | null>(
    ms,
    [
      [T.pointRun, 'rn-run'],
      [T.pointCheck1, 'rn-check1'],
      [T.pointShot, 'rn-shot'],
      [T.pointNext, 'rn-next'],
      [T.pointCheck2, 'rn-check2'],
      [T.pointSave, 'rn-save'],
      [T.saved + 300, null],
    ],
    null,
  );
  const scrollTo = at<string | null>(
    ms,
    [
      [T.run + 150, 'rn-runner'],
      [T.next + 200, 'rn-step2'],
      [T.saved + 200, null],
    ],
    null,
  );

  return (
    <div className="dm-desk dm-desk-plain">
      <Browser url="watch.shop.test/#/tc/TC-8" className="dm-full">
        <AppHeader app={a} active={1} avatar="SA" />
        <div className="app-page">
          <ScrollView to={scrollTo} offset={16}>
            <div className="tc-top">
              <span className="app-link">{a.nav[1]}</span>
              <span className="tc-pos">
                {r.position}
                <span className="tc-dots">
                  {Array.from({ length: 10 }, (_, i) => (
                    <i key={i} className={i === 7 ? 'on' : ''} />
                  ))}
                </span>
              </span>
            </div>
            <article className="tc-card">
              <p className="tc-pills">
                <code>TC-8</code>
                {passed ? <Pill tone="pass">{a.pass}</Pill> : <Pill tone="fail">{a.fail}</Pill>}
                <Priority p="P0" />
                <span className="app-tag">{a.manual}</span>
              </p>
              <h3 className="tc-title">{r.title}</h3>
              <h4 className="tc-h">{r.what}</h4>
              <p className="tc-purpose">{r.purpose}</p>
              <p className="tc-feature">{r.featureLine}</p>
              <p className="tc-ac">
                <code>AC-4.2</code>
                <span>
                  <AppText text={r.criterion} />
                </span>
                {passed ? (
                  <Pill tone="pass" small>
                    {a.pass}
                  </Pill>
                ) : (
                  <Pill tone="fail" small>
                    {a.fail}
                  </Pill>
                )}
              </p>

              <h4 className="tc-h">{r.stepsTitle}</h4>
              {running && (
                <div className="rn-eyebrow" data-target="rn-runner">
                  <b>{r.eyebrow}</b>
                  <span className="app-tag">v1.2.0</span>
                  <span className="app-tag">Staging</span>
                  <span className="app-tag">{r.reading}</span>
                  <span className="rn-cancel">{r.cancel}</span>
                </div>
              )}

              {r.steps.map((s, i) => {
                const n = i + 1;
                const active = running && step === n;
                const doneStep = running && step > n;
                const checked = n === 1 ? checked1 : checked2;
                return (
                  <div
                    key={s.text}
                    className={`rn-step ${active ? 'is-active' : ''} ${doneStep ? 'is-done' : ''}`}
                    data-target={n === 2 ? 'rn-step2' : undefined}
                  >
                    <p className="rn-instr">
                      <span className="rn-num">{doneStep ? '✓' : n}</span>
                      <span>
                        <AppText text={s.text} />
                      </span>
                    </p>
                    {!doneStep && (
                      <>
                        <p className="rn-expected">
                          <b>{r.expected}</b> <AppText text={s.expected} />
                        </p>
                        <p className="rn-check" data-target={`rn-check${n}`}>
                          <span className={`rn-box ${(active && checked) || passed ? 'on' : ''}`}>
                            {(active && checked) || passed ? '✓' : ''}
                          </span>
                          <span>
                            <AppText text={s.check} />
                          </span>
                        </p>
                      </>
                    )}
                    {active && (
                      <div className="rn-controls">
                        <div className="rn-verdicts">
                          {r.verdicts.map((v, vi) => (
                            <span key={v} className={vi === 0 && checked ? 'on' : ''}>
                              {['✓', '✕', '||', '»'][vi]} {v}
                            </span>
                          ))}
                        </div>
                        {checked && <p className="rn-hint">{r.allChecked}</p>}
                        {n === 1 && (
                          <div className="rn-drop" data-target="rn-shot">
                            {ms >= T.shotDone ? (
                              <figure>
                                <Shot t={t} />
                                <figcaption>{r.shotCaption}</figcaption>
                              </figure>
                            ) : ms >= T.shot ? (
                              <span className="rn-uploading">…</span>
                            ) : (
                              <span>
                                <b>+ {r.addShot}</b>
                                <br />
                                or paste (Ctrl+V / ⌘V) here
                              </span>
                            )}
                          </div>
                        )}
                        <span className="app-btn app-btn-primary" data-target={n === 1 ? 'rn-next' : 'rn-save'}>
                          {n === 1 ? `${r.next} →` : ms >= T.save ? '…' : r.save}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}

              <h4 className="tc-h">{r.result}</h4>
              <p className="tc-result">
                {passed ? (
                  <>
                    <Pill tone="pass">{a.pass}</Pill> {r.resultLine}
                  </>
                ) : (
                  <>
                    <Pill tone="fail">{a.fail}</Pill> {r.resultBefore}
                  </>
                )}
              </p>
            </article>
            <div className="tc-bottom">
              <span className="app-btn">← Previous</span>
              {!running && !passed && (
                <span className="app-btn app-btn-primary" data-target="rn-run">
                  ▶ {r.runManually}
                </span>
              )}
              <span className="app-btn">Next →</span>
            </div>
            <Pointer target={pointer} click={click} />
          </ScrollView>
          {ms >= T.saved && ms < T.end - 1500 && <div className="app-toast">✓ {r.saved}</div>}
        </div>
      </Browser>
    </div>
  );
}
