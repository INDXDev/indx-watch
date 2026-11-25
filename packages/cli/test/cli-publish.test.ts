/**
 * Publishing definitions from git working copies: iw deploy --definitions-only merges with the newest
 * snapshot, refuses a real conflict, and iw pull brings hosted changes back (docs/spec/sync.md#data-flow-and-conflicts).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { iw, iwJson, shop } from './helpers.js';

const git = (cwd: string, ...args: string[]) =>
  String(
    execFileSync('git', ['-c', 'user.name=QA', '-c', 'user.email=qa@shop.test', ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  ).trim();

/** A bare origin, a shared folder store and two clones of examples/shop (A and B). */
function team() {
  const seed = shop();
  const root = mkdtempSync(join(tmpdir(), 'iw-team-'));
  const store = join(root, 'store');
  cpSync(join(seed, 'store'), store, { recursive: true });
  const project = join(seed, '.indx-watch/project.toml');
  writeFileSync(project, readFileSync(project, 'utf8').replace('file://../store', `file://${store}`));
  writeFileSync(join(seed, '.gitignore'), 'store/\n.indx-watch/runs/\n.indx-watch/cache/\n');
  git(seed, 'init', '-q', '-b', 'main');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'seed');
  git(root, 'init', '-q', '--bare', 'origin.git');
  git(seed, 'push', '-q', join(root, 'origin.git'), 'main');
  const clone = (name: string) => {
    git(root, 'clone', '-q', join(root, 'origin.git'), name);
    return join(root, name);
  };
  return { a: clone('a'), b: clone('b') };
}

/** The first test case file of the shop, and a second one in another use case. */
function caseFiles(dir: string): [string, string] {
  const found: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(join(dir, d), { withFileTypes: true }))
      if (e.isDirectory()) walk(join(d, e.name));
      else if (/^TC-\d+-.*\.toml$/.test(e.name)) found.push(join(d, e.name));
  };
  walk('.indx-watch/specs');
  found.sort();
  return [found[0]!, found.at(-1)!];
}

/** Change a test case title in place and commit it. */
function retitle(dir: string, file: string, title: string, push: string) {
  const path = join(dir, file);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/^title = ".*"$/m, `title = "${title}"`));
  git(dir, 'commit', '-q', '-am', title);
  git(dir, 'push', '-q', 'origin', `HEAD:${push}`);
}

describe('commands: deploy --definitions-only and pull', () => {
  it('merges changes to different files, stops on the same file, and pull writes a conflict file', () => {
    const { a, b } = team();
    const [x, y] = caseFiles(a);
    const first = iwJson(a, 'deploy', ['deploy', '--definitions-only']);
    expect(first.json.data).toMatchObject({ worker: false, published: { merged: [], unsynced: [] } });

    // B changes X on main and publishes: A's snapshot is in B's history, so it is a plain update
    retitle(b, x, 'Changed by B', 'main');
    const byB = iwJson(b, 'deploy', ['deploy', '--definitions-only']);
    expect(byB.json.data.published).toMatchObject({ unchanged: false, merged: [] });

    // A, still on the seed commit, changes Y on a branch: B's change to X is kept, and marked as not in A's commit
    retitle(a, y, 'Changed by A', 'a-branch');
    const byA = iwJson(a, 'deploy', ['deploy', '--definitions-only']);
    const xPath = x.replace('.indx-watch/', '');
    expect(byA.json.data.published).toMatchObject({ merged: [xPath], unsynced: [xPath] });

    // B changes Y too: both sides changed it, so B's deploy stops and nothing is published
    retitle(b, y, 'Also changed by B', 'main');
    const refused = iwJson(b, 'deploy', ['deploy', '--definitions-only']);
    expect([refused.code, refused.json.error.code]).toEqual([1, 'CONFLICT']);
    expect(refused.json.error.message).toContain(y.replace('.indx-watch/', ''));

    // iw pull in B keeps B's file and writes the hosted one beside it; iw check fails until it is resolved
    const pulled = iwJson(b, 'pull', ['pull']);
    expect(pulled.json.error.code).toBe('CONFLICT');
    const conflict = pulled.json.data.conflicts[0] as string;
    expect(conflict).toMatch(/\.conflict-[0-9a-f]{8}\.toml$/);
    expect(readFileSync(join(b, '.indx-watch', conflict), 'utf8')).toContain('Changed by A');
    expect(iw(b, ['check']).code).toBe(1);
  });

  it('refuses to publish uncommitted or unpushed changes', () => {
    const { a } = team();
    const [x] = caseFiles(a);
    writeFileSync(join(a, x), readFileSync(join(a, x), 'utf8').replace(/^title = ".*"$/m, 'title = "Dirty"'));
    const dirty = iwJson(a, 'deploy', ['deploy', '--definitions-only']);
    expect(dirty.json.error).toMatchObject({ code: 'CONFLICT' });
    expect(dirty.json.error.message).toContain('git commit');
    git(a, 'commit', '-q', '-am', 'local only');
    const unpushed = iwJson(a, 'deploy', ['deploy', '--definitions-only']);
    expect(unpushed.json.error.message).toContain('git push');
    expect(existsSync(join(a, '.indx-watch'))).toBe(true);
  });
});
