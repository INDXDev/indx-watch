/** `iw skills install`, the agent setup of `iw init` and the frontmatter rules (docs/spec/agents.md#install). */

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseToml } from '@indx-watch/bundle';
import { describe, expect, it } from 'vitest';
import { setupAgents } from '../src/agents.js';
import { iwJson, PORTABLE, ROOT } from './helpers.js';

const SKILLS = join(ROOT, 'skills');
const names = readdirSync(SKILLS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
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

/** A repository that already has other MCP servers, Codex settings, an AGENTS.md and a CLAUDE.md. */
function existingRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'iw-skills-'));
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
  mkdirSync(join(dir, '.codex'));
  writeFileSync(join(dir, '.codex/config.toml'), 'model = "o9"\n\n[mcp_servers.other]\ncommand = "x"\n');
  writeFileSync(join(dir, 'AGENTS.md'), '# Rules\n\nBe nice.\n');
  writeFileSync(join(dir, 'CLAUDE.md'), '# Claude\n');
  return dir;
}

/** Every skill is copied to .claude/ as is and to .agents/ with portable keys and a Codex openai.yaml. */
function expectSkillCopies(dir: string) {
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
}

/** A retired recipe skill as an older INDX Watch wrote it (or, with another homepage, the user's own). */
const recipe = (name: string, home = 'https://github.com/INDXDev/indx-watch') =>
  `---\nname: ${name}\ndescription: Old. Use when old.\nmetadata: { version: "0.1.0", homepage: "${home}" }\n---\n\n# Old\n`;

function put(dir: string, path: string, text: string) {
  mkdirSync(join(dir, path, '..'), { recursive: true });
  writeFileSync(join(dir, path), text);
}

describe('skills', () => {
  it('job skills (docs/spec/agents.md#job-skills) follow the shared conventions a script can check', () => {
    const jobs = {
      'iw-setup': 'wiring',
      'iw-design': 'write-test-cases',
      'iw-data': 'manage-fixtures',
      'iw-test': 'run-tests',
      'iw-triage': 'triage-failure',
      'iw-status': 'release-report',
    };
    expect([...names].sort()).toEqual(['indx-watch', ...Object.keys(jobs)].sort());
    for (const [n, ref] of Object.entries(jobs)) {
      const text = readFileSync(join(SKILLS, n, 'SKILL.md'), 'utf8');
      const description = /^description: (.+)$/m.exec(text)![1]!;
      expect(description.length, n).toBeLessThanOrEqual(1024);
      expect(description, n).toMatch(/Use when .*「[^」]*\p{Script=Hiragana}/u); // triggers in English and Japanese
      expect(frontmatterKeys(text), n).toEqual(
        expect.arrayContaining(['argument-hint', 'license', 'metadata']),
      );
      expect(frontmatterKeys(text), n).not.toContain('disable-model-invocation');
      expect(text, n).toContain(`](references/${ref}.md)`);
      expect(text, n).toMatch(/Next: .+\(iw-[a-z]+\)/);
      expect(text.split('\n').length, n).toBeLessThanOrEqual(150);
    }
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
});

describe('iw skills install', () => {
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

  it('an upgrade removes the retired recipe skills INDX Watch wrote, and only those', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'iw-skills-'));
    put(dir, '.claude/skills/run-tests/SKILL.md', recipe('run-tests'));
    put(dir, '.agents/skills/run-tests/SKILL.md', recipe('run-tests'));
    put(dir, '.agents/skills/run-tests/agents/openai.yaml', 'interface: {}\n');
    put(dir, '.claude/skills/triage-failure/SKILL.md', recipe('triage-failure'));
    put(dir, '.claude/skills/triage-failure/notes.md', 'mine\n'); // a file the user added: kept, with a warning
    put(dir, '.claude/skills/release-report/SKILL.md', recipe('release-report', 'https://example.test')); // the user's own
    const r = await setupAgents(dir, SKILLS, { claude: true, codex: false });
    expect(r.removed).toEqual(['.claude/skills/run-tests']);
    expect(r.warnings.map((w) => w.message)).toEqual([
      '.claude/skills/triage-failure was left unchanged: INDX Watch no longer ships it; move out notes.md',
    ]);
    expect(existsSync(join(dir, '.agents/skills/run-tests/agents/openai.yaml'))).toBe(true); // --claude only
    expect(existsSync(join(dir, '.claude/skills/release-report/SKILL.md'))).toBe(true);
    const both = await setupAgents(dir, SKILLS, { claude: true, codex: true });
    expect(both.removed).toEqual(['.agents/skills/run-tests']);
    expect(existsSync(join(dir, '.agents/skills/run-tests'))).toBe(false);
  });

  it("this repository's own agent files (CONTRIBUTING.md#dogfooding) are what iw skills install writes", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'iw-self-'));
    for (const f of ['.claude/skills', '.agents/skills', '.mcp.json', '.codex', 'AGENTS.md', 'CLAUDE.md'])
      cpSync(join(ROOT, f), join(dir, f), { recursive: true });
    const r = await setupAgents(dir, SKILLS, { claude: true, codex: true });
    expect(r.files, 'run pnpm iw skills install at the repository root').toEqual([]);
    for (const base of ['.claude/skills', '.agents/skills'])
      expect(readdirSync(join(ROOT, base)).sort(), `stale folders in ${base}`).toEqual([...names].sort());
  });
});

describe('iw init agent setup', () => {
  it('init sets up both agents with the shop bundle, once, and re-runs update in place', () => {
    const dir = existingRepo();
    const init = iwJson(dir, 'init', ['init', '--example']).json.data;
    expect(init.agents.installed).toHaveLength(names.length * 2);
    for (const f of ['.mcp.json', '.codex/config.toml', 'AGENTS.md', 'CLAUDE.md'])
      expect(init.agents.files).toContain(f);
    expectSkillCopies(dir);
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
    writeFileSync(join(dir, '.claude/skills/iw-test/SKILL.md'), 'old');
    const again = iwJson(dir, 'skills install', ['skills', 'install']).json.data;
    expect(again.files).toEqual(['.claude/skills/iw-test/SKILL.md', 'AGENTS.md']);
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

  it('init of a new directory inside a git repository sets up that directory, not the repository root', () => {
    const repo = mkdtempSync(join(tmpdir(), 'iw-skills-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    expect(iwJson(repo, 'init', ['init', 'demo']).json.data.agents.files).toContain('AGENTS.md');
    expect(existsSync(join(repo, 'demo/AGENTS.md'))).toBe(true);
    expect(readdirSync(repo).sort()).toEqual(['.git', 'demo']);
  });
});
