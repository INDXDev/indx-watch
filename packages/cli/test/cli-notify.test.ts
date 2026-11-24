/** `iw notify` and `iw insights` (docs/spec/cli.md#iw-notify, #iw-insights). */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Notification } from '@indx-watch/store';
import { afterEach, describe, expect, it } from 'vitest';
import { notifyCommands, notifyDeps, sinceOf } from '../src/commands/notify.js';
import { cleanEnv, iw, iwJson, shop } from './helpers.js';

const STATE = (dir: string) => join(dir, '.indx-watch/cache/notify-state.json');
const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/SECRETSECRET';
/** A shop copy with `[notify]` and its sample results pulled into the replica. */
function ready(extra = '') {
  const dir = shop();
  appendFileSync(
    join(dir, '.indx-watch/project.toml'),
    `\n[notify]\nslack_webhook = "env:SLACK_WEBHOOK_URL"\napp_url = "https://watch.shop.test"\n${extra}`,
  );
  expect(iw(dir, ['sync', '--pull-only']).code).toBe(0);
  return dir;
}

describe('iw insights', () => {
  it('prints the numbers of the Insights view as data and as small tables', () => {
    const dir = ready();
    const r = iwJson(dir, 'insights', ['insights']);
    expect(r.code, r.stderr).toBe(0);
    const d = r.json.data;
    expect(d.release).toBe('v1.2.0');
    expect(d.releases.map((x: { version: string }) => x.version)).toEqual(['v1.2.0']);
    expect(d.assignees.map((x: { assignee: string }) => x.assignee)).toContain('ci');
    expect(d.features.length).toBeGreaterThan(0);
    const text = iw(dir, ['insights']).stdout;
    expect(text).toContain('Release  pass rate  coverage');
    expect(text).toContain('Median manual run:');
  });
});

describe('iw notify', () => {
  it('first run writes the baseline and sends nothing; a dry run keeps no state', () => {
    const dir = ready();
    const dry = iwJson(dir, 'notify', ['notify', '--dry-run']);
    expect(dry.json.data).toMatchObject({ sent: 0, dryRun: true, baseline: true, messages: [] });
    expect(existsSync(STATE(dir))).toBe(false);
    // no webhook in the environment: a real run says so and writes nothing
    const nohook = iwJson(dir, 'notify', ['notify']);
    expect(nohook.code).toBe(3);
    expect(nohook.json.error).toMatchObject({ code: 'INVALID_CONFIG' });
    expect(nohook.json.error.message).toContain('SLACK_WEBHOOK_URL is not set');
    expect(existsSync(STATE(dir))).toBe(false);
  });

  it('shows what changed since the state, in the project language, and keeps the state on --dry-run', () => {
    const dir = ready('locale = "ja"\n');
    const env = { SLACK_WEBHOOK_URL: WEBHOOK };
    // a state from before the shop's sample runs
    writeFileSync(
      STATE(dir),
      JSON.stringify({ v: 1, at: '2020-01-01T00:00:00Z', gates: {}, assigned: {}, drafts: [] }),
    );
    const r = iwJson(dir, 'notify', ['notify', '--dry-run'], { env });
    expect(r.code, r.stderr).toBe(0);
    const events = r.json.data.messages.map((m: { event: string }) => m.event);
    expect(events).toContain('run_failed');
    expect(events).toContain('assigned');
    const fail = r.json.data.messages.find((m: { event: string }) => m.event === 'run_failed');
    expect(fail.text).toMatch(/が失敗しました/);
    expect(fail.url).toMatch(/^https:\/\/watch\.shop\.test\/#\/runs\/run_/);
    expect(JSON.parse(readFileSync(STATE(dir), 'utf8')).at).toBe('2020-01-01T00:00:00Z');
    // --since works without a state file; it reports runs only
    const s = iwJson(
      dir,
      'notify',
      ['notify', '--dry-run', '--since', '2020-01-01T00:00:00Z', '--state', join(dir, 'none.json')],
      { env },
    );
    expect(s.json.data.since).toBe('2020-01-01T00:00:00Z');
    expect(s.json.data.messages.map((m: { event: string }) => m.event)).toContain('run_failed');
    expect(iw(dir, ['notify', '--since', 'yesterday', '--dry-run']).code).toBe(2);
  });

  it('refuses a config without a webhook, an iw: reference, and agents without --dry-run', () => {
    const dir = shop();
    const none = iw(dir, ['notify', '--json']);
    expect(none.code).toBe(3);
    expect(none.json.error.message).toContain('[notify] slack_webhook');
    appendFileSync(join(dir, '.indx-watch/project.toml'), '\n[notify]\nslack_webhook = "iw:slack"\n');
    expect(iw(dir, ['notify', '--json']).json.error.message).toContain('env: references only');
    const agent = iw(dir, ['notify', '--json'], { env: { IW_ACTOR_KIND: 'agent' } });
    expect(agent.code).toBe(2);
    expect(iw(dir, ['notify', '--dry-run', '--json'], { env: { IW_ACTOR_KIND: 'agent' } }).code).toBe(0);
  });
});

describe('iw notify sending', () => {
  const real = notifyDeps.notifier;
  afterEach(() => {
    notifyDeps.notifier = real;
  });
  const call = (cwd: string, args: Record<string, string | boolean>) =>
    notifyCommands.notify!.run(
      { cwd, env: cleanEnv({ SLACK_WEBHOOK_URL: WEBHOOK }), log() {}, stdin: async () => '' },
      { dir: join(cwd, '.indx-watch'), ...args },
    );

  it('posts the messages once, then writes the state, so the next run is quiet', async () => {
    const dir = ready();
    writeFileSync(
      STATE(dir),
      JSON.stringify({ v: 1, at: '2020-01-01T00:00:00Z', gates: {}, assigned: {}, drafts: [] }),
    );
    const sent: Notification[][] = [];
    const hooks: string[] = [];
    notifyDeps.notifier = (w) => ({
      send: async (m) => {
        hooks.push(w);
        sent.push(m);
      },
    });
    const first = (await call(dir, {})).data as { sent: number };
    expect(first.sent).toBeGreaterThan(0);
    expect(hooks).toEqual([WEBHOOK]);
    expect(sent[0]).toHaveLength(first.sent);
    const second = (await call(dir, {})).data as { sent: number };
    expect(second.sent).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('keeps the state when the post fails, so the next run tries again', async () => {
    const dir = ready();
    const old = JSON.stringify({ v: 1, at: '2020-01-01T00:00:00Z', gates: {}, assigned: {}, drafts: [] });
    writeFileSync(STATE(dir), old);
    notifyDeps.notifier = () => ({
      send: async () => {
        throw new Error('Slack answered 500');
      },
    });
    await expect(call(dir, {})).rejects.toThrow('Slack answered 500');
    expect(readFileSync(STATE(dir), 'utf8')).toBe(old);
  });
});

describe('sinceOf', () => {
  it('reads durations and dates; anything else is a usage error', () => {
    const now = new Date('2026-11-25T12:00:00Z');
    expect(sinceOf('90m', now)).toBe('2026-11-25T10:30:00Z');
    expect(sinceOf('1d', now)).toBe('2026-11-24T12:00:00Z');
    expect(sinceOf('2026-11-01T00:00:00Z', now)).toBe('2026-11-01T00:00:00Z');
    expect(() => sinceOf('soon', now)).toThrow('--since');
  });
});
