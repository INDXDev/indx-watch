/** Report preview: the server-rendered HTML report for the current scope, for internal readers or a customer. */
import { useState } from 'react';
import { useApp } from '../App';
import { api, type ReportQuery, reportPath } from '../api';
import { LOCALES, type Locale, useI18n } from '../i18n';
import { Load, Seg, useApi } from '../ui';

export function Report() {
  const { t, locale } = useI18n();
  const { scope } = useApp();
  const [audience, setAudience] = useState<ReportQuery['audience']>('customer');
  const [lang, setLang] = useState<Locale>(locale);
  const [plan, setPlan] = useState('');
  const plans = useApi(api.plans, []);
  const q: ReportQuery = { ...scope, plan: plan || undefined, format: 'html', audience, locale: lang };
  const html = useApi(() => api.report(q), [scope.release, scope.env, plan, audience, lang]);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('report.title')}</h1>
          <p className="muted">
            {t(audience === 'customer' ? 'report.customerHint' : 'report.internalHint')}
          </p>
        </div>
        <div className="actions">
          <a className="btn" href={reportPath(q)} target="_blank" rel="noreferrer">
            {t('report.open')} ↗
          </a>
          <a
            className="btn"
            href={reportPath({ ...q, format: 'md' })}
            download={`report-${scope.release ?? 'all'}.md`}
          >
            {t('report.markdown')}
          </a>
        </div>
      </div>
      <div className="toolbar card">
        <Seg
          label={t('report.audience')}
          value={audience}
          options={['customer', 'internal'] as const}
          text={(a) => t(`report.audience.${a}`)}
          onChange={setAudience}
        />
        <Seg
          label={t('prefs.language')}
          value={lang}
          options={LOCALES}
          text={(l) => (l === 'en' ? 'English' : '日本語')}
          onChange={setLang}
        />
        <label>
          {t('report.plan')}{' '}
          <select value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="">{t('report.wholeRelease')}</option>
            {(plans.data ?? []).map((p) => (
              <option key={p.key} value={p.key}>
                {p.key} · {p.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Load state={html}>
        {(doc) => <iframe className="report-frame card" title={t('report.title')} sandbox="" srcDoc={doc} />}
      </Load>
    </>
  );
}
