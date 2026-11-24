/** The site header and footer of the landing page. */
import type { Content } from '@/content/types';
import { DEMO_URL, DOCS, GITHUB_URL, NPM_URL } from '@/lib/site';
import { GitHubIcon, Logo } from './parts';

/** Links to the page in the other language. */
function otherLocale(t: Content) {
  return { other: t.locale === 'en' ? '/ja/' : '/', otherLang: t.locale === 'en' ? 'ja' : 'en' };
}

/** Skip link and header: brand, section navigation, language switch and GitHub. */
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
            <a href="#how">{t.nav.how}</a>
            <a href="#roles">{t.nav.roles}</a>
            <a href="#agents">{t.nav.agents}</a>
            <a href="#compare">{t.nav.compare}</a>
            <a href="#faq">{t.nav.faq}</a>
          </nav>
          <div className="header-actions">
            <a className="lang" href={other} hrefLang={otherLang} lang={otherLang} aria-label={t.nav.otherLanguageLabel}>
              <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="6.5" />
                <path d="M1.5 8h13M8 1.5c1.8 1.9 2.7 4 2.7 6.5S9.8 12.6 8 14.5M8 1.5C6.2 3.4 5.3 5.5 5.3 8s.9 4.6 2.7 6.5" />
              </svg>
              {t.nav.otherLanguage}
            </a>
            <a className="header-gh" href={GITHUB_URL} aria-label="GitHub">
              <GitHubIcon />
              <span>{t.nav.github}</span>
            </a>
          </div>
        </div>
      </header>
    </>
  );
}

/** Footer: brand, tagline and links. */
export function SiteFooter({ t }: { t: Content }) {
  const { other, otherLang } = otherLocale(t);
  return (
    <footer className="site-footer">
      <div className="wrap footer-row">
        <div>
          <a className="brand" href={t.path}>
            <Logo />
            <span>INDX Watch</span>
          </a>
          <p>{t.footer.tagline}</p>
        </div>
        <ul className="footer-links">
          <li>
            <a href={GITHUB_URL}>{t.footer.github}</a>
          </li>
          <li>
            <a href={DOCS.home}>{t.footer.docs}</a>
          </li>
          <li>
            <a href={DEMO_URL}>{t.footer.demo}</a>
          </li>
          <li>
            <a href={NPM_URL}>{t.footer.npm}</a>
          </li>
          <li>
            <a href={DOCS.license}>{t.footer.license}</a>
          </li>
          <li>
            <a href={other} hrefLang={otherLang} lang={otherLang}>
              {t.nav.otherLanguage}
            </a>
          </li>
        </ul>
      </div>
    </footer>
  );
}
