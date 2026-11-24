/**
 * Agent setup for `iw init` and `iw skills install` (docs/spec/agents.md#install): the skills for
 * Claude Code and Codex from one source, the project MCP server and the marked AGENTS.md block.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import type { Problem } from '@indx-watch/bundle';
import { parse, stringify } from 'smol-toml';
import { VERSION } from './version.js';

/** Frontmatter keys every Agent Skills client (and a claude.ai upload) accepts. */
const PORTABLE = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];
/** The project MCP server, run by npx at `pin` (docs/spec/agents.md#install). */
export const mcpEntry = (pin: string) => ({ command: 'npx', args: ['-y', `indx-watch@${pin}`, 'mcp'] });
/** Per skills folder: the package version and the hash of every file written (what `iw doctor` compares). */
export const MANIFEST = '.indx-watch.json';
export type Manifest = { version: string; files: Record<string, string> };
export const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const [START, END] = ['<!-- indx-watch:start -->', '<!-- indx-watch:end -->'];
/** Skills of indx-watch 0.1 that are now references of the job skills; install removes the copies it wrote. */
const RETIRED = ['write-test-cases', 'manage-fixtures', 'run-tests', 'triage-failure', 'release-report'];
const HOMEPAGE = 'https://github.com/INDXDev/indx-watch';

/** Top-level frontmatter entries as [key, lines]; indented and blank lines stay with the key above. */
function frontmatter(text: string) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  const entries: [string, string[]][] = [];
  for (const line of m?.[1]?.split(/\r?\n/) ?? []) {
    const key = /^([A-Za-z][\w-]*):/.exec(line)?.[1];
    if (key) entries.push([key, [line]]);
    else entries.at(-1)?.[1].push(line);
  }
  const value = (k: string) => {
    const lines = entries.find(([key]) => key === k)?.[1] ?? [];
    return lines
      .join(' ')
      .slice(k.length + 1)
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(["'])(.*)\1$/, '$2');
  };
  return { entries, value, body: m ? text.slice(m[0].length) : text };
}

/** SKILL.md with only the portable frontmatter keys. */
const portable = (text: string) => {
  const { entries, body } = frontmatter(text);
  const kept = entries.filter(([k]) => PORTABLE.includes(k)).flatMap(([, lines]) => lines);
  return `---\n${kept.join('\n').trimEnd()}\n---\n${body}`;
};

/** `text` after `old`, separated by one blank line. */
const append = (old: string, text: string) => (old ? `${old.trimEnd()}\n\n${text}` : text);
const firstSentence = (s: string) => s.split(/\.\s/)[0]!.replace(/\.$/, '');
const whenToUse = (d: string) => /Use when[\s\S]*?\.(\s|$)/.exec(d)?.[0].trim() ?? `${firstSentence(d)}.`;
/** Codex UI metadata (docs/research/platform-notes.md#codex); JSON strings are valid YAML scalars. */
function openaiYaml(name: string, value: (key: string) => string) {
  const words = name.split('-').map((w) => (['indx', 'iw'].includes(w) ? w.toUpperCase() : w));
  const title = words.join(' ').replace(/^./, (c) => c.toUpperCase());
  const short = firstSentence(value('description'));
  const shortDescription = short.length > 120 ? `${short.slice(0, short.lastIndexOf(' ', 119))}…` : short;
  return `interface:\n  display_name: ${JSON.stringify(title)}\n  short_description: ${JSON.stringify(shortDescription)}\npolicy:\n  allow_implicit_invocation: ${value('disable-model-invocation') !== 'true'}\n`;
}

type Skill = { name: string; description: string };
/** The AGENTS.md block: one line per skill with how to call it and when to use it. */
function agentsBlock(skills: Skill[]) {
  const lines = skills.map(
    (s) => `- \`${s.name}\` (\`/${s.name}\` or \`$${s.name}\`): ${whenToUse(s.description)}`,
  );
  const intro =
    'This repository keeps its test cases, acceptance criteria and fixtures in `.indx-watch/` ([INDX Watch](https://github.com/INDXDev/indx-watch)). Use these skills for that work (Claude Code: `/<name>`, Codex: `$<name>`); the `indx-watch` MCP server offers the same operations. This block is written by `iw skills install`; edit outside it.';
  return [START, '## INDX Watch', '', intro, '', ...lines, END].join('\n');
}

/** Files under `dir` as `/`-separated relative paths. */
const filesIn = async (dir: string) =>
  (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((f) => f.isFile())
    .map((f) => relative(dir, join(f.parentPath, f.name)).split('\\').join('/'));

/** What one setupAgents call writes into `root`, and what it reports. */
function writer(root: string, dry = false) {
  const paths = (): string[] => [];
  const out = {
    ...{ installed: paths(), files: paths(), removed: paths(), skipped: paths() },
    warnings: [] as Problem[],
  };
  const read = async (path: string) =>
    existsSync(join(root, path)) ? readFile(join(root, path), 'utf8') : undefined;
  const put = async (path: string, data: string | Buffer) => {
    const file = join(root, path);
    if (existsSync(file) && Buffer.from(data).equals(await readFile(file))) return;
    out.files.push(path);
    if (dry) return;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
  };
  const warn = (path: string, e: unknown) =>
    out.warnings.push({
      severity: 'warning',
      code: 'agent-config',
      message: `${path} was left unchanged: ${(e as Error).message.split('\n')[0]}`,
    });
  return { root, dry, out, read, put, warn };
}
type Writer = ReturnType<typeof writer>;

/** Copy one skill folder to `base`; Codex gets a portable SKILL.md and an openai.yaml. */
async function copySkill(w: Writer, o: Install, dir: string, value: (key: string) => string) {
  const [name, codex, files] = [basename(dir), o.base === '.agents/skills', await filesIn(dir)];
  const put = async (rel: string, data: string | Buffer) => {
    o.manifest.files[`${name}/${rel}`] = sha(data);
    await w.put(`${o.base}/${name}/${rel}`, data);
  };
  w.out.installed.push(`${o.base}/${name}`);
  for (const rel of files) {
    const data = await readFile(join(dir, rel));
    await put(rel, codex && rel === 'SKILL.md' ? portable(data.toString('utf8')) : data);
  }
  if (codex && !files.includes('agents/openai.yaml'))
    await put('agents/openai.yaml', openaiYaml(name, value));
}

/** One skills folder being installed: its manifest, filled as files are written. */
type Install = { base: string; manifest: Manifest; version: string; force: boolean };

/** The files of a skill folder that changed since INDX Watch wrote them (by the manifest's hashes). */
async function editedFiles(w: Writer, o: Install, name: string) {
  const edited: string[] = [];
  for (const [path, hash] of Object.entries(o.manifest.files).filter(([p]) => p.startsWith(`${name}/`))) {
    const file = join(w.root, o.base, path);
    if (existsSync(file) && sha(await readFile(file)) !== hash) edited.push(path);
  }
  return edited;
}

/** What a skills folder's manifest says (an empty one when missing or unreadable). */
export const readManifest = async (read: (path: string) => Promise<string | undefined>, base: string) => {
  try {
    const m = JSON.parse((await read(`${base}/${MANIFEST}`)) ?? '') as Manifest;
    return typeof m.version === 'string' && m.files ? m : { version: '', files: {} };
  } catch {
    return { version: '', files: {} };
  }
};

/**
 * Copy each skill folder of `src` under every base, except one a person edited (without `force`); the skills, for
 * the AGENTS.md block. Each base keeps a manifest of the package version and the hash of every file written.
 */
async function installSkills(w: Writer, src: string, bases: string[], opts: Options) {
  const skills: Skill[] = [];
  const installs: Install[] = [];
  for (const base of bases)
    installs.push({
      base,
      version: opts.version,
      force: !!opts.force,
      manifest: await readManifest(w.read, base),
    });
  for (const d of await readdir(src, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = join(src, d.name);
    const fm = frontmatter(await readFile(join(dir, 'SKILL.md'), 'utf8'));
    skills.push({ name: d.name, description: fm.value('description') });
    for (const o of installs) {
      const edited = o.force ? [] : await editedFiles(w, o, d.name);
      if (!edited.length) await copySkill(w, o, dir, fm.value);
      else {
        w.out.skipped.push(`${o.base}/${d.name}`);
        w.warn(
          `${o.base}/${d.name}`,
          new Error(`edited locally (${edited.join(', ')}); --force overwrites it`),
        );
      }
    }
  }
  for (const o of installs)
    await w.put(
      `${o.base}/${MANIFEST}`,
      `${JSON.stringify({ version: o.version, files: o.manifest.files }, null, 2)}\n`,
    );
  return skills;
}

/** A retired skill folder goes only when INDX Watch wrote it: its name and homepage, and no files of its own. */
async function removeRetired(w: Writer, bases: string[], skills: Skill[]) {
  for (const base of bases)
    for (const name of RETIRED.filter((n) => !skills.some((s) => s.name === n))) {
      const fm = frontmatter((await w.read(`${base}/${name}/SKILL.md`)) ?? '');
      if (fm.value('name') !== name || !fm.value('metadata').includes(HOMEPAGE)) continue;
      const dir = join(w.root, base, name);
      const own = (await filesIn(dir)).filter((f) => !['SKILL.md', 'agents/openai.yaml'].includes(f));
      if (own.length) {
        w.warn(`${base}/${name}`, new Error(`INDX Watch no longer ships it; move out ${own.join(', ')}`));
        continue;
      }
      if (!w.dry) await rm(dir, { recursive: true });
      w.out.removed.push(`${base}/${name}`);
    }
}

/** Claude Code: the server in .mcp.json, and CLAUDE.md importing AGENTS.md when there is a CLAUDE.md. */
async function setupClaude(w: Writer, pin: string) {
  try {
    const [mcp, entry] = [JSON.parse((await w.read('.mcp.json')) ?? '{}'), mcpEntry(pin)];
    if (JSON.stringify(mcp.mcpServers?.['indx-watch']) !== JSON.stringify(entry)) {
      mcp.mcpServers = { ...mcp.mcpServers, 'indx-watch': entry };
      await w.put('.mcp.json', `${JSON.stringify(mcp, null, 2)}\n`);
    }
  } catch (e) {
    w.warn('.mcp.json', e);
  }
  const claude = await w.read('CLAUDE.md');
  if (claude !== undefined && !/^@AGENTS\.md\s*$/m.test(claude))
    await w.put('CLAUDE.md', append(claude, '@AGENTS.md\n'));
}

/** Codex: the server in .codex/config.toml. */
async function setupCodex(w: Writer, pin: string) {
  // not a bundle file, so not formatToml(): append the one table smol-toml writes and keep the rest as is
  const path = '.codex/config.toml';
  try {
    const old = (await w.read(path)) ?? '';
    const cfg = parse(old) as { mcp_servers?: Record<string, unknown> };
    if (cfg.mcp_servers?.['indx-watch']) return;
    const next = append(old, stringify({ mcp_servers: { 'indx-watch': mcpEntry(pin) } }));
    parse(next);
    await w.put(path, next);
  } catch (e) {
    w.warn(path, e);
  }
}

/** Replace the marked block of AGENTS.md, or append it. */
async function writeAgentsMd(w: Writer, skills: Skill[]) {
  const agents = (await w.read('AGENTS.md')) ?? '';
  const [i, j] = [agents.indexOf(START), agents.indexOf(END, agents.indexOf(START))];
  const block = agentsBlock(skills);
  await w.put(
    'AGENTS.md',
    i >= 0 && j > i
      ? agents.slice(0, i) + block + agents.slice(j + END.length)
      : append(agents, `${block}\n`),
  );
}

/** `version`: this package's (recorded in the skills manifest); `pin`: what `.mcp.json` runs ([tool], else `version`). */
export type Options = { version: string; pin?: string; force?: boolean; dry?: boolean };

/** Write the agent files under `root`; only files whose content changes are written (and listed). */
export async function setupAgents(
  root: string,
  src: string,
  to: { claude: boolean; codex: boolean },
  opts: Options = { version: VERSION },
) {
  const w = writer(root, opts.dry);
  const bases = (['.claude/skills', '.agents/skills'] as const).filter((_, i) => [to.claude, to.codex][i]);
  const skills = await installSkills(w, src, bases, opts);
  await removeRetired(w, bases, skills);
  if (to.claude) await setupClaude(w, opts.pin ?? opts.version);
  if (to.codex) await setupCodex(w, opts.pin ?? opts.version);
  await writeAgentsMd(w, skills);
  return w.out;
}
