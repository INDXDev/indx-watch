/**
 * The composite action at the repository root (docs/spec/integrations.md#github-action).
 * There is no YAML parser among the dependencies, so this checks the structure with small line-based reads and
 * runs the main shell step against a fake CLI. Full schema validation: `npx --yes @action-validator/cli action.yml`.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ACTION = readFileSync(resolve(import.meta.dirname, '../../../action.yml'), 'utf8');
const lines = ACTION.split('\n');

/** Keys directly under a top-level section such as `inputs:`. */
function keysOf(section: string): string[] {
  const start = lines.indexOf(`${section}:`);
  const end = lines.findIndex((l, i) => i > start && /^\S/.test(l));
  return lines.slice(start + 1, end).flatMap((l) => /^ {2}([a-z-]+):$/.exec(l)?.[1] ?? []);
}

/** The block scalar of the main step's `run: |`, dedented. */
function mainScript(): string {
  const start = lines.indexOf('      run: |');
  const body = [];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() && !l.startsWith('        ')) break;
    body.push(l.slice(8));
  }
  return body.join('\n');
}

describe('action.yml structure', () => {
  it('declares the documented inputs and outputs', () => {
    expect(keysOf('inputs')).toEqual([
      'version',
      'cli',
      'dir',
      'release',
      'environment',
      'store',
      'sync',
      'summary',
      'gate',
      'deployment',
      'upload-artifact',
    ]);
    expect(keysOf('outputs')).toEqual(['gate', 'report', 'pass', 'fail', 'untested']);
    expect(ACTION).toMatch(/^ {2}using: composite$/m);
  });

  it('references only declared inputs and outputs the main step writes', () => {
    const inputs = new Set(keysOf('inputs'));
    for (const [, name] of ACTION.matchAll(/inputs\.([a-z-]+)/g)) expect(inputs).toContain(name);
    const script = mainScript();
    for (const [, name] of ACTION.matchAll(/steps\.iw\.outputs\.([a-z]+)/g))
      expect(script).toMatch(new RegExp(`(echo "|\`)${name}=`));
  });

  it('gives every run step a shell and uploads hidden files with upload-artifact v7', () => {
    const steps = ACTION.split(/\n {4}- /).slice(1);
    for (const step of steps.filter((s) => /\brun: /.test(s))) expect(step).toMatch(/\bshell: bash\b/);
    const upload = steps.find((s) => s.includes('uses: actions/upload-artifact'));
    expect(upload).toMatch(/uses: actions\/upload-artifact@v7\n/);
    expect(upload).toMatch(/include-hidden-files: true/);
    expect(spawnSync('bash', ['-n', '-c', mainScript()]).status).toBe(0);
  });
});

describe('action.yml main step with a fake CLI', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'iw-action-'));
    mkdirSync(join(tmp, 'action/packages/cli/dist'), { recursive: true });
    mkdirSync(join(tmp, 'work/.indx-watch'), { recursive: true });
    mkdirSync(join(tmp, 'runner'));
    writeFileSync(
      join(tmp, 'action/packages/cli/dist/bin.js'),
      `const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'status' && process.env.FAKE_STATUS === 'fail') {
  console.log(JSON.stringify({ ok: false, command: 'status', error: { code: 'NO_BUNDLE', message: 'no bundle' } }));
  process.exit(3);
} else if (args[0] === 'status') console.log(JSON.stringify({ ok: true, command: 'status',
  data: { gate: { passed: process.env.FAKE_GATE === 'pass', checks: [] }, counts: { pass: 4, fail: 1, untested: 2 } } }));
else if (args[0] === 'report') fs.writeFileSync(args[args.indexOf('--out') + 1], process.env.FAKE_REPORT_FILE ? fs.readFileSync(process.env.FAKE_REPORT_FILE) : process.env.FAKE_REPORT);
else console.log('{"ok":true}');
`,
    );
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  function run(
    env: Record<string, string>,
    projectToml = 'schema_version = 1\n\n[store]\nurl = "s3://b/p"\n',
  ) {
    writeFileSync(join(tmp, 'work/.indx-watch/project.toml'), projectToml);
    for (const f of ['log', 'output', 'summary']) writeFileSync(join(tmp, f), '');
    const res = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', mainScript()], {
      cwd: join(tmp, 'work'),
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        FAKE_LOG: join(tmp, 'log'),
        FAKE_REPORT: '# Readiness\n',
        GITHUB_OUTPUT: join(tmp, 'output'),
        GITHUB_STEP_SUMMARY: join(tmp, 'summary'),
        GITHUB_JOB: 'e2e',
        RUNNER_TEMP: join(tmp, 'runner'),
        IW_ACTION_PATH: join(tmp, 'action'),
        IW_IN_CLI: 'auto',
        IW_IN_SUMMARY: 'true',
        IW_CHECK_RUN_ID: '777',
        ...env,
      },
    });
    const calls = readFileSync(join(tmp, 'log'), 'utf8').trim().split('\n').filter(Boolean);
    const output = Object.fromEntries(
      readFileSync(join(tmp, 'output'), 'utf8')
        .trim()
        .split('\n')
        .map((l) => l.split(/=(.*)/s).slice(0, 2)),
    );
    return { res, calls: calls.map((c) => JSON.parse(c) as string[]), output, summary: join(tmp, 'summary') };
  }

  it('records the deployment, syncs with a snapshot on the default branch, reports and sets outputs', () => {
    const { res, calls, output, summary } = run({
      GITHUB_REF: 'refs/heads/main',
      IW_DEFAULT_BRANCH: 'main',
      IW_IN_RELEASE: 'v1.2.0',
      IW_IN_DEPLOYMENT: 'staging',
    });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(calls.map((c) => c.filter((a) => !a.startsWith(tmp)))).toEqual([
      ['deployment', 'add', '--env', 'staging', '--release', 'v1.2.0', '--json'],
      ['sync', '--snapshot', '--json'],
      ['status', '--release', 'v1.2.0', '--json'],
      ['report', '--release', 'v1.2.0', '--format', 'md', '--out'],
    ]);
    expect(output).toMatchObject({ gate: 'fail', pass: '4', fail: '1', untested: '2', upload: 'false' });
    expect(output.artifact).toBe('indx-watch-runs-e2e-777');
    expect(output.report).toBe(join(tmp, 'runner/indx-watch/report.md'));
    expect(readFileSync(summary, 'utf8')).toBe('# Readiness\n\n');
  });

  it('skips the snapshot off the default branch, sync without a store, and uploads the runs instead', () => {
    const branch = run({ GITHUB_REF: 'refs/heads/feature', IW_DEFAULT_BRANCH: 'main', FAKE_GATE: 'pass' });
    expect(branch.calls[0]).toEqual(['sync', '--json']);
    expect(branch.output.gate).toBe('pass');
    const noStore = run({ IW_IN_DIR: '.indx-watch', IW_IN_SUMMARY: 'false' }, 'schema_version = 1\n');
    expect(noStore.calls.map((c) => c[0])).toEqual(['status', 'report']);
    expect(noStore.calls[0]).toEqual(['status', '--dir', '.indx-watch', '--json']);
    expect(noStore.output).toMatchObject({ upload: 'true', runs: '.indx-watch/runs' });
    expect(readFileSync(noStore.summary, 'utf8')).toBe('');
  });

  it('truncates the job summary below 1 MiB at a line boundary', () => {
    const big = `${'| TC-1 | pass | ok |\n'.repeat(80_000)}`;
    writeFileSync(join(tmp, 'big.md'), big); // too large for an environment variable
    const { summary } = run({ FAKE_REPORT_FILE: join(tmp, 'big.md') });
    const text = readFileSync(summary, 'utf8');
    expect(statSync(summary).size).toBeLessThan(1024 * 1024);
    expect(text).toContain('Report truncated');
    expect(
      text
        .split('\n')
        .filter((l) => l.startsWith('|'))
        .every((l) => l === '| TC-1 | pass | ok |'),
    ).toBe(true);
  });

  it('fails when status fails and refuses cli: local without a build', () => {
    const failed = run({ FAKE_STATUS: 'fail' });
    expect(failed.res.status).toBe(1);
    expect(failed.res.stdout).toContain('::error::indx-watch status failed: no bundle');
    expect(failed.calls.map((c) => c[0])).toEqual(['sync', 'status']);
    rmSync(join(tmp, 'action/packages/cli/dist/bin.js'));
    const local = run({ IW_IN_CLI: 'local' });
    expect(local.res.status).toBe(1);
    expect(local.res.stdout).toContain('::error::cli: local needs');
  });
});
