/** Contract tests shared by port adapters (ObjectStore: docs/spec/sync.md#acceptance-criteria). */
import { describe, expect, it } from 'vitest';
import type { BrowserProvider, LlmClient, ObjectStore } from '../src/ports.js';
import { createResultStore } from '../src/result-store.js';

const text = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);

type WithStore = (fn: (s: ObjectStore) => Promise<void>) => () => Promise<void>;

/** Reads of missing keys and put/get/head round trips. */
function basicCases(withStore: WithStore) {
  it(
    'get/head return null for missing keys',
    withStore(async (s) => {
      expect(await s.get('v1/log/missing.json')).toBeNull();
      expect(await s.head('v1/log/missing.json')).toBeNull();
    }),
  );

  it(
    'put then get/head round-trips bytes and size',
    withStore(async (s) => {
      const data = new Uint8Array([0, 1, 2, 255, 128]);
      expect(await s.put('v1/blobs/sha256/aa/x', data)).toBe(true);
      expect(await s.get('v1/blobs/sha256/aa/x')).toEqual(data);
      expect((await s.head('v1/blobs/sha256/aa/x'))?.size).toBe(5);
      expect(await s.put('a/b.json', '{"é":1}')).toBe(true);
      expect(text(await s.get('a/b.json'))).toBe('{"é":1}');
    }),
  );
}

/** Create-if-absent (`ifNoneMatch`), alone and under concurrent writers. */
function conditionalPutCases(withStore: WithStore) {
  it(
    'ifNoneMatch never overwrites and resolves false when the key exists',
    withStore(async (s) => {
      expect(await s.put('k/one', 'first', { ifNoneMatch: true })).toBe(true);
      expect(await s.put('k/one', 'second', { ifNoneMatch: true })).toBe(false);
      expect(text(await s.get('k/one'))).toBe('first');
    }),
  );

  it(
    'concurrent create-if-absent: exactly one writer wins',
    withStore(async (s) => {
      const results = await Promise.all(
        [1, 2, 3, 4, 5].map((i) => s.put('race/key', `w${i}`, { ifNoneMatch: true })),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      const winner = results.indexOf(true) + 1;
      expect(text(await s.get('race/key'))).toBe(`w${winner}`);
    }),
  );
}

/** list(): lexicographic order, prefix, startAfter, limit and truncated. */
function listCases(withStore: WithStore) {
  it(
    'list is lexicographic, honors prefix, startAfter, limit and truncated',
    withStore(async (s) => {
      const keys = [
        'v1/log/03.json',
        'v1/log/01.json',
        'v1/log/02.json',
        'v1/logx',
        'v1/blobs/sha256/aa/b',
        'other',
      ];
      for (const k of keys) await s.put(k, k);
      const all = await s.list({ prefix: 'v1/log/' });
      expect(all.keys.map((k) => k.key)).toEqual(['v1/log/01.json', 'v1/log/02.json', 'v1/log/03.json']);
      expect(all.truncated).toBe(false);
      expect(all.keys[0]!.size).toBe('v1/log/01.json'.length);
      const after = await s.list({ prefix: 'v1/log/', startAfter: 'v1/log/01.json' });
      expect(after.keys.map((k) => k.key)).toEqual(['v1/log/02.json', 'v1/log/03.json']);
      // StartAfter may be a key that does not exist
      const ghost = await s.list({ prefix: 'v1/log/', startAfter: 'v1/log/015' });
      expect(ghost.keys.map((k) => k.key)).toEqual(['v1/log/02.json', 'v1/log/03.json']);
      const page = await s.list({ prefix: 'v1/log/', limit: 2 });
      expect(page.keys.map((k) => k.key)).toEqual(['v1/log/01.json', 'v1/log/02.json']);
      expect(page.truncated).toBe(true);
      expect((await s.list({ prefix: 'v1/' })).keys.map((k) => k.key)).toEqual([
        'v1/blobs/sha256/aa/b',
        'v1/log/01.json',
        'v1/log/02.json',
        'v1/log/03.json',
        'v1/logx',
      ]);
      expect((await s.list({ prefix: 'nothing/' })).keys).toEqual([]);
    }),
  );
}

/** Key validation and delete (skipped when the adapter cannot delete). */
function safetyCases(withStore: WithStore, canDelete?: boolean) {
  it(
    'rejects unsafe keys',
    withStore(async (s) => {
      await expect(s.get('../etc/passwd')).rejects.toThrow(/invalid object key/);
      await expect(s.put('a//b', 'x')).rejects.toThrow(/invalid object key/);
    }),
  );

  it.skipIf(canDelete === false)(
    'delete removes a key and is idempotent',
    withStore(async (s) => {
      await s.put('d/x', 'x');
      await s.delete('d/x');
      await s.delete('d/x');
      expect(await s.get('d/x')).toBeNull();
    }),
  );
}

/** The sync protocol's ResultStore running on top of the adapter. */
function resultStoreCases(withStore: WithStore) {
  it(
    'works as a result store (manifest, log, blobs)',
    withStore(async (s) => {
      const rs = createResultStore(s);
      await rs.init('prj_01JF3Q8M5X2V7K9D4R6T1W0Y00');
      await rs.init('prj_01JF3Q8M5X2V7K9D4R6T1W0Y00');
      await expect(rs.init('prj_01JF3Q8M5X2V7K9D4R6T1W0Y01')).rejects.toMatchObject({
        code: 'wrong-project',
      });
      const data = new TextEncoder().encode('evidence');
      const { sha256Hex } = await import('@indx-watch/bundle');
      const sha = await sha256Hex(data);
      await rs.putBlob(sha, data, 'text/plain');
      await rs.putBlob(sha, data, 'text/plain');
      expect(await rs.hasBlob(sha)).toBe(true);
      expect(await rs.getBlob(sha)).toEqual(data);
      expect(await s.head(`v1/blobs/sha256/${sha.slice(0, 2)}/${sha}`)).not.toBeNull();
    }),
  );
}

/**
 * Registers the ObjectStore contract suite for one adapter. `make` returns a fresh, empty store per case and an
 * optional cleanup; `canDelete: false` skips the delete case, `skip` skips the whole suite (e.g. no backend).
 */
export function objectStoreContract(
  name: string,
  make: () => Promise<{ store: ObjectStore; cleanup?: () => Promise<void> }>,
  opts: { canDelete?: boolean; skip?: boolean } = {},
) {
  describe.skipIf(!!opts.skip)(`ObjectStore contract: ${name}`, () => {
    const withStore: WithStore = (fn) => async () => {
      const { store, cleanup } = await make();
      try {
        await fn(store);
      } finally {
        await cleanup?.();
      }
    };
    basicCases(withStore);
    conditionalPutCases(withStore);
    listCases(withStore);
    safetyCases(withStore, opts.canDelete);
    resultStoreCases(withStore);
  });
}

/** Contract of the BrowserProvider port; `make` serves a two-page shop (`/` and `/cart`) at `baseUrl`. */
export function browserProviderContract(
  name: string,
  make: () => Promise<{ provider: BrowserProvider; baseUrl: string }>,
) {
  describe(`BrowserProvider contract: ${name}`, () => {
    it('opens at the base URL, navigates, acts on refs and refuses use after close', async () => {
      const { provider, baseUrl } = await make();
      const s = await provider.open({ baseUrl, viewport: { width: 1280, height: 720 } });
      const home = await s.observe();
      expect(home.url).toBe(new URL(baseUrl).href);
      expect(home.title).not.toBe('');
      expect(await s.act({ type: 'navigate', url: '/cart' })).toEqual({ ok: true });
      expect((await s.observe()).url).toBe(new URL('/cart', baseUrl).href);
      expect((await s.act({ type: 'click', ref: 'e1' })).ok).toBe(true);
      expect(await s.act({ type: 'navigate', url: '/missing' })).toMatchObject({
        ok: false,
        error: expect.any(String),
      });
      await s.close();
      await expect(s.observe()).rejects.toThrow();
    });
  });
}

/** Contract of the LlmClient port: a structured judgement with a confidence in [0, 1]. */
export function llmClientContract(name: string, make: () => Promise<LlmClient>) {
  describe(`LlmClient contract: ${name}`, () => {
    it('returns a verdict, a confidence in [0, 1], a reason and the model', async () => {
      const llm = await make();
      const tree = 'heading "Cart" [e1]\ntext "Total: $90"';
      const observation = { url: 'https://shop.test/cart', title: 'Cart', tree };
      for (const expected of ['Total: $90', 'Total: $100']) {
        const j = await llm.judge({ rubric: ['The cart shows the discounted total'], expected, observation });
        expect(['pass', 'fail', 'unknown']).toContain(j.verdict);
        expect(j.confidence).toBeGreaterThanOrEqual(0);
        expect(j.confidence).toBeLessThanOrEqual(1);
        expect(j.reason).not.toBe('');
        expect(j.model).not.toBe('');
      }
    });
  });
}
