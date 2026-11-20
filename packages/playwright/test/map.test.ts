import { resolve } from 'node:path';
import { loadBundle } from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { describe, expect, it } from 'vitest';
import {
  annotatedRows,
  evidenceKind,
  redactor,
  resolveRelease,
  runGroup,
  secretValues,
  stepNumber,
} from '../src/map.js';

const { bundle } = await loadBundle(
  nodeFs(resolve(import.meta.dirname, '../../../examples/shop/.indx-watch')),
);

describe('resolveRelease', () => {
  const at = (ref: string | undefined, inCi: boolean, explicit?: string) =>
    resolveRelease(bundle!, ref ? { ref } : {}, { explicit, inCi });

  it('prefers the explicit release and warns when it is not in releases/', () => {
    expect(at('refs/heads/feature', true, 'v1.2.0')).toEqual({ release: 'v1.2.0' });
    expect(at(undefined, true, 'v9.9.9')).toMatchObject({ release: 'v9.9.9', warning: expect.any(String) });
  });

  it('matches the build tag or branch against release refs', () => {
    expect(at('refs/tags/v1.2.0', true)).toEqual({ release: 'v1.2.0' });
    expect(at('refs/heads/release/1.2', true)).toEqual({ release: 'v1.2.0' });
  });

  it('falls back to current_release on the default branch or outside CI only', () => {
    expect(at('refs/heads/main', true)).toEqual({ release: 'v1.2.0' });
    expect(at('refs/heads/feature', false)).toEqual({ release: 'v1.2.0' });
    expect(at('refs/heads/feature', true)).toEqual({ warning: expect.stringContaining('IW_RELEASE') });
    expect(at('refs/pull/12/merge', true).release).toBeUndefined();
  });
});

describe('helpers', () => {
  it('derives the run group from IW_RUN_GROUP, GitHub Actions or a fresh ID', () => {
    expect(runGroup({ IW_RUN_GROUP: 'build-512', GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '1' })).toBe(
      'build-512',
    );
    expect(runGroup({ GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '2' })).toBe(
      'github:42:2',
    );
    expect(runGroup({})).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(runGroup({})).not.toBe(runGroup({}));
  });

  it('reads rows from _iw.fixture annotations', () => {
    const rows = annotatedRows([
      { type: '_iw.fixture', description: 'FX-1:SUMMER10' },
      { type: '_iw.fixture', description: 'FX-1:OLD5' },
      { type: '_iw.fixture', description: 'FX-1:OLD5' },
      { type: 'issue', description: 'FX-2:x' },
      { type: '_iw.fixture', description: 'nonsense' },
    ]);
    expect([...rows]).toEqual([['FX-1', ['OLD5', 'SUMMER10']]]);
  });

  it('numbers steps and classifies attachments', () => {
    expect([
      stepNumber('1. Open'),
      stepNumber('12. x'),
      stepNumber('1.1 nested'),
      stepNumber('Open'),
    ]).toEqual([1, 12, undefined, undefined]);
    expect(evidenceKind('screenshot', 'image/png')).toBe('screenshot');
    expect(evidenceKind('trace', 'application/zip')).toBe('trace');
    expect(evidenceKind('video', 'video/webm')).toBe('video');
    expect(evidenceKind('error-context', 'text/markdown')).toBe('log');
    expect(evidenceKind('har', 'application/octet-stream')).toBe('file');
  });
});

describe('redaction', () => {
  it('redacts secret values in their encoded, escaped and Basic auth forms', () => {
    const pw = `S3cr3t&p@ss/"x'`;
    const env = { SHOP_CUSTOMER_PASSWORD: pw, SHOP_SEED_TOKEN: 'seed tok+en' };
    const redact = redactor(secretValues(bundle!, env));
    const basic = Buffer.from(`casey@shop.test:${pw}`).toString('base64');
    for (const text of [
      `typed ${pw}`,
      `password=${encodeURIComponent(pw)}`,
      `password=${new URLSearchParams({ p: pw }).toString().slice(2)}`,
      JSON.stringify({ password: pw }),
      'value="S3cr3t&amp;p@ss/&quot;x&#39;"',
      `Authorization: Basic ${basic}`,
      'x-token: seed tok+en; body=seed+tok%2Ben',
    ])
      expect(redact(text)).not.toMatch(new RegExp(`S3cr3t|seed.tok|${basic.slice(0, 12)}`));
    expect(secretValues(bundle!, { SHOP_CUSTOMER_PASSWORD: 'ab' })).toEqual([]);
  });
});
