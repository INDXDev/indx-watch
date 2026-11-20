# Test Case Management Landscape (OSS, Commercial, Tests-as-Text, AI-Native)

INDX Watch enters a crowded market. Classic open-source TCMs (Kiwi TCMS, TestLink, Squash TM, Tuleap) are database-first web apps with GPL-family licenses. Reporting tools (ReportPortal, Allure Report) are strong on automated results and weak on authored specs. Commercial SaaS (TestRail, Qase, Xray, Zephyr, Testmo, Testiny, testomat.io, Allure TestOps) all have the same model: projects, suites or folders, cases, runs, and plans live in the vendor's database. In 2025-2026 nearly every one of them added AI case generation and an MCP server. Two trends point toward INDX Watch's thesis. First, tests are moving back into git as text: testomat.io's `.test.md` sync, Momentic deprecating cloud authoring in favour of `*.test.yaml` in the repo, and Playwright's own planner agent writing Markdown specs under `specs/`. Second, the browser-agent layer is turning into a commodity: Playwright Test Agents, Stagehand, and QA Wolf's per-run pricing. No tool we found combines all of the following: a canonical file bundle as the source of truth, with no vendor DB; fixtures and test accounts as versioned, first-class data; result sync through a dumb object store; "done" computed from acceptance criteria coverage; and customer-facing acceptance reports. That combination is the gap INDX Watch fills.

Last verified: 2026-11-19

> Method: every claim below was checked on the web on 2026-11-19 and has a source URL. Where only third-party or competitor sources were found, this is marked **(secondary)**. Prices change often. Treat them as "one line, as of 2026-11-19", not as a quote. GitHub API access was not available from the research sandbox, so star counts and last-commit dates are omitted unless the page itself showed them. `octomind.dev` could not be resolved from the sandbox network, so Octomind's current status is **unverified**.

---

## 1. Open-source / self-hosted test management

### 1.1 Kiwi TCMS
- **License:** GPL-2.0 (core repo). Source: https://github.com/kiwitcms/Kiwi (as of 2026-11-19).
- **Status:** Very active. 17.0 shipped 2026-11-03 (Python 3.14, generated OpenAPI schema and **`llms.txt`** files under `/static/api/`). 17.1 shipped 2026-11-13 (container renamed `kiwitcms/kiwitcms`). 17.2 (unreleased) adds a "Context, Intent, Guardrails, Execution" test case template. Source: https://kiwitcms.readthedocs.io/en/latest/changelog.html (as of 2026-11-19).
- **Data model:** Product → Version → Build; TestPlan (nestable) → TestCase; TestRun → TestExecution; bugs linked to executions. Plugins route results by Product, Version, Build, Plan, and Run through `TCMS_*` environment variables. Source: https://kiwitcms.readthedocs.io/en/latest/plugins/automation-frameworks.html (as of 2026-11-19).
- **File-based / git-native:** No. Everything lives in the Django DB and is reached through a JSON-RPC API.
- **Automation:** Plugins for JUnit XML, TAP, JUnit 5 (Java), pytest, PHPUnit, Robot Framework, and Django. **No Playwright plugin is listed**; Playwright users go through JUnit XML. The junit.xml plugin auto-creates plans and runs per branch or PR. Sources: the plugins page above; https://pypi.org/project/kiwitcms-junit.xml-plugin (as of 2026-11-19).
- **AI features:** None built in. The only AI-facing feature is the `llms.txt` / OpenAPI output in 17.0.
- **Self-hosting:** Yes (container). A paid hosted/enterprise flavor also exists.
- **Pricing:** Free OSS. Paid subscriptions cover hosted and enterprise images.
- **Weaknesses:** DB-first, with no text or git workflow. No first-class fixtures or test data. Dated UI. No Playwright-native reporter. No AI.

### 1.2 TestLink
- **License:** GPL-2.0 ("TestLink is a GPL licensed open source project"). Source: https://github.com/TestLinkOpenSourceTRMS/testlink-code (as of 2026-11-19).
- **Status:** Effectively in maintenance. The README says 1.9.20 "Raijin" is the last version of the 1.9.x family, and that 2.x is in progress "in free time" with limited resources. The GitHub Releases section is empty. Source: same repo page. One third-party source dates the 1.9.20 tag to 2020 **(secondary)**: https://www.testmuai.com/blog/testlink-alternatives/.
- **Data model:** Test project → test suites (tree) → test cases (versioned) → test plans → builds → executions, plus requirement specifications and requirements with coverage.
- **File-based:** No. Uses a PHP + MySQL/Postgres DB and XML import/export.
- **Automation:** XML-RPC API. Result import via community scripts.
- **AI:** None.
- **Self-hosting:** Only option.
- **Pricing:** Free.
- **Weaknesses:** Stagnant, legacy UX, no modern CI, Playwright, or AI story. It matters mainly as a source of migrations, so an importer is worth having.

### 1.3 Squash TM (Henix)
- **License:** Open core. Squash TM is **LGPL-3.0**, and Squash AUTOM/DEVOPS are Apache-2.0. Premium and Ultimate plugins need a commercial license. Sources: https://www.squashtest.com/source-code?lang=en and https://tm-en.doc.squashtest.com/v9/downloads.html (as of 2026-11-19).
- **Status:** Docs list SquashTM 15.x as the latest. Release notes say REST API auth will be token-only from SquashTM 19. Sources: https://tm-en.doc.squashtest.com/latest/ and https://tm-en.doc.squashtest.com/v15/release-notes/squash/squash-tm-14.x.html (as of 2026-11-19).
- **Data model:** Requirements (with coverage by test cases) → test cases (classic, BDD, or **Gherkin scripts**; reusable "action words") → campaigns → iterations / execution plans → executions; also sprints and sprint requirements. Source: https://tm-en.doc.squashtest.com/latest/ (as of 2026-11-19).
- **File-based:** Partly. Gherkin scripts are text, but they are stored in the DB. There is no git-native bundle.
- **Automation:** SquashTM Orchestrator, based on the OSS **OpenTestFactory**, runs automated tests, pulls execution plans into CI, evaluates quality gates, and publishes results. Squash AUTOM is now listed as a discontinued plugin. Same source.
- **AI:** "Write test cases with AI assistance". This requires an admin to configure an AI server (bring your own) and a prompt set, then enable AI per project. Same source.
- **Self-hosting:** Yes. This is the primary mode, and SaaS is also offered.
- **Pricing:** Free core. Premium and Ultimate licenses are quote-based.
- **Weaknesses:** Heavy Java app aimed at enterprise and regulated QA. DB-first. Requirement → case → campaign traceability is excellent, but it is not developer- or agent-friendly.

### 1.4 Tuleap (Enalean)
- **License:** GPL-2.0-or-later (Tuleap overall) **(secondary)**: https://en.wikipedia.org/wiki/Tuleap (as of 2026-11-19).
- **Test management availability:** The official docs say the Test Management module "is part of Tuleap Entreprise" and needs the TestPlan plugin. So it is **not** in the free Community edition. Source: https://docs.tuleap.com/user-guide/testmanagement.html (as of 2026-11-19).
- **Data model:** Three trackers: Test Case (definition), Test Campaign, and Test Execution (not run / passed / failed / blocked, with bug creation on failure). Traceability comes from Tuleap's generic tracker links to backlog items. Same source.
- **Automation:** Send JUnit XML to Test Management through the REST API, usually from a Jenkinsfile; this needs the OAuth2 Server plugin. Source: https://tuleap-documentation.readthedocs.io/en/latest/user-guide/ci.html (as of 2026-11-19).
- **File-based:** No. Tuleap hosts git repos, but test artifacts are tracker rows.
- **AI:** None found.
- **Self-hosting:** Yes.
- **Pricing:** Community free. Enterprise is a subscription.
- **Ownership change:** Dassault Systèmes reportedly acquired Enalean in March 2026 **(secondary, unverified against a primary source)**: https://startupstash.com/alternatives/tuleap/.
- **Weaknesses:** TCM is an add-on to a full ALM. Heavyweight. Paid tier for testing.

### 1.5 ReportPortal (EPAM)
- **License:** Apache-2.0. Quality Gates, the SCIM Server, and "Test Executions" are paid premium features. Source: https://www.reportportal.io/docs/FAQ/ (as of 2026-11-19).
- **Status:** 26.x line. EPAM's listing shows 26.0.7, updated 2026-10-27 **(secondary)**: https://solutionshub.epam.com/solution/report-portal.
- **Data model:** Projects → launches → suites/tests/steps (nested test items) with logs and attachments → defect types (Product Bug, Automation Bug, System Issue, To Investigate, No Defect). It is a results store, **not** a case authoring tool.
- **Automation:** Agents for many frameworks (JS, Java, Python, .NET) including Playwright, plus JUnit XML import.
- **AI:** "Auto-Analysis" ML triage. OpenSearch finds similar past failure logs (TF-IDF), then an XGBoost model (about 30 features) assigns a defect type when probability is at least 50%. No LLM or generative features are documented on that page. Source: https://reportportal.io/docs/analysis/AutoAnalysisOfLaunches/ (as of 2026-11-19).
- **Self-hosting:** Yes (docker-compose or Kubernetes; needs OpenSearch, Postgres, RabbitMQ, MinIO, and so on). Same FAQ.
- **Pricing:** Free OSS. Premium features and SaaS are paid.
- **Weaknesses:** Operationally heavy (many services). No manual-case authoring, no requirements, no fixtures. It answers "why did automation fail", not "is the feature done".

### 1.6 Allure Report (Qameta, OSS) and Allure TestOps (commercial)
- **Allure Report license:** Apache-2.0. Allure Report 3 is a TypeScript rewrite with a plugin system, one config file, rerun grouping, multi-environment reports, "known/muted/accepted" failure resolutions, a `watch` mode, quality gates, and an Allure Storage Service for history (cloud or self-hosted). Source: https://allurereport.org/docs/v3/ (as of 2026-11-19).
- **Allure Report data model:** Per-test result JSON files plus containers, categories, environment, executor, and history files. A static HTML report is generated from them. Source: https://allurereport.org/docs/ (as of 2026-11-19). **This is the closest OSS precedent for "results as files in a directory".**
- **Automation:** More than 30 framework adapters, including Playwright (JS and Java). Same source.
- **Allure TestOps data model:** Manual and automated tests are the same test-case model (AllureID, metadata, ownership, links, workflow status, history). Automated cases are created or updated from code annotations when a **launch** is closed. Per-field settings decide which metadata is "owned by code" and which by the UI. Sources: https://docs.qameta.io/allure-testops/briefly/test-cases/ and https://docs.qameta.io/getting-started/overview/ (as of 2026-11-19).
- **AI:** Built-in **MCP server (public beta, from release 26.1.1)** with 13 tools (test case CRUD and AQL search, shared steps, result search, mutes, project, issue lookup). The docs warn it "may be subject to additional fees". Source: https://docs.qameta.io/allure-testops/howto/mcp/ (as of 2026-11-19). The built-in AI chat reportedly needs a separate license **(secondary)**: https://habr.com/ru/articles/993090.
- **Self-hosting:** TestOps is offered as cloud or on-prem.
- **Pricing:** Per user. Commonly listed at about $39 per user per month for cloud, with unlimited read-only users **(secondary)**: https://www.capterra.com/p/227555/Allure-TestOps/.
- **Weaknesses:** TestOps is a closed DB product. Allure Report has no concept of authored specs, requirements, or assignments.

---

## 2. Commercial SaaS test management

### 2.1 TestRail (Idera / Gurock, "Sembi")
- **License:** Proprietary.
- **Pricing:** Essentials $22 per user per month (cloud only, up to 5 users). Professional $38 (cloud or on-prem). Enterprise $78 (SSO, MFA, audit logs). On-prem needs at least 10 seats and 12 months. **"All AI features included" on every plan**: AI test case generation, AI BDD scenarios, AI automation (script) generation, AI test prioritization, and an **MCP Server**. Admins can disable AI. Source: https://www.testrail.com/pricing/ (as of 2026-11-19). The AI engine is branded **Sembi IQ**; the same brand appears in Xray **(secondary)**: https://thectoclub.com/tools/testrail-review/.
- **Data model:** Projects → suites → sections (folders) → cases; runs (containers of tests) → results; plans (groups of runs × configurations); milestones. Sources: https://support.testrail.com/hc/en-us/articles/15758177606676-API-uses-cases-intro and https://providers.apievangelist.com/providers/testrail/ (as of 2026-11-19).
- **Automation:** `trcli` (open source) parses JUnit XML and uploads results, merging multiple files into one run. Source: https://github.com/gurock/trcli (as of 2026-11-19).
- **File-based:** No. CSV and XML import/export only.
- **Self-hosting:** TestRail Server (Windows, Unix, Docker).
- **Weaknesses:** Seat pricing. DB lock-in. Cases are mostly free text. The test data and fixtures story is weak. AI is cloud-only per one source **(secondary)**: https://www.issoh.co.jp/md/tech/3106.

### 2.2 Qase
- **License:** Proprietary SaaS. The reporters and the MCP server are open source.
- **Pricing:** Free (up to 2 projects, 4 users, 30-day history, MCP Server included). Teams $35 per user per month yearly or $42 monthly. Enterprise custom. AI runs on credits: 2,000 per month on Teams and 4,000 on Enterprise, with extra credits at $0.40. A dedicated VPC install is an Enterprise add-on. Source: https://qase.io/pricing (as of 2026-11-19).
- **Data model:** Projects → suites (tree) → cases (steps, pre/postconditions, severity, priority, layer, custom fields) → test runs (and plans) → results; defects; shared steps.
- **Tests as code:** Reporters (including `playwright-qase-reporter`) can treat **code as the source of truth** for case title, suite, severity, priority, layer, description, pre/postconditions, custom fields, and tags. IDs are linked with `qase.id()` or a `QaseID` annotation. Sources: https://developers.qase.io/docs/metadata-tests-as-code and https://reporters.qase.io/js/syntax/syntax-playwright.html (as of 2026-11-19).
- **AI:** The **AIDEN brand was retired on 2026-06-09**. Features are now "Qase AI": AI Test Designer (cases from a Jira or GitHub issue, tagged AI-generated and **staged for review**) and AI QA Architect (manual → automated, export to Playwright, Cypress, or Selenium). Source: https://www.qase.io/blog/aiden-is-just-qase-now/ (as of 2026-11-19). **QA Architect retired on 2026-11-06**; users are pointed to "your own AI client with the Qase MCP Server". Source: https://docs.qase.io/en/articles/11012497-ai-qa-architect (as of 2026-11-19). The official MCP server is https://github.com/qase-tms/qase-mcp-server (as of 2026-11-19). Qase also launched **Tiden**, "intent verification for coding agents", which records the agent session's request as a spec and checks whether tests prove each promise (Oct 2026) **(secondary)**: https://www.producthunt.com/products/tiden.
- **Weaknesses:** DB-first. The vendor just retired its own hosted test-automation agent in favour of BYO agent plus MCP. **This strongly validates INDX Watch's "agent-native via your own agent" bet.**

### 2.3 Xray (Xblend / Idera, Jira app)
- **License:** Proprietary. Sold on the Atlassian Marketplace and priced on the whole Jira instance's user tier.
- **Data model:** Jira issue types: Test, Precondition (reusable, many per test), Test Set, Test Plan, Test Execution, and Sub-Test Execution. Test definitions are snapshotted per execution. Source: https://docs.getxray.app/display/XRAYCLOUD/About+Xray (as of 2026-11-19).
- **Automation:** Imports JUnit, TestNG, NUnit, Robot, Cucumber, SpecFlow, Behave, and others. Native BDD (Gherkin stored in Jira). Same source.
- **AI:** AI Test Case Generation (Standard and above; from requirements and preconditions; Manual or Cucumber output; human-in-the-loop). AI Test Script Generation and AI Test Model Generation (Advanced and Enterprise). Sources: https://www.getxray.app/blog/accelerating-qa-xray-ai-test-case-generation and https://www.getxray.app/blog/introducing-xrays-ai-test-script-generation (as of 2026-11-19).
- **File-based:** No. Everything is in Jira (though Gherkin can be exported and imported).
- **Self-hosting:** Jira Data Center edition.
- **Pricing:** Per Jira user tier, cloud or DC. Exact list prices are on the Marketplace: https://marketplace.atlassian.com/apps/1211769/xray-test-management-for-jira (as of 2026-11-19).
- **Weaknesses:** Requires Jira. Cost scales with all Jira users. Issue-type sprawl. Not usable outside Atlassian.

### 2.4 Zephyr (SmartBear; formerly Zephyr Scale / Squad)
- **Status:** At Atlassian Team '25 (2025-04-03 announcement), SmartBear launched a unified **Zephyr** platform, sold only on the Atlassian Marketplace, with HaloAI-powered no-code automation and "unlimited storage". Source: https://smartbear.com/news/news-releases/smartbear-launches-unified-zephyr-platform-at-atla/ (as of 2026-11-19). Earlier names: TM4J → Zephyr Scale, Zephyr for Jira → Zephyr Squad. Source: https://smartbear.com/news/news-releases/smartbear-renames-1-test-management-solution/ (as of 2026-11-19). Zephyr Enterprise is a separate standalone product.
- **Data model:** Test cases → test cycles → test executions, with test plans. Jira issues serve as requirements.
- **AI:** HaloAI (manual → automated conversion). Rovo natural-language coverage queries (March 2026) were reported only in a search-engine summary of an SD Times article. **Unverified; no primary URL was confirmed.**
- **Pricing:** Per Jira user tier on the Marketplace. Third-party figures conflict **(secondary)**: https://getautonoma.com/blog/zephyr-pricing.
- **Weaknesses:** Same Jira lock-in as Xray. Product renames create confusion.

### 2.5 Testmo (Idera / Gurock)
- **Pricing:** Team $59 per month (5 users), Business $249 (15), Enterprise $599 (25). Annual plans are 15% off. **No on-prem edition.** Testmo AI is included in all plans, but case generation and update are "coming soon", and an **MCP Server is in beta**. Source: https://www.testmo.com/pricing/ (as of 2026-11-19).
- **Data model:** Projects → repository (folders, cases) → test runs (manual), **exploratory sessions**, and automation runs grouped by **automation sources**; milestones. Source **(secondary)**: https://providers.apievangelist.com/providers/testmo/ (as of 2026-11-19).
- **Automation:** `@testmo/testmo-cli` submits JUnit XML from CI. Example repos: https://github.com/testmoapp (as of 2026-11-19).
- **Weaknesses:** SaaS only. DB-first. AI is still immature.

### 2.6 Testiny
- **Pricing:** Free up to 3 users and 1,000 total cases/plans/runs (no history, no MCP). Starter $15.42 per user per month. Business $17.08. Enterprise $25.00 (5-seat packs). **Testiny Server (self-hosted) from $300 per user per year.** The MCP Server is available from Starter up. Source: https://www.testiny.io/pricing/ (as of 2026-11-19).
- **Data model:** Projects → test cases (folders) → test plans → test runs/executions; milestones; custom result states. Same source.
- **Automation:** JUnit import via CLI. Source: https://www.testiny.io/docs/integrations/automation/junit/ (as of 2026-11-19).
- **AI:** MCP server only ("connects to the AI of your choice"); no built-in generation found.
- **Weaknesses:** DB-first. AI is limited to MCP. Small vendor.

### 2.7 testomat.io
- **Pricing:** Free (2 users, 2 projects, MCP server). Professional $27 per user per month yearly or $30 monthly (AI test creation, AI agents, AI analytics). Enterprise quote (custom AI provider, branching/versioning, **self-hosting**). Source: https://testomat.io/pricing/ (as of 2026-11-19).
- **Tests as text (most relevant competitor here):** "Classical" projects store each manual test as **Markdown**. `npx check-tests pull` downloads one **`.test.md` file per suite**, and `check-tests push` uploads them. Metadata lives in HTML comments (`<!-- suite id: @S… -->`, `<!-- test id: @T… type: manual priority: high -->`); steps go under `## Steps` with nested `*Expected*:` items; there are optional examples tables. Sources: https://docs.testomat.io/project/import-export/export-tests/classical-tests-markdown-format/ and https://docs.testomat.io/project/tests/classical-test-case-editor/ (as of 2026-11-19).
- **Agent skills:** Open-source, **MIT-licensed** skills for Claude Code, Codex, Cursor, Copilot, and Cline (`npx skills add testomatio/skills`). Many work on local Markdown files with no account. Coverage mapping writes `coverage.manual.yml` and `coverage.e2e.yml` so CI can run only affected tests. Source: https://testomat.io/features/ai-skills/ (as of 2026-11-19).
- **Automation:** `check-tests` imports automated tests from source code for many frameworks; reporters exist for Playwright, Cypress, JUnit, and others.
- **Weaknesses:** The Markdown files are an **export/sync format; the platform DB stays canonical** (IDs are minted server-side). There are no fixtures or environments as files, and results do not sync without the SaaS.

---

## 3. "Tests as text" approaches

| Approach | What it is | License | Relevance |
|---|---|---|---|
| **Gherkin / Cucumber** | `Feature / Rule / Scenario / Given-When-Then / Background / Scenario Outline + Examples`, `@tags`, Doc Strings, Data Tables; **70+ spoken-language translations** via `# language:`. https://cucumber.io/docs/gherkin/reference/ (as of 2026-11-19) | MIT (cucumber/gherkin) | Proven human-readable steps format with i18n keywords, but executable steps need glue code, and it has no place for fixtures, environments, results, or assignments. |
| **testomat.io classical Markdown** | `.test.md` per suite, HTML-comment metadata, `## Steps` with `*Expected*`. (See 2.7.) | Format is proprietary; skills are MIT | Closest "manual tests as Markdown in git" precedent, but sync-to-SaaS, not canonical. |
| **Momentic `*.test.yaml`** | `fileType: momentic/test/v2`, stable `id`, `url`, `before/steps/after`; steps are plain-English AI actions or structured `click/type/assert`; `*.module.yaml` with parameters; `{{ env.X }}` variables. https://momentic.ai/docs/core-concepts/test-format (as of 2026-11-19) | Proprietary | Strong evidence that agent-run tests are best stored as YAML in git. **Momentic deprecated cloud authoring**: tests live in the repo, authored by CLI or coding agent via MCP, and `momentic import` pulls cloud tests into the repo. https://momentic.ai/docs/get-started/cloud-deprecation.md (as of 2026-11-19) |
| **Playwright Test Agents** | Planner (explores app → **Markdown plan in `specs/`**), Generator (plan → `.spec.ts`, verifies selectors live), Healer (repairs failing tests). Set up with `npx playwright init-agents --loop=<claude\|vscode\|codex\|opencode>`; a `seed.spec.ts` provides fixtures and setup. https://playwright.dev/docs/test-agents (as of 2026-11-19) | Apache-2.0 | De facto standard for "spec → code" with coding agents. INDX Watch should **interoperate with `specs/*.md`**, not reinvent it. |
| **Doorstop** | Requirements as **one YAML file per item** in git, folders = documents, `doorstop link` for traceability, tree integrity checks. https://github.com/doorstop-dev/doorstop (as of 2026-11-19) | LGPL-3.0 | Precedent for git-native requirements with stable IDs and link validation (cf. our UC/AC). |
| **Tcases** | Model-based generator: system input definition (+ generator for pairwise and similar coverage) → minimal test case set incl. invalid values; can derive inputs from **OpenAPI v3**. Latest 4.1.1. https://github.com/Cornutum/tcases (as of 2026-11-19) | MIT | Precedent for *deriving* cases and test data from a model; possible future fixture/data generator. |
| **Qase / Allure TestOps "tests as code"** | Code annotations own case metadata; the TMS mirrors them. (See 2.2, 1.6.) | Proprietary | Shows the "field ownership" problem: which fields belong to code and which to the UI. |

---

## 4. AI-native and agentic QA tools

| Tool | What it does (as of 2026-11-19) | License / pricing | Source |
|---|---|---|---|
| **Qase AI (ex-AIDEN)** | Case generation from issues with a review stage. Hosted automation agent **retired 2026-11-06** in favour of BYO agent + MCP. | Credits inside Qase plans | https://www.qase.io/blog/aiden-is-just-qase-now/, https://docs.qase.io/en/articles/11012497-ai-qa-architect |
| **testomat.io AI** | AI test creation, agents, analytics, duplicate and unused detection, failure clustering; OSS agent skills. | Professional tier and up; skills MIT | https://testomat.io/pricing/, https://testomat.io/features/ai-skills/ |
| **TestRail / Xray (Sembi IQ)** | Case, BDD, and script generation, prioritization, MCP. | Included in plans (TestRail), tiered (Xray) | https://www.testrail.com/pricing/, https://www.getxray.app/blog/accelerating-qa-xray-ai-test-case-generation |
| **QA Wolf** | AI agents plan coverage, write **Playwright/Appium** code, run, diagnose, heal, and file bugs. Tests are open-source code you "can export anytime". **$1 per web run, $2 per mobile/desktop run, no seat fees**; Coverage-as-a-Service with humans is quote-priced. | Proprietary | https://www.qawolf.com/pricing |
| **Momentic** | AI steps in YAML, Playwright/Appium runners, local visual editor, MCP for coding agents. Usage-based: Free ($50 usage), **Scale $500 per month**, Enterprise custom; no seats (page updated 2026-11-17). | Proprietary | https://momentic.ai/pricing |
| **Octomind** | AI-generated e2e tests as **standard Playwright code**, hosted runs, export. A competitor claims it was **discontinued in May 2026**; this is **unverified** (site unreachable from our sandbox). | Proprietary | https://www.octomind.dev/product/playwright-e2e-tests, https://www.testmuai.com/octomind-alternative/ **(secondary)** |
| **Shortest** | Natural-language e2e framework on Playwright using the Anthropic Claude API. About 5.7k stars; maintenance cadence not confirmed. | MIT | https://github.com/antiwork/shortest |
| **Stagehand** (Browserbase) | Browser-agent SDK (TS, Python, Go): `act` (self-healing actions), `extract` (schema-validated), `observe` (returns real selectors so credentials need not go to the model), `agent`. v4. About 26k stars. | MIT | https://github.com/browserbase/stagehand |
| **e2e (TesterArmy)** | Agent drives the app from plain-English steps, then **replays recorded actions with no model calls** until the app changes. Released July 2026, pre-1.0, ships agent skills and MCP config. | Apache-2.0 | https://notes.nicolasdeville.com/github/e2e/ **(secondary)** |
| **SkyTest Agent** (Oursky) | Self-hosted natural-language test cases; MCP and agent skill so coding agents generate cases from specs; Next.js + Midscene.js + Playwright. | OSS (license not verified) | https://gh.r-mj.com/oursky/skytest-agent **(secondary mirror)** |
| **ReportPortal Auto-Analysis** | Classic ML (XGBoost) failure triage, not generative. | Apache-2.0 | https://reportportal.io/docs/analysis/AutoAnalysisOfLaunches/ |

Takeaway: the **execution agent is commoditizing**. Playwright ships agents, Stagehand is MIT, QA Wolf sells per run, and Qase shut down its own hosted agent. The durable value moves to **what the agent is given** (spec, AC, fixtures, environment, accounts) and **what is kept** (evidence, verdicts, human review, "done" status).

---

## 5. Comparison table

Legend: Y = yes, P = partial, N = no. "Git-native" means the canonical artifacts are text files in the user's repo.

| Tool | License | Canonical store | Git-native specs | Fixtures/test data as versioned entities | Requirements/AC → coverage | Playwright integration | AI (built-in) | MCP | Self-host | Pricing (1 line) |
|---|---|---|---|---|---|---|---|---|---|---|
| Kiwi TCMS | GPL-2.0 | Postgres/MySQL | N | N | P (via plans) | P (JUnit XML) | N | N | Y | Free; paid hosting |
| TestLink | GPL-2.0 | MySQL/Postgres | N | N | Y (req specs) | N | N | N | Y | Free |
| Squash TM | LGPL-3.0 open core | DB | P (Gherkin text in DB) | N | Y | P (via Orchestrator) | P (BYO AI server) | N | Y | Free core; Premium/Ultimate quote |
| Tuleap TTM | GPL-2.0+ (TTM in Enterprise) | DB (trackers) | N | N | Y (tracker links) | P (JUnit via REST) | N | N | Y | Enterprise subscription |
| ReportPortal | Apache-2.0 | Postgres + OpenSearch + MinIO | N/A (results only) | N | N | Y (agent) | P (ML triage) | N | Y | Free; premium features paid |
| Allure Report 3 | Apache-2.0 | **Result files** + static HTML | N/A (results only) | N | N | Y | N | N | Y | Free |
| Allure TestOps | Proprietary | DB | P (code annotations) | N | P | Y | P (chat, separate license) | Y (beta) | Y | ~$39/user/mo (secondary) |
| TestRail | Proprietary | DB | N | N | P (refs field) | P (trcli JUnit) | Y | Y | Y (Server) | $22-$78/user/mo |
| Qase | Proprietary | DB | P (tests-as-code metadata) | N | P | Y (reporter) | Y (credits) | Y (OSS) | Enterprise VPC only | Free; $35/user/mo; Ent. |
| Xray | Proprietary | Jira | N (Gherkin in Jira) | P (Preconditions) | Y (Jira issues) | P (JUnit import) | Y | ? | Y (Jira DC) | Per Jira user tier |
| Zephyr | Proprietary | Jira | N | N | Y (Jira issues) | P | Y (HaloAI) | ? | Y (Jira DC / Enterprise) | Per Jira user tier |
| Testmo | Proprietary | DB | N | N | P | P (CLI JUnit) | P (beta) | Y (beta) | **N** | $59-$599/mo per user block |
| Testiny | Proprietary | DB | N | N | P | P (CLI JUnit) | N (MCP only) | Y | Y (Server $300/user/yr) | Free; $15-$25/user/mo |
| testomat.io | Proprietary (skills MIT) | DB, with `.test.md` sync | **P (sync, not canonical)** | N | P | Y | Y | Y | Enterprise only | Free; $27/user/mo; Ent. |
| Momentic | Proprietary | **YAML in repo** | **Y (agent tests)** | P (modules + env vars) | N | Y (runner) | Y | Y | N (CLI runs locally) | Free; $500/mo usage; Ent. |
| QA Wolf | Proprietary | Vendor + exported PW code | P (code) | N | P (coverage plan) | Y | Y | ? | N | $1-$2 per run |
| Playwright Test Agents | Apache-2.0 | `specs/*.md` + `.spec.ts` | **Y** | P (`seed.spec.ts`, PW fixtures) | N | Native | BYO LLM | Y (Playwright MCP) | Y | Free |
| Gherkin/Cucumber | MIT | `.feature` files | **Y** | N | P (tags) | P (via playwright-bdd and similar) | N | N | Y | Free |
| Doorstop | LGPL-3.0 | YAML per item | **Y** (requirements) | N | Y (links) | N | N | N | Y | Free |
| **INDX Watch (target)** | **Apache-2.0** | **`.indx-watch/` TOML bundle in git** | **Y (canonical)** | **Y (fixtures, accounts, environments as versioned files)** | **Y (UC → AC → TC, computed done)** | **Y (reporter)** | **Y (agent-native: skills + MCP, BYO agent)** | **Y** | **Y (Node+SQLite, or Workers+D1+R2)** | **Free OSS** |

"?" = not verified on 2026-11-19.

---

## 6. Gap and positioning

**The gap.** Every incumbent TCM (OSS or SaaS) has a **database as the source of truth**. Text formats exist only as import/export (TestLink XML, TestRail CSV), as a sync mirror (testomat.io `.test.md`), or as code annotations that a server mirrors (Qase, Allure TestOps). Tools that *are* git-native (Momentic YAML, Playwright `specs/`, Gherkin, Doorstop) each cover one slice: agent-run steps, or a plan to codegen, or BDD, or requirements. None manages assignments, manual execution, evidence, environments, fixtures, or a release "done" status. Results tools (Allure Report, ReportPortal) handle runs but not specs.

**What INDX Watch combines, and why each part matters:**

1. **File-first canonical bundle (`.indx-watch/*.toml`).** The repo *is* the database. Indexes (SQLite/D1) are rebuildable caches. This matches the direction Momentic took when it deprecated cloud authoring, and the direction Playwright took with `specs/`. Unlike testomat.io, IDs are minted locally (ULID), so there is no server round-trip and no lock-in.
2. **Agent-native, BYO agent.** Ship Claude Code and Codex skills, an MCP server, and a CLI that agents can drive. Qase retiring its hosted QA Architect (2026-11-06) in favour of "your own AI client with the Qase MCP Server" shows that hosting the agent is not a moat. Owning the **spec, context, and evidence contract** the agent works against is.
3. **Fixtures as first-class versioned data.** No incumbent models test data, seed scripts, files, or test accounts as versioned entities that runs pin to. The closest are Xray Preconditions (text only), Momentic modules plus env vars, and Playwright `seed.spec.ts`. INDX Watch records "which fixture version, which spec version, which deployment" per run, with secrets kept as references only.
4. **Git/Drive-style sync of results.** Specs go through git. Heavy results (runs, evidence, blobs) go through a **storage-only result store** (local fs or any S3-compatible bucket, including R2 and MinIO). That is simpler to operate than ReportPortal's multi-service stack. It takes Allure's "results are files" idea and adds sync and identity.
5. **Computed done.** UC → AC → TC coverage, combined with the latest verdicts per deployment, yields "done" mechanically. Incumbents report pass rates. Few compute *acceptance* status per requirement without Jira (Xray and Zephyr need Jira; Squash and Tuleap need heavy ALM setups).
6. **Customer reports.** Shareable, read-only UAT and acceptance reports (with evidence) for external customers. Incumbents gate this behind seats or Jira access.

**Positioning line:** *"Your test specs, fixtures and evidence as files you own; any agent can run them, and 'done' is computed, not claimed."*

---

## 7. What we borrow

- **Allure Report 3:** results as plain files in a directory, history as a separate store, "known/muted/accepted" failure resolutions linked to issues, quality gates, `watch` mode. https://allurereport.org/docs/v3/
- **Allure TestOps / Qase:** explicit **field ownership** (which case fields are owned by code and which by humans), and linking automated tests to cases by ID annotation (`qase.id()`, `QaseID`, AllureID). https://docs.qameta.io/allure-testops/briefly/test-cases/, https://developers.qase.io/docs/metadata-tests-as-code
- **testomat.io:** Markdown step syntax (`## Steps`, nested `*Expected*`), `pull/push` CLI ergonomics, pre-push validation, coverage maps that let CI run only affected tests, and MIT agent skills as distribution. https://docs.testomat.io/project/import-export/export-tests/classical-tests-markdown-format/
- **Momentic:** `fileType` + schema version header in every file, stable human-readable IDs, reusable parameterized modules, `lint`/`doctor` commands, and "local results stay local unless uploaded". https://momentic.ai/docs/core-concepts/test-format
- **Playwright Test Agents:** interoperate with `specs/*.md` plans and `seed.spec.ts`; ship `init`-style agent definitions per client (Claude Code, Codex, VS Code, OpenCode). https://playwright.dev/docs/test-agents
- **Xray:** reusable **Preconditions** shared across tests, and snapshotting the test definition at execution time. https://docs.getxray.app/display/XRAYCLOUD/About+Xray
- **Kiwi TCMS:** auto-create a plan or run per branch or PR from CI, and publish `llms.txt` plus an OpenAPI schema for agents. https://kiwitcms.readthedocs.io/en/latest/changelog.html
- **Gherkin:** keyword localization approach (70+ languages) as a model for bilingual step keywords. https://cucumber.io/docs/gherkin/reference/
- **Doorstop:** one file per item, link validation (`check`) across a document tree. https://github.com/doorstop-dev/doorstop
- **ReportPortal:** defect-type taxonomy (Product Bug / Automation Bug / System Issue / To Investigate / No Defect) for triage. https://reportportal.io/docs/analysis/AutoAnalysisOfLaunches/
- **AI review staging (Qase, Xray, TestRail):** AI-generated cases are tagged and staged as drafts for human approval. This matches our `draft → ready` rule.
- **Stagehand `observe`:** resolve selectors without sending credentials to the model. This is a good pattern for test-account secrets. https://github.com/browserbase/stagehand
- **QA Wolf:** "tests are open-source Playwright code you can export anytime" as an explicit anti-lock-in promise. https://www.qawolf.com/pricing

## 8. Non-goals (what we deliberately won't compete on)

- **Hosted browser grid or device farm.** We will not compete with QA Wolf, Momentic, BrowserStack, or similar on execution infrastructure. Runs happen on the user's machine or CI, or through a pluggable runner.
- **Our own browser-agent SDK.** Use Playwright (Test Agents and MCP) or Stagehand-style libraries. Do not build a competing `act/extract` engine.
- **Managed QA services** (QA Wolf's Coverage-as-a-Service). Out of scope.
- **Jira-embedded test management.** We will not be an Atlassian app. Integrate by link and webhook instead.
- **Full ALM** (Tuleap, Squash enterprise traceability matrices, regulated-industry e-signatures). Keep the model to UC → AC → TC → Run.
- **ML failure triage at ReportPortal depth.** Use simple heuristics plus LLM summaries, not a trained-classifier pipeline.
- **Rich report theming at Allure's level.** Keep reports functional and customer-readable, not a plugin ecosystem.
- **Seat-based enterprise features in v0.1** (SCIM, custom roles, audit exports). Defer these.
- **Being a general requirements tool.** AC exist to compute "done" for tests, not to replace PRDs or Doorstop.

---

## 9. Sources (all accessed 2026-11-19)

- Kiwi TCMS: https://github.com/kiwitcms/Kiwi, https://kiwitcms.readthedocs.io/en/latest/changelog.html, https://kiwitcms.readthedocs.io/en/latest/plugins/automation-frameworks.html, https://pypi.org/project/kiwitcms-junit.xml-plugin
- TestLink: https://github.com/TestLinkOpenSourceTRMS/testlink-code
- Squash TM: https://www.squashtest.com/source-code?lang=en, https://tm-en.doc.squashtest.com/latest/, https://tm-en.doc.squashtest.com/v9/downloads.html
- Tuleap: https://docs.tuleap.com/user-guide/testmanagement.html, https://tuleap-documentation.readthedocs.io/en/latest/user-guide/ci.html, https://en.wikipedia.org/wiki/Tuleap
- ReportPortal: https://www.reportportal.io/docs/FAQ/, https://reportportal.io/docs/analysis/AutoAnalysisOfLaunches/, https://solutionshub.epam.com/solution/report-portal
- Allure: https://allurereport.org/docs/, https://allurereport.org/docs/v3/, https://docs.qameta.io/allure-testops/briefly/test-cases/, https://docs.qameta.io/getting-started/overview/, https://docs.qameta.io/allure-testops/howto/mcp/, https://www.capterra.com/p/227555/Allure-TestOps/
- TestRail: https://www.testrail.com/pricing/, https://github.com/gurock/trcli, https://support.testrail.com/hc/en-us/articles/15758177606676-API-uses-cases-intro
- Qase: https://qase.io/pricing, https://www.qase.io/blog/aiden-is-just-qase-now/, https://docs.qase.io/en/articles/11012497-ai-qa-architect, https://github.com/qase-tms/qase-mcp-server, https://developers.qase.io/docs/metadata-tests-as-code, https://reporters.qase.io/js/syntax/syntax-playwright.html, https://www.producthunt.com/products/tiden
- Xray: https://docs.getxray.app/display/XRAYCLOUD/About+Xray, https://www.getxray.app/blog/accelerating-qa-xray-ai-test-case-generation, https://www.getxray.app/blog/introducing-xrays-ai-test-script-generation, https://marketplace.atlassian.com/apps/1211769/xray-test-management-for-jira
- Zephyr: https://smartbear.com/news/news-releases/smartbear-launches-unified-zephyr-platform-at-atla/, https://smartbear.com/news/news-releases/smartbear-renames-1-test-management-solution/, https://getautonoma.com/blog/zephyr-pricing
- Testmo: https://www.testmo.com/pricing/, https://providers.apievangelist.com/providers/testmo/, https://github.com/testmoapp
- Testiny: https://www.testiny.io/pricing/, https://www.testiny.io/docs/integrations/automation/junit/
- testomat.io: https://testomat.io/pricing/, https://docs.testomat.io/project/import-export/export-tests/classical-tests-markdown-format/, https://docs.testomat.io/project/tests/classical-test-case-editor/, https://testomat.io/features/ai-skills/
- Tests as text: https://cucumber.io/docs/gherkin/reference/, https://github.com/doorstop-dev/doorstop, https://github.com/Cornutum/tcases, https://playwright.dev/docs/test-agents
- AI-native: https://momentic.ai/pricing, https://momentic.ai/docs/core-concepts/test-format, https://momentic.ai/docs/get-started/cloud-deprecation.md, https://www.qawolf.com/pricing, https://www.octomind.dev/product/playwright-e2e-tests, https://www.testmuai.com/octomind-alternative/, https://github.com/antiwork/shortest, https://github.com/browserbase/stagehand, https://notes.nicolasdeville.com/github/e2e/, https://gh.r-mj.com/oursky/skytest-agent
