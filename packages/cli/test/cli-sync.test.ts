/** Fixture files and sync commands on a temp copy of examples/shop: fixture add/fetch, sync, push, clone. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseToml, sha256Hex } from '@indx-watch/bundle';
import { describe, expect, it } from 'vitest';
import { read } from './cli-fixtures.js';
import { iw, iwJson, shop } from './helpers.js';

describe('commands: fixture add and fixture fetch', () => {
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
    // over [fixtures].inline_max_bytes without --blob: a *.blob.toml pointer whose hash matches the content
    const project = join(dir, '.indx-watch/project.toml');
    writeFileSync(
      project,
      read(dir, 'project.toml').replace('inline_max_bytes = 1048576', 'inline_max_bytes = 8'),
    );
    writeFileSync(join(dir, 'big.txt'), 'More than eight bytes.\n');
    const big = iwJson(dir, 'fixture add', ['fixture', 'add', 'big.txt', '--to', 'FX-4']);
    const sha = await sha256Hex('More than eight bytes.\n');
    expect(big.json.data.files[0]).toMatchObject({ name: 'big.txt', pointer: true, sha256: sha });
    expect(parseToml(read(dir, 'fixtures/FX-4-review-photo/big.txt.blob.toml'))).toMatchObject({
      sha256: sha,
    });
    expect(existsSync(join(dir, '.indx-watch/fixtures/FX-4-review-photo/big.txt'))).toBe(false);
    writeFileSync(join(dir, 'key.txt'), 'AKIAABCDEFGHIJKLMNOP\n');
    const secret = iwJson(dir, 'fixture add', ['fixture', 'add', 'key.txt', '--to', 'FX-4']);
    expect([secret.code, secret.json.error.code]).toEqual([1, 'SECRETS_FOUND']);
    const fetch = iwJson(dir, 'fixture fetch', ['fixture', 'fetch', 'FX-4']);
    const photo = fetch.json.data.files.find((f: { name: string }) => f.name === 'review-photo.png');
    expect(photo.path).toBe(join(dir, '.indx-watch/cache/blobs', photo.sha256));
    expect(existsSync(photo.path)).toBe(true);
    const out = iwJson(dir, 'fixture fetch', ['fixture', 'fetch', 'FX-4', '--out', 'files']).json.data.files;
    expect(out.map((f: { path: string }) => f.path)).toContain(join(dir, 'files', 'review-photo.png'));
    expect(await sha256Hex(readFileSync(join(dir, 'files', 'review-photo.png')))).toBe(photo.sha256);
    expect(iw(dir, ['check']).code).toBe(0);
  });
});

describe('commands: sync', () => {
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
    expect(iwJson(dir, 'sync', ['sync', '--pull-only']).code).toBe(0); // nothing leaves the machine
  });

  it('sync holds back unpushed records that fail the secret scan; pulled records never block', () => {
    const dir = shop();
    const key = `AKIA${'ABCDEFGHIJKLMNOP'}`;
    const good = iwJson(dir, 'record', ['record', 'TC-2', '--verdict', 'pass']).json.data.run.id;
    const bad = iwJson(dir, 'record', ['record', 'TC-8', '--verdict', 'fail', '--note', `token ${key}`]);
    const r = iwJson(dir, 'sync', ['sync']);
    expect([r.code, r.json.error.code]).toEqual([1, 'SECRETS_FOUND']);
    expect(r.json.data.pushed.records).toBe(1); // the clean record still went out
    const log = (d: string) =>
      readdirSync(join(d, 'store/v1/log')).map((f) => readFileSync(join(d, 'store/v1/log', f), 'utf8'));
    expect(log(dir).some((t) => t.includes(good))).toBe(true);
    expect(log(dir).some((t) => t.includes(key))).toBe(false);
    // retracting it is the way out: the target stays local, the retraction is pushed
    iwJson(dir, 'retract', ['retract', bad.json.data.run.id, '--reason', 'leaked a key']);
    expect(iwJson(dir, 'sync', ['sync']).json.data.pushed.records).toBe(1);
    expect(log(dir).some((t) => t.includes(key))).toBe(false);
    // a secret that is already in the store (written by an older client) does not block other clones
    const other = shop();
    const entry = { v: 1, writer: 'w_old', records: [bad.json.data.run] };
    writeFileSync(join(other, 'store/v1/log/01M7TJG6737VKP4NE5ZCT1WSH6.json'), JSON.stringify(entry));
    expect(iwJson(other, 'sync', ['sync', '--pull-only']).code).toBe(0);
    expect(iwJson(other, 'sync', ['sync']).code).toBe(0);
  });
});

describe('commands: compact', () => {
  it('compact writes a log snapshot of the sample store once; a fresh clone starts from it', () => {
    const dir = shop();
    const first = iwJson(dir, 'compact', ['compact']).json.data;
    expect(first).toMatchObject({ written: true, logs: readdirSync(join(dir, 'store/v1/log')).length });
    expect(first.snapshot).toMatch(/^v1\/snapshots\//);
    expect(existsSync(join(dir, 'store', first.snapshot))).toBe(true);
    expect(iwJson(dir, 'compact', ['compact']).json.data).toEqual({ ...first, written: false });
    const other = shop();
    const store = `file://${join(dir, 'store')}`;
    const pulled = iwJson(other, 'sync', ['sync', '--store', store, '--pull-only']).json.data;
    expect(pulled).toMatchObject({ logSnapshot: first.snapshot, pulled: { records: first.records } });
  });
});

describe('commands: push and clone', () => {
  it('push uploads a snapshot once; clone makes a working copy with results from it', () => {
    const dir = shop();
    iwJson(dir, 'record', ['record', 'TC-1', '--verdict', 'pass']);
    const push = iwJson(dir, 'push', ['push', '--message', 'first upload']);
    expect(push.json.data).toMatchObject({ unchanged: false, url: null });
    expect(push.json.data.snapshot).toMatch(/^rec_/);
    expect(iwJson(dir, 'push', ['push']).json.data).toMatchObject({ unchanged: true, snapshot: null });
    const source = `file://${join(dir, 'store')}`;
    const parent = mkdtempSync(join(tmpdir(), 'iw-clone-'));
    const clone = iwJson(parent, 'clone', ['clone', source]);
    const target = join(parent, 'shop');
    expect(clone.json.data).toMatchObject({ dir: target, snapshot: push.json.data.snapshot });
    expect(clone.json.data.pulled.records).toBeGreaterThan(0);
    expect(read(target, 'project.toml')).toContain(`url = "${source}"`);
    expect(read(target, '.gitignore')).toBe('cache/\nruns/\n');
    expect(iwJson(target, 'check', ['check']).code).toBe(0);
    expect(iwJson(parent, 'clone', ['clone', source]).json.error.code).toBe('CONFLICT');
    const empty = mkdtempSync(join(tmpdir(), 'iw-empty-store-'));
    expect(iwJson(parent, 'clone', ['clone', `file://${empty}`, 'x']).code).toBe(4);
  });
});

describe('commands: sync in workspace mode', () => {
  it('publishes definitions, writes them into another working copy, and refuses while git tracks them', () => {
    const dir = shop();
    const project = join(dir, '.indx-watch/project.toml');
    const store = `file://${join(dir, 'store')}`;
    const toml = read(dir, 'project.toml').replace('mode = "git"', 'mode = "workspace"');
    writeFileSync(project, toml.replace('file://../store', store));
    const first = iwJson(dir, 'sync', ['sync']).json.data;
    expect(first.workspace.published).toContain('project.toml');
    expect(first.workspace.conflicts).toEqual([]);
    // a second working copy that has only the same project.toml receives every file
    const other = mkdtempSync(join(tmpdir(), 'iw-ws-'));
    mkdirSync(join(other, '.indx-watch'));
    writeFileSync(join(other, '.indx-watch/project.toml'), readFileSync(project, 'utf8'));
    const pulled = iwJson(other, 'sync', ['sync']).json.data;
    expect(pulled.workspace.written).toContain(
      'specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-3-valid-coupon.toml',
    );
    expect(iw(other, ['check']).code).toBe(0);
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '.indx-watch/project.toml'], { cwd: dir });
    const refused = iwJson(dir, 'sync', ['sync']);
    expect([refused.code, refused.json.error.code]).toEqual([1, 'CONFLICT']);
    expect(refused.json.error.message).toContain('git rm -r --cached');
  });
});
