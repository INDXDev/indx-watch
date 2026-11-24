import { describe, expect, it } from 'vitest';
import { generateSecretsKey, scanSecrets, secretSealer } from '../src/index.js';

const r = {
  project: 'prj_01JF7Z3K0W8N2Q4R6S8T0V2X4Y',
  at: '2026-11-24T00:00:00Z',
  action: 'set',
  name: 'admin',
} as const;

describe('secretSealer', () => {
  it('opens what it sealed, and nothing after a field changed or with another key', async () => {
    const key = generateSecretsKey();
    const s = secretSealer(key);
    const sealed = await s.seal({ ...r, shared_with: ['group:qa'] }, 'hunter2');
    expect(await s.open({ ...r, shared_with: ['group:qa'], sealed })).toBe('hunter2');
    expect(await s.open({ ...r, sealed })).toBeNull();
    expect(await s.open({ ...r, shared_with: ['group:qa'], sealed, name: 'other' })).toBeNull();
    expect(
      await secretSealer(generateSecretsKey()).open({ ...r, shared_with: ['group:qa'], sealed }),
    ).toBeNull();
  });

  it('refuses a malformed key, and the secret scan finds a key in a file', () => {
    expect(() => secretSealer('nope')).toThrow(/IW_SECRETS_KEY/);
    expect(scanSecrets('README.md', `key ${generateSecretsKey()}`)).toHaveLength(1);
  });
});
