// The Slack incoming-webhook Notifier against a stubbed fetch (docs/spec/integrations.md#notifications).
import { describe, expect, it } from 'vitest';
import { SLACK_MAX_LINES, StoreError, slackNotifier } from '../src/index.js';
import { notifierContract } from './contract.js';

const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/SECRETSECRET';
const msg = (text: string) => ({ event: 'run_failed' as const, text });

/** A fetch that records every post and answers with `status`. */
function stub(status = 200, body = 'ok') {
  const posts: { url: string; text: string }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    posts.push({ url, text: JSON.parse(String(init.body)).text });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { posts, fetchFn };
}

notifierContract('slack (stubbed fetch)', async () => {
  const s = stub();
  return { notifier: slackNotifier(WEBHOOK, s.fetchFn), delivered: () => s.posts.map((p) => p.text) };
});

describe('slackNotifier', () => {
  it('posts once, with links and escaped markup, to the webhook', async () => {
    const s = stub();
    await slackNotifier(WEBHOOK, s.fetchFn).send([
      { event: 'run_failed', text: 'TC-3 <b> & co failed.', url: 'https://watch.shop.test/#/runs/run_1' },
    ]);
    expect(s.posts).toEqual([
      { url: WEBHOOK, text: '• TC-3 &lt;b&gt; &amp; co failed. <https://watch.shop.test/#/runs/run_1|open>' },
    ]);
  });

  it('sums up what is over the line cap', async () => {
    const s = stub();
    await slackNotifier(WEBHOOK, s.fetchFn).send(
      Array.from({ length: SLACK_MAX_LINES + 3 }, (_, i) => msg(`m${i}`)),
    );
    const lines = s.posts[0]!.text.split('\n');
    expect(lines).toHaveLength(SLACK_MAX_LINES + 1);
    expect(lines.at(-1)).toBe('…and 3 more');
  });

  it('refuses another host before any request', () => {
    const s = stub();
    for (const bad of [
      'http://hooks.slack.com/x',
      'https://evil.test/hooks.slack.com/',
      'https://hooks.slack.com.evil.test/x',
      '',
    ])
      expect(() => slackNotifier(bad, s.fetchFn)).toThrow(StoreError);
    expect(s.posts).toEqual([]);
  });

  it('fails with the status and the answer, never the URL', async () => {
    const e = (await slackNotifier(WEBHOOK, stub(404, 'no_active_hooks').fetchFn)
      .send([msg('x')])
      .catch((x) => x)) as StoreError;
    expect(e).toBeInstanceOf(StoreError);
    expect(e.message).toBe('Slack answered 404: no_active_hooks');
    const down = (await slackNotifier(WEBHOOK, (async () => {
      throw new Error(`connect ${WEBHOOK}`);
    }) as unknown as typeof fetch)
      .send([msg('x')])
      .catch((x) => x)) as StoreError;
    expect(down.message).not.toContain('SECRET');
  });
});
