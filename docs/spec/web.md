---
title: "Web app"
description: "The web app screens, List and Focus views, the manual runner, upload and test data."
---

# Web app

The web app is how testers, leads and customers use INDX Watch without a terminal. It runs locally (`iw serve`) and hosted (`iw deploy`) from the same code. This page owns the app's information architecture, screens, interaction patterns and copy rules. The HTTP API is in `packages/server/src/contract.ts`. Visual references are in [design/](https://github.com/INDXDev/indx-watch/blob/main/docs/design/index.html); where they differ from this page, this page wins.

## Principles

1. **One question per screen.** Home answers "can we ship, and what do I do next?". A test answers "what do I do, and what should I see?". Detail sits behind a click, not on the first screen.
2. **Two ways to look at every collection.** Every collection screen has a **List** view, which is dense and lets you scan, sort and compare. It also has a **Focus** view: one item per screen, in plain language, that you page through with ← / → or a swipe. See [List and Focus](#list-and-focus).
3. **Every result has a face.** Every run, review and upload shows who made it, how that identity was established, and when ([Identity](#identity)).
4. **The terminal is one click away.** Every screen can show the CLI commands that do the same thing, ready to copy ([CLI panel](#cli-panel)). This works like the "Code" button on GitHub or the CLI hint on Vercel.
5. **Files in, files out.** Definitions go in like files into a shared drive: drag a folder or a file onto the page ([Upload](#upload)). They come out with one command ([Clone](#clone)).
6. **Both languages, always.** UI strings and content are shown in the chosen language. A missing or outdated translation falls back to the source text, with a visible marker ([Languages](#languages)).

## Layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ✓ INDX Watch / Shop   Home  Tests  Activity  Test data  Report   [v1.2.0 ▾]  │
│                                       [⇪ Upload] [>_ CLI] [文A 日本語] (A) ▾ │
├──────────────────────────────────────────────────────────────────────────────┤
│                                 screen                                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

| Element | Behavior |
|---|---|
| Brand / project | Links to Home. |
| Navigation | Home · Tests · Activity · Test data · Report. Below 720 px it becomes a bottom tab bar. |
| Scope | One control: the release, with the environment as a second line in its menu. The default is the current release and all environments, like `iw status`. *(v0.4)* When you own at least one feature ([My features](#my-features)), the menu also has **My features / All features**, and the control's second line says "My features" while that is on. |
| **Upload** | Opens the upload dialog ([Upload](#upload)). Hidden when the server cannot write. |
| **CLI** | Opens the CLI panel ([CLI panel](#cli-panel)). Below 600 px it shows only `>_`. |
| Language switch | One button named after the other language in that language ("日本語" in English, "English" in Japanese) switches the UI and content language at once. The choice is kept in the browser (`localStorage`, `indx-watch.locale`). Below 600 px it shows only its icon. |
| Avatar menu | Shows who you are and how that was verified, a "Not you?" link where allowed ([Identity](#identity)), the language as a list, the theme (auto, light, dark), and the sync state. |

Problems from `iw check` appear as one quiet line under the bar ("3 problems in the test files"), which expands on click. They never push the screen down by more than one line.

## Screens

| Route | Screen | List view | Focus view |
|---|---|---|---|
| `#/` | Home | — | — |
| `#/tests` | Tests | Feature → use case → criterion → test tree with status, priority, last run and who ran it | One test case per screen: the [test case page](#test-case-page) with "Run manually" |
| `#/tc/<TC>` | Test case | — | The [test case page](#test-case-page), with ← / → over the current list |
| `#/tc/<TC>/run` | Manual runner | — | The same test case page with the [runner](#manual-run-in-place) already open |
| `#/activity` | Activity | Runs, reviews and uploads, newest first, with who, verdict, test, release, environment and time | One run per screen with its steps and evidence. "Review" opens a queue of `needs_review` runs |
| `#/runs/<run>` | Run | — | The Focus card for that run |
| `#/fixtures` | Test data | Fixtures by kind, with the tests that use them | One fixture per screen with its values or preview |
| `#/uploads` | Uploads | Bundle snapshots, newest first: who uploaded, when, from where (commit or browser), file count, "current" marker, download | — |
| `#/report` | Report | — | — |

The List / Focus switch sits at the top right of each collection screen. Each view has its own URL, so a link opens the same view: `#/tests` and `#/tc/TC-3`, `#/activity` and `#/runs/<run>`, `#/fixtures` and `#/fixtures/FX-1`. `?f=open` and `?f=flaky` (Tests) and `?f=review` (Activity) carry the filter into Focus.

### My features

*(v0.4, [feature owners](./concepts.md#feature-owners))* `GET /api/project` returns `owns`: the keys of the features whose `owners` name the viewer (their actor ID, or `group:` of one of their Access groups when the hosted app has roles). When `owns` is not empty, the app starts in **My features**: it asks `GET /api/status` and `GET /api/specs` with `mine=1`, and the server answers from the model narrowed to those features (`ownedModel()` in core), so Home (hero, cards, queue, Release details), the Tests tree, Focus and the Focus runner's session show only the viewer's features. **All features** in the scope menu drops `mine=1`; the choice is kept per viewer in the browser (`localStorage`, `indx-watch.features`). A viewer who owns nothing sees everything and no switch; when `owns` changes (for example after the viewer changes their local identity), the app picks the default again. A test case opened in Focus outside the viewer's features gets no prev/next. The Tests tree shows each feature's owners next to its title. "My features" is a view: test case pages, runs and reports are not narrowed, and the server ignores `mine` elsewhere.

### Quarantine

The Tests filter has a third option, **Flaky** (`#/tests?f=flaky`). It replaces the tree with a flat list of the test cases that have a [flake rate](./concepts.md#flaky-tests) in the current scope, highest rate first (ties: key). Each row shows the status badge, the key, the title in the chosen language, the rate as a percentage and "n of m runs". The Tests search box narrows the list by key or title. With no flaky test case (or no match) it says so. The view only reads `flaky` from the API; it never hides a test case from the gate or changes a verdict, so a quarantined test still counts until it is fixed. Focus pages through the same list.

### Home

Home is calm. It has four blocks, in this order:

1. **Verdict hero.** The release name and title, and one sentence: "Ready to ship", "Not ready: 2 of 8 checks fail" or "Nothing to gate yet". A progress bar shows passing tests out of the `ready` tests in scope, the ones `counts` and the gate count; drafts are named apart ("7 of 8 tests pass · 2 drafts not counted until approved"). It has one primary button and one secondary:
   - The primary button is **Start testing (n left)**. It opens the Focus runner over the open items: assigned to you first, then unassigned, then the rest.
   - The secondary button is **Share report**.
2. **Four summary cards.** Each card links to the screen that explains it:
   - Passing (`7 / 8`, `ready` test cases only)
   - Needs attention (fail + needs review + blocked)
   - Criteria covered (`8 / 9`)
   - Last upload (who, when); without an upload, **Latest result** (who, when), since results also arrive through sync and CI
3. **Your queue.** Open plan items assigned to you, then unassigned open items, then everything else. At most 5 rows, with "See all" for the rest. Each row shows status, key, title in the chosen language, a **Draft** chip for a draft test case, and Run, Review or Inspect.
4. **Recent activity.** The last 5 runs, reviews and uploads, each with an avatar, name, verb and time ("Alex passed TC-3 · 5 min ago").

Gate checks, counts by status and the use case table move to **Release details**, a disclosure at the bottom of Home. Their content does not change ([concepts](./concepts.md#readiness-gate)).

**Assignee board** *(v0.5, [assignment](./concepts.md#assignment-and-automation-mix))*. The plan in Release details opens with a board: one row per assignee with their item count, a progress bar split by status (done, review, blocked, to do; each segment has a text count, so colour is never the only signal) and, last, the unassigned items. Below it a line shows the **automation mix**: how many items people, CI and agents run (`3 people · 4 CI · 1 agent`). The item table has a checkbox per row and an **Unassigned only** filter. What a person can do depends on their [role](./security.md#roles) (without roles, and on `iw serve`, everyone is a lead):
- A **lead** selects rows and chooses **Assign selected** with a person (the plan's assignees, a typed email, `ci` or `agent:<name>`) or **Unassign**, or opens **Split…**: weights per assignee, an "Only unassigned" box and a preview of the proposed changes (`dry_run`), then **Apply**.
- A **tester** sees **Take** on an unassigned row and **Give back** on a row assigned to them; nothing else.
- Viewers and customers see the board and no buttons. In git mode (definitions come from git) the board is read-only and says to run `iw assign`; writes need workspace mode, like [edits](#editing-in-workspace-mode).
- Saving calls `POST /api/plans/:key/assign` ([contract](#editing-in-workspace-mode)): the same write path as customer invites, a `file` record of the plan (workspace mode) or the plan file on `iw serve`, always through `formatToml()`. Agents get 403.

**Drafts.** A draft test case ([states](./concepts.md#test-case-use-case-fixture)) carries a **Draft** chip wherever it is listed: Home's queue, the Tests tree and Flaky list, the plan in Release details, a customer's Home and the test case page. A criterion whose only test cases are drafts reads **No approved test** (the `uncovered` status).

**Empty states.** A hosted app with no snapshot yet shows a full-page drop zone instead of an error. It reads "Drop your `.indx-watch` folder here", with the matching CLI command next to it (`npx indx-watch push`). A project with no test cases (as `iw init` leaves it) shows, on Home under the verdict and on Tests, **No test cases yet** with the two ways to start: ask your coding agent ("Set up testing for this repo", or `/iw-setup` in Claude Code and `$iw-setup` in Codex), or run `npx indx-watch new uc …` and `new tc …` from the terminal, each ready to copy, and a link to the [quickstart](../guides/quickstart.md). Home then has no progress bar, Start testing or Share report.

### Customer view

*(v0.3, [customer UAT](./security.md#customer-uat))* For a `customer` (`role` in `GET /api/project`), Home is a focused page: the verdict hero over their items, then **Your acceptance tests**, every plan item assigned to them grouped by plan, each row with its status, key, title in the chosen language, due date and **Run** (or **Inspect** for a failed run), which opens the Focus runner over that item and the rest of the list (a test case assigned in two plans appears once in that queue). The summary cards, Recent activity and Release details are not shown. The runner is the normal manual runner; a run is recorded with the customer's Access identity. With nothing assigned the page says "No tests are assigned to you yet".

### Visual baselines

*(v0.2)* In the run viewer, every PNG screenshot (in a step or in other evidence) that is the current [approved baseline](./concepts.md#visual-baselines) of its test case carries a "Baseline" chip. The others have an **Approve as baseline** button. It posts `POST /api/runs/<run>/baselines` with the screenshot's SHA-256; the server writes a `baseline` record with the request's identity and refuses agents and CI actors (403). The chip appears at once. Approving never changes the run's verdict; `iw judge <run> --visual` compares later runs with the new baseline. `visual` judgements show their `diff_ratio` as a percentage next to the verdict.

### Open as GitHub issue

*(v0.5)* The run viewer and the [test case page](#test-case-page) show **Open as GitHub issue** when `GET /api/project` has `github.repo` (`[github] repo`, else the working copy's remote; never for customers). It fetches `GET /api/issue?ref=<run or TC>` and opens the prefilled new-issue page in a new tab, so a person reads the text and submits it; the app sends nothing. Beside it, **Paste the issue URL** takes the URL of the issue they created and stores it in the test case's `links`: through `PATCH /api/test-cases/:key` in workspace mode; in git mode the app shows the command `iw issue TC-n --link <url>` to run instead. Linked issues show as **Related issue #42** (a link to GitHub) on the test case page, the run viewer (the test case's links) and the use case. Only http(s) links are rendered.

### Reviews

The run viewer ends with a review form: **This run needs a person's decision** on a `needs_review` run, else **Add a review**. A review appends a `judgement` and never edits the run. Under the [decision policy](./concepts.md#decision-policy) (rule 1) the latest human judgement decides, whoever wrote it, so on your own run the form reads **Change your verdict** and says that your review counts like anyone else's and that a second opinion needs a teammate.

### List and Focus

**List** is a table or tree. Rows are links; every row shows a status badge, the key, the title in the chosen language and the last actor. Filters (status, priority, "assigned to me") sit above it, along with a text filter that matches key or title in any language.

**Focus** shows exactly one item, centered, at a readable width (at most 720 px):

- **Header.** The position ("3 of 9"), the key, the status badge, and the title in large type.
- **Body.** The content in plain language. For a test case: the [test case page](#test-case-page).
- **Footer.** ← Previous · primary action · Next →.
- **Moving between items.** `←` / `→` keys, horizontal swipe on touch screens (at least 60 px, mostly horizontal), or the footer buttons. Each item has its own URL, so the browser's Back button steps back through the items.
- **Order.** The order and filters of the List view the user came from. "Open" filters (not passing) are kept, so stepping through them works like a queue.

The Focus **runner** turns a series of tests into a session (`#/tc/<TC>/run?session=TC-3,TC-6`). Each test case opens with its [runner open in place](#manual-run-in-place); ← / → and the footer step through the session, and after you save a result the next open test of the session opens the same way, without returning to Home. A bar above the page shows the session's progress ("Test 2 of 5"). Leaving a test case whose runner holds unsaved step results asks first. Keyboard shortcuts while the runner is open:

| Key | Action |
|---|---|
| `P` / `F` / `B` / `S` | Mark the current step pass / fail / blocked / skipped (`P` also ticks its checks and moves on) |
| `N` | Focus the step's note field |
| `⌘V` / `Ctrl+V` | Paste a screenshot into the step |
| `→` / `←` | Next or previous test, when no field has focus |

### Test case page

*(v0.4)* A test case reads from top to bottom, so that a person who has never seen the app can run it from this one page. The content comes from the test case's [guidance fields](./bundle-format.md#specsfeatuctc-n-slugtoml); a test case without them shows the blocks it has.

1. **Header.** Key, status, priority, mode and the title, with the Edit button (workspace mode) and the AI draft notice.
2. **What this tests.** The `purpose`; the feature and use case the test case belongs to; and the criteria it covers, in plain words, each with its status.
3. **Before you start.**
   - **Open.** A link to the environment's `base_url` followed by `start` (`http://localhost:4173` + `/cart`), which opens in a new tab, with `start_note` under it. Without `start` the link is the `base_url`. The environment is the one in scope, else the project default; its guide sits under a disclosure.
   - **Test data.** One card per fixture the test case uses: key, title, the fixture `note` (what the data is for) and what to do with it, from `use`:

     | `use` | The card says | It shows |
     |---|---|---|
     | `download` | "Download this file" | A download button per file |
     | `upload` | "Download this file, then attach it where a step asks for it", then "Step N: …" for every step whose instruction mentions the fixture key | A download button per file |
     | `enter` | "Type or paste these values where a step asks for them" (with the steps that use them, as for `upload`) | The selected row's values, each ready to copy |
     | `seeded` | "Already in the app. Nothing to do." | — |

     Without `use`, the card shows the values and files the fixture has. An account fixture shows the username and says the password is in the team's secret store. Download buttons fetch the file from `GET /api/blobs/<sha256>`, which serves a fixture file whether it is stored in git or as a blob pointer.
   - **Preconditions** as a checklist: one box per sentence or line. The ticks help the tester and are not recorded.
4. **Steps.** Numbered, each with its instruction, its expected result and its `checks` as a list of boxes to tick ("The discount line shows "-4.00"."), in the chosen language.
5. **Result.** The status in scope and the last run (who, verdict, when), then the Details disclosure: covered criterion keys, metadata and the run history.

*(v0.5)* **Shared steps.** A step that comes from a [shared step](./bundle-format.md#shared-steps) is shown like any other, in the chosen language (its translation is the shared step's), with a small **from SS-1** chip after the instruction. The runner, the run viewer and reports number it by its place in the test case. In workspace mode the editor shows a note instead of the step fields for a test case that uses shared steps (title and priority can still be saved, and the server refuses a `steps` edit with 400); edit the shared step file in a working copy.

#### Manual run in place

**Run manually**, in the Focus footer, opens the runner on the same page: the URL does not change, the blocks above stay where they are, and the Steps block turns into the runner.

- **One step at a time.** The current step shows its instruction, expected result, its `checks` as checkboxes, the result buttons (Pass, Fail, Blocked, Skip), a note and screenshots (upload or paste). Recorded steps collapse to one line with their result, and a click reopens one. Later steps are not shown until you get there.
- **Checks.** Ticking every check suggests Pass; choosing Pass (or pressing `P`) ticks every check, and unticking one afterwards drops the Pass, so the step needs a result again. A Fail or Blocked step with an unticked check asks for a note ("Which check did not hold, and what did you see?").
- **Next** records the step and opens the next one. It stays disabled until the step has a result, and the note it asks for. After the last step the **Result** block opens with the verdict suggested from the steps, the reason (required for every verdict except pass) and **Save result** (**Save and next** in a session).
- **What is recorded.** For each recorded step: its status, note, screenshots and which checks were ticked (`checks`, booleans in the order of the step's source `checks`, [sync.md](./sync.md#run-record)).
- **Cancel** closes the runner without saving and keeps the page.
- **Sessions.** Pressed in the Focus view, Run manually runs the rest of that list as a session: the session bar appears, ← / →, swipes and the footer step through the session, and after saving, **Save and next** opens the next test case with its runner open. Without a next test case, saving opens the run viewer.
- **Unsaved work.** While a step has a result, a tick, a note or a screenshot, moving to another page (keys, swipe, links, Back) asks first; closing the tab asks through the browser.

#### BDD style

*(v0.4)* A test case with [`style = "bdd"`](./bundle-format.md#specsfeatuctc-n-slugtoml) reads as a scenario, in the chosen language (English Given / When / Then / And, Japanese 前提 / もし / ならば / かつ):

- The header has a **Scenario (BDD)** chip.
- **Before you start** opens with **How to run this scenario**, a disclosure that is open on every visit: start from the Given state and tick each line once it is true, and if you cannot get there the result is Blocked, not Fail; do exactly the When action and nothing else; compare what you see with the Then sentence and tick each And line that holds, with quoted text as written; everything matches is Pass, anything different is Fail with what you saw and a screenshot.
- The preconditions checklist is headed **Given: the starting state**; its first line has a **Given** label and the next ones **And**.
- The Steps block is headed **Scenario (n)**. Each step's instruction has a **When** label, its expected result **Then** instead of **Expected**, and each check **And**. The runner shows the same labels; what it records does not change.
- In workspace mode the editor labels the step fields **When** and **Then** and says how to write them.

`#/tc/<TC>/run` opens the same page with the runner already open, without a session unless the URL has one (`?session=`). The run viewer lists each step's checks with ✓ or ✗, worded from the current test case in the chosen language; when the step now has a different number of checks than were recorded, they read "Check 1", "Check 2", ….

### Insights

*(v0.5, T-524)* **Insights** (`#/insights`, the nav item after Report) shows how the project moves, not whether to ship. It is calm: five cards, no filters beyond the scope menu's release, no animation. The server answers `GET /api/insights?release=` from `insights()` in core ([definitions](./concepts.md#insights)); the screen only draws.

1. **Pass rate and coverage by release**: one line chart (two lines, 0–100 %) over the releases, oldest to newest; the lines are labelled at their last point, not in a legend.
2. **Progress by assignee** and **by feature**: one horizontal bar per row, split into done, in review, blocked and to do (feature rows: pass, fail, open), with the counts written at the end of the row. Unassigned has its own row.
3. **Median manual run time**: the latest value as a large number ("1 min 35 s") with the samples behind it, and the median per release in its numbers table.
4. **Flaky test cases by release**: bars with the number of flaky test cases and the ready total.

Every chart is plain SVG or CSS drawn with the theme tokens (`--accent`, `--pass`, `--fail`, `--surface-2`); colour is never the only carrier (rows carry numbers, lines carry end labels). Each chart is followed by its numbers as a real `<table>` inside "Show the numbers" so screen readers and keyboard users get the same data; the SVG itself has a `role="img"` and a one-sentence `aria-label`. A project with no results shows "Nothing to show yet" instead of empty axes. Every string is in `en.json` and `ja.json` under `insights.*`. Customers do not get the screen (the route answers 403 for the `customer` role).

### Report

Home's **Share report** opens `#/report`: a preview of the server-rendered HTML report with the audience (customer by default), the language and the plan (or the whole release), plus "Open HTML" and "Download Markdown".

*(v0.2)* On the hosted app, a person signed in through Cloudflare Access (`can.share` in `GET /api/project`) also sees **Share links** below the preview ([reports.md](./reports.md#share-links)):

- **Create link** with an expiry of 7, 30 or 90 days freezes the report exactly as previewed (same audience, language and plan) and shows its URL once, with a copy button and a note that it cannot be shown again.
- A table of the existing links, newest first: created (who, when), audience, release or plan, expiry, state (active, expired, revoked) and opens. Active links have **Revoke**, which asks for confirmation.

Elsewhere the section is not shown.

## Identity

Every record carries an `actor` ([security](./security.md#identity)). The app shows that actor everywhere a result appears: an avatar (initials, with a color derived from the ID), the name, and a small "verified" mark for identities that come from Cloudflare Access, a trusted proxy header or GitHub OIDC.

**Unverified** *(v0.2)*: when a record claims a verified `via` but has no valid signature ([signed records](./security.md#signed-records)), the ✓ is replaced by an amber "unverified" chip whose tooltip says the record may have been written directly to the store. This applies to runs (lists, Activity, Home, the run viewer), judgements in the run viewer, and uploads. The server computes the flag; the app never verifies signatures itself.

**"Who's testing?"** A local server runs as the machine's git user. In a shared or cloud workspace that may not be the person at the browser. In that mode the avatar menu offers "Not you?". It opens a dialog asking for a name and email, stored in the `iw_tester` cookie (one year, `SameSite=Strict`, `Path=/`). The server then records writes as:

```json
{ "kind": "human", "id": "sam@shop.test", "name": "Sam", "via": "browser" }
```

- `via = "browser"` is self-asserted, like `git` and `env`. Reports show it, and the v0.2 `gate.require_verified_human` option excludes it.
- The cookie is honored only when the server has no verified identity for the request: `iw serve` without `--identity-header`. Behind Cloudflare Access, a trusted identity header or on a *(v0.5)* read-only public deploy the cookie is ignored, and "Not you?" is not offered.
- Agent detection does not apply to the cookie. Agents must not use the browser to review or waive ([agents](./agents.md)), and the skills say so.
- The server validates the cookie: `id` is an email or a name of 1 to 80 characters, and `name` is at most 80 characters. Anything else is ignored, and the default identity is used.

**Roles** *(v0.3)*: on a hosted app with [roles](./security.md#roles), the avatar menu shows the identity's role ("Role: customer (assigned items only)"), and the app hides what the role cannot do, from `can` in `GET /api/project`: without `can.run` (viewers) the Run, Start testing and Run manually buttons and the queue's Run actions; without `can.review` (viewers, customers) the review form; without `can.approve` (all but leads) "Approve as baseline"; without `can.upload` the upload drop zone; without `can.share` the Share links section. A customer's app shows only their assigned items, because the API returns nothing else. Hiding is a convenience: the server refuses these requests anyway.

**Read-only demo** *(v0.5)*: on a [public deploy](./security.md#public-deploys) (`readOnly` in `GET /api/project`) every visitor is an anonymous viewer, so the app hides the same actions and shows a notice under the top bar: "This is a read-only demo. Install INDX Watch to run tests: `npx indx-watch init`".

### Version notice

*(v0.5)* When `GET /api/project` has `server.pinned` (the project's `[tool] indx_watch`) and `server.outdated` (the running `server.version` is older; both sent to leads only), leads see one quiet line under the top bar: "This app runs 0.1.2; the project pins 0.1.3. Run `iw deploy`." (on `iw serve`: "Restart `iw serve` with that version."). It is computed from data the page already has: there is no outbound request, other roles never see it, and a project without `[tool]` or a server that is not older shows nothing. The comparison is one function, `compareVersions()` in `@indx-watch/core`, used by the server and `iw doctor`.

## CLI panel

The **CLI** button opens a panel with the commands that match what you are looking at, each with a copy button. The commands use the real URLs of this server and store:

| Tab | Command | When shown |
|---|---|---|
| Clone | `npx indx-watch clone <url>` | Always. `<url>` is this hosted app, or the `[store].url` locally |
| Upload | `npx indx-watch push`; *(v0.5)* on a hosted app in git mode `npx indx-watch deploy` and `npx indx-watch pull` instead | Always |
| Run | `npx indx-watch record TC-3 --verdict pass` | On a test case |
| Playwright | `IW_REPORTER=1 npx playwright test --grep @TC-3` | On a test case with automation |
| Report | `npx indx-watch report --release v1.2.0 --format html` | On Home and Report |
| Serve | `npx indx-watch serve` | Always |

Without a store (local only), Clone shows `git clone` advice instead, because the definitions are files in the repository.

## Editing in workspace mode

*(v0.2)* In [workspace mode](./sync.md#workspace-mode-v02) (`[store] mode = "workspace"`) definitions live in the store, so the app edits them; in git mode they are edited as files and reviewed in pull requests, and the app has no editor.

- **Test case.** An **Edit** button on the test case screen turns the title, priority and steps (instruction and expected result; add and remove steps) into a form. **Save** sends only the fields that changed (`PATCH /api/test-cases/:key`); the server applies them to the current file, writes it with `formatToml()` and appends a `file` record whose parents are the current heads, attributed to the request's verified identity. So two people editing different fields both keep their edits; a later save of the same field replaces the earlier one, while two saves made from the same heads (at the same moment, or on two servers before a sync) are concurrent edits and merge with a conflict file ([sync.md](./sync.md#workspace-mode-v02)). Invalid input (an empty title or step) is refused with the reason, and nothing is written; a save that changes nothing appends no record (the answer has `file` but no `record`).
- **Agents** (an agent identity, e.g. `/mcp` or `iw serve` under a coding agent) can save only drafts: the server marks their edit `origin = "ai"`, `status = "draft"` with an `[ai]` table and drops `approved_by` and `approved_version`, so a person approves it again ([security](./security.md#identity)).
- **Roles.** On a hosted app with [roles](./security.md#roles), only a `lead` edits definitions (`can.edit` in `GET /api/project`); the Edit button is hidden for testers, viewers and customers, and the server refuses their `PATCH` with 403 before reading the test case, so a customer cannot reach unassigned items through it. Without roles, and on `iw serve`, everyone is `lead`.
- On `iw serve` the file in `.indx-watch/` changes at once; the next `iw sync` publishes nothing new for it. Elsewhere the edit appears after the next sync.
- Conflict files from concurrent edits show in the problems banner (`workspace-conflict`) until someone resolves them in a working copy. While a test case has a conflict file, saving it is refused (409), because the edit would silently drop the other value.
- *(v0.5)* Uploads work in workspace mode too: each changed file becomes a `file` record ([Upload](#upload)).

Use cases and plans are edited in a working copy in this version (fixtures on the [Test data](#test-data) screen); only a plan's assignees change in the app, through the [assignee board](#home) (`POST /api/plans/:key/assign`) and customer invites (`POST` / `DELETE /api/plans/:key/invites`, [customer UAT](./security.md#customer-uat)), which append a `file` record for the plan the same way.

## Upload

You can upload definitions in three ways:

- with the **Upload** button
- by dropping files anywhere on Home, Tests or Uploads; a full-window overlay says "Drop to upload test files"
- with `iw push` from a terminal

**What can be dropped.** A folder that contains `project.toml` replaces the whole bundle. Single files of any type are merged into the current bundle:

- A file whose `id` matches an existing entity replaces that entity's file.
- A new test case goes into the folder of the use case whose criteria it covers.
- A new use case goes into the folder of its feature.
- A file that is not TOML and has the name of exactly one bundle file replaces that file.
- *(v0.5)* Any other file that is not TOML (a PDF, an image, a spreadsheet, a CSV, …) becomes **test data**: a new draft fixture `fixtures/FX-n-<slug>/` of its own, so nobody has to write TOML. Its title is the file name without the extension; a CSV with a header, or a JSON array of objects, becomes a `dataset` whose `row_key` is the first column, anything else a `file` fixture. A file larger than `[fixtures].inline_max_bytes` becomes a [pointer](./bundle-format.md#fixtures) with its blob in the store, when the project has a `[store]`; without one it stays in the folder.
- A TOML file that fits none of these is listed as "can't place: drop the whole folder instead".

**Preview first.** The dialog lists every file as added, changed or unchanged. It runs `iw check` (including the secret scan) on the result. Errors block the upload; warnings are shown. Nothing is written until you press **Upload n files**.

**What an upload does.**

- **Hosted:** it publishes a new bundle snapshot, as `iw push` does, attributed to you. The hosted app switches to it at once. *(v0.5)* In git mode the snapshot keeps the `commit` of the one it builds on and lists the files it changed as `unsynced` (not in git yet). The next `iw deploy` from the repository merges them in rather than dropping them, and `iw pull` brings them into a working copy to commit ([data flow](./sync.md#data-flow-and-conflicts)); `iw push`, `iw deploy --force` and CI's `iw sync --snapshot` still replace them.
- *(v0.5)* **Workspace mode** (hosted or local): every changed file is a `file` record, and a removed one a `deleted` version, as in [the editor](#editing-in-workspace-mode). The store is the source of truth: everyone sees the change at once, and `iw sync` writes it into every working copy ([sync.md](./sync.md#workspace-mode-v02)).
- **Local:** it writes the files into `.indx-watch/` as uploaded (and removes the files a whole-folder upload no longer has). You then review and commit them with git like any other edit.

**Uploads screen.** It lists snapshots from `bundle` records: who, when, from where (a commit, or "browser upload"), file count, *(v0.5)* how many files are not in git, and the current one. Each row can be downloaded as a `.tar`.

### Sync status

*(v0.5)* On a hosted app in git mode (`definitions: "git"` in `GET /api/project`), the Uploads screen starts with a **Sync status** card, so nobody has to guess what is where ([data flow](./sync.md#data-flow-and-conflicts)):

- **What is shown:** the commit and branch of the current snapshot, who published it and when.
- **What is not in git:** when the snapshot has `unsynced` files, a warning lists them (up to 20) and says how they get into the repository: `npx indx-watch pull` in a working copy, review, commit, `git push` (with a copy button). Otherwise one line says everything shown is in git, with the commit.
- **How changes travel:** a table of the four kinds of change (test files edited in the repository; uploads and test data edited in the app; results, reviews and secrets recorded in the app; results from Playwright, CI or `iw record`), when each shows up in the app and when (or whether) it reaches git.
- **Conflicts:** one line on what happens when two people change the same file.

The commands under it are `npx indx-watch deploy` and `npx indx-watch clone <url>`. Anyone who can upload also sees one quiet line under the bar while the current snapshot has `unsynced` files ("2 changes made in this app are not in git yet. What to do"), linking here.

## Test data

*(v0.5)* The Test data screen (`#/fixtures`) is where engineers, testers, product managers and sales keep the data and documents the tests use, without writing TOML. A lead or a tester (`can.data` in `GET /api/project`) sees these actions; everyone else sees the list and the detail only.

- **Add.** "New test data" asks for a name and a kind: *File* (documents, images, PDFs to download or attach; pick at least one file), *Table* (`dataset`; the column names), *Seed data* (`seed`; starts as `{}`) or *Account* (a username and a secret reference such as `env:SHOP_PASSWORD`, never the password). "Add from files" and dropping files anywhere on the screen go through [Upload](#upload), where every new file becomes its own draft fixture. New fixtures are `status = "draft"`; a lead approves them with `iw approve` as usual.
- **Edit.** "Edit" on a fixture opens it in place: name, notes, and by kind the table (cells, add or remove rows and columns, the row key), the seed JSON, the account's username, secret reference and public fields, and the files (add, replace by name, remove). Saving writes only what changed. A table with more than 1,000 rows is edited in a working copy. A dataset stored as JSON stays JSON, with every value a string.
- **Delete.** "Delete" asks once in the page, then removes the fixture's folder. It is refused while a test case uses the fixture, because `iw check` would fail.
- **Files** download from the detail (`GET /api/blobs/:sha256`).
- **Where it goes.** The server applies the change to the current definitions, runs `iw check` (including the secret scan) and refuses errors (400) before writing anything, then writes it like an [upload](#upload): files in `.indx-watch/` on `iw serve` in git mode, a bundle snapshot on a hosted app in git mode, and `file` records in workspace mode, so that `iw sync` brings the change to every working copy. In git mode on a hosted app the screen says that changes made there are kept by the next deploy and reach the repository through `iw pull` ([sync status](#sync-status)).
- **API.** `POST /api/fixtures`, `PATCH /api/fixtures/:key` (`FixtureInput` → `FixtureSaved`) and `DELETE /api/fixtures/:key` in [`contract.ts`](https://github.com/INDXDev/indx-watch/blob/main/packages/server/src/contract.ts). Agents get 403: they write drafts with `iw new` or the `iw-data` skill.
- **Tabs.** *(v0.5)* Test data, [Secrets](#secrets) and, for leads, [Access](#access) sit as tabs above the screen (`#/fixtures`, `#/secrets`, `#/access`).

### Sharing

*(v0.5)* Rules: [security → sharing](./security.md#sharing).

- The list marks restricted fixtures "Restricted" and fixtures not shared with the viewer "Not shared with you"; such a fixture's detail and its card on the test case page show only its name and say whom to ask.
- "Share" on a fixture or a secret (for whoever can edit it) opens the share dialog: *Everyone on the team* or *Only the people and groups below*, a field to add an email or `group:<name>`, the list with a remove button per entry and "you" next to the viewer's own entry (prefilled when switching to restricted), and a line naming the leads, who always have access. Without roles the dialog says that everyone who opens the app has access. Saving a fixture's sharing is an edit (`PATCH /api/fixtures/:key` with `shared_with`; `null` for the team), a secret's a `PUT /api/secrets/:name`.
- "Who has access" on a fixture or a secret lists each entry with why: lead, team (with the role), or shared.

### Secrets

*(v0.5)* The Secrets tab (`#/secrets`, `#/secrets/<name>`) lists the secrets kept by INDX Watch that are shared with the viewer ([security](./security.md#secrets)): title and `iw:<name>` reference (with copy), the login ID (with copy), the value as dots with a *Show* button (each show is recorded; then *Copy* and *Hide*), the fixtures and environments using it, and who changed it last. Opening one also shows who has access and its history (changed, deleted, viewed: who and when). "New secret" (with `can.data` and `can.secrets`) asks for the name, title, login ID, value and notes; "Edit" changes them (an empty value keeps the current one) or deletes the secret. Without `IW_SECRETS_KEY` the tab explains how to set it. Accounts whose `secret_ref` is an `iw:` reference show the password the same way on the Test data screen and on the test case page, next to the login ID.

### Access

*(v0.5)* For leads, the Access tab (`#/access?who=<email>`) picks a person (the field suggests the people the project knows) and lists every fixture and secret with ✓ or ✕ and why (lead, shared with the team, shared with them, or not shared, "unless a member of group:…").

## Clone

`npx indx-watch clone <url> [dir]` downloads the newest snapshot from a hosted app or a store, writes `.indx-watch/` and pulls results. It is the "download" half of Upload ([cli](./cli.md#iw-clone-source-dir)).

## Languages

- **UI strings** come from `messages/{en,ja}.json` ([i18n](./i18n.md#ui-locales)). Counted nouns use ICU plurals (`{count, plural, one {# file} other {# files}}`), picked with the locale's plural rules.
- **Content** (titles, steps, criteria, fixture names, environment guides, release and plan titles) is resolved with `localize()` everywhere it is shown, including list rows, Home and the CLI panel's titles. Raw `title` fields are never rendered directly.
- When an item's title uses a `machine` translation, a "Machine translation" switch sits next to the title (once per item, not on every field). Pressing it shows the original text of every content field on the page until it is pressed again. A stale translation shows the source text with a "Translation outdated" badge.
- *(v0.5)* A project may override UI texts per locale, set a few theme tokens and brand reports with the optional `ui/` folder ([Customizing](./bundle-format.md#customizing-v05)); `GET /api/project` carries them as `ui = { messages, css }` and the app applies them before it renders, so the built-in texts and colors are the fallback. A patched server shows a quiet note with its build id ([patched servers](./security.md#patched-servers)).
- The language the tester read is recorded on runs (`locale`) and on reviews (`judgement.locale`).

## Acceptance criteria

- [ ] With `ui/messages.en.json` overriding one key and `ui/theme.toml` setting `accent`, the app shows the new text and color on `iw serve` (server and web tests); a project without `ui/` looks as before; on a patched server the note shows the build id (web and server tests).
- [x] Home shows the verdict hero, four summary cards, your queue and recent activity. The gate checks are inside Release details (e2e `@TC-12`).
- [x] With examples/shop, Home says "7 of 8 tests pass · 2 drafts not counted until approved", TC-9 and TC-10 carry a Draft chip in the queue and the Tests tree, and AC-5.1 reads "No approved test"; a project fresh from `iw init` shows "No test cases yet" with `/iw-setup` on Home and Tests (e2e `@TC-12`).
- [x] The bar's language switch turns the app Japanese and back, and the choice survives a reload (e2e `@TC-12`).
- [x] In Focus, `→` moves to the next test case and `←` moves back, and "List" returns to `#/tests` (e2e `@TC-12`). Swipes use the same navigation and are not tested automatically.
- [x] After saving a result in the Focus runner, the next test of the session opens (e2e `@TC-12`).
- [x] With an `iw_tester` cookie on a local server without `--identity-header`, a manual run's actor is `{ via: "browser" }` with the cookie's id. Without that allowance (behind `--identity-header` or Access) the cookie is ignored (server test, e2e `@TC-13`).
- [x] The CLI panel shows `npx indx-watch clone <url>` with this server's clone source, and the copy button copies it (e2e `@TC-12`).
- [x] Dropping a changed `TC-3` file previews "1 changed" with the check result. On a hosted app the upload publishes a `bundle` record, and the app serves the new title at once (server and Worker tests).
- [x] An upload with a secret finding is refused, and nothing is written (server test).
- [x] Creating a secret on the Secrets tab, showing it, pointing FX-3's account at `iw:<name>` and showing the password on FX-3 and on TC-7, restricting FX-1 with the share dialog and opening the Access tab work against `iw serve` with `IW_SECRETS_KEY` (checked by hand with Playwright screenshots; server tests cover the rules).
- [x] A run that claims `via = "github"` without a valid signature comes from the API with `unverified: true` and is shown with the "unverified" chip instead of ✓ (server and Worker tests; the chip itself is not tested automatically).
- [x] `POST /api/runs/<run>/baselines` by a human writes a `baseline` record, after which the run detail lists that screenshot in `baselines`; an agent gets 403 and a non-PNG or unknown blob 400 (server test; the button itself is not tested automatically).
- [x] `#/tests?f=flaky` lists only test cases with a flake rate, highest first, and Focus keeps that order (web unit test of the ordering; the list itself is not tested automatically).
- [x] On the hosted app, the Report screen creates a share link for the previewed report, shows its URL once and revokes it (server tests of the API; the screen itself is not tested automatically).
- [x] A customer's Home lists only their assigned plan items with Run actions (the API side is covered by the customer UAT end-to-end test in `packages/server/test/uat.test.ts`; the page itself is not tested automatically).
- [x] With roles configured, `GET /api/project` gives a viewer `can.run`, `can.review` and `can.approve` false and a customer only `can.run`; with no roles every flag is true (server tests; the hidden buttons are not tested automatically).
- [x] With `[github] repo` set, the run viewer and the test case page show Open as GitHub issue, which opens the prefilled form page; pasting the issue URL shows Related issue #42 (e2e `@TC-27`). Without a repository the button is hidden.
- [x] TC-4 in examples/shop (`style = "bdd"`) shows the Scenario (BDD) chip, the How to run this scenario guide and Given / When / Then labels, and 前提 / もし / ならば after switching to Japanese; TC-3 (no `style`) shows Preconditions, Steps and Expected (checked by hand with Playwright screenshots against `iw serve`).
- [x] A viewer who owns Checkout (alex@shop.test) gets `owns: ["FEAT-2"]`, and `mine=1` narrows status and the spec tree to TC-3–TC-6; the app asks with `mine=1` until "All features" is chosen, which the browser keeps (server test, web unit tests and e2e `@TC-17`).
- [x] In Japanese, the release title, queue titles and the test case title come from `[i18n.ja]`. The "Machine translation" switch shows the original (e2e `@TC-12`).
- [x] The test case page shows, in order, What this tests, Before you start (the Open link from `start`, test data cards, the preconditions checklist), Steps with their checks and Result; TC-9's photo card offers its download and names step 2 as the upload step (e2e `@TC-16`).
- [x] "Run manually" on `#/tc/TC-3` opens the runner without changing the URL; ticking every check suggests pass, and the run records the ticked checks on each step (e2e `@TC-15`). A Fail step with an unticked check asks for a note before Next, and the run records `checks: [true, false]` (e2e `@TC-15`).
- [x] `#/tc/<TC>/run` opens the test case page with the runner open, and a session's "Save and next" opens the next test case with its runner open (e2e `@TC-12`).
- [x] Translated `checks` show in the chosen language; a translation of a different length falls back to the source (web unit test).
- [x] In workspace mode, editing a test case's title, priority and steps in the app writes a `file` record with the viewer's verified identity, and an agent's edit is saved as an AI draft; in git mode the server refuses the edit (409) (server and Worker tests; the form itself was checked by hand).
- [x] Dropping `Sales deck.pdf` and `leads.csv` previews two new draft fixtures (`FX-5` as a `file`, `FX-6` as a `dataset` with `row_key = "email"`); a file over `inline_max_bytes` becomes a pointer and its blob is stored (server test).
- [x] `POST /api/fixtures` creates a dataset from a table as CSV; `PATCH` changes its title, notes and rows, adds and removes a file; `DELETE` removes the folder; deleting a used fixture, an unsafe file name or a plain password as `secret_ref` is refused with nothing written; an agent gets 403 (server test). Creating, editing a table and saving on the screen was checked in a browser.
- [x] In workspace mode on a Worker, uploading a PDF, editing the new fixture and deleting it write `file` records (the delete as `deleted` versions), and the fixture is gone from the API afterwards (Worker test).
- [x] A tester may add and edit test data and upload files that only touch `fixtures/`; a viewer gets 403 (server tests).
- [x] *(v0.5, T-514)* The plan in Release details shows one row per assignee with item count and a status bar (with text), the unassigned items and the automation mix; in workspace mode a lead selects rows, assigns, unassigns or splits with a preview, "Unassigned only" filters, and a tester takes or gives back (e2e `@TC-32`; role rules in `packages/server/test/assign.test.ts`).
- [x] TC-8 in examples/shop shows its second step with a "from SS-1" chip ("SS-1 から" in Japanese), and `PATCH /api/test-cases/TC-8` with `steps` is refused in workspace mode (server test).
