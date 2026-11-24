/** Staying current: iw doctor and iw update (docs/spec/cli.md#iw-doctor, T-503 to T-505). The file work is in ../upkeep.ts. */
import { SCHEMA_VERSION } from '@indx-watch/bundle';
import { npmReleaseSource } from '@indx-watch/store';
import { type Spec, toError } from '../cli.js';
import * as cx from '../context.js';
import { deploy } from '../deploy/index.js';
import type { UpdateData } from '../json.js';
import * as up from '../upkeep.js';
import { asset, B, fail, S, str } from '../util.js';
import { VERSION } from '../version.js';
import { specCommands } from './specs.js';

const warn = (message: string) => ({ severity: 'warning' as const, code: 'doctor-online', message });

export const upkeepCommands: Record<string, Spec> = {
  doctor: {
    description: 'Is everything that pins INDX Watch on the same version? (read-only)',
    args: { online: B('Also ask the npm registry and the hosted app (/healthz)') },
    async run(ctx, a) {
      const p = await cx.openProject(ctx, a);
      const { tool, store } = p.bundle.project.data;
      const hosted = store?.url.startsWith('https://') ? store.url.replace(/\/+$/, '') : undefined;
      const online = a.online ? { source: npmReleaseSource() } : undefined;
      const r = await up.inspect({ root: p.root, dir: p.dir, pin: tool?.indx_watch, hosted, online });
      const releases = up
        .releasesAfter(up.loadReleases(ctx), r.target)
        .map(({ version, breaking, migrate }) => ({ version, breaking, migrate }));
      const ok = r.parts.every((x) => x.state === 'ok');
      const data = {
        version: VERSION,
        pinned: tool?.indx_watch ?? null,
        latest: r.latest,
        ok,
        parts: r.parts,
        releases,
      };
      const lines = r.parts.map(
        (x) =>
          `${x.state.padEnd(14)} ${x.part.padEnd(9)} ${x.target}${x.version ? ` ${x.version}` : ''}${x.note ? ` (${x.note})` : ''}`,
      );
      const next = ok ? 'Everything is on one version.' : 'Run `iw update` to bring it together.';
      return {
        data,
        warnings: r.warnings.map(warn),
        text: `Target ${r.target}\n${lines.join('\n')}\n${next}`,
      };
    },
  },

  update: {
    description: 'Bring every pinned part (package, skills, MCP, workflows, schemas) to one version',
    args: {
      to: S('Version (default: the running one; `latest` asks the npm registry)'),
      'dry-run': B('Print every change, write nothing'),
      deploy: B('Run iw deploy at the end'),
      workflow: B('Only write .github/workflows/indx-watch-update.yml (a weekly update pull request)'),
    },
    async run(ctx, a) {
      const p = await cx.openProject(ctx, a);
      const [dry, from] = [!!a['dry-run'], p.bundle.project.data.tool?.indx_watch ?? null];
      const to = await target(str(a.to) ?? VERSION);
      if (a.workflow) {
        const { rel, written } = await up.writeUpdateWorkflow(
          p.root,
          asset('templates/indx-watch-update.yml', 'packages/cli/templates/indx-watch-update.yml'),
          dry,
        );
        const note = written ? undefined : `${rel} exists; left as it is`;
        const data: UpdateData = {
          from,
          to,
          dryRun: dry,
          steps: [{ step: 'workflow', changed: written ? [rel] : [], ...(note && { note }) }],
          install: null,
          notes: '',
        };
        return { data, text: written ? `${dry ? 'Would write' : 'Wrote'} ${rel}` : note! };
      }
      if (a.deploy && to !== VERSION)
        fail(
          'USAGE',
          `--deploy ships the running version ${VERSION}: run \`npx indx-watch@${to} update --deploy\``,
        );
      const failing = await up.failingPatches(p, to, ctx.env);
      if (failing.length)
        fail('CONFLICT', `these patches no longer apply to ${to}: ${failing.join(', ')}`, failing);

      const [tool, schema] = await up.pinBundle(p, to, dry);
      const pkg = await up.pinPackage(p.root, to, dry);
      const releases = up.loadReleases(ctx);
      const [skills, workflow] = [await skillsStep(p, to, dry), await up.pinWorkflows(p.root, to, dry)];
      const steps = [tool, pkg, skills.step, workflow, schema];
      steps.push(await migrateStep(ctx, a, p, { from, to, dry, releases }));
      const check = dry
        ? { step: { step: 'check' as const, changed: [], note: 'skipped in a dry run' }, errors: 0 }
        : await checkStep(ctx, a);
      steps.push(check.step);
      if (a.deploy) steps.push(await deployStep(ctx, p.dir, dry));
      const install = pkg.changed.length ? up.installCommand(p.root) : null;
      const data: UpdateData = {
        from,
        to,
        dryRun: dry,
        steps,
        install,
        notes: up.changelogNotes(releases, from ?? undefined, to),
      };
      const lines = steps.map(
        (s) =>
          `${s.step}: ${s.changed.length ? s.changed.join(', ') : 'nothing to change'}${s.note ? ` (${s.note})` : ''}`,
      );
      const text = [
        `${dry ? 'Would update' : 'Updated'} ${from ?? 'an unpinned project'} -> ${to}`,
        ...lines,
        ...(install ? [`Now run: ${install}`] : []),
      ].join('\n');
      if (check.errors)
        fail(
          'CHECK_FAILED',
          `iw check found ${check.errors} error${check.errors === 1 ? '' : 's'} after the update`,
          [],
          data,
          text,
        );
      return { data, warnings: skills.warnings, text };
    },
  },
};

/** The version to update to: a version, or `latest` from the npm registry. */
async function target(v: string) {
  if (v === 'latest')
    return (
      (await npmReleaseSource().latest())?.version ??
      fail('EXTERNAL_TOOL', 'could not reach the npm registry; pass --to <version>')
    );
  return /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(v)
    ? v
    : fail('USAGE', `--to: a version such as ${VERSION}, or latest`);
}

/** Step 3, only for the running version: the skills ship inside the package that runs. */
async function skillsStep(p: cx.Project, to: string, dry: boolean) {
  if (to === VERSION) return up.refreshAgents(p, asset('../skills', 'skills'), to, dry);
  const note = `skill copies come from the running ${VERSION}; run \`npx indx-watch@${to} skills install\``;
  return { step: { step: 'skills' as const, changed: [], note }, warnings: [] };
}

/** Step 6: `iw migrate`, when the bundle is behind or a release since the old pin says so. */
async function migrateStep(
  ctx: Parameters<Spec['run']>[0],
  a: Parameters<Spec['run']>[1],
  p: cx.Project,
  o: { from: string | null; to: string; dry: boolean; releases: up.Release[] },
) {
  const behind = p.bundle.project.data.schema_version < SCHEMA_VERSION;
  const flagged = !!o.from && up.releasesAfter(o.releases, o.from, o.to).some((r) => r.migrate);
  if (!behind && !flagged) return { step: 'migrate' as const, changed: [] };
  if (o.dry) return { step: 'migrate' as const, changed: [], note: 'would run iw migrate' };
  const done = (await specCommands.migrate!.run(ctx, a)).data as { changed: string[] };
  return { step: 'migrate' as const, changed: done.changed };
}

/** Step 7: `iw check`; the errors are reported after everything is written. */
async function checkStep(ctx: Parameters<Spec['run']>[0], a: Parameters<Spec['run']>[1]) {
  let errors = 0;
  try {
    await specCommands.check!.run(ctx, a);
  } catch (e) {
    const err = toError(e);
    if (err.code !== 'CHECK_FAILED') throw err;
    errors = (err.data as { errors: number }).errors;
  }
  return {
    step: { step: 'check' as const, changed: [], ...(errors && { note: `${errors} errors` }) },
    errors,
  };
}

/** Step 8: `iw deploy` of the running version. */
async function deployStep(ctx: Parameters<Spec['run']>[0], dir: string, dryRun: boolean) {
  const warnings: string[] = [];
  const done = await deploy({ dir, dryRun, log: ctx.log, warn: (m) => warnings.push(m), version: VERSION });
  return {
    step: 'deploy' as const,
    changed: done.url ? [done.url] : done.commands,
    ...(dryRun && { note: 'dry run' }),
  };
}
