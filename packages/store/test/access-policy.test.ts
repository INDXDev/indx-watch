/** The Access policy of customer UAT (docs/spec/security.md#customer-uat): the Cloudflare adapter and the fake. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloudflareAccessPolicy, fakeAccessPolicy, StoreError } from '../src/index.js';
import { fakeAccessApi } from './helpers/fakes.js';

const ENV = { IW_ACCESS_POLICY: 'acc/pol', CLOUDFLARE_API_TOKEN: 'cf-token' };

describe('cloudflareAccessPolicy', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('adds and removes an email in include with GET, PUT, GET, keeping every writable field', async () => {
    const api = fakeAccessApi();
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => (await api.fetch(url, init)) ?? fail());
    const policy = cloudflareAccessPolicy(ENV)!;
    expect(await policy.allow('pat@client.test')).toBe(true);
    expect(api.emails()).toEqual(['placeholder@shop.test', 'pat@client.test']);
    expect(api.requests.map((r) => r.method)).toEqual(['GET', 'PUT', 'GET']);
    expect(Object.keys(api.requests[1]!.body!).sort()).toEqual(
      ['approval_required', 'decision', 'exclude', 'include', 'name', 'purpose_justification_required']
        .concat(['require', 'session_duration'])
        .sort(),
    );
    // present (without case) → no PUT
    expect(await policy.allow('PAT@client.test')).toBe(false);
    expect(api.requests.at(-1)!.method).toBe('GET');
    expect(await policy.revoke('Pat@Client.test')).toBe(true);
    expect(api.emails()).toEqual(['placeholder@shop.test']);
    expect(await policy.revoke('pat@client.test')).toBe(false);
  });

  it('puts again when a concurrent PUT dropped the email, and gives up after two lost PUTs', async () => {
    const api = fakeAccessApi(undefined, { lostPuts: 1 });
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => (await api.fetch(url, init)) ?? fail());
    expect(await cloudflareAccessPolicy(ENV)!.allow('pat@client.test')).toBe(true);
    expect(api.requests.map((r) => r.method)).toEqual(['GET', 'PUT', 'GET', 'PUT', 'GET']);
    const lossy = fakeAccessApi(undefined, { lostPuts: 2 });
    vi.stubGlobal(
      'fetch',
      async (url: string, init?: RequestInit) => (await lossy.fetch(url, init)) ?? fail(),
    );
    await expect(cloudflareAccessPolicy(ENV)!.allow('pat@client.test')).rejects.toThrow(/changed meanwhile/);
  });

  it('is off without its variables; a refused call or a plain http base fails with a StoreError', async () => {
    expect(cloudflareAccessPolicy({ IW_ACCESS_POLICY: 'acc/pol' })).toBeUndefined();
    expect(cloudflareAccessPolicy({ ...ENV, IW_ACCESS_POLICY: 'acc' })).toBeUndefined();
    const api = fakeAccessApi();
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => (await api.fetch(url, init)) ?? fail());
    const wrong = cloudflareAccessPolicy({ ...ENV, CLOUDFLARE_API_TOKEN: 'other' })!;
    await expect(wrong.allow('pat@client.test')).rejects.toThrow(/answered 403/);
    const plain = cloudflareAccessPolicy({ ...ENV, CLOUDFLARE_API_BASE_URL: 'http://api.example.com' })!;
    await expect(plain.allow('pat@client.test')).rejects.toBeInstanceOf(StoreError);
    expect(api.emails()).toEqual(['placeholder@shop.test']);
  });
});

describe('fakeAccessPolicy', () => {
  it('holds emails in lower case and reports changes', async () => {
    const p = fakeAccessPolicy();
    expect([await p.allow('A@x.test'), await p.allow('a@x.test')]).toEqual([true, false]);
    expect([...p.emails]).toEqual(['a@x.test']);
    expect([await p.revoke('A@X.test'), await p.revoke('a@x.test')]).toEqual([true, false]);
  });
});

function fail(): never {
  throw new Error('unexpected request');
}
