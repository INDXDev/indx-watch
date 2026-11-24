import type { NextConfig } from 'next';

const config: NextConfig = {
  // Plain static files in out/: deploy to Cloudflare Workers static assets, Vercel or any static host.
  output: 'export',
  // /ja/ is written as out/ja/index.html, which every static host serves without rewrites.
  trailingSlash: true,
  images: { unoptimized: true },
  // site/ has its own lockfile inside the repository's pnpm workspace; keep Next from picking the parent.
  turbopack: { root: import.meta.dirname },
  poweredByHeader: false,
};

export default config;
