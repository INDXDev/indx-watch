/**
 * Features (Supabase's product grid): four cards, each an icon and tag, a title, a description with its key
 * phrase in ink, a checklist and a small, real-looking view of that part of the product.
 */
import type { Content } from '@/content/types';
import { Rich } from '../rich';
import { Icon, SectionHead } from '../ui';

const ICONS = ['define', 'run', 'decide', 'delegate'];

function TreeVisual({ t }: { t: Content }) {
  return (
    <div className="mini-tree" aria-hidden="true">
      {t.features.visuals.tree.map((row) => (
        <div key={row.path} className={`row ${row.status === 'draft' ? 'row-new' : ''}`}>
          <span>{row.path}</span>
          {row.note && <span className="note"># {row.note}</span>}
          {row.status && <span className={`tag ${row.status === 'draft' ? 'tag-draft' : ''}`}>{row.status}</span>}
        </div>
      ))}
    </div>
  );
}

function RunsVisual({ t }: { t: Content }) {
  return (
    <ul className="mini-feed" aria-hidden="true">
      {t.features.visuals.runs.map((r) => (
        <li key={r.key}>
          <span className={`av ${r.initials === 'CI' ? 'av-ci' : r.initials === 'AI' ? 'av-ai' : ''}`}>{r.initials}</span>
          <div>
            <p>
              <span className="who">{r.who}</span> <span className={`mini-state ${r.tone}`}>{r.did}</span>{' '}
              <span className="key">{r.key}</span> {r.title}
            </p>
            <p className="meta">
              <span className="mini-mode">{r.kind}</span>
              {r.meta}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function GateVisual({ t }: { t: Content }) {
  const v = t.features.visuals;
  return (
    <div className="mini-gate" aria-hidden="true">
      <p className="verdict">✕ {v.gateVerdict}</p>
      <table>
        <tbody>
          {v.gate.map((g) => (
            <tr key={g.label} className={g.pass ? '' : 'bad'}>
              <td>{g.label}</td>
              <td className="num">{g.now}</td>
              <td className="num">{g.needed}</td>
              <td className="res">
                <span className={`pill ${g.pass ? 'pill-pass' : 'pill-fail'}`}>{g.pass ? '✓' : '✕'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChatVisual({ t }: { t: Content }) {
  const c = t.features.visuals.chat;
  return (
    <div className="mini-chat" aria-hidden="true">
      <p className="you">&gt; /iw-triage {c.you}</p>
      <div className="agent">
        <p>
          <Rich text={c.agent} />
        </p>
      </div>
    </div>
  );
}

const VISUALS = [TreeVisual, RunsVisual, GateVisual, ChatVisual];

export function Features({ t }: { t: Content }) {
  const f = t.features;
  return (
    <section className="section" aria-labelledby="features">
      <div className="wrap">
        <SectionHead id="features" kicker={f.kicker} title={f.title} lead={f.lead} layout="split" />
        <ul className="features">
          {f.items.map((item, i) => {
            const Visual = VISUALS[i];
            return (
              <li key={item.title} className="card feature">
                <p className="feature-tag">
                  <Icon name={ICONS[i]} />
                  {item.tag}
                </p>
                <h3>{item.title}</h3>
                <p className="muted-strong">
                  <Rich text={item.body} />
                </p>
                <ul className="checks">
                  {item.points.map((p) => (
                    <li key={p}>
                      <span>
                        <Rich text={p} />
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="feature-visual">
                  <Visual t={t} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
