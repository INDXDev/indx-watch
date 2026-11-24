/**
 * Staying current (docs/spec/cli.md#iw-doctor): what pins INDX Watch in a repository, and moving every pin together.
 * `iw doctor` reads, `iw update` writes; both work on the files of the repository root, offline.
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import * as iwb from '@indx-watch/bundle';
import { isOlderVersion } from '@indx-watch/core';
import type { ReleaseSource } from '@indx-watch/store';
import { parse } from 'smol-toml';
import { MANIFEST, readManifest, setupAgents, sha } from './agents.js';
import type { Project } from './context.js';
import type { Ctx } from './util.js';
import { here } from './util.js';
import { VERSION } from './version.js';

export type State = 'ok' | 'outdated' | 'unpinned' | 'locally-edited';
export interface Part {
  part: 'tool' | 'cli' | 'package' | 'mcp' | 'skills' | 'workflow' | 'worker';
  target: string;
  version: string | null;
  state: State;
  note?: string;
}
export interface Release {
  version: string;
  date?: string;
  breaking: boolean;
  schema_version: number;
  migrate: boolean;
  notes: string;
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SKILL_DIRS = ['.claude/skills', '.agents/skills'];

/** The releases this package knows (dist/releases.json, from CHANGELOG.md at build time); none when run from source. */
export function loadReleases(ctx: Ctx): Release[] {
  try {
    return JSON.parse(readFileSync(ctx.env.IW_RELEASES ?? join(here, 'releases.json'), 'utf8')).releases;
  } catch {
    return [];
  }
}

/** `[tool] indx_watch` of the project.toml in `dir`, without loading the bundle (skills install works without one). */
export async function toolPin(dir?: string): Promise<string | undefined> {
  if (!dir) return undefined;
  try {
    const tool = (
      parse(await readFile(join(dir, 'project.toml'), 'utf8')) as { tool?: { indx_watch?: string } }
    ).tool;
    return tool?.indx_watch;
  } catch {
    return undefined;
  }
}

/** Compare `version` with the target: a missing or odd version is unpinned, an older one outdated. */
const judge = (version: string | undefined, target: string): State =>
  !version || !SEMVER.test(version) ? 'unpinned' : isOlderVersion(version, target) ? 'outdated' : 'ok';

const readJson = async (path: string) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
};

// ---------- workflows ----------
const ACTION_STEP = /^(\s*)(- )?uses:\s*INDXDev\/indx-watch@/;
const INPUT = /^\s*version:\s*["']?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)["']?\s*(?:#.*)?$/;
const NPX = /\bindx-watch@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?![0-9A-Za-z.-])/g;

/** The pinned versions of a workflow: `version:` inputs of INDX Watch action steps and `indx-watch@x.y.z` commands. */
export function workflowPins(text: string) {
  const pins: { line: number; start: number; version: string }[] = [];
  let keyIndent = -1; // indentation of the keys of the current INDX Watch action step; -1 outside one
  let usesAction = false;
  text.split('\n').forEach((line, i) => {
    const step = ACTION_STEP.exec(line);
    const indent = line.length - line.trimStart().length;
    if (step) [usesAction, keyIndent] = [true, step[1]!.length + (step[2] ? 2 : 0)];
    else if (line.trim() && indent < keyIndent) keyIndent = -1;
    const input = keyIndent >= 0 && indent > keyIndent ? INPUT.exec(line) : null;
    if (input)
      pins.push({ line: i, start: line.indexOf(input[1]!, line.indexOf('version')), version: input[1]! });
    for (const m of line.matchAll(NPX))
      pins.push({ line: i, start: m.index + m[0].indexOf('@') + 1, version: m[1]! });
  });
  return { pins, usesAction };
}

/** The workflow files of a repository root, but the update workflow itself (it runs `@latest` on purpose). */
async function workflowFiles(root: string) {
  const dir = join(root, '.github/workflows');
  const names = existsSync(dir) ? await readdir(dir) : [];
  return names.filter((n) => /\.ya?ml$/.test(n) && n !== 'indx-watch-update.yml').map((n) => join(dir, n));
}

// ---------- doctor ----------
export interface Inspect {
  root: string;
  /** the bundle directory */
  dir: string;
  pin?: string | undefined;
  /** `[store].url` when it is https (the hosted app) */
  hosted?: string | undefined;
  /** ask the network: the newest release and the hosted app's /healthz */
  online?: { source: ReleaseSource; get?: typeof fetch } | undefined;
}

const part = (p: Omit<Part, 'note'>, note?: string): Part => ({ ...p, ...(note && { note }) });

/** Every pinned part of the repository against the target (the pin, else the running version). */
export async function inspect(o: Inspect, running = VERSION) {
  const target = o.pin ?? running;
  const parts: Part[] = [];
  const latest = (await o.online?.source.latest())?.version;
  const warnings: string[] = [];
  const tool = !o.pin ? 'unpinned' : latest && isOlderVersion(o.pin, latest) ? 'outdated' : 'ok';
  parts.push(
    part(
      { part: 'tool', target: 'project.toml', version: o.pin ?? null, state: tool },
      o.pin ? undefined : 'no [tool] indx_watch',
    ),
  );
  const cli = o.pin && isOlderVersion(running, o.pin) ? 'outdated' : 'ok';
  parts.push(part({ part: 'cli', target: 'running', version: running, state: cli }));

  const pkg = await readJson(join(o.root, 'package.json'));
  const spec: string | undefined = { ...pkg?.dependencies, ...pkg?.devDependencies }['indx-watch'];
  if (spec) {
    const version = spec.replace(/^[\^~]/, '');
    parts.push(
      part(
        {
          part: 'package',
          target: 'package.json',
          version: SEMVER.test(version) ? version : null,
          state: judge(version, target),
        },
        SEMVER.test(version) ? undefined : spec,
      ),
    );
  }

  const mcp = (await readJson(join(o.root, '.mcp.json')))?.mcpServers?.['indx-watch'];
  if (mcp) {
    const arg = (mcp.args as string[] | undefined)?.find((a) => /^indx-watch(@|$)/.test(a));
    const version = arg?.split('@')[1];
    parts.push(
      part({ part: 'mcp', target: '.mcp.json', version: version ?? null, state: judge(version, target) }),
    );
  }

  for (const base of SKILL_DIRS) {
    if (!existsSync(join(o.root, base, 'indx-watch/SKILL.md'))) continue;
    const m = await readManifest(
      async (path) => readFile(join(o.root, path), 'utf8').catch(() => undefined),
      base,
    );
    let edited = 0;
    for (const [path, hash] of Object.entries(m.files)) {
      const file = join(o.root, base, path);
      if (existsSync(file) && sha(await readFile(file)) !== hash) edited++;
    }
    const state = edited ? 'locally-edited' : judge(m.version, target);
    const note = edited
      ? `${edited} file${edited === 1 ? '' : 's'} changed by hand`
      : m.version
        ? undefined
        : `no ${MANIFEST}`;
    parts.push(part({ part: 'skills', target: base, version: m.version || null, state }, note));
  }

  for (const file of await workflowFiles(o.root)) {
    const { pins, usesAction } = workflowPins(await readFile(file, 'utf8'));
    const where = relative(o.root, file);
    if (pins.length) {
      const oldest = pins.map((p) => p.version).sort((a, b) => (isOlderVersion(a, b) ? -1 : 1))[0]!;
      parts.push(part({ part: 'workflow', target: where, version: oldest, state: judge(oldest, target) }));
    } else if (usesAction) {
      const note = o.pin ? 'follows [tool]' : 'no version: input and no [tool]';
      parts.push(
        part(
          { part: 'workflow', target: where, version: o.pin ?? null, state: o.pin ? 'ok' : 'unpinned' },
          note,
        ),
      );
    } else if (/\b(npx|dlx|bunx)\b[^\n]*\bindx-watch\b/.test(await readFile(file, 'utf8')))
      parts.push(
        part(
          { part: 'workflow', target: where, version: null, state: 'unpinned' },
          'runs indx-watch without a version',
        ),
      );
  }

  if (o.online && o.hosted) {
    const res = await (o.online.get ?? fetch)(new URL('/healthz', o.hosted), {
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined);
    const version = res?.ok
      ? ((await res.json().catch(() => ({}))) as { version?: string }).version
      : undefined;
    if (version)
      parts.push(part({ part: 'worker', target: o.hosted, version, state: judge(version, target) }));
    else warnings.push(`could not read ${o.hosted}/healthz`);
  }
  if (o.online && !latest) warnings.push('could not reach the registry for the newest version');
  return { parts, latest: latest ?? null, target, warnings };
}

/** Releases after `version` (and up to `to` when given), newest first. */
export const releasesAfter = (all: Release[], version: string, to?: string) =>
  all.filter((r) => isOlderVersion(version, r.version) && (!to || !isOlderVersion(to, r.version)));

// ---------- update ----------
export type StepName = 'tool' | 'package' | 'skills' | 'workflow' | 'schema' | 'migrate' | 'check' | 'deploy';
export interface Step {
  step: StepName;
  changed: string[];
  note?: string;
}
const step = (name: StepName, changed: string[], note?: string): Step => ({
  step: name,
  changed,
  ...(note && { note }),
});

/**
 * The patches of the project that no longer apply to version `to`. W7 (T-508, `iw patch check --to`) replaces this
 * body; while it returns none, `iw update` is never refused on that ground.
 */
export async function failingPatches(_p: Project, _to: string): Promise<string[]> {
  return [];
}

/** The install command that brings the lockfile in line with package.json. */
export function installCommand(root: string) {
  const lock: [string, string][] = [
    ['pnpm-lock.yaml', 'pnpm install'],
    ['yarn.lock', 'yarn install'],
    ['bun.lock', 'bun install'],
    ['bun.lockb', 'bun install'],
  ];
  return lock.find(([f]) => existsSync(join(root, f)))?.[1] ?? 'npm install';
}

const SCHEMA_REF =
  /^(#:schema https:\/\/raw\.githubusercontent\.com\/INDXDev\/indx-watch\/)(?:main|v\d+\.\d+\.\d+)(\/schemas\/v1\/)/;

/** Step 1 and 5: `[tool]` in project.toml, then the `#:schema` ref of every definition file. */
export async function pinBundle(p: Project, to: string, dry: boolean): Promise<[Step, Step]> {
  const [data, rel] = [p.bundle.project.data, (f: string) => relative(p.root, join(p.dir, f))];
  const tool: string[] = [];
  if (data.tool?.indx_watch !== to) {
    tool.push(rel('project.toml'));
    if (!dry)
      await iwb.writeDefinition(p.fs, 'project.toml', 'project', {
        ...data,
        tool: { ...data.tool, indx_watch: to },
      });
  }
  const schema: string[] = [];
  for (const f of (await iwb.walk(p.fs, '')).filter((f) => f.endsWith('.toml'))) {
    const text = new TextDecoder().decode((await p.fs.read(f))!);
    const next = text.replace(SCHEMA_REF, `$1v${to}$2`);
    if (next === text) continue;
    schema.push(rel(f));
    if (!dry) await p.fs.write(f, next);
  }
  // project.toml is written first with its old ref; it moves with the others (and in a dry run it still shows here)
  return [step('tool', tool), step('schema', schema)];
}

/** Step 2: the `indx-watch` entry of package.json (its `^` or `~` kept). */
export async function pinPackage(root: string, to: string, dry: boolean): Promise<Step> {
  const file = join(root, 'package.json');
  if (!existsSync(file)) return step('package', []);
  const text = await readFile(file, 'utf8');
  const json = JSON.parse(text);
  let changed = false;
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const spec: string | undefined = json[key]?.['indx-watch'];
    const next =
      spec && /^[\^~]?\d+\.\d+\.\d+/.test(spec) ? `${/^[\^~]/.exec(spec)?.[0] ?? ''}${to}` : undefined;
    if (next && next !== spec) [json[key]['indx-watch'], changed] = [next, true];
  }
  if (changed && !dry) {
    const indent = /^\n?( +|\t)"/m.exec(text.slice(1))?.[1] ?? 2;
    await writeFile(file, `${JSON.stringify(json, null, indent)}\n`);
  }
  return step('package', changed ? ['package.json'] : []);
}

/** Step 4: every pinned version of the workflows. */
export async function pinWorkflows(root: string, to: string, dry: boolean): Promise<Step> {
  const changed: string[] = [];
  for (const file of await workflowFiles(root)) {
    const lines = (await readFile(file, 'utf8')).split('\n');
    const { pins } = workflowPins(lines.join('\n'));
    // right to left, so earlier positions of a line stay valid
    for (const { line, start, version } of pins
      .filter((p) => p.version !== to)
      .sort((a, b) => b.start - a.start))
      lines[line] = lines[line]!.slice(0, start) + to + lines[line]!.slice(start + version.length);
    if (pins.every((p) => p.version === to)) continue;
    changed.push(relative(root, file));
    if (!dry) await writeFile(file, lines.join('\n'));
  }
  return step('workflow', changed);
}

/** Step 3: the skill copies, the `.mcp.json` pin and the AGENTS.md block, for the agents already set up here. */
export async function refreshAgents(p: Project, src: string, to: string, dry: boolean) {
  const has = (...paths: string[]) => paths.some((f) => existsSync(join(p.root, f)));
  const clients = {
    claude: has('.claude/skills', '.mcp.json'),
    codex: has('.agents/skills', '.codex/config.toml'),
  };
  if (!clients.claude && !clients.codex)
    return { step: step('skills', [], 'no agent setup here; `iw skills install` sets it up'), warnings: [] };
  const { warnings, ...out } = await setupAgents(p.root, src, clients, { version: VERSION, pin: to, dry });
  const note = out.skipped.length ? `left alone, edited by hand: ${out.skipped.join(', ')}` : undefined;
  return { step: step('skills', out.files, note), warnings };
}

/** The changelog excerpt of the releases after `from` up to `to`. */
export function changelogNotes(all: Release[], from: string | undefined, to: string) {
  const picked = from ? releasesAfter(all, from, to) : all.filter((r) => r.version === to);
  return picked.map((r) => `## ${r.version}${r.date ? ` - ${r.date}` : ''}\n\n${r.notes}`).join('\n\n');
}

/** The update workflow of `iw update --workflow`: written only when missing. */
export async function writeUpdateWorkflow(root: string, template: string, dry: boolean) {
  const rel = '.github/workflows/indx-watch-update.yml';
  if (existsSync(join(root, rel))) return { rel, written: false };
  if (!dry) {
    await mkdir(join(root, '.github/workflows'), { recursive: true });
    await writeFile(join(root, rel), await readFile(template, 'utf8'));
  }
  return { rel, written: true };
}
