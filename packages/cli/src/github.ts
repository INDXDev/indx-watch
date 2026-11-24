/** GitHub files and issues around the CLI (docs/spec/integrations.md#github-issues, docs/spec/cli.md#iw-init, #iw-diff): workflows, issue templates, the repository, opening a page, the bundle at a git ref. */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BundleFs } from '@indx-watch/bundle';
import { repoOfRemote } from '@indx-watch/core';
import type { Project } from './context.js';
import type { InitGithubData } from './json.js';
import { asset, git } from './util.js';
import { VERSION } from './version.js';

/** A file `iw init --github` writes, relative to the repository root. */
export interface GithubFile {
  path: string;
  content: string;
}

const REQUEST = `name: INDX Watch test request
description: Ask for something to be tested. A person turns it into a use case with \`iw import github-issue\`.
title: "[Test request] "
labels: ["indx-watch"]
body:
  - type: input
    id: actor
    attributes:
      label: Actor
      description: Who needs this? A role, such as "shopper" or "support agent".
    validations:
      required: true
  - type: textarea
    id: goal
    attributes:
      label: Goal
      description: What should they be able to do?
    validations:
      required: true
  - type: dropdown
    id: priority
    attributes:
      label: Priority
      description: P0 blocks a release, P3 is nice to have.
      options: ["P0", "P1", "P2", "P3"]
      default: 1
    validations:
      required: true
  - type: textarea
    id: criteria
    attributes:
      label: Acceptance criteria
      description: One checkbox per criterion. Each becomes an acceptance criterion.
      value: |
        - [ ]
        - [ ]
    validations:
      required: true
`;

const FAILURE = `name: INDX Watch test failure
description: A test case failed. iw issue <run> opens this form already filled in.
title: "[Test failure] "
labels: ["indx-watch"]
body:
  - type: input
    id: keys
    attributes:
      label: Test cases
      description: The test case, criterion or use case keys, such as TC-3.
    validations:
      required: true
  - type: textarea
    id: steps
    attributes:
      label: Steps
      description: What was done, in order.
  - type: textarea
    id: expected
    attributes:
      label: Expected
      description: What should have happened.
  - type: textarea
    id: actual
    attributes:
      label: Actual
      description: What happened instead.
    validations:
      required: true
  - type: input
    id: run
    attributes:
      label: Run
      description: The run in INDX Watch (link or ID).
  - type: input
    id: commit
    attributes:
      label: Commit
  - type: input
    id: environment
    attributes:
      label: Environment
`;

/** The issue forms `iw init --github` writes (only those missing) and /iw-setup offers; ids are fixed (docs/roadmap.md#shared-names). */
export function githubTemplates(): GithubFile[] {
  return [
    { path: '.github/ISSUE_TEMPLATE/indx-watch-test-request.yml', content: REQUEST },
    { path: '.github/ISSUE_TEMPLATE/indx-watch-test-failure.yml', content: FAILURE },
  ];
}

/** `owner/name` from `[github] repo`, else the `origin` remote of the working copy; undefined when neither names GitHub. */
export const repoOf = (p: Project): string | undefined =>
  p.bundle.project.data.github?.repo ?? repoOfRemote(git(p.root, 'remote', 'get-url', 'origin'));

/** Open a URL in the default browser (a person's command; the page asks them to submit). */
export function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url.replaceAll('&', '^&')]]
        : ['xdg-open', [url]];
  spawn(cmd!, args as string[], { stdio: 'ignore', detached: true })
    .on('error', () => undefined)
    .unref();
}

/** Repository secrets the deploy workflow reads (docs/guides/self-host-cloudflare-from-github.md). */
const SECRETS = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];

/** Write the check and deploy workflows and the issue templates under `root`, only what is missing. */
export function initGithub(root: string, pin: string = VERSION): InitGithubData {
  const from = asset('github', 'packages/cli/github');
  const flows = ['indx-watch', 'indx-watch-deploy'].map((n) => ({
    path: `.github/workflows/${n}.yml`,
    // `iw update` keeps the pinned version in step with [tool] (docs/spec/cli.md#iw-update)
    content: readFileSync(join(from, `${n}.yml`), 'utf8').replaceAll(
      'npx --yes indx-watch ',
      `npx --yes indx-watch@${pin} `,
    ),
  }));
  const data: InitGithubData = { root, written: [], skipped: [], secrets: [] };
  for (const f of [...flows, ...githubTemplates()]) {
    const file = join(root, f.path);
    if (existsSync(file)) data.skipped.push(f.path);
    else {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, f.content);
      data.written.push(f.path);
    }
  }
  if (data.written.some((p) => p.endsWith('-deploy.yml'))) data.secrets = SECRETS;
  return data;
}

/** A read-only view of the bundle as committed at `ref`; `prefix` is the bundle's path from the repository root. */
export function gitFs(root: string, ref: string, prefix: string): BundleFs {
  const run = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 });
  const at = (p: string) => `${ref}:${[prefix, p].filter(Boolean).join('/')}`;
  return {
    async read(p) {
      try {
        return new Uint8Array(run('show', at(p)));
      } catch {
        return null;
      }
    },
    async list(dir) {
      try {
        return String(run('ls-tree', '-z', at(dir)))
          .split('\0')
          .filter(Boolean)
          .flatMap((e) => {
            const [meta = '', name = ''] = e.split('\t');
            return meta.includes(' blob ') || meta.includes(' tree ')
              ? [{ name, dir: meta.includes(' tree ') }]
              : [];
          });
      } catch {
        return [];
      }
    },
    async write() {
      throw new Error('read-only');
    },
    async remove() {
      throw new Error('read-only');
    },
  };
}
