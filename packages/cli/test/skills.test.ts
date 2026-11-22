/** `iw skills install`, the agent setup of `iw init` and the frontmatter rules (docs/spec/agents.md#install). */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseToml } from '@indx-watch/bundle';
import { describe, expect, it } from 'vitest';
import { setupAgents } from '../src/agents.js';
import { iwJson, ROOT } from './helpers.js';

const SKILLS = join(ROOT, 'skills');
const names = readdirSync(SKILLS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
const PORTABLE = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];
/** Claude Code keys a source skill may add; they stay in the .claude/ copies only. */
const CLAUDE = ['argument-hint', 'disable-model-invocation'];
const MCP = { command: 'npx', args: ['-y', 'indx-watch', 'mcp'] };
const read = (dir: string, path: string) => readFileSync(join(dir, path), 'utf8');

/** Top-level keys of the YAML frontmatter (a blank line may follow the opening ---). */
function frontmatterKeys(text: string): string[] {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) throw new Error('no frontmatter');
  return m[1]!
    .split(/\r?\n/)
    .flatMap((l) => (/^([A-Za-z][\w-]*):/.exec(l)?.[1] ? [/^([A-Za-z][\w-]*):/.exec(l)![1]!] : []));
}

describe('skills', () => {
  it('every source SKILL.md has only portable or Claude Code keys, including name and description', () => {
    expect(names.length).toBeGreaterThanOrEqual(6);
    for (const n of names) {
      const keys = frontmatterKeys(readFileSync(join(SKILLS, n, 'SKILL.md'), 'utf8'));
      expect(
        keys.filter((k) => ![...PORTABLE, ...CLAUDE].includes(k)),
        n,
      ).toEqual([]);
      expect(keys, n).toEqual(expect.arrayContaining(['name', 'description']));
    }
  });

  it('job skills (docs/spec/agents.md#job-skills-v04) follow the shared conventions a script can check', () => {
    const jobs = { 'iw-setup': 'indx-watch', 'iw-design': 'write-test-cases', 'iw-data': 'manage-fixtures' };
    for (const [n, ref] of Object.entries(jobs)) {
      const text = readFileSync(join(SKILLS, n, 'SKILL.md'), 'utf8');
      const description = /^description: (.+)$/m.exec(text)![1]!;
      expect(description.length, n).toBeLessThanOrEqual(1024);
      expect(description, n).toMatch(/Use when .*「/); // triggers in English and Japanese
      expect(frontmatterKeys(text), n).toContain('argument-hint');
      expect(frontmatterKeys(text), n).not.toContain('disable-model-invocation');
      expect(text, n).toContain(`(../${ref}/SKILL.md)`);
      expect(text, n).toMatch(/^Next: .+\(iw-[a-z]+\)/m);
      expect(text.split('\n').length, n).toBeLessThanOrEqual(150);
    }
  });

  it('skills install copies every skill folder (with references/) to both locations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'iw-skills-'));
    const r = iwJson(dir, 'skills install', ['skills', 'install']);
    expect(r.json.data.installed).toHaveLength(names.length * 2);
    for (const base of ['.claude/skills', '.agents/skills'])
      for (const n of names) expect(existsSync(join(dir, base, n, 'SKILL.md')), `${base}/${n}`).toBe(true);
    expect(existsSync(join(dir, '.claude/skills/indx-watch/references/cli-json.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude/skills/README.md'))).toBe(false);
    const only = mkdtempSync(join(tmpdir(), 'iw-skills-'));
    expect(iwJson(only, 'skills install', ['skills', 'install', '--codex']).json.data.installed[0]).toMatch(
      /^\.agents\//,
    );
    expect(existsSync(join(only, '.claude'))).toBe(false);
    expect(existsSync(join(only, '.mcp.json'))).toBe(false);
    expect(existsSync(join(only, '.codex/config.toml'))).toBe(true);
  });

  it('init sets up both agents with the shop bundle, once, and re-runs update in place', () => {
    const dir = mkdtempSync(join(tmpdir(), 'iw-skills-'));
    // a repository that already has other MCP servers, Codex settings, an AGENTS.md and a CLAUDE.md
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
    mkdirSync(join(dir, '.codex'));
    writeFileSync(join(dir, '.codex/config.toml'), 'model = "o9"\n\n[mcp_servers.other]\ncommand = "x"\n');
    writeFileSync(join(dir, 'AGENTS.md'), '# Rules\n\nBe nice.\n');
    writeFileSync(join(dir, 'CLAUDE.md'), '# Claude\n');
    const init = iwJson(dir, 'init', ['init', '--example']).json.data;
    expect(init.agents.installed).toHaveLength(names.length * 2);
    for (const f of ['.mcp.json', '.codex/config.toml', 'AGENTS.md', 'CLAUDE.md'])
      expect(init.agents.files).toContain(f);
    for (const n of names) {
      expect(read(dir, `.claude/skills/${n}/SKILL.md`)).toBe(read(SKILLS, `${n}/SKILL.md`));
      const keys = frontmatterKeys(read(dir, `.agents/skills/${n}/SKILL.md`));
      expect(
        keys.filter((k) => !PORTABLE.includes(k)),
        n,
      ).toEqual([]);
      expect(read(dir, `.agents/skills/${n}/agents/openai.yaml`)).toMatch(
        /display_name: ".+"\n {2}short_description: ".+"\npolicy:\n {2}allow_implicit_invocation: true\n$/,
      );
    }
    expect(JSON.parse(read(dir, '.mcp.json')).mcpServers).toEqual({
      other: { command: 'x' },
      'indx-watch': MCP,
    });
    // biome-ignore lint/suspicious/noExplicitAny: test convenience
    const codex = parseToml(read(dir, '.codex/config.toml')) as Record<string, any>;
    expect(codex.model).toBe('o9');
    expect(codex.mcp_servers).toEqual({ other: { command: 'x' }, 'indx-watch': MCP });
    const agents = read(dir, 'AGENTS.md');
    expect(agents.startsWith('# Rules\n\nBe nice.\n\n<!-- indx-watch:start -->')).toBe(true);
    for (const n of names) expect(agents).toContain(`- \`${n}\` (\`/${n}\` or \`$${n}\`): Use when`);
    expect(read(dir, 'CLAUDE.md')).toBe('# Claude\n\n@AGENTS.md\n');

    // idempotent: nothing changes; a changed skill file and block are rewritten in place, text around stays
    expect(iwJson(dir, 'skills install', ['skills', 'install']).json.data.files).toEqual([]);
    writeFileSync(join(dir, 'AGENTS.md'), `${agents.replace('## INDX Watch', 'stale')}\nMore rules.\n`);
    writeFileSync(join(dir, '.claude/skills/run-tests/SKILL.md'), 'old');
    const again = iwJson(dir, 'skills install', ['skills', 'install']).json.data;
    expect(again.files).toEqual(['.claude/skills/run-tests/SKILL.md', 'AGENTS.md']);
    expect(read(dir, 'AGENTS.md')).toBe(`${agents}\nMore rules.\n`);
  });

  it('init --no-agents writes no agent files; an unreadable .mcp.json is left alone with a warning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'iw-skills-'));
    expect(iwJson(dir, 'init', ['init', '--no-agents']).json.data.agents).toBeUndefined();
    expect(readdirSync(dir)).toEqual(['.indx-watch']);
    writeFileSync(join(dir, '.mcp.json'), '{ not json');
    const r = iwJson(dir, 'skills install', ['skills', 'install', '--claude']).json;
    expect(r.warnings.map((w: { code: string }) => w.code)).toEqual(['agent-config']);
    expect(read(dir, '.mcp.json')).toBe('{ not json');
    expect(existsSync(join(dir, '.codex'))).toBe(false);
  });

  it('Claude-only keys stay in .claude/ copies, and disable-model-invocation turns off implicit use in Codex', async () => {
    const src = mkdtempSync(join(tmpdir(), 'iw-src-'));
    mkdirSync(join(src, 'my-job'));
    const fm = [
      'name: my-job',
      'description: >-',
      '  Does a job. Use when',
      '  asked to.',
      'argument-hint: "[TC-n]"',
      'metadata:',
      '  owner: qa',
      '  tags:',
      '    - a',
      'disable-model-invocation: true',
    ];
    const skill = `---\n${fm.join('\n')}\n---\n\n# My job\n`;
    writeFileSync(join(src, 'my-job/SKILL.md'), skill);
    const dir = mkdtempSync(join(tmpdir(), 'iw-skills-'));
    await setupAgents(dir, src, { claude: true, codex: true });
    expect(read(dir, '.claude/skills/my-job/SKILL.md')).toBe(skill);
    expect(read(dir, '.agents/skills/my-job/SKILL.md')).toBe(
      `---\n${[...fm.slice(0, 4), ...fm.slice(5, 9)].join('\n')}\n---\n\n# My job\n`,
    );
    expect(read(dir, '.agents/skills/my-job/agents/openai.yaml')).toContain(
      'allow_implicit_invocation: false\n',
    );
    expect(read(dir, 'AGENTS.md')).toContain('`/my-job` or `$my-job`): Use when asked to.');
  });

  it('init of a new directory inside a git repository sets up that directory, not the repository root', () => {
    const repo = mkdtempSync(join(tmpdir(), 'iw-skills-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    expect(iwJson(repo, 'init', ['init', 'demo']).json.data.agents.files).toContain('AGENTS.md');
    expect(existsSync(join(repo, 'demo/AGENTS.md'))).toBe(true);
    expect(readdirSync(repo).sort()).toEqual(['.git', 'demo']);
  });
});
