/** プロセスの ID とビルド文脈（docs/spec/security.md#identity, docs/spec/integrations.md#ci-identity）。 */
import { readFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import type { Actor, Build, CiContext } from '@indx-watch/bundle';
import type { ContextProvider, IdentityProvider } from '../ports.js';
import { compact } from '../util.js';
import { exec } from './exec.js';

type Env = Record<string, string | undefined>;
interface Opts {
  env?: Env;
  cwd?: string;
}

/**
 * コーディングエージェントの環境マーカー（docs/research/platform-notes.md#agent-skills）。
 * Claude Code: CLAUDECODE=1。Codex: シェルツールの子プロセスに CODEX_THREAD_ID / CODEX_SESSION_ID を入れる
 * （openai/codex codex-rs/core/src/exec_env.rs）。
 */
export function isAgentEnv(env: Env): boolean {
  return (
    env.IW_ACTOR_KIND === 'agent' || env.CLAUDECODE === '1' || !!env.CODEX_THREAD_ID || !!env.CODEX_SESSION_ID
  );
}

const isGithub = (env: Env) => env.GITHUB_ACTIONS === 'true';

/** IW_ACTOR → GitHub Actions → git config → OS ユーザー。エージェント検出は出所に関係なく kind を agent にする。 */
export function processIdentity(opts: Opts = {}): IdentityProvider {
  const env = opts.env ?? process.env;
  const gitEnv = { ...process.env, ...env };
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

/** Git と GitHub Actions の環境変数からビルド・CI 文脈を作る。 */
export function processContext(opts: Opts = {}): ContextProvider {
  const env = opts.env ?? process.env;
  const gitEnv = { ...process.env, ...env };
  let event: Promise<GithubEvent> | undefined;
  const readEvent = () =>
    (event ??= env.GITHUB_EVENT_PATH
      ? readFile(env.GITHUB_EVENT_PATH, 'utf8').then(
          (t) => JSON.parse(t) as GithubEvent,
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
      const commit = sha(env.IW_COMMIT) ?? sha(await git('rev-parse', 'HEAD'));
      if (!commit) return {};
      const status = await git('status', '--porcelain');
      const dirty = status === undefined ? undefined : status.trim() !== '';
      return compact({ commit, ref: await git('symbolic-ref', '-q', 'HEAD'), dirty });
    },
    async ci(): Promise<CiContext | undefined> {
      if (!isGithub(env)) return undefined;
      const pr = (await readEvent()).pull_request?.number;
      const {
        GITHUB_SERVER_URL: server,
        GITHUB_REPOSITORY: repo,
        GITHUB_RUN_ID: id,
        GITHUB_RUN_ATTEMPT: n,
      } = env;
      return compact({
        provider: 'github',
        url:
          server && repo && id
            ? `${server}/${repo}/actions/runs/${id}${n ? `/attempts/${n}` : ''}`
            : undefined,
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
