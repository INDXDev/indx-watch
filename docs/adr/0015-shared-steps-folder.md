---
title: "0015. Shared steps live in their own top-level folder, `steps/`"
description: "Architecture decision record: Shared steps live in their own top-level folder, steps/."
---

# 0015. Shared steps live in their own top-level folder, `steps/`

- Status: accepted
- Date: 2026-11-25

## Context

Test cases repeat the same steps ("sign in", "add a product to the cart", "place the order"). Today each test case carries its own copy, so a change to the sign-in screen means editing every file, and nobody can see which test cases are affected. TestRail, Qase, Testmo and testomat.io all offer shared (reusable) steps. INDX Watch has one rule for what makes a result stale: the test case [version](./0006-content-hash-versions.md), a hash of the fields that define behavior. Shared steps must fit that rule without changing any version that exists today, and they must stay plain files in git ([ADR 0001](./0001-file-first-bundle.md)) that work in workspace mode too.

The bundle layout puts a definition under the item that owns it: test cases live in their use case's folder, use cases in their feature's folder. A shared step has no single owner: any test case in any use case may use it.

## Decision

A shared step is a file `steps/SS-<n>-<slug>.toml` at the top of the bundle, with the usual `id` and `key` (`SS-1`), a `title` and its own `[[steps]]`. A step of a test case (or of another shared step) may be `use = "SS-1"` instead of `instruction` and `expected`.

- **Expanded at load time.** `loadBundle` replaces each `use` with the steps of that shared step, so everything downstream (the model, the runner, the reporter, the web app, MCP) sees ordinary steps. Each expanded step carries `from` (the key the file named) and `fromFirst` in memory only, so the web app can show "from SS-1" and `writeDefinition` can put the single `use` back when it rewrites a test case (`iw approve`, `iw translate`).
- **The version covers the expanded steps.** The test case version hashes the expanded steps, without `from`, `i18n`, `checks` or guidance, exactly like written-out steps. Editing a shared step's instruction, expected result or evidence therefore makes the latest results of every test case that uses it stale ([concepts](../spec/concepts.md#versions-and-staleness)). A test case that does not use a shared step has the same version as before, and a test case whose step is replaced by an identical shared step keeps its version.
- **`iw check` owns the rules**: a `use` must name an existing shared step, and shared steps may not form a cycle (a shared step may use another one). Both are errors on the test case and on the shared step file.
- **Own folder, own key.** `SS` is a new key kind with the machine ID prefix `ss`. Files are named `SS-<n>-<slug>.toml` and found by that name, so workspace mode needs no new rule: `steps/` files are `file` records like any definition. `iw check --fix` renames a file whose name has the wrong key but does not renumber a duplicate `SS` key, because a `use` that names it cannot tell which of the two it meant.
- **Translations** of a shared step's steps live in the shared step file, like step translations in a test case; a test case never repeats them.

## Consequences

- One edit fixes every test case; `iw check` and the version rule show what that edit invalidates.
- A test case file alone no longer shows all its steps: tools that read the TOML directly (not through `loadBundle`) see `use` entries. The JSON Schema `schemas/v1/test-case.json` allows them.
- Editing steps in the workspace-mode web editor is refused for a test case that uses shared steps (the shown steps cannot be mapped back); the shared step file is edited in a working copy.
- The `steps/` name is taken in the bundle. A project that already has an unrelated `steps/` folder gets `unknown-file` warnings for files that do not start with `SS-`.
- Shared steps have no `status`: they decide no verdict. An AI-written one carries `origin = "ai"` and gets the same reviewer warning as a feature until `iw approve SS-n` records a person.

## Alternatives considered

- **Inline `include` table inside the test case** — copies the text and defeats the point.
- **A shared step as a fixture kind** — fixtures are data with their own version and files; steps are behavior and belong in the test case version.
- **Store the expanded steps in the test case file** — two sources of truth for the same text.
- **Nest shared steps in a feature folder** — a shared step is used across features.
