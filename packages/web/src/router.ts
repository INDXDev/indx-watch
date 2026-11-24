/** A tiny hash router: hash URLs work from any base path and need no server rewrites. */
import { useEffect, useState } from 'react';

export type Query = Record<string, string>;
export type Route = (
  | { name: 'home' }
  | { name: 'tests' }
  | { name: 'testCase'; key: string }
  | { name: 'runner'; key: string }
  | { name: 'activity' }
  | { name: 'run'; id: string }
  | { name: 'fixtures'; key?: string | undefined }
  | { name: 'secrets'; key?: string | undefined }
  | { name: 'access' }
  | { name: 'uploads' }
  | { name: 'report' }
  | { name: 'insights' }
  | { name: 'notFound'; path: string }
) & { query: Query };

type Bare = Route extends infer R ? (R extends Route ? Omit<R, 'query'> : never) : never;
const PATTERNS: [RegExp, (m: RegExpMatchArray) => Bare][] = [
  [/^\/$/, () => ({ name: 'home' })],
  [/^\/(tests|specs)$/, () => ({ name: 'tests' })],
  [/^\/activity$/, () => ({ name: 'activity' })],
  [/^\/uploads$/, () => ({ name: 'uploads' })],
  [/^\/report$/, () => ({ name: 'report' })],
  [/^\/insights$/, () => ({ name: 'insights' })],
  [/^\/tc\/(TC-\d+)$/, (m) => ({ name: 'testCase', key: m[1]! })],
  [/^\/tc\/(TC-\d+)\/run$/, (m) => ({ name: 'runner', key: m[1]! })],
  [/^\/runs\/(run_[0-9A-Za-z]+)$/, (m) => ({ name: 'run', id: m[1]! })],
  [/^\/fixtures(?:\/(FX-\d+))?$/, (m) => ({ name: 'fixtures', key: m[1] })],
  [/^\/secrets(?:\/([A-Za-z0-9][\w.-]*))?$/, (m) => ({ name: 'secrets', key: m[1] })],
  [/^\/access$/, () => ({ name: 'access' })],
];

/** Parse `#/tc/TC-3/run?session=TC-3,TC-6` style hashes. Pure; tested. */
export function parseRoute(hash: string): Route {
  const [rawPath = '', search = ''] = hash.replace(/^#/, '').split('?');
  const path = decodeURIComponent(rawPath).replace(/\/+$/, '') || '/';
  const query = Object.fromEntries(new URLSearchParams(search));
  for (const [re, make] of PATTERNS) {
    const m = path.match(re);
    if (m) return { ...make(m), query } as Route;
  }
  return { name: 'notFound', path, query };
}

const qs = (q?: Record<string, string | undefined>) => {
  const s = new URLSearchParams(
    Object.entries(q ?? {}).filter((e): e is [string, string] => !!e[1]),
  ).toString();
  return s ? `?${s}` : '';
};
export const href = {
  home: () => '#/',
  /** kept for older links */
  dashboard: () => '#/',
  tests: (q?: { f?: string }) => `#/tests${qs(q)}`,
  specs: () => '#/tests',
  testCase: (key: string, q?: { f?: string }) => `#/tc/${key}${qs(q)}`,
  runner: (key: string, session?: string[]) =>
    `#/tc/${key}/run${qs({ session: session && session.length > 1 ? session.join(',') : undefined })}`,
  activity: (q?: { f?: string }) => `#/activity${qs(q)}`,
  run: (id: string, q?: { f?: string }) => `#/runs/${id}${qs(q)}`,
  fixtures: (key?: string) => (key ? `#/fixtures/${key}` : '#/fixtures'),
  secrets: (name?: string) => (name ? `#/secrets/${name}` : '#/secrets'),
  access: (who?: string) => `#/access${qs({ who })}`,
  uploads: () => '#/uploads',
  report: () => '#/report',
  insights: () => '#/insights',
};

export const navigate = (to: string): void => {
  window.location.hash = to.replace(/^#/, '');
};

/** While `stay` is set, a hash change first asks it; `true` keeps the page (unsaved runner work) and the URL. */
export const leave: { stay?: (() => boolean) | undefined } = {};

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = (e: HashChangeEvent) => {
      if (leave.stay?.()) return history.replaceState(null, '', e.oldURL);
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
