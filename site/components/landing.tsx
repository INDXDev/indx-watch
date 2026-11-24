import { PW_PATH, PW_TC3, STATUS_CMD, STATUS_JSON, TOML_PATH, TOML_TC3 } from '@/content/code';
import type { Content } from '@/content/types';
import { DEMO_URL, DOCS, GITHUB_URL, INIT_COMMAND, NPM_URL } from '@/lib/site';
import { CodePanel } from './code';
import { CopyCommand } from './copy-command';
import { Rich } from './rich';
import { hasImage, imageSize, Screenshot } from './screenshot';

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 16 16" aria-hidden="true">
      <rect width="16" height="16" rx="3.5" />
      <path d="M4 8.5l2.5 2.5L12 5" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
    </svg>
  );
}

function Mark({ value, yes, no }: { value: string; yes: string; no: string }) {
  if (value === '✓')
    return (
      <span className="mark mark-yes">
        <span aria-hidden="true">✓</span>
        <span className="visually-hidden">{yes}</span>
      </span>
    );
  if (value === '✗')
    return (
      <span className="mark mark-no">
        <span aria-hidden="true">✗</span>
        <span className="visually-hidden">{no}</span>
      </span>
    );
  return <>{value}</>;
}

function SectionHead({ id, kicker, title, lead }: { id: string; kicker: string; title: string; lead?: string }) {
  return (
    <header className="section-head">
      <p className="kicker">{kicker}</p>
      <h2 id={id}>{title}</h2>
      {lead && (
        <p className="lead">
          <Rich text={lead} />
        </p>
      )}
    </header>
  );
}

export function Landing({ t }: { t: Content }) {
  const other = t.locale === 'en' ? '/ja/' : '/';
  const otherLang = t.locale === 'en' ? 'ja' : 'en';
  const gallery = t.gallery.items.filter((item) => hasImage(item.image));
  return (
    <>
      <a className="skip" href="#main">
        {t.nav.skip}
      </a>
      <header className="site-header">
        <div className="wrap header-row">
          <a className="brand" href={t.path} aria-label="INDX Watch">
            <Logo />
            <span>INDX Watch</span>
          </a>
          <nav aria-label={t.nav.menu} className="nav">
            <a href="#how">{t.nav.how}</a>
            <a href="#roles">{t.nav.roles}</a>
            <a href="#agents">{t.nav.agents}</a>
            <a href="#compare">{t.nav.compare}</a>
            <a href="#faq">{t.nav.faq}</a>
          </nav>
          <div className="header-actions">
            <a className="lang" href={other} hrefLang={otherLang} lang={otherLang} aria-label={t.nav.otherLanguageLabel}>
              <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="6.5" />
                <path d="M1.5 8h13M8 1.5c1.8 1.9 2.7 4 2.7 6.5S9.8 12.6 8 14.5M8 1.5C6.2 3.4 5.3 5.5 5.3 8s.9 4.6 2.7 6.5" />
              </svg>
              {t.nav.otherLanguage}
            </a>
            <a className="header-gh" href={GITHUB_URL} aria-label="GitHub">
              <GitHubIcon />
              <span>{t.nav.github}</span>
            </a>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="wrap hero-grid">
            <div className="hero-copy">
              <p className="eyebrow">{t.hero.eyebrow}</p>
              <h1 id="hero-title">{t.hero.title}</h1>
              <p className="hero-lead">{t.hero.lead}</p>
              <CopyCommand command={INIT_COMMAND} copy={t.hero.copy} copied={t.hero.copied} />
              <p className="hero-note">
                <Rich text={t.hero.note} />
              </p>
              <div className="hero-actions">
                <a className="btn btn-primary" href={DEMO_URL}>
                  {t.hero.demo}
                  <span aria-hidden="true"> →</span>
                </a>
                <a className="btn" href={GITHUB_URL}>
                  <GitHubIcon />
                  {t.hero.github}
                </a>
                <a className="btn btn-quiet" href={t.locale === 'ja' ? DOCS.quickstart : DOCS.home}>
                  {t.hero.docs}
                </a>
              </div>
            </div>
            <div className="hero-visual">
              <Screenshot name="home.png" alt={t.hero.imageAlt} priority className="hero-shot" />
              <div className="chat-card" role="group" aria-label="/iw-status">
                <p className="chat-you">
                  <span className="chat-who">/iw-status</span> {t.hero.chat.you}
                </p>
                <p className="chat-agent">
                  <Rich text={t.hero.chat.agent} />
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="section" aria-labelledby="problem">
          <div className="wrap">
            <SectionHead id="problem" kicker={t.problem.kicker} title={t.problem.title} lead={t.problem.lead} />
            <ul className="cards cards-4">
              {t.problem.items.map((item, i) => (
                <li key={item.title} className="card problem-card">
                  <span className="card-num" aria-hidden="true">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </li>
              ))}
            </ul>
            <p className="closing">{t.problem.closing}</p>
          </div>
        </section>

        <section className="section section-alt" aria-labelledby="how">
          <div className="wrap">
            <SectionHead id="how" kicker={t.how.kicker} title={t.how.title} lead={t.how.lead} />
            <ol className="steps">
              {t.how.steps.map((step, i) => (
                <li key={step.title} className="step">
                  <span className="step-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3>{step.title}</h3>
                  <p>
                    <Rich text={step.body} />
                  </p>
                  <pre className="step-code">
                    <code>{step.code}</code>
                  </pre>
                </li>
              ))}
            </ol>
            <div className="split">
              <div className="split-col">
                <h3>
                  <span className="split-tag">git</span>
                  {t.how.split.git}
                </h3>
                <ul>
                  {t.how.split.gitItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="split-arrow" aria-hidden="true">
                +
              </div>
              <div className="split-col">
                <h3>
                  <span className="split-tag split-tag-store">store</span>
                  {t.how.split.drive}
                </h3>
                <ul>
                  {t.how.split.driveItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="split-arrow" aria-hidden="true">
                =
              </div>
              <div className="split-col split-result">
                <h3>
                  <span className="split-tag split-tag-gate">gate</span>
                  {t.how.split.gate}
                </h3>
                <ul className="gate-list">
                  {t.how.split.gateItems.map((item) => (
                    <li key={item.text}>
                      <span className={`pill ${item.passed ? 'pill-pass' : 'pill-fail'}`}>
                        <span aria-hidden="true">{item.passed ? '✓' : '✗'}</span>
                        <span className="visually-hidden">{item.passed ? t.compare.yes : t.compare.no}</span>
                      </span>
                      {item.text}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="section" aria-labelledby="roles">
          <div className="wrap">
            <SectionHead id="roles" kicker={t.roles.kicker} title={t.roles.title} lead={t.roles.lead} />
            <div className="roles">
              {t.roles.items.map((role) => (
                <article key={role.role} className="card role">
                  <h3>{role.role}</h3>
                  <p className="role-who">
                    <Rich text={role.who} />
                  </p>
                  <dl>
                    <dt>{t.roles.sayLabel}</dt>
                    <dd className="role-say">
                      {role.say.map((s) => (
                        <q key={s}>{s}</q>
                      ))}
                    </dd>
                    <dt>{t.roles.happensLabel}</dt>
                    <dd>
                      <Rich text={role.happens} />
                    </dd>
                    <dt>{t.roles.approveLabel}</dt>
                    <dd>
                      <Rich text={role.approve} />
                    </dd>
                  </dl>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section section-dark" aria-labelledby="agents">
          <div className="wrap">
            <SectionHead id="agents" kicker={t.agents.kicker} title={t.agents.title} lead={t.agents.lead} />
            <div className="terminals">
              {t.agents.conversations.map((c) => (
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
                          {line.who === 'you' ? '>' : '●'}
                          <span className="visually-hidden">{line.who === 'you' ? t.agents.you : t.agents.agent}</span>
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

            <h3 className="sub-title">{t.agents.skillsTitle}</h3>
            <div className="table-scroll" role="region" aria-label={t.agents.skillsTitle} tabIndex={0}>
              <table className="skills">
                <thead>
                  <tr>
                    <th scope="col">{t.agents.skillHead.job}</th>
                    <th scope="col">{t.agents.skillHead.claude}</th>
                    <th scope="col">{t.agents.skillHead.codex}</th>
                    <th scope="col">{t.agents.skillHead.say}</th>
                  </tr>
                </thead>
                <tbody>
                  {t.agents.skills.map((s) => (
                    <tr key={s.skill}>
                      <th scope="row">{s.job}</th>
                      <td>
                        <code>/{s.skill}</code>
                      </td>
                      <td>
                        <code>${s.skill}</code>
                      </td>
                      <td>{s.say}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="sub-title">{t.agents.rulesTitle}</h3>
            <div className="rules">
              <div className="rule-col">
                <h4>{t.agents.agentDoes}</h4>
                <ul>
                  {t.agents.agentItems.map((item) => (
                    <li key={item}>
                      <Rich text={item} />
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rule-col rule-person">
                <h4>{t.agents.personDoes}</h4>
                <ul>
                  {t.agents.personItems.map((item) => (
                    <li key={item}>
                      <Rich text={item} />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="section-link">
              <a href={DOCS.agents}>
                {t.agents.guide}
                <span aria-hidden="true"> →</span>
              </a>
            </p>
          </div>
        </section>

        <section className="section" aria-labelledby="dx">
          <div className="wrap">
            <SectionHead id="dx" kicker={t.dx.kicker} title={t.dx.title} lead={t.dx.lead} />
            <div className="dx-grid">
              <CodePanel
                className="dx-toml"
                file={TOML_PATH}
                code={TOML_TC3}
                caption={<Rich text={t.dx.tomlCaption} />}
              />
              <div className="dx-side">
                <CodePanel file={PW_PATH} code={PW_TC3} caption={<Rich text={t.dx.pwCaption} />} />
                <CodePanel file={`$ ${STATUS_CMD}`} code={STATUS_JSON} caption={<Rich text={t.dx.jsonCaption} />} />
              </div>
            </div>
            <ul className="cards cards-4 points">
              {t.dx.points.map((p) => (
                <li key={p.title} className="card">
                  <h3>
                    <Rich text={p.title} />
                  </h3>
                  <p>
                    <Rich text={p.body} />
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {gallery.length > 0 && (
          <section className="section section-alt" aria-labelledby="web-app">
            <div className="wrap">
              <SectionHead id="web-app" kicker={t.gallery.kicker} title={t.gallery.title} lead={t.gallery.lead} />
              <ul className="gallery">
                {gallery.map((item) => (
                  <li key={item.image}>
                    <figure>
                      {(imageSize(item.image)?.width ?? 0) < 600 ? (
                        <div className="phone-tile">
                          <Screenshot name={item.image} alt={item.alt} />
                        </div>
                      ) : (
                        <Screenshot name={item.image} alt={item.alt} />
                      )}
                      <figcaption>{item.caption}</figcaption>
                    </figure>
                  </li>
                ))}
              </ul>
              <p className="section-link">
                <a href={DEMO_URL}>
                  {t.hero.demo}
                  <span aria-hidden="true"> →</span>
                </a>
              </p>
            </div>
          </section>
        )}

        <section className="section" aria-labelledby="compare">
          <div className="wrap">
            <SectionHead id="compare" kicker={t.compare.kicker} title={t.compare.title} lead={t.compare.lead} />
            <div className="table-scroll" role="region" aria-label={t.compare.title} tabIndex={0}>
              <table className="compare">
                <thead>
                  <tr>
                    {t.compare.columns.map((c, i) => (
                      <th key={c || 'label'} scope="col" className={i === t.compare.columns.length - 1 ? 'us' : ''}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.compare.rows.map((row) => (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      {row.cells.map((cell, i) => (
                        <td key={`${i}:${cell}`} className={i === row.cells.length - 1 ? 'us' : ''}>
                          <Mark value={cell} yes={t.compare.yes} no={t.compare.no} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="table-note">
              <a href={DOCS.landscape}>{t.compare.note}</a>
            </p>
          </div>
        </section>

        <section className="section section-alt" aria-labelledby="self-host">
          <div className="wrap">
            <SectionHead id="self-host" kicker={t.selfHost.kicker} title={t.selfHost.title} lead={t.selfHost.lead} />
            <ul className="cards cards-3">
              {t.selfHost.items.map((item) => (
                <li key={item.title} className="card host">
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                  <pre className="step-code">
                    <code>{item.code}</code>
                  </pre>
                </li>
              ))}
            </ul>
            <ul className="lockin">
              {t.selfHost.lockIn.map((item) => (
                <li key={item.title}>
                  <h3>{item.title}</h3>
                  <p>
                    <Rich text={item.body} />
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="section" aria-labelledby="faq">
          <div className="wrap faq-wrap">
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

        <section className="cta" aria-labelledby="cta-title">
          <div className="wrap cta-inner">
            <h2 id="cta-title">{t.cta.title}</h2>
            <p>{t.cta.lead}</p>
            <CopyCommand command={INIT_COMMAND} copy={t.hero.copy} copied={t.hero.copied} />
            <div className="hero-actions">
              <a className="btn btn-primary" href={DEMO_URL}>
                {t.hero.demo}
                <span aria-hidden="true"> →</span>
              </a>
              <a className="btn" href={GITHUB_URL}>
                <GitHubIcon />
                {t.hero.github}
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="wrap footer-row">
          <div>
            <a className="brand" href={t.path}>
              <Logo />
              <span>INDX Watch</span>
            </a>
            <p>{t.footer.tagline}</p>
          </div>
          <ul className="footer-links">
            <li>
              <a href={GITHUB_URL}>{t.footer.github}</a>
            </li>
            <li>
              <a href={DOCS.home}>{t.footer.docs}</a>
            </li>
            <li>
              <a href={DEMO_URL}>{t.footer.demo}</a>
            </li>
            <li>
              <a href={NPM_URL}>{t.footer.npm}</a>
            </li>
            <li>
              <a href={DOCS.license}>{t.footer.license}</a>
            </li>
            <li>
              <a href={other} hrefLang={otherLang} lang={otherLang}>
                {t.nav.otherLanguage}
              </a>
            </li>
          </ul>
        </div>
      </footer>
    </>
  );
}
