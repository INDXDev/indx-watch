/** GitHub files of `iw init --github` and the bundle at a git ref (docs/spec/cli.md#iw-init, #iw-diff). */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BundleFs } from '@indx-watch/bundle';
import type { InitGithubData } from './json.js';
import { asset } from './util.js';

export type GithubFile = { path: string; content: string };
/** Issue forms of the test request and the test failure (docs/spec/integrations.md#issue-templates). */
export function githubTemplates(): GithubFile[] {
  return [];
}

/** Repository secrets the deploy workflow reads (docs/guides/self-host-cloudflare-from-github.md). */
const SECRETS = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];

/** Write the check and deploy workflows and the issue templates under `root`, only what is missing. */
export function initGithub(root: string): InitGithubData {
  const from = asset('github', 'packages/cli/github');
  const flows = ['indx-watch', 'indx-watch-deploy'].map((n) => ({
    path: `.github/workflows/${n}.yml`,
    content: readFileSync(join(from, `${n}.yml`), 'utf8'),
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
