# Web app

The web app is how testers, leads and customers use INDX Watch without a terminal. It runs locally (`iw serve`) and hosted (`iw deploy`) from the same code. This page owns the app's information architecture, screens, interaction patterns and copy rules. The HTTP API is in `packages/server/src/contract.ts`. Visual references are in [design/](../design/index.html); where they differ from this page, this page wins.

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
│                                                  [⇪ Upload] [>_ CLI] (A) ▾   │
├──────────────────────────────────────────────────────────────────────────────┤
│                                 screen                                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

| Element | Behavior |
|---|---|
| Brand / project | Links to Home. |
| Navigation | Home · Tests · Activity · Test data · Report. Below 720 px it becomes a bottom tab bar. |
| Scope | One control: the release, with the environment as a second line in its menu. The default is the current release and all environments, like `iw status`. |
| **Upload** | Opens the upload dialog ([Upload](#upload)). Hidden when the server cannot write. |
| **CLI** | Opens the CLI panel ([CLI panel](#cli-panel)). |
| Avatar menu | Shows who you are and how that was verified, a "Not you?" link where allowed ([Identity](#identity)), language, theme, and the sync state. Language and theme live here, not in the bar. |

Problems from `iw check` appear as one quiet line under the bar ("3 problems in the test files"), which expands on click. They never push the screen down by more than one line.

## Screens

| Route | Screen | List view | Focus view |
|---|---|---|---|
| `#/` | Home | — | — |
| `#/tests` | Tests | Feature → use case → criterion → test tree with status, priority, last run and who ran it | One test case per screen: title, preconditions, steps with expected results, test data, latest result, "Run this test" |
| `#/tc/<TC>` | Test case | — | The Focus card for that test, with ← / → over the current list |
| `#/tc/<TC>/run` | Manual runner | — | One step per screen on phones; all steps on wide screens |
| `#/activity` | Activity | Runs, reviews and uploads, newest first, with who, verdict, test, release, environment and time | One run per screen with its steps and evidence. "Review" opens a queue of `needs_review` runs |
| `#/runs/<run>` | Run | — | The Focus card for that run |
| `#/fixtures` | Test data | Fixtures by kind, with the tests that use them | One fixture per screen with its values or preview |
| `#/uploads` | Uploads | Bundle snapshots, newest first: who uploaded, when, from where (commit or browser), file count, "current" marker, download | — |
| `#/report` | Report | — | — |

The List / Focus switch sits at the top right of each collection screen. Each view has its own URL, so a link opens the same view: `#/tests` and `#/tc/TC-3`, `#/activity` and `#/runs/<run>`, `#/fixtures` and `#/fixtures/FX-1`. `?f=open` and `?f=flaky` (Tests) and `?f=review` (Activity) carry the filter into Focus.

### Quarantine

The Tests filter has a third option, **Flaky** (`#/tests?f=flaky`). It replaces the tree with a flat list of the test cases that have a [flake rate](concepts.md#flaky-tests) in the current scope, highest rate first (ties: key). Each row shows the status badge, the key, the title in the chosen language, the rate as a percentage and "n of m runs". The Tests search box narrows the list by key or title. With no flaky test case (or no match) it says so. The view only reads `flaky` from the API; it never hides a test case from the gate or changes a verdict, so a quarantined test still counts until it is fixed. Focus pages through the same list.

### Home

Home is calm. It has four blocks, in this order:

1. **Verdict hero.** The release name and title, and one sentence: "Ready to ship", "Not ready: 2 of 8 checks fail" or "Nothing to gate yet". A progress bar shows passing tests out of tests in scope. It has one primary button and one secondary:
   - The primary button is **Start testing (n left)**. It opens the Focus runner over the open items: assigned to you first, then unassigned, then the rest.
   - The secondary button is **Share report**.
2. **Four summary cards.** Each card links to the screen that explains it:
   - Passing (`6 / 9`)
   - Needs attention (fail + needs review + blocked)
   - Criteria covered (`8 / 9`)
   - Last upload (who, when)
3. **Your queue.** Open plan items assigned to you, then unassigned open items, then everything else. At most 5 rows, with "See all" for the rest. Each row shows status, key, title in the chosen language, and Run, Review or Inspect.
4. **Recent activity.** The last 5 runs, reviews and uploads, each with an avatar, name, verb and time ("Alex passed TC-3 · 5 min ago").

Gate checks, counts by status and the use case table move to **Release details**, a disclosure at the bottom of Home. Their content does not change ([concepts](concepts.md#readiness-gate)).

**Empty states.** A hosted app with no snapshot yet shows a full-page drop zone instead of an error. It reads "Drop your `.indx-watch` folder here", with the matching CLI command next to it (`npx indx-watch push`). A project with no test cases shows `iw new` examples and a "Write test cases with your agent" link to [agents.md](agents.md).

### Customer view

*(v0.3, [customer UAT](security.md#customer-uat))* For a `customer` (`role` in `GET /api/project`), Home is a focused page: the verdict hero over their items, then **Your acceptance tests**, every plan item assigned to them grouped by plan, each row with its status, key, title in the chosen language, due date and **Run** (or **Inspect** for a failed run), which opens the Focus runner over that item and the rest of the list. The summary cards, Recent activity and Release details are not shown. The runner is the normal manual runner; a run is recorded with the customer's Access identity. With nothing assigned the page says "No tests are assigned to you yet".

### Visual baselines

*(v0.2)* In the run viewer, every PNG screenshot (in a step or in other evidence) that is the current [approved baseline](concepts.md#visual-baselines) of its test case carries a "Baseline" chip. The others have an **Approve as baseline** button. It posts `POST /api/runs/<run>/baselines` with the screenshot's SHA-256; the server writes a `baseline` record with the request's identity and refuses agents and CI actors (403). The chip appears at once. Approving never changes the run's verdict; `iw judge <run> --visual` compares later runs with the new baseline. `visual` judgements show their `diff_ratio` as a percentage next to the verdict.

### List and Focus

**List** is a table or tree. Rows are links; every row shows a status badge, the key, the title in the chosen language and the last actor. Filters (status, priority, "assigned to me") sit above it, along with a text filter that matches key or title in any language.

**Focus** shows exactly one item, centered, at a readable width (at most 720 px):

- **Header.** The position ("3 of 9"), the key, the status badge, and the title in large type.
- **Body.** The content in plain language. For a test case: preconditions, numbered steps with the expected result under each, test data values, and the latest result (who, when, verdict).
- **Footer.** ← Previous · primary action · Next →.
- **Moving between items.** `←` / `→` keys, horizontal swipe on touch screens (at least 60 px, mostly horizontal), or the footer buttons. Each item has its own URL, so the browser's Back button steps back through the items.
- **Order.** The order and filters of the List view the user came from. "Open" filters (not passing) are kept, so stepping through them works like a queue.

The Focus **runner** turns a series of tests into a session. After you save a result, it moves to the next open test in the same list, without returning to Home. The header shows the session's progress ("2 of 5 done"). Keyboard shortcuts while a step is focused:

| Key | Action |
|---|---|
| `P` / `F` / `B` / `S` | Mark the step pass / fail / blocked / skipped |
| `N` | Focus the step's note field |
| `⌘V` / `Ctrl+V` | Paste a screenshot into the step |
| `→` / `←` | Next or previous test, when no field has focus |

### Report

Home's **Share report** opens `#/report`: a preview of the server-rendered HTML report with the audience (customer by default), the language and the plan (or the whole release), plus "Open HTML" and "Download Markdown".

*(v0.2)* On the hosted app, a person signed in through Cloudflare Access (`can.share` in `GET /api/project`) also sees **Share links** below the preview ([reports.md](reports.md#share-links)):

- **Create link** with an expiry of 7, 30 or 90 days freezes the report exactly as previewed (same audience, language and plan) and shows its URL once, with a copy button and a note that it cannot be shown again.
- A table of the existing links, newest first: created (who, when), audience, release or plan, expiry, state (active, expired, revoked) and opens. Active links have **Revoke**, which asks for confirmation.

Elsewhere the section is not shown.

## Identity

Every record carries an `actor` ([security](security.md#identity)). The app shows that actor everywhere a result appears: an avatar (initials, with a color derived from the ID), the name, and a small "verified" mark for identities that come from Cloudflare Access, a trusted proxy header or GitHub OIDC.

**Unverified** *(v0.2)*: when a record claims a verified `via` but has no valid signature ([signed records](security.md#signed-records)), the ✓ is replaced by an amber "unverified" chip whose tooltip says the record may have been written directly to the store. This applies to runs (lists, Activity, Home, the run viewer), judgements in the run viewer, and uploads. The server computes the flag; the app never verifies signatures itself.

**"Who's testing?"** A local server runs as the machine's git user. In a shared or cloud workspace that may not be the person at the browser. A hosted app with `--public` has no identity at all. In these modes the avatar menu offers "Not you?". It opens a dialog asking for a name and email, stored in the `iw_tester` cookie (one year, `SameSite=Strict`, `Path=/`). The server then records writes as:

```json
{ "kind": "human", "id": "sam@shop.test", "name": "Sam", "via": "browser" }
```

- `via = "browser"` is self-asserted, like `git` and `env`. Reports show it, and the v0.2 `gate.require_verified_human` option excludes it.
- The cookie is honored only when the server has no verified identity for the request: `iw serve` without `--identity-header`, and hosted `--public`. Behind Cloudflare Access or a trusted identity header the cookie is ignored, and "Not you?" is not offered.
- Agent detection does not apply to the cookie. Agents must not use the browser to review or waive ([agents](agents.md)), and the skills say so.
- The server validates the cookie: `id` is an email or a name of 1 to 80 characters, and `name` is at most 80 characters. Anything else is ignored, and the default identity is used.

**Roles** *(v0.3)*: on a hosted app with [roles](security.md#roles), the avatar menu shows the identity's role ("Role: customer (assigned items only)"), and the app hides what the role cannot do, from `can` in `GET /api/project`: without `can.run` (viewers) the Run, Start testing and Run manually buttons and the queue's Run actions; without `can.review` (viewers, customers) the review form; without `can.approve` (all but leads) "Approve as baseline"; without `can.upload` the upload drop zone; without `can.share` the Share links section. A customer's app shows only their assigned items, because the API returns nothing else. Hiding is a convenience: the server refuses these requests anyway.

## CLI panel

The **CLI** button opens a panel with the commands that match what you are looking at, each with a copy button. The commands use the real URLs of this server and store:

| Tab | Command | When shown |
|---|---|---|
| Clone | `npx indx-watch clone <url>` | Always. `<url>` is this hosted app, or the `[store].url` locally |
| Upload | `npx indx-watch push` | Always |
| Run | `npx indx-watch record TC-3 --verdict pass` | On a test case |
| Playwright | `IW_REPORTER=1 npx playwright test --grep @TC-3` | On a test case with automation |
| Report | `npx indx-watch report --release v1.2.0 --format html` | On Home and Report |
| Serve | `npx indx-watch serve` | Always |

Without a store (local only), Clone shows `git clone` advice instead, because the definitions are files in the repository.

## Editing in workspace mode

*(v0.2)* In [workspace mode](sync.md#workspace-mode-v02) (`[store] mode = "workspace"`) definitions live in the store, so the app edits them; in git mode they are edited as files and reviewed in pull requests, and the app has no editor.

- **Test case.** An **Edit** button on the test case screen turns the title, priority and steps (instruction and expected result; add and remove steps) into a form. **Save** sends only the fields that changed (`PATCH /api/test-cases/:key`); the server applies them to the current file, writes it with `formatToml()` and appends a `file` record whose parents are the current heads, attributed to the request's verified identity. So two people editing different fields both keep their edits; a later save of the same field replaces the earlier one, while two saves made from the same heads (at the same moment, or on two servers before a sync) are concurrent edits and merge with a conflict file ([sync.md](sync.md#workspace-mode-v02)). Invalid input (an empty title or step) is refused with the reason, and nothing is written.
- **Agents** (an agent identity, e.g. `/mcp` or `iw serve` under a coding agent) can save only drafts: the server marks their edit `origin = "ai"`, `status = "draft"` with an `[ai]` table and drops `approved_by` and `approved_version`, so a person approves it again ([security](security.md#identity)).
- **Roles.** On a hosted app with [roles](security.md#roles), only a `lead` edits definitions (`can.edit` in `GET /api/project`); the Edit button is hidden for testers, viewers and customers, and the server refuses their `PATCH` with 403 before reading the test case, so a customer cannot reach unassigned items through it. Without roles, and on `iw serve`, everyone is `lead`.
- On `iw serve` the file in `.indx-watch/` changes at once; the next `iw sync` publishes nothing new for it. Elsewhere the edit appears after the next sync.
- Conflict files from concurrent edits show in the problems banner (`workspace-conflict`) until someone resolves them in a working copy. While a test case has a conflict file, saving it is refused (409), because the edit would silently drop the other value.
- Upload is for git mode: in workspace mode the Upload button is hidden, and the API refuses uploads (409).

Use cases, fixtures and plans are edited in a working copy in this version; only a plan's assignees change in the app, through customer invites (`POST` / `DELETE /api/plans/:key/invites`, [customer UAT](security.md#customer-uat)), which append a `file` record for the plan the same way.

## Upload

You can upload definitions in three ways:

- with the **Upload** button
- by dropping files anywhere on Home, Tests or Uploads; a full-window overlay says "Drop to upload test files"
- with `iw push` from a terminal

**What can be dropped.** A folder that contains `project.toml` replaces the whole bundle. Single `.toml`, `.csv`, `.json` and `.md` files are merged into the current bundle:

- A file whose `id` matches an existing entity replaces that entity's file.
- A new test case goes into the folder of the use case whose criteria it covers.
- A new use case goes into the folder of its feature.
- Any other file is listed as "can't place: drop the whole folder instead".

**Preview first.** The dialog lists every file as added, changed or unchanged. It runs `iw check` (including the secret scan) on the result. Errors block the upload; warnings are shown. Nothing is written until you press **Upload n files**.

**What an upload does.**

- **Hosted:** it publishes a new bundle snapshot, as `iw push` does, attributed to you. The hosted app switches to it at once.
- **Local:** it writes the files into `.indx-watch/` as uploaded (and removes the files a whole-folder upload no longer has). You then review and commit them with git like any other edit.

**Uploads screen.** It lists snapshots from `bundle` records: who, when, from where (a commit, or "browser upload"), file count, and the current one. Each row can be downloaded as a `.tar`.

## Clone

`npx indx-watch clone <url> [dir]` downloads the newest snapshot from a hosted app or a store, writes `.indx-watch/` and pulls results. It is the "download" half of Upload ([cli](cli.md#iw-clone-source-dir)).

## Languages

- **UI strings** come from `messages/{en,ja}.json` ([i18n](i18n.md#ui-locales)).
- **Content** (titles, steps, criteria, fixture names, environment guides, release and plan titles) is resolved with `localize()` everywhere it is shown, including list rows, Home and the CLI panel's titles. Raw `title` fields are never rendered directly.
- When an item's title uses a `machine` translation, a "Machine translation" switch sits next to the title (once per item, not on every field). Pressing it shows the original text of every content field on the page until it is pressed again. A stale translation shows the source text with a "Translation outdated" badge.
- The language the tester read is recorded on runs (`locale`) and on reviews (`judgement.locale`).

## Acceptance criteria

- [x] Home shows the verdict hero, four summary cards, your queue and recent activity. The gate checks are inside Release details (e2e `@TC-12`).
- [x] In Focus, `→` moves to the next test case and `←` moves back, and "List" returns to `#/tests` (e2e `@TC-12`). Swipes use the same navigation and are not tested automatically.
- [x] After saving a result in the Focus runner, the next test of the session opens (e2e `@TC-12`).
- [x] With an `iw_tester` cookie on a local server without `--identity-header`, a manual run's actor is `{ via: "browser" }` with the cookie's id. Without that allowance (behind `--identity-header` or Access) the cookie is ignored (server test, e2e `@TC-13`).
- [x] The CLI panel shows `npx indx-watch clone <url>` with this server's clone source, and the copy button copies it (e2e `@TC-12`).
- [x] Dropping a changed `TC-3` file previews "1 changed" with the check result. On a hosted app the upload publishes a `bundle` record, and the app serves the new title at once (server and Worker tests).
- [x] An upload with a secret finding is refused, and nothing is written (server test).
- [x] A run that claims `via = "github"` without a valid signature comes from the API with `unverified: true` and is shown with the "unverified" chip instead of ✓ (server and Worker tests; the chip itself is not tested automatically).
- [x] `POST /api/runs/<run>/baselines` by a human writes a `baseline` record, after which the run detail lists that screenshot in `baselines`; an agent gets 403 and a non-PNG or unknown blob 400 (server test; the button itself is not tested automatically).
- [x] `#/tests?f=flaky` lists only test cases with a flake rate, highest first, and Focus keeps that order (web unit test of the ordering; the list itself is not tested automatically).
- [x] On the hosted app, the Report screen creates a share link for the previewed report, shows its URL once and revokes it (server tests of the API; the screen itself is not tested automatically).
- [x] A customer's Home lists only their assigned plan items with Run actions (the API side is covered by the customer UAT end-to-end test in `packages/server/test/uat.test.ts`; the page itself is not tested automatically).
- [x] With roles configured, `GET /api/project` gives a viewer `can.run`, `can.review` and `can.approve` false and a customer only `can.run`; with no roles every flag is true (server tests; the hidden buttons are not tested automatically).
- [x] In Japanese, the release title, queue titles and the test case title come from `[i18n.ja]`. The "Machine translation" switch shows the original (e2e `@TC-12`).
- [x] In workspace mode, editing a test case's title, priority and steps in the app writes a `file` record with the viewer's verified identity, and an agent's edit is saved as an AI draft; in git mode the server refuses the edit (409) (server and Worker tests; the form itself was checked by hand).
