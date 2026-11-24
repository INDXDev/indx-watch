---
title: "Keep a fork up to date"
description: "Run your own fork of INDX Watch, follow its releases and take upstream changes safely."
---

# Keep a fork up to date

Fork when you need changes that [texts, theme and patches](./customize.md) cannot give you. A fork is yours to maintain: this page keeps that to a few steps.

## Set up

```bash
git clone git@github.com:<you>/indx-watch.git
cd indx-watch
git remote add upstream https://github.com/INDXDev/indx-watch.git
pnpm install
```

Make your changes on a branch (`main` of your fork is fine), as small commits. Do not touch the verdict, gate and status rules, signing and identity, or the secret scan: results from a fork that changed them cannot be compared with upstream's (the same [refused list](../spec/cli.md#iw-patch) as for patches).

## Take upstream releases

```bash
git fetch upstream --tags
git rebase v0.5.0        # or: git merge v0.5.0
pnpm verify              # lint, types, tests, build: the same checks upstream runs
```

Resolve conflicts, run `pnpm verify`, push. Do this per release, not per commit, and tag your own release (for example `v0.5.0-shop.1`) when it is good.

## Tell your project to follow the fork

In `.indx-watch/project.toml`:

```toml
[tool]
indx_watch = "0.5.0"
source = "github:<you>/indx-watch"
```

With `source`, `iw doctor` and `iw update` read the latest release from your fork's GitHub releases instead of the npm package, and `iw patch` fetches source from it. Without `source` they follow `INDXDev/indx-watch`. *(Not yet: today `iw patch` follows `source`, but `iw doctor` and `iw update` still read the npm package.)*

## Workflow template

Put this in your fork as `.github/workflows/upstream.yml`. Every week it merges the newest upstream tag into a branch and opens a pull request, so CI runs `pnpm verify` on it:

```yaml
name: upstream
on:
  schedule: [{ cron: "0 3 * * 1" }]
  workflow_dispatch:
permissions: { contents: write, pull-requests: write }
jobs:
  merge:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - run: |
          git remote add upstream https://github.com/INDXDev/indx-watch.git
          git fetch upstream --tags
          tag=$(git tag -l 'v*' --sort=-v:refname | head -1)
          git switch -c "upstream/$tag"
          git merge --no-edit "$tag" || { echo "conflicts: merge $tag by hand"; exit 1; }
          git push origin "upstream/$tag"
          gh pr create --fill --base main --head "upstream/$tag" || true
        env: { GH_TOKEN: "${{ github.token }}" }
```

When the merge conflicts the job fails and says which tag to merge by hand.

## Related

- [Customize INDX Watch safely](./customize.md)
- [Self-host on Cloudflare](./self-host-cloudflare.md)
