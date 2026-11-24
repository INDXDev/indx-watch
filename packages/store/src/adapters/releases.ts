/** Where the newest INDX Watch version is published: the npm registry and GitHub releases (docs/spec/cli.md#iw-doctor). */
import type { ReleaseInfo, ReleaseSource } from '../ports.js';

type Fetch = typeof fetch;
const VERSION = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/** One JSON GET with a short timeout; any failure (offline, 404, a body that is not JSON) is `undefined`. */
async function getJson(get: Fetch, url: string): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await get(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

const release = (tag: unknown, url?: unknown): ReleaseInfo | undefined => {
  const version = typeof tag === 'string' ? VERSION.exec(tag)?.[1] : undefined;
  return version ? { version, ...(typeof url === 'string' && { url }) } : undefined;
};

/** `latest` dist-tag of a package on the npm registry (default `indx-watch`). */
export function npmReleaseSource(pkg = 'indx-watch', get: Fetch = fetch): ReleaseSource {
  return {
    async latest() {
      const body = await getJson(get, `https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`);
      return release(body?.version, `https://www.npmjs.com/package/${pkg}`);
    },
  };
}

/** The newest (non-draft, non-prerelease) GitHub release of `repo` ("owner/name"), for a fork (`[tool] source`). */
export function githubReleaseSource(repo: string, get: Fetch = fetch): ReleaseSource {
  return {
    async latest() {
      if (!/^[\w-][\w.-]*\/[\w-][\w.-]*$/.test(repo)) return undefined;
      const body = await getJson(get, `https://api.github.com/repos/${repo}/releases/latest`);
      return release(body?.tag_name, body?.html_url);
    },
  };
}

/** A source that answers a fixed version (or nothing, like an offline one); for tests. */
export const fakeReleaseSource = (version?: string): ReleaseSource => ({
  latest: async () => (version ? { version } : undefined),
});
