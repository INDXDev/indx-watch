---
title: "Customize INDX Watch safely"
description: "Change texts, colors and report branding with plain files, or keep your own patches, and still update INDX Watch."
---

# Customize INDX Watch safely

You can make INDX Watch fit your team in three levels. Each level is more work and more to maintain than the one before, so use the lowest that does the job. All of them live in your repository, in git, and none of them stops you from running `iw update`.

| Level | What you change | How | Survives `iw update` |
|---|---|---|---|
| 1. Texts, colors, report | Wording of the app, accent color and fonts, title, logo and footer of reports | Files in `.indx-watch/ui/` and `[report]` in `project.toml` | Always |
| 2. Fork | Anything, in your own copy of the code | [Fork guide](./fork.md) | You merge upstream yourself |
| 3. Patches | Small changes to the app or server | `iw patch` | `iw update` checks them first and stops when one no longer applies |

Some things cannot be changed at any level: how a verdict, the release gate and a test case's status are computed, how records are signed and who is who, and the secret scan. A change there would make your results incomparable with everyone else's, so `iw patch` refuses it and a fork is on its own ([why](../spec/security.md#patched-servers)).

## Level 1: texts, colors and report {#level-1-texts-colors-and-report}

Everything here is optional. Without the files, nothing changes. Formats and every rule are in the [bundle format](../spec/bundle-format.md#customizing-v05).

### Change a text

Find the key in `packages/web/src/messages/en.json` (the English texts of the app; `ja.json` has the Japanese) and put your wording in `.indx-watch/ui/messages.en.json`:

```json
{ "nav.tests": "Checks" }
```

Add `messages.ja.json` for the Japanese app. Keep `{placeholders}` as they are, and write plain text without HTML. `iw check` tells you about a misspelled key.

### Change colors and fonts

`.indx-watch/ui/theme.toml`:

```toml
[light]
accent = "#0b6b50"
accent-text = "#ffffff"

[dark]
accent = "#6fd3b0"
accent-text = "#06231a"
```

Only a short list of tokens can be set (accent, background, text and border colors, fonts, corner radius). Status colors stay as they are, so "failed" always looks like failed. `iw check` warns when your text and background are hard to read together.

### Brand reports

```toml
[report]
title = "Shop QA"
footer = "Shop QA team"
logo = "ui/logo.png"
```

Put the logo in `.indx-watch/ui/`. It appears at the top of HTML reports; the title and footer appear in Markdown reports too.

### See it

Run `npx indx-watch serve`: the app loads your files. On Cloudflare they are part of the published bundle, so a push (or `iw push`) is all it takes.

## Level 2: your own fork

When the files above are not enough, fork the repository and keep it current with upstream. Short steps and a workflow template: [fork guide](./fork.md).

## Level 3: patches {#level-3-patches}

A patch is a small, reviewed change to INDX Watch's own source that you keep next to your tests, in `.indx-watch/patches/`. It is made against one upstream version (`[tool] indx_watch`), and you can ask in advance whether it still applies to the next one.

You need `git` and `pnpm` installed.

```bash
# 1. Prepare the upstream source at your pinned version and edit it
npx indx-watch patch create shorter-nav
#    (edit files under .indx-watch/cache/upstream/, then run the same command again)
npx indx-watch patch create shorter-nav

# 2. Build the patched app
npx indx-watch patch apply

# 3. Deploy it (iw deploy uses the patched build when patches exist)
npx indx-watch deploy

# Before updating INDX Watch: do my patches still apply?
npx indx-watch patch check --to 0.5.0
```

`iw update` runs `patch check` for you and stops while a patch fails, naming the files that conflict. Then rebase the patch on the new version (run `iw patch create` again from the new source) or drop it.

### What other people see

A patched server says so: its version reads `0.5.0+p.ab12cd34 (patched)` in `/healthz`, the app, MCP and report footers, and the records it writes carry the same marker. The marker is only a label for readers; it does not change whether results count. Details: [patched servers](../spec/security.md#patched-servers).

## Related

- [Fork guide](./fork.md)
- [Self-host on Cloudflare](./self-host-cloudflare.md)
- [`iw patch`](../spec/cli.md#iw-patch)
