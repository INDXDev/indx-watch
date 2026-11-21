import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningKey, verifyRecord } from '@indx-watch/bundle';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { usesGithubOidc } from '../src/adapters/github-oidc.js';
import { processContext, processIdentity, processSigner } from '../src/node/index.js';
import { accessIdentity } from '../src/workers/index.js';
import { runRecord } from './helpers/records.js';

let dir: string;
let repo: string;
const isolated = () => ({ HOME: dir, GIT_CONFIG_GLOBAL: join(dir, 'none'), GIT_CONFIG_NOSYSTEM: '1' });
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, env: { ...process.env, ...isolated() } })
    .toString()
    .trim();

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'iw-id-'));
  repo = join(dir, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git('config', 'user.email', 'alex@shop.test');
  git('config', 'user.name', 'Alex');
  await writeFile(join(repo, 'a.txt'), 'a');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('processIdentity', () => {
  it('uses IW_ACTOR first, with via env', async () => {
    const a = await processIdentity({ env: { IW_ACTOR: 'qa@shop.test', IW_ACTOR_NAME: 'QA' } }).current();
    expect(a).toEqual({ kind: 'human', id: 'qa@shop.test', name: 'QA', via: 'env' });
  });

  it('turns any identity into an agent under IW_ACTOR_KIND=agent, Claude Code or Codex', async () => {
    const env = { ...isolated(), IW_AGENT_MODEL: 'claude-opus-5-5' };
    expect(
      await processIdentity({
        env: { ...env, IW_ACTOR: 'alex@shop.test', IW_ACTOR_KIND: 'agent' },
      }).current(),
    ).toEqual({
      kind: 'agent',
      id: 'alex@shop.test',
      via: 'env',
      model: 'claude-opus-5-5',
    });
    const cc = await processIdentity({ env: { ...env, CLAUDECODE: '1' }, cwd: repo }).current();
    expect(cc).toEqual({
      kind: 'agent',
      id: 'alex@shop.test',
      name: 'Alex',
      via: 'git',
      model: 'claude-opus-5-5',
    });
    const codex = await processIdentity({
      env: { ...isolated(), CODEX_THREAD_ID: 'thr_1' },
      cwd: repo,
    }).current();
    expect(codex.kind).toBe('agent');
  });

  it('uses GitHub Actions identity in CI', async () => {
    const a = await processIdentity({ env: { GITHUB_ACTIONS: 'true', GITHUB_ACTOR: 'octocat' } }).current();
    expect(a).toEqual({ kind: 'ci', id: 'github:octocat', name: 'octocat', via: 'github' });
  });

  it('falls back to git config, then to the OS user with a warning', async () => {
    expect(await processIdentity({ env: isolated(), cwd: repo }).current()).toEqual({
      kind: 'human',
      id: 'alex@shop.test',
      name: 'Alex',
      via: 'git',
    });
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    const a = await processIdentity({ env: { ...isolated(), USER: 'alex' }, cwd: dir }).current();
    expect(a).toEqual({ kind: 'human', id: 'alex', via: 'env' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('processContext', () => {
  it('reads commit, ref and dirty from git locally', async () => {
    const ctx = processContext({ env: isolated(), cwd: repo });
    const head = git('rev-parse', 'HEAD');
    expect(await ctx.build()).toEqual({ commit: head, ref: 'refs/heads/main', dirty: false });
    await writeFile(join(repo, 'b.txt'), 'b');
    expect((await processContext({ env: isolated(), cwd: repo }).build()).dirty).toBe(true);
    expect(await ctx.ci()).toBeUndefined();
    expect(await processContext({ env: isolated(), cwd: dir }).build()).toEqual({});
  });

  it('uses the PR head SHA and number from GITHUB_EVENT_PATH on pull_request', async () => {
    const event = join(dir, 'event.json');
    await writeFile(
      event,
      JSON.stringify({
        pull_request: { number: 12, head: { sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678' } },
      }),
    );
    const env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: event,
      GITHUB_SHA: 'ffffffffffffffffffffffffffffffffffffffff',
      GITHUB_REF: 'refs/pull/12/merge',
      GITHUB_HEAD_REF: 'coupon-fix',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'INDXDev/indx-watch',
      GITHUB_RUN_ID: '1',
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_JOB: 'e2e',
      GITHUB_WORKFLOW: 'CI',
    };
    const ctx = processContext({ env });
    expect(await ctx.build()).toEqual({
      commit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      ref: 'refs/heads/coupon-fix',
      dirty: false,
    });
    expect(await ctx.ci()).toEqual({
      provider: 'github',
      url: 'https://github.com/INDXDev/indx-watch/actions/runs/1/attempts/2',
      run_id: '1',
      run_attempt: 2,
      job: 'e2e',
      workflow: 'CI',
      event: 'pull_request',
      repository: 'INDXDev/indx-watch',
      pr: 12,
    });
    // with `IW_CHECK_RUN_ID: ${{ job.check_run_id }}` the link opens the job; a non-number is ignored
    const job = (id: string) => processContext({ env: { ...env, IW_CHECK_RUN_ID: id } }).ci();
    expect((await job('135996031339'))?.url).toBe(
      'https://github.com/INDXDev/indx-watch/actions/runs/1/job/135996031339',
    );
    expect((await job('x'))?.url).toBe('https://github.com/INDXDev/indx-watch/actions/runs/1/attempts/2');
    const push = processContext({
      env: {
        ...env,
        GITHUB_EVENT_NAME: 'push',
        GITHUB_EVENT_PATH: join(dir, 'missing.json'),
        GITHUB_HEAD_REF: '',
      },
    });
    expect(await push.build()).toEqual({
      commit: 'ffffffffffffffffffffffffffffffffffffffff',
      ref: 'refs/pull/12/merge',
      dirty: false,
    });
    // an empty or invalid event file (act, local GITHUB_ACTIONS=true runs) is treated as no event
    for (const text of ['', '{not json', 'null']) {
      await writeFile(event, text);
      const ctx = processContext({ env: { ...env, GITHUB_HEAD_REF: '' } });
      expect((await ctx.build()).commit).toBe('ffffffffffffffffffffffffffffffffffffffff');
      expect((await ctx.ci())?.pr).toBeUndefined();
    }
  });
});

describe('GitLab CI, CircleCI and Buildkite', () => {
  const sha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  const cases = [
    {
      env: {
        GITLAB_CI: 'true',
        CI_COMMIT_SHA: sha,
        CI_COMMIT_REF_NAME: 'coupon-fix',
        GITLAB_USER_LOGIN: 'alex',
        CI_MERGE_REQUEST_IID: '12',
        CI_JOB_URL: 'https://gitlab.com/shop/web/-/jobs/7',
        CI_PIPELINE_ID: '1001',
        CI_JOB_NAME: 'e2e',
        CI_PIPELINE_SOURCE: 'merge_request_event',
        CI_PROJECT_PATH: 'shop/web',
        GITLAB_USER_NAME: 'Alex Kim',
        CI_JOB_RETRY_COUNT: '0',
      },
      ref: 'refs/heads/coupon-fix',
      actor: { kind: 'ci', id: 'gitlab:alex', name: 'Alex Kim', via: 'gitlab' },
      ci: {
        provider: 'gitlab',
        url: 'https://gitlab.com/shop/web/-/jobs/7',
        run_id: '1001',
        run_attempt: 1,
        job: 'e2e',
        event: 'merge_request_event',
        repository: 'shop/web',
        pr: 12,
      },
    },
    {
      env: {
        CIRCLECI: 'true',
        CIRCLE_SHA1: sha,
        CIRCLE_BRANCH: 'main',
        CIRCLE_TAG: 'v1.4.0',
        CIRCLE_USERNAME: 'sam',
        CIRCLE_PULL_REQUEST: 'https://github.com/shop/web/pull/34',
        CIRCLE_BUILD_URL: 'https://circleci.com/gh/shop/web/88',
        CIRCLE_WORKFLOW_ID: 'wf-1',
        CIRCLE_JOB: 'e2e',
      },
      ref: 'refs/tags/v1.4.0',
      actor: { kind: 'ci', id: 'circleci:sam', name: 'sam', via: 'circleci' },
      ci: {
        provider: 'circleci',
        url: 'https://circleci.com/gh/shop/web/88',
        run_id: 'wf-1',
        job: 'e2e',
        pr: 34,
      },
    },
    {
      env: {
        BUILDKITE: 'true',
        BUILDKITE_COMMIT: 'HEAD', // not a SHA: IW_COMMIT, else the checkout
        IW_COMMIT: sha,
        BUILDKITE_BRANCH: 'main',
        BUILDKITE_BUILD_CREATOR: 'Kim Lee',
        BUILDKITE_BUILD_CREATOR_EMAIL: 'kim@shop.test',
        BUILDKITE_RETRY_COUNT: '2',
        BUILDKITE_PULL_REQUEST: 'false',
        BUILDKITE_BUILD_URL: 'https://buildkite.com/shop/web/builds/5',
        BUILDKITE_BUILD_ID: 'b-5',
        BUILDKITE_LABEL: ':playwright: e2e',
        BUILDKITE_PIPELINE_SLUG: 'web',
        BUILDKITE_SOURCE: 'webhook',
      },
      ref: 'refs/heads/main',
      actor: { kind: 'ci', id: 'buildkite:kim@shop.test', name: 'Kim Lee', via: 'buildkite' },
      ci: {
        provider: 'buildkite',
        url: 'https://buildkite.com/shop/web/builds/5',
        run_id: 'b-5',
        run_attempt: 3,
        job: ':playwright: e2e',
        workflow: 'web',
        event: 'webhook',
      },
    },
  ];
  it.each(cases)('detects $ci.provider from its standard variables', async ({ env, ref, actor, ci }) => {
    expect(await processIdentity({ env }).current()).toEqual(actor);
    const ctx = processContext({ env });
    expect(await ctx.build()).toEqual({ commit: sha, ref, dirty: false });
    expect(await ctx.ci()).toEqual(ci);
  });

  it('prefers IW_ACTOR and GitHub Actions, and falls back to git without a user', async () => {
    const env = cases[0]!.env;
    expect((await processIdentity({ env: { ...env, IW_ACTOR: 'qa@shop.test' } }).current()).via).toBe('env');
    const both = { ...env, GITHUB_ACTIONS: 'true', GITHUB_ACTOR: 'octocat', GITHUB_RUN_ID: '1' };
    expect((await processIdentity({ env: both }).current()).via).toBe('github');
    expect((await processContext({ env: both }).ci())?.provider).toBe('github');
    const scheduled = { ...isolated(), ...env, GITLAB_USER_LOGIN: '' };
    expect((await processIdentity({ env: scheduled, cwd: repo }).current()).via).toBe('git');
  });

  it('takes the first provider in table order, ignores a non-numeric PR and falls back to the checkout commit', async () => {
    const env = { ...cases[1]!.env, ...cases[2]!.env, CIRCLE_PULL_REQUEST: 'none', IW_COMMIT: undefined };
    const ci = await processContext({ env }).ci();
    expect(ci).toMatchObject({ provider: 'circleci', run_id: 'wf-1' });
    expect(ci?.pr).toBeUndefined();
    const bk = { ...isolated(), ...cases[2]!.env, IW_COMMIT: undefined };
    expect((await processContext({ env: bk, cwd: repo }).build()).commit).toBe(git('rev-parse', 'HEAD'));
  });
});

describe('accessIdentity', () => {
  it('verifies the Access JWT against the team JWKS, issuer and aud', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
    const real = globalThis.fetch;
    const fetchSpy = vi.fn(async (input: Request | string | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === 'https://shop.cloudflareaccess.com/cdn-cgi/access/certs')
        return Response.json({ keys: [jwk] });
      return real(input);
    });
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const sign = (
        claims: Record<string, unknown>,
        aud = 'aud-tag',
        iss = 'https://shop.cloudflareaccess.com',
      ) =>
        new SignJWT(claims)
          .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
          .setIssuer(iss)
          .setAudience(aud)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(privateKey);
      const id = accessIdentity({ team: 'shop', aud: 'aud-tag' });
      const req = async (token?: string) =>
        new Request(
          'https://watch.shop.test/api/runs',
          token ? { headers: { 'Cf-Access-Jwt-Assertion': token } } : {},
        );
      expect(await id.current(await req(await sign({ email: 'alex@shop.test', sub: 'u1' })))).toEqual({
        kind: 'human',
        id: 'alex@shop.test',
        via: 'cloudflare-access',
      });
      expect(await id.current(await req(await sign({ sub: '', common_name: 'abc.access' })))).toEqual({
        kind: 'ci',
        id: 'ci:access:abc.access',
        via: 'cloudflare-access',
      });
      await expect(id.current(await req())).rejects.toMatchObject({ code: 'unauthorized' });
      await expect(id.current(await req(await sign({ email: 'a@b.c' }, 'other-aud')))).rejects.toMatchObject({
        code: 'unauthorized',
      });
      await expect(
        id.current(await req(await sign({ email: 'a@b.c' }, 'aud-tag', 'https://evil.cloudflareaccess.com'))),
      ).rejects.toMatchObject({
        code: 'unauthorized',
      });
      const other = await generateKeyPair('RS256');
      const forged = await new SignJWT({ email: 'a@b.c' })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer('https://shop.cloudflareaccess.com')
        .setAudience('aud-tag')
        .setExpirationTime('5m')
        .sign(other.privateKey);
      await expect(id.current(await req(forged))).rejects.toMatchObject({ code: 'unauthorized' });
      await expect(id.current()).rejects.toMatchObject({ code: 'unauthorized' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('GitHub OIDC signer choice (docs/spec/security.md#github-oidc)', () => {
  const oidc = {
    GITHUB_ACTIONS: 'true',
    GITHUB_ACTOR: 'octocat',
    IW_OIDC_SIGNER: 'http://watch.test',
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://gh.test/token',
  };

  it('signs through OIDC only when the actor is GITHUB_ACTOR and no IW_SIGNING_KEY is set', async () => {
    expect(usesGithubOidc(oidc)).toBe(true);
    expect(() => processSigner(oidc)).toThrow(/https/); // the OIDC signer was chosen (and refuses http://)
    for (const env of [{ IW_ACTOR: 'bot@shop.test' }, { GITHUB_ACTOR: '' }, { IW_SIGNING_KEY: 'k' }])
      expect(usesGithubOidc({ ...oidc, ...env })).toBe(false);
  });

  it('keeps IW_ACTOR records via env and unsigned instead of failing the exchange', async () => {
    const env = { ...oidc, IW_ACTOR: 'bot@shop.test', IW_ACTOR_KIND: 'ci' };
    expect((await processIdentity({ env }).current()).via).toBe('env');
    const r = runRecord();
    expect(await processSigner(env)(r)).toEqual(r);
  });

  it('prefers IW_SIGNING_KEY over OIDC', async () => {
    const { secret, key } = await generateSigningKey('ci');
    const signed = await processSigner({ ...oidc, IW_SIGNING_KEY: secret })(runRecord());
    expect(await verifyRecord(signed, [key])).toBe(true);
  });
});

describe('accessIdentity groups', () => {
  it('reads group IDs, names and emails from get-identity with the token as the CF_Authorization cookie', async () => {
    const calls: { url: string; cookie: string | null }[] = [];
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), cookie: new Headers(init?.headers).get('cookie') });
      if (String(init?.headers && new Headers(init.headers).get('cookie')).includes('broken'))
        return new Response('no', { status: 403 });
      const groups = [{ id: 'g1', name: 'QA Leads', email: 'qa-leads@shop.test' }, 'uat', { name: '' }];
      return Response.json({ email: 'alex@shop.test', groups });
    }) as typeof fetch;
    const id = accessIdentity({ team: 'shop', aud: 'aud-tag', fetch: fake });
    const req = (token: string) =>
      new Request('https://watch.shop.test/api/runs', { headers: { 'Cf-Access-Jwt-Assertion': token } });
    expect(await id.groups!(req('tok-1'))).toEqual(['g1', 'QA Leads', 'qa-leads@shop.test', 'uat']);
    expect(calls[0]).toEqual({
      url: 'https://shop.cloudflareaccess.com/cdn-cgi/access/get-identity',
      cookie: 'CF_Authorization=tok-1',
    });
    await id.groups!(req('tok-1')); // cached per token
    expect(calls).toHaveLength(1);
    expect(await id.groups!(req('broken'))).toEqual([]); // a failed lookup means no groups
    expect(await id.groups!(new Request('https://watch.shop.test/'))).toEqual([]);
    expect(calls).toHaveLength(2);
  });
});
