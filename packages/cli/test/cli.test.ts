/** One integration test per command on a temp copy of examples/shop, plus docs/spec/cli.md acceptance criteria. */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseToml, sha256Hex } from '@indx-watch/bundle';
import { renderReport } from '@indx-watch/server';
import { describe, expect, it } from 'vitest';
import { cleanEnv, fakeBin, iw, iwJson, shop, TSX } from './helpers.js';

const TC3 = 'specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-3-valid-coupon.toml';
const read = (dir: string, f: string) => readFileSync(join(dir, '.indx-watch', f), 'utf8');
const records = (dir: string) => {
  const root = join(dir, '.indx-watch/runs/records');
  return existsSync(root)
    ? readdirSync(root, { recursive: true }).filter((f) => String(f).endsWith('.json'))
    : [];
};
/** renderReport / startNodeServer are implemented in packages/server (T-107) in parallel. */
const serverReady = await renderReport({} as never, { format: 'md', locale: 'en', evidence: 'none' }).then(
  () => true,
  (e: Error) => !/not implemented/.test(e.message),
);

describe('acceptance criteria (docs/spec/cli.md)', () => {
  it('init → new uc → new tc → check exits 0 in an empty directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'iw-init-'));
    const init = iwJson(dir, 'init', ['init']);
    expect(init.json.data.files).toContain('specs/FEAT-1-general/feature.toml');
    expect(read(dir, 'project.toml')).toContain('current_release = "v0.1.0"');
    expect(read(dir, 'environments/local.toml')).toContain('base_url = "http://localhost:3000"');
    expect(read(dir, '.gitignore')).toBe('cache/\nruns/\n');
    const uc = iwJson(dir, 'new', [
      'new',
      'uc',
      '--title',
      'Sign up',
      '--ac',
      'A confirmation email is sent',
      '--ready',
    ]);
    expect(uc.json.data.key).toBe('UC-1');
    const tc = ['new', 'tc', '--uc', 'UC-1', '--title', 'x', '--step', 'Sign up => Email arrives', '--ready'];
    expect(iwJson(dir, 'new', tc).json.data.key).toBe('TC-1');
    expect(iwJson(dir, 'check', ['check']).code).toBe(0);
  });

  it('new tc --origin ai creates a draft with an [ai] table that passes check', () => {
    const dir = shop();
    const r = iwJson(dir, 'new', [
      'new',
      'tc',
      '--uc',
      'UC-2',
      '--title',
      'x',
      '--origin',
      'ai',
      '--model',
      'm',
    ]);
    const toml = parseToml(read(dir, r.json.data.file));
    expect(toml).toMatchObject({ status: 'draft', origin: 'ai', ai: { model: 'm' } });
    expect(iw(dir, ['check']).code).toBe(0);
  });

  it('exit codes: valid 0, invalid 1, unknown flag 2, missing bundle 3, unreachable store 4', () => {
    const dir = shop();
    expect(iw(dir, ['check']).code).toBe(0);
    expect(iwJson(dir, 'check', ['check', '--bogus']).code).toBe(2);
    expect(iwJson(tmpdir(), 'check', ['check']).json.error.code).toBe('NO_BUNDLE');
    expect(iw(tmpdir(), ['check']).code).toBe(3);
    const s3 = iwJson(dir, 'sync', ['sync', '--store', 'https://127.0.0.1:9/']);
    expect([s3.code, s3.json.error.code]).toEqual([4, 'STORE_ERROR']);
    writeFileSync(join(dir, '.indx-watch', TC3), `${read(dir, TC3)}expectd = "x"\n`);
    const bad = iwJson(dir, 'check', ['check']);
    expect([bad.code, bad.json.error.code]).toEqual([1, 'CHECK_FAILED']);
    expect(bad.json.error.details).toContainEqual(
      expect.objectContaining({ code: 'unknown-key', file: TC3 }),
    );
  });

  it('approve with IW_ACTOR_KIND=agent exits 2', () => {
    const r = iwJson(shop(), 'approve', ['approve', 'TC-9'], { env: { IW_ACTOR_KIND: 'agent' } });
    expect([r.code, r.json.error.code]).toEqual([2, 'USAGE']);
  });

  it('record --evidence writes one record and stores the blob under its SHA-256', async () => {
    const dir = shop();
    writeFileSync(join(dir, 'shot.png'), 'not really a png');
    const r = iwJson(dir, 'record', ['record', 'TC-3', '--verdict', 'pass', '--evidence', 'shot.png']);
    const sha = await sha256Hex('not really a png');
    expect(r.json.data).toMatchObject({ verdict: 'pass', rule: 1 });
    expect(r.json.data.run.evidence[0]).toMatchObject({
      sha256: sha,
      kind: 'screenshot',
      media_type: 'image/png',
    });
    expect(records(dir)).toHaveLength(1);
    expect(existsSync(join(dir, '.indx-watch/runs/blobs/sha256', sha.slice(0, 2), sha))).toBe(true);
  });

  it('never prompts without a TTY: a missing --title is a usage error', () => {
    const r = iwJson(shop(), 'new', ['new', 'tc', '--uc', 'UC-2']);
    expect([r.code, r.json.error.code]).toEqual([2, 'USAGE']);
  });
});

describe('agent skills (docs/spec/agents.md): the worked examples on examples/shop UC-5', () => {
  it('write-test-cases + manage-fixtures produce drafts with origin "ai" that pass check', () => {
    const dir = shop();
    const env = { IW_ACTOR_KIND: 'agent', IW_AGENT_MODEL: 'claude-opus-5-5' };
    const ai = ['--origin', 'ai', '--model', 'claude-opus-5-5'];
    const uc5 = iwJson(dir, 'show', ['show', 'UC-5'], { env }).json.data;
    expect(uc5.criteria[0]).toMatchObject({ key: 'AC-5.1', draftTestCases: ['TC-9'] });
    const text =
      'A file that is not a PNG or JPEG shows "Photos must be PNG or JPEG" and no review is added.';
    const ac = iwJson(
      dir,
      'new',
      ['new', 'ac', '--uc', 'UC-5', '--text', text, ...ai, '--skill', 'write-test-cases'],
      { env },
    );
    expect(ac.json.data.key).toBe('AC-5.2');
    const fxArgs = ['new', 'fixture', '--kind', 'file', '--title', 'Text file that is not an image', ...ai];
    expect(iwJson(dir, 'new', [...fxArgs, '--skill', 'manage-fixtures'], { env }).json.data.key).toBe('FX-5');
    writeFileSync(join(dir, 'not-an-image.txt'), 'This is not a photo.\n');
    const add = iwJson(dir, 'fixture add', ['fixture', 'add', 'not-an-image.txt', '--to', 'FX-5'], { env });
    expect(add.json.data.files[0]).toMatchObject({ name: 'not-an-image.txt', pointer: false });
    const steps = [
      {
        instruction: 'Sign in with {{FX-3.username}} and open "Canvas Tote".',
        expected: 'The product page shows a "Write a review" form.',
      },
      {
        instruction: 'Attach the file from FX-5 and press "Post review".',
        expected: 'The message "Photos must be PNG or JPEG" appears.',
        evidence: ['screenshot'],
      },
    ];
    const input = JSON.stringify({
      tags: ['reviews'],
      fixtures: [{ ref: 'FX-3' }, { ref: 'FX-5' }],
      steps,
      judges: [{ kind: 'human' }],
    });
    const tcArgs = [
      'new',
      'tc',
      '--uc',
      'UC-5',
      '--title',
      'A non-image file is rejected',
      '--covers',
      'AC-5.2',
      '--mode',
      'manual',
    ];
    const tc = iwJson(dir, 'new', [...tcArgs, ...ai, '--skill', 'write-test-cases', '--from', '-'], {
      env,
      input,
    });
    expect(tc.json.data.key).toBe('TC-10');
    expect(parseToml(read(dir, tc.json.data.file))).toMatchObject({
      status: 'draft',
      origin: 'ai',
      ai: { skill: 'write-test-cases' },
    });
    expect(iwJson(dir, 'check', ['check'], { env }).json.data.errors).toBe(0);
    const run = iwJson(
      dir,
      'record',
      ['record', 'TC-10', '--verdict', 'pass', '--confidence', '0.9', '--step', '1=pass'],
      { env },
    );
    expect(run.json.data).toMatchObject({ verdict: 'pass', rule: 8 });
  });
});

describe('commands', () => {
  it('init --example copies the shop bundle; init refuses an existing bundle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'iw-ex-'));
    iwJson(dir, 'init', ['init', '--example']);
    expect(read(dir, 'project.toml')).toContain('key = "SHOP"');
    expect(iwJson(dir, 'init', ['init']).json.error.code).toBe('CONFLICT');
  });

  it('check --fix and fmt rewrite non-canonical files; --strict fails on warnings', () => {
    const dir = shop();
    writeFileSync(join(dir, '.indx-watch', TC3), `\n\n${read(dir, TC3)}`);
    expect(iwJson(dir, 'check', ['check', '--strict']).code).toBe(1);
    expect(iwJson(dir, 'fmt', ['fmt']).json.data.changed).toEqual([TC3]);
    expect(iwJson(dir, 'check', ['check', '--fix']).json.data.changed).toEqual([]);
  });

  it('new: ac, fixture --from -, tc --from file, template, --ready refused for agents', () => {
    const dir = shop();
    const ac = iwJson(dir, 'new', [
      'new',
      'ac',
      '--uc',
      'UC-5',
      '--text',
      'Shows "Photos must be PNG or JPEG"',
      '--origin',
      'ai',
      '--model',
      'm',
    ]);
    expect(ac.json.data.key).toBe('AC-5.2');
    const fx = iwJson(
      dir,
      'new',
      ['new', 'fixture', '--kind', 'dataset', '--title', 'Codes', '--from', '-'],
      {
        input: '{ "row_key": "code" }',
      },
    );
    expect(parseToml(read(dir, fx.json.data.file))).toMatchObject({ kind: 'dataset', row_key: 'code' });
    writeFileSync(join(dir, 'codes.csv'), 'code,percent\nSPRING5,5\n');
    expect(iwJson(dir, 'fixture add', ['fixture', 'add', 'codes.csv', '--to', fx.json.data.key]).code).toBe(
      0,
    );
    writeFileSync(
      join(dir, 'tc.toml'),
      'tags = ["reviews"]\n[[steps]]\ninstruction = "Open it"\nexpected = "It opens"\n',
    );
    const tc = iwJson(dir, 'new', [
      'new',
      'tc',
      '--uc',
      'UC-5',
      '--title',
      'Rejects text',
      '--covers',
      'AC-5.2',
      '--from',
      'tc.toml',
    ]);
    expect(parseToml(read(dir, tc.json.data.file))).toMatchObject({ covers: ['AC-5.2'], tags: ['reviews'] });
    expect(
      iwJson(dir, 'new', ['new', 'tc', '--uc', 'UC-2', '--title', 'web', '--template', 'web']).code,
    ).toBe(0);
    const agent = { IW_ACTOR_KIND: 'agent' };
    expect(iw(dir, ['new', 'uc', '--title', 'y', '--ac', 'z', '--ready'], { env: agent }).code).toBe(2);
    expect(iw(dir, ['check']).code).toBe(0);
  });

  it('approve sets ready, approved_by and approved_version', () => {
    const dir = shop();
    const r = iwJson(dir, 'approve', ['approve', 'TC-9']);
    expect(r.json.data).toMatchObject({ ref: 'TC-9', approved_by: 'qa@shop.test' });
    expect(read(dir, r.json.data.file)).toContain(`approved_version = "${r.json.data.version}"`);
  });

  it('status and status --gate', () => {
    const dir = shop();
    const s = iwJson(dir, 'status', ['status']);
    expect(s.json.data.scope).toEqual({ release: 'v1.2.0', environment: null });
    expect(s.json.data.counts.uncovered).toBe(1);
    const g = iwJson(dir, 'status', ['status', '--gate', '--env', 'staging']);
    expect([g.code, g.json.error.code, g.json.data.scope.environment]).toEqual([1, 'GATE_FAILED', 'staging']);
  });

  it('show: use case, test case, fixture, plan, environment and a run by prefix', () => {
    const dir = shop();
    expect(iwJson(dir, 'show', ['show', 'UC-2']).json.data.criteria[0]).toMatchObject({
      key: 'AC-2.1',
      testCases: ['TC-3'],
    });
    expect(iwJson(dir, 'show', ['show', 'SHOP:TC-3']).json.data).toMatchObject({
      key: 'TC-3',
      priority: 'P0',
    });
    expect(iwJson(dir, 'show', ['show', 'FX-1']).json.data.usedBy).toContain('TC-3');
    expect(iwJson(dir, 'show', ['show', 'PLAN-1']).json.data.items[0].status).toBe('todo');
    expect(iwJson(dir, 'show', ['show', 'staging']).json.data.base_url).toBe('http://localhost:4173');
    const id = iwJson(dir, 'record', ['record', 'TC-4', '--verdict', 'fail']).json.data.run.id as string;
    const run = iwJson(dir, 'show', ['show', id.slice(0, 12)]).json.data;
    expect([run.id, run.decision.verdict]).toEqual([id, 'fail']);
    expect(iwJson(dir, 'show', ['show', 'TC-99']).code).toBe(2);
  });

  it('list with filters', () => {
    const dir = shop();
    const tcs = iwJson(dir, 'list', ['list', 'tcs', '--uc', 'UC-2']).json.data.items;
    expect(tcs.map((t: { key: string }) => t.key)).toEqual(['TC-3', 'TC-4']);
    expect(
      iwJson(dir, 'list', ['list', 'fixtures', '--status', 'ready']).json.data.items.length,
    ).toBeGreaterThan(0);
    for (const k of ['features', 'ucs', 'envs', 'releases', 'plans'])
      expect(iwJson(dir, 'list', ['list', k]).code).toBe(0);
    iwJson(dir, 'record', ['record', 'TC-1', '--verdict', 'pass']);
    expect(
      iwJson(dir, 'list', ['list', 'runs', '--tc', 'TC-1', '--limit', '5']).json.data.items,
    ).toHaveLength(1);
    expect(iw(dir, ['list', 'nope']).code).toBe(2);
  });

  it('record as an agent: an llm judgement whose confidence decides', () => {
    const dir = shop();
    const env = { IW_ACTOR_KIND: 'agent', IW_AGENT_MODEL: 'm' };
    const args = [
      'record',
      'TC-9',
      '--verdict',
      'pass',
      '--step',
      '1=pass',
      '--step',
      '2=pass:Thumbnail shown',
    ];
    const low = iwJson(dir, 'record', [...args, '--confidence', '0.6'], { env });
    expect(low.json.data).toMatchObject({ verdict: 'needs_review', rule: 6 });
    expect(low.json.data.run.judgements[0]).toMatchObject({ kind: 'llm', confidence: 0.6 });
    expect(low.json.data.run.steps[1]).toMatchObject({ index: 2, note: 'Thumbnail shown' });
    expect(low.json.warnings.map((w: { code: string }) => w.code)).toContain('no-evidence');
    const ci = iwJson(dir, 'record', ['record', 'TC-1', '--verdict', 'blocked'], {
      env: { IW_ACTOR_KIND: 'ci' },
    });
    expect(ci.json.data).toMatchObject({ verdict: 'blocked', rule: 2 });
  });

  it('review appends a human judgement; agents are refused', () => {
    const dir = shop();
    const env = { IW_ACTOR_KIND: 'agent', IW_AGENT_MODEL: 'm' };
    const id = iwJson(dir, 'record', ['record', 'TC-9', '--verdict', 'pass', '--confidence', '0.5'], { env })
      .json.data.run.id;
    expect(iw(dir, ['review', id, '--verdict', 'pass', '--reason', 'ok'], { env }).code).toBe(2);
    const r = iwJson(dir, 'review', ['review', id, '--verdict', 'fail', '--reason', 'Thumbnail missing']);
    expect(r.json.data).toMatchObject({
      verdict: 'fail',
      judgement: { kind: 'human', reason: 'Thumbnail missing' },
    });
  });

  it('waive: refuses P0 and agents; --revoke cancels', () => {
    const dir = shop();
    expect(iwJson(dir, 'waive', ['waive', 'TC-3', '--release', 'v1.2.0', '--reason', 'x']).code).toBe(2);
    expect(
      iw(dir, ['waive', 'TC-1', '--release', 'v1.2.0', '--reason', 'x'], { env: { IW_ACTOR_KIND: 'agent' } })
        .code,
    ).toBe(2);
    const w = iwJson(dir, 'waive', ['waive', 'TC-1', '--release', 'v1.2.0', '--reason', 'Known']).json.data
      .waiver;
    expect(w).toMatchObject({ kind: 'waiver', release: 'v1.2.0', test_case: { key: 'TC-1' } });
    expect(iwJson(dir, 'waive', ['waive', '--revoke', w.id]).json.data.waiver.revokes).toBe(w.id);
  });

  it('retract hides a run', () => {
    const dir = shop();
    const id = iwJson(dir, 'record', ['record', 'TC-1', '--verdict', 'fail']).json.data.run.id;
    expect(
      iwJson(dir, 'retract', ['retract', id, '--reason', 'wrong release']).json.data.retraction.target,
    ).toBe(id);
    expect(iwJson(dir, 'show', ['show', id]).json.data.retracted).toBe(true);
    expect(iw(dir, ['retract', 'rec_01JF3Q8M5X2V7K9D4R6T1W0Y00', '--reason', 'x']).code).toBe(2);
  });

  it('deployment add records a deployment', () => {
    const r = iwJson(shop(), 'deployment add', [
      'deployment',
      'add',
      '--env',
      'staging',
      '--commit',
      'a1b2c3d',
      '--url',
      'https://shop.test',
    ]);
    expect(r.json.data.deployment).toMatchObject({
      kind: 'deployment',
      environment: 'staging',
      build: { commit: 'a1b2c3d' },
    });
  });

  it('fixture add (inline, pointer, secret scan) and fixture fetch', async () => {
    const dir = shop();
    writeFileSync(join(dir, 'note.txt'), 'This is not a photo.\n');
    const add = iwJson(dir, 'fixture add', ['fixture', 'add', 'note.txt', '--to', 'FX-4']);
    expect(add.json.data.files[0]).toMatchObject({ name: 'note.txt', pointer: false });
    expect(read(dir, 'fixtures/FX-4-review-photo/fixture.toml')).toContain('"note.txt"');
    const blob = iwJson(dir, 'fixture add', ['fixture', 'add', 'note.txt', '--to', 'FX-4', '--blob']);
    expect(blob.json.data.files[0]).toMatchObject({
      pointer: true,
      sha256: await sha256Hex('This is not a photo.\n'),
    });
    writeFileSync(join(dir, 'key.txt'), 'AKIAABCDEFGHIJKLMNOP\n');
    const secret = iwJson(dir, 'fixture add', ['fixture', 'add', 'key.txt', '--to', 'FX-4']);
    expect([secret.code, secret.json.error.code]).toEqual([1, 'SECRETS_FOUND']);
    const fetch = iwJson(dir, 'fixture fetch', ['fixture', 'fetch', 'FX-4']);
    const photo = fetch.json.data.files.find((f: { name: string }) => f.name === 'review-photo.png');
    expect(existsSync(join(dir, '.indx-watch/cache/blobs', photo.sha256))).toBe(true);
    expect(iw(dir, ['check']).code).toBe(0);
  });

  it('sync pushes records to the folder store and pulls them into another replica', () => {
    const dir = shop();
    const rec = iwJson(dir, 'record', ['record', 'TC-1', '--verdict', 'pass']);
    const r = iwJson(dir, 'sync', ['sync', '--push-only']);
    expect(r.json.data.pushed.records).toBe(1);
    const other = shop();
    const pulled = iwJson(other, 'sync', ['sync', '--store', `file://${join(dir, 'store')}`, '--pull-only']);
    // the sample store also holds the committed sample results
    expect(pulled.json.data.pulled.records).toBeGreaterThanOrEqual(1);
    const runs = iwJson(other, 'list', ['list', 'runs']).json.data.items as { id: string }[];
    expect(runs.some((x) => x.id === rec.json.data.run.id)).toBe(true);
    writeFileSync(
      join(dir, '.indx-watch/environments/staging.toml'),
      `${read(dir, 'environments/staging.toml')}notes = "ghp_${'a'.repeat(36)}"\n`,
    );
    expect(iwJson(dir, 'sync', ['sync']).json.error.code).toBe('SECRETS_FOUND');
  });

  it('report --format json with IW_NOW/IW_ACTOR; md when the server package renders', () => {
    const dir = shop();
    const env = { IW_NOW: '2026-11-19T00:00:00Z' };
    const r = iwJson(dir, 'report', ['report', '--format', 'json', '--out', 'r.json'], { env });
    expect(r.json.data.file).toBe('r.json');
    const data = JSON.parse(readFileSync(join(dir, 'r.json'), 'utf8'));
    expect(data).toMatchObject({ generatedAt: '2026-11-19T00:00:00Z', generatedBy: 'qa@shop.test' });
    expect(data.bundleCommit).toBeUndefined();
    expect(iw(dir, ['report', '--format', 'docx']).code).toBe(2);
    if (!serverReady) return;
    const md = iw(dir, ['report'], { env });
    expect(md.code).toBe(0);
    expect(iw(dir, ['report'], { env }).stdout).toBe(md.stdout);
    expect(
      iwJson(dir, 'report', ['report', '--format', 'html', '--audience', 'customer']).json.data.file,
    ).toBe('report-v1.2.0.html');
  });

  it('export --full and import (dry run, conflicts, merge)', () => {
    const dir = shop();
    iwJson(dir, 'record', ['record', 'TC-1', '--verdict', 'pass']);
    const ex = iwJson(dir, 'export', ['export', '--full', '--out', 'shop.tar.zst']).json.data;
    expect(ex.manifest.records).toBe(1);
    expect(readFileSync(join(dir, 'shop.tar.zst')).subarray(0, 4)).toEqual(
      Buffer.from([0x28, 0xb5, 0x2f, 0xfd]),
    );
    const to = mkdtempSync(join(tmpdir(), 'iw-imp-'));
    expect(iwJson(to, 'import', ['import', join(dir, 'shop.tar.zst'), '--dry-run']).json.data.dryRun).toBe(
      true,
    );
    expect(existsSync(join(to, '.indx-watch'))).toBe(false);
    iwJson(to, 'import', ['import', join(dir, 'shop.tar.zst')]);
    expect(iw(to, ['check']).code).toBe(0);
    expect(records(to)).toHaveLength(1);
    expect(iwJson(to, 'import', ['import', join(dir, 'shop.tar.zst')]).json.error.code).toBe('CONFLICT');
    expect(iwJson(to, 'import', ['import', join(dir, 'shop.tar.zst'), '--merge', '--dry-run']).code).toBe(0);
    writeFileSync(join(to, '.indx-watch', TC3), `${read(to, TC3)}notes = "changed"\n`);
    expect(iwJson(to, 'import', ['import', join(dir, 'shop.tar.zst'), '--merge', '--dry-run']).code).toBe(1);
    expect(iw(dir, ['export']).code).toBe(2);
  });

  it('deploy --dry-run through a fake wrangler', () => {
    const bin = fakeBin({
      wrangler: 'case "$1" in --version) echo 4.165.0;; whoami) echo ok;; d1) echo "[]";; *) exit 1;; esac',
    });
    const r = iwJson(shop(), 'deploy', ['deploy', '--dry-run'], {
      env: { PATH: `${bin}:${process.env.PATH}` },
    });
    expect(r.json.data.resources.map((x: { type: string }) => x.type).sort()).toEqual(['d1', 'r2', 'worker']);
    expect(r.json.data.url).toBeNull();
  });

  it('reindex and migrate', () => {
    const dir = shop();
    expect(iwJson(dir, 'reindex', ['reindex']).json.data.definitions).toBeGreaterThan(20);
    expect(iwJson(dir, 'migrate', ['migrate']).json.data).toEqual({ from: 1, to: 1, changed: [] });
  });

  it('login wraps cloudflared', () => {
    const bin = fakeBin({ cloudflared: 'echo "logged in to $3"' });
    const env = { PATH: `${bin}:${process.env.PATH}` };
    expect(iwJson(tmpdir(), 'login', ['login', 'https://watch.example.com'], { env }).json.data.url).toBe(
      'https://watch.example.com',
    );
    const none = iwJson(tmpdir(), 'login', ['login', 'https://x.test'], { env: { PATH: '/nonexistent' } });
    expect([none.code, none.json.error.code]).toEqual([4, 'EXTERNAL_TOOL']);
  });

  it.skipIf(!serverReady)('serve --json prints the URL', async () => {
    const dir = shop();
    const child = spawn(process.execPath, [...TSX, 'serve', '--port', '0', '--json'], {
      cwd: dir,
      env: cleanEnv(),
    });
    const line = await new Promise<string>((res) => child.stdout.once('data', (d) => res(String(d))));
    child.kill();
    expect(JSON.parse(line)).toMatchObject({
      ok: true,
      command: 'serve',
      data: { url: expect.stringMatching(/^http/) },
    });
  });

  it('--help and --version', () => {
    expect(iw(tmpdir(), ['--help']).stdout).toContain('record');
    expect(iw(tmpdir(), ['new', '--help']).stdout).toContain('--step');
    expect(iw(tmpdir(), ['--version']).stdout.trim()).toBe('0.1.0');
  });
});
