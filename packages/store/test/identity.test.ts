import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { processContext, processIdentity } from '../src/node/index.js';
import { accessIdentity } from '../src/workers/index.js';

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
