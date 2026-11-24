/** Links used across the site. Change a URL here, nowhere else. */

/** The public demo of the web app loaded with examples/shop (.github/workflows/demo.yml). */
export const DEMO_URL = 'https://indx-watch-demo.i-248.workers.dev';

export const GITHUB_URL = 'https://github.com/INDXDev/indx-watch';
export const NPM_URL = 'https://www.npmjs.com/package/indx-watch';
const docs = (path: string) => `${GITHUB_URL}/blob/main/docs/${path}`;
export const DOCS = {
  home: docs('README.md'),
  quickstart: docs('guides/quickstart.md'),
  agents: docs('guides/testing-with-agents.md'),
  playwright: docs('guides/playwright.md'),
  selfHost: docs('guides/self-host-cloudflare.md'),
  s3: docs('guides/s3-sync.md'),
  concepts: docs('spec/concepts.md'),
  landscape: docs('research/landscape.md'),
  license: `${GITHUB_URL}/blob/main/LICENSE`,
};

/**
 * Where this site is served; used for canonical URLs, hreflang, Open Graph and the sitemap.
 * Set NEXT_PUBLIC_SITE_URL at build time once the site has its own domain.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://indx-watch-site.i-248.workers.dev').replace(
  /\/$/,
  '',
);

export const INIT_COMMAND = 'npx indx-watch init';
