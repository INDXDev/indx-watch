/** The site header and footer (Vercel, Linear): brand, section links, language, GitHub, one primary button. */
import type { Content } from '@/content/types';
import { DOCS, GITHUB_URL } from '@/lib/site';
import { GitHubIcon, Icon, Logo } from '../ui';

function otherLocale(t: Content) {
  return { other: t.locale === 'en' ? '/ja/' : '/', otherLang: t.locale === 'en' ? 'ja' : 'en' };
}

export function SiteHeader({ t }: { t: Content }) {
  const { other, otherLang } = otherLocale(t);
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
            <a href="#features">{t.nav.product}</a>
            <a href="#roles">{t.nav.roles}</a>
            <a href="#platform">{t.nav.platform}</a>
            <a href="#compare">{t.nav.compare}</a>
            <a href="#faq">{t.nav.faq}</a>
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
            <a className="btn btn-primary btn-sm" href="#start">
              {t.nav.getStarted}
            </a>
          </div>
        </div>
      </header>
    </>
  );
}

export function SiteFooter({ t }: { t: Content }) {
  const { other, otherLang } = otherLocale(t);
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
                    <a href={l.href}>{l.label}</a>
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
