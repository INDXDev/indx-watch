/**
 * Commands that run or ship the app rather than edit the bundle: serve (local server and web UI),
 * report (md/html/pdf/json), deploy (Cloudflare), skills install, login (Cloudflare Access) and keygen.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  formatTomlBody,
  generateSecretsKey,
  generateSigningKey,
  type Problem,
  VERIFIED_VIA,
  type Via,
} from '@indx-watch/bundle';
import { findBundleDir } from '@indx-watch/bundle/node';
import { type Model, reportData } from '@indx-watch/core';
import { renderReport, reportTexts } from '@indx-watch/server';
import { startNodeServer } from '@indx-watch/server/node';
import { fileStateStore } from '@indx-watch/sync/node';
import { setupAgents } from '../agents.js';
import type { Spec } from '../cli.js';
import * as cx from '../context.js';
import { deploy } from '../deploy/index.js';
import { TOOL_OUTPUTS } from '../tools.js';
import { type Args, asset, B, type Ctx, fail, git, here, P, S, str } from '../util.js';

const oneOf = <T extends string>(v: unknown, values: readonly T[], flag: string): T | undefined =>
  v === undefined || values.includes(v as T)
    ? (v as T)
    : fail('USAGE', `--${flag}: one of ${values.join(', ')}`);

type Browser = { newPage(): Promise<Page>; close(): Promise<void> };
type Page = { setContent(h: string, o: object): Promise<void>; pdf(o: object): Promise<unknown> };
const NO_PLAYWRIGHT = 'PDF needs Playwright: npm i -D @playwright/test && npx playwright install chromium';
/** Print HTML to PDF with the Playwright the user installed (or the one next to the CLI). */
async function printPdf(ctx: Ctx, html: string, path: string): Promise<void> {
  let chromium: { launch(o: object): Promise<Browser> } | undefined;
  for (const from of [join(ctx.cwd, 'noop.js'), import.meta.url])
    for (const name of ['playwright', '@playwright/test', 'playwright-core'])
      try {
        const mod = await import(pathToFileURL(createRequire(from).resolve(name)).href);
        chromium ??= mod.chromium ?? mod.default?.chromium;
      } catch {
        // not resolvable from here (or not loadable): try the next package name and location
      }
  if (!chromium) fail('EXTERNAL_TOOL', NO_PLAYWRIGHT);
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

/** Options and scope of `iw report`: flags first, then the plan's, then the defaults. */
function reportArgs(ctx: Ctx, p: cx.Project, m: Model, a: Args) {
  const format = oneOf(str(a.format), ['md', 'html', 'pdf', 'json'], 'format') ?? 'md';
  const audience = oneOf(str(a.audience), ['internal', 'customer'], 'audience') ?? 'internal';
  const locale = oneOf(str(a.locale), ['en', 'ja'], 'locale') ?? m.project.source_locale;
  const links = audience === 'customer' ? 'none' : ['md', 'json'].includes(format) ? 'links' : 'embed';
  const evidence = oneOf(str(a.evidence), ['none', 'links', 'embed'], 'evidence') ?? links;
  const plan = str(a.plan) ? m.plans.find((x) => x.key === cx.resolveKey(m, str(a.plan)!)) : undefined;
  if (str(a.plan) && !plan) fail('NOT_FOUND', `${a.plan} is not a plan`);
  const release = str(a.release) ?? plan?.release ?? cx.releaseOf(ctx, p, a);
  const scope = { release, environment: str(a.env) ?? plan?.environment ?? ctx.env.IW_ENV };
  return { format, audience, locale, evidence, plan, release, scope };
}

type ReportOpts = { scope: { release?: string; environment?: string }; audience: string; plan?: string };
/** Report data with the generator, time, commit and sync cursor (IW_NOW pins the time and drops the commit). */
async function buildReport(ctx: Ctx, p: cx.Project, m: Model, o: ReportOpts) {
  const [now, store] = [ctx.env.IW_NOW, m.project.store];
  const cursor = store ? (await (await fileStateStore(p.dir, store.url)).load()).cursor : null;
  const commit = now ? undefined : (await cx.contextOf(ctx).build()).commit;
  return reportData(m, o.scope, {
    audience: o.audience,
    generatedBy: ctx.env.IW_ACTOR ?? (await cx.actorOf(ctx)).id,
    now: now ? new Date(now) : new Date(),
    ...JSON.parse(JSON.stringify({ plan: o.plan, commit, cursor: cursor ?? undefined })),
  });
}

/** Default output file; md and json go to stdout. A customer report never overwrites the internal one (which has notes and emails). */
const outName = (format: string, audience: string, of = 'all') =>
  ['md', 'json'].includes(format)
    ? undefined
    : `report-${of}${audience === 'customer' ? '.customer' : ''}.${format}`;

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
      const host = str(a.host) ?? '127.0.0.1';
      const { url } = await startNodeServer({
        ...{ dir: p.dir, port: Number(str(a.port) ?? 4321), host, webRoot },
        sync: typeof a.sync === 'boolean' ? a.sync : !!p.bundle.project.data.store,
        identityHeader: str(a['identity-header']),
        toolOutputs: TOOL_OUTPUTS,
      });
      const message = `Listening on ${host}: anyone on the network can read this project; writes need --identity-header`;
      const local = /^(127\.|::1$|localhost$)/.test(host);
      const warnings = local ? [] : [{ severity: 'warning' as const, code: 'public-host', message }];
      const opener = { darwin: 'open', win32: 'explorer' }[process.platform as string] ?? 'xdg-open';
      if (a.open)
        spawn(opener, [url], { stdio: 'ignore', detached: true })
          .on('error', () => {})
          .unref();
      return { data: { url }, warnings, text: `INDX Watch is running at ${url} (Ctrl+C to stop)` };
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
      const { format, audience, locale, evidence, plan, release, scope } = reportArgs(ctx, p, m, a);
      const warnings = cx.checkScope(m, a, scope);
      const data = await buildReport(ctx, p, m, { scope, audience, plan: plan?.key });
      Object.assign(data, { texts: await reportTexts(m, locale) });
      const out = str(a.out) ?? outName(format, audience, plan?.key ?? release);
      const getBlob = (sha: string) => p.replica.getBlob(sha);
      const html = format === 'md' ? 'md' : 'html';
      const text =
        format === 'json'
          ? `${JSON.stringify(data, null, 2)}\n`
          : await renderReport(data, { format: html, locale, evidence, getBlob });
      const file = out ? resolve(ctx.cwd, out) : undefined;
      if (file) await (format === 'pdf' ? printPdf(ctx, text, file) : writeFile(file, text));
      const gate = data.status.gate;
      const result = { file: out ?? null, gate, ...(file || !a.json ? {} : { text }) };
      const done = `Wrote ${out} (gate ${gate.passed ? 'passed' : 'failed'})`;
      return { data: result, warnings, text: file ? done : text };
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
      const warnings: Problem[] = [];
      const warn = (message: string) =>
        warnings.push({ severity: 'warning', code: 'unknown-resources', message });
      const opts = { dir, dryRun: !!a['dry-run'], public: !!a.public, log: ctx.log, warn };
      const data = await deploy(str(a.name) ? { ...opts, name: str(a.name) } : opts);
      return { data, warnings, text: data.url ? `Deployed to ${data.url}` : data.commands.join('\n') };
    },
  },

  'skills install': {
    description: 'Set up Claude Code and Codex: skills, the MCP server and the AGENTS.md block',
    args: {
      claude: B('Claude Code (.claude/skills/, .mcp.json)'),
      codex: B('Codex and other Agent Skills clients (.agents/skills/, .codex/config.toml)'),
    },
    async run(ctx, a) {
      const bundle = findBundleDir(ctx.cwd, { ...ctx.env, IW_DIR: str(a.dir) ?? ctx.env.IW_DIR });
      const root = git(ctx.cwd, 'rev-parse', '--show-toplevel') ?? (bundle ? resolve(bundle, '..') : ctx.cwd);
      const both = !a.claude && !a.codex;
      const to = { claude: !!a.claude || both, codex: !!a.codex || both };
      const { warnings, ...data } = await setupAgents(root, asset('../skills', 'skills'), to);
      const text = `Installed:\n${data.installed.join('\n')}\n${data.files.length} files written`;
      return { data, warnings, text };
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

  keygen: {
    description:
      'Create a record-signing key pair, or with --secrets an IW_SECRETS_KEY (docs/spec/security.md)',
    args: {
      kid: S('Key ID (default: iw-<date>)'),
      via: S(`Verified via values it may sign: ${VERIFIED_VIA}`),
      secrets: B('Create the key that seals iw: secrets on a server instead'),
    },
    async run(_ctx, a) {
      if (a.secrets) {
        const secret = generateSecretsKey();
        const text = `Set IW_SECRETS_KEY (a secret; never commit it) on the server that keeps iw: secrets, e.g. \`wrangler secret put IW_SECRETS_KEY\`:\n\n${secret}`;
        return { data: { secret }, text };
      }
      const kid = str(a.kid) ?? `iw-${new Date().toISOString().slice(0, 10)}`;
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(kid))
        fail('USAGE', '--kid: up to 64 letters, digits, ".", "_", "-"');
      const via = str(a.via)
        ?.split(',')
        .map((v) => v.trim()) as Via[] | undefined;
      if (via?.some((v) => !VERIFIED_VIA.includes(v))) fail('USAGE', `--via: ${VERIFIED_VIA.join(', ')}`);
      const { secret, key } = await generateSigningKey(kid);
      const entry = { ...key, ...(via && { via }) };
      const toml = formatTomlBody('project', { signing_keys: [entry] });
      const text = `Add to project.toml (public, commit it), then run \`iw fmt\`:\n\n${toml}\nSet IW_SIGNING_KEY (a secret; never commit it) on the hosted server or CI:\n\n${secret}`;
      return { data: { ...entry, secret, toml }, text };
    },
  },
};
