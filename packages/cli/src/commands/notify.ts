/** `iw notify` and `iw insights` (docs/spec/integrations.md#notifications, docs/spec/concepts.md#insights). */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { buildVerifiedModel, insights, type NotifyState, notifyEvents, notifyState } from '@indx-watch/core';
import { type Notifier, slackNotifier } from '@indx-watch/store';
import type { Spec } from '../cli.js';
import * as cx from '../context.js';
import { B, fail, iso, S, str } from '../util.js';

/** How `iw notify` reaches Slack; tests replace it. */
export const notifyDeps: { notifier(webhook: string): Notifier } = { notifier: (w) => slackNotifier(w) };

const UNITS: Record<string, number> = { m: 60, h: 3600, d: 86400 };
/** `--since`: an ISO date-time or a duration back from now (`90m`, `2h`, `1d`). */
export function sinceOf(v: string, now = new Date()): string {
  const d = /^(\d+)([mhd])$/.exec(v);
  const t = d ? now.getTime() - Number(d[1]) * UNITS[d[2]!]! * 1000 : Date.parse(v);
  return Number.isNaN(t)
    ? fail('USAGE', `--since "${v}" is not an ISO date-time or a duration like 90m, 2h, 1d`)
    : iso(new Date(t));
}

async function readState(file: string): Promise<NotifyState | undefined> {
  if (!existsSync(file)) return;
  const s = JSON.parse(await readFile(file, 'utf8').catch(() => 'null')) as NotifyState | null;
  return s?.v === 1 && s.at
    ? s
    : fail('INVALID_INPUT', `${file} is not an INDX Watch notification state; delete it to start again`);
}

export const notifyCommands: Record<string, Spec> = {
  notify: {
    description: 'Send what changed since the last notification to Slack (for CI and cron)',
    args: {
      since: S('ISO date-time or a duration (90m, 2h, 1d) instead of the state file'),
      state: S('State file (default: cache/notify-state.json in the bundle folder)'),
      'dry-run': B('Print the messages; send nothing and keep the state'),
    },
    async run(ctx, a) {
      const dry = !!a['dry-run'];
      if (!dry && (await cx.actorOf(ctx)).kind === 'agent')
        fail('USAGE', 'Agents may only run `iw notify --dry-run`');
      const p = await cx.openProject(ctx, a);
      const cfg = p.bundle.project.data.notify;
      const ref = cfg?.slack_webhook;
      if (!ref && !dry)
        fail('INVALID_CONFIG', 'Set [notify] slack_webhook = "env:SLACK_WEBHOOK_URL" in project.toml');
      const webhook = ref?.startsWith('env:') ? ctx.env[ref.slice(4)] : undefined;
      if (!dry && !webhook)
        fail(
          'INVALID_CONFIG',
          ref?.startsWith('env:')
            ? `${ref.slice(4)} is not set`
            : `iw notify reads env: references only, not ${ref}`,
        );

      const file = resolve(ctx.cwd, str(a.state) ?? join(p.dir, 'cache', 'notify-state.json'));
      const since = str(a.since) ? sinceOf(str(a.since)!) : undefined;
      const now = iso();
      const records = await p.replica.records();
      const model = (await buildVerifiedModel(p.bundle, records)).model;
      const saved = await readState(file);
      const baseline = !saved && !since;
      let messages: ReturnType<typeof notifyEvents> = [];
      if (!baseline) {
        // --since: the previous gate is the model as of that time; assignments and drafts come from the file
        const asOf = since
          ? notifyState(
              (
                await buildVerifiedModel(
                  p.bundle,
                  records.filter((r) => r.at <= since),
                )
              ).model,
              since,
            )
          : undefined;
        const prev = {
          ...(saved ?? notifyState(model, now)),
          ...(asOf && { at: since!, gates: asOf.gates }),
        } as NotifyState;
        messages = notifyEvents(model, prev, {
          locale: cfg?.locale ?? p.bundle.project.data.source_locale,
          appUrl: cfg?.app_url,
          since,
        });
      }
      if (!dry && !baseline && messages.length) await notifyDeps.notifier(webhook!).send(messages);
      if (!dry) {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, `${JSON.stringify(notifyState(model, now), null, 2)}\n`);
      }
      const sent = dry || baseline ? 0 : messages.length;
      const text = baseline
        ? `First run: ${dry ? 'a real run will save' : 'saved'} what the project looks like now as the baseline; nothing was sent.`
        : `${dry ? 'Would send' : 'Sent'} ${messages.length} message(s)${messages.map((m) => `\n- ${m.text}${m.url ? ` ${m.url}` : ''}`).join('')}`;
      return { data: { sent, dryRun: dry, baseline, since: since ?? null, messages }, text };
    },
  },

  insights: {
    description: 'Pass rate and coverage by release, progress by assignee and feature, manual run time',
    args: { release: S('Default: current_release') },
    async run(ctx, a) {
      const p = await cx.openProject(ctx, a);
      const data = insights(await cx.loadModel(p), { release: cx.releaseOf(ctx, p, a) });
      const pct = (x: number | null) => (x === null ? '-' : `${Math.round(x * 100)}%`);
      const lines = [
        'Release  pass rate  coverage  flaky  gate',
        ...data.releases.map(
          (r) =>
            `${r.version}  ${pct(r.passRate)}  ${pct(r.coverage)}  ${r.flaky}  ${r.gate ? 'pass' : 'fail'}`,
        ),
        '',
        `Assignees (${data.release ?? 'all plans'}): todo / review / blocked / done`,
        ...data.assignees.map(
          (x) => `${x.assignee ?? '(unassigned)'}  ${x.todo} / ${x.review} / ${x.blocked} / ${x.done}`,
        ),
        '',
        'Features: pass / fail / open',
        ...data.features.map((f) => `${f.key} ${f.title}  ${f.pass} / ${f.fail} / ${f.open}`),
        '',
        `Median manual run: ${data.manual.median === null ? 'no samples' : `${data.manual.median} s (${data.manual.samples} runs)`}`,
      ];
      return { data, text: lines.join('\n') };
    },
  },
};
