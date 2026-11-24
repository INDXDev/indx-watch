/** Staying current (docs/spec/cli.md#iw-doctor, docs/spec/web.md#version-notice). */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { iw, serve, shopCopy } from './helpers';

/** A copy of the shop with the agent files, a package.json and a workflow that all pin an old version. */
function oldPins(): string {
  const dir = shopCopy();
  expect(iw(['skills', 'install'], { cwd: dir }).code).toBe(0);
  writeFileSync(join(dir, 'package.json'), '{\n  "devDependencies": { "indx-watch": "^0.0.1" }\n}\n');
  mkdirSync(join(dir, '.github/workflows'), { recursive: true });
  writeFileSync(
    join(dir, '.github/workflows/indx-watch.yml'),
    'jobs:\n  qa:\n    steps:\n      - uses: INDXDev/indx-watch@v0\n        with:\n          version: 0.0.1\n',
  );
  return dir;
}
const states = (dir: string) =>
  Object.fromEntries(
    iw(['doctor', '--json'], { cwd: dir }).json.data.parts.map(
      (p: { part: string; target: string; state: string }) => [
        p.part === 'skills' ? p.target : p.part,
        p.state,
      ],
    ),
  );

test('doctor lists every pinned part and changes nothing', { tag: ['@TC-19'] }, async () => {
  const dir = oldPins();
  await test.step('1. iw doctor on a project with old pins', async () => {
    const before = readFileSync(join(dir, 'package.json'), 'utf8');
    expect(states(dir)).toMatchObject({ tool: 'unpinned', package: 'outdated', workflow: 'outdated' });
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(before);
  });
  await test.step('2. edit a skill by hand', async () => {
    writeFileSync(join(dir, '.claude/skills/iw-test/SKILL.md'), 'mine');
    expect(states(dir)['.claude/skills']).toBe('locally-edited');
  });
});

test('update moves every pinned part to one version', { tag: ['@TC-20'] }, async () => {
  const dir = oldPins();
  await test.step('1. --dry-run writes nothing', async () => {
    const r = iw(['update', '--dry-run', '--json'], { cwd: dir });
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toContain('^0.0.1');
  });
  await test.step('2. update pins everything and prints the install command', async () => {
    const r = iw(['update', '--json'], { cwd: dir });
    expect(r.code, r.stderr).toBe(0);
    expect(r.json.data.install).toBe('npm install');
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).not.toContain('0.0.1');
    expect(readFileSync(join(dir, '.github/workflows/indx-watch.yml'), 'utf8')).not.toContain('0.0.1');
    expect(Object.values(states(dir)).every((s) => s === 'ok')).toBe(true);
  });
  await test.step('3. a second run changes nothing', async () => {
    const again = iw(['update', '--json'], { cwd: dir }).json.data;
    expect(again.steps.flatMap((s: { changed: string[] }) => s.changed)).toEqual([]);
  });
});

test('a lead is told when the app is older than the project pins', { tag: ['@TC-21'] }, async ({ page }) => {
  const notice = page.getByTestId('version-drift');
  /** `iw serve` over a shop copy whose project.toml pins `pinned`. */
  const open = async (pinned: string) => {
    const dir = shopCopy();
    const file = join(dir, '.indx-watch/project.toml');
    const text = readFileSync(file, 'utf8');
    writeFileSync(file, text.replace('[store]', `[tool]\nindx_watch = "${pinned}"\n\n[store]`));
    return serve(dir);
  };
  await test.step('1. the project pins a newer version than the server runs', async () => {
    const server = await open('99.0.0');
    try {
      await page.goto(server.url);
      await expect(notice).toContainText('the project pins 99.0.0');
      await expect(notice).toContainText('npx indx-watch@99.0.0 serve');
      await page.screenshot({ path: test.info().outputPath('drift.png') });
    } finally {
      server.stop();
    }
  });
  await test.step('2. the project pins the version the server runs', async () => {
    const server = await open('0.0.1');
    try {
      await page.goto(server.url);
      await expect(page.getByRole('heading').first()).toBeVisible();
      await expect(notice).toHaveCount(0);
    } finally {
      server.stop();
    }
  });
});
