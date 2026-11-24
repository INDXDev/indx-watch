'use client';

/**
 * Chapter 2 — Automate. A pull request: the Playwright job streams its log (the indx-watch reporter records
 * one run per tagged test), the checks finish, and the INDX Watch action's comment shows the readiness gate
 * and the test cases this change touches. TC-8, a manual test, still blocks the release.
 */
import { CI_LOG } from '@/content/code';
import type { DemoText } from '@/content/types';
import { Rich } from '../rich';
import { Pointer, revealed, ScrollView, Terminal, useMs } from './kit';

export function ciTimes() {
  const log = 900;
  const logEnd = log + CI_LOG.length * 300;
  const check1 = logEnd + 500;
  const check2 = check1 + 500;
  const comment = check2 + 450;
  const point = comment + 1500;
  return { log, logEnd, check1, check2, comment, point, end: point + 3600 };
}

function Spinner() {
  return <span className="gh-spin" aria-hidden="true" />;
}

export function CiScene({ t }: { t: DemoText }) {
  const ms = useMs();
  const c = t.ci;
  const T = ciTimes();
  const lines = revealed(ms, T.log, 300, CI_LOG.length);
  const logOpen = ms >= T.log - 400 && ms < T.check1;
  const done1 = ms >= T.check1;
  const done2 = ms >= T.check2;

  return (
    <div className="dm-desk dm-desk-plain">
      <div className="dm-window dm-browser dm-full">
        <div className="dm-titlebar">
          <span className="dm-lights">
            <i />
            <i />
            <i />
          </span>
          <span className="dm-url">github.com/shop-team/shop/pull/42</span>
        </div>
        <div className="dm-viewport gh">
          <ScrollView to={ms >= T.comment ? 'gh-comment' : null} offset={20}>
            <div className="gh-head">
              <h3>
                {c.prTitle} <span>#42</span>
              </h3>
              <p>
                <span className="gh-state">⑂ Open</span> {c.prMeta}
              </p>
              <nav className="gh-tabs">
                <span className="on">Conversation 3</span>
                <span>Commits 2</span>
                <span>Checks 2</span>
                <span>Files changed 2</span>
              </nav>
            </div>
            <div className="gh-body">
              <div className="gh-main">
                <div className="gh-comment">
                  <div className="gh-avatar">AL</div>
                  <div className="gh-box">
                    <p className="gh-box-head">
                      <b>alex</b> commented 4 minutes ago
                    </p>
                    <p className="gh-box-body">
                      Adds TC-11 (unknown coupon). Drafted with <code>/iw-design</code>, reviewed and approved by me.
                    </p>
                  </div>
                </div>
                <div className="gh-event">
                  <span className="gh-commit">⊸</span> alex added 2 commits · <code>a41c9e2</code>{' '}
                  <span className="gh-muted">test: unknown coupon is refused (TC-11)</span>
                </div>

                {ms >= T.comment && (
                  <div className="gh-comment gh-in" data-target="gh-comment">
                    <div className="gh-avatar gh-bot">IW</div>
                    <div className="gh-box">
                      <p className="gh-box-head">
                        <b>github-actions</b> <span className="gh-tag">bot</span> commented now
                      </p>
                      <div className="gh-box-body gh-report">
                        <h4>{c.commentHead}</h4>
                        <p className="gh-verdict">{c.verdict}</p>
                        <table>
                          <tbody>
                            {c.checks.map((row) => (
                              <tr key={row.label} className={row.pass ? '' : 'bad'} data-target={row.pass ? undefined : 'gh-bad'}>
                                <td>{row.label}</td>
                                <td className="num">{row.now}</td>
                                <td className="num">{row.needed}</td>
                                <td className={row.pass ? 'ok' : 'no'}>{row.pass ? '✓ Pass' : '✕ Fail'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="gh-suggest">{c.suggested}</p>
                        <ul>
                          {c.suggestedItems.map((s) => (
                            <li key={s.key}>
                              <b>{s.key}</b> {s.title} <span className="gh-muted">— {s.why}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                <div className="gh-merge">
                  <div className={`gh-merge-head ${done2 ? 'bad' : ''}`}>
                    <span className="gh-merge-icon">{done2 ? '✕' : <Spinner />}</span>
                    <div>
                      <b>{done2 ? c.checksTitle : 'Some checks haven’t completed yet'}</b>
                      <p>{done2 ? '1 failing, 1 successful check' : '1 in progress, 1 queued check'}</p>
                    </div>
                  </div>
                  <ul>
                    {c.checkRows.map((row, i) => {
                      const finished = i === 0 ? done1 : done2;
                      return (
                        <li key={row.name}>
                          <span className={`gh-ci ${finished ? (row.pass ? 'ok' : 'no') : ''}`}>
                            {finished ? (row.pass ? '✓' : '✕') : <Spinner />}
                          </span>
                          <b>{row.name}</b>
                          <span className="gh-muted">
                            {finished ? row.detail : i === 0 ? 'In progress — Running npx playwright test' : 'Queued'}
                          </span>
                          <span className="gh-details">Details</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
              <aside className="gh-side">
                <p className="gh-side-title">Reviewers</p>
                <p className="gh-muted">sam · requested</p>
                <p className="gh-side-title">Labels</p>
                <p>
                  <span className="gh-label">tests</span> <span className="gh-label">checkout</span>
                </p>
                <p className="gh-side-title">Development</p>
                <p className="gh-muted">Covers AC-2.3</p>
              </aside>
            </div>
            <Pointer target={ms >= T.point ? 'gh-bad' : null} />
          </ScrollView>
        </div>
      </div>

      <Terminal title="e2e · Playwright tests — ubuntu-latest" className={`dm-log ${logOpen ? 'is-open' : ''}`}>
        {CI_LOG.slice(0, lines).map((line, i) => (
          <div
            key={`${i}:${line}`}
            className={
              line.startsWith('$')
                ? 'log-cmd'
                : line.startsWith('[indx-watch]')
                  ? 'log-iw'
                  : line.includes('FAIL') || line.includes('FAILED')
                    ? 'log-bad'
                    : line.includes('✓') || line.includes('passed')
                      ? 'log-ok'
                      : ''
            }
          >
            <Rich text={line} />
          </div>
        ))}
      </Terminal>
    </div>
  );
}
