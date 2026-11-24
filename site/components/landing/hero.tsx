/** The opening of the landing page (hero, problem) and its closing call to action. */
import type { Content } from '@/content/types';
import { DEMO_URL, DOCS, GITHUB_URL, INIT_COMMAND } from '@/lib/site';
import { CopyCommand } from '../copy-command';
import { Rich } from '../rich';
import { Screenshot } from '../screenshot';
import { GitHubIcon, SectionHead } from './parts';

/** Install command, demo and docs links, and a screenshot with an agent chat. */
export function Hero({ t }: { t: Content }) {
  return (
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
  );
}

/** The problems INDX Watch solves. */
export function Problem({ t }: { t: Content }) {
  return (
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
  );
}

/** Closing call to action: the install command again. */
export function Cta({ t }: { t: Content }) {
  return (
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
  );
}
