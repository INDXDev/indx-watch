/**
 * Agent setup for `iw init` and `iw skills install` (docs/spec/agents.md#install): the skills for
 * Claude Code and Codex from one source, the project MCP server and the marked AGENTS.md block.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { Problem } from '@indx-watch/bundle';
import { parse, stringify } from 'smol-toml';

/** Frontmatter keys every Agent Skills client (and a claude.ai upload) accepts. */
const PORTABLE = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];
const MCP = { command: 'npx', args: ['-y', 'indx-watch', 'mcp'] };
const [START, END] = ['<!-- indx-watch:start -->', '<!-- indx-watch:end -->'];

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
function openaiYaml(name: string, description: string) {
  const words = name.split('-').map((w) => (['indx', 'iw'].includes(w) ? w.toUpperCase() : w));
  const title = words.join(' ').replace(/^./, (c) => c.toUpperCase());
  const short = firstSentence(description);
  const shortDescription = short.length > 120 ? `${short.slice(0, short.lastIndexOf(' ', 119))}…` : short;
  return `interface:\n  display_name: ${JSON.stringify(title)}\n  short_description: ${JSON.stringify(shortDescription)}\npolicy:\n  allow_implicit_invocation: true\n`;
}

/** The AGENTS.md block: one line per skill with how to call it and when to use it. */
function agentsBlock(skills: { name: string; description: string }[]) {
  const lines = skills.map(
    (s) => `- \`${s.name}\` (\`/${s.name}\` or \`$${s.name}\`): ${whenToUse(s.description)}`,
  );
  const intro =
    'This repository keeps its test cases, acceptance criteria and fixtures in `.indx-watch/` ([INDX Watch](https://github.com/INDXDev/indx-watch)). Use these skills for that work (Claude Code: `/<name>`, Codex: `$<name>`); the `indx-watch` MCP server offers the same operations. This block is written by `iw skills install`; edit outside it.';
  return [START, '## INDX Watch', '', intro, '', ...lines, END].join('\n');
}

/** Write the agent files under `root`; only files whose content changes are written (and listed). */
export async function setupAgents(root: string, src: string, to: { claude: boolean; codex: boolean }) {
  const out = { installed: [] as string[], files: [] as string[], warnings: [] as Problem[] };
  const read = async (path: string) =>
    existsSync(join(root, path)) ? readFile(join(root, path), 'utf8') : undefined;
  const put = async (path: string, data: string | Buffer) => {
    const file = join(root, path);
    if (existsSync(file) && Buffer.from(data).equals(await readFile(file))) return;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
    out.files.push(path);
  };
  const warn = (path: string, e: unknown) =>
    out.warnings.push({
      severity: 'warning',
      code: 'agent-config',
      message: `${path} was left unchanged: ${(e as Error).message.split('\n')[0]}`,
    });

  const skills = [];
  for (const d of await readdir(src, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = join(src, d.name);
    const files = (await readdir(dir, { recursive: true, withFileTypes: true })).filter((f) => f.isFile());
    const fm = frontmatter(await readFile(join(dir, 'SKILL.md'), 'utf8'));
    skills.push({ name: d.name, description: fm.value('description') });
    for (const [base, on] of [
      ['.claude/skills', to.claude],
      ['.agents/skills', to.codex],
    ] as const) {
      if (!on) continue;
      out.installed.push(`${base}/${d.name}`);
      for (const f of files) {
        const rel = relative(dir, join(f.parentPath, f.name)).split('\\').join('/');
        const data = await readFile(join(dir, rel));
        const codexSkill = base === '.agents/skills' && rel === 'SKILL.md';
        await put(`${base}/${d.name}/${rel}`, codexSkill ? portable(data.toString('utf8')) : data);
      }
      if (base === '.agents/skills' && !files.some((f) => f.name === 'openai.yaml'))
        await put(`${base}/${d.name}/agents/openai.yaml`, openaiYaml(d.name, fm.value('description')));
    }
  }

  if (to.claude) {
    try {
      const mcp = JSON.parse((await read('.mcp.json')) ?? '{}');
      if (JSON.stringify(mcp.mcpServers?.['indx-watch']) !== JSON.stringify(MCP)) {
        mcp.mcpServers = { ...mcp.mcpServers, 'indx-watch': MCP };
        await put('.mcp.json', `${JSON.stringify(mcp, null, 2)}\n`);
      }
    } catch (e) {
      warn('.mcp.json', e);
    }
    const claude = await read('CLAUDE.md');
    if (claude !== undefined && !/^@AGENTS\.md\s*$/m.test(claude))
      await put('CLAUDE.md', append(claude, '@AGENTS.md\n'));
  }
  if (to.codex) {
    // not a bundle file, so not formatToml(): append the one table smol-toml writes and keep the rest as is
    const path = '.codex/config.toml';
    try {
      const old = (await read(path)) ?? '';
      const cfg = parse(old) as { mcp_servers?: Record<string, unknown> };
      if (!cfg.mcp_servers?.['indx-watch']) {
        const next = append(old, stringify({ mcp_servers: { 'indx-watch': MCP } }));
        parse(next);
        await put(path, next);
      }
    } catch (e) {
      warn(path, e);
    }
  }

  const agents = (await read('AGENTS.md')) ?? '';
  const [i, j] = [agents.indexOf(START), agents.indexOf(END)];
  const block = agentsBlock(skills);
  await put(
    'AGENTS.md',
    i >= 0 && j > i
      ? agents.slice(0, i) + block + agents.slice(j + END.length)
      : append(agents, `${block}\n`),
  );
  return out;
}
