---
title: "0014. The docs are also published with Mintlify"
description: "The same Markdown files in docs/ render on GitHub and on a Mintlify docs site."
---

# 0014. The docs are also published with Mintlify, from the same Markdown files

- Status: accepted
- Date: 2026-11-24

## Context

[ADR 0011](./0011-markdown-docs.md) made the docs English Markdown in `docs/`, read on GitHub. For a wider release, new users need a docs site with navigation, search and a landing page. Keeping a second copy of the docs for a site would break "one home per fact".

## Decision

- `docs/` is also a [Mintlify](https://mintlify.com) project. `docs/docs.json` holds the site name, theme, colors (from `docs/design/tokens.css`), navbar and navigation; `docs/.mintignore` keeps the HTML mockups and the ADR template off the site. `docs/index.md` is the site's landing page; `docs/README.md` stays the map for GitHub readers.
- The pages are the same `.md` files. **GitHub rendering remains a requirement**: no MDX components, no imports; Mermaid as fenced code blocks.
- Pages in the navigation start with `title` and `description` frontmatter and keep their `#` heading, so they read the same on GitHub. `docs/style.css` hides that first heading on the site, where the frontmatter title is already the page heading.
- Links between pages and to images are relative and start with `./` or `../` (`./quickstart.md`, `../images/home.png`). Mintlify turns those into site URLs; a bare `quickstart.md` would open the raw Markdown file.
- Links to what the site does not serve (anything outside `docs/` such as code, `examples/shop` and `CHANGELOG.md`; the `README.md` maps; the HTML mockups) are absolute `https://github.com/INDXDev/indx-watch/blob/main/…` or `…/tree/main/…` URLs. `pnpm check:docs` enforces these link rules and checks those URLs against the working tree, as it checks relative links.
- Prose avoids bare `<`, `{` and `}`, since Mintlify reads `.md` pages as MDX.
- Mintlify deploys from `main` through its GitHub app with "docs.json is in a subdirectory" set to `/docs`. No workflow in this repository deploys the site.

## Consequences

One set of files serves both readers. Contributors follow a few extra rules (frontmatter and a `docs.json` entry for new pages, `./` links, GitHub URLs for what the site does not serve); `pnpm check:docs` checks the link rules in CI, and `npx mint validate` and `npx mint broken-links` in `docs/` check the site locally. Heading anchors are generated differently: Mintlify keeps characters such as `/` that GitHub drops, so a link to a heading with code or punctuation in it opens the right page on the site but may not scroll to the heading. If Mintlify goes away, the docs are still plain Markdown on GitHub.
