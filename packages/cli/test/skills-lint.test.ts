/** The skill lint (docs/spec/agents.md#lint): frontmatter, length, commands, example keys and links of skills/. */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setupAgents } from '../src/agents.js';
import { ROOT } from './helpers.js';

const SKILLS = join(ROOT, 'skills');
const PORTABLE = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];
/** Claude Code keys a source skill may add (docs/spec/agents.md#skills). */
const SOURCE = [...PORTABLE, 'argument-hint', 'disable-model-invocation'];
const XML = /<\/?[A-Za-z][\w-]*(\s[^<>]*)?\/?>/;

type Value = string | Record<string, string>;

/** One YAML scalar: double-quoted, single-quoted or plain (no `: `, ` #` or leading indicator). */
function scalar(raw: string): string {
  const v = raw.trim();
  if (v.startsWith('"')) return JSON.parse(v) as string;
  if (v.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(v)) throw new Error(`bad single-quoted string ${v}`);
    return v.slice(1, -1).replaceAll("''", "'");
  }
  if (/^[[\]{}&*!|>%@`,#]/.test(v) || /:(\s|$)|\s#/.test(v)) throw new Error(`not a plain scalar: ${v}`);
  return v;
}

/** `{ k: v, … }` with scalar values. */
function flowMap(raw: string): Record<string, string> {
  const inner = raw.trim().slice(1, -1).trim();
  const out: Record<string, string> = {};
  const pair = /\s*([\w-]+)\s*:\s+("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,}]*?)\s*(?:,|$)/y;
  while (pair.lastIndex < inner.length) {
    const m = pair.exec(inner);
    if (!m) throw new Error(`bad flow map ${raw}`);
    out[m[1]!] = scalar(m[2]!);
  }
  return out;
}

/** The YAML subset skill frontmatter uses: top-level keys with scalars, block scalars or string maps. */
function parseFrontmatter(text: string): Record<string, Value> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) throw new Error('no frontmatter between --- lines');
  const lines = m[1]!.split(/\r?\n/);
  const out: Record<string, Value> = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim() || /^#/.test(line)) continue;
    const kv = /^([A-Za-z][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (!kv) throw new Error(`line ${i + 2} is not "key: value": ${line}`);
    const [, key, rest = ''] = kv as unknown as [string, string, string | undefined];
    if (key in out) throw new Error(`duplicate key ${key}`);
    const block: string[] = [];
    while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]!) || !lines[i + 1]!.trim())) {
      block.push(lines[++i]!);
    }
    while (block.length && !block.at(-1)!.trim()) block.pop();
    const value = rest.trim();
    if (/^[>|][+-]?$/.test(value)) {
      if (!block.length) throw new Error(`${key}: empty block scalar`);
      const parts = block.map((l) => l.trim());
      out[key] = value.startsWith('>') ? parts.join(' ').replace(/\s+/g, ' ') : parts.join('\n');
    } else if (!value) {
      if (!block.length) throw new Error(`${key}: no value`);
      out[key] = Object.fromEntries(
        block.map((l) => {
          const e = /^\s+([\w-]+):\s+(.+)$/.exec(l);
          if (!e) throw new Error(`${key}: "${l.trim()}" is not "key: value"`);
          return [e[1]!, scalar(e[2]!)];
        }),
      );
    } else if (value.startsWith('{')) {
      if (block.length) throw new Error(`${key}: flow map on one line only`);
      out[key] = flowMap(value);
    } else {
      const quoted = /^["']/.test(value);
      if (quoted && block.length) throw new Error(`${key}: quoted string on one line only`);
      out[key] = scalar([value, ...block.map((l) => l.trim())].join(' '));
    }
  }
  return out;
}

/** Command paths from the `### \`iw …\`` headings of cli.md: `new`, `fixture add`, `import playwright-plan`. */
function cliCommands(): Set<string> {
  const cmds = new Set<string>();
  for (const h of readFileSync(join(ROOT, 'docs/spec/cli.md'), 'utf8').match(/^###\s.*$/gm) ?? [])
    for (const [, code] of h.matchAll(/`iw ([^`]+)`/g)) {
      const words: string[] = [];
      for (const w of code!.split(/\s+/)) {
        if (/^[<[-]/.test(w)) break;
        words.push(w);
      }
      cmds.add(words.join(' '));
    }
  return cmds;
}

/** Keys in examples/shop, plus the next free key of each kind (what a worked example creates). */
function shopKeys(): Set<string> {
  const keys = new Set<string>();
  const dir = join(ROOT, 'examples/shop/.indx-watch');
  for (const f of readdirSync(dir, { recursive: true, withFileTypes: true }))
    if (f.isFile() && f.name.endsWith('.toml'))
      for (const [, k] of readFileSync(join(f.parentPath, f.name), 'utf8').matchAll(/^\s*key = "([^"]+)"/gm))
        keys.add(k!);
  const max = new Map<string, number>();
  for (const k of keys) {
    const [, kind, n] = /^([A-Z]+-(?:\d+\.)?)(\d+)$/.exec(k) ?? [];
    if (kind) max.set(kind, Math.max(max.get(kind) ?? 0, Number(n)));
  }
  for (const [kind, n] of max) keys.add(`${kind}${n + 1}`);
  for (const k of keys)
    if (/^UC-\d+$/.test(k) && !max.has(`AC-${k.slice(3)}.`)) keys.add(`AC-${k.slice(3)}.1`);
  return keys;
}

const COMMANDS = cliCommands();
const KEYS = shopKeys();
const MENTION = /(?:^|[\s(;&|$])(?:iw|npx\s+(?:-y\s+)?indx-watch)\s+([a-z][\w-]*)(?:\s+([a-z][\w-]*))?/g;

/** `iw <command>` mentions in code (fenced blocks and inline spans), skipping lines marked planned. */
function commandProblems(text: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (/\bplanned\b/i.test(line)) continue;
    const code = fenced ? [line] : [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
    for (const c of code)
      for (const [, w1, w2] of c.matchAll(MENTION)) {
        const subs = [...COMMANDS].filter((k) => k.startsWith(`${w1} `));
        if (COMMANDS.has(w1!) || (w2 && subs.includes(`${w1} ${w2}`))) continue;
        out.push(
          `unknown command "iw ${subs.length ? `${w1} ${w2 ?? ''}`.trim() : w1}" (not in docs/spec/cli.md)`,
        );
      }
  }
  return out;
}

/** Lint every skill folder under `dir`; returns problems as "<skill>/<file>: message". */
function lintSkills(dir: string, allowed = SOURCE): string[] {
  const problems: string[] = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const skill = join(dir, d.name);
    const say = (file: string, msg: string) => problems.push(`${d.name}/${file}: ${msg}`);
    if (!existsSync(join(skill, 'SKILL.md'))) {
      say('SKILL.md', 'missing');
      continue;
    }
    const text = readFileSync(join(skill, 'SKILL.md'), 'utf8');
    try {
      const fm = parseFrontmatter(text);
      for (const k of Object.keys(fm))
        if (!allowed.includes(k)) say('SKILL.md', `frontmatter key "${k}" is not allowed`);
      for (const [k, v] of Object.entries(fm))
        if ((k === 'metadata') !== (typeof v === 'object')) say('SKILL.md', `"${k}" has the wrong type`);
      const { name, description, compatibility } = fm as Record<string, string | undefined>;
      if (name !== d.name) say('SKILL.md', `name "${name}" differs from the folder name`);
      if (typeof name === 'string' && (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64))
        say(
          'SKILL.md',
          `name "${name}" must be lowercase words joined by single hyphens, at most 64 characters`,
        );
      if (typeof name === 'string' && /claude|anthropic/.test(name))
        say('SKILL.md', `name "${name}" contains a reserved word`);
      if (typeof description !== 'string' || !description.trim() || description.length > 1024)
        say('SKILL.md', `description must have 1–1024 characters (has ${description?.length ?? 0})`);
      else if (XML.test(description)) say('SKILL.md', 'description contains an XML tag');
      if (typeof compatibility === 'string' && compatibility.length > 500)
        say('SKILL.md', `compatibility has ${compatibility.length} characters (max 500)`);
    } catch (e) {
      say('SKILL.md', `frontmatter does not parse: ${(e as Error).message}`);
    }
    const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    if (lines > 500) say('SKILL.md', `${lines} lines (max 500)`);

    for (const f of readdirSync(skill, { recursive: true, withFileTypes: true })) {
      if (!f.isFile() || !f.name.endsWith('.md')) continue;
      const file = join(f.parentPath, f.name);
      const rel = relative(skill, file).split(sep).join('/');
      const md = readFileSync(file, 'utf8');
      for (const p of commandProblems(md)) say(rel, p);
      for (const [k] of md.matchAll(/\b(?:(?:UC|TC|FX|FEAT|PLAN)-\d+|AC-\d+\.\d+)\b/g))
        if (!KEYS.has(k)) say(rel, `${k} is not in examples/shop`);
      const prose = md.replace(/^\s*(```|~~~)[\s\S]*?^\s*\1/gm, '');
      for (const [, href] of prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        if (/^([a-z][\w+.-]*:|#)/i.test(href!)) continue;
        const target = resolve(dirname(file), decodeURI(href!.split('#')[0]!));
        if (!existsSync(target) || relative(dir, target).startsWith('..'))
          say(rel, `link ${href} does not resolve inside the skills folder`);
      }
    }
  }
  return problems;
}

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

describe('skill lint', () => {
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

  it('fails on a command that is not in cli.md, also in references/; lines marked planned are skipped', () => {
    const body = [
      'Run `iw status --json`, then `IW_ACTOR_KIND=agent iw fixture add a.txt --to FX-1`.',
      '```bash',
      'npx -y indx-watch mcp',
      'iw frobnicate --json',
      '```',
      'Then `iw fixture remove FX-1` and `npx indx-watch nope`.',
      'Later `iw guide TC-3` (*planned*, T-999).',
    ].join('\n');
    expect(lintSkills(fixture(skill([], body), { 'references/more.md': 'Use `iw wat`.\n' }))).toEqual([
      'demo/SKILL.md: unknown command "iw frobnicate" (not in docs/spec/cli.md)',
      'demo/SKILL.md: unknown command "iw fixture remove" (not in docs/spec/cli.md)',
      'demo/SKILL.md: unknown command "iw nope" (not in docs/spec/cli.md)',
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

  it('fails on a relative link that does not resolve inside the skills folder', () => {
    const body =
      '[ok](references/a.md#top), [web](https://x.test), [anchor](#x), [gone](references/b.md), [out](../../docs/x.md)\n';
    const dir = fixture(skill([], body), { 'references/a.md': '# A\n' });
    expect(lintSkills(dir)).toEqual([
      'demo/SKILL.md: link references/b.md does not resolve inside the skills folder',
      'demo/SKILL.md: link ../../docs/x.md does not resolve inside the skills folder',
    ]);
  });
});
