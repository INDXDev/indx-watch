/** Notifier over a Slack incoming webhook (docs/spec/integrations.md#notifications). Runs anywhere `fetch` does. */
import { type Notification, type Notifier, StoreError } from '../ports.js';

const HOST = /^https:\/\/hooks\.slack\.com\/\S+$/;
/** Lines in one post; the rest is summed up. */
export const SLACK_MAX_LINES = 20;
/** Slack treats & < > in text as markup. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** One post for all messages. The webhook URL is a secret: it never appears in an error. */
export function slackNotifier(webhook: string, fetchFn: typeof fetch = fetch): Notifier {
  if (!HOST.test(webhook))
    throw new StoreError('invalid', 'The Slack webhook must be an https://hooks.slack.com/ URL');
  return {
    async send(messages: Notification[]) {
      if (!messages.length) return;
      const lines = messages
        .slice(0, SLACK_MAX_LINES)
        .map((m) => `• ${esc(m.text)}${m.url ? ` <${m.url}|open>` : ''}`);
      if (messages.length > SLACK_MAX_LINES) lines.push(`…and ${messages.length - SLACK_MAX_LINES} more`);
      const res = await fetchFn(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: lines.join('\n') }),
      }).catch(() => undefined);
      if (!res) throw new StoreError('network', 'Slack could not be reached');
      if (res.status !== 200)
        throw new StoreError('network', `Slack answered ${res.status}: ${(await res.text()).slice(0, 80)}`);
    },
  };
}
