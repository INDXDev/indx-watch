/** App shell: project + scope context, top bar (navigation, scope, language, theme) and the routed screen. */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, type ProjectInfo, type Scope } from './api';
import {
  I18nContext,
  LOCALES,
  type Locale,
  makeI18n,
  pickLocale,
  readStored,
  useI18n,
  writeStored,
} from './i18n';
import { href, type Route, useRoute } from './router';
import { Dashboard } from './screens/Dashboard';
import { Fixtures } from './screens/Fixtures';
import { Report } from './screens/Report';
import { RunView } from './screens/Run';
import { Runner } from './screens/Runner';
import { SpecTreeView } from './screens/SpecTree';
import { TestCaseView } from './screens/TestCase';
import { Load, useApi } from './ui';

export interface AppCtx {
  project: ProjectInfo;
  scope: Scope;
  setScope(s: Scope): void;
}
export const AppContext = createContext<AppCtx | null>(null);
export const useApp = (): AppCtx => useContext(AppContext)!;

type Theme = 'auto' | 'light' | 'dark';
const THEMES: Theme[] = ['auto', 'light', 'dark'];

export function App() {
  const [chosen, setChosen] = useState(() => readStored());
  const project = useApi(api.project, []);
  const locale = pickLocale(chosen, navigator.languages ?? [], project.data?.project.source_locale);
  const i18n = useMemo(
    () =>
      makeI18n(locale, (l: Locale) => {
        writeStored(l);
        setChosen(l);
      }),
    [locale],
  );
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return (
    <I18nContext.Provider value={i18n}>
      <Load state={project}>{(p) => <Shell info={p} />}</Load>
    </I18nContext.Provider>
  );
}

function Shell({ info }: { info: ProjectInfo }) {
  const { t, locale, setLocale, date } = useI18n();
  const route = useRoute();
  const [scope, setScope] = useState<Scope>({
    release: info.project.current_release ?? info.releases[0]?.version,
    env: info.project.default_environment,
  });
  const [theme, setTheme] = useState<Theme>(() => (readStored('indx-watch.theme') as Theme) || 'auto');
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'auto') delete el.dataset.theme;
    else el.dataset.theme = theme;
  }, [theme]);
  const nextTheme = () => {
    const n = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!;
    writeStored(n, 'indx-watch.theme');
    setTheme(n);
  };
  const nav: [string, string, Route['name'][]][] = [
    [href.dashboard(), t('nav.readiness'), ['dashboard']],
    [href.specs(), t('nav.specs'), ['specs', 'testCase', 'runner', 'run']],
    [href.fixtures(), t('nav.fixtures'), ['fixtures']],
    [href.report(), t('nav.report'), ['report']],
  ];
  const ctx = useMemo(() => ({ project: info, scope, setScope }), [info, scope]);
  return (
    <AppContext.Provider value={ctx}>
      <button type="button" className="skip" onClick={() => document.getElementById('main')?.focus()}>
        {t('nav.skip')}
      </button>
      <header className="topbar">
        <a className="brand" href={href.dashboard()}>
          <span className="logo" aria-hidden="true">
            ✓
          </span>
          INDX Watch <span className="project">{info.project.name}</span>
        </a>
        <nav className="nav" aria-label={t('nav.label')}>
          {nav.map(([to, label, names]) => (
            <a key={to} href={to} aria-current={names.includes(route.name) ? 'page' : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <div className="prefs">
          <label>
            <span className="sr">{t('scope.release')}</span>
            <select
              value={scope.release ?? ''}
              onChange={(e) => setScope({ ...scope, release: e.target.value || undefined })}
            >
              {info.releases.map((r) => (
                <option key={r.version} value={r.version}>
                  {r.version}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr">{t('scope.environment')}</span>
            <select
              value={scope.env ?? ''}
              onChange={(e) => setScope({ ...scope, env: e.target.value || undefined })}
            >
              <option value="">{t('scope.allEnvironments')}</option>
              {info.environments.map((e) => (
                <option key={e.name} value={e.name}>
                  {e.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr">{t('prefs.language')}</span>
            <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {l === 'en' ? 'English' : '日本語'}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-ghost" onClick={nextTheme} title={t('prefs.theme')}>
            {t(`prefs.theme.${theme}`)}
          </button>
        </div>
      </header>
      {info.problems.length > 0 && (
        <div className="banner s-needs_review" role="status">
          <strong>{t('problems.title', { count: info.problems.length })}</strong>
          <ul>
            {info.problems.slice(0, 5).map((p) => (
              <li key={`${p.file}:${p.message}`}>
                {p.file && <code>{p.file}</code>} {p.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <main id="main" className="page" tabIndex={-1}>
        <Screen route={route} />
      </main>
      <footer className="footer">
        <span>
          {t('footer.you')} <strong>{info.identity.name ?? info.identity.id}</strong> ({info.identity.via})
        </span>
        <span>{t(info.mode === 'local' ? 'footer.local' : 'footer.hosted')}</span>
        <span>
          {info.sync.configured
            ? info.sync.lastError
              ? t('footer.syncError', { error: info.sync.lastError })
              : t('footer.synced', { at: date(info.sync.lastSyncAt) })
            : t('footer.noSync')}
        </span>
      </footer>
    </AppContext.Provider>
  );
}

function Screen({ route }: { route: Route }) {
  const { t } = useI18n();
  switch (route.name) {
    case 'dashboard':
      return <Dashboard />;
    case 'specs':
      return <SpecTreeView />;
    case 'testCase':
      return <TestCaseView key={route.key} tcKey={route.key} />;
    case 'runner':
      return <Runner key={route.key} tcKey={route.key} />;
    case 'run':
      return <RunView key={route.id} id={route.id} />;
    case 'fixtures':
      return <Fixtures selected={route.key} />;
    case 'report':
      return <Report />;
    default:
      return (
        <div className="empty">
          <h1>{t('notFound.title')}</h1>
          <a href={href.dashboard()}>{t('notFound.back')}</a>
        </div>
      );
  }
}
