import type { Content } from './types';

export const en: Content = {
  locale: 'en',
  path: '/',
  meta: {
    title: 'INDX Watch — test management that lives in your repo',
    description:
      'Open-source, file-first test management for people and coding agents. Test cases, acceptance criteria and test data are typed TOML files next to your code; manual, Playwright and agent results sync through any folder or bucket; release readiness is computed, never declared.',
    ogAlt: 'INDX Watch: test management that lives in your repo',
  },
  nav: {
    how: 'How it works',
    roles: 'Who it’s for',
    agents: 'Agents',
    compare: 'Compare',
    faq: 'FAQ',
    docs: 'Docs',
    github: 'GitHub',
    menu: 'Sections',
    otherLanguage: '日本語',
    otherLanguageLabel: 'このページを日本語で読む',
    skip: 'Skip to content',
  },
  hero: {
    eyebrow: 'Open source · Apache-2.0 · Claude Code & Codex',
    title: 'Test management that lives in your repo.',
    lead: 'Test cases, acceptance criteria and test data are typed files next to your code. Manual, Playwright and agent results sync through any folder or bucket. Whether a release is ready is computed, never declared — for your team and your coding agent alike.',
    copy: 'Copy',
    copied: 'Copied',
    demo: 'Open the live demo',
    github: 'GitHub',
    docs: 'Read the docs',
    note: 'Node 22.13+. Adds the `.indx-watch/` folder, the agent skills and the MCP server to your repository.',
    imageAlt:
      'The INDX Watch readiness dashboard for release v1.2.0: a red “Not ready to ship” banner, the gate checks, test results by status and the open items.',
    chat: {
      you: 'Can we ship 1.2.0?',
      agent:
        '**Not yet.** 7 of 8 test cases pass. TC-8 “Wrong password is rejected” (P0) failed on a manual run by Sam, and P0 failures can’t be waived. Next to act: Sam.',
    },
  },
  problem: {
    kicker: 'The problem',
    title: 'QA that looks done, but isn’t.',
    lead: 'Ask “which use cases of this release are verified, by whom, on which build, with what evidence?” and most teams can’t answer. Not because nobody tested — because the answer is spread across five places.',
    items: [
      {
        title: 'Test cases are scattered',
        body: 'Spreadsheets, Drive folders, issues and people’s heads. Nobody can say what “done” means for a release.',
      },
      {
        title: 'Test data is unmanaged',
        body: 'Coupon codes, seed data, sample files and test accounts aren’t versioned or linked to the tests that need them.',
      },
      {
        title: 'Results are disconnected',
        body: 'Playwright and CI results aren’t linked to what they verify, and manual results live somewhere else entirely.',
      },
      {
        title: 'Agents can’t help',
        body: 'Claude Code and Codex can write your app, but they can’t read a spreadsheet of test cases or know what’s left to test.',
      },
    ],
    closing:
      'INDX Watch puts the whole picture into one typed, local, file-based model — and lets the numbers decide when you’re done.',
  },
  how: {
    kicker: 'How it works',
    title: 'Git for definitions. A shared drive for results.',
    lead: 'Definitions are reviewed like code. Results flow continuously, without bloating your repository. Readiness falls out of both.',
    steps: [
      {
        title: 'Write it down, next to the code',
        body: 'Use cases, acceptance criteria, test cases and fixtures are canonical TOML in `.indx-watch/`, reviewed in pull requests. JSON Schemas give your editor completion.',
        code: '.indx-watch/specs/FEAT-2-checkout/\n  UC-2-guest-applies-coupon/\n    use-case.toml\n    TC-3-valid-coupon.toml',
      },
      {
        title: 'Run it the way it fits',
        body: 'Tag a Playwright test `@TC-3`, follow plain-language steps in the browser, or let an agent run it. All three land in the same model.',
        code: "test('…', { tag: ['@TC-3'] }, …)\n# or “Run manually” in the browser\n# or /iw-test TC-3",
      },
      {
        title: 'Results sync like a drive',
        body: 'Every run is an attributable record — who or what, when, which commit, environment and fixture versions, with evidence — synced through a folder or any S3-compatible bucket.',
        code: 'iw sync   # folder, S3, R2, MinIO',
      },
      {
        title: 'Readiness is computed',
        body: 'A use case is done only when every acceptance criterion is covered by approved test cases whose latest result passes, on this release, with evidence. A configurable gate turns that into go or no-go.',
        code: 'iw status --gate   # exit 1 = not ready',
      },
    ],
    split: {
      git: 'In git',
      gitItems: ['Use cases and acceptance criteria', 'Test cases with steps and checks', 'Fixtures: datasets, seeds, files, accounts', 'Environments, releases, plans'],
      drive: 'In your result store',
      driveItems: ['Runs from people, CI and agents', 'Screenshots and other evidence', 'Large files, stored by content hash', 'Reviews and waivers'],
      gate: 'Computed readiness',
      gateItems: [
        { passed: true, text: 'Every P0 criterion has a test · 6/6' },
        { passed: false, text: 'Every P0 test passes · 5/6' },
        { passed: true, text: 'Passing P0 results have evidence' },
      ],
    },
  },
  roles: {
    kicker: 'Who it’s for',
    title: 'One release, four roles, one source of truth.',
    lead: 'Examples from the sample shop app in the repository: a catalog, a cart with coupons, orders, sign-in and review photos.',
    sayLabel: 'You say',
    happensLabel: 'What happens',
    approveLabel: 'You approve',
    items: [
      {
        role: 'Developer',
        who: 'Writes the code and the tests next to it.',
        say: ['What should we test in checkout?'],
        happens:
          'The agent reads the Checkout use cases, the app’s source and the existing tests, then proposes what’s missing in plain words — “An unknown coupon is refused (P0)”. Only what you accept becomes a draft criterion and test case, with a Playwright test tagged `@TC-11`.',
        approve: 'The drafts, with the one line it gives you: `iw approve AC-2.3 && iw approve TC-11`.',
      },
      {
        role: 'Tester',
        who: 'Owns features and checks what can’t be automated.',
        say: ['Test my features', 'Walk me through TC-3'],
        happens:
          'Alex owns Checkout, so the agent runs the Playwright tests of TC-3 to TC-5 and walks Alex through the manual TC-6, one yes/no check at a time. In the browser, TC-9 shows the account to sign in with and the review photo to upload — on one page, in English or Japanese.',
        approve: 'The result. A run the agent guided stays “needs review” until you confirm it.',
      },
      {
        role: 'PM / approver',
        who: 'Decides whether the release ships.',
        say: ['Can we ship 1.2.0?', 'Write the release report'],
        happens:
          'The answer comes first, then why and who acts next: TC-8 (P0) failed and can’t be waived; Catalog 2/2 · Checkout 4/4 · Account 1/2. The report is one HTML file to share, with a redacted customer version on request.',
        approve: 'Drafts, reviews of uncertain results, waivers (never for P0) and the release itself.',
      },
      {
        role: 'Coding agent',
        who: 'Claude Code or Codex, through skills, the MCP server and `--json`.',
        say: ['Why did TC-8 fail?'],
        happens:
          'It reads the run, the evidence, the test case and the app code, and answers with a cause and a confidence: “Not clear yet (0.5) — the server sends the right message, but there’s no screenshot.” It proposes a re-run and drafts an issue text.',
        approve: 'Nothing. An agent never approves, reviews, waives or ships; when a person must act, it gives exactly one line to copy.',
      },
    ],
  },
  agents: {
    kicker: 'Talk to your agent',
    title: 'Install once, then just ask.',
    lead: '`npx indx-watch init` adds job skills for Claude Code (`/iw-…`) and Codex (`$iw-…`) plus an MCP server. The agent reads first, asks one question at a time with a recommended answer, runs the CLI itself and stops wherever a person must decide.',
    you: 'You',
    agent: 'Agent',
    conversations: [
      {
        title: 'Claude Code — /iw-test',
        lines: [
          { who: 'you', text: 'Walk me through TC-6' },
          {
            who: 'agent',
            text: '**What it checks:** many shoppers order from a phone; the order confirmation is readable on a small screen (AC-3.1).\n**Where to start:** open http://localhost:4173/ in a 390 px wide window.\n**What to look for:** no sideways scrolling, and the whole order number is visible.',
          },
          { who: 'agent', text: 'Step 1 — add any product and place the order. Does the page fit the screen without scrolling sideways?' },
          { who: 'you', text: 'yes' },
          { who: 'agent', text: 'Is the whole order number visible? A screenshot, please.' },
        ],
      },
      {
        title: 'Claude Code — /iw-triage',
        lines: [
          { who: 'you', text: 'Why did TC-8 fail?' },
          {
            who: 'agent',
            text: 'Sam’s manual run failed at step 1: “The message did not appear; the page reloaded silently.” No screenshot.\n`app/server.mjs` does answer a wrong password with “Email or password is incorrect”.\n**Not clear yet (confidence 0.5)** — either the page doesn’t show it or something else happened.',
          },
          { who: 'agent', text: 'Next: re-run TC-8 with a screenshot? (iw-test)' },
        ],
      },
    ],
    skillsTitle: 'Six jobs, in your words — English or Japanese',
    skillHead: { job: 'Job', claude: 'Claude Code', codex: 'Codex', say: 'You say' },
    skills: [
      { job: 'Set up', skill: 'iw-setup', say: '“Set up testing for this repo” ·「テスト管理をセットアップして」' },
      { job: 'Design tests', skill: 'iw-design', say: '“What should we test in checkout?” ·「UC-3 のテストケースを考えて」' },
      { job: 'Prepare data', skill: 'iw-data', say: '“The review photo tests need data” ·「テストデータを用意して」' },
      { job: 'Run tests', skill: 'iw-test', say: '“Walk me through TC-3” ·「TC-3 を一緒にやって」' },
      { job: 'Fix failures', skill: 'iw-triage', say: '“Why did TC-8 fail?” ·「失敗を調べて」' },
      { job: 'Know where you are', skill: 'iw-status', say: '“Can we ship 1.2.0?” ·「リリースできる？」' },
    ],
    rulesTitle: 'AI proposes, people approve',
    agentDoes: 'The agent does',
    agentItems: [
      'Writes use cases, criteria, test cases and fixtures as drafts (`origin = "ai"`)',
      'Runs Playwright and agent test cases and records the results',
      'Walks you through a manual test and records your answers',
      'Proposes owners, fixes and issue texts',
    ],
    personDoes: 'Only a person does',
    personItems: [
      'Approves drafts — they don’t count towards readiness until then',
      'Reviews uncertain runs, including every run the agent guided',
      'Waives a failure (P0 failures can’t be waived)',
      'Commits, files issues and ships',
    ],
    guide: 'Testing with Claude Code or Codex',
  },
  dx: {
    kicker: 'For developers',
    title: 'Plain files, a stable JSON contract, your test runner.',
    lead: 'Everything is diffable, reviewable and scriptable. Here is TC-3 from the sample shop, the Playwright test that implements it, and the readiness gate as JSON.',
    tomlCaption: 'A test case is a TOML file with a schema, steps with yes/no checks, linked fixtures and reviewed translations.',
    pwCaption: 'Tag the test with its key. The reporter records each run next to the manual ones.',
    jsonCaption: 'Every command takes `--json`. Gate it in CI, or let your agent read it.',
    points: [
      { title: '`iw check`', body: 'Schemas, references, keys — and a secret scan that refuses anything that looks like a password.' },
      { title: 'MCP server', body: 'The same operations as the CLI for agents without a shell, locally or on the hosted app.' },
      { title: 'GitHub Action', body: 'Sync results, write a job summary, suggest affected test cases and gate the merge on readiness.' },
      { title: 'Fixtures as data', body: 'Datasets, seeds, files and accounts, versioned by content hash. Secrets stay references like `env:NAME`.' },
    ],
  },
  gallery: {
    kicker: 'The web app',
    title: 'For everyone who doesn’t live in a terminal.',
    lead: 'Testers, PMs and customers use the browser: the readiness dashboard, one-page test cases with the manual run inline, test data, and reports. In English and Japanese, light and dark.',
    items: [
      { image: 'test-case.png', alt: 'A test case on one page: what it tests, before you start with the test data, steps with checks, and the result.', caption: 'One-page test case: purpose, where to start, test data and checks.' },
      { image: 'manual-run.png', alt: 'A manual run open on the test case page, with the checks of step 1 ticked.', caption: 'Run manually, one step at a time, with screenshots.' },
      { image: 'readiness.png', alt: 'The release readiness page with gate checks, test results and open items.', caption: 'Readiness: the gate, results by status and who acts next.' },
      { image: 'test-data.png', alt: 'The test data screen listing datasets, files and accounts.', caption: 'Test data, shared with the team like a drive.' },
      { image: 'spec-tree.png', alt: 'The specs tree with features, use cases, criteria and test cases.', caption: 'Specs: features, use cases, criteria and test cases.' },
      { image: 'test-case-mobile.png', alt: 'A test case on a 390 px wide phone screen.', caption: 'Works on a phone.' },
      { image: 'home-ja-dark.png', alt: 'The web app in Japanese with the dark theme.', caption: 'Japanese UI, dark theme.' },
    ],
  },
  compare: {
    kicker: 'How it compares',
    title: 'Where INDX Watch fits.',
    lead: 'Classic test management keeps your tests in a vendor database; tests-as-code covers only what’s automated. INDX Watch keeps everything as files you own.',
    columns: ['', 'Spreadsheets / Drive', 'Classic TCM (TestRail, Xray, Kiwi)', 'Tests-as-code only', 'INDX Watch'],
    rows: [
      { label: 'Source of truth', cells: ['Sheets', 'Database', 'Test code', 'Typed files in git'] },
      { label: 'Manual + automated in one model', cells: ['✗', '✓', '✗', '✓'] },
      { label: 'Fixtures versioned and linked', cells: ['✗', '✗', 'Partial', '✓'] },
      { label: 'Works offline / self-host / no lock-in', cells: ['✓ / – / ✓', 'Varies', '✓', '✓ / ✓ / ✓'] },
      { label: 'Agent-native (skills, MCP, --json)', cells: ['✗', 'MCP add-ons', '✗', '✓'] },
    ],
    yes: 'Yes',
    no: 'No',
    note: 'Sources and a tool-by-tool table are in the landscape research.',
  },
  selfHost: {
    kicker: 'Self-host, no lock-in',
    title: 'Runs where you want. Leaves when you want.',
    lead: 'There is no INDX Watch cloud. Definitions stay in your repository and results in a folder or bucket you own.',
    items: [
      { title: 'On your machine', body: 'The dashboard and manual runner, offline, against your local files.', code: 'npx indx-watch serve --open' },
      { title: 'On Cloudflare', body: 'The same server on Workers, R2 and D1, behind Cloudflare Access.', code: 'iw deploy' },
      { title: 'On Node or Docker', body: 'Behind your SSO proxy, with results in S3 or a shared folder.', code: 'iw serve --host 0.0.0.0' },
    ],
    lockIn: [
      { title: 'Files are the truth', body: 'Any database is a disposable index, rebuilt from the bundle and the result store.' },
      { title: 'Sync anywhere', body: 'A folder, AWS S3, Cloudflare R2, MinIO or GCS — no server needed.' },
      { title: 'Take it all with you', body: '`iw export --full` writes a lossless archive.' },
    ],
  },
  faq: {
    kicker: 'FAQ',
    title: 'Questions',
    items: [
      {
        q: 'Do I need Claude Code or Codex?',
        a: 'No. Every step the skills take is also an `iw` command, and testers use the web app in the browser. The agent makes it faster; it isn’t required.',
      },
      {
        q: 'Can the AI approve its own work?',
        a: 'No. AI-written definitions start as drafts with `origin = "ai"` and don’t count towards readiness until a person approves them. Runs an agent guided stay “needs review” until a person confirms them, and only people waive failures or ship.',
      },
      {
        q: 'Where does my data go?',
        a: 'Definitions stay in your git repository; results go to the folder or bucket you choose. INDX Watch has no hosted service of its own. Your coding agent talks to its model provider as it always does.',
      },
      {
        q: 'Does it replace Playwright?',
        a: 'No — INDX Watch is not a test runner. Playwright runs your tests; tag them `@TC-3` and the reporter records the results next to manual ones.',
      },
      {
        q: 'How are passwords and tokens handled?',
        a: 'They never live in the bundle. Fixtures hold references such as `env:SHOP_CUSTOMER_PASSWORD`, and `iw check` refuses anything that looks like a secret.',
      },
      {
        q: 'Can non-engineers use it?',
        a: 'Yes. Testers follow plain-language steps with yes/no checks and attach screenshots in the browser, in English or Japanese. Customers receive an HTML or PDF report.',
      },
      {
        q: 'What does it cost?',
        a: 'Nothing. INDX Watch is open source under Apache-2.0. You pay only for the storage or hosting you choose, such as your own Cloudflare account.',
      },
      {
        q: 'How mature is it?',
        a: 'Early: v0.1 on npm. The file format is versioned (`schema_version = 1`) and changes only additively. Browse the read-only live demo or `npx indx-watch init demo --example` first.',
      },
    ],
  },
  cta: {
    title: 'Know when you’re done.',
    lead: 'One command in your repository, then ask your agent “Set up testing for this repo”.',
  },
  footer: {
    tagline: 'File-first, agent-native test management.',
    license: 'Apache-2.0',
    demo: 'Live demo',
    docs: 'Docs',
    github: 'GitHub',
    npm: 'npm',
  },
};
