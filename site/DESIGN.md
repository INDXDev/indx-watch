# Landing page design

How the landing page in `site/` is built, which proven pages it follows, and the rules for changing it. Read this before you touch a section. The words live in [`content/`](content); this page is about layout, type, color and motion.

The approach is 守破離 (*shu-ha-ri*): first follow the masters' form exactly, then adapt, then depart. The page is at *shu*. Every section copies the structure of a well-known developer-tool page. Do not invent a new pattern when a reference already has one; when you add a section, name its reference here first.

## References

These are the pages we copy. They change over time, so look again before a large change: `pnpm references` saves fresh screenshots to `references/` (gitignored, never committed, since they are other companies' pages). It needs network access to those hosts; in a restricted sandbox, allow them first.

| Reference | What we take from it | Where on our page |
|---|---|---|
| [Clerk](https://clerk.com) | Left-aligned hero, then a wide product demo with chapter tabs above it and a moving pointer; tabbed feature sections with an accent kicker | Hero, demo, roles |
| [Linear](https://linear.app) | Tight display type; product UI built in HTML rather than screenshots; a small mono caption under the tool strip; two-tone statement (first sentence in ink, the rest muted); split section headers; one dark band; "Built for the future. Available today." close | Hero, tool strip, why, agents band, closing |
| [Vercel](https://vercel.com) | Geist type, near-white background, hairline borders, black pill as the primary button, a quiet header | Everywhere |
| [Supabase](https://supabase.com) | Product grid of cards with an icon, a key phrase in ink, a checklist and a visual; the "Open source from day one" block with a GitHub button | Features, open source |
| [Stripe](https://stripe.com) | Large cards with a product visual inside; two-tone headings | Features, strengths |
| [Sentry](https://sentry.io) | "Get started in minutes": numbered steps with the command in each | Get started |
| [Vercel](https://vercel.com) deploy flow | A numbered row (develop, preview, ship) showing what happens from git push to production | Self-hosting |
| [Resend](https://resend.com) | The announcement chip above the headline | Hero |

## Page order

The order is the argument: show the product, say what it does, show it is for you, say why it is better, make it easy to start.

1. **Header**: brand, section links, language, GitHub, one primary button.
2. **Hero**: chip, headline, lead and buttons for the reader's role, role switch.
3. **Demo**: four chapters (Design, Automate, Run, Ship) played like a video.
4. **Tool strip**: the tools INDX Watch works with, as plain words. Never show logos of companies that do not use INDX Watch.
5. **Features**: the four things it does (Define, Run, Decide, Delegate).
6. **For teams**: one tab per role, in step with the hero switch.
7. **Why now**: two-tone statement, then before/after rows.
8. **Agents** (dark band): conversations, the six skills, what only people do.
9. **Strengths**: bento with GitHub as the large card.
10. **Self-hosting**: the seven-step flow from branch to the team testing in the app (the same steps as the diagram in `docs/guides/self-host-cloudflare-from-github.md`), the one command `init --github`, a link to the guide. It is an ordered list, so it reads in order without CSS.
11. **Open source**: license, no cloud, where to host.
12. **Compare**, 13. **Get started**, 14. **FAQ**, 15. **Closing**, 16. **Footer**.

## Roles

The reader picks a role in the hero: developer, tester or QA, product manager. [`components/role.tsx`](components/role.tsx) keeps the choice in the URL (`?for=tester`, `?for=product`) and in `localStorage`. These parts follow it:

- the hero lead and buttons (`hero.lead`, `hero.primary`, `hero.secondary`);
- the demo, which jumps to that role's chapter (developer → Design, tester → Run, product → Ship);
- the For teams tabs.

The static HTML is the developer view, so search engines and readers without JavaScript get a complete page. Link to a role with `/?for=tester` or `/ja/?for=product`.

## Tokens

All in [`app/globals.css`](app/globals.css) §1; never hard-code a color in a component.

- **Type**: Geist Sans and Geist Mono (the `geist` package, self-hosted at build time), then Hiragino Sans / Noto Sans JP for Japanese. Display headings use `--t-display` with `--track-display` (−0.045em); Japanese headings override tracking to about −0.03em and line height to 1.2–1.3, because tight Latin tracking breaks kana.
- **Color**: one gray ramp (`--ink`, `--ink-2`, `--muted`, `--faint`, `--line`, `--line-strong`) and one accent, the product's blue (`--accent`). The accent is for kickers, links in context and the selected chapter, never for large areas. Status green and red appear only inside product visuals.
- **Surfaces**: `--bg` white, `--bg-subtle` for alternating sections, `--card` for cards. Borders are 1px hairlines; shadows are almost none, except the demo frame (`--shadow-frame`).
- **Radius**: 999px for buttons, chips and segmented controls; 16px for cards and the demo; 10–12px for inner panels.
- **Spacing**: sections use `--section-y` (88–136px); content is at most `--page` (1200px) wide with `--gutter` (24px, 16px on phones).
- **Dark mode**: follows `prefers-color-scheme`. The agents band is always dark.

## Primitives

From [`components/ui.tsx`](components/ui.tsx) and the classes in §3 of the stylesheet. Build new sections from these.

| Need | Use |
|---|---|
| Section heading | `<SectionHead kicker title lead layout="stack" \| "split" \| "center" link />` |
| "Learn more →" | `<TextLink href>` |
| Buttons | `.btn`, `.btn-primary`, `.btn-sm`, `.btn-lg` |
| A command to copy | `<CopyCommand command copy copied />` |
| Card | `.card` (hairline, 16px radius) |
| Checklist | `<ul className="checks">` |
| Two or three options | `.segmented` with radio or tab semantics (`<RoleSwitch>`) |
| Small mono label | `.caption` |
| Icons | `<Icon name>` (16px, 1.4 stroke); add new paths to `ui.tsx`, never an icon font |

## Copy

- Headlines say the outcome in one or two lines ("Know it works before you ship."). No exclamation marks, no "revolutionary", "seamless" or "supercharge".
- Muted body text puts its key phrase in `**bold**`, which renders in full ink (Supabase). One phrase per paragraph.
- Every claim must be true of the code today. Numbers and names come from [`examples/shop`](../examples/shop) (TC-3, TC-8, v1.2.0, Alex, Sam), never from made-up customers or metrics.
- Write Japanese as Japanese, not as a translation.

## The demo

[`components/demo/`](components/demo) draws the product on a fixed 1200 × 720 canvas that is scaled to the page (Linear's approach), so it is sharp at any width and costs no video bandwidth.

- Each chapter is a pure function of `ms`, the time since it started, so any frame can be rendered; the reduced-motion view shows the last frame and does not play.
- Inside `.dm` the colors are the web app's own tokens (`docs/design/tokens.css`), and the words are the web app's own strings (`packages/web/src/messages`). When the app's UI changes, change the demo with it.
- Terminal output is copied from the real tools: the Playwright list reporter, the `[indx-watch]` reporter lines, `iw status` and `iw approve`.
- It plays only while on screen, loops, pauses on request and never moves faster than a person can read.
- To add a beat, add a time to the chapter's `…Times` function and render from it. Move the pointer with `<Pointer target>` and a `data-target` on the element; scroll with `<ScrollView to>`.

## Checking a change

```bash
pnpm typecheck && pnpm build
pnpm preview    # http://localhost:3000 and /ja/
```

Look at the page at 1440 px and 390 px wide, in light and dark, in English and Japanese, and with each role (`?for=tester`, `?for=product`). Play each demo chapter to the end.
