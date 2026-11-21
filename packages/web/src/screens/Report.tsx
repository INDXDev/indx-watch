/** Report preview: the server-rendered HTML report for the current scope, for internal readers or a customer. */
import { useState } from 'react';
import { useApp } from '../App';
import { api, type ReportQuery, reportPath } from '../api';
import { LOCALES, type Locale, useI18n } from '../i18n';
import { Copy, Load, Section, Seg, THead, useAgo, useApi, Who } from '../ui';

export function Report() {
  const { t, locale } = useI18n();
  const { scope, project } = useApp();
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
      {project.can.share && <ShareLinks q={q} />}
    </>
  );
}

const DAYS = ['7', '30', '90'] as const;
/** Hosted app: freeze the previewed report behind a link, list the links and revoke them (docs/spec/web.md#report). */
function ShareLinks({ q }: { q: ReportQuery }) {
  const { t, locale } = useI18n();
  const ago = useAgo();
  const [days, setDays] = useState<(typeof DAYS)[number]>('7');
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const links = useApi(api.shares, []);
  const act = (f: () => Promise<unknown>) => f().then(links.reload, (e: Error) => setError(e.message));
  const create = () => act(() => api.createShare(q, Number(days)).then((r) => setUrl(r.url)));
  const revoke = (id: string) => window.confirm(t('share.confirm')) && act(() => api.revokeShare(id));
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale);
  const make = (
    <>
      <Seg
        label={t('share.days')}
        value={days}
        options={DAYS}
        text={(n) => t('share.daysN', { count: n })}
        onChange={setDays}
      />
      <button type="button" className="btn btn-primary" onClick={create}>
        {t('share.create')}
      </button>
    </>
  );
  return (
    <Section title={t('share.title')} actions={make} id="share">
      <p className="muted small">{t('share.intro')}</p>
      {error && (
        <div className="callout s-fail" role="alert">
          {error}
        </div>
      )}
      {url && (
        <div role="status">
          <Copy text={url} />
          <p className="muted small">{t('share.once')}</p>
        </div>
      )}
      <Load state={links}>
        {(list) =>
          list.length === 0 ? (
            <p className="muted">{t('share.none')}</p>
          ) : (
            <div className="table-wrap">
              <table>
                <THead
                  cols={[
                    'share.created',
                    'report.audience',
                    'share.scope',
                    'share.expires',
                    'share.state',
                    ['share.opens', 'num'],
                    'share.revoke',
                  ]}
                />
                <tbody>
                  {list.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <Who who={l.actor} /> <span className="muted small">{ago(l.at)}</span>
                      </td>
                      <td>{t(`report.audience.${l.audience}`)}</td>
                      <td>{l.plan ?? l.release ?? '—'}</td>
                      <td>{date(l.expires_at)}</td>
                      <td>{t(`share.state.${l.state}`)}</td>
                      <td className="num">{l.opens}</td>
                      <td>
                        {l.state === 'active' && (
                          <button type="button" className="btn btn-sm" onClick={() => revoke(l.id)}>
                            {t('share.revoke')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Load>
    </Section>
  );
}
