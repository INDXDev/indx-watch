/**
 * The team guide (/team/, /ja/team/): what QA, engineers and product managers do after setup, situation by
 * situation. Same manners as the setup guide (site/DESIGN.md#the-team-guide): a role picker, the release
 * cycle played like the demo, numbered steps with a "You should see" line, then who does what.
 */
import type { Content, TeamContent } from '@/content/types';
import { DEMO_URL, INIT_COMMAND } from '@/lib/site';
import { CopyCommand } from './copy-command';
import { SiteFooter, SiteHeader } from './landing/chrome';
import { Rich } from './rich';
import { Step } from './setup';
import { ArchFlow } from './setup-flow';
import { SectionHead, TextLink } from './ui';

function Mark({ value, yes }: { value: string; yes: string }) {
  if (value === '✓')
    return (
      <span className="mark-yes">
        <span aria-hidden="true">✓</span>
        <span className="visually-hidden">{yes}</span>
      </span>
    );
  if (value === '✗') return <span className="mark-no">✕</span>;
  return <span className={value === '–' ? 'tm-dash' : 'tm-text'}>{value}</span>;
}

export function Team({ t, g }: { t: Content; g: TeamContent }) {
  return (
    <>
      <SiteHeader t={t} page="team" />
      <main id="main" className="su">
        <section className="hero su-hero" aria-labelledby="team-title">
          <div className="wrap">
            <p className="kicker">{g.hero.kicker}</p>
            <h1 id="team-title">{g.hero.title}</h1>
            <p className="lead hero-lead">
              <Rich text={g.hero.lead} />
            </p>
            <TextLink href={g.hero.setup.href}>{g.hero.setup.label}</TextLink>
            <div className="su-paths tm-pick">
              <h2 className="caption">{g.pick.title}</h2>
              <ol>
                {g.pick.roles.map((r) => {
                  const steps = g.roles.find((x) => x.id === r.id)?.steps ?? [];
                  return (
                    <li key={r.id} className="card">
                      <h3>
                        <a href={`#${r.id}`}>{r.title}</a>
                      </h3>
                      <p>{r.who}</p>
                      <ol className="tm-jobs">
                        {r.jobs.map((job, i) => (
                          <li key={job}>
                            <a href={`#${steps[i]?.id ?? r.id}`}>
                              <span className="su-toc-n">{i + 1}</span>
                              {job}
                            </a>
                          </li>
                        ))}
                      </ol>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </section>

        <section className="section section-subtle" aria-labelledby="cycle">
          <div className="wrap">
            <SectionHead id="cycle" kicker={g.cycle.kicker} title={g.cycle.title} lead={g.cycle.lead} layout="split" />
            <ArchFlow f={g.cycle.flow} />
          </div>
        </section>

        {g.roles.map((r) => (
          <section key={r.id} className="section su-phase" aria-labelledby={r.id}>
            <div className="wrap">
              <SectionHead id={r.id} kicker={r.kicker} title={r.title} lead={r.lead} layout="split" />
              <ol className="su-steps">
                {r.steps.map((st, i) => (
                  <Step key={st.id} step={st} n={i + 1} s={g.labels} />
                ))}
              </ol>
            </div>
          </section>
        ))}

        <section className="section section-subtle" aria-labelledby="matrix">
          <div className="wrap">
            <SectionHead id="matrix" kicker={g.matrix.kicker} title={g.matrix.title} lead={g.matrix.lead} />
            <div className="table-scroll" role="region" aria-label={g.matrix.title} tabIndex={0}>
              <table className="compare tm-matrix">
                <thead>
                  <tr>
                    {g.matrix.cols.map((c, i) => (
                      <th key={c || 'task'} scope="col" className={i === g.matrix.cols.length - 1 ? 'tm-agent' : ''}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {g.matrix.rows.map((row) => (
                    <tr key={row.task}>
                      <th scope="row">{row.task}</th>
                      {row.cells.map((c, i) => (
                        <td key={`${i}:${c}`} className={i === row.cells.length - 1 ? 'tm-agent' : ''}>
                          <Mark value={c} yes={g.matrix.yes} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="tm-people">
              <p className="kicker">{g.people.kicker}</p>
              <h3 className="tm-people-title">{g.people.title}</h3>
              <p className="lead">
                <Rich text={g.people.lead} />
              </p>
              <ul className="su-recipes tm-people-grid">
                {g.people.items.map((p) => (
                  <li key={p.title} className="card">
                    <h3>{p.title}</h3>
                    <p>{p.body}</p>
                    <pre>
                      <code>{p.code}</code>
                    </pre>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="closing" aria-labelledby="closing">
          <div className="wrap">
            <h2 id="closing">{g.closing.title}</h2>
            <p className="lead">{g.closing.lead}</p>
            <div className="hero-actions">
              <a className="btn btn-primary" href={DEMO_URL}>
                {g.closing.demo}
              </a>
              <a className="btn" href={g.hero.setup.href}>
                {g.closing.setup}
              </a>
              <CopyCommand command={INIT_COMMAND} copy={g.labels.copy} copied={g.labels.copied} />
            </div>
          </div>
        </section>
      </main>
      <SiteFooter t={t} page="team" />
    </>
  );
}

