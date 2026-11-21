/** `iw invite` (docs/spec/cli.md#iw-invite-email, docs/spec/security.md#customer-uat) on a temp copy of examples/shop. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseToml } from '@indx-watch/bundle';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeAccessApi } from '../../store/test/helpers/fakes.js';
import { makeCtx } from '../src/cli.js';
import { COMMANDS } from '../src/commands/index.js';
import { cleanEnv, iwJson, shop } from './helpers.js';

const PLAN = '.indx-watch/plans/PLAN-1-v1-2-0-regression.toml';
const items = (dir: string) =>
  (parseToml(readFileSync(join(dir, PLAN), 'utf8')) as { items: { test_case: string; assignee?: string }[] })
    .items;
const assigned = (dir: string, email: string) =>
  items(dir)
    .filter((i) => i.assignee === email)
    .map((i) => i.test_case);

describe('iw invite', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('assigns plan items through formatToml and adds the email to the Access policy; --revoke removes both', async () => {
    const dir = shop();
    const api = fakeAccessApi();
    vi.stubGlobal(
      'fetch',
      async (url: string, init?: RequestInit) => (await api.fetch(url, init)) ?? Response.error(),
    );
    const ctx = makeCtx(cleanEnv({ IW_ACCESS_POLICY: 'acc/pol', CLOUDFLARE_API_TOKEN: 'cf-token' }), dir);
    const run = (a: Record<string, string | boolean>) =>
      COMMANDS.invite!.run(ctx, { email: 'pat@client.test', ...a });
    const r = await run({ plan: 'PLAN-1', items: 'TC-8,TC-9' });
    expect(r.data).toMatchObject({
      items: ['TC-8', 'TC-9'],
      access: 'added',
      revoked: false,
      file: 'plans/PLAN-1-v1-2-0-regression.toml',
    });
    expect(assigned(dir, 'pat@client.test')).toEqual(['TC-8', 'TC-9']);
    expect(api.emails()).toContain('pat@client.test');
    // still assigned to TC-9: the policy entry stays
    expect((await run({ plan: 'PLAN-1', items: 'TC-8', revoke: true })).data).toMatchObject({
      access: 'kept',
    });
    expect(assigned(dir, 'pat@client.test')).toEqual(['TC-9']);
    expect((await run({ plan: 'PLAN-1', revoke: true })).data).toMatchObject({
      access: 'removed',
      items: ['TC-9'],
    });
    expect(assigned(dir, 'pat@client.test')).toEqual([]);
    expect(items(dir).find((i) => i.test_case === 'TC-6')?.assignee).toBe('alex@shop.test');
    expect(api.emails()).not.toContain('pat@client.test');
    await expect(run({ plan: 'PLAN-1', items: 'TC-1' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // without --items: only the unassigned items; naming an assigned one reassigns it and says so
    const before = items(dir);
    const all = await run({ plan: 'plan-1' });
    const free = before.filter((i) => !i.assignee).map((i) => i.test_case);
    expect(all.data).toMatchObject({ items: free, reassigned: [] });
    expect(items(dir).filter((i) => i.assignee !== 'pat@client.test')).toEqual(
      before.filter((i) => i.assignee),
    );
    expect((await run({ plan: 'PLAN-1', items: 'TC-6' })).data).toMatchObject({ reassigned: ['TC-6'] });
    await run({ plan: 'PLAN-1', revoke: true });
    // a failed API call: the plan is written, exit 4
    const failing = makeCtx(cleanEnv({ IW_ACCESS_POLICY: 'acc/pol', CLOUDFLARE_API_TOKEN: 'wrong' }), dir);
    await expect(
      COMMANDS.invite!.run(failing, { email: 'pat@client.test', plan: 'PLAN-1', items: 'TC-9' }),
    ).rejects.toMatchObject({
      code: 'EXTERNAL_TOOL',
    });
    expect(assigned(dir, 'pat@client.test')).toEqual(['TC-9']);
  });

  it('--json without a policy says manual and warns; agents and bundles without [hosting.roles] are refused', () => {
    const dir = shop();
    const ok = iwJson(dir, 'invite', ['invite', 'pat@client.test', '--plan', 'PLAN-1', '--items', 'TC-9']);
    expect([ok.code, ok.json.data.access, ok.json.warnings[0].code]).toEqual([0, 'manual', 'access-manual']);
    expect(iwJson(dir, 'check', ['check']).code).toBe(0);
    const agent = iwJson(dir, 'invite', ['invite', 'pat@client.test', '--plan', 'PLAN-1'], {
      env: { CLAUDECODE: '1' },
    });
    expect(agent.code).toBe(2);
    const project = join(dir, '.indx-watch/project.toml');
    writeFileSync(project, readFileSync(project, 'utf8').replace(/\[hosting\.roles\][^[]*/, ''));
    const noRoles = iwJson(dir, 'invite', ['invite', 'pat@client.test', '--plan', 'PLAN-1']);
    expect([noRoles.code, noRoles.json.error.code]).toEqual([3, 'INVALID_CONFIG']);
  });
});
