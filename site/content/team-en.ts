import { DOCS } from '@/lib/site';
import { PW_PATH, PW_TC3 } from './code';
import type { TeamContent } from './types';

/**
 * The team guide in English (/team/): what each role does on an ordinary day, after setup. Commands and
 * conversations come from the CLI and docs/guides/ (testing-with-agents, web-app, journey); names, keys and
 * numbers from examples/shop (Alex owns Checkout, Sam owns Account, release v1.2.0, PLAN-1).
 */
export const teamEn: TeamContent = {
  locale: 'en',
  path: '/team/',
  meta: {
    title: 'Team guide — INDX Watch',
    description:
      'How QA, engineers and product managers use INDX Watch day to day: run the tests you are asked to run, automate and fix, add test cases, plan a round and decide a release.',
  },
  hero: {
    kicker: 'Team guide',
    title: 'Who does what, on an ordinary day.',
    lead: 'The setup is done. This page is for **everyone who uses it next**: pick your role, find the situation you are in, and follow the steps. Each one says what you see when it worked.',
    setup: { label: 'Not set up yet? Start with the setup guide', href: '/setup/' },
  },
  pick: {
    title: 'Pick your role',
    roles: [
      {
        id: 'qa',
        title: 'QA and testers',
        who: 'Run what you are asked to, record it, raise what is wrong',
        jobs: ['Find what is yours', 'Test what you are asked to', 'When a check fails', 'Confirm runs, prepare data'],
      },
      {
        id: 'engineer',
        title: 'Engineers',
        who: 'Know what a change touches, automate it, fix what is red',
        jobs: ['What does my PR touch?', 'Automate a test case', 'CI went red', 'Review test changes'],
      },
      {
        id: 'pm',
        title: 'Product managers',
        who: 'Ask for tests, approve them, plan a round, decide the release',
        jobs: ['Ask for something to be tested', 'Approve test cases', 'Plan who tests what', 'Decide and release'],
      },
    ],
  },
  cycle: {
    kicker: 'One release',
    title: 'How the roles hand work to each other.',
    lead: 'Every role works on **the same files and the same results**, so nobody copies status between tools. One release goes round like this.',
    flow: {
      nodes: [
        { title: 'Product manager', caption: 'asks and plans', items: ['Asks for a test', 'Approves the drafts', 'Plans the round'] },
        { title: 'Engineer', caption: 'designs and automates', items: ['Turns a request into tests', 'Tags Playwright tests', 'Fixes what fails'] },
        { title: 'QA', caption: 'runs and records', items: ['Runs the manual tests', 'Attaches screenshots', 'Raises failures'] },
        { title: 'Product manager', caption: 'decides', items: ['“Can we ship?”', 'Waives or waits', 'Shares the report'] },
      ],
      edges: ['approved tests', 'a build to test', 'results'],
      label: 'How one release moves',
      play: 'Play',
      pause: 'Pause',
      captions: [
        'The PM asks for something to be tested and approves the test cases that come back.',
        'An engineer, often with an agent, writes the test cases and automates what can be automated.',
        'QA runs the rest by hand in the web app; every result lands next to the automated ones.',
        'The gate is computed from those results; the PM decides, waives what may wait, and ships.',
      ],
    },
  },
  roles: [
    {
      id: 'qa',
      kicker: 'QA and testers',
      title: 'Run what you are asked to, and say what is wrong.',
      lead: 'You need **a browser** (the team’s app, or `iw serve` on your machine). An agent helps, but is not required.',
      steps: [
        {
          id: 'qa-mine',
          title: 'Find what is yours',
          who: 'Every morning',
          body: 'Open the app. **Home** answers whether the release is ready and lists **Your queue**: the test cases assigned to you in a plan, then those of the features you own. Each has one button: Run, Review or See failure.',
          done: 'Your queue shows your items, yours first. If you own features, Home starts in **My features**.',
          note: 'With an agent, ask “What do I need to test?” and it lists the same items.',
          link: { label: 'Using the web app', href: DOCS.webApp },
          blocks: [
            { kind: 'shot', image: 'home.png', alt: 'Home: release v1.2.0 not ready, the summary cards, your queue and recent activity' },
          ],
        },
        {
          id: 'qa-run',
          title: 'Someone asks: “Can you test checkout?”',
          who: 'When you are asked to test something',
          body: 'Open the test case. It is written for someone who has never seen the app: **what it tests, where to start, the test data and what to do with each item**, then the steps. Press **Run manually**, follow one step at a time, tick each check you see, and attach a screenshot where the step asks for one.',
          done: 'After the last step the result shows Pass or Fail with your name, the release and the environment, and the run is in **Activity**.',
          items: [
            'Ticking every check suggests pass; an unticked check asks for one sentence of what you saw',
            'Not sure which test case? Search the **Tests** tree for “checkout”, or ask your agent',
            'On a phone the page keeps the same order, so you can test there too',
          ],
          blocks: [
            { kind: 'shot', image: 'manual-run.png', alt: 'TC-3 with the manual run open: the coupon code to use and step 1 with both checks ticked' },
            {
              kind: 'chat',
              lines: [
                { who: 'you', text: '/iw-test Walk me through TC-3' },
                {
                  who: 'agent',
                  text: '**What it checks:** a valid coupon lowers the cart total (AC-2.1). **Where to start:** http://localhost:4173/cart with one Canvas Tote (40.00); use SUMMER10 from FX-1. Step 1: apply the code. **Is the total 36.00?**',
                },
                { who: 'you', text: 'Yes.' },
              ],
            },
          ],
        },
        {
          id: 'qa-fail',
          title: 'A check fails',
          who: 'When the app does not do what the step says',
          body: 'Untick the check, write **one sentence of what you saw instead**, and attach a screenshot. That is a complete bug report. Then ask why, or open an issue that is already filled in with the steps, the expected and actual result, the run and the commit.',
          done: 'The test case shows Fail, Home shows it under **needs attention**, and the issue links back to the run.',
          link: { label: 'Fix failures with iw-triage', href: `${DOCS.agents}#fix-failures-iw-triage` },
          blocks: [
            {
              kind: 'chat',
              lines: [
                { who: 'you', text: 'Why did TC-8 fail?' },
                {
                  who: 'agent',
                  text: 'Your run says step 1 failed: “The message did not appear; the page reloaded silently.” The server sends “Email or password is incorrect”, so either the page does not show it or something else happened. **Not clear yet (confidence 0.5).** Re-run it with a screenshot?',
                },
              ],
            },
            { kind: 'terminal', title: 'Or by hand', code: '$ iw issue TC-8 --open      # a prefilled GitHub issue in your browser' },
          ],
        },
        {
          id: 'qa-review',
          title: 'Confirm the runs an agent guided',
          who: 'After a run with your agent',
          body: 'A run the agent walked you through is **“needs review” until you confirm it**, because you did the steps, not the agent. Open **Activity → Review**, read the evidence, and record the verdict with a reason.',
          done: 'The run leaves the review queue and counts towards the release.',
          blocks: [
            { kind: 'terminal', title: 'Or in the terminal', code: '$ iw review 01JF3Q --verdict pass --reason "Checked on staging, screenshot attached"' },
          ],
        },
        {
          id: 'qa-data',
          title: 'The test needs data that is not there',
          who: 'When a coupon code, an account or a file is missing',
          body: 'Open **Test data**. **New test data** creates a table, seed data, an account or a file; dropping any file on the screen makes it a draft fixture. Passwords go to the **Secrets** tab, never into a test case.',
          done: 'The new fixture appears with the test cases that use it, as a draft until a person approves it.',
          link: { label: 'Fixtures', href: DOCS.fixtures },
          blocks: [
            { kind: 'shot', image: 'test-data.png', alt: 'The Test data screen: coupon codes, catalog seed, a customer account and a review photo, with the test cases that use each' },
          ],
        },
      ],
    },
    {
      id: 'engineer',
      kicker: 'Engineers',
      title: 'Know what a change touches, and keep it green.',
      lead: 'You work in **your editor, the terminal and pull requests**. Test cases are files next to your code, reviewed like code.',
      steps: [
        {
          id: 'eng-impact',
          title: 'What does my pull request touch?',
          who: 'Before you ask for review',
          body: 'The PR comment lists **the test cases your change touches** (from their automation files, definitions and test data) and the test cases the PR added, changed or removed. Ask your agent what is missing for the change, and it proposes tests in plain words before writing anything.',
          done: 'The PR comment names the test cases to run, and your new test cases are in the same PR as the code.',
          blocks: [
            {
              kind: 'chat',
              lines: [
                { who: 'you', text: '/iw-design What should we test for this change?' },
                {
                  who: 'agent',
                  text: 'Your change adds a coupon limit. **A coupon cannot be applied twice** (UC-2, P1): applying SUMMER10 again shows an error and the total stays 36.00. Keep it?',
                },
              ],
            },
            { kind: 'terminal', title: '~/shop', code: '$ iw impact --base origin/main   # test cases this branch touches\n$ iw diff --base origin/main     # test cases added, changed or removed' },
          ],
        },
        {
          id: 'eng-automate',
          title: 'Automate a test case',
          who: 'When a manual test should run on every PR',
          body: 'Write the Playwright test as usual and **tag it with the test case it implements**. Set `mode = "playwright"` on the test case, so a passing run counts as a pass instead of waiting for a person. The reporter records each result with the commit and screenshots.',
          done: 'The reporter prints the test case with pass, and the test case’s result in the app shows CI as the runner.',
          link: { label: 'Playwright guide', href: DOCS.playwright },
          blocks: [
            { kind: 'file', file: PW_PATH, code: PW_TC3 },
            { kind: 'terminal', title: '~/shop', code: '$ npx playwright test\n[indx-watch] 7 run(s) to .indx-watch/runs: TC-1 pass, TC-2 pass, TC-3 pass, …' },
          ],
        },
        {
          id: 'eng-red',
          title: 'CI went red',
          who: 'When the INDX Watch check fails',
          body: 'The check fails when the gate fails or a definition file does not load. Read the PR comment first: it names the failing test case. Then ask why: the agent reads the run, the evidence and the app code, and says **product bug, test problem, or environment and data**, with a confidence.',
          done: 'You know which of the three it is, and the next push turns the check green or names what is left.',
          blocks: [
            {
              kind: 'pr',
              title: 'github-actions · INDX Watch · v1.2.0',
              lines: [
                { tone: 'fail', text: 'Not ready to ship: 7 pass · 1 fail · 0 untested' },
                { tone: 'info', text: 'Failing: TC-8 Wrong password is rejected (P0)' },
              ],
            },
            { kind: 'terminal', title: '~/shop', code: '$ iw check          # schemas, references, keys, secret scan\n$ iw show TC-8      # the test case and its recent runs' },
          ],
        },
        {
          id: 'eng-review',
          title: 'Review test changes in a pull request',
          who: 'When a teammate or an agent changed test cases',
          body: 'A test case is a short TOML file, so the diff is readable, and the PR comment repeats it in plain words for people who do not read TOML. Drafts written by an agent carry `origin = "ai"` and **do not count until a person approves them**.',
          done: 'The PR merges with approved test cases, and the next deploy publishes them to the app.',
          blocks: [{ kind: 'terminal', title: 'You, not the agent', code: '$ iw approve AC-2.3 && iw approve TC-11\n$ git commit -am "test: approve TC-11"' }],
        },
      ],
    },
    {
      id: 'pm',
      kicker: 'Product managers',
      title: 'Say what must work, and decide when it does.',
      lead: 'You need **the app and GitHub**. You never write TOML by hand unless you want to: ask in an issue or ask an agent, then approve.',
      steps: [
        {
          id: 'pm-ask',
          title: 'Ask for something to be tested',
          who: 'When a feature or a bug needs a test',
          body: 'Open a GitHub issue with the form **“Ask for something to be tested”**: who needs it, what they should be able to do, the priority (P0 blocks a release) and one checkbox per criterion. Someone turns it into a use case with one command, or ask an agent to design the test cases directly.',
          done: 'The issue becomes a draft use case with one criterion per checkbox, linked back to the issue.',
          blocks: [
            {
              kind: 'pr',
              title: 'New issue · Ask for something to be tested',
              lines: [
                { tone: 'info', text: 'Who needs this? A shopper' },
                { tone: 'info', text: 'What should they be able to do? Use a gift card at checkout' },
                { tone: 'info', text: 'Priority: P1' },
                { tone: 'pass', text: 'The gift card balance is taken off the total' },
              ],
            },
            { kind: 'terminal', title: 'Whoever picks it up', code: '$ iw import github-issue 42' },
          ],
        },
        {
          id: 'pm-approve',
          title: 'Approve the test cases',
          who: 'When drafts are waiting',
          body: 'Open **Tests**: drafts are marked, and an AI draft says so at the top with the command to approve it. Read it like a pull request: **does it check what the user needs?** Then approve, or ask for a change.',
          done: 'The test case loses its draft mark and starts to count towards readiness.',
          blocks: [
            { kind: 'shot', image: 'spec-tree.png', alt: 'The Tests tree: features with their use cases, criteria and test cases, each with mode and status' },
            { kind: 'terminal', title: 'You, not the agent', code: '$ iw approve AC-2.3 && iw approve TC-11' },
          ],
        },
        {
          id: 'pm-plan',
          title: 'Plan who tests what',
          who: 'At the start of a test round',
          body: 'A plan is a list of test cases for a release, each with an assignee: a person, `ci` or an agent. **Split it by weight** and preview the result before writing it. Each person then finds their items in Your queue.',
          done: 'Each tester sees their items in Your queue, with the due date.',
          blocks: [
            {
              kind: 'terminal',
              title: '~/shop',
              code: '$ iw new plan --title "v1.2.0 regression"\nCreated PLAN-1 in plans/PLAN-1-v1-2-0-regression.toml\n$ iw assign --plan PLAN-1 --split alex@shop.test:2,sam@shop.test:1 --dry-run\n$ iw assign --plan PLAN-1 --split alex@shop.test:2,sam@shop.test:1',
            },
            {
              kind: 'file',
              file: '.indx-watch/plans/PLAN-1-v1-2-0-regression.toml',
              code: 'key = "PLAN-1"\ntitle = "v1.2.0 regression"\nrelease = "v1.2.0"\nenvironment = "staging"\ndue = 2026-11-28\n\n[[items]]\ntest_case = "TC-6"\nassignee = "alex@shop.test"\n\n[[items]]\ntest_case = "TC-8"\nassignee = "sam@shop.test"',
            },
          ],
        },
        {
          id: 'pm-ship',
          title: 'Decide and release',
          who: 'Before the release date',
          body: 'Ask “can we ship?”. The answer is computed from the results, with who acts next. A known **P1–P3 failure may be waived** with a reason; P0 failures cannot. Share the report, then mark the release as released. **Shipping is a person’s decision**: the agent never changes a release’s state.',
          done: 'Home says the release is ready, the report is shared, and `releases/v1.2.0.toml` says `state = "released"`.',
          link: { label: 'Reports', href: DOCS.reports },
          blocks: [
            {
              kind: 'chat',
              lines: [
                { who: 'you', text: 'Can we ship 1.2.0?' },
                {
                  who: 'agent',
                  text: '**Not yet.** 7 of 8 test cases pass. TC-8 (Account, P0) failed on a manual run by Sam, and P0 failures can’t be waived. Next to act: Sam.',
                },
              ],
            },
            { kind: 'shot', image: 'report.png', alt: 'The Report screen: the customer version of the v1.2.0 report with the gate checks' },
            {
              kind: 'terminal',
              title: 'You, not the agent',
              code: '$ iw waive TC-2 --release v1.2.0 --reason "Search is slow on staging only; fixed in 1.2.1"\n$ iw report --format html --out v1.2.0.html',
            },
          ],
        },
      ],
    },
  ],
  matrix: {
    kicker: 'At a glance',
    title: 'Who usually does what.',
    lead: 'The same person can hold several roles. The only hard line is between people and agents.',
    cols: ['', 'QA', 'Engineer', 'PM', 'Agent'],
    yes: 'Yes',
    rows: [
      { task: 'Ask for a test', cells: ['✓', '✓', '✓', '–'] },
      { task: 'Write test cases', cells: ['✓', '✓', '✓', 'Drafts'] },
      { task: 'Approve test cases', cells: ['✓', '✓', '✓', '✗'] },
      { task: 'Run manual tests', cells: ['✓', '–', '–', 'Guides you'] },
      { task: 'Automate tests', cells: ['–', '✓', '–', '✓'] },
      { task: 'Review a run', cells: ['✓', '✓', '✓', '✗'] },
      { task: 'Waive a failure (not P0)', cells: ['–', '–', '✓', '✗'] },
      { task: 'Ship the release', cells: ['–', '–', '✓', '✗'] },
    ],
  },
  people: {
    kicker: 'Only people',
    title: 'Four decisions an agent never makes.',
    lead: 'An agent can propose, draft, run and explain. Whatever counts towards readiness passes through a person; an agent that tries gets exit code 2.',
    items: [
      { title: 'Approve', body: 'A draft becomes ready and starts to count.', code: 'iw approve TC-11' },
      { title: 'Review', body: 'A run that needs review gets a verdict.', code: 'iw review <run> --verdict pass --reason "…"' },
      { title: 'Waive', body: 'A known P1–P3 failure may ship.', code: 'iw waive TC-2 --release v1.2.0 --reason "…"' },
      { title: 'Ship', body: 'The release’s state changes.', code: 'state = "released"' },
    ],
  },
  closing: {
    title: 'Try it on the sample shop.',
    lead: 'The live demo shows release v1.2.0 with Alex, Sam and every screen on this page.',
    demo: 'Open the live demo',
    setup: 'Setup guide',
  },
  labels: { copy: 'Copy', copied: 'Copied', you: 'You', agent: 'Agent', step: 'Step', doneLabel: 'You should see' },
};
