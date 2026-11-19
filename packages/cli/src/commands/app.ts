/** serve, report, deploy, skills install, login. */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findBundleDir } from '@indx-watch/bundle/node';
import { reportData } from '@indx-watch/core';
import { renderReport, reportTexts } from '@indx-watch/server';
import { startNodeServer } from '@indx-watch/server/node';
import { fileStateStore } from '@indx-watch/sync/node';
import type { Spec } from '../cli.js';
import * as cx from '../context.js';
import { deploy } from '../deploy/index.js';
import { asset, B, type Ctx, fail, git, here, P, S, str } from '../util.js';

const oneOf = <T extends string>(v: unknown, values: readonly T[], flag: string): T | undefined =>
  v === undefined || values.includes(v as T)
    ? (v as T)
    : fail('USAGE', `--${flag}: one of ${values.join(', ')}`);

type Browser = { newPage(): Promise<Page>; close(): Promise<void> };
type Page = { setContent(h: string, o: object): Promise<void>; pdf(o: object): Promise<unknown> };
/** Print HTML to PDF with the Playwright the user installed (or the one next to the CLI). */
async function printPdf(ctx: Ctx, html: string, path: string): Promise<void> {
  let chromium: { launch(o: object): Promise<Browser> } | undefined;
  for (const from of [join(ctx.cwd, 'noop.js'), import.meta.url])
    for (const name of ['playwright', '@playwright/test', 'playwright-core'])
      try {
        const mod = await import(pathToFileURL(createRequire(from).resolve(name)).href);
        chromium ??= mod.chromium ?? mod.default?.chromium;
      } catch {}
  if (!chromium)
    fail(
      'EXTERNAL_TOOL',
      'PDF needs Playwright: npm i -D @playwright/test && npx playwright install chromium',
    );
  const exe = ctx.env.PW_CHROMIUM_PATH;
  const browser = await chromium!
    .launch(exe ? { executablePath: exe } : {})
    .catch((e: Error) => fail('EXTERNAL_TOOL', `Could not start Chromium: ${e.message.split('\n')[0]}`));
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({ path, format: 'A4', printBackground: true });
  } finally {
    await browser.close();
  }
}

export const appCommands: Record<string, Spec> = {
  serve: {
    description: 'Start the server and web UI on this machine',
    args: {
      ...{ port: S('Default 4321'), host: S('Default 127.0.0.1'), open: B('Open the browser') },
      ...{
        sync: B('Sync in the background (default: on with a [store])'),
        'identity-header': S('Trusted email header'),
      },
    },
    async run(ctx, a) {
      const p = await cx.openProject(ctx, a);
      const webRoot = [join(here, 'web'), join(here, '../../web/dist')].find((d) =>
        existsSync(join(d, 'index.html')),
      );
      const { url } = await startNodeServer({
        ...{ dir: p.dir, port: Number(str(a.port) ?? 4321), host: str(a.host) ?? '127.0.0.1', webRoot },
        sync: typeof a.sync === 'boolean' ? a.sync : !!p.bundle.project.data.store,
        identityHeader: str(a['identity-header']),
      });
      const opener = { darwin: 'open', win32: 'explorer' }[process.platform as string] ?? 'xdg-open';
      if (a.open)
        spawn(opener, [url], { stdio: 'ignore', detached: true })
          .on('error', () => {})
          .unref();
      return { data: { url }, text: `INDX Watch is running at ${url} (Ctrl+C to stop)` };
    },
  },

  report: {
    description: 'Render a release or plan report (md, html, pdf, json)',
    args: {
      ...{
        release: S(),
        plan: S(),
        env: S(),
        format: S('md | html | pdf | json (default md)'),
        out: S('Output file'),
      },
      ...{ evidence: S('none | links | embed'), audience: S('internal | customer'), locale: S('en | ja') },
      'evidence-base': S('Prefix for evidence links in md'),
    },
    async run(ctx, a) {
      const p = await cx.openProject(ctx, a);
      const m = await cx.loadModel(p);
      const format = oneOf(str(a.format), ['md', 'html', 'pdf', 'json'], 'format') ?? 'md';
      const audience = oneOf(str(a.audience), ['internal', 'customer'], 'audience') ?? 'internal';
      const locale = oneOf(str(a.locale), ['en', 'ja'], 'locale') ?? m.project.source_locale;
      const links = audience === 'customer' ? 'none' : ['md', 'json'].includes(format) ? 'links' : 'embed';
      const evidence = oneOf(str(a.evidence), ['none', 'links', 'embed'], 'evidence') ?? links;
      const plan = str(a.plan) ? m.plans.find((x) => x.key === cx.resolveKey(m, str(a.plan)!)) : undefined;
      if (str(a.plan) && !plan) fail('NOT_FOUND', `${a.plan} is not a plan`);
      const release = str(a.release) ?? plan?.release ?? cx.releaseOf(ctx, p, a);
      const scope = { release, environment: str(a.env) ?? plan?.environment ?? ctx.env.IW_ENV };
      const [now, store] = [ctx.env.IW_NOW, m.project.store];
      const cursor = store ? (await (await fileStateStore(p.dir, store.url)).load()).cursor : null;
      const commit = now ? undefined : (await cx.contextOf(ctx).build()).commit;
      const data = reportData(m, scope, {
        ...{
          audience,
          generatedBy: ctx.env.IW_ACTOR ?? (await cx.actorOf(ctx)).id,
          now: now ? new Date(now) : new Date(),
        },
        ...JSON.parse(JSON.stringify({ plan: plan?.key, commit, cursor: cursor ?? undefined })),
      });
      Object.assign(data, { texts: await reportTexts(m, locale) });
      const name = `report-${plan?.key ?? release ?? 'all'}.${format}`;
      const out = str(a.out) ?? (['md', 'json'].includes(format) ? undefined : name);
      const html = format === 'md' ? 'md' : 'html';
      const getBlob = (sha: string) => p.replica.getBlob(sha);
      const text =
        format === 'json'
          ? `${JSON.stringify(data, null, 2)}\n`
          : await renderReport(data, { format: html, locale, evidence, getBlob });
      const file = out ? resolve(ctx.cwd, out) : undefined;
      if (file) await (format === 'pdf' ? printPdf(ctx, text, file) : writeFile(file, text));
      const gate = data.status.gate;
      const result = { file: out ?? null, gate, ...(file || !a.json ? {} : { text }) };
      return { data: result, text: file ? `Wrote ${out} (gate ${gate.passed ? 'passed' : 'failed'})` : text };
    },
  },

  deploy: {
    description: 'Deploy the server to Cloudflare Workers with R2 and D1 (wrangler)',
    args: {
      ...{ 'dry-run': B('Print resources and commands, change nothing'), name: S('Worker name') },
      public: B('Allow deploying without Cloudflare Access'),
    },
    async run(ctx, a) {
      const { dir } = await cx.openProject(ctx, a);
      const opts = { dir, dryRun: !!a['dry-run'], public: !!a.public, log: ctx.log };
      const data = await deploy(str(a.name) ? { ...opts, name: str(a.name) } : opts);
      return { data, text: data.url ? `Deployed to ${data.url}` : data.commands.join('\n') };
    },
  },

  'skills install': {
    description: 'Copy the agent skills into .claude/skills/ and .agents/skills/',
    args: {
      claude: B('Claude Code (.claude/skills/)'),
      codex: B('Codex and other Agent Skills clients (.agents/skills/)'),
    },
    async run(ctx, a) {
      const src = asset('../skills', 'skills');
      const bundle = findBundleDir(ctx.cwd, { ...ctx.env, IW_DIR: str(a.dir) ?? ctx.env.IW_DIR });
      const root = git(ctx.cwd, 'rev-parse', '--show-toplevel') ?? (bundle ? resolve(bundle, '..') : ctx.cwd);
      const both = !a.claude && !a.codex;
      const targets = [
        a.claude || both ? '.claude/skills' : '',
        a.codex || both ? '.agents/skills' : '',
      ].filter(Boolean);
      const skills = (await readdir(src, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
      const installed = targets.flatMap((t) => skills.map((s) => `${t}/${s}`));
      for (const path of installed)
        await cp(join(src, path.split('/')[2]!), join(root, path), { recursive: true });
      return { data: { installed }, text: `Installed:\n${installed.join('\n')}` };
    },
  },

  login: {
    description: 'Log in to a hosted server behind Cloudflare Access (runs cloudflared)',
    args: { url: P('Server URL') },
    async run(_ctx, a) {
      const url = str(a.url)!;
      const r = spawnSync('cloudflared', ['access', 'login', url], { stdio: [0, a.json ? 2 : 1, 2] });
      if (r.error || r.status !== 0)
        fail(
          'EXTERNAL_TOOL',
          r.error ? `cloudflared not found: ${r.error.message}` : `cloudflared exited ${r.status}`,
        );
      return { data: { url }, text: `Logged in to ${url}` };
    },
  },
};
