/** `iw issue <ref>`: the prefilled GitHub issue of a run or test case, and the link back (docs/spec/cli.md#iw-issue-ref). */
import * as iwb from '@indx-watch/bundle';
import { issueFor } from '@indx-watch/server';
import type { Spec } from '../cli.js';
import * as cx from '../context.js';
import { openBrowser, repoOf } from '../github.js';
import { B, type Ctx, fail, P, S, str } from '../util.js';

/** Save `url` in the `links` of the test case or use case the ref belongs to (an AC and a run go to their use case and test case). */
async function addLink(ctx: Ctx, p: cx.Project, key: string, url: string) {
  if (!/^https?:\/\/[^\s]+$/i.test(url)) fail('USAGE', '--link must be an http(s) URL');
  const { testCases, useCases } = p.bundle;
  const tc = testCases.find((t) => t.data.key === key);
  const uc = useCases.find((u) => u.data.key === key || u.data.criteria.some((c) => c.key === key));
  const [target, type] = tc
    ? [tc, 'test-case' as const]
    : uc
      ? [uc, 'use-case' as const]
      : [undefined, undefined];
  if (!target || !type) return fail('NOT_FOUND', `${key} not found`);
  const links = (target.data as { links?: string[] }).links ?? [];
  const added = !links.includes(url);
  if (added) await iwb.writeDefinition(p.fs, target.file, type, { ...target.data, links: [...links, url] });
  ctx.log(added ? `Linked ${url} to ${target.data.key}` : `${target.data.key} already links ${url}`);
  return { file: target.file, key: target.data.key, links: added ? [...links, url] : links, added };
}

export const issueCommands: Record<string, Spec> = {
  issue: {
    description: 'Open a prefilled GitHub issue for a run or test case, or --link the issue back',
    args: {
      ref: P('Run ID, TC-n, AC-n.m or UC-n'),
      open: B('Open the new-issue page in the browser (people only)'),
      link: S('Record the issue URL on the test case or use case (after you submitted the issue)'),
    },
    async run(ctx, a) {
      const p = await cx.openProject(ctx, a);
      const m = await cx.loadModel(p);
      const ref = str(a.ref)!;
      const key = /^run_/i.test(ref) ? cx.resolveRun(m, ref).record.test_case.key : cx.resolveKey(m, ref);
      const link = str(a.link) ? await addLink(ctx, p, key, str(a.link)!) : undefined;
      const repo = repoOf(p);
      if (link && !repo)
        return {
          data: { ref, run: null, repo: null, url: null, link },
          text: `Linked ${str(a.link)} to ${link.key}`,
        };
      if (!repo)
        fail('INVALID_CONFIG', 'No GitHub repository: add [github] repo = "owner/name" to project.toml');
      const store = p.bundle.project.data.store?.url;
      const appUrl = store?.startsWith('https://') ? new URL(store).origin : undefined;
      const r = issueFor(m, ref, { repo, appUrl });
      if (a.open) {
        if ((await cx.actorOf(ctx)).kind === 'agent')
          fail('USAGE', 'Agents cannot open pages; give the URL to a person');
        openBrowser(r.url);
      }
      const { url, title, keys, trimmed, secrets } = r;
      const warnings = [
        ...secrets.map((f) => ({
          severity: 'warning' as const,
          code: 'issue-secret',
          message: `Left out ${f}: it looks like a secret`,
        })),
        ...trimmed.map((f) => ({
          severity: 'warning' as const,
          code: 'issue-trimmed',
          message: `Shortened ${f} to keep the URL short`,
        })),
      ];
      const note = 'Open it, read it, and submit it yourself; then: iw issue <ref> --link <issue URL>';
      return {
        data: {
          ref,
          run: r.ref.startsWith('run_') ? r.ref : null,
          repo,
          url,
          title,
          keys,
          trimmed,
          secrets,
          link: link ?? null,
        },
        warnings,
        text: link ? `${url}` : `${url}\n${note}`,
      };
    },
  },
};
