/** Links used across the site. Change a URL here, nowhere else. */

/** The public demo of the web app loaded with examples/shop (.github/workflows/demo.yml). */
export const DEMO_URL = 'https://indx-watch-demo.i-248.workers.dev';

export const GITHUB_URL = 'https://github.com/INDXDev/indx-watch';
export const NPM_URL = 'https://www.npmjs.com/package/indx-watch';
const blob = (path: string) => `${GITHUB_URL}/blob/main/${path}`;
const docs = (path: string) => blob(`docs/${path}`);
export const DOCS = {
  home: docs('README.md'),
  quickstart: docs('guides/quickstart.md'),
  journey: docs('guides/journey.md'),
  agents: docs('guides/testing-with-agents.md'),
  webApp: docs('guides/web-app.md'),
  fixtures: docs('guides/fixtures.md'),
  writing: docs('guides/writing-test-cases.md'),
  playwright: docs('guides/playwright.md'),
  githubActions: docs('guides/github-actions.md'),
  selfHost: docs('guides/self-host-cloudflare.md'),
  selfHostGithub: docs('guides/self-host-cloudflare-from-github.md'),
  selfHostNode: docs('guides/self-host-node.md'),
  s3: docs('guides/s3-sync.md'),
  concepts: docs('spec/concepts.md'),
  reports: docs('spec/reports.md'),
  landscape: docs('research/landscape.md'),
  sampleReport: blob('examples/shop/reports/v1.2.0.md'),
  changelog: blob('CHANGELOG.md'),
  security: blob('SECURITY.md'),
  license: blob('LICENSE'),
};

/**
 * Where this site is served; used for canonical URLs, hreflang, Open Graph and the sitemap.
 * Set NEXT_PUBLIC_SITE_URL at build time once the site has its own domain.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://indx-watch-site.i-248.workers.dev').replace(
  /\/$/,
  '',
);

/** The setup guide on this site, per language. */
export const SETUP_PATH = { en: '/setup/', ja: '/ja/setup/' } as const;
/** The team guide (daily work by role), per language. */
export const TEAM_PATH = { en: '/team/', ja: '/ja/team/' } as const;

export const INIT_COMMAND = 'npx indx-watch init';
