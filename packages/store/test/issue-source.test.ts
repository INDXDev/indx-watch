/** IssueSource (docs/spec/integrations.md#github-issues): one contract, run against the REST adapter (stubbed fetch) and the fake. */
import { describe, expect, it } from 'vitest';
import {
  fakeIssueSource,
  githubIssueSource,
  type IssueData,
  type IssueSource,
  StoreError,
} from '../src/index.js';

const issue: IssueData = {
  number: 42,
  title: 'Customers can pay with a gift card',
  body: '## Goal\n- [ ] Card is accepted\n- [x] Balance is shown',
  labels: ['checkout', 'enhancement'],
  url: 'https://github.com/shop-co/shop/issues/42',
};

/** the REST API's answer for the same issue, and a 404 for anything else */
const calls: { url: string; auth?: string | undefined }[] = [];
const rest = (async (url: string, init?: RequestInit) => {
  calls.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.authorization });
  if (!url.endsWith('/repos/shop-co/shop/issues/42')) return new Response('{}', { status: 404 });
  return Response.json({
    ...{ number: 42, title: issue.title, body: issue.body, html_url: issue.url },
    labels: [{ name: 'checkout' }, 'enhancement'],
  });
}) as unknown as typeof fetch;

const sources: [string, () => IssueSource][] = [
  ['githubIssueSource', () => githubIssueSource({}, rest)],
  ['fakeIssueSource', () => fakeIssueSource({ 'shop-co/shop': [issue] })],
];

describe.each(sources)('IssueSource: %s', (_, make) => {
  it('reads an issue as title, body, labels and URL', async () => {
    expect(await make().get('shop-co/shop', 42)).toEqual(issue);
  });
  it('throws not-found for a missing issue', async () => {
    await expect(make().get('shop-co/shop', 7)).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('githubIssueSource', () => {
  it('sends the token only when given, and only over https', async () => {
    calls.length = 0;
    await githubIssueSource({}, rest).get('shop-co/shop', 42);
    await githubIssueSource({ GITHUB_TOKEN: 'ghp_placeholder' }, rest).get('shop-co/shop', 42);
    expect(calls.map((c) => c.auth)).toEqual([undefined, 'Bearer ghp_placeholder']);
    expect(() => githubIssueSource({ GITHUB_API_URL: 'http://api.example.com' })).toThrow(StoreError);
  });
  it('refuses pull requests and bad repository names', async () => {
    const pr = (async () =>
      Response.json({ title: 't', html_url: 'u', pull_request: {} })) as unknown as typeof fetch;
    await expect(githubIssueSource({}, pr).get('a/b', 1)).rejects.toThrow(/pull request/);
    await expect(githubIssueSource({}, rest).get('not a repo', 1)).rejects.toBeInstanceOf(StoreError);
  });
  it('reports a refused token as unauthorized', async () => {
    const no = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    await expect(githubIssueSource({}, no).get('a/b', 1)).rejects.toMatchObject({ code: 'unauthorized' });
  });
});
