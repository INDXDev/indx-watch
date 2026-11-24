'use client';

/**
 * Chapter 1 — Design. Claude Code (left) runs /iw-design, reads the checkout tests and the app, proposes
 * two missing tests and writes the one the person accepts; the editor (right) shows the new TC-11 draft,
 * then the person approves it in their own terminal (an agent never approves).
 */
import { TC11_PATH, TOML_TC11 } from '@/content/code';
import type { DemoText, TermLine } from '@/content/types';
import { highlight } from '../code';
import { Rich } from '../rich';
import { revealed, Terminal, typed, typeTime, useMs } from './kit';

export function designTimes(t: DemoText) {
  const d = t.design;
  const ask = 600;
  const send1 = ask + typeTime(d.ask, 26) + 350;
  const read = send1 + 500;
  const proposal = read + 4 * 420 + 900;
  const reply = proposal + d.proposal.length * 600 + 900;
  const send2 = reply + typeTime(d.reply, 30) + 350;
  const write = send2 + 600;
  const done = write + d.write.length * 420 + 400;
  const shell = done + 1300;
  const approved = shell + typeTime(d.shell, 60) + 450;
  return { ask, send1, read, proposal, reply, send2, write, done, shell, approved, end: approved + 2600 };
}

const SPIN = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];

function Line({ line }: { line: TermLine }) {
  if (line.kind === 'tool')
    return (
      <div className="cc-tool">
        <span className="cc-dot cc-dot-tool">⏺</span>
        <span>
          <b>{line.text.slice(0, line.text.indexOf('('))}</b>
          {line.text.slice(line.text.indexOf('('))}
        </span>
      </div>
    );
  if (line.kind === 'result')
    return (
      <div className="cc-result">
        <span>⎿</span>
        {line.text}
      </div>
    );
  return (
    <div className={line.kind === 'list' ? 'cc-text cc-list' : 'cc-text'}>
      <span className="cc-dot">{line.kind === 'text' ? '⏺' : ''}</span>
      <span>
        <Rich text={line.text} />
      </span>
    </div>
  );
}

const TC11_LINES = TOML_TC11.split('\n');
const USE_CASE = `key = "UC-2"
title = "Guest applies a coupon at checkout"
status = "ready"
actor = "Guest shopper"
goal = "Pay a discounted price for the items in the cart."
priority = "P0"

[[criteria]]
key = "AC-2.1"
text = "A valid coupon reduces the order total by its discount."

[[criteria]]
key = "AC-2.2"
text = "An expired coupon shows \\"This coupon has expired\\" and the total does not change."`.split('\n');

export function DesignScene({ t }: { t: DemoText }) {
  const ms = useMs();
  const d = t.design;
  const T = designTimes(t);

  const asking = ms < T.send1;
  const replying = ms >= T.reply && ms < T.send2;
  const prompt = asking ? typed(d.ask, ms, T.ask, 26) : replying ? typed(d.reply, ms, T.reply, 30) : '';
  const working =
    (ms >= T.send1 && ms < T.proposal) || (ms >= T.send2 && ms < T.done) ? SPIN[Math.floor(ms / 110) % SPIN.length] : null;
  const reads = revealed(ms, T.read, 420, d.read.length);
  const props = revealed(ms, T.proposal, 600, d.proposal.length);
  const writes = revealed(ms, T.write, 420, d.write.length);
  const editorOnTop = ms >= T.write;
  const tcLines = ms < T.write ? 0 : Math.min(TC11_LINES.length, Math.floor((ms - T.write) / 45) + 1);
  const shell = typed(d.shell, ms, T.shell, 60);

  return (
    <div className="dm-desk">
      <Terminal title="claude — ~/shop" className={`dm-cc ${editorOnTop ? '' : 'is-front'}`}>
        <div className="cc-log">
          <div className="cc-log-inner">
          <div className="cc-welcome">
            <p>
              <span className="cc-star">✻</span> {d.welcome}
            </p>
            <p className="cc-muted">/help for help, /status for your current setup</p>
            <p className="cc-muted">cwd: {d.cwd}</p>
          </div>
          {ms >= T.send1 && <div className="cc-user">&gt; {d.ask}</div>}
          {d.read.slice(0, reads).map((l) => (
            <Line key={l.text} line={l} />
          ))}
          {props > 0 && (
            <div className="cc-block">
              {d.proposal.slice(0, props).map((l) => (
                <Line key={l.text} line={l} />
              ))}
            </div>
          )}
          {ms >= T.send2 && <div className="cc-user">&gt; {d.reply}</div>}
          {d.write.slice(0, writes).map((l) => (
            <Line key={l.text} line={l} />
          ))}
          {ms >= T.done && (
            <div className="cc-block">
              <Line line={{ kind: 'text', text: d.done }} />
              <div className="cc-cmd">{d.shell}</div>
            </div>
          )}
          </div>
        </div>
        <div className="cc-status">{working && <span className="cc-spin">{working} Thinking… (esc to interrupt)</span>}</div>
        <div className="cc-prompt">
          <span>&gt;</span>
          <span className="cc-input">
            {prompt}
            <i className="cc-caret" />
          </span>
        </div>
        <div className="cc-hint">? for shortcuts</div>
      </Terminal>

      <div className={`dm-window dm-editor ${editorOnTop ? 'is-front' : ''}`}>
        <div className="dm-titlebar">
          <span className="dm-lights">
            <i />
            <i />
            <i />
          </span>
          <span className="dm-title">{editorOnTop ? 'TC-11-unknown-coupon.toml' : 'use-case.toml'} — shop</span>
        </div>
        <div className="ed-body">
          <div className="ed-tree">
            <p className="ed-label">EXPLORER</p>
            <p>▾ .indx-watch/specs</p>
            <p className="i1">▾ FEAT-2-checkout</p>
            <p className="i2">▾ UC-2-guest-applies…</p>
            <p className={`i3 ${editorOnTop ? '' : 'on'}`}>use-case.toml</p>
            <p className="i3">TC-3-valid-coupon.toml</p>
            <p className="i3">TC-4-expired-coupon.toml</p>
            {ms >= T.write && (
              <p className="i3 on ed-new">
                TC-11-unknown-coupon.toml <b>A</b>
              </p>
            )}
            <p>▾ tests</p>
            <p className={`i1 ${ms >= T.write + 840 ? 'ed-mod' : ''}`}>
              coupon.spec.ts {ms >= T.write + 840 && <b>M</b>}
            </p>
          </div>
          <div className="ed-main">
            <div className="ed-tabs">
              <span className={editorOnTop ? '' : 'on'}>use-case.toml</span>
              {editorOnTop && <span className="on">TC-11-unknown-coupon.toml</span>}
            </div>
            <div className="ed-path">{editorOnTop ? TC11_PATH : 'specs/FEAT-2-checkout/UC-2-guest-applies-coupon/use-case.toml'}</div>
            <pre className="ed-code">
              {(editorOnTop ? TC11_LINES.slice(0, tcLines) : USE_CASE).map((line, i) => (
                <div key={`${i}:${line}`} className="ed-line">
                  <span className="ed-ln">{i + 1}</span>
                  <code>{highlight(line)}</code>
                </div>
              ))}
            </pre>
            <div className={`ed-term ${ms >= T.shell - 300 ? 'is-open' : ''}`}>
              <p className="ed-label">TERMINAL — zsh</p>
              <p>
                <span className="ed-ps">alex@mac shop %</span> {shell}
                {ms < T.approved && ms >= T.shell - 300 && <i className="cc-caret" />}
              </p>
              {ms >= T.approved && <p className="ed-ok">Approved AC-2.3 at ucv:5e81c0d4a937 as alex@shop.test</p>}
              {ms >= T.approved + 250 && <p className="ed-ok">{d.approved}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
