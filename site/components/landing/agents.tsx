/** Who does what (roles) and how agents work with INDX Watch (conversations, skills, rules). */
import type { Content } from '@/content/types';
import { DOCS } from '@/lib/site';
import { Rich } from '../rich';
import { SectionHead } from './parts';

/** What each role says, what happens and what they approve. */
export function Roles({ t }: { t: Content }) {
  return (
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
  );
}

/** Sample agent conversations as terminals. */
export function Terminals({ t }: { t: Content }) {
  return (
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
  );
}

/** The skills table: job, Claude Code and Codex names, what to say. */
export function SkillsTable({ t }: { t: Content }) {
  return (
    <>
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
    </>
  );
}

/** What the agent does and what only a person does. */
export function AgentRules({ t }: { t: Content }) {
  return (
    <>
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
    </>
  );
}

/** The agents section. */
export function Agents({ t }: { t: Content }) {
  return (
    <section className="section section-dark" aria-labelledby="agents">
      <div className="wrap">
        <SectionHead id="agents" kicker={t.agents.kicker} title={t.agents.title} lead={t.agents.lead} />
        <Terminals t={t} />

        <SkillsTable t={t} />

        <AgentRules t={t} />
        <p className="section-link">
          <a href={DOCS.agents}>
            {t.agents.guide}
            <span aria-hidden="true"> →</span>
          </a>
        </p>
      </div>
    </section>
  );
}
