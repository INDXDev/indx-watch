/**
 * The setup guide (/setup/, /ja/setup/): one page for engineers, top to bottom. It reuses the landing page's
 * header, footer and primitives; references and section order are in site/DESIGN.md#the-setup-guide.
 */
import { Fragment } from 'react';
import type { Content, SetupBlock, SetupContent, SetupStep, StepLabels } from '@/content/types';
import { DEMO_URL, INIT_COMMAND } from '@/lib/site';
import { CodePanel } from './code';
import { CopyButton, CopyCommand } from './copy-command';
import { SiteFooter, SiteHeader } from './landing/chrome';
import { Rich } from './rich';
import { Screenshot } from './screenshot';
import { ArchFlow } from './setup-flow';
import { SectionHead, TextLink } from './ui';

/** The commands of a terminal block, without the `$ ` prompts, the output lines and the comments. */
function commands(code: string): string {
  return code
    .split('\n')
    .reduce<string[]>((out, line) => {
      if (line.startsWith('$ ')) out.push(line.slice(2).replace(/\s+#.*$/, ''));
      else if (out.length && /\\$/.test(out[out.length - 1] ?? '')) out.push(line);
      return out;
    }, [])
    .join('\n');
}

function Terminal({ title, code, s }: { title?: string; code: string; s: StepLabels }) {
  let continued = false;
  return (
    <figure className="su-term">
      <figcaption className="terminal-bar">
        <span className="code-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="su-term-title">{title}</span>
        <CopyButton text={commands(code)} copy={s.copy} copied={s.copied} />
      </figcaption>
      <pre tabIndex={0}>
        <code>
          {code.split('\n').map((line, i) => {
            const cmd = line.startsWith('$ ') || continued;
            continued = cmd && line.endsWith('\\');
            const key = `${i}:${line}`;
            if (!cmd)
              return (
                <span key={key} className={line.startsWith('#') ? 'su-comment' : 'su-out'}>
                  {line}
                  {'\n'}
                </span>
              );
            const body = line.startsWith('$ ') ? line.slice(2) : line;
            const at = body.search(/\s+#\s/);
            return (
              <span key={key} className="su-cmd">
                {line.startsWith('$ ') && (
                  <span className="su-prompt" aria-hidden="true">
                    ${' '}
                  </span>
                )}
                {at < 0 ? body : body.slice(0, at)}
                {at >= 0 && <span className="su-comment">{body.slice(at)}</span>}
                {'\n'}
              </span>
            );
          })}
        </code>
      </pre>
    </figure>
  );
}

function Block({ b, s }: { b: SetupBlock; s: StepLabels }) {
  switch (b.kind) {
    case 'terminal':
      return <Terminal title={b.title} code={b.code} s={s} />;
    case 'file':
      return <CodePanel file={b.file} code={b.code} className="su-file" />;
    case 'shot':
      return <Screenshot name={b.image} alt={b.alt} />;
    case 'chat':
      return (
        <figure className="terminal su-chat">
          <figcaption className="terminal-bar">
            <span className="code-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            Claude Code · Codex
          </figcaption>
          <div className="terminal-body">
            {b.lines.map((line, i) => (
              <div key={`${i}:${line.text}`} className={`tl tl-${line.who}`}>
                <span className="tl-who">
                  {line.who === 'you' ? '>' : '⏺'}
                  <span className="visually-hidden">{line.who === 'you' ? s.you : s.agent}</span>
                </span>
                <p>
                  <Rich text={line.text} />
                </p>
              </div>
            ))}
          </div>
        </figure>
      );
    case 'pr':
      return (
        <div className="su-pr">
          <p className="su-pr-head">
            <span className="pr-bot" aria-hidden="true">
              IW
            </span>
            {b.title}
          </p>
          <ul>
            {b.lines.map((l) => (
              <li key={l.text} className={`su-pr-${l.tone}`}>
                <span aria-hidden="true">{l.tone === 'pass' ? '✓' : l.tone === 'fail' ? '✕' : '•'}</span>
                {l.text}
              </li>
            ))}
          </ul>
        </div>
      );
  }
}

/** One numbered step: text on the left, its terminal, file, chat or screen on the right. */
export function Step({ step, n, s }: { step: SetupStep; n: number; s: StepLabels }) {
  return (
    <li className="su-step" id={step.id} aria-labelledby={`${step.id}-title`}>
      <div className="su-step-text">
        <p className="su-step-n">
          <span className="su-badge">{n}</span>
          <span className="caption">{step.who}</span>
        </p>
        <h3 id={`${step.id}-title`}>
          <span className="visually-hidden">
            {s.step} {n}:{' '}
          </span>
          {step.title}
        </h3>
        <p className="su-body">
          <Rich text={step.body} />
        </p>
        {step.items && (
          <ul className="checks su-items">
            {step.items.map((item) => (
              <li key={item}>
                <span>
                  <Rich text={item} />
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="su-done">
          <span className="su-done-label">
            <span aria-hidden="true">✓ </span>
            {s.doneLabel}
          </span>
          <Rich text={step.done} />
        </p>
        {step.note && (
          <p className="su-note">
            <Rich text={step.note} />
          </p>
        )}
        {step.link && <TextLink href={step.link.href}>{step.link.label}</TextLink>}
      </div>
      <div className="su-step-visual">
        {step.blocks.map((b, i) => (
          <Block key={`${b.kind}:${i}`} b={b} s={s} />
        ))}
      </div>
    </li>
  );
}

export function Setup({ t, s }: { t: Content; s: SetupContent }) {
  const all = s.phases.flatMap((p) => p.steps);
  const number = (id: string) => all.findIndex((x) => x.id === id) + 1;
  return (
    <>
      <SiteHeader t={t} page="setup" />
      <main id="main" className="su">
        <section className="hero su-hero" aria-labelledby="setup-title">
          <div className="wrap su-hero-grid">
            <div>
              <p className="kicker">{s.hero.kicker}</p>
              <h1 id="setup-title">{s.hero.title}</h1>
              <p className="lead hero-lead">
                <Rich text={s.hero.lead} />
              </p>
              <div className="hero-actions">
                <a className="btn btn-primary" href={s.hero.primary.href}>
                  {s.hero.primary.label}
                </a>
                <a className="btn" href={s.hero.secondary.href}>
                  {s.hero.secondary.label}
                </a>
              </div>
              <div className="card su-needs">
                <h2 className="caption">{s.needs.title}</h2>
                <ul className="checks">
                  {s.needs.items.map((item) => (
                    <li key={item}>
                      <span>
                        <Rich text={item} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <nav className="card su-toc" aria-label={s.toc}>
              <p className="caption">{s.toc}</p>
              {s.phases.map((p) => (
                <Fragment key={p.id}>
                  <p className="su-toc-phase">
                    <a href={`#${p.id}`}>
                      {p.kicker} · {p.title}
                    </a>
                  </p>
                  <ol>
                    {p.steps.map((st) => (
                      <li key={st.id}>
                        <a href={`#${st.id}`}>
                          <span className="su-toc-n">{number(st.id)}</span>
                          {st.title}
                        </a>
                      </li>
                    ))}
                  </ol>
                </Fragment>
              ))}
            </nav>
          </div>
          <div className="wrap">
            <div className="su-paths">
              <h2 className="caption">{s.paths.title}</h2>
              <ol>
                {s.paths.items.map((p, i) => (
                  <li key={p.title} className="card">
                    <span className="su-path-steps">{p.steps}</span>
                    <h3>
                      {i + 1}. {p.title}
                    </h3>
                    <p>{p.body}</p>
                  </li>
                ))}
              </ol>
              <p className="su-paths-lead">{s.paths.lead}</p>
            </div>
          </div>
        </section>

        <section className="section section-subtle" aria-labelledby="architecture">
          <div className="wrap">
            <SectionHead id="architecture" kicker={s.arch.kicker} title={s.arch.title} lead={s.arch.lead} layout="split" />
            <ArchFlow f={{ ...s.flow, nodes: s.arch.nodes, edges: s.arch.edges }} />
            <div className="su-stores">
              <h3 className="caption">{s.arch.storesTitle}</h3>
              <dl>
                {s.arch.stores.map((x) => (
                  <div key={x.what}>
                    <dt>{x.what}</dt>
                    <dd>
                      <Rich text={x.where} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        {s.phases.map((p) => (
          <section key={p.id} className="section su-phase" aria-labelledby={p.id}>
            <div className="wrap">
              <SectionHead id={p.id} kicker={p.kicker} title={p.title} lead={p.lead} layout="split" />
              <ol className="su-steps">
                {p.steps.map((st) => (
                  <Step key={st.id} step={st} n={number(st.id)} s={s} />
                ))}
              </ol>
            </div>
          </section>
        ))}

        <section className="section section-subtle" aria-labelledby="daily">
          <div className="wrap">
            <SectionHead id="daily" kicker={s.daily.kicker} title={s.daily.title} lead={s.daily.lead} layout="split" />
            <ol className="flow su-daily">
              {s.daily.steps.map((d, i) => (
                <li key={d.title} className="card flow-step">
                  <span className="flow-n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3>{d.title}</h3>
                  <p>
                    <Rich text={d.body} />
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="section" aria-labelledby="recipes">
          <div className="wrap">
            <SectionHead id="recipes" kicker={s.recipes.kicker} title={s.recipes.title} lead={s.recipes.lead} />
            <ul className="su-recipes">
              {s.recipes.items.map((r) => (
                <li key={r.title} className="card">
                  <h3>{r.title}</h3>
                  <p>
                    <Rich text={r.body} />
                  </p>
                  <pre>
                    <code>{r.code}</code>
                  </pre>
                  {r.link && <TextLink href={r.link.href}>{r.link.label}</TextLink>}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="section section-subtle" aria-labelledby="troubleshooting">
          <div className="wrap faq-grid">
            <SectionHead id="troubleshooting" kicker={s.trouble.kicker} title={s.trouble.title} />
            <div className="table-scroll" role="region" aria-label={s.trouble.title} tabIndex={0}>
              <table className="su-trouble">
                <thead>
                  <tr>
                    <th scope="col">{s.trouble.head[0]}</th>
                    <th scope="col">{s.trouble.head[1]}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.trouble.rows.map((r) => (
                    <tr key={r.symptom}>
                      <th scope="row">
                        <Rich text={r.symptom} />
                      </th>
                      <td>
                        <Rich text={r.fix} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="closing" aria-labelledby="closing">
          <div className="wrap">
            <h2 id="closing">{s.closing.title}</h2>
            <p className="lead">{s.closing.lead}</p>
            <div className="hero-actions">
              <CopyCommand command={INIT_COMMAND} copy={s.copy} copied={s.copied} />
              <a className="btn btn-primary" href={DEMO_URL}>
                {s.closing.demo}
              </a>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter t={t} page="setup" />
    </>
  );
}
