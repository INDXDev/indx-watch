/**
 * `iw import testrail <cases.csv>` and `iw import testomatio <dir|file.md>` (docs/spec/cli.md#iw-import-testrail-casescsv):
 * draft use cases, criteria and test cases (`origin = "import"`) from another tool's export.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import * as iwb from '@indx-watch/bundle';
import * as cx from '../context.js';
import { type Args, type Ctx, fail, many, str } from '../util.js';
import { knownKeys, originOf } from './specs.js';

type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export interface ImportCase {
  /** the id in the source tool (`C123`, `@T12345678`), so a second import skips what it already made */
  id: string;
  title: string;
  steps: { instruction: string; expected: string }[];
  priority?: Priority;
  preconditions?: string;
  tags?: string[];
}
/** One use case: a TestRail section or a testomat.io suite. */
export interface ImportGroup {
  title: string;
  cases: ImportCase[];
}
type Source = 'testrail' | 'testomatio';
const NO_EXPECTED = 'Describe the expected result.';
const RANK: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const TESTRAIL_PRIORITY: Record<string, Priority> = { critical: 'P0', high: 'P1', medium: 'P2', low: 'P3' };
const TESTOMATIO_PRIORITY: Record<string, Priority> = {
  ...{ critical: 'P0', high: 'P1', important: 'P1' },
  ...{ normal: 'P2', low: 'P3' },
};

/** CSV text → rows of cells (RFC 4180: quoted cells may hold commas, quotes and line breaks; BOM ignored). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let [row, cell, quoted] = [[] as string[], '', false];
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c !== '"') cell += c;
      else if (src[i + 1] === '"') [cell, i] = [`${cell}"`, i + 1];
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') [row, cell] = [[...row, cell], ''];
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      rows.push([...row, cell]);
      [row, cell] = [[], ''];
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** The first column whose header (lower case, trimmed) is one of `names`. */
const column = (head: string[], ...names: string[]) => head.findIndex((h) => names.includes(h));

/**
 * Cases of a TestRail CSV export, grouped by section (the last part of `Section Hierarchy`, else `Section`).
 * A case with `Steps` and `Expected Result` columns has one step; with separated steps (`Steps (Step)`,
 * `Steps (Expected Result)`) the rows after the case row with an empty title add steps to it.
 */
export function parseTestrail(text: string, warn: (message: string) => void): ImportGroup[] {
  const [header, ...rows] = parseCsv(text);
  const head = (header ?? []).map((h) => h.trim().toLowerCase());
  const at = {
    id: column(head, 'id', 'case id'),
    title: column(head, 'title'),
    section: column(head, 'section hierarchy', 'section'),
    priority: column(head, 'priority'),
    pre: column(head, 'preconditions'),
    step: column(head, 'steps (step)', 'steps (separated)', 'steps'),
    expected: column(head, 'steps (expected result)', 'expected result'),
  };
  if (at.title < 0) fail('INVALID_INPUT', 'No Title column: is this a TestRail case export?');
  const cell = (r: string[], i: number) => (i < 0 ? '' : (r[i] ?? '').trim());
  const groups = new Map<string, ImportGroup>();
  let cur: ImportCase | undefined;
  for (const r of rows) {
    const [title, step, expected] = [cell(r, at.title), cell(r, at.step), cell(r, at.expected)];
    if (title) {
      const path = cell(r, at.section);
      const section = path.split(/\s*>\s*/).pop() || 'Imported from TestRail';
      cur = { id: cell(r, at.id) || `${path} > ${title}`, title, steps: [] };
      const priority = TESTRAIL_PRIORITY[cell(r, at.priority).toLowerCase()];
      if (priority) cur.priority = priority;
      if (cell(r, at.pre)) cur.preconditions = cell(r, at.pre);
      groups.set(path, groups.get(path) ?? { title: section, cases: [] });
      groups.get(path)!.cases.push(cur);
    }
    if (cur && (step || expected))
      cur.steps.push({ instruction: step || '-', expected: expected || NO_EXPECTED });
  }
  for (const g of groups.values())
    for (const c of g.cases.filter((c) => c.steps.some((s) => s.expected === NO_EXPECTED)))
      warn(`${c.title}: a step has no expected result; it is a placeholder to write`);
  return [...groups.values()];
}

/** `<!-- suite … -->` or `<!-- test … -->`: its kind and its `key: value` lines. */
function metaOf(block: string) {
  const lines = block.replace(/^<!--\s*|\s*-->$/g, '').split('\n');
  const kind = /^\s*(suite|test)\b/i.exec(lines[0]!)?.[1]?.toLowerCase();
  const meta: Record<string, string> = {};
  for (const l of [lines[0]!.replace(/^\s*(suite|test)\b/i, ''), ...lines.slice(1)]) {
    const m = /^\s*([a-z_]+):\s*(.*?)\s*$/i.exec(l);
    if (m) meta[m[1]!.toLowerCase()] = m[2]!;
  }
  return kind ? { kind, meta } : undefined;
}

const tagOf = (t: string) =>
  t
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Where a Markdown parser is: the last suite and test seen, and the steps list being read. */
interface MdState {
  groups: ImportGroup[];
  /** the `<!-- suite|test -->` block waiting for its heading */
  pending?: { kind: string; meta: Record<string, string> } | undefined;
  test?: ImportCase | undefined;
  inSteps: boolean;
  step?: { instruction: string; expected: string[] } | undefined;
}

/** Close the step being read into the current test. */
function endStep(s: MdState) {
  if (s.test && s.step)
    s.test.steps.push({
      instruction: s.step.instruction,
      expected: s.step.expected.join('\n') || NO_EXPECTED,
    });
  s.step = undefined;
}

/** A heading: it names the suite or test its comment block announced (a leading `#` with no block is the suite). */
function heading(s: MdState, title: string) {
  endStep(s);
  const { kind, meta } = s.pending ?? { kind: s.groups.length ? '' : 'suite', meta: {} };
  if (kind === 'suite') s.groups.push({ title, cases: [] });
  if (kind === 'test' && s.groups.length) {
    const test: ImportCase = { id: meta.id || `${s.groups.at(-1)!.title} > ${title}`, title, steps: [] };
    const priority = TESTOMATIO_PRIORITY[(meta.priority ?? '').toLowerCase()];
    const tags = (meta.tags ?? '').split(',').map(tagOf).filter(Boolean);
    s.groups.at(-1)!.cases.push({ ...test, ...(priority && { priority }), ...(tags.length && { tags }) });
    s.test = s.groups.at(-1)!.cases.at(-1);
  }
  [s.pending, s.inSteps] = [undefined, false];
}

/** One line of a steps list: a top-level item starts a step, an indented `*Expected*: …` item answers it. */
function stepLine(s: MdState, line: string) {
  const item = /^(\s*)((?:[*+-]|\d+\.)\s+)?(.*\S)\s*$/.exec(line);
  if (!item) return;
  const expected = /^(?:[*_]{1,2}expected[*_]{1,2}:?|expected:)\s*(.*)$/i.exec(item[3]!);
  if (expected && s.step) s.step.expected.push(expected[1]!);
  else if (!expected && !item[1] && item[2]) {
    endStep(s);
    s.step = { instruction: item[3]!, expected: [] };
  }
}

/**
 * Suites and tests of one testomat.io classical Markdown file: `<!-- suite … -->` + `# Suite`, then per test
 * `<!-- test … -->` + `# Test` and a `## Steps` list whose items are actions with a nested `*Expected*:` line.
 */
export function parseTestomatio(md: string, warn: (message: string) => void): ImportGroup[] {
  const s: MdState = { groups: [], inSteps: false };
  // odd parts are the HTML comments (the suite, test and example blocks), even parts the text between them
  for (const [i, part] of md.split(/(<!--[\s\S]*?-->)/).entries()) {
    if (i % 2) {
      const block = metaOf(part);
      if (block || /^<!--\s*example/i.test(part)) endStep(s);
      if (block) [s.pending, s.inSteps] = [block, false];
      if (!block) s.inSteps = false;
      continue;
    }
    for (const line of part.split(/\r?\n/)) {
      const head = /^#{1,2}\s+(.+?)\s*$/.exec(line);
      if (/^#{2,3}\s+steps\s*$/i.test(line)) s.inSteps = true;
      else if (head) heading(s, head[1]!);
      else if (s.inSteps) stepLine(s, line);
    }
  }
  endStep(s);
  for (const g of s.groups)
    for (const c of g.cases.filter((c) => c.steps.some((x) => x.expected === NO_EXPECTED)))
      warn(`${c.title}: a step has no expected result; it is a placeholder to write`);
  return s.groups;
}

/** The Markdown files of a path: the file itself, or every `.md` file below a folder. */
async function mdFiles(path: string): Promise<string[]> {
  const s = await stat(path).catch(() => fail('NOT_FOUND', `${path} not found`));
  if (!s.isDirectory()) return [path];
  const all = await readdir(path, { recursive: true });
  return all
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => join(path, f));
}

/** Create a draft use case per group, with a draft criterion and a draft test case per case; known cases are skipped. */
async function createGroups(ctx: Ctx, a: Args, source: Source, groups: ImportGroup[]) {
  const p = await cx.openProject(ctx, a);
  const agent = (await cx.actorOf(ctx)).kind === 'agent';
  const { origin, model } = await originOf(ctx, { ...a, origin: agent ? undefined : 'import' });
  const ai = model ? { model, skill: str(a.skill) ?? `import-${source}` } : undefined;
  const known = new Set(
    p.bundle.testCases.map((t) => (t.data.x?.import as { source?: string; id?: string } | undefined)?.id),
  );
  const keys = [...knownKeys(await p.replica.records())];
  const created: iwb.CreateResult[] = [];
  let skipped = 0;
  for (const g of groups) {
    const cases = g.cases.filter((c) => !known.has(c.id));
    skipped += g.cases.length - cases.length;
    if (!cases.length) continue;
    const priority = cases.flatMap((c) => c.priority ?? []).sort((x, y) => RANK[x] - RANK[y])[0] ?? 'P1';
    const criteria = cases.map((c) => ({ text: c.title, ...(origin === 'import' && { status: 'draft' }) }));
    const notes = `Imported from ${source === 'testrail' ? 'TestRail' : 'testomat.io'}: ${g.title}`;
    const base = { kind: 'use-case', origin, ai, knownKeys: keys } as const;
    const uc = await iwb.createDefinition(p.fs, p.bundle, {
      ...base,
      fields: { title: g.title, goal: g.title, priority, criteria, notes },
      ...(str(a.feature) && { parent: str(a.feature)! }),
    });
    keys.push(uc.key, ...cases.map((_, i) => `AC-${uc.key.slice(3)}.${i + 1}`));
    created.push(uc);
    const bundle = (await iwb.loadBundle(p.fs)).bundle!;
    for (const [i, c] of cases.entries()) {
      const fields: Record<string, unknown> = {
        ...{ title: c.title, steps: c.steps, covers: [`AC-${uc.key.slice(3)}.${i + 1}`], mode: 'manual' },
        ...{ preconditions: c.preconditions, tags: c.tags },
        x: { import: { source, id: c.id } },
      };
      const tc = await iwb.createDefinition(p.fs, bundle, {
        ...{ kind: 'test-case', fields, parent: uc.key, origin, ai },
        knownKeys: [...keys, ...created.map((x) => x.key)],
      });
      created.push(tc);
      keys.push(tc.key);
    }
  }
  return { created, skipped };
}

/** `iw import testrail <cases.csv>` and `iw import testomatio <dir|file.md>`. */
export async function importCases(ctx: Ctx, a: Args, source: Source) {
  const [, path] = many(a._);
  const what = source === 'testrail' ? '<cases.csv>' : '<dir|file.md>';
  if (!path) fail('USAGE', `Usage: iw import ${source} ${what} [--feature FEAT-n]`);
  if (a['dry-run'] || a.merge || a.uc) fail('USAGE', '--dry-run, --merge and --uc apply to other imports');
  const target = resolve(ctx.cwd, path!);
  const warnings: iwb.Problem[] = [];
  const warn = (file: string) => (message: string) =>
    warnings.push({ severity: 'warning', code: 'import-no-expected', file, message });
  const files = source === 'testrail' ? [target] : await mdFiles(target);
  const groups: ImportGroup[] = [];
  for (const f of files) {
    const text = await readFile(f, 'utf8').catch(() => fail('NOT_FOUND', `${path} not found`));
    const rel = relative(ctx.cwd, f).replaceAll('\\', '/');
    groups.push(
      ...(source === 'testrail' ? parseTestrail(text, warn(rel)) : parseTestomatio(text, warn(rel))),
    );
  }
  // a case without a step has nothing to run: left out, with a warning
  for (const g of groups)
    g.cases = g.cases.filter((c) => {
      if (c.steps.length) return true;
      const message = `Skipped "${c.title}": it has no steps`;
      warnings.push({ severity: 'warning', code: 'import-no-steps', file: path!, message });
      return false;
    });
  if (!groups.some((g) => g.cases.length))
    fail('INVALID_INPUT', `No test case with steps in ${path}`, warnings);
  const { created, skipped } = await createGroups(ctx, a, source, groups);
  const data = {
    source,
    files: files.map((f) => relative(ctx.cwd, f).replaceAll('\\', '/')),
    created,
    skipped,
  };
  const text = `${created.map((r) => `Created ${r.key} (draft) in ${r.file}`).join('\n')}${skipped ? `\nSkipped ${skipped} already imported` : ''}`;
  return { data, warnings, text: text || `Nothing new: ${skipped} already imported` };
}
