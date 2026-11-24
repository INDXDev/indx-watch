/** `iw init --github` and `iw diff` (docs/spec/cli.md#iw-init, #iw-diff). */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { iw, iwJson, shop } from './helpers.js';

const FLOWS = ['.github/workflows/indx-watch.yml', '.github/workflows/indx-watch-deploy.yml'];

describe('iw init --github', () => {
  it('on a new project writes the workflows and names the secrets; a second run changes nothing', () => {
    const dir = shop();
    const empty = join(dir, 'app');
    const r = iwJson(dir, 'init', ['init', 'app', '--github', '--no-agents']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.json.data.github).toMatchObject({ root: empty, written: FLOWS, skipped: [] });
    expect(r.json.data.github.secrets).toEqual(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']);
    expect(r.stdout).not.toContain('ghp_');
    for (const f of FLOWS) expect(existsSync(join(empty, f))).toBe(true);
    const deploy = readFileSync(join(empty, FLOWS[1]!), 'utf8');
    expect(deploy).toContain('run: npx --yes indx-watch deploy');
    expect(deploy).toContain('${{ secrets.CLOUDFLARE_API_TOKEN }}');
    expect(readFileSync(join(empty, FLOWS[0]!), 'utf8')).toContain('uses: INDXDev/indx-watch@v0');
    // idempotent: an existing project only gets what is missing, and edits are kept
    writeFileSync(join(empty, FLOWS[0]!), '# mine\n');
    const again = iwJson(dir, 'init', ['init', 'app', '--github', '--no-agents']);
    expect(again.code, again.stderr).toBe(0);
    expect(again.json.data.github).toMatchObject({ written: [], skipped: FLOWS, secrets: [] });
    expect(readFileSync(join(empty, FLOWS[0]!), 'utf8')).toBe('# mine\n');
    // without --github an existing project is still a conflict
    expect(iwJson(dir, 'init', ['init', 'app']).json.error.code).toBe('CONFLICT');
  });

  it('writes only what is missing next to an existing project (the shop copy)', () => {
    const dir = shop();
    const r = iw(dir, ['init', '--github']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('Add these repository secrets: CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID');
    for (const f of FLOWS) expect(existsSync(join(dir, f))).toBe(true);
    const second = iwJson(dir, 'init', ['init', '--github']);
    expect(second.json.data).toMatchObject({ files: [], github: { written: [], skipped: FLOWS } });
    expect(iw(dir, ['init', '--github']).stdout).toContain('Kept:');
  });
});

describe('iw diff', () => {
  const g = (dir: string, ...a: string[]) =>
    execFileSync('git', ['-c', 'user.email=qa@shop.test', '-c', 'user.name=qa', ...a], { cwd: dir });

  it('lists added, changed and removed items against a commit; the human output is the PR comment section', () => {
    const dir = shop();
    g(dir, 'init', '-q');
    g(dir, 'add', '.');
    g(dir, 'commit', '-qm', 'shop');
    expect(iw(dir, ['diff', '--base', 'HEAD']).stdout).toContain(
      'No use case, criterion or test case changed.',
    );
    const file = join(
      dir,
      '.indx-watch/specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-3-valid-coupon.toml',
    );
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace('and the total is \\"36.00', 'and the total is \\"35.00'),
    );
    const r = iwJson(dir, 'diff', ['diff', '--base', 'HEAD']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.json.data.changed).toEqual([expect.objectContaining({ kind: 'tc', key: 'TC-3' })]);
    expect(r.json.data.added).toEqual([]);
    expect(iw(dir, ['diff', '--base', 'HEAD']).stdout).toMatch(
      /### Test cases changed in this PR\n\n\*\*Changed\*\*\n- \*\*TC-3\*\*/,
    );
    expect(iw(dir, ['diff']).code).toBe(2);
    expect(iw(dir, ['diff', '--base', 'nope']).code).toBe(4);
  });
});
