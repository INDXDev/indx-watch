/** The skill lint (docs/spec/agents.md#lint) that skills-lint.test.ts runs: frontmatter, length, commands, example keys and links of skills/. */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { PORTABLE, ROOT } from './helpers.js';

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

/** The lines between the opening and closing `---`. */
function frontmatterLines(text: string): string[] {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) throw new Error('no frontmatter between --- lines');
  return m[1]!.split(/\r?\n/);
}

/** The indented or blank lines that follow a key, starting at `start`. */
function takeBlock(lines: string[], start: number): string[] {
  const block: string[] = [];
  for (let i = start; i < lines.length && (/^\s+\S/.test(lines[i]!) || !lines[i]!.trim()); i++)
    block.push(lines[i]!);
  return block;
}

function withoutTrailingBlanks(block: string[]): string[] {
  const out = [...block];
  while (out.length && !out.at(-1)!.trim()) out.pop();
  return out;
}

/** An indented `k: v` block under `key`. */
function blockMap(key: string, block: string[]): Record<string, string> {
  if (!block.length) throw new Error(`${key}: no value`);
  return Object.fromEntries(
    block.map((l) => {
      const e = /^\s+([\w-]+):\s+(.+)$/.exec(l);
      if (!e) throw new Error(`${key}: "${l.trim()}" is not "key: value"`);
      return [e[1]!, scalar(e[2]!)];
    }),
  );
}

/** The value of `key`: `value` is what follows `key:` on its line, `block` the indented lines after it. */
function parseValue(key: string, value: string, block: string[]): Value {
  if (/^[>|][+-]?$/.test(value)) {
    if (!block.length) throw new Error(`${key}: empty block scalar`);
    const parts = block.map((l) => l.trim());
    return value.startsWith('>') ? parts.join(' ').replace(/\s+/g, ' ') : parts.join('\n');
  }
  if (!value) return blockMap(key, block);
  if (value.startsWith('{')) {
    if (block.length) throw new Error(`${key}: flow map on one line only`);
    return flowMap(value);
  }
  if (/^["']/.test(value) && block.length) throw new Error(`${key}: quoted string on one line only`);
  return scalar([value, ...block.map((l) => l.trim())].join(' '));
}

/** The YAML subset skill frontmatter uses: top-level keys with scalars, block scalars or string maps. */
export function parseFrontmatter(text: string): Record<string, Value> {
  const lines = frontmatterLines(text);
  const out: Record<string, Value> = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim() || /^#/.test(line)) continue;
    const kv = /^([A-Za-z][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (!kv) throw new Error(`line ${i + 2} is not "key: value": ${line}`);
    const [, key, rest = ''] = kv as unknown as [string, string, string | undefined];
    if (key in out) throw new Error(`duplicate key ${key}`);
    const block = takeBlock(lines, i + 1);
    i += block.length;
    out[key] = parseValue(key, rest.trim(), withoutTrailingBlanks(block));
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

/** Every `key = "…"` in the TOML files under `dir`. */
function tomlKeys(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith('.toml'))
    .flatMap((f) =>
      [...readFileSync(join(f.parentPath, f.name), 'utf8').matchAll(/^\s*key = "([^"]+)"/gm)].map(
        (m) => m[1]!,
      ),
    );
}

/** The highest number of each key kind: `TC-` → 10, `AC-5.` → 1. */
function maxNumbers(keys: Set<string>): Map<string, number> {
  const max = new Map<string, number>();
  for (const k of keys) {
    const [, kind, n] = /^([A-Z]+-(?:\d+\.)?)(\d+)$/.exec(k) ?? [];
    if (kind) max.set(kind, Math.max(max.get(kind) ?? 0, Number(n)));
  }
  return max;
}

/** Keys in examples/shop, plus the next free key of each kind (what a worked example creates). */
function shopKeys(): Set<string> {
  const keys = new Set(tomlKeys(join(ROOT, 'examples/shop/.indx-watch')));
  const max = maxNumbers(keys);
  for (const [kind, n] of max) keys.add(`${kind}${n + 1}`);
  for (const k of keys)
    if (/^UC-\d+$/.test(k) && !max.has(`AC-${k.slice(3)}.`)) keys.add(`AC-${k.slice(3)}.1`);
  return keys;
}

const COMMANDS = cliCommands();
const KEYS = shopKeys();
const MENTION =
  /(?:^|[\s(;&|$])(?:iw|npx\s+(?:(?:-y|--yes)\s+)?indx-watch(?:@\S+)?)\s+([a-z][\w-]*)(?:\s+([a-z][\w-]*))?/g;
const FENCE = /^\s*(```|~~~)/;

/** The problem with `iw <w1> [w2]`, if it is not a command of cli.md. */
function unknownCommand(w1: string, w2: string | undefined): string[] {
  const subs = [...COMMANDS].filter((k) => k.startsWith(`${w1} `));
  if (COMMANDS.has(w1) || (w2 && subs.includes(`${w1} ${w2}`))) return [];
  return [`unknown command "iw ${subs.length ? `${w1} ${w2 ?? ''}`.trim() : w1}" (not in docs/spec/cli.md)`];
}

function mentionProblems(code: string): string[] {
  return [...code.matchAll(MENTION)].flatMap(([, w1, w2]) => unknownCommand(w1!, w2));
}

/** `iw <command>` mentions in code (fenced blocks and inline spans), skipping lines marked planned. */
function commandProblems(text: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (/\bplanned\b/i.test(line)) continue;
    const code = fenced ? [line] : [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
    out.push(...code.flatMap(mentionProblems));
  }
  return out;
}

function keyProblems(fm: Record<string, Value>, allowed: string[]): string[] {
  return [
    ...Object.keys(fm)
      .filter((k) => !allowed.includes(k))
      .map((k) => `frontmatter key "${k}" is not allowed`),
    ...Object.entries(fm)
      .filter(([k, v]) => (k === 'metadata') !== (typeof v === 'object'))
      .map(([k]) => `"${k}" has the wrong type`),
  ];
}

function nameProblems(name: string | undefined, folder: string): string[] {
  const out: string[] = [];
  if (name !== folder) out.push(`name "${name}" differs from the folder name`);
  if (typeof name !== 'string') return out;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64)
    out.push(`name "${name}" must be lowercase words joined by single hyphens, at most 64 characters`);
  if (/claude|anthropic/.test(name)) out.push(`name "${name}" contains a reserved word`);
  return out;
}

function descriptionProblems(description: string | undefined): string[] {
  if (typeof description !== 'string' || !description.trim() || description.length > 1024)
    return [`description must have 1–1024 characters (has ${description?.length ?? 0})`];
  return XML.test(description) ? ['description contains an XML tag'] : [];
}

/** Problems of the SKILL.md frontmatter of skill `folder`. */
function frontmatterProblems(text: string, folder: string, allowed: string[]): string[] {
  let fm: Record<string, Value>;
  try {
    fm = parseFrontmatter(text);
  } catch (e) {
    return [`frontmatter does not parse: ${(e as Error).message}`];
  }
  const { name, description, compatibility } = fm as Record<string, string | undefined>;
  const out = [
    ...keyProblems(fm, allowed),
    ...nameProblems(name, folder),
    ...descriptionProblems(description),
  ];
  if (typeof compatibility === 'string' && compatibility.length > 500)
    out.push(`compatibility has ${compatibility.length} characters (max 500)`);
  return out;
}

function lengthProblems(text: string): string[] {
  const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  return lines > 500 ? [`${lines} lines (max 500)`] : [];
}

function exampleKeyProblems(md: string): string[] {
  return [...md.matchAll(/\b(?:(?:UC|TC|FX|FEAT|PLAN)-\d+|AC-\d+\.\d+)\b/g)]
    .map(([k]) => k)
    .filter((k) => !KEYS.has(k))
    .map((k) => `${k} is not in examples/shop`);
}

/** Relative links outside code blocks of `file` that do not resolve inside the skills folder `dir`. */
function linkProblems(md: string, file: string, dir: string): string[] {
  const prose = md.replace(/^\s*(```|~~~)[\s\S]*?^\s*\1/gm, '');
  return [...prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
    .map(([, href]) => href!)
    .filter((href) => !/^([a-z][\w+.-]*:|#)/i.test(href))
    .filter((href) => {
      const target = resolve(dirname(file), decodeURI(href.split('#')[0]!));
      return !existsSync(target) || relative(dir, target).startsWith('..');
    })
    .map((href) => `link ${href} does not resolve inside the skills folder`);
}

/** Problems of one Markdown file `rel` of a skill whose SKILL.md is `skillText`. */
function markdownProblems(dir: string, file: string, rel: string, skillText: string): string[] {
  const md = readFileSync(file, 'utf8');
  const unlinked =
    rel.startsWith('references/') && ![')', '#'].some((end) => skillText.includes(`](${rel}${end}`));
  return [
    ...(unlinked ? ['is not linked from SKILL.md, so an agent never loads it'] : []),
    ...commandProblems(md),
    ...exampleKeyProblems(md),
    ...linkProblems(md, file, dir),
  ];
}

/** Lint the skill folder `folder` under `dir`; returns problems as "<skill>/<file>: message". */
function lintSkill(dir: string, folder: string, allowed: string[]): string[] {
  const skill = join(dir, folder);
  const at = (file: string) => (msg: string) => `${folder}/${file}: ${msg}`;
  if (!existsSync(join(skill, 'SKILL.md'))) return [at('SKILL.md')('missing')];
  const text = readFileSync(join(skill, 'SKILL.md'), 'utf8');
  const files = readdirSync(skill, { recursive: true, withFileTypes: true }).filter(
    (f) => f.isFile() && f.name.endsWith('.md'),
  );
  return [
    ...[...frontmatterProblems(text, folder, allowed), ...lengthProblems(text)].map(at('SKILL.md')),
    ...files.flatMap((f) => {
      const file = join(f.parentPath, f.name);
      const rel = relative(skill, file).split(sep).join('/');
      return markdownProblems(dir, file, rel, text).map(at(rel));
    }),
  ];
}

/** Lint every skill folder under `dir`; returns problems as "<skill>/<file>: message". */
export function lintSkills(dir: string, allowed = SOURCE): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => lintSkill(dir, d.name, allowed));
}
