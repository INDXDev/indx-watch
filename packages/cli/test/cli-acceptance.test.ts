/** docs/spec/cli.md acceptance criteria, the docs/spec/agents.md worked examples and signed records. */
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseToml, sha256Hex } from '@indx-watch/bundle';
import { describe, expect, it } from 'vitest';
import { AGENT, read, records, TC3 } from './cli-fixtures.js';
import { iw, iwJson, shop } from './helpers.js';

describe('acceptance criteria (docs/spec/cli.md): authoring', () => {
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
      'Guest applies a coupon',
      '--ac',
      'A valid coupon reduces the total',
      '--ready',
    ]);
    expect(uc.json.data.key).toBe('UC-1');
    const tc = [
      'new',
      'tc',
      '--uc',
      'UC-1',
      '--title',
      'x',
      '--step',
      'Apply SUMMER10 => Total drops by 10%',
      '--ready',
    ];
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

  it('approve with IW_ACTOR_KIND=agent exits 2', () => {
    const r = iwJson(shop(), 'approve', ['approve', 'TC-9'], { env: { IW_ACTOR_KIND: 'agent' } });
    expect([r.code, r.json.error.code]).toEqual([2, 'USAGE']);
  });

  it('never prompts without a TTY: a missing --title is a usage error', () => {
    const r = iwJson(shop(), 'new', ['new', 'tc', '--uc', 'UC-2']);
    expect([r.code, r.json.error.code]).toEqual([2, 'USAGE']);
  });
});

describe('acceptance criteria (docs/spec/cli.md): exit codes, sync and records', () => {
  it('a newer schema_version exits 3; a store of another project exits 4', () => {
    const dir = shop();
    const project = join(dir, '.indx-watch/project.toml');
    const toml = readFileSync(project, 'utf8');
    writeFileSync(project, toml.replace('schema_version = 1', 'schema_version = 2'));
    const newer = iwJson(dir, 'check', ['check']);
    expect(newer.code).toBe(3);
    expect(JSON.stringify(newer.json.error)).toContain('unsupported-schema-version');
    writeFileSync(project, toml);
    const marker = join(dir, 'store/indx-watch-store.json');
    writeFileSync(marker, readFileSync(marker, 'utf8').replace(/prj_\w+/, 'prj_01JF3Q8M5X2V7K9D4R6T1W0Y01'));
    expect(iwJson(dir, 'sync', ['sync']).code).toBe(4);
  });

  it('a secret in a fixture CSV makes sync exit 1 with nothing uploaded; plain sync writes no bundle record', () => {
    const dir = shop();
    const log = () => readdirSync(join(dir, 'store/v1/log')).sort();
    const csv = join(dir, '.indx-watch/fixtures/FX-1-coupons/coupons.csv');
    const clean = readFileSync(csv, 'utf8');
    iwJson(dir, 'record', ['record', 'TC-1', '--verdict', 'pass']);
    const before = log();
    writeFileSync(csv, `${clean}AKIAABCDEFGHIJKLMNOP,0.5,2099-12-31,\n`);
    const r = iwJson(dir, 'sync', ['sync']);
    expect([r.code, r.json.error.code]).toEqual([1, 'SECRETS_FOUND']);
    expect(log()).toEqual(before);
    writeFileSync(csv, clean);
    expect(iwJson(dir, 'sync', ['sync']).json.data.pushed.records).toBe(1);
    const added = log().filter((k) => !before.includes(k));
    expect(added).toHaveLength(1);
    expect(readFileSync(join(dir, 'store/v1/log', added[0]!), 'utf8')).not.toContain('"kind":"bundle"');
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
});

const AI_FLAGS = ['--origin', 'ai', '--model', 'claude-opus-5-5'];
const AC_5_2 = 'A file that is not a PNG or JPEG shows "Photos must be PNG or JPEG" and no review is added.';
const AC_ARGS = ['new', 'ac', '--uc', 'UC-5', '--text', AC_5_2, ...AI_FLAGS, '--skill', 'write-test-cases'];
const FX_ARGS = [
  'new',
  'fixture',
  '--kind',
  'file',
  '--title',
  'Text file that is not an image',
  ...AI_FLAGS,
];
const TC_10_INPUT = JSON.stringify({
  tags: ['reviews'],
  fixtures: [{ ref: 'FX-3' }, { ref: 'FX-5' }],
  steps: [
    {
      instruction: 'Sign in with {{FX-3.username}} and open "Canvas Tote".',
      expected: 'The product page shows a "Write a review" form.',
    },
    {
      instruction: 'Attach the file from FX-5 and press "Post review".',
      expected: 'The message "Photos must be PNG or JPEG" appears.',
      evidence: ['screenshot'],
    },
  ],
  judges: [{ kind: 'human' }],
});
const TC_10_ARGS = [
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

describe('agent skills (docs/spec/agents.md): the worked examples on examples/shop UC-5', () => {
  it('write-test-cases + manage-fixtures produce drafts with origin "ai" that pass check', () => {
    const dir = shop();
    const env = AGENT;
    const uc5 = iwJson(dir, 'show', ['show', 'UC-5'], { env }).json.data;
    expect(uc5.criteria[0]).toMatchObject({ key: 'AC-5.1', draftTestCases: ['TC-9'] });
    expect(iwJson(dir, 'new', AC_ARGS, { env }).json.data.key).toBe('AC-5.2');
    expect(iwJson(dir, 'new', [...FX_ARGS, '--skill', 'manage-fixtures'], { env }).json.data.key).toBe(
      'FX-5',
    );
    writeFileSync(join(dir, 'not-an-image.txt'), 'This is not a photo.\n');
    const add = iwJson(dir, 'fixture add', ['fixture', 'add', 'not-an-image.txt', '--to', 'FX-5'], { env });
    expect(add.json.data.files[0]).toMatchObject({ name: 'not-an-image.txt', pointer: false });
    const tcArgs = [...TC_10_ARGS, ...AI_FLAGS, '--skill', 'write-test-cases', '--from', '-'];
    const tc = iwJson(dir, 'new', tcArgs, { env, input: TC_10_INPUT });
    expect(tc.json.data.key).toBe('TC-10');
    expect(parseToml(read(dir, tc.json.data.file))).toMatchObject({
      status: 'draft',
      origin: 'ai',
      ai: { skill: 'write-test-cases' },
    });
    expect(iwJson(dir, 'check', ['check'], { env }).json.data.errors).toBe(0);
    const runArgs = ['record', 'TC-10', '--verdict', 'pass', '--confidence', '0.9', '--step', '1=pass'];
    const run = iwJson(dir, 'record', runArgs, { env });
    expect(run.json.data).toMatchObject({ verdict: 'pass', rule: 8 });
  });
});

describe('signed records (docs/spec/security.md#signed-records)', () => {
  it('iw keygen prints a key; writes with IW_SIGNING_KEY are signed and verify against project.toml', async () => {
    const dir = shop();
    const k = iwJson(dir, 'keygen', ['keygen', '--kid', 'ci-test', '--via', 'github']).json.data;
    expect(k).toMatchObject({ kid: 'ci-test', via: ['github'] });
    expect(k.secret).toMatch(/^iwsk1:ci-test:/);
    expect(k.toml).not.toContain(k.secret.split(':')[2]);
    expect(iw(dir, ['keygen', '--via', 'git']).code).toBe(2);
    const project = join(dir, '.indx-watch/project.toml');
    writeFileSync(project, `${readFileSync(project, 'utf8')}\n${k.toml}`);
    expect(iwJson(dir, 'check', ['check']).code).toBe(0); // a public key is not a secret
    const env = { IW_SIGNING_KEY: k.secret };
    const run = iwJson(dir, 'record', ['record', 'TC-1', '--verdict', 'pass'], { env }).json.data.run;
    expect(run.sig).toMatchObject({ alg: 'Ed25519', kid: 'ci-test' });
    const [file] = records(dir);
    const stored = JSON.parse(readFileSync(join(dir, '.indx-watch/runs/records', String(file)), 'utf8'));
    const { verifyRecord } = await import('@indx-watch/bundle');
    expect(await verifyRecord(stored, [k])).toBe(true);
    expect(await verifyRecord({ ...stored, note: 'edited' }, [k])).toBe(false);
    expect(iw(dir, ['record', 'TC-1', '--verdict', 'pass'], { env: { IW_SIGNING_KEY: 'nope' } }).code).toBe(
      3,
    );
    // well-formed but broken key material fails the write the same way, not as an internal error
    const broken = { IW_SIGNING_KEY: `${k.secret.slice(0, 20)}AAAA` };
    const bad = iwJson(dir, 'record', ['record', 'TC-1', '--verdict', 'pass'], { env: broken });
    expect([bad.code, bad.json.error.code]).toEqual([3, 'INVALID_CONFIG']);
    // a malformed key fails writes only: a pull-only sync signs nothing
    expect(iw(dir, ['sync', '--pull-only'], { env: { IW_SIGNING_KEY: 'nope' } }).code).toBe(0);
  });
});
