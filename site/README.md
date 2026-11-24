# INDX Watch landing page

The public landing page of INDX Watch, in English (`/`) and Japanese (`/ja/`). It is a Next.js (App Router) app exported as static files. It lives in this repository but is **not part of the `indx-watch` package**: `site/` is its own pnpm workspace with its own lockfile, so `pnpm install` at the repository root never installs Next.js, and root lint, typecheck, tests and the npm tarball ignore it.

## Develop

Requires Node 22.13+ and pnpm 10.

```bash
cd site
pnpm install
pnpm dev          # http://localhost:3000 and http://localhost:3000/ja/
pnpm typecheck
```

Before changing how the page looks, read [DESIGN.md](DESIGN.md): the pages it copies, the section order, tokens, primitives and the rules for the demo.

| Path | What |
|---|---|
| `DESIGN.md` | Design rules and the reference pages each section follows. `pnpm references` saves fresh screenshots of them to `references/` (gitignored). |
| `content/en.ts`, `content/ja.ts` | All words on the page, one object per language (`content/types.ts`). Write Japanese as Japanese, not as a translation. |
| `content/code.ts` | Excerpts from [`examples/shop`](../examples/shop) and the demo's terminal output; keep them in step with the files and tools they quote. |
| `components/landing.tsx`, `components/landing/` | The page, shared by both languages: one component per section. |
| `components/demo/` | The product demo: four chapters drawn as HTML on a scaled 1200 × 720 canvas ([DESIGN.md](DESIGN.md#the-demo)). |
| `components/role.tsx` | The reader's role (developer, tester, product manager), kept in `?for=` and followed by the hero, demo and For teams tabs. |
| `components/ui.tsx` | Primitives: section header, text link, logo, icons. |
| `app/(en)/`, `app/(ja)/ja/` | One root layout per language, so each page has the right `<html lang>`. |
| `app/globals.css`, `app/demo.css` | The stylesheets: tokens, primitives and sections; and the demo, which uses the web app's tokens from [`docs/design/tokens.css`](../docs/design/tokens.css). |
| `lib/site.ts` | Every outside URL, including the live demo (`DEMO_URL`) and the site's own URL. |
| `scripts/copy-images.mjs` | Runs before `dev` and `build`: copies `../docs/images/*.png` into `public/images/` (gitignored). |
| `scripts/og.html` | Source of `public/og.png`, the Open Graph image. |

### Screenshots

The For teams section shows product screenshots from [`docs/images/`](../docs) (`manual-run.png`, `readiness.png`). The site never keeps its own copy: `pnpm dev` and `pnpm build` copy them into `public/images/` first. A name that is not in `docs/images/` yet falls back to the older picture in `docs/design/screenshots/`, and a name with neither is left out of the page. Run `pnpm images` to see what was used.

## Build

```bash
pnpm build        # static files in out/
pnpm preview      # serve out/ on http://localhost:3000
```

Set `NEXT_PUBLIC_SITE_URL` (for example `https://indx-watch.example`) when building for a real domain. It is used for canonical URLs, `hreflang`, Open Graph, `sitemap.xml` and `robots.txt`; without it the build assumes the `workers.dev` URL in `lib/site.ts`.

## Deploy to Cloudflare

`wrangler.jsonc` deploys `out/` as [Workers static assets](https://developers.cloudflare.com/workers/static-assets/) without any Worker code: `/ja` redirects to `/ja/`, and unknown paths get `404.html`.

```bash
pnpm build
pnpm run deploy   # wrangler deploy; asks you to log in the first time
```

From GitHub Actions, [`.github/workflows/site.yml`](../.github/workflows/site.yml) builds the site on every pull request that touches `site/` (or `docs/images/`) and deploys it on pushes to `main`, but only when the `site` environment has the secrets `CLOUDFLARE_API_TOKEN` (permission: Workers Scripts edit) and `CLOUDFLARE_ACCOUNT_ID`; without them the deploy job is skipped with a notice. Set the variable `SITE_URL` in that environment once the site has its own domain, and add the domain as a custom domain of the `indx-watch-site` Worker.

## Deploy elsewhere

`out/` is plain HTML, CSS and JavaScript, so any static host works.

- **Vercel**: import the repository, set the root directory to `site`; Vercel detects Next.js and pnpm and needs no other settings.
- **Netlify, GitHub Pages, S3, nginx**: build, then publish `out/`.
