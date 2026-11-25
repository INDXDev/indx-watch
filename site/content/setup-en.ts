import { DOCS } from '@/lib/site';
import { PW_PATH, PW_TC3, TOML_PATH, TOML_TC3 } from './code';
import type { SetupContent } from './types';

/**
 * The setup guide in English (/setup/). Every command and output is copied from the CLI and the guides in
 * docs/guides/ (quickstart, journey, self-host-cloudflare, self-host-cloudflare-from-github); keep them in step.
 */
export const setupEn: SetupContent = {
  locale: 'en',
  path: '/setup/',
  meta: {
    title: 'Setup guide — INDX Watch',
    description:
      'Set up INDX Watch from start to finish: install into your repository, write and run the first tests, add the GitHub workflows, deploy the app to your own Cloudflare account behind Access, and bring in your team.',
  },
  hero: {
    kicker: 'Setup guide for engineers',
    title: 'From npx to your team testing on your own Cloudflare.',
    lead: 'One page, top to bottom. **Do the steps in order**: each says who does it, the exact commands, and what you should see. Stop after step 6 if one laptop is enough; carry on for CI and a hosted app.',
    primary: { label: 'Start with step 1', href: '#install' },
    secondary: { label: 'What runs where', href: '#architecture' },
  },
  toc: 'On this page',
  needs: {
    title: 'Before you start',
    items: [
      '**Node 22.13+** and a git repository with your app',
      '**Claude Code or Codex** (optional; every step is also a command)',
      '**GitHub** for the pull request checks (phase 2)',
      '**A Cloudflare account** with a Zero Trust team for the hosted app (phase 3); the free plans cover a small team',
    ],
  },
  paths: {
    title: 'How far do you need to go?',
    lead: 'Each phase builds on the one before. Nothing in a later phase is required to get value from an earlier one.',
    items: [
      { title: 'Just me, on my laptop', steps: 'Steps 1–6', body: 'Test cases in git, the web app on localhost, results on your machine.' },
      { title: 'Team with pull requests', steps: '+ Step 7', body: 'Every PR is checked, runs Playwright and gets one comment with the gate.' },
      { title: 'Team on our Cloudflare', steps: '+ Steps 8–11', body: 'The app on a Worker behind Access, deployed on every merge; testers only need a browser.' },
    ],
  },
  arch: {
    kicker: 'Architecture',
    title: 'What runs where.',
    lead: 'There is **no INDX Watch cloud**. Definitions live in your repository, the app runs in your Cloudflare account, and GitHub Actions moves changes between them.',
    nodes: [
      { title: 'Your laptop', caption: 'npx indx-watch', items: ['`.indx-watch/` TOML files', 'Claude Code or Codex + skills', '`iw serve` on localhost'] },
      { title: 'GitHub', caption: 'pull requests + Actions', items: ['`iw check` and Playwright', 'PR comment and check run', '`iw deploy` on merge to main'] },
      { title: 'Your Cloudflare', caption: 'Workers · R2 · D1 · Access', items: ['Worker: the web app and API', 'R2: runs and evidence', 'D1: a disposable index'] },
      { title: 'Your team', caption: 'a browser', items: ['Sign in with Access', 'Manual runs, evidence', 'Readiness and reports'] },
    ],
    edges: ['git push', 'deploy on merge', 'Access login'],
    storesTitle: 'Where each thing is kept',
    stores: [
      { what: 'Test cases, criteria, test data', where: 'Git, in `.indx-watch/`, reviewed in pull requests' },
      { what: 'Runs, screenshots, uploads', where: 'Your R2 bucket (or a folder or S3 bucket), never in git' },
      { what: 'The query index', where: 'D1, rebuilt from the bucket at any time' },
      { what: 'Tokens and passwords', where: 'GitHub secrets and your shell; files only hold `env:NAME` references' },
    ],
  },
  phases: [
    {
      id: 'laptop',
      kicker: 'Phase 1',
      title: 'On your laptop',
      lead: 'Install, describe the project, write tests, run them and ask the question that matters. No accounts needed.',
      steps: [
        {
          id: 'install',
          title: 'Install into your repository',
          who: 'Developer · once per repository',
          body: 'Run it at the root of your app’s repository, then **commit what it writes** so everyone who clones gets the same setup.',
          done: '`.indx-watch/project.toml` exists, and `git status` is clean after the commit.',
          items: [
            '`.indx-watch/`: a project, environment `local`, release `v0.1.0` and feature “General” (placeholders)',
            '`.claude/skills/` and `.mcp.json`: the skills and MCP server for Claude Code',
            '`.agents/skills/` and `.codex/config.toml`: the same for Codex',
            'A marked block in `AGENTS.md` that tells the agent which skill to use',
          ],
          note: 'From here on, `iw` is short for `npx indx-watch` (or `npm install --global indx-watch`). Never run `npx iw`: that is an unrelated package.',
          link: { label: 'Quickstart', href: DOCS.quickstart },
          blocks: [
            {
              kind: 'terminal',
              title: '~/shop',
              code: '$ npx indx-watch init\n$ git add -A\n$ git commit -m "chore: add INDX Watch"',
            },
          ],
        },
        {
          id: 'setup',
          title: 'Describe the project with your agent',
          who: 'Developer or lead · once',
          body: 'Start `claude` (or `codex`) in the repository and ask in plain words. The agent reads your `package.json`, Playwright config, tests and CI, then asks **one question at a time with a recommended answer**: project key, languages, the test environment’s URL, features, owners, the release, the reporter and a CI workflow.',
          done: '`iw check` prints no errors, and the features show without “Draft” in the web app after you approve.',
          note: 'The first time, approve the `indx-watch` MCP server when your agent asks. The agent writes drafts; **a person approves them**, with the one line it gives you.',
          link: { label: 'Testing with Claude Code or Codex', href: DOCS.agents },
          blocks: [
            {
              kind: 'chat',
              lines: [
                { who: 'you', text: 'Set up testing for this repo.' },
                {
                  who: 'agent',
                  text: 'I found the app on http://localhost:4173, Playwright tests and a CI workflow. First question: the project key. I suggest **SHOP**. OK?',
                },
                { who: 'you', text: 'Yes. You decide the rest.' },
                {
                  who: 'agent',
                  text: 'Wrote features Catalog, Checkout and Account, environment `staging` and release `v1.2.0` as drafts. `iw check` passes. Review the diff, commit, then approve with the line below.',
                },
              ],
            },
            {
              kind: 'terminal',
              title: 'You, not the agent',
              code: '$ iw approve FEAT-1 && iw approve FEAT-2 && iw approve FEAT-3 \\\n    && iw approve staging && iw approve v1.2.0',
            },
          ],
        },
        {
          id: 'serve',
          title: 'Open the web app',
          who: 'Anyone · any time',
          body: 'The same app your team will use later runs **offline against your local files**. Keep it open in a second terminal while you work.',
          done: 'Your browser opens http://127.0.0.1:4321 with Home and your release.',
          note: 'Results go to `.indx-watch/runs/`, which is git-ignored: definitions travel through git, results through a store (phase 3).',
          link: { label: 'Using the web app', href: DOCS.webApp },
          blocks: [
            { kind: 'terminal', title: '~/shop', code: '$ iw serve --open\n# dashboard and manual runner on http://127.0.0.1:4321' },
            { kind: 'shot', image: 'home.png', alt: 'Home: release v1.2.0, the readiness verdict, your queue and recent activity' },
          ],
        },
        {
          id: 'design',
          title: 'Write the first test cases',
          who: 'Tester, developer or PM',
          body: 'Ask what to test. The agent reads the feature, the app’s source and the existing tests, and **proposes what is missing in plain words before writing anything**. Only what you keep becomes draft criteria and test cases, each with a purpose, a start page and yes/no checks.',
          done: 'The new test case appears under its feature in **Tests**, marked as a draft until approved.',
          note: 'Prefer files? Every test case is a TOML file you can write by hand; its `#:schema` line gives your editor completion. `iw new tc` creates one.',
          link: { label: 'Writing good test cases', href: DOCS.writing },
          blocks: [
            {
              kind: 'chat',
              lines: [
                { who: 'you', text: '/iw-design What should we test in checkout?' },
                {
                  who: 'agent',
                  text: '**An unknown coupon is refused** (P0): entering a code that does not exist shows “This coupon is not valid” and the total stays 40.00. Keep it?',
                },
                { who: 'you', text: 'Keep it.' },
                { who: 'agent', text: 'Wrote AC-2.3 and TC-11 as drafts. Approve with `iw approve AC-2.3 && iw approve TC-11`.' },
              ],
            },
            { kind: 'file', file: TOML_PATH, code: TOML_TC3 },
          ],
        },
        {
          id: 'run',
          title: 'Record the first results',
          who: 'Tester for manual, developer for Playwright',
          body: '**Manual:** open a test case in the web app and press “Run manually”, or ask your agent “walk me through TC-3”. **Playwright:** add the reporter and tag each test with the test case it implements. Both land in the same place and count the same way.',
          done: 'The run appears in **Activity**, and the test case shows Pass or Fail instead of “Not tested”.',
          note: 'Set `mode = "playwright"` on a test case that Playwright implements; otherwise a passing run waits for a person as “needs review”.',
          link: { label: 'Playwright guide', href: DOCS.playwright },
          blocks: [
            { kind: 'shot', image: 'manual-run.png', alt: 'TC-3 with the manual run open: the coupon code to use and step 1 with both checks ticked' },
            { kind: 'file', file: PW_PATH, code: PW_TC3 },
            { kind: 'terminal', title: '~/shop', code: '$ npx playwright test\n[indx-watch] 7 run(s) to .indx-watch/runs: TC-1 pass, TC-2 pass, TC-3 pass, …' },
          ],
        },
        {
          id: 'status',
          title: 'Ask “can we ship?”',
          who: 'Lead · before every release',
          body: 'Readiness is **computed from the results**, never typed in: every P0 test passes, coverage, no untested items. Ask your agent, run `iw status`, or open Home. Shipping stays a person’s decision.',
          done: 'You get a yes or a no with the reason, and the same answer on Home.',
          link: { label: 'How the readiness gate works', href: DOCS.concepts },
          blocks: [
            {
              kind: 'chat',
              lines: [
                { who: 'you', text: 'Can we ship 1.2.0?' },
                {
                  who: 'agent',
                  text: '**Not yet.** 7 of 8 test cases pass. TC-8 “Wrong password is rejected” (Account, P0) failed on a manual run by Sam, and P0 failures can’t be waived. Next to act: Sam.',
                },
              ],
            },
            { kind: 'shot', image: 'readiness.png', alt: 'Gate checks: “Every P0 test passes” fails at 5/6 because of TC-8; the other checks pass' },
          ],
        },
      ],
    },
    {
      id: 'github',
      kicker: 'Phase 2',
      title: 'In GitHub',
      lead: 'Test changes are reviewed like code, and every pull request says whether the release is ready.',
      steps: [
        {
          id: 'workflows',
          title: 'Add the workflows and open a pull request',
          who: 'Developer · once',
          body: 'One command writes two workflows, only where they are missing. **`indx-watch.yml`** runs `iw check`, Playwright and the INDX Watch action on every pull request. **`indx-watch-deploy.yml`** deploys the app on merge (phase 3). Push a branch and, within a minute or two, the pull request gets one comment that stays up to date.',
          done: 'The pull request has the **INDX Watch** check and one comment from github-actions.',
          items: [
            'The gate line: passed or failed, with pass, fail and untested counts',
            'The test cases this PR added, changed or removed',
            'The test cases to run, from the files the PR touches',
          ],
          note: 'Make the **INDX Watch** check required in branch protection to block merging an unready release. Pull requests from forks only get the job summary.',
          link: { label: 'GitHub Actions guide', href: DOCS.githubActions },
          blocks: [
            {
              kind: 'terminal',
              title: '~/shop',
              code: '$ git switch -c ci/indx-watch\n$ iw init --github\nWrote: .github/workflows/indx-watch.yml .github/workflows/indx-watch-deploy.yml …\nAdd these repository secrets: CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET\n$ git add -A && git commit -m "ci: add INDX Watch" && git push -u origin HEAD\n$ gh pr create --fill',
            },
            {
              kind: 'pr',
              title: 'github-actions · INDX Watch · v1.2.0',
              lines: [
                { tone: 'fail', text: 'Not ready to ship: 7 pass · 1 fail · 0 untested' },
                { tone: 'info', text: 'Test cases changed in this PR: + TC-11 Unknown coupon is refused' },
                { tone: 'info', text: 'Suggested test cases: TC-11 TC-3 TC-4' },
                { tone: 'pass', text: 'Check run INDX Watch · iw check passed' },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'cloudflare',
      kicker: 'Phase 3',
      title: 'On your Cloudflare account',
      lead: 'Do the first deploy by hand so you see each part, then hand it to GitHub. Afterwards the team only needs a browser.',
      steps: [
        {
          id: 'deploy',
          title: 'Deploy the app for the first time',
          who: 'Someone with a Cloudflare login · once',
          body: 'Add a `[hosting]` table, create an API token, read the plan, then deploy. `iw deploy` **creates the R2 bucket and D1 database when they are missing**, deploys the Worker and prints its URL. Running it again only deploys a new version.',
          done: '`iw deploy` prints the Worker’s URL. Opening it answers 403 for now: that is expected until step 9.',
          items: [
            'API token: My Profile → API Tokens → the **Edit Cloudflare Workers** template, plus **D1 Edit** and **Workers R2 Storage Edit**',
            'Account ID: dashboard → Workers & Pages',
            'Zero Trust team name: the `<team>` in `<team>.cloudflareaccess.com`',
          ],
          note: 'Nothing in `[hosting]` is secret. Paste tokens into your shell, never into a file.',
          link: { label: 'Self-host on Cloudflare', href: DOCS.selfHost },
          blocks: [
            {
              kind: 'file',
              file: '.indx-watch/project.toml',
              code: '[hosting]\nprovider = "cloudflare"\nname = "shop-watch"        # → https://shop-watch.<subdomain>.workers.dev\naccess_team = "example"    # your Zero Trust team name\n# access_aud = "…"         # step 9',
            },
            {
              kind: 'terminal',
              title: '~/shop',
              code: '$ export CLOUDFLARE_API_TOKEN=…     # paste, never commit\n$ export CLOUDFLARE_ACCOUNT_ID=…\n$ iw deploy --dry-run\nDry run: nothing was changed. Commands:\n  wrangler r2 bucket create shop-watch\n  wrangler d1 create shop-watch\n  wrangler deploy --config …/cache/deploy/wrangler.jsonc\n$ iw deploy',
            },
          ],
        },
        {
          id: 'access',
          title: 'Put Cloudflare Access in front',
          who: 'Cloudflare admin · once',
          body: 'INDX Watch has no login of its own: **Cloudflare Access decides who gets in**, and the Worker checks the Access token on every request. Until `access_aud` is set, the Worker rejects everyone.',
          done: 'The URL asks you to sign in with Access, then shows the same Home as on your laptop.',
          items: [
            'Zero Trust → Access → Applications → **Add an application → Self-hosted**',
            'Domain: `shop-watch.<subdomain>.workers.dev` (or your custom domain)',
            'Policy: **Allow** → Emails ending in `@your-company.com` (or a group)',
            'Copy the **Application Audience (AUD) Tag**, put it in `project.toml`, commit and deploy again',
          ],
          link: { label: 'Put Cloudflare Access in front', href: `${DOCS.selfHost}#3-put-cloudflare-access-in-front` },
          blocks: [
            { kind: 'file', file: '.indx-watch/project.toml', code: '[hosting]\n# …\naccess_aud = "<the AUD tag>"' },
            {
              kind: 'terminal',
              title: '~/shop',
              code: '$ iw deploy\nCloudflare Access: team example.cloudflareaccess.com, audience set. Requests without a valid Access token get 401.',
            },
          ],
        },
        {
          id: 'ci-deploy',
          title: 'Let GitHub deploy on every merge',
          who: 'Repository admin · once',
          body: 'Give the deploy workflow its secrets. **CI signs in to Access with a service token**, so it can publish the test cases and upload results. Then point the project’s store at the app, so CI results show up in it.',
          done: 'The **indx-watch-deploy** run is green, and the app’s **Uploads → Sync status** shows the commit you merged.',
          items: [
            'Zero Trust → Access → Service credentials → Service Tokens → **Create** (the secret is shown once)',
            'On the app, add a policy with action **Service Auth** that includes the token',
            'Add the four repository secrets; `gh secret set` asks for each value, so it never lands in your shell history',
          ],
          note: 'Check first with **Actions → indx-watch-deploy → Run workflow**. From then on, merging a change to `.indx-watch/` redeploys the app and publishes its test cases.',
          link: { label: 'Self-host on Cloudflare from GitHub', href: DOCS.selfHostGithub },
          blocks: [
            {
              kind: 'terminal',
              title: '~/shop',
              code: '$ gh secret set CLOUDFLARE_API_TOKEN\n$ gh secret set CLOUDFLARE_ACCOUNT_ID\n$ gh secret set CF_ACCESS_CLIENT_ID\n$ gh secret set CF_ACCESS_CLIENT_SECRET',
            },
            { kind: 'file', file: '.indx-watch/project.toml', code: '[store]\nurl = "https://shop-watch.example.workers.dev"' },
          ],
        },
        {
          id: 'team',
          title: 'Bring in the team',
          who: 'Lead · per person',
          body: 'Add each person or group to the app’s Access policy once. **Testers just open the URL.** Developers edit test cases on a branch and publish them without any Cloudflare account: `iw deploy` without a Cloudflare login publishes only the definitions, merged with what the app has.',
          done: 'A teammate signs in, sees their assigned test cases and records a run you can see.',
          items: [
            'Roles narrow what each person may do; without `[hosting.roles]` everyone Access lets in is a lead',
            'If someone changed the same file, `iw deploy` stops and names it; `iw pull` writes the app’s version beside yours as a `.conflict` file',
            'Edits made in the app reach git the same way: `iw pull`, review, commit, push',
          ],
          blocks: [
            {
              kind: 'terminal',
              title: 'A teammate’s laptop',
              code: '$ iw login https://shop-watch.example.workers.dev   # once; opens the Access login\n$ git switch -c tests/coupon-limits\n$ iw check\n$ git commit -am "test: coupon limits" && git push -u origin HEAD\n$ iw deploy        # no Cloudflare login: publishes the definitions only',
            },
            {
              kind: 'file',
              file: '.indx-watch/project.toml',
              code: '[hosting.roles]\nlead = ["qa-leads@shop.test"]\ntester = ["qa@shop.test"]\ncustomer = ["uat@shop.test"]',
            },
          ],
        },
      ],
    },
  ],
  daily: {
    kicker: 'Every day after',
    title: 'The loop your team runs.',
    lead: 'Once set up, nobody runs deploy commands by hand. A test change is a pull request; a merge updates the app.',
    steps: [
      { title: 'Branch', body: 'Change a test case or the app, or ask your agent.' },
      { title: 'Pull request', body: '`iw check`, Playwright and one comment.' },
      { title: 'Merge', body: 'The deploy workflow runs `iw deploy`.' },
      { title: 'Test', body: 'The team runs manual tests in the app.' },
      { title: 'Decide', body: '“Can we ship?” and the report.' },
    ],
  },
  recipes: {
    kicker: 'Recipes',
    title: 'If you want to…',
    lead: 'Common next steps, each one command or one table away.',
    items: [
      {
        title: 'Look around before touching your app',
        body: 'A folder with the full sample shop and its results.',
        code: 'npx indx-watch init demo --example\ncd demo && npx indx-watch serve --open',
      },
      {
        title: 'Share results without hosting an app',
        body: 'Any S3-compatible bucket or shared folder as the store; `iw sync` and `iw serve` exchange runs.',
        code: '[store]\nurl = "s3://shop-watch-results/shop"\nregion = "eu-central-1"',
        link: { label: 'S3 sync', href: DOCS.s3 },
      },
      {
        title: 'Host it on your own server or Docker',
        body: 'Behind your SSO proxy, which passes the user’s email in a header.',
        code: 'iw serve --host 0.0.0.0 \\\n  --identity-header X-Forwarded-Email',
        link: { label: 'Node or Docker', href: DOCS.selfHostNode },
      },
      {
        title: 'Invite a customer for UAT',
        body: 'Assigns plan items and adds the email to the Access policy for customers.',
        code: 'iw invite pat@client.test --plan PLAN-1 --items TC-8,TC-9',
      },
      {
        title: 'Send stakeholders a report',
        body: 'One self-contained HTML file; also `md`, `pdf` and `json`.',
        code: 'iw report --format html --out report.html',
        link: { label: 'Reports', href: DOCS.reports },
      },
      {
        title: 'Let Claude run a test in a browser',
        body: 'For test cases with `mode = "agent"`; needs `ANTHROPIC_API_KEY`. Its runs wait for a person’s review.',
        code: 'iw run TC-10',
      },
      {
        title: 'Prepare test data and accounts',
        body: 'Rows, seeds, files and accounts as fixtures; passwords stay `env:` references.',
        code: '/iw-data The review photo tests need data.',
        link: { label: 'Fixtures', href: DOCS.fixtures },
      },
      {
        title: 'See what a branch changes',
        body: 'The use cases, criteria and test cases added, changed or removed since a ref.',
        code: 'iw diff --base origin/main',
      },
      {
        title: 'Upgrade INDX Watch',
        body: 'Shows what is out of date, then moves the package, skills, MCP and workflows to one version.',
        code: 'iw doctor\nnpx indx-watch@latest update',
        link: { label: 'Changelog', href: DOCS.changelog },
      },
    ],
  },
  trouble: {
    kicker: 'Troubleshooting',
    title: 'When a step does not work',
    head: ['What you see', 'What to do'],
    rows: [
      { symptom: '`iw approve` exits with code 2', fix: 'An agent tried to approve. Approvals, reviews and waivers are for people: run the line yourself.' },
      { symptom: 'The Worker answers 403 for everyone', fix: '`[hosting].access_aud` is still empty. Finish step 9 and deploy again.' },
      { symptom: 'The deploy job says “nothing to deploy”', fix: '`project.toml` has no `[hosting]` table (step 8).' },
      { symptom: 'No comment on the pull request', fix: 'The workflow needs `pull-requests: write`; pull requests from forks get none. See the job log.' },
      { symptom: '`iw deploy`: “Commit your changes” or “Push your commit first”', fix: 'Publishing merges with git history, so commit and push the branch, then deploy again.' },
      { symptom: '`iw deploy` stops and names a file', fix: 'Someone changed it too. Run `iw pull`, merge the `.conflict` file, commit, push and deploy again.' },
      { symptom: '“The hosted app runs INDX Watch 0.x”', fix: 'The Worker is older than the version the project pins. Someone with a Cloudflare login (or the workflow on main) deploys it first.' },
    ],
  },
  closing: {
    title: 'Start with one command.',
    lead: 'Everything else on this page builds on it, one step at a time.',
    demo: 'Open the live demo',
  },
  doneLabel: 'You should see',
  flow: {
    label: 'How a change moves',
    play: 'Play',
    pause: 'Pause',
    captions: [
      'You change a test case on a branch, with your agent or by hand.',
      'The pull request is checked, Playwright runs, and one comment says if the release is ready.',
      'On merge, GitHub deploys the app to your Cloudflare account and publishes the test cases.',
      'Your team signs in through Access, runs the tests, and the results come back to every PR.',
    ],
  },
  copy: 'Copy',
  copied: 'Copied',
  you: 'You',
  agent: 'Agent',
  step: 'Step',
};
