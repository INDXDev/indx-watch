import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { fixtureRows, iw, ROOT, shopCopy, tempDir } from './helpers';

test('init and create a use case and a test case', { tag: ['@TC-1'] }, async () => {
  const dir = tempDir();
  await test.step('1. iw init demo', async () => {
    expect(iw(['init', 'demo'], { cwd: dir }).code).toBe(0);
    expect(iw(['check'], { cwd: join(dir, 'demo') }).code).toBe(0);
  });
  await test.step('2. iw new uc / tc', async () => {
    const cwd = join(dir, 'demo');
    const uc = iw(
      [
        'new',
        'uc',
        '--title',
        'Guest applies a coupon',
        '--ac',
        'A valid coupon reduces the total',
        '--ready',
        '--json',
      ],
      { cwd },
    );
    expect(uc.code, uc.stderr).toBe(0);
    const tc = iw(
      [
        'new',
        'tc',
        '--uc',
        uc.json.data.key,
        '--title',
        'Valid coupon',
        '--step',
        'Apply SUMMER10 => Total drops by 10%',
        '--ready',
        '--json',
      ],
      { cwd },
    );
    expect(tc.code, tc.stderr).toBe(0);
    expect(existsSync(join(cwd, '.indx-watch', tc.json.data.file))).toBe(true);
    const check = iw(['check', '--json'], { cwd });
    expect(check.json.data.errors).toBe(0);
  });
});

for (const row of fixtureRows('FX-1-invalid-bundle-files/invalid-files.csv')) {
  test(`check names invalid files (${row.case})`, { tag: ['@TC-2'] }, async () => {
    test.info().annotations.push({ type: '_iw.fixture', description: `FX-1:${row.case}` });
    const dir = tempDir();
    iw(['init', 'demo'], { cwd: dir });
    const cwd = join(dir, 'demo');
    await test.step('1. break a file and run iw check --json', async () => {
      appendFileSync(join(cwd, '.indx-watch', row.file!), `\n${row.append}\n`);
      const r = iw(['check', '--json'], { cwd });
      expect(r.code).toBe(1);
      const problems = r.json.error?.details ?? r.json.data?.problems ?? [];
      expect(
        problems.some(
          (p: { code: string; file?: string }) => p.code === row.expected_code && p.file === row.file,
        ),
      ).toBe(true);
    });
  });
}

test('status and gate on the sample project', { tag: ['@TC-3'] }, async () => {
  const cwd = shopCopy();
  await test.step('1. iw status --json', async () => {
    const r = iw(['status', '--release', 'v1.2.0', '--json'], { cwd });
    expect(r.code).toBe(0);
    expect(r.json.data.useCases.map((u: { key: string }) => u.key)).toEqual([
      'UC-1',
      'UC-2',
      'UC-3',
      'UC-4',
      'UC-5',
    ]);
    expect(r.json.data.gate.checks.length).toBeGreaterThanOrEqual(7);
  });
  await test.step('2. iw status --gate', async () => {
    const r = iw(['status', '--release', 'v1.2.0', '--gate', '--json'], { cwd });
    expect(r.code).toBe(1);
  });
});

test('html and customer reports', { tag: ['@TC-8'] }, async ({ page }) => {
  const cwd = shopCopy();
  const out = join(cwd, 'report.html');
  await test.step('1. iw report --format html', async () => {
    expect(iw(['sync'], { cwd }).code).toBe(0); // the sample results, so the report has runs and a failure
    expect(iw(['report', '--release', 'v1.2.0', '--format', 'html', '--out', out], { cwd }).code).toBe(0);
    const requests: string[] = [];
    page.on('request', (r) => {
      if (r.url() !== `file://${out}` && !r.url().startsWith('data:')) requests.push(r.url());
    });
    await page.route('**/*', (route) =>
      route.request().url().startsWith('file:') ? route.continue() : route.abort(),
    );
    await page.context().setOffline(true);
    await page.goto(`file://${out}`);
    await expect(page.locator('body')).toContainText('v1.2.0');
    await expect(page.locator('body')).toContainText('TC-8');
    expect(requests).toEqual([]);
  });
  await test.step('2. customer audience has no emails', async () => {
    const r = iw(['report', '--release', 'v1.2.0', '--format', 'md', '--audience', 'customer'], { cwd });
    expect(r.code).toBe(0);
    expect(r.stdout).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});

test('export and import round trip', { tag: ['@TC-9'] }, async () => {
  const cwd = shopCopy();
  const target = tempDir();
  await test.step('1. export, import, export again', async () => {
    const a = iw(['export', '--full', '--out', join(target, 'a.tar.gz'), '--json'], { cwd });
    expect(a.code, a.stderr).toBe(0);
    const imp = iw(['import', join(target, 'a.tar.gz'), '--json'], { cwd: join(target) });
    expect(imp.code, imp.stderr).toBe(0);
    const b = iw(['export', '--full', '--out', join(target, 'b.tar.gz'), '--json'], { cwd: target });
    expect(b.json.data.manifest.sha256).toBe(a.json.data.manifest.sha256);
  });
});

test('AI drafts stay drafts until a human approves', { tag: ['@TC-10'] }, async () => {
  const cwd = shopCopy();
  let file = '';
  let key = '';
  await test.step('1. iw new tc --origin ai', async () => {
    const r = iw(
      [
        'new',
        'tc',
        '--uc',
        'UC-5',
        '--title',
        'Large photo is resized',
        '--step',
        'Attach a 5 MB photo => A thumbnail appears',
        '--origin',
        'ai',
        '--model',
        'test-model',
        '--json',
      ],
      { cwd },
    );
    expect(r.code, r.stderr).toBe(0);
    ({ file, key } = r.json.data);
    const text = readFileSync(join(cwd, '.indx-watch', file), 'utf8');
    expect(text).toContain('status = "draft"');
    expect(text).toContain('origin = "ai"');
    expect(text).toContain('[ai]');
  });
  await test.step('2. agents cannot approve; humans can', async () => {
    expect(iw(['approve', key], { cwd, env: { IW_ACTOR_KIND: 'agent' } }).code).toBe(2);
    expect(iw(['approve', key], { cwd, env: { IW_ACTOR_KIND: 'human' } }).code).toBe(0);
    const text = readFileSync(join(cwd, '.indx-watch', file), 'utf8');
    expect(text).toContain('status = "ready"');
    expect(text).toContain('approved_by = "e2e@indx.dev"');
  });
});

test('push and clone the test files', { tag: ['@TC-14'] }, async () => {
  const dir = shopCopy();
  const store = `file://${join(dir, 'store')}`;
  await test.step('1. iw push publishes a snapshot', async () => {
    const r = iw(['push', '--json'], { cwd: dir });
    expect(r.code, r.stderr).toBe(0);
    expect(r.json.data.snapshot).toMatch(/^rec_/);
  });
  await test.step('2. iw clone makes a working copy that passes iw check', async () => {
    const parent = tempDir('iw-clone-');
    const r = iw(['clone', store, 'copy', '--json'], { cwd: parent });
    expect(r.code, r.stderr).toBe(0);
    expect(r.json.data.pulled.records).toBeGreaterThan(0);
    expect(existsSync(join(parent, 'copy/.indx-watch/project.toml'))).toBe(true);
    expect(iw(['check'], { cwd: join(parent, 'copy') }).code).toBe(0);
  });
});

// docs/spec/agents.md#install
test('one command sets up Claude Code and Codex', { tag: ['@TC-18'] }, async () => {
  const dir = shopCopy();
  execFileSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(join(dir, 'CLAUDE.md'), '# Shop\n');
  const read = (path: string) => readFileSync(join(dir, path), 'utf8');
  await test.step('1. iw skills install writes the skills, both MCP entries and the AGENTS.md block', async () => {
    const r = iw(['skills', 'install', '--json'], { cwd: dir });
    expect(r.code, r.stderr).toBe(0);
    for (const base of ['.claude/skills', '.agents/skills'])
      expect(existsSync(join(dir, base, 'iw-test/SKILL.md')), base).toBe(true);
    const { version } = JSON.parse(readFileSync(join(ROOT, 'packages/cli/package.json'), 'utf8'));
    const mcp = { command: 'npx', args: ['-y', `indx-watch@${version}`, 'mcp'] }; // pinned (T-502)
    expect(JSON.parse(read('.mcp.json')).mcpServers['indx-watch']).toEqual(mcp);
    expect(read('.codex/config.toml')).toContain('[mcp_servers.indx-watch]');
    expect(read('AGENTS.md')).toMatch(
      /<!-- indx-watch:start -->[\s\S]*`iw-test`[\s\S]*<!-- indx-watch:end -->/,
    );
    expect(read('CLAUDE.md')).toMatch(/^@AGENTS\.md$/m);
  });
  await test.step('2. a second run changes nothing and keeps another MCP server', async () => {
    const config = JSON.parse(read('.mcp.json'));
    config.mcpServers.other = { command: 'other-mcp' };
    writeFileSync(join(dir, '.mcp.json'), `${JSON.stringify(config, null, 2)}\n`);
    const r = iw(['skills', 'install', '--json'], { cwd: dir });
    expect(r.code, r.stderr).toBe(0);
    expect(r.json.data.files).toEqual([]);
    expect(JSON.parse(read('.mcp.json')).mcpServers.other).toEqual({ command: 'other-mcp' });
  });
});
