/**
 * The remaining sections, each after one reference (site/DESIGN.md#references): the tool strip and the
 * two-tone statement (Linear), the agents band (Clerk, Linear), the strengths bento (Clerk, Stripe), open
 * source (Supabase), the comparison, get started (Sentry), FAQ and the closing call to action (Linear).
 */
import type { Content } from '@/content/types';
import { DEMO_URL, DOCS, GITHUB_URL, INIT_COMMAND } from '@/lib/site';
import { CopyCommand } from '../copy-command';
import { Rich } from '../rich';
import { GitHubIcon, Icon, SectionHead, TextLink } from '../ui';

export function WorksWith({ t }: { t: Content }) {
  return (
    <section className="works" aria-label={t.worksWith.label}>
      <div className="wrap">
        <p className="caption">{t.worksWith.label}</p>
        <ul>
          {t.worksWith.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Why({ t }: { t: Content }) {
  const w = t.why;
  return (
    <section className="section" aria-labelledby="why">
      <div className="wrap">
        <p className="kicker">{w.kicker}</p>
        <h2 id="why" className="statement">
          <strong>{w.strong}</strong> {w.rest}
        </h2>
        <div className="rows">
          <div className="rows-head" aria-hidden="true">
            <span className="caption">{w.before}</span>
            <span className="caption">{w.after}</span>
          </div>
          <ul>
            {w.rows.map((row) => (
              <li key={row.after}>
                <span className="before">
                  <span className="visually-hidden">{w.before}: </span>
                  {row.before}
                </span>
                <span className="after">
                  <span className="visually-hidden">{w.after}: </span>
                  {row.after}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function Agents({ t }: { t: Content }) {
  const a = t.agents;
  return (
    <section className="section band-dark" aria-labelledby="agents">
      <div className="wrap">
        <SectionHead id="agents" kicker={a.kicker} title={a.title} lead={a.lead} />
        <div className="terminals">
          {a.conversations.map((c) => (
            <figure key={c.title} className="terminal">
              <figcaption className="terminal-bar">
                <span className="code-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                {c.title}
              </figcaption>
              <div className="terminal-body">
                {c.lines.map((line, i) => (
                  <div key={`${i}:${line.text}`} className={`tl tl-${line.who}`}>
                    <span className="tl-who">
                      {line.who === 'you' ? '>' : '⏺'}
                      <span className="visually-hidden">{line.who === 'you' ? a.you : a.agent}</span>
                    </span>
                    <p>
                      <Rich text={line.text} />
                    </p>
                  </div>
                ))}
              </div>
            </figure>
          ))}
        </div>
        <h3 className="sub-title">{a.skillsTitle}</h3>
        <ul className="skills" style={{ marginTop: 20 }}>
          {a.skills.map((s) => (
            <li key={s.skill}>
              <p className="skill">
                /{s.skill} <span className="codex">· ${s.skill}</span>
              </p>
              <h4>{s.job}</h4>
              <p>“{s.say}”</p>
            </li>
          ))}
        </ul>
        <div className="rules">
          <div className="rule-col">
            <h4>{a.agentDoes}</h4>
            <ul>
              {a.agentItems.map((item) => (
                <li key={item}>
                  <span>
                    <Rich text={item} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rule-col rule-person">
            <h4>{a.personDoes}</h4>
            <ul>
              {a.personItems.map((item) => (
                <li key={item}>
                  <span>
                    <Rich text={item} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <TextLink href={a.guide.href}>{a.guide.label}</TextLink>
      </div>
    </section>
  );
}

export function Strengths({ t }: { t: Content }) {
  const s = t.strengths;
  return (
    <section className="section section-subtle" aria-labelledby="platform">
      <div className="wrap">
        <SectionHead id="platform" kicker={s.kicker} title={s.title} lead={s.lead} layout="split" />
        <ul className="bento">
          <li className="card bento-large">
            <h3>
              <GitHubIcon />
              {s.github.title}
            </h3>
            <p>
              <Rich text={s.github.body} />
            </p>
            <div className="pr-mock" aria-hidden="true">
              <div className="pr-comment">
                <p className="pr-comment-head">
                  <span className="pr-bot">IW</span>
                  <b>github-actions</b> · INDX Watch · v1.2.0
                </p>
                <div className="pr-comment-body">
                  <p className="pr-verdict">{t.demo.ship.reportVerdict}</p>
                  <p className="pr-suggest">
                    {t.demo.ci.suggested} <code>TC-11</code> <code>TC-3</code> <code>TC-4</code>
                  </p>
                </div>
              </div>
              <ul className="pr-checks">
                {s.github.checks.map((c) => (
                  <li key={c.name}>
                    <span className="ok">✓</span>
                    <b>{c.name}</b>
                    <span className="detail">{c.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
            <TextLink href={s.github.link.href}>{s.github.link.label}</TextLink>
          </li>
          {s.items.map((item) => (
            <li key={item.title} className="card">
              <h3>
                <Icon name={item.icon} />
                {item.title}
              </h3>
              <p>
                <Rich text={item.body} />
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function OpenSource({ t }: { t: Content }) {
  const o = t.openSource;
  return (
    <section className="section" aria-labelledby="open-source">
      <div className="wrap oss">
        <div>
          <p className="kicker">{o.kicker}</p>
          <h2 id="open-source" className="h2">
            {o.title}
          </h2>
          <p className="lead">
            <Rich text={o.body} />
          </p>
          <div className="oss-actions">
            <a className="btn" href={GITHUB_URL}>
              <GitHubIcon />
              {o.github}
            </a>
            <span className="oss-license">Apache-2.0 · npm: indx-watch</span>
          </div>
        </div>
        <ul className="hosts">
          {o.hosts.map((h) => (
            <li key={h.title} className="card host">
              <h3>{h.title}</h3>
              <p>{h.body}</p>
              <pre>
                <code>{h.code}</code>
              </pre>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Mark({ value, yes, no }: { value: string; yes: string; no: string }) {
  if (value === '✓')
    return (
      <span className="mark-yes">
        <span aria-hidden="true">✓</span>
        <span className="visually-hidden">{yes}</span>
      </span>
    );
  if (value === '✗')
    return (
      <span className="mark-no">
        <span aria-hidden="true">✕</span>
        <span className="visually-hidden">{no}</span>
      </span>
    );
  return <>{value}</>;
}

export function Compare({ t }: { t: Content }) {
  const c = t.compare;
  const last = c.columns.length - 1;
  return (
    <section className="section section-subtle" aria-labelledby="compare">
      <div className="wrap">
        <SectionHead id="compare" kicker={c.kicker} title={c.title} lead={c.lead} />
        <div className="table-scroll" role="region" aria-label={c.title} tabIndex={0}>
          <table className="compare">
            <thead>
              <tr>
                {c.columns.map((col, i) => (
                  <th key={col || 'label'} scope="col" className={i === last ? 'us' : ''}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {row.cells.map((cell, i) => (
                    <td key={`${i}:${cell}`} className={i === last - 1 ? 'us' : ''}>
                      <Mark value={cell} yes={c.yes} no={c.no} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="table-note">
          <a href={DOCS.landscape}>{c.note}</a>
        </p>
      </div>
    </section>
  );
}

export function Start({ t }: { t: Content }) {
  const s = t.start;
  return (
    <section className="section" aria-labelledby="start">
      <div className="wrap">
        <SectionHead id="start" kicker={s.kicker} title={s.title} lead={s.lead} layout="split" />
        <ol className="steps">
          {s.steps.map((step, i) => (
            <li key={step.title} className="card step">
              <span className="step-num">0{i + 1}</span>
              <h3>{step.title}</h3>
              <p>
                <Rich text={step.body} />
              </p>
              <pre>
                <code>{step.code}</code>
              </pre>
            </li>
          ))}
        </ol>
        <div className="sample">
          <span>{s.sample}</span>
          <CopyCommand command={s.sampleCode} copy={t.hero.copy} copied={t.hero.copied} />
        </div>
      </div>
    </section>
  );
}

export function Faq({ t }: { t: Content }) {
  return (
    <section className="section" aria-labelledby="faq">
      <div className="wrap faq-grid">
        <SectionHead id="faq" kicker={t.faq.kicker} title={t.faq.title} />
        <div className="faq">
          {t.faq.items.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>
                <Rich text={item.a} />
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Closing({ t }: { t: Content }) {
  return (
    <section className="closing" aria-labelledby="closing">
      <div className="wrap">
        <h2 id="closing">{t.cta.title}</h2>
        <p className="lead">{t.cta.lead}</p>
        <div className="hero-actions">
          <CopyCommand command={INIT_COMMAND} copy={t.hero.copy} copied={t.hero.copied} />
          <a className="btn btn-primary" href={DEMO_URL}>
            {t.cta.demo}
          </a>
          <a className="btn" href={GITHUB_URL}>
            <GitHubIcon />
            {t.cta.github}
          </a>
        </div>
      </div>
    </section>
  );
}
