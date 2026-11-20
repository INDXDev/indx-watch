import { describe, expect, it } from 'vitest';
import { checkBundle, scanSecrets } from '../src/check.js';
import { memFs } from './helpers.js';

describe('check problems: secrets', () => {
  it('secret in a fixture CSV', async () => {
    const fs = memFs();
    const csv = 'fixtures/FX-1-coupons/coupons.csv';
    fs.files.set(
      csv,
      new TextEncoder().encode(`${fs.text(csv)}AKIAIOSFODNN7EXAMPL3,0.1,2099-12-31,password = "hunter22"\n`),
    );
    const r = await checkBundle(fs);
    expect(r.problems.filter((p) => p.code === 'secret').map((p) => p.message)).toEqual([
      'Possible secret (AWS access key ID); use a reference such as env:NAME',
      'Possible secret (value of "password"); use a reference such as env:NAME',
    ]);
    expect(r.problems.some((p) => p.message.includes('hunter22'))).toBe(false);
  });

  it('secrets in files the format does not know are errors too (what a snapshot packs)', async () => {
    const fs = memFs();
    const key = ['-----BEGIN OPENSSH', 'PRIVATE KEY-----'].join(' ');
    fs.files.set('fixtures/FX-1-coupons/creds.env', new TextEncoder().encode('AWS=AKIAIOSFODNN7EXAMPL3\n'));
    fs.files.set('specs/notes.md', new TextEncoder().encode(`${key}\n`));
    const r = await checkBundle(fs);
    expect(r.problems.filter((p) => p.code === 'secret').map((p) => p.file)).toEqual([
      'fixtures/FX-1-coupons/creds.env',
      'specs/notes.md',
    ]);
  });

  it('finds multi-line, URL, unquoted and PGP secrets', () => {
    const hits = (t: string) => scanSecrets('a.toml', t).length;
    expect(hits("password = '''hunter22'''")).toBe(1);
    expect(hits('password = """hunter22"""')).toBe(1);
    expect(hits('base_url = "https://admin:S3cretPassw0rd@staging.shop.test"')).toBe(1);
    expect(hits('{"password": 12345678}')).toBe(1);
    expect(hits('machine api.internal login deploy password Hunter2Prod')).toBe(1);
    expect(hits('password: hunter22')).toBe(1);
    expect(hits(['-----BEGIN PGP PRIVATE', 'KEY BLOCK-----'].join(' '))).toBe(1);
    // an `iw keygen` secret, wherever it is pasted (docs/spec/security.md#signed-records)
    const secret = `iwsk1:ci-key:MC4CAQAwBQYDK2VwBCIEI${'A'.repeat(43)}`;
    for (const line of [
      `IW_SIGNING_KEY=${secret}`,
      `  IW_SIGNING_KEY: ${secret}`,
      `note = "CI key: ${secret}"`,
    ])
      expect(hits(line), line).toBe(1);
    // plain prose, references and placeholders stay quiet
    expect(hits('instruction = "Enter a wrong password and press Sign in"')).toBe(0);
    expect(hits('instruction = "Type the password from FX-3.password"')).toBe(0);
    expect(hits('base_url = "https://casey:{{FX-3.password}}@staging.shop.test"')).toBe(0);
    expect(hits('password_ref = "env:SHOP_PASSWORD"')).toBe(0);
  });

  it('secret scan ignores references and placeholders', () => {
    expect(
      scanSecrets(
        'a.toml',
        'secret_ref = "env:SHOP_PASSWORD"\npassword = "{{FX-3.password}}"\nkey = "TC-3"\n',
      ),
    ).toEqual([]);
    expect(scanSecrets('a.csv', 'username,password\ncasey,hunter22\n')).toHaveLength(1);
  });
});
