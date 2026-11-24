import { describe, expect, it } from 'vitest';
import { compareVersions, isOlderVersion } from '../src/index.js';

describe('compareVersions', () => {
  it('compares numbers, not text', () => {
    expect(compareVersions('0.1.2', '0.1.10')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('v0.1.2', '0.1.2')).toBe(0);
  });

  it('puts a pre-release before its release', () => {
    expect(isOlderVersion('0.2.0-rc.1', '0.2.0')).toBe(true);
    expect(isOlderVersion('0.2.0', '0.2.0-rc.1')).toBe(false);
    expect(isOlderVersion('0.2.0-rc.1', '0.2.0-rc.2')).toBe(true);
  });

  it('is undefined for text that is not a version, and then nothing is older', () => {
    expect(compareVersions('latest', '0.1.2')).toBeUndefined();
    expect(isOlderVersion('latest', '0.1.2')).toBe(false);
    expect(isOlderVersion('0.1.2', '^0.1.2')).toBe(false);
  });
});
