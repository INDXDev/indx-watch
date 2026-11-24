/** "How it works": the steps, and git + store = gate. */
import type { Content } from '@/content/types';
import { Rich } from '../rich';
import { SectionHead } from './parts';

/** git + store = gate, with the gate checks as pass/fail pills. */
export function HowSplit({ t }: { t: Content }) {
  return (
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
  );
}

/** The steps from install to release, then the split between git and the store. */
export function How({ t }: { t: Content }) {
  return (
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
        <HowSplit t={t} />
      </div>
    </section>
  );
}
