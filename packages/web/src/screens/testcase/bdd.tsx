/** BDD style (docs/spec/web.md#bdd-style): Given / When / Then labels and how to run the scenario. */
import type { TestCaseDetail } from '../../api';
import { useI18n } from '../../i18n';

export const isBdd = (d: TestCaseDetail) => d.data.style === 'bdd';

/** A Given / When / Then / And keyword in front of a line; nothing for a test case in steps style. */
export function Kw({ on, k }: { on: boolean; k: 'given' | 'when' | 'then' | 'and' }) {
  const { t } = useI18n();
  return on ? <span className="label gwt">{t(`bdd.${k}`)}</span> : null;
}

/** What Given, When and Then ask of the tester, and how they decide the result. Open until closed. */
export function BddGuide() {
  const { t } = useI18n();
  return (
    <details className="callout bdd-guide" open>
      <summary>{t('bdd.guideTitle')}</summary>
      <p>{t('bdd.guideIntro')}</p>
      <ul>
        {(['given', 'when', 'then'] as const).map((k) => (
          <li key={k}>
            <span className="label gwt">{t(`bdd.${k}`)}</span> {t(`bdd.guide.${k}`)}
          </li>
        ))}
      </ul>
      <p>{t('bdd.guideVerdict')}</p>
    </details>
  );
}
