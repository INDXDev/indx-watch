/** ReleaseSource adapters (docs/spec/cli.md#iw-doctor): the npm registry, GitHub releases and the fake share one contract. */
import { describe, expect, it } from 'vitest';
import {
  fakeReleaseSource,
  githubReleaseSource,
  npmReleaseSource,
  type ReleaseSource,
} from '../src/index.js';

/** A fetch that answers each URL with a JSON body (or the status), and records the URLs asked. */
function fetchOf(answers: Record<string, unknown>, asked: string[] = []): typeof fetch {
  return (async (url: string) => {
    asked.push(url);
    const body = answers[url];
    return body === undefined
      ? new Response('not found', { status: 404 })
      : new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}
const offline = (async () => {
  throw new TypeError('fetch failed');
}) as typeof fetch;

/** What every source promises: the newest version, or undefined when it cannot tell (never a throw). */
function contract(name: string, found: () => ReleaseSource, missing: () => ReleaseSource) {
  describe(name, () => {
    it('answers the newest version', async () => {
      expect((await found().latest())?.version).toBe('0.1.3');
    });
    it('answers undefined when it cannot tell', async () => {
      expect(await missing().latest()).toBeUndefined();
    });
  });
}

contract(
  'npmReleaseSource',
  () =>
    npmReleaseSource(
      'indx-watch',
      fetchOf({ 'https://registry.npmjs.org/indx-watch/latest': { version: '0.1.3' } }),
    ),
  () => npmReleaseSource('indx-watch', offline),
);
contract(
  'githubReleaseSource',
  () =>
    githubReleaseSource(
      'acme/fork',
      fetchOf({
        'https://api.github.com/repos/acme/fork/releases/latest': {
          tag_name: 'v0.1.3',
          html_url: 'https://github.com/acme/fork/releases/tag/v0.1.3',
        },
      }),
    ),
  () => githubReleaseSource('acme/fork', fetchOf({})),
);
contract(
  'fakeReleaseSource',
  () => fakeReleaseSource('0.1.3'),
  () => fakeReleaseSource(),
);

describe('release adapters', () => {
  it('npm sends one request to the registry and ignores a body without a version', async () => {
    const asked: string[] = [];
    const source = npmReleaseSource(
      'indx-watch',
      fetchOf({ 'https://registry.npmjs.org/indx-watch/latest': { name: 'indx-watch' } }, asked),
    );
    expect(await source.latest()).toBeUndefined();
    expect(asked).toEqual(['https://registry.npmjs.org/indx-watch/latest']);
  });

  it('github strips the v of the tag, links the release and refuses a repository that is not owner/name', async () => {
    const url = 'https://github.com/acme/fork/releases/tag/v0.2.0';
    const answers = {
      'https://api.github.com/repos/acme/fork/releases/latest': { tag_name: 'v0.2.0', html_url: url },
    };
    expect(await githubReleaseSource('acme/fork', fetchOf(answers)).latest()).toEqual({
      version: '0.2.0',
      url,
    });
    const asked: string[] = [];
    expect(await githubReleaseSource('../etc', fetchOf({}, asked)).latest()).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it('ignores a tag that is not a version', async () => {
    const answers = { 'https://api.github.com/repos/acme/fork/releases/latest': { tag_name: 'nightly' } };
    expect(await githubReleaseSource('acme/fork', fetchOf(answers)).latest()).toBeUndefined();
  });
});
