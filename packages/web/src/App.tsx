/** App shell: project + scope context, top bar (docs/spec/web.md#layout) and the routed screen. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, type ProjectInfo, type Scope } from './api';
import { I18nContext, type Locale, makeI18n, pickLocale, readStored, useI18n, writeStored } from './i18n';
import { href, type Route, useRoute } from './router';
import { Activity, RunFocus } from './screens/Activity';
import { Fixtures } from './screens/Fixtures';
import { Home } from './screens/Home';
import { Report } from './screens/Report';
import { AccessOverview, Secrets } from './screens/Secrets';
import { TestFocus, Tests } from './screens/Tests';
import { Uploads } from './screens/Uploads';
import { AccountMenu, CliPanel, IdentityDialog, ScopeMenu, startMine, THEMES, type Theme } from './shell';
import { Load, OriginalContext, useApi } from './ui';
import { DropOverlay, type Picked, Pickers, UploadDialog } from './upload';

export interface AppCtx {
  project: ProjectInfo;
  scope: Scope;
  setScope(s: Scope): void;
  /** open the upload dialog, optionally with files already picked */
  upload(p?: Picked[]): void;
  reload(): void;
}
export const AppContext = createContext<AppCtx | null>(null);
export const useApp = (): AppCtx => useContext(AppContext)!;

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
      {project.code === 'no-snapshot' ? (
        <Welcome onDone={project.reload} />
      ) : (
        <Load state={project}>{(p) => <Shell info={p} reload={project.reload} />}</Load>
      )}
    </I18nContext.Provider>
  );
}

/** A hosted app without a snapshot: drop the folder here (docs/spec/web.md#home). */
function Welcome({ onDone }: { onDone(): void }) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<Picked[] | null>(null);
  const onFiles = useCallback((p: Picked[]) => setPicked(p), []);
  return (
    <main id="main" className="page welcome">
      <div className="hero">
        <p className="eyebrow">INDX Watch</p>
        <h1>{t('welcome.title')}</h1>
        <p className="muted">{t('welcome.intro')}</p>
      </div>
      <div className="dropzone dropzone-lg">
        <div className="drop-icon">⇪</div>
        <p>
          <strong>{t('upload.dropHere')}</strong>
        </p>
        <Pickers onFiles={onFiles} />
        <p className="muted small">{t('welcome.orCli')}</p>
        <code className="copy-text">npx indx-watch push</code>
      </div>
      <DropOverlay onFiles={onFiles} />
      <UploadDialog
        open={!!picked}
        picked={picked}
        hosted
        onClose={() => setPicked(null)}
        onDone={onDone}
        onFiles={onFiles}
      />
    </main>
  );
}

function Shell({ info, reload }: { info: ProjectInfo; reload(): void }) {
  const { t } = useI18n();
  const route = useRoute();
  const [scope, setScope] = useState<Scope>({
    release: info.project.current_release ?? info.releases[0]?.version,
    env: undefined, // all environments, like `iw status` and `iw report`
    mine: startMine(info),
  });
  // re-derive when the viewer's owned features change (e.g. after switching the local identity)
  const owns = info.owns?.join(' ') ?? '';
  useEffect(() => setScope((s) => ({ ...s, mine: startMine({ owns: owns ? [owns] : [] }) })), [owns]);
  const [theme, setTheme] = useState<Theme>(() => (readStored('indx-watch.theme') as Theme) || 'auto');
  const [who, setWho] = useState(false);
  const [uploading, setUploading] = useState<{ picked: Picked[] | null } | null>(null);
  const [problems, setProblems] = useState(false);
  const [original, setOriginal] = useState(false);
  const originalCtx = useMemo(() => ({ original, toggle: () => setOriginal((o) => !o) }), [original]);
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
  const upload = useCallback((p?: Picked[]) => setUploading({ picked: p ?? null }), []);
  const onFiles = useCallback((p: Picked[]) => setUploading({ picked: p }), []);
  const nav: [string, string, Route['name'][]][] = [
    [href.home(), t('nav.home'), ['home']],
    [href.tests(), t('nav.tests'), ['tests', 'testCase', 'runner']],
    [href.activity(), t('nav.activity'), ['activity', 'run', 'uploads']],
    [href.fixtures(), t('nav.fixtures'), ['fixtures', 'secrets', 'access']],
    [href.report(), t('nav.report'), ['report']],
  ];
  const ctx = useMemo(
    () => ({ project: info, scope, setScope, upload, reload }),
    [info, scope, upload, reload],
  );
  const dropHere = info.can.upload && ['home', 'tests', 'uploads', 'fixtures'].includes(route.name);
  return (
    <AppContext.Provider value={ctx}>
      <button type="button" className="skip" onClick={() => document.getElementById('main')?.focus()}>
        {t('nav.skip')}
      </button>
      <header className="topbar">
        <a className="brand" href={href.home()}>
          <span className="logo" aria-hidden="true">
            ✓
          </span>
          <span className="brand-name">INDX Watch</span>
          <span className="project">{info.project.name}</span>
        </a>
        <nav className="nav" aria-label={t('nav.label')}>
          {nav.map(([to, label, names]) => (
            <a key={to} href={to} aria-current={names.includes(route.name) ? 'page' : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <div className="prefs">
          <ScopeMenu info={info} scope={scope} setScope={setScope} />
          {info.can.upload && (
            <button type="button" className="btn btn-ghost" onClick={() => upload()}>
              <span aria-hidden="true">⇪</span> <span className="hide-sm">{t('upload.button')}</span>
            </button>
          )}
          <CliPanel info={info} route={route} release={scope.release} />
          <AccountMenu info={info} theme={theme} onTheme={nextTheme} onIdentity={() => setWho(true)} />
        </div>
      </header>
      {info.problems.length > 0 && (
        <div className="problems" role="status">
          <button
            type="button"
            className="link"
            aria-expanded={problems}
            onClick={() => setProblems(!problems)}
          >
            ⚠ {t('problems.title', { count: info.problems.length })}
          </button>
          {problems && (
            <ul>
              {info.problems.slice(0, 20).map((p) => (
                <li key={`${p.file}:${p.message}`}>
                  {p.file && <code>{p.file}</code>} {p.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <main id="main" className="page" tabIndex={-1}>
        <OriginalContext.Provider value={originalCtx}>
          <Screen route={route} />
        </OriginalContext.Provider>
      </main>
      {dropHere && <DropOverlay onFiles={onFiles} />}
      <UploadDialog
        open={!!uploading}
        picked={uploading?.picked ?? null}
        hosted={info.mode === 'hosted'}
        workspace={info.can.edit}
        onClose={() => setUploading(null)}
        onDone={reload}
        onFiles={onFiles}
      />
      <IdentityDialog open={who} onClose={() => setWho(false)} onSaved={reload} />
    </AppContext.Provider>
  );
}

function Screen({ route }: { route: Route }) {
  const { t } = useI18n();
  const f = route.query.f;
  switch (route.name) {
    case 'home':
      return <Home />;
    case 'tests':
      return <Tests filter={f} />;
    case 'testCase':
    case 'runner':
      return (
        <TestFocus
          key={`${route.name}:${route.key}`}
          tcKey={route.key}
          filter={f}
          run={route.name === 'runner'}
          session={route.query.session?.split(',')}
        />
      );
    case 'activity':
      return <Activity filter={f} />;
    case 'run':
      return <RunFocus id={route.id} filter={f} />;
    case 'fixtures':
      return <Fixtures selected={route.key} />;
    case 'secrets':
      return <Secrets selected={route.key} />;
    case 'access':
      return <AccessOverview who={route.query.who} />;
    case 'uploads':
      return <Uploads />;
    case 'report':
      return <Report />;
    default:
      return (
        <div className="empty">
          <h1>{t('notFound.title')}</h1>
          <a href={href.home()}>{t('notFound.back')}</a>
        </div>
      );
  }
}
