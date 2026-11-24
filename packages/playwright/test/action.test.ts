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

const BASH = ['--noprofile', '--norc', '-eo', 'pipefail', '-c'];
const RELEASE = 'v1.2.0';
const CHECK_RUN_ID = '777';
const REPO = 'acme/shop';
const HEAD_SHA = 'a'.repeat(40);
/** One table row of a report, repeated to make reports too large for a summary or a comment. */
const ROW = '| TC-1 | pass | ok |';

/** Runs a shell step the way GitHub runs `shell: bash`. */
const bash = (script: string, opts: { cwd?: string; env: NodeJS.ProcessEnv }) =>
  spawnSync('bash', [...BASH, script], { encoding: 'utf8', ...opts });

/** Parses a GITHUB_OUTPUT file of `name=value` lines. */
function readOutputs(file: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((l) => l.split(/=(.*)/s).slice(0, 2)),
  );
}

/** Parses a log of one JSON value per line. */
function readLog<T>(file: string): T[] {
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

/** True when every table row of a truncated report is a whole ROW, i.e. it was cut at a line boundary. */
const onlyWholeRows = (text: string) =>
  text
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .every((l) => l === ROW);

/** A fresh temp dir per test, prepared by `init` and removed afterwards. */
function useTmpDir(prefix: string, init: (dir: string) => void): () => string {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), prefix));
    init(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  return () => dir;
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

  it('runs the gate step only when inputs.gate is true and the gate did not pass', () => {
    const i = lines.findIndex((l) => l.includes('readiness gate failed'));
    const step = lines.slice(0, i).findLast((l) => l.startsWith('    - '));
    expect(step).toMatch(/^ {4}- if: .*inputs\.gate == 'true' && steps\.iw\.outputs\.gate != 'pass' }}$/);
  });
});

/** A fake `packages/cli/dist/bin.js` that logs its argv and answers status/report from FAKE_* variables. */
const FAKE_CLI = `const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'status' && process.env.FAKE_STATUS === 'fail') {
  console.log(JSON.stringify({ ok: false, command: 'status', error: { code: 'NO_BUNDLE', message: 'no bundle' } }));
  process.exit(3);
} else if (args[0] === 'status') console.log(JSON.stringify({ ok: true, command: 'status',
  data: { gate: { passed: process.env.FAKE_GATE === 'pass', checks: [] }, counts: { pass: 4, fail: 1, untested: 2 } } }));
else if (args[0] === 'report') fs.writeFileSync(args[args.indexOf('--out') + 1], process.env.FAKE_REPORT_FILE ? fs.readFileSync(process.env.FAKE_REPORT_FILE) : process.env.FAKE_REPORT);
else console.log('{"ok":true}');
`;
const PROJECT_WITH_STORE = 'schema_version = 1\n\n[store]\nurl = "s3://b/p"\n';

function setupFakeCli(tmp: string) {
  mkdirSync(join(tmp, 'action/packages/cli/dist'), { recursive: true });
  mkdirSync(join(tmp, 'work/.indx-watch'), { recursive: true });
  mkdirSync(join(tmp, 'runner'));
  writeFileSync(join(tmp, 'action/packages/cli/dist/bin.js'), FAKE_CLI);
}

/** Runs the main step in `tmp/work` against the fake CLI; returns its CLI calls, outputs and summary file. */
function runMain(tmp: string, env: Record<string, string>, projectToml = PROJECT_WITH_STORE) {
  writeFileSync(join(tmp, 'work/.indx-watch/project.toml'), projectToml);
  for (const f of ['log', 'output', 'summary']) writeFileSync(join(tmp, f), '');
  const res = bash(mainScript(), {
    cwd: join(tmp, 'work'),
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
      IW_CHECK_RUN_ID: CHECK_RUN_ID,
      ...env,
    },
  });
  const calls = readLog<string[]>(join(tmp, 'log'));
  return { res, calls, output: readOutputs(join(tmp, 'output')), summary: join(tmp, 'summary') };
}

describe('action.yml main step with a fake CLI: sync, status and report', () => {
  const tmp = useTmpDir('iw-action-', setupFakeCli);

  it('records the deployment, syncs with a snapshot on the default branch, reports and sets outputs', () => {
    const { res, calls, output, summary } = runMain(tmp(), {
      GITHUB_REF: 'refs/heads/main',
      IW_DEFAULT_BRANCH: 'main',
      IW_IN_RELEASE: RELEASE,
      IW_IN_DEPLOYMENT: 'staging',
    });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(calls.map((c) => c.filter((a) => !a.startsWith(tmp())))).toEqual([
      ['deployment', 'add', '--env', 'staging', '--release', RELEASE, '--json'],
      ['sync', '--snapshot', '--json'],
      ['status', '--release', RELEASE, '--json'],
      ['report', '--release', RELEASE, '--format', 'md', '--out'],
    ]);
    expect(output).toMatchObject({ gate: 'fail', pass: '4', fail: '1', untested: '2', upload: 'false' });
    expect(output.artifact).toBe(`indx-watch-runs-e2e-${CHECK_RUN_ID}`);
    expect(output.report).toBe(join(tmp(), 'runner/indx-watch/report.md'));
    expect(readFileSync(summary, 'utf8')).toBe('# Readiness\n\n');
  });

  it('runs the version of [tool] indx_watch when the version input is empty (the input wins, then the action tag)', () => {
    const bin = join(tmp(), 'bin');
    mkdirSync(bin);
    const fake = join(tmp(), 'action/packages/cli/dist/bin.js');
    writeFileSync(
      join(bin, 'npx'),
      `#!/bin/sh\necho "$2" >> "${join(tmp(), 'npx')}"\nshift 2\nexec node "${fake}" "$@"\n`,
    );
    chmodSync(join(bin, 'npx'), 0o755);
    const pinned = 'schema_version = 1\n\n[tool]\nindx_watch = "0.3.1"\n\n[store]\nurl = "s3://b/p"\n';
    const used = (env: Record<string, string>, project: string) => {
      writeFileSync(join(tmp(), 'npx'), '');
      const run = runMain(tmp(), { IW_IN_CLI: 'npm', PATH: `${bin}:${process.env.PATH}`, ...env }, project);
      expect(run.res.status, run.res.stdout + run.res.stderr).toBe(0);
      return readFileSync(join(tmp(), 'npx'), 'utf8').split('\n')[0];
    };
    expect(used({}, pinned)).toBe('indx-watch@0.3.1');
    expect(used({ IW_IN_VERSION: '0.2.0' }, pinned)).toBe('indx-watch@0.2.0');
    expect(used({ IW_ACTION_REF: 'v0.1.2' }, PROJECT_WITH_STORE)).toBe('indx-watch@0.1.2');
    expect(used({}, PROJECT_WITH_STORE)).toBe('indx-watch@latest');
    // [tool] is the last table of the file
    expect(used({}, 'schema_version = 1\n\n[tool]\nindx_watch = "0.4.0"\n')).toBe('indx-watch@0.4.0');
  });

  it('skips the snapshot off the default branch', () => {
    const branch = runMain(tmp(), {
      GITHUB_REF: 'refs/heads/feature',
      IW_DEFAULT_BRANCH: 'main',
      FAKE_GATE: 'pass',
    });
    expect(branch.calls[0]).toEqual(['sync', '--json']);
    expect(branch.output.gate).toBe('pass');
  });

  it('skips sync without a store and uploads the runs instead', () => {
    const noStore = runMain(
      tmp(),
      { IW_IN_DIR: '.indx-watch', IW_IN_SUMMARY: 'false' },
      'schema_version = 1\n',
    );
    expect(noStore.calls.map((c) => c[0])).toEqual(['status', 'report']);
    expect(noStore.calls[0]).toEqual(['status', '--dir', '.indx-watch', '--json']);
    expect(noStore.output).toMatchObject({ upload: 'true', runs: '.indx-watch/runs' });
    expect(readFileSync(noStore.summary, 'utf8')).toBe('');
  });
});

describe('action.yml main step with a fake CLI: limits and failures', () => {
  const tmp = useTmpDir('iw-action-', setupFakeCli);

  it('truncates the job summary below 1 MiB at a line boundary', () => {
    writeFileSync(join(tmp(), 'big.md'), `${ROW}\n`.repeat(80_000)); // too large for an environment variable
    const { summary } = runMain(tmp(), { FAKE_REPORT_FILE: join(tmp(), 'big.md') });
    const text = readFileSync(summary, 'utf8');
    expect(statSync(summary).size).toBeLessThan(1024 * 1024);
    expect(text).toContain('Report truncated');
    expect(onlyWholeRows(text)).toBe(true);
  });

  it('fails when status fails', () => {
    const failed = runMain(tmp(), { FAKE_STATUS: 'fail' });
    expect(failed.res.status).toBe(1);
    expect(failed.res.stdout).toContain('::error::indx-watch status failed: no bundle');
    expect(failed.calls.map((c) => c[0])).toEqual(['sync', 'status']);
  });

  it('refuses cli: local without a build', () => {
    rmSync(join(tmp(), 'action/packages/cli/dist/bin.js'));
    const local = runMain(tmp(), { IW_IN_CLI: 'local' });
    expect(local.res.status).toBe(1);
    expect(local.res.stdout).toContain('::error::cli: local needs');
  });
});

/** A fake `gh` that logs each call (and the file behind -F x=@file); FAKE_EXISTING makes the comment list return 42. */
const FAKE_GH = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const files = Object.fromEntries(args.filter((a) => /^[a-z\\[\\]_]+=@/.test(a)).map((a) => {
  const [k, f] = a.split('=@');
  return [k, fs.readFileSync(f, 'utf8')];
}));
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, files }) + '\\n');
if (process.env.FAKE_GH_FAIL) process.exit(1);
if (args.includes('--paginate') && process.env.FAKE_EXISTING) console.log('42');
`;

function setupFakeGh(tmp: string) {
  mkdirSync(join(tmp, 'bin'));
  writeFileSync(join(tmp, 'bin/gh'), FAKE_GH);
  chmodSync(join(tmp, 'bin/gh'), 0o755);
  writeFileSync(join(tmp, 'report.md'), '# Readiness\n\n| TC-1 | pass |\n');
}

/** Runs the PR comment and check run step against the fake gh; returns the gh calls. */
function runGh(tmp: string, env: Record<string, string>) {
  writeFileSync(join(tmp, 'log'), '');
  const res = bash(mainScript('PR comment'), {
    env: {
      PATH: `${join(tmp, 'bin')}:${process.env.PATH}`,
      FAKE_LOG: join(tmp, 'log'),
      RUNNER_TEMP: tmp,
      GITHUB_REPOSITORY: REPO,
      GITHUB_RUN_ID: '9',
      IW_CHECK_RUN_ID: CHECK_RUN_ID,
      IW_IN_RELEASE: RELEASE,
      IW_GATE: 'fail',
      IW_PASS: '4',
      IW_FAIL: '1',
      IW_UNTESTED: '2',
      IW_REPORT: join(tmp, 'report.md'),
      IW_HEAD_SHA: HEAD_SHA,
      ...env,
    },
  });
  return { res, calls: readLog<{ args: string[]; files: Record<string, string> }>(join(tmp, 'log')) };
}

const COMMENT_ON_PR = { IW_IN_COMMENT: 'true', IW_PR: '12' };

describe('action.yml PR comment with a fake gh', () => {
  const tmp = useTmpDir('iw-action-gh-', setupFakeGh);

  it('creates one PR comment with a marker, the gate line, a job link and the report', () => {
    const first = runGh(tmp(), COMMENT_ON_PR);
    expect(first.res.status, first.res.stderr).toBe(0);
    expect(first.calls.map((c) => c.args[0] === 'api' && c.args.slice(1, 3))).toEqual([
      [`repos/${REPO}/issues/12/comments`, '--paginate'],
      [`repos/${REPO}/issues/12/comments`, '-F'],
    ]);
    const body = first.calls[1]!.files.body!;
    expect(body.split('\n')[0]).toBe(`<!-- indx-watch:.indx-watch:${RELEASE} -->`);
    expect(body).toContain(`❌ INDX Watch (${RELEASE}): gate failed** · pass 4 · fail 1 · untested 2`);
    expect(body).toContain(`[job](https://github.com/${REPO}/actions/runs/9/job/${CHECK_RUN_ID})`);
    expect(body).toContain('| TC-1 | pass |');
  });

  it('edits the existing comment in place', () => {
    const again = runGh(tmp(), { ...COMMENT_ON_PR, FAKE_EXISTING: '1' });
    expect(again.calls[1]!.args.slice(0, 4)).toEqual([
      'api',
      '-X',
      'PATCH',
      `repos/${REPO}/issues/comments/42`,
    ]);
  });

  it('does nothing outside a pull request', () => {
    expect(runGh(tmp(), { ...COMMENT_ON_PR, IW_PR: '' }).calls).toEqual([]);
  });

  it('cuts a huge report below the comment limit at a line boundary', () => {
    writeFileSync(join(tmp(), 'report.md'), `${ROW}\n`.repeat(10_000));
    const body = runGh(tmp(), COMMENT_ON_PR).calls[1]!.files.body!;
    expect(body.length).toBeLessThan(65_536);
    expect(body).toContain('Report truncated');
    expect(onlyWholeRows(body)).toBe(true);
  });
});

describe('action.yml check run with a fake gh', () => {
  const tmp = useTmpDir('iw-action-gh-', setupFakeGh);

  it('creates a check run that succeeds when the gate passes', () => {
    const pass = runGh(tmp(), { IW_IN_CHECK: 'true', IW_GATE: 'pass' });
    const args = pass.calls[0]!.args;
    expect(args.slice(0, 2)).toEqual(['api', `repos/${REPO}/check-runs`]);
    for (const f of [`name=INDX Watch (${RELEASE})`, `head_sha=${HEAD_SHA}`, 'conclusion=success'])
      expect(args).toContain(f);
    expect(pass.calls[0]!.files['output[summary]']).toContain(`✅ INDX Watch (${RELEASE}): gate passed`);
  });

  it('concludes failure when the gate fails', () => {
    expect(runGh(tmp(), { IW_IN_CHECK: 'true' }).calls[0]!.args).toContain('conclusion=failure');
  });

  it('only warns on API errors', () => {
    const denied = runGh(tmp(), { ...COMMENT_ON_PR, IW_IN_CHECK: 'true', FAKE_GH_FAIL: '1' });
    expect(denied.res.status).toBe(0);
    expect(denied.res.stdout).toContain('::warning::indx-watch could not comment on the PR');
    expect(denied.res.stdout).toContain('::warning::indx-watch could not create the check run');
  });
});

const ROOT = resolve(import.meta.dirname, '../../..');

/** examples/shop (bundle without runs/cache, plus the sample store) in `tmp/work`, and cli: local running the CLI source through tsx. */
function setupShopWithRealCli(tmp: string) {
  cpSync(join(ROOT, 'examples/shop/.indx-watch'), join(tmp, 'work/.indx-watch'), {
    recursive: true,
    filter: (s) => !/[/\\](runs|cache)([/\\]|$)/.test(s),
  });
  cpSync(join(ROOT, 'examples/shop/store'), join(tmp, 'work/store'), { recursive: true });
  mkdirSync(join(tmp, 'action/packages/cli/dist'), { recursive: true });
  const tsx = [join(ROOT, 'node_modules/tsx/dist/cli.mjs'), join(ROOT, 'packages/cli/src/bin.ts')];
  writeFileSync(
    join(tmp, 'action/packages/cli/dist/bin.js'),
    `const r = require('node:child_process').spawnSync(process.execPath, [...${JSON.stringify(tsx)}, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
`,
  );
  mkdirSync(join(tmp, 'runner'));
  writeFileSync(join(tmp, 'output'), '');
}

describe('action.yml with the real CLI on examples/shop', () => {
  const tmp = useTmpDir('iw-action-gate-', setupShopWithRealCli);

  it('gate: true fails the action when a P0 test case fails (TC-8 in the sample store)', () => {
    const opts = {
      cwd: join(tmp(), 'work'),
      env: {
        PATH: process.env.PATH,
        HOME: tmp(),
        IW_ACTOR: 'ci@shop.test',
        GITHUB_OUTPUT: join(tmp(), 'output'),
        RUNNER_TEMP: join(tmp(), 'runner'),
        IW_ACTION_PATH: join(tmp(), 'action'),
        IW_IN_CLI: 'local',
        IW_IN_SUMMARY: 'false',
        IW_IN_RELEASE: RELEASE,
      },
    };
    const main = bash(mainScript(), opts);
    expect(main.status, main.stdout + main.stderr).toBe(0);
    expect(readOutputs(join(tmp(), 'output'))).toMatchObject({ gate: 'fail', fail: '1' });
    const gate = bash(mainScript('readiness gate failed'), opts);
    expect(gate.status).toBe(1);
    expect(gate.stdout).toContain('::error::INDX Watch readiness gate failed');
  }, 60_000);
});
