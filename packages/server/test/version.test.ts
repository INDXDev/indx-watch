/** Versions are visible (T-501, T-506): /healthz, `server` in /api/project, and what only a lead sees. */
import { describe, expect, it } from 'vitest';
import PKG from '../package.json' with { type: 'json' };
import type { ProjectInfo } from '../src/index.js';
import { createApp, type ServerDeps } from '../src/index.js';
import { app, get } from './app-helpers.js';
import { fakeDeps, shop } from './helpers.js';
import { bucket, getJson, publicEnv } from './worker-helpers.js';

/** examples/shop pinned to `pinned` by `[tool] indx_watch`. */
async function pinnedShop(pinned: string) {
  const bundle = await shop();
  bundle.project.data = { ...bundle.project.data, tool: { indx_watch: pinned } };
  return bundle;
}

describe('server version', () => {
  it('GET /healthz answers ok and the package version', async () => {
    const { app: a } = await app();
    expect(await get(a, '/healthz')).toEqual({ ok: true, version: PKG.version });
  });

  it('a deploy pins its version (IW_VERSION on the Worker) and /api/project repeats it', async () => {
    const f = await fakeDeps();
    const a = createApp({ ...f.deps, version: '9.9.9' } as ServerDeps);
    expect(await get(a, '/healthz')).toEqual({ ok: true, version: '9.9.9' });
    expect((await get<ProjectInfo>(a, '/api/project')).server).toEqual({ version: '9.9.9' });
  });

  it('the Worker answers /healthz with the IW_VERSION its deploy pinned, and the package version without one', async () => {
    const { r2 } = await bucket();
    expect(await getJson(publicEnv(r2), '/healthz')).toEqual({ ok: true, version: PKG.version });
    const pinned = { ...publicEnv(r2), IW_VERSION: '0.1.3' };
    expect(await getJson(pinned, '/healthz')).toEqual({ ok: true, version: '0.1.3' });
    expect((await getJson<ProjectInfo>(pinned, '/api/project')).server).toEqual({ version: '0.1.3' });
  });

  it('a project without [tool] shows only the version', async () => {
    const { app: a } = await app();
    expect((await get<ProjectInfo>(a, '/api/project')).server).toEqual({ version: PKG.version });
  });

  it('tells a lead when the project pins a newer version, without any request out', async () => {
    const { app: a } = await app({ bundle: await pinnedShop('99.0.0') });
    expect((await get<ProjectInfo>(a, '/api/project')).server).toEqual({
      version: PKG.version,
      pinned: '99.0.0',
      outdated: true,
    });
  });

  it('shows no drift when the server is as new as the pin or newer', async () => {
    for (const pinned of [PKG.version, '0.0.1']) {
      const { app: a } = await app({ bundle: await pinnedShop(pinned) });
      expect((await get<ProjectInfo>(a, '/api/project')).server).toEqual({ version: PKG.version, pinned });
    }
  });

  it('keeps the pin from everyone but a lead', async () => {
    const f = await fakeDeps({ bundle: await pinnedShop('99.0.0') });
    for (const role of ['tester', 'viewer', 'customer'] as const) {
      const a = createApp({ ...f.deps, roles: { default: role } } as ServerDeps);
      expect((await get<ProjectInfo>(a, '/api/project')).server).toEqual({ version: PKG.version });
    }
  });
});
