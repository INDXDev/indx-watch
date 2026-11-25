/** Top-bar pieces: scope menu, CLI panel, account menu and the "Who's testing?" dialog (docs/spec/web.md#layout). */
import { useState } from 'react';
import type { ProjectInfo, Scope } from './api';
import { LOCALES, type Locale, readStored, useI18n, writeStored } from './i18n';
import type { Route } from './router';
import { Avatar, Copy, Dialog, isVerified, Popover, personName, Seg, txt } from './ui';

export type Theme = 'auto' | 'light' | 'dark';
/** where the viewer's My / All features choice is kept (docs/spec/web.md#my-features) */
const FEATURES = 'indx-watch.features';
/** "My features" is on when the viewer owns a feature and has not chosen "All features". Tested. */
export const startMine = (info: Pick<ProjectInfo, 'owns'>, stored = readStored(FEATURES)) =>
  !!info.owns?.length && stored !== 'all';
export const THEMES: Theme[] = ['auto', 'light', 'dark'];

export function ScopeMenu({
  info,
  scope,
  setScope,
}: {
  info: ProjectInfo;
  scope: Scope;
  setScope(s: Scope): void;
}) {
  const { t, locale } = useI18n();
  const env = info.environments.find((e) => e.name === scope.env);
  const release = info.releases.find((r) => r.version === scope.release);
  const button = (
    <>
      <span className="scope-main">{scope.release ?? t('scope.noRelease')}</span>
      <span className="scope-sub">
        {env ? txt(env, 'title', locale) : t('scope.allEnvironments')}
        {scope.mine && ` · ${t('scope.mine')}`}
      </span>
      <span aria-hidden="true"> ▾</span>
    </>
  );
  return (
    <Popover label={t('scope.label')} button={button} className="btn btn-ghost scope-btn">
      {() => (
        <div className="stack-sm scope-panel">
          {release?.title && <p className="muted small">{txt(release, 'title', locale)}</p>}
          <label className="field">
            <span>{t('scope.release')}</span>
            <select
              value={scope.release ?? ''}
              onChange={(e) => setScope({ ...scope, release: e.target.value || undefined })}
            >
              {info.releases.map((r) => (
                <option key={r.version} value={r.version}>
                  {r.version} {r.title ? `— ${txt(r, 'title', locale)}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('scope.environment')}</span>
            <select
              value={scope.env ?? ''}
              onChange={(e) => setScope({ ...scope, env: e.target.value || undefined })}
            >
              <option value="">{t('scope.allEnvironments')}</option>
              {info.environments.map((e) => (
                <option key={e.name} value={e.name}>
                  {txt(e, 'title', locale)}
                </option>
              ))}
            </select>
          </label>
          {!!info.owns?.length && (
            <Seg
              label={t('scope.features')}
              value={scope.mine ? 'mine' : 'all'}
              options={['mine', 'all'] as const}
              text={(v) => t(v === 'mine' ? 'scope.mine' : 'scope.allFeatures')}
              onChange={(v) => {
                writeStored(v, FEATURES);
                setScope({ ...scope, mine: v === 'mine' });
              }}
            />
          )}
        </div>
      )}
    </Popover>
  );
}

/** The commands that match the screen, with this server's real URLs (docs/spec/web.md#cli-panel). Pure; tested. */
export function cliCommands(info: ProjectInfo, route: Route, release?: string) {
  const out: { key: string; cmd: string }[] = [];
  const clone = info.share.clone;
  out.push(
    clone
      ? { key: 'clone', cmd: `npx indx-watch clone ${clone}` }
      : { key: 'cloneGit', cmd: 'git clone <this repository> && npx indx-watch serve' },
  );
  // a hosted app in git mode: publish merged with what the app has, and bring its changes back (docs/spec/sync.md#data-flow-and-conflicts)
  if (info.mode === 'hosted' && info.definitions !== 'workspace')
    out.push({ key: 'deploy', cmd: 'npx indx-watch deploy' }, { key: 'pull', cmd: 'npx indx-watch pull' });
  else out.push({ key: 'push', cmd: 'npx indx-watch push' });
  const tc = route.name === 'testCase' || route.name === 'runner' ? route.key : undefined;
  if (tc) {
    out.push({ key: 'record', cmd: `npx indx-watch record ${tc} --verdict pass` });
    out.push({ key: 'playwright', cmd: `IW_REPORTER=1 npx playwright test --grep @${tc}` });
  }
  if (route.name === 'home' || route.name === 'report')
    out.push({
      key: 'report',
      cmd: `npx indx-watch report${release ? ` --release ${release}` : ''} --format html`,
    });
  out.push({ key: 'sync', cmd: 'npx indx-watch sync --watch' });
  out.push({ key: 'serve', cmd: 'npx indx-watch serve' });
  return out;
}

export function CliPanel({
  info,
  route,
  release,
}: {
  info: ProjectInfo;
  route: Route;
  release?: string | undefined;
}) {
  const { t } = useI18n();
  return (
    <Popover
      label={t('cli.title')}
      button={
        <>
          <span aria-hidden="true">{'>_'}</span> <span className="hide-sm">CLI</span>
        </>
      }
      className="btn btn-ghost"
    >
      {() => (
        <div className="cli-panel">
          <p className="cli-title">{t('cli.title')}</p>
          <p className="muted small">{t('cli.intro')}</p>
          {cliCommands(info, route, release).map((c) => (
            <Copy key={c.key} label={t(`cli.${c.key}` as 'cli.clone')} text={c.cmd} />
          ))}
        </div>
      )}
    </Popover>
  );
}

/** The bar's one-click language switch: shows the other language by its own name (docs/spec/web.md#layout). */
export function LanguageSwitch() {
  const { t, locale, setLocale } = useI18n();
  const [other, name] = locale === 'ja' ? (['en', 'English'] as const) : (['ja', '日本語'] as const);
  return (
    <button
      type="button"
      className="btn btn-ghost"
      lang={other}
      title={t('prefs.switchTo', { language: name })}
      aria-label={t('prefs.switchTo', { language: name })}
      onClick={() => setLocale(other)}
    >
      <span aria-hidden="true">文A</span> <span className="hide-sm">{name}</span>
    </button>
  );
}

const VIA: Record<string, string> = {
  git: 'who.via.git',
  env: 'who.via.env',
  browser: 'who.via.browser',
  github: 'who.via.github',
  'github-oidc': 'who.via.github',
  'cloudflare-access': 'who.via.access',
};

export function AccountMenu({
  info,
  theme,
  onTheme,
  onIdentity,
}: {
  info: ProjectInfo;
  theme: Theme;
  onTheme(): void;
  onIdentity(): void;
}) {
  const { t, locale, setLocale, date } = useI18n();
  const me = info.identity;
  const sync = info.sync.configured
    ? info.sync.lastError
      ? t('footer.syncError', { error: info.sync.lastError })
      : t('footer.synced', { at: date(info.sync.lastSyncAt) })
    : t('footer.noSync');
  return (
    <Popover
      label={t('account.label', { name: personName(me) })}
      button={<Avatar who={me} />}
      className="avatar-btn"
    >
      {(close) => (
        <div className="account">
          <div className="account-who">
            <Avatar who={me} size="lg" />
            <div>
              <strong>{personName(me)}</strong>
              {me.name && me.name !== me.id && <div className="muted small">{me.id}</div>}
              <div className={`small ${isVerified(me) ? 'ok' : 'muted'}`}>
                {isVerified(me) ? '✓ ' : ''}
                {t((VIA[me.via] ?? 'who.via.env') as 'who.via.git')}
              </div>
              {info.mode === 'hosted' && info.role && (
                <div className="small muted">{t(`role.${info.role}`)}</div>
              )}
            </div>
          </div>
          {info.can.declare && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                close();
                onIdentity();
              }}
            >
              {t('who.notYou')}
            </button>
          )}
          <label className="field">
            <span>{t('prefs.language')}</span>
            <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {l === 'en' ? 'English' : '日本語'}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onTheme}>
            {t('prefs.theme')}: {t(`prefs.theme.${theme}`)}
          </button>
          <p className="muted small">
            {t(info.mode === 'local' ? 'footer.local' : 'footer.hosted')} · {sync}
          </p>
        </div>
      )}
    </Popover>
  );
}

/** Stores the tester in the `iw_tester` cookie the server reads (docs/spec/web.md#identity). */
export function setTester(v: { id: string; name: string } | null): void {
  const value = v ? encodeURIComponent(JSON.stringify(v)) : '';
  // biome-ignore lint/suspicious/noDocumentCookie: the server reads this cookie; Cookie Store API is not in every browser
  document.cookie = `iw_tester=${value}; Path=/; Max-Age=${v ? 31536000 : 0}; SameSite=Strict`;
}

export function IdentityDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose(): void;
  onSaved(): void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const id = (email.trim() || name.trim()).slice(0, 80);
  return (
    <Dialog open={open} title={t('who.title')} onClose={onClose}>
      <form
        className="stack-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!id) return;
          setTester({ id, name: name.trim().slice(0, 80) });
          onSaved();
          onClose();
        }}
      >
        <p className="muted">{t('who.intro')}</p>
        <label className="field">
          <span>{t('who.name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} />
        </label>
        <label className="field">
          <span>{t('who.email')}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            maxLength={80}
          />
        </label>
        <p className="muted small">{t('who.unverified')}</p>
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={!id}>
            {t('who.save')}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setTester(null);
              onSaved();
              onClose();
            }}
          >
            {t('who.reset')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
