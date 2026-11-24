/** GET /api/issue and `github` in /api/project (docs/spec/integrations.md#github-issues). */
import { describe, expect, it } from 'vitest';
import type { ProjectInfo } from '../src/index.js';
import { createApp } from '../src/index.js';
import { app, get } from './app-helpers.js';
import { req } from './helpers.js';

describe('Open as GitHub issue', () => {
  it('offers the repository and builds the prefilled URL of a test case', async () => {
    const { deps } = await app();
    const a = createApp({ ...deps, githubRepo: 'shop-co/shop' });
    expect((await get<ProjectInfo>(a, '/api/project')).github).toEqual({ repo: 'shop-co/shop' });
    const r = await get<{ url: string; repo: string; keys: string[] }>(a, '/api/issue?ref=TC-3');
    expect(r.repo).toBe('shop-co/shop');
    expect(r.keys).toEqual(['TC-3']);
    const u = new URL(r.url);
    expect(u.pathname).toBe('/shop-co/shop/issues/new');
    expect(u.searchParams.get('template')).toBe('indx-watch-test-failure.yml');
    expect(u.searchParams.get('title')).toMatch(/^TC-3: /);
  });

  it('hides the button without a repository, refuses the route (409) and an unknown ref (404)', async () => {
    const { app: a, deps } = await app();
    expect((await get<ProjectInfo>(a, '/api/project')).github).toBeUndefined();
    expect((await a.fetch(req('/api/issue?ref=TC-3'))).status).toBe(409);
    const b = createApp({ ...deps, githubRepo: 'shop-co/shop' });
    expect((await b.fetch(req('/api/issue?ref=TC-999'))).status).toBe(404);
  });
});
