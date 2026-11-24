/** Staying current (T-503 to T-505): iw doctor and iw update on a temp copy of examples/shop. */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeReleaseSource } from '@indx-watch/store';
import { describe, expect, it } from 'vitest';
import { releasesFromChangelog } from '../scripts/releases.mjs';
import { changelogNotes, inspect, releasesAfter, workflowPins } from '../src/upkeep.js';
import { iwJson, shop } from './helpers.js';

const VERSION = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')).version;
const put = (dir: string, path: string, text: string) => {
  mkdirSync(join(dir, path, '..'), { recursive: true });
  writeFileSync(join(dir, path), text);
};
const read = (dir: string, path: string) => readFileSync(join(dir, path), 'utf8');
/** Every file under `dir` with its text, to compare before and after a run. */
const tree = (dir: string): Record<string, string> =>
  Object.fromEntries(
    readdirSync(dir, { recursive: true })
      .map(String)
      .filter((f) => statSync(join(dir, f)).isFile() && !/^(store|\.indx-watch\/(runs|cache))\//.test(f))
      .map((f) => [f, read(dir, f)]),
  );
const doctor = (dir: string) => iwJson(dir, 'doctor', ['doctor']).json.data;
const states = (data: { parts: { part: string; target: string; state: string }[] }) =>
  Object.fromEntries(data.parts.map((p) => [`${p.part}:${p.target}`, p.state]));

/** A shop project with the agent files, a package.json and a workflow, all pinned to an old version. */
function oldProject(version = '0.0.1', pin = version) {
  const dir = shop();
  iwJson(dir, 'skills install', ['skills', 'install']);
  put(
    dir,
    'package.json',
    `{\n  "name": "app",\n  "devDependencies": {\n    "indx-watch": "^${version}"\n  }\n}\n`,
  );
  put(dir, 'pnpm-lock.yaml', 'lockfileVersion: 9\n');
  put(
    dir,
    '.github/workflows/indx-watch.yml',
    `jobs:\n  qa:\n    steps:\n      - uses: INDXDev/indx-watch@v0\n        with:\n          version: "${version}"\n          gate: true\n      - run: npx --yes indx-watch@${version} status\n`,
  );
  put(
    dir,
    '.indx-watch/project.toml',
    read(dir, '.indx-watch/project.toml').replace('[store]', `[tool]\nindx_watch = "${pin}"\n\n[store]`),
  );
  put(
    dir,
    '.mcp.json',
    JSON.stringify({
      mcpServers: { 'indx-watch': { command: 'npx', args: ['-y', `indx-watch@${version}`, 'mcp'] } },
    }),
  );
  return dir;
}

describe('iw doctor', () => {
  it('reports an untouched project as unpinned, without any network call', () => {
    const dir = shop();
    iwJson(dir, 'skills install', ['skills', 'install']);
    const d = doctor(dir);
    expect(d).toMatchObject({ version: VERSION, pinned: null, latest: null, ok: false });
    expect(states(d)).toMatchObject({
      'tool:project.toml': 'unpinned',
      'cli:running': 'ok',
      'mcp:.mcp.json': 'ok',
    });
    expect(states(d)['skills:.claude/skills']).toBe('ok');
  });

  it('finds each outdated, unpinned and edited part, and changes nothing', () => {
    const dir = oldProject('0.0.1', VERSION); // everything at 0.0.1 but the pin
    put(dir, '.claude/skills/iw-test/SKILL.md', 'edited by hand');
    const before = tree(dir);
    const d = doctor(dir);
    expect(states(d)).toMatchObject({
      'tool:project.toml': 'ok',
      'cli:running': 'ok',
      'package:package.json': 'outdated',
      'mcp:.mcp.json': 'outdated',
      'skills:.claude/skills': 'locally-edited',
      'workflow:.github/workflows/indx-watch.yml': 'outdated',
    });
    expect(d.ok).toBe(false);
    expect(tree(dir)).toEqual(before);
  });

  it('an unpinned .mcp.json entry is unpinned', () => {
    const dir = oldProject(VERSION);
    put(
      dir,
      '.mcp.json',
      JSON.stringify({ mcpServers: { 'indx-watch': { command: 'npx', args: ['-y', 'indx-watch', 'mcp'] } } }),
    );
    expect(states(doctor(dir))['mcp:.mcp.json']).toBe('unpinned');
  });
});

describe('inspect (the engine of iw doctor)', () => {
  it('offline it asks nobody; online it reads the newest release and the hosted /healthz', async () => {
    const dir = oldProject(VERSION);
    const root = {
      root: dir,
      dir: join(dir, '.indx-watch'),
      pin: VERSION,
      hosted: 'https://iw.example.test',
    };
    expect((await inspect(root)).latest).toBeNull();
    const asked: string[] = [];
    const get = (async (url: URL) => {
      asked.push(String(url));
      return Response.json({ ok: true, version: '0.0.9' });
    }) as unknown as typeof fetch;
    const r = await inspect({ ...root, online: { source: fakeReleaseSource('9.0.0'), get } });
    expect(asked).toEqual(['https://iw.example.test/healthz']);
    expect(r.latest).toBe('9.0.0');
    expect(states({ parts: r.parts })).toMatchObject({
      'tool:project.toml': 'outdated',
      'worker:https://iw.example.test': 'outdated',
    });
  });

  it('an unreachable registry or app is a warning, not an error', async () => {
    const root = { root: oldProject(), dir: '', pin: '0.0.1', hosted: 'https://iw.example.test' };
    const get = (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    const r = await inspect({ ...root, online: { source: fakeReleaseSource(), get } });
    expect(r.warnings).toHaveLength(2);
    expect(r.parts.some((p) => p.part === 'worker')).toBe(false);
  });
});

describe('workflowPins', () => {
  it('reads version inputs of INDX Watch steps and indx-watch@x.y.z commands, nothing else', () => {
    const text = [
      'steps:',
      '  - uses: actions/setup-node@v6',
      '    with:',
      '      version: 1.2.3', // not ours
      '  - name: qa',
      '    uses: INDXDev/indx-watch@v0',
      '    with:',
      '      version: 0.1.2 # pinned',
      '  - uses: INDXDev/indx-watch@v0',
      '    with:',
      '      version: latest',
      '  - run: npx --yes indx-watch@0.1.1 sync && npx indx-watch@latest status',
    ].join('\n');
    const { pins, usesAction } = workflowPins(text);
    expect(usesAction).toBe(true);
    expect(pins.map((p) => [p.line, p.version])).toEqual([
      [7, '0.1.2'],
      [11, '0.1.1'],
    ]);
  });
});

describe('releases.json from the changelog', () => {
  const log = `# Changelog\n\n## [Unreleased]\n\n- later\n\n## [0.3.0] - 2026-12-01\n\n<!-- iw-release: schema_version=2 migrate -->\n### Breaking\n\n- the format changed\n\n## [0.2.0] - 2026-11-01\n\n### Added\n\n- a thing\n\n## [0.1.0] - 2026-10-01\n\n- first\n`;

  it('lists releases newest first, with breaking, schema_version, migrate and notes', () => {
    const { releases } = releasesFromChangelog(log);
    expect(releases.map((r: { version: string }) => r.version)).toEqual(['0.3.0', '0.2.0', '0.1.0']);
    expect(releases[0]).toMatchObject({
      breaking: true,
      schema_version: 2,
      migrate: true,
      date: '2026-12-01',
    });
    expect(releases[1]).toMatchObject({ breaking: false, schema_version: 1, migrate: false });
    expect(releases[0]?.notes).toContain('the format changed');
    expect(releases[0]?.notes).not.toContain('iw-release');
  });

  it('feeds the changelog excerpt of an update', () => {
    const { releases } = releasesFromChangelog(log);
    expect(releasesAfter(releases, '0.1.0', '0.2.0').map((r) => r.version)).toEqual(['0.2.0']);
    expect(changelogNotes(releases, '0.1.0', '0.3.0')).toMatch(
      /^## 0\.3\.0 - 2026-12-01[\s\S]*## 0\.2\.0 - 2026-11-01/,
    );
    expect(changelogNotes(releases, undefined, '0.2.0')).toContain('a thing');
  });
});

describe('iw update', () => {
  it('moves every pinned part to the target, prints the install command, and a second run changes nothing', () => {
    const dir = oldProject();
    put(
      dir,
      '.mcp.json',
      JSON.stringify({ mcpServers: { 'indx-watch': { command: 'npx', args: ['-y', 'indx-watch', 'mcp'] } } }),
    );
    const r = iwJson(dir, 'update', ['update']);
    expect(r.code, r.stderr).toBe(0);
    const { data } = r.json;
    expect(data).toMatchObject({ from: '0.0.1', to: VERSION, dryRun: false, install: 'pnpm install' });
    const changed = (s: string) => data.steps.find((x: { step: string }) => x.step === s).changed;
    expect(changed('tool')).toEqual(['.indx-watch/project.toml']);
    expect(changed('package')).toEqual(['package.json']);
    expect(changed('workflow')).toEqual(['.github/workflows/indx-watch.yml']);
    expect(changed('schema').length).toBeGreaterThan(5);
    expect(read(dir, '.indx-watch/project.toml')).toContain(`indx_watch = "${VERSION}"`);
    expect(read(dir, '.indx-watch/project.toml').split('\n')[0]).toBe(
      `#:schema https://raw.githubusercontent.com/INDXDev/indx-watch/v${VERSION}/schemas/v1/project.json`,
    );
    expect(JSON.parse(read(dir, 'package.json')).devDependencies['indx-watch']).toBe(`^${VERSION}`);
    expect(read(dir, '.github/workflows/indx-watch.yml')).toContain(`version: "${VERSION}"`);
    expect(read(dir, '.github/workflows/indx-watch.yml')).toContain(`indx-watch@${VERSION} status`);
    expect(JSON.parse(read(dir, '.mcp.json')).mcpServers['indx-watch'].args).toEqual([
      '-y',
      `indx-watch@${VERSION}`,
      'mcp',
    ]);
    const d = doctor(dir);
    expect(d.ok, JSON.stringify(d.parts)).toBe(true);

    const after = tree(dir);
    const again = iwJson(dir, 'update', ['update']).json.data;
    expect(again.steps.flatMap((s: { changed: string[] }) => s.changed)).toEqual([]);
    expect(again.install).toBeNull();
    expect(tree(dir)).toEqual(after);
    // iw check accepts files that name a version tag in their #:schema line, and a new file takes that tag
    expect(iwJson(dir, 'check', ['check']).json.data.errors).toBe(0);
    iwJson(dir, 'new', ['new', 'uc', '--title', 'Extra', '--ac', 'It works']);
    const added = readdirSync(join(dir, '.indx-watch/specs'), { recursive: true })
      .map(String)
      .filter((f) => /UC-\d+-extra/.test(f) && f.endsWith('use-case.toml'));
    expect(read(dir, `.indx-watch/specs/${added[0]}`)).toContain(`/INDXDev/indx-watch/v${VERSION}/schemas/`);
  });

  it('--dry-run reports the same changes and writes nothing', () => {
    const dir = oldProject();
    const before = tree(dir);
    const r = iwJson(dir, 'update', ['update', '--dry-run']);
    expect(r.json.data.dryRun).toBe(true);
    expect(r.json.data.steps.find((s: { step: string }) => s.step === 'package').changed).toEqual([
      'package.json',
    ]);
    expect(tree(dir)).toEqual(before);
  });

  it('--to another version moves the pins but leaves the skill copies, which ship in the running package', () => {
    const dir = oldProject();
    const r = iwJson(dir, 'update', ['update', '--to', '9.9.9']);
    const skills = r.json.data.steps.find((s: { step: string }) => s.step === 'skills');
    expect(skills.changed).toEqual([]);
    expect(skills.note).toContain('npx indx-watch@9.9.9 skills install');
    expect(read(dir, '.indx-watch/project.toml')).toContain('indx_watch = "9.9.9"');
    expect(iwJson(dir, 'update', ['update', '--to', '9.9.9', '--deploy']).json.error.code).toBe('USAGE');
    expect(iwJson(dir, 'update', ['update', '--to', 'next']).json.error.code).toBe('USAGE');
  });

  it('skips a skill copy edited by hand, with a warning, and keeps going', () => {
    const dir = oldProject(VERSION);
    put(dir, '.claude/skills/iw-test/SKILL.md', 'mine');
    const r = iwJson(dir, 'update', ['update']);
    expect(r.code).toBe(0);
    expect(r.json.warnings.map((w: { code: string }) => w.code)).toContain('agent-config');
    expect(read(dir, '.claude/skills/iw-test/SKILL.md')).toBe('mine');
    const skills = r.json.data.steps.find((s: { step: string }) => s.step === 'skills');
    expect(skills.note).toContain('.claude/skills/iw-test');
    expect(states(doctor(dir))['skills:.claude/skills']).toBe('locally-edited');
  });

  it('runs iw migrate when a release since the old pin says so, and says so in a dry run', () => {
    const dir = oldProject();
    const releases = join(mkdtempSync(join(tmpdir(), 'iw-rel-')), 'releases.json');
    const release = {
      version: VERSION,
      breaking: false,
      schema_version: 1,
      migrate: true,
      notes: '- moved a thing',
    };
    writeFileSync(releases, JSON.stringify({ releases: [release] }));
    const r = iwJson(dir, 'update', ['update', '--dry-run'], { env: { IW_RELEASES: releases } });
    expect(r.json.data.steps.find((s: { step: string }) => s.step === 'migrate').note).toBe(
      'would run iw migrate',
    );
    expect(r.json.data.notes).toContain('- moved a thing');
  });

  it('exits 1 with the data when iw check finds errors after the update', () => {
    const dir = oldProject();
    put(dir, '.indx-watch/environments/staging.toml', 'not = [valid');
    const r = iwJson(dir, 'update', ['update']);
    expect(r.code).toBe(1);
    expect(r.json.error.code).toBe('CHECK_FAILED');
    expect(read(dir, '.indx-watch/project.toml')).toContain(`indx_watch = "${VERSION}"`); // written before the check
  });

  it('--workflow writes the weekly update workflow once, and never overwrites one', () => {
    const dir = shop();
    const r = iwJson(dir, 'update', ['update', '--workflow']);
    expect(r.json.data.steps).toEqual([
      { step: 'workflow', changed: ['.github/workflows/indx-watch-update.yml'] },
    ]);
    const yml = read(dir, '.github/workflows/indx-watch-update.yml');
    expect(yml).toMatch(/^on:\n {2}schedule:\n {4}- cron: "\d+ \d+ \* \* 1"/m);
    expect(yml).toContain('workflow_dispatch:');
    expect(yml).toContain('pull-requests: write');
    expect(yml).toContain('npx --yes indx-watch@latest update --json');
    expect(yml).toContain('gh pr create');
    put(dir, '.github/workflows/indx-watch-update.yml', 'mine');
    const again = iwJson(dir, 'update', ['update', '--workflow']).json.data.steps[0];
    expect(again.changed).toEqual([]);
    expect(read(dir, '.github/workflows/indx-watch-update.yml')).toBe('mine');
    // the update workflow runs @latest on purpose: doctor does not count it as an unpinned part
    put(dir, '.github/workflows/indx-watch-update.yml', yml);
    expect(
      doctor(dir).parts.some((p: { target: string }) => p.target.endsWith('indx-watch-update.yml')),
    ).toBe(false);
  });
});

describe('iw init and iw deploy pin the version', () => {
  it('iw init writes [tool] and a pinned .mcp.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'iw-init-'));
    iwJson(dir, 'init', ['init']);
    expect(read(dir, '.indx-watch/project.toml')).toContain(`[tool]\nindx_watch = "${VERSION}"`);
    expect(JSON.parse(read(dir, '.mcp.json')).mcpServers['indx-watch'].args[1]).toBe(`indx-watch@${VERSION}`);
    expect(iwJson(dir, 'check', ['check']).json.data.errors).toBe(0);
  });
});
