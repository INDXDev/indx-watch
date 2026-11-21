/** Identity and build context of this process (docs/spec/security.md#identity, docs/spec/integrations.md#ci-identity). */
import { readFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import type { Actor, Build, CiContext, Via } from '@indx-watch/bundle';
import type { ContextProvider, IdentityProvider } from '../ports.js';
import { compact, parseJson } from '../util.js';
import { exec } from './exec.js';

type Env = Record<string, string | undefined>;
interface Opts {
  env?: Env;
  cwd?: string;
}

/**
 * Environment markers of coding agents (docs/research/platform-notes.md#agent-skills).
 * Claude Code: CLAUDECODE=1. Codex sets CODEX_THREAD_ID / CODEX_SESSION_ID in the child processes of its shell tool
 * (openai/codex codex-rs/core/src/exec_env.rs).
 */
export function isAgentEnv(env: Env): boolean {
  return (
    env.IW_ACTOR_KIND === 'agent' || env.CLAUDECODE === '1' || !!env.CODEX_THREAD_ID || !!env.CODEX_SESSION_ID
  );
}

const isGithub = (env: Env) => env.GITHUB_ACTIONS === 'true';

/**
 * GitLab CI, CircleCI and Buildkite by their standard variables (docs/spec/integrations.md#ci-identity-and-context):
 * the marker set to 'true', then one variable per field of FIELDS ('-' = none).
 */
const FIELDS = 'commit branch tag user pr url run_id job workflow event repository'.split(' ');
const PROVIDERS = Object.entries({
  gitlab:
    'GITLAB_CI CI_COMMIT_SHA CI_COMMIT_REF_NAME CI_COMMIT_TAG GITLAB_USER_LOGIN CI_MERGE_REQUEST_IID CI_JOB_URL CI_PIPELINE_ID CI_JOB_NAME - CI_PIPELINE_SOURCE CI_PROJECT_PATH',
  circleci:
    'CIRCLECI CIRCLE_SHA1 CIRCLE_BRANCH CIRCLE_TAG CIRCLE_USERNAME CIRCLE_PULL_REQUEST CIRCLE_BUILD_URL CIRCLE_WORKFLOW_ID CIRCLE_JOB - - -',
  buildkite:
    'BUILDKITE BUILDKITE_COMMIT BUILDKITE_BRANCH BUILDKITE_TAG BUILDKITE_BUILD_CREATOR BUILDKITE_PULL_REQUEST BUILDKITE_BUILD_URL BUILDKITE_BUILD_ID BUILDKITE_LABEL BUILDKITE_PIPELINE_SLUG BUILDKITE_SOURCE -',
});
/** The detected provider other than GitHub Actions (which wins) and the values of its FIELDS. */
function otherCi(env: Env) {
  if (isGithub(env)) return undefined;
  for (const [provider, row] of PROVIDERS) {
    const [on, ...vals] = row.split(' ').map((k) => env[k]);
    if (on === 'true')
      return { provider: provider as Via, v: Object.fromEntries(FIELDS.map((f, i) => [f, vals[i]])) };
  }
}

/** IW_ACTOR → GitHub Actions → GitLab / CircleCI / Buildkite → git config → OS user. A detected agent makes the kind 'agent' whatever the source. */
export function processIdentity(opts: Opts = {}): IdentityProvider {
  const env = opts.env ?? process.env;
  const gitEnv = { ...process.env, ...env };
  const other = otherCi(env);
  let cached: Promise<Actor> | undefined;
  const git = async (key: string) =>
    (await exec('git', ['config', key], { cwd: opts.cwd, env: gitEnv }))?.trim() || undefined;

  async function resolve(): Promise<Actor> {
    let a: Actor;
    if (env.IW_ACTOR) {
      const kind = env.IW_ACTOR_KIND === 'ci' || env.IW_ACTOR_KIND === 'agent' ? env.IW_ACTOR_KIND : 'human';
      a = compact({ kind, id: env.IW_ACTOR, name: env.IW_ACTOR_NAME, via: 'env' });
    } else if (isGithub(env) && env.GITHUB_ACTOR) {
      a = { kind: 'ci', id: `github:${env.GITHUB_ACTOR}`, name: env.GITHUB_ACTOR, via: 'github' };
    } else if (other?.v.user) {
      a = { kind: 'ci', id: `${other.provider}:${other.v.user}`, name: other.v.user, via: other.provider };
    } else {
      const [email, name] = [await git('user.email'), await git('user.name')];
      if (email) a = compact({ kind: 'human', id: email, name, via: 'git' });
      else {
        const user = env.USER || env.USERNAME || safeUser() || 'unknown';
        process.emitWarning(`no git identity; recording OS user "${user}" (set IW_ACTOR or git user.email)`);
        a = { kind: 'human', id: user, via: 'env' };
      }
    }
    if (isAgentEnv(env)) {
      a.kind = 'agent';
      if (env.IW_AGENT_MODEL) a.model = env.IW_AGENT_MODEL;
    }
    return a;
  }
  return {
    current: () => {
      cached ??= resolve();
      return cached.then((a) => ({ ...a }));
    },
  };
}

const safeUser = () => {
  try {
    return userInfo().username;
  } catch {}
};

interface GithubEvent {
  pull_request?: { number?: number; head?: { sha?: string } };
  deployment?: { sha?: string };
}

/** Build and CI context from git and the variables of GitHub Actions, GitLab CI, CircleCI or Buildkite. */
export function processContext(opts: Opts = {}): ContextProvider {
  const env = opts.env ?? process.env;
  const gitEnv = { ...process.env, ...env };
  const other = otherCi(env);
  let event: Promise<GithubEvent> | undefined;
  const readEvent = () =>
    (event ??= env.GITHUB_EVENT_PATH
      ? readFile(env.GITHUB_EVENT_PATH).then(
          (b) => (parseJson(b) as GithubEvent | null | undefined) ?? {}, // empty or invalid: no event
          (): GithubEvent => ({}),
        )
      : Promise.resolve<GithubEvent>({}));
  const git = async (...args: string[]) =>
    (await exec('git', args, { cwd: opts.cwd, env: gitEnv }))?.replace(/\n$/, '');
  const sha = (s: string | undefined) => (s && /^[0-9a-f]{7,64}$/.test(s) ? s : undefined);

  return {
    async build(): Promise<Build> {
      if (isGithub(env)) {
        const ev = await readEvent();
        const commit =
          sha(env.IW_COMMIT) ??
          sha(ev.pull_request?.head?.sha) ??
          sha(ev.deployment?.sha) ??
          sha(env.GITHUB_SHA);
        const ref = env.GITHUB_HEAD_REF ? `refs/heads/${env.GITHUB_HEAD_REF}` : env.GITHUB_REF;
        return compact({ commit, ref, dirty: false });
      }
      if (other) {
        const { commit, branch, tag } = other.v;
        const ref = tag ? `refs/tags/${tag}` : branch ? `refs/heads/${branch}` : undefined;
        return compact({ commit: sha(env.IW_COMMIT) ?? sha(commit), ref, dirty: false });
      }
      const commit = sha(env.IW_COMMIT) ?? sha(await git('rev-parse', 'HEAD'));
      if (!commit) return {};
      const status = await git('status', '--porcelain');
      const dirty = status === undefined ? undefined : status.trim() !== '';
      return compact({ commit, ref: await git('symbolic-ref', '-q', 'HEAD'), dirty });
    },
    async ci(): Promise<CiContext | undefined> {
      if (other) {
        const { commit, branch, tag, user, pr, ...fields } = other.v;
        const n = /(\d+)$/.exec(pr ?? '')?.[1]; // a number or a PR URL; Buildkite sets 'false'
        return compact({ provider: other.provider, ...fields, pr: n ? Number(n) : undefined });
      }
      if (!isGithub(env)) return undefined;
      const pr = (await readEvent()).pull_request?.number;
      const {
        GITHUB_SERVER_URL: server,
        GITHUB_REPOSITORY: repo,
        GITHUB_RUN_ID: id,
        GITHUB_RUN_ATTEMPT: n,
        IW_CHECK_RUN_ID: job,
      } = env;
      // The job page when the workflow passes `IW_CHECK_RUN_ID: ${{ job.check_run_id }}`, else the run attempt.
      const page = job && /^\d+$/.test(job) ? `/job/${job}` : n ? `/attempts/${n}` : '';
      return compact({
        provider: 'github',
        url: server && repo && id ? `${server}/${repo}/actions/runs/${id}${page}` : undefined,
        run_id: id,
        run_attempt: n && /^\d+$/.test(n) ? Number(n) : undefined,
        job: env.GITHUB_JOB,
        workflow: env.GITHUB_WORKFLOW,
        event: env.GITHUB_EVENT_NAME,
        repository: repo,
        pr: Number.isInteger(pr) ? pr : undefined,
      });
    },
  };
}
