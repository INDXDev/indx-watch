/** `iw patch` (T-508) against a local git repository standing in for upstream, with a fake pnpm. */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { patchedDist } from '../src/patch.js';
import { fakeBin, iw, iwJson, shop } from './helpers.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.test', ...args], { cwd, encoding: 'utf8' });
const write = (root: string, path: string, text: string) => {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), text);
};

let upstream: string;
beforeAll(() => {
  upstream = mkdtempSync(join(tmpdir(), 'iw-upstream-'));
  git(upstream, 'init', '-q', '-b', 'main');
  write(upstream, 'packages/web/src/nav.txt', 'one\ntwo\nthree\n');
  write(upstream, 'packages/core/src/status.ts', 'export const x = 1;\n');
  write(upstream, 'README.md', 'readme\n');
  git(upstream, 'add', '-A');
  git(upstream, 'commit', '-qm', 'v0.1.2');
  git(upstream, 'tag', 'v0.1.2');
  write(upstream, 'README.md', 'readme 2\n'); // 0.3.0: unrelated change
  git(upstream, 'commit', '-qam', 'readme');
  git(upstream, 'tag', 'v0.3.0');
  git(upstream, 'checkout', '-q', 'v0.1.2');
  write(upstream, 'packages/web/src/nav.txt', 'one\nTWO\nthree\n'); // 0.2.0: the same line
  git(upstream, 'commit', '-qam', 'nav');
  git(upstream, 'tag', 'v0.2.0');
});

/** A project pinned to 0.1.2 whose source is the local repository. */
function project() {
  const dir = shop();
  appendFileSync(join(dir, '.indx-watch/project.toml'), '\n[tool]\nindx_watch = "0.1.2"\n');
  return { dir, env: { IW_PATCH_REPO: upstream } };
}
const ws = (dir: string, path: string) => join(dir, '.indx-watch/cache/upstream', path);

/** create a patch that changes line two of nav.txt */
function makePatch(p: ReturnType<typeof project>, name = 'shorter-nav') {
  const first = iwJson(p.dir, 'patch create', ['patch', 'create', name], { env: p.env });
  expect(first.json.data.patches).toEqual([]);
  writeFileSync(ws(p.dir, 'packages/web/src/nav.txt'), 'one\n2\nthree\n');
  return iwJson(p.dir, 'patch create', ['patch', 'create', name], { env: p.env });
}

describe('iw patch create', () => {
  it('prepares the source, then turns the edits into a numbered patch and patches.toml', () => {
    const p = project();
    const r = makePatch(p);
    expect(r.code).toBe(0);
    expect(r.json.data.patches[0]).toMatchObject({
      file: 'patches/0001-shorter-nav.patch',
      files: ['packages/web/src/nav.txt'],
    });
    const patch = readFileSync(join(p.dir, '.indx-watch/patches/0001-shorter-nav.patch'), 'utf8');
    expect(patch).toContain('-two\n+2');
    expect(readFileSync(join(p.dir, '.indx-watch/patches/patches.toml'), 'utf8')).toBe('base = "0.1.2"\n');
    // the next patch contains only what changed since
    expect(
      iwJson(p.dir, 'patch create', ['patch', 'create', 'second'], { env: p.env }).json.data.patches,
    ).toEqual([]);
  });

  it('refuses a change to verdict, gate and status code, without any override', () => {
    const p = project();
    iwJson(p.dir, 'patch create', ['patch', 'create', 'x'], { env: p.env });
    writeFileSync(ws(p.dir, 'packages/core/src/status.ts'), 'export const x = 2;\n');
    const r = iwJson(p.dir, 'patch create', ['patch', 'create', 'x'], { env: p.env });
    expect(r.code).toBe(2);
    expect(r.json.error.message).toContain('packages/core/src/status.ts');
    expect(existsSync(join(p.dir, '.indx-watch/patches'))).toBe(false);
  });

  it('needs a pinned version and a valid name', () => {
    const dir = shop();
    expect(iwJson(dir, 'patch create', ['patch', 'create', 'x']).json.error.code).toBe('INVALID_CONFIG');
    expect(iw(project().dir, ['patch', 'create', 'Bad Name']).code).toBe(2);
  });
});

describe('iw patch check', () => {
  it('passes for the base and a newer version, and exits 1 naming the conflicting files', () => {
    const p = project();
    makePatch(p);
    const base = iwJson(p.dir, 'patch check', ['patch', 'check'], { env: p.env });
    expect(base.json.data).toMatchObject({ to: '0.1.2', conflicts: [], patches: [{ applies: true }] });
    expect(iwJson(p.dir, 'patch check', ['patch', 'check', '--to', '0.3.0'], { env: p.env }).code).toBe(0);
    const bad = iwJson(p.dir, 'patch check', ['patch', 'check', '--to', '0.2.0'], { env: p.env });
    expect(bad.code).toBe(1);
    expect(bad.json.error.code).toBe('CONFLICT');
    expect(bad.json.data.conflicts).toEqual(['packages/web/src/nav.txt']);
    expect(iwJson(p.dir, 'patch check', ['patch', 'check', '--to', '9.9.9'], { env: p.env }).code).toBe(2);
  });
});

describe('iw patch apply', () => {
  const pnpm = fakeBin({
    pnpm: `[ "$3" = build ] || exit 0
mkdir -p "$2/packages/cli/dist/web"
echo 'export default {};' > "$2/packages/cli/dist/worker.js"
echo '<html></html>' > "$2/packages/cli/dist/web/index.html"`,
  });

  it('builds cache/patched/dist with the patch-set hash, which iw deploy then accepts until a patch changes', async () => {
    const p = project();
    makePatch(p);
    const env = { ...p.env, PATH: `${pnpm}:${process.env.PATH}` };
    const r = iwJson(p.dir, 'patch apply', ['patch', 'apply'], { env });
    expect(r.code, r.stderr).toBe(0);
    const dist = join(p.dir, '.indx-watch/cache/patched/dist');
    expect(r.json.data.dist).toBe(dist);
    const worker = readFileSync(join(dist, 'worker.js'), 'utf8');
    expect(worker).toBe(
      `globalThis.__IW_PATCHES__="${r.json.data.patch_hash.slice(0, 8)}";\nexport default {};\n`,
    );
    expect(readFileSync(join(dist, 'web/index.html'), 'utf8')).toContain('html');
    expect(await patchedDist(join(p.dir, '.indx-watch'))).toBe(dist);
    // a changed patch makes the build stale
    appendFileSync(join(p.dir, '.indx-watch/patches/0001-shorter-nav.patch'), '\n');
    await expect(patchedDist(join(p.dir, '.indx-watch'))).rejects.toThrow(/out of date/);
  });

  it('--dry-run only checks that the patches apply', () => {
    const p = project();
    makePatch(p);
    const r = iwJson(p.dir, 'patch apply', ['patch', 'apply', '--dry-run'], { env: p.env });
    expect(r.json.data).toMatchObject({ dist: null, patches: [{ applies: true }] });
    expect(existsSync(join(p.dir, '.indx-watch/cache/patched/dist'))).toBe(false);
  });

  it('says which tool is missing', () => {
    const p = project();
    makePatch(p);
    const none = fakeBin({});
    const r = iwJson(p.dir, 'patch check', ['patch', 'check'], { env: { ...p.env, PATH: none } });
    expect(r.code).toBe(4);
    expect(r.json.error).toMatchObject({ code: 'EXTERNAL_TOOL' });
    expect(r.json.error.message).toContain('git');
  });

  it('no patches means no patched build', async () => {
    expect(await patchedDist(join(shop(), '.indx-watch'))).toBeNull();
  });
});
