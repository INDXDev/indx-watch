/** The skill lint (docs/spec/agents.md#lint): frontmatter, length, commands, example keys and links of skills/. */

import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setupAgents } from '../src/agents.js';
import { PORTABLE, ROOT } from './helpers.js';
import { lintSkills, parseFrontmatter } from './skill-lint.js';

const SKILLS = join(ROOT, 'skills');

/** A temp skills folder with one skill `demo` whose SKILL.md is `text`, plus optional extra files. */
function fixture(text: string, files: Record<string, string> = {}, folder = 'demo') {
  const dir = mkdtempSync(join(tmpdir(), 'iw-lint-'));
  for (const [path, body] of Object.entries({ 'SKILL.md': text, ...files })) {
    mkdirSync(dirname(join(dir, folder, path)), { recursive: true });
    writeFileSync(join(dir, folder, path), body);
  }
  return dir;
}
const skill = (fm: string[], body = '# Demo\n') =>
  `---\n${['name: demo', 'description: Does a demo. Use when asked for a demo.', ...fm].join('\n')}\n---\n\n${body}`;

describe('skill lint on skills/', () => {
  it('passes on every skill in skills/', () => {
    expect(readdirSync(SKILLS).length).toBeGreaterThan(1);
    expect(lintSkills(SKILLS)).toEqual([]);
  });

  it('passes on the installed copies; .agents/ copies keep only portable keys', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'iw-lint-'));
    await setupAgents(dir, SKILLS, { claude: true, codex: true });
    expect(lintSkills(join(dir, '.claude/skills'))).toEqual([]);
    expect(lintSkills(join(dir, '.agents/skills'), PORTABLE)).toEqual([]);
    // a Claude Code key in the source is fine there and gone from the .agents/ copy
    const src = fixture(skill(['argument-hint: "[TC-n]"', 'disable-model-invocation: true']));
    expect(lintSkills(src)).toEqual([]);
    expect(lintSkills(src, PORTABLE)).toEqual([
      'demo/SKILL.md: frontmatter key "argument-hint" is not allowed',
      'demo/SKILL.md: frontmatter key "disable-model-invocation" is not allowed',
    ]);
    const out = mkdtempSync(join(tmpdir(), 'iw-lint-'));
    await setupAgents(out, src, { claude: false, codex: true });
    expect(lintSkills(join(out, '.agents/skills'), PORTABLE)).toEqual([]);
  });
});

describe('skill lint of the frontmatter', () => {
  it('parses the frontmatter forms the skills use', () => {
    const text = `---\n\nname: demo\ndescription: >-\n  Folded\n  text.\nlicense: 'It''s'\nmetadata: { version: "0.4.0", homepage: "https://x.test" }\nallowed-tools: Bash Read\n---\n`;
    expect(parseFrontmatter(text)).toEqual({
      name: 'demo',
      description: 'Folded text.',
      license: "It's",
      metadata: { version: '0.4.0', homepage: 'https://x.test' },
      'allowed-tools': 'Bash Read',
    });
    expect(parseFrontmatter('---\nmetadata:\n  owner: qa\n---\n')).toEqual({ metadata: { owner: 'qa' } });
  });

  it('fails on bad frontmatter: keys, name, description, compatibility, YAML, length', () => {
    const lint = (text: string, folder = 'demo') => lintSkills(fixture(text, {}, folder));
    expect(lint(skill(['when_to_use: always']))).toEqual([
      'demo/SKILL.md: frontmatter key "when_to_use" is not allowed',
    ]);
    expect(lint(skill([]), 'other')).toEqual(['other/SKILL.md: name "demo" differs from the folder name']);
    expect(lint(skill([]).replace('name: demo', 'name: claude-demo'), 'claude-demo')).toEqual([
      'claude-demo/SKILL.md: name "claude-demo" contains a reserved word',
    ]);
    expect(lint(skill([]).replace('name: demo', 'name: Demo--x'), 'Demo--x')[0]).toMatch(/lowercase words/);
    expect(lint(skill([]).replace('Does a demo.', 'x'.repeat(1025)))[0]).toMatch(
      /1–1024 characters \(has 1052\)/,
    );
    expect(lint(skill([]).replace('Does a demo.', 'Runs <script> tags.'))).toEqual([
      'demo/SKILL.md: description contains an XML tag',
    ]);
    expect(lint(skill([`compatibility: ${'x'.repeat(501)}`]))).toEqual([
      'demo/SKILL.md: compatibility has 501 characters (max 500)',
    ]);
    expect(lint(skill(['license: a: b']))[0]).toMatch(/frontmatter does not parse: not a plain scalar/);
    expect(lint(skill(['metadata: plain']))).toEqual(['demo/SKILL.md: "metadata" has the wrong type']);
    expect(lint('# no frontmatter\n')[0]).toMatch(/no frontmatter/);
    expect(lint(skill([], 'line\n'.repeat(500)))).toEqual(['demo/SKILL.md: 505 lines (max 500)']);
  });
});

describe('skill lint of the body', () => {
  it('fails on a command that is not in cli.md, also in references/; lines marked planned are skipped', () => {
    const body = [
      'Run `iw status --json`, then `IW_ACTOR_KIND=agent iw fixture add a.txt --to FX-1`.',
      '```bash',
      'npx -y indx-watch mcp',
      'iw frobnicate --json',
      '```',
      'Then `iw fixture remove FX-1`, `npx indx-watch nope`, `npx --yes indx-watch nah` and `npx indx-watch@latest meh`.',
      'Later `iw guide TC-3` (*planned*, T-999).',
    ].join('\n');
    expect(
      lintSkills(
        fixture(skill([], `${body}\n[More](references/more.md)`), {
          'references/more.md': 'Use `iw wat`.\n',
        }),
      ),
    ).toEqual([
      'demo/SKILL.md: unknown command "iw frobnicate" (not in docs/spec/cli.md)',
      'demo/SKILL.md: unknown command "iw fixture remove" (not in docs/spec/cli.md)',
      'demo/SKILL.md: unknown command "iw nope" (not in docs/spec/cli.md)',
      'demo/SKILL.md: unknown command "iw nah" (not in docs/spec/cli.md)',
      'demo/SKILL.md: unknown command "iw meh" (not in docs/spec/cli.md)',
      'demo/references/more.md: unknown command "iw wat" (not in docs/spec/cli.md)',
    ]);
  });

  it('fails on example keys that are not from examples/shop, allowing the next free key', () => {
    const body =
      'UC-5, AC-5.1, TC-10, FX-4, FEAT-3, PLAN-1 and the new TC-11, FX-5, AC-5.2, AC-2.3 are fine; TC-12, UC-9, AC-5.3, AC-9.1 and FX-40 are not.\n';
    expect(lintSkills(fixture(skill([], body)))).toEqual(
      ['TC-12', 'UC-9', 'AC-5.3', 'AC-9.1', 'FX-40'].map(
        (k) => `demo/SKILL.md: ${k} is not in examples/shop`,
      ),
    );
  });

  it('fails on a relative link that does not resolve inside the skills folder, and on a reference SKILL.md does not link', () => {
    const body =
      '[ok](references/a.md#top), [web](https://x.test), [anchor](#x), [gone](references/b.md), [out](../../docs/x.md)\n';
    const dir = fixture(skill([], body), { 'references/a.md': '# A\n', 'references/c.md': '# C\n' });
    expect(lintSkills(dir)).toEqual([
      'demo/SKILL.md: link references/b.md does not resolve inside the skills folder',
      'demo/SKILL.md: link ../../docs/x.md does not resolve inside the skills folder',
      'demo/references/c.md: is not linked from SKILL.md, so an agent never loads it',
    ]);
  });
});
