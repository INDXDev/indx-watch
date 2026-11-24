---
title: "0002. Definitions sync through git; results sync through a result store"
description: "Architecture decision record: Definitions sync through git; results sync through a result store."
---

# 0002. Definitions sync through git; results sync through a result store

- Status: accepted
- Date: 2026-11-19

## Context

Definitions (use cases, test cases, fixtures, plans) benefit from review, history and blame, and change at human speed. Results (runs, evidence, CI uploads) are produced continuously by many writers, are append-only, include binaries, and must be visible within seconds to people without git.

## Decision

- **Definitions** live in git. INDX Watch never commits or pushes for the user.
- **Results** are records and blobs in a **result store**: a local folder or any S3-compatible bucket, optionally fronted by a hosted INDX Watch server. `iw sync` copies records both ways.
- **Workspace mode** (`[store] mode = "workspace"`, v0.2) is for teams without git: definition files are also synced through the store as versioned file records, Drive-style. Conflicting edits keep both versions (`<name>.conflict-<sha8>.toml`) and `iw check` fails until a person resolves them. See [sync.md](../spec/sync.md#workspace-mode-v02).
- For the hosted UI to show definitions in git mode, `iw sync --snapshot` (run by the GitHub Action on the default branch) publishes a **bundle snapshot** record: a tarball of the bundle, keyed by commit.

## Consequences

- No merge logic for definitions in git mode: git does it.
- The hosted app is read-mostly for definitions; it writes runs, judgements and waivers.
- Two places to look; `iw status` shows both (git state of the bundle and store sync state).

## Alternatives considered

- **Everything in the store** — loses PR review of test cases, the key reason fixtures and specs should live next to code.
- **Everything in git** — see ADR 0001.
