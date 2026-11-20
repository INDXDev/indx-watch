/**
 * The composite action at the repository root (docs/spec/integrations.md#github-action).
 * There is no YAML parser among the dependencies, so this checks the structure with small line-based reads and
 * runs the main shell step against a fake CLI. Full schema validation: `npx --yes @action-validator/cli action.yml`.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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

/** The block scalar of the first step's `run: |` (or of the step whose script contains `marker`), dedented. */
function mainScript(marker?: string): string {
  const starts = lines.flatMap((l, i) => (l === '      run: |' ? [i] : []));
  const start = marker ? starts.find((i) => lines[i + 1]?.includes(marker))! : starts[0]!;
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
      'comment',
      'check',
      'token',
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
    expect(spawnSync('bash', ['-n', '-c', mainScript('PR comment and check run')]).status).toBe(0);
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

describe('action.yml PR comment and check run with a fake gh', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'iw-action-gh-'));
    mkdirSync(join(tmp, 'bin'));
    // Logs each call (and the file behind -F x=@file); `existing` makes the comment list return comment 42.
    writeFileSync(
      join(tmp, 'bin/gh'),
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const files = Object.fromEntries(args.filter((a) => /^[a-z\\[\\]_]+=@/.test(a)).map((a) => {
  const [k, f] = a.split('=@');
  return [k, fs.readFileSync(f, 'utf8')];
}));
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, files }) + '\\n');
if (process.env.FAKE_GH_FAIL) process.exit(1);
if (args.includes('--paginate') && process.env.FAKE_EXISTING) console.log('42');
`,
    );
    chmodSync(join(tmp, 'bin/gh'), 0o755);
    writeFileSync(join(tmp, 'report.md'), '# Readiness\n\n| TC-1 | pass |\n');
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  function run(env: Record<string, string>) {
    writeFileSync(join(tmp, 'log'), '');
    const res = spawnSync(
      'bash',
      ['--noprofile', '--norc', '-eo', 'pipefail', '-c', mainScript('PR comment')],
      {
        encoding: 'utf8',
        env: {
          PATH: `${join(tmp, 'bin')}:${process.env.PATH}`,
          FAKE_LOG: join(tmp, 'log'),
          RUNNER_TEMP: tmp,
          GITHUB_REPOSITORY: 'acme/shop',
          GITHUB_RUN_ID: '9',
          IW_CHECK_RUN_ID: '777',
          IW_IN_RELEASE: 'v1.2.0',
          IW_GATE: 'fail',
          IW_PASS: '4',
          IW_FAIL: '1',
          IW_UNTESTED: '2',
          IW_REPORT: join(tmp, 'report.md'),
          IW_HEAD_SHA: 'a'.repeat(40),
          ...env,
        },
      },
    );
    const calls = readFileSync(join(tmp, 'log'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { args: string[]; files: Record<string, string> });
    return { res, calls };
  }

  it('creates one PR comment with a marker, then edits it in place', () => {
    const first = run({ IW_IN_COMMENT: 'true', IW_PR: '12' });
    expect(first.res.status, first.res.stderr).toBe(0);
    expect(first.calls.map((c) => c.args[0] === 'api' && c.args.slice(1, 3))).toEqual([
      ['repos/acme/shop/issues/12/comments', '--paginate'],
      ['repos/acme/shop/issues/12/comments', '-F'],
    ]);
    const body = first.calls[1]!.files.body!;
    expect(body.split('\n')[0]).toBe('<!-- indx-watch:.indx-watch:v1.2.0 -->');
    expect(body).toContain('❌ INDX Watch (v1.2.0): gate failed** · pass 4 · fail 1 · untested 2');
    expect(body).toContain('[job](https://github.com/acme/shop/actions/runs/9/job/777)');
    expect(body).toContain('| TC-1 | pass |');
    const again = run({ IW_IN_COMMENT: 'true', IW_PR: '12', FAKE_EXISTING: '1' });
    expect(again.calls[1]!.args.slice(0, 4)).toEqual([
      'api',
      '-X',
      'PATCH',
      'repos/acme/shop/issues/comments/42',
    ]);
    expect(run({ IW_IN_COMMENT: 'true', IW_PR: '' }).calls).toEqual([]); // not a pull request
  });

  it('creates a check run whose conclusion follows the gate; API errors only warn', () => {
    const pass = run({ IW_IN_CHECK: 'true', IW_GATE: 'pass' });
    const args = pass.calls[0]!.args;
    expect(args.slice(0, 2)).toEqual(['api', 'repos/acme/shop/check-runs']);
    for (const f of ['name=INDX Watch (v1.2.0)', `head_sha=${'a'.repeat(40)}`, 'conclusion=success'])
      expect(args).toContain(f);
    expect(pass.calls[0]!.files['output[summary]']).toContain('✅ INDX Watch (v1.2.0): gate passed');
    expect(run({ IW_IN_CHECK: 'true' }).calls[0]!.args).toContain('conclusion=failure');
    const denied = run({ IW_IN_CHECK: 'true', IW_IN_COMMENT: 'true', IW_PR: '12', FAKE_GH_FAIL: '1' });
    expect(denied.res.status).toBe(0);
    expect(denied.res.stdout).toContain('::warning::indx-watch could not comment on the PR');
    expect(denied.res.stdout).toContain('::warning::indx-watch could not create the check run');
  });

  it('cuts a huge report below the comment limit at a line boundary', () => {
    writeFileSync(join(tmp, 'report.md'), '| TC-1 | pass | ok |\n'.repeat(10_000));
    const body = run({ IW_IN_COMMENT: 'true', IW_PR: '12' }).calls[1]!.files.body!;
    expect(body.length).toBeLessThan(65_536);
    expect(body).toContain('Report truncated');
    expect(
      body
        .split('\n')
        .filter((l) => l.startsWith('|'))
        .every((l) => l === '| TC-1 | pass | ok |'),
    ).toBe(true);
  });
});

describe('action.yml with the real CLI on examples/shop', () => {
  it('gate: true fails the action when a P0 test case fails (TC-8 in the sample store)', () => {
    const root = resolve(import.meta.dirname, '../../..');
    const tmp = mkdtempSync(join(tmpdir(), 'iw-action-gate-'));
    try {
      cpSync(join(root, 'examples/shop/.indx-watch'), join(tmp, 'work/.indx-watch'), {
        recursive: true,
        filter: (s) => !/[/\\](runs|cache)([/\\]|$)/.test(s),
      });
      cpSync(join(root, 'examples/shop/store'), join(tmp, 'work/store'), { recursive: true });
      // cli: local, pointing at the CLI source through tsx
      mkdirSync(join(tmp, 'action/packages/cli/dist'), { recursive: true });
      const tsx = [join(root, 'node_modules/tsx/dist/cli.mjs'), join(root, 'packages/cli/src/bin.ts')];
      writeFileSync(
        join(tmp, 'action/packages/cli/dist/bin.js'),
        `const r = require('node:child_process').spawnSync(process.execPath, [...${JSON.stringify(tsx)}, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
`,
      );
      mkdirSync(join(tmp, 'runner'));
      const output = join(tmp, 'output');
      writeFileSync(output, '');
      const env = {
        PATH: process.env.PATH,
        HOME: tmp,
        IW_ACTOR: 'ci@shop.test',
        GITHUB_OUTPUT: output,
        RUNNER_TEMP: join(tmp, 'runner'),
        IW_ACTION_PATH: join(tmp, 'action'),
        IW_IN_CLI: 'local',
        IW_IN_SUMMARY: 'false',
        IW_IN_RELEASE: 'v1.2.0',
      };
      const bash = (script: string) =>
        spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
          cwd: join(tmp, 'work'),
          encoding: 'utf8',
          env,
        });
      const main = bash(mainScript());
      expect(main.status, main.stdout + main.stderr).toBe(0);
      const out = Object.fromEntries(
        readFileSync(output, 'utf8')
          .trim()
          .split('\n')
          .map((l) => l.split(/=(.*)/s).slice(0, 2)),
      );
      expect(out).toMatchObject({ gate: 'fail', fail: '1' });
      // the last step runs when inputs.gate is 'true' and the gate did not pass, and exits 1
      const i = lines.findIndex((l) => l.includes('readiness gate failed'));
      const step = lines.slice(0, i).findLast((l) => l.startsWith('    - '));
      expect(step).toMatch(/^ {4}- if: .*inputs\.gate == 'true' && steps\.iw\.outputs\.gate != 'pass' }}$/);
      const gate = bash(mainScript('readiness gate failed'));
      expect(gate.status).toBe(1);
      expect(gate.stdout).toContain('::error::INDX Watch readiness gate failed');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});
