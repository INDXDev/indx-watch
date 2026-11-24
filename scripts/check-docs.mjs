#!/usr/bin/env node
// Checks relative links, links to this repository on GitHub (…/blob|tree/main/<path>) and
// #anchors in every Markdown file of the repository. Zero dependencies.
// Usage: node scripts/check-docs.mjs [--json]   Exit 1 when a link target or anchor is missing.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
  '.wrangler',
  '.next',
]);
/** Files whose links are placeholders by design. */
const IGNORE = new Set(['docs/adr/0000-template.md']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || (entry.name === 'worktrees' && dir.endsWith('.claude'))) continue;
    // build-time copies (packages/cli/.gitignore)
    if (/[/\\]packages[/\\]cli$/.test(dir) && ['skills', 'schemas'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name.endsWith('.md')) out.push(path);
  }
  return out;
}

/** Markdown with fenced code blocks blanked out (line numbers kept). */
function stripFences(text) {
  let fence = null;
  return text.split('\n').map((line) => {
    const m = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (m && (!fence || (m[1][0] === fence[0] && m[1].length >= fence.length))) {
      fence = fence ? null : m[1];
      return '';
    }
    return fence ? '' : line;
  });
}

/** GitHub's heading slug (github-slugger), with explicit `{#id}` anchors. */
function slug(heading) {
  const text = heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 ? part : part.replace(/<[^>]+>/g, '')))
    .join('');
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');
}

const anchorCache = new Map();
function anchors(file) {
  if (anchorCache.has(file)) return anchorCache.get(file);
  const ids = new Set();
  const seen = new Map();
  for (const line of stripFences(readFileSync(file, 'utf8'))) {
    for (const m of line.matchAll(/<a\s[^>]*(?:id|name)="([^"]+)"/g)) ids.add(m[1]);
    const h = line.match(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/);
    if (!h) continue;
    const explicit = h[1].match(/\s*\{#([^}]+)\}$/);
    if (explicit) {
      ids.add(explicit[1]);
      continue;
    }
    const base = slug(h[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    ids.add(n ? `${base}-${n}` : base);
  }
  anchorCache.set(file, ids);
  return ids;
}

const LINK =
  /!?\[(?:[^\]\\]|\\.)*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|^\s{0,3}\[[^\]]+\]:\s+<?(\S+?)>?(?:\s|$)/g;
const GITHUB = /^https:\/\/github\.com\/INDXDev\/indx-watch\/(blob|tree)\/main\/([^?\s]+)$/;
/** Pages published on the docs site (docs/docs.json), where relative links need ./ or ../. */
const SITE = /^docs[/\\](?!design[/\\])/;
/** Targets under docs/ that the docs site does not serve (README files, docs/.mintignore). */
const OFF_SITE = /[/\\](README\.md|design[/\\].*\.(html|css)|0000-template\.md)$/;

/** Rules for links on pages of the docs site; undefined when they hold. */
function siteProblem(file, target, dest) {
  // Mintlify serves `page.md` as raw Markdown; it rewrites only ./ and ../ links.
  if (/^[^./#]/.test(target)) return 'start the link with ./ (docs site)';
  const offSite = !relative(join(root, 'docs'), dest).match(/^[^.]/) || OFF_SITE.test(dest);
  if (!file.endsWith('README.md') && offSite) return 'not on the docs site: use the GitHub URL';
}

/** What is wrong with the link `target` in `file`, or undefined when it resolves (or is external). */
function problemOf(file, target) {
  // Links to this repository on GitHub (used where a page is also published outside the
  // repository, e.g. docs/ on Mintlify) are checked against the working tree.
  const gh = target.match(GITHUB);
  if (!gh && (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//'))) return undefined;
  const [pathPart, hash] = (gh ? gh[2] : target).split('#');
  const path = decodeURIComponent(pathPart);
  const dest = gh ? resolve(root, path) : path ? resolve(dirname(file), path) : file;
  const site = gh || !SITE.test(relative(root, file)) ? undefined : siteProblem(file, target, dest);
  return site ?? destProblem(dest, gh, hash);
}

/** What is wrong with the link destination: a missing file, /blob/ vs /tree/ or a missing anchor. */
function destProblem(dest, gh, hash) {
  if (!existsSync(dest)) return 'missing file';
  if (gh && (gh[1] === 'tree') !== statSync(dest).isDirectory())
    return `use /${gh[1] === 'tree' ? 'blob' : 'tree'}/ for this path`;
  if (hash && dest.endsWith('.md') && statSync(dest).isFile() && !anchors(dest).has(decodeURIComponent(hash)))
    return 'missing anchor';
}

const problems = [];
for (const file of walk(root).filter((f) => !IGNORE.has(relative(root, f).split('\\').join('/')))) {
  stripFences(readFileSync(file, 'utf8')).forEach((raw, i) => {
    for (const m of raw.replace(/`[^`]*`/g, '').matchAll(LINK)) {
      const target = m[1] ?? m[2];
      const problem = problemOf(file, target);
      if (problem) problems.push({ where: `${relative(root, file)}:${i + 1}`, target, problem });
    }
  });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ok: problems.length === 0, problems }, null, 2));
} else if (problems.length) {
  for (const p of problems) console.error(`${p.where}  ${p.problem}: ${p.target}`);
  console.error(`\n${problems.length} broken link(s)`);
} else {
  console.log('All Markdown links resolve.');
}
process.exit(problems.length ? 1 : 0);
