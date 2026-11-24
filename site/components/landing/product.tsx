/** The product sections: developer experience, web app gallery, comparison, self-hosting and FAQ. */
import { PW_PATH, PW_TC3, STATUS_CMD, STATUS_JSON, TOML_PATH, TOML_TC3 } from '@/content/code';
import type { Content } from '@/content/types';
import { DEMO_URL, DOCS } from '@/lib/site';
import { CodePanel } from '../code';
import { Rich } from '../rich';
import { hasImage, imageSize, Screenshot } from '../screenshot';
import { Mark, SectionHead } from './parts';

/** A test case as TOML, its Playwright test and the status JSON. */
export function Dx({ t }: { t: Content }) {
  return (
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
  );
}

/** Screenshots of the web app; nothing when none are available. */
export function Gallery({ t }: { t: Content }) {
  const gallery = t.gallery.items.filter((item) => hasImage(item.image));
  if (gallery.length === 0) return null;
  return (
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
  );
}

/** Comparison with other test management tools. */
export function Compare({ t }: { t: Content }) {
  return (
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
  );
}

/** Where to host and why there is no lock-in. */
export function SelfHost({ t }: { t: Content }) {
  return (
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
  );
}

/** Frequently asked questions. */
export function Faq({ t }: { t: Content }) {
  return (
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
  );
}
