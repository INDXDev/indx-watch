/** The site header and footer (Vercel, Linear): brand, section links, language, GitHub, one primary button. */
import type { Content } from '@/content/types';
import { DOCS, GITHUB_URL, SETUP_PATH, TEAM_PATH } from '@/lib/site';
import { GitHubIcon, Icon, Logo } from '../ui';

/** Which page the header and footer sit on: the landing page, the setup guide or the team guide. */
export type Page = 'home' | 'setup' | 'team';

function otherLocale(t: Content, page: Page) {
  const otherLang = t.locale === 'en' ? 'ja' : 'en';
  const paths = { setup: SETUP_PATH, team: TEAM_PATH, home: { en: '/', ja: '/ja/' } } as const;
  return { other: paths[page][otherLang], otherLang };
}

/** Section links work from either page: `#features` on the landing page, `/#features` elsewhere. */
const section = (t: Content, page: Page, href: string) => (page === 'home' || !href.startsWith('#') ? href : `${t.path}${href}`);

export function SiteHeader({ t, page = 'home' }: { t: Content; page?: Page }) {
  const { other, otherLang } = otherLocale(t, page);
  const at = (href: string) => section(t, page, href);
  return (
    <>
      <a className="skip" href="#main">
        {t.nav.skip}
      </a>
      <header className="site-header">
        <div className="wrap header-row">
          <a className="brand" href={t.path} aria-label="INDX Watch">
            <Logo />
            <span>INDX Watch</span>
          </a>
          <nav aria-label={t.nav.menu} className="nav">
            <a href={at('#features')}>{t.nav.product}</a>
            <a href={at('#roles')}>{t.nav.roles}</a>
            <a href={at('#platform')}>{t.nav.platform}</a>
            <a href={at('#compare')}>{t.nav.compare}</a>
            <a href={at('#faq')}>{t.nav.faq}</a>
            <a href={SETUP_PATH[t.locale]} aria-current={page === 'setup' ? 'page' : undefined}>
              {t.nav.setup}
            </a>
            <a href={TEAM_PATH[t.locale]} aria-current={page === 'team' ? 'page' : undefined}>
              {t.nav.team}
            </a>
            <a href={DOCS.home}>{t.nav.docs}</a>
          </nav>
          <div className="header-actions">
            <a className="quiet" href={other} hrefLang={otherLang} lang={otherLang} aria-label={t.nav.otherLanguageLabel}>
              <Icon name="globe" />
              <span className="lang-label">{t.nav.otherLanguage}</span>
            </a>
            <a className="quiet" href={GITHUB_URL} aria-label="GitHub">
              <GitHubIcon />
              <span className="gh-label">{t.nav.github}</span>
            </a>
            <span className="header-divider" aria-hidden="true" />
            <a className="btn btn-primary btn-sm" href={page === 'setup' ? '#install' : page === 'team' ? SETUP_PATH[t.locale] : '#start'}>
              {t.nav.getStarted}
            </a>
          </div>
        </div>
      </header>
    </>
  );
}

export function SiteFooter({ t, page = 'home' }: { t: Content; page?: Page }) {
  const { other, otherLang } = otherLocale(t, page);
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-grid">
          <div>
            <a className="brand" href={t.path}>
              <Logo />
              <span>INDX Watch</span>
            </a>
            <p>{t.footer.tagline}</p>
          </div>
          {t.footer.columns.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h4>{col.title}</h4>
              <ul>
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a href={section(t, page, l.href)}>{l.label}</a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="footer-bottom">
          <span>
            © {new Date().getFullYear()} {t.footer.copyright} · Apache-2.0
          </span>
          <a href={other} hrefLang={otherLang} lang={otherLang}>
            {t.nav.otherLanguage}
          </a>
        </div>
      </div>
    </footer>
  );
}
