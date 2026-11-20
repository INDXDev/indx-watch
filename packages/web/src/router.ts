/** A tiny hash router: hash URLs work from any base path and need no server rewrites. */
import { useEffect, useState } from 'react';

export type Route =
  | { name: 'dashboard' }
  | { name: 'specs' }
  | { name: 'testCase'; key: string }
  | { name: 'runner'; key: string }
  | { name: 'run'; id: string }
  | { name: 'fixtures'; key?: string | undefined }
  | { name: 'report' }
  | { name: 'notFound'; path: string };

const PATTERNS: [RegExp, (m: RegExpMatchArray) => Route][] = [
  [/^\/$/, () => ({ name: 'dashboard' })],
  [/^\/specs$/, () => ({ name: 'specs' })],
  [/^\/report$/, () => ({ name: 'report' })],
  [/^\/tc\/(TC-\d+)$/, (m) => ({ name: 'testCase', key: m[1]! })],
  [/^\/tc\/(TC-\d+)\/run$/, (m) => ({ name: 'runner', key: m[1]! })],
  [/^\/runs\/(run_[0-9A-Za-z]+)$/, (m) => ({ name: 'run', id: m[1]! })],
  [/^\/fixtures(?:\/(FX-\d+))?$/, (m) => ({ name: 'fixtures', key: m[1] })],
];

/** Parse `#/tc/TC-3/run` style hashes. Pure; tested. */
export function parseRoute(hash: string): Route {
  const path = decodeURIComponent(hash.replace(/^#/, '').split('?')[0] ?? '').replace(/\/+$/, '') || '/';
  for (const [re, make] of PATTERNS) {
    const m = path.match(re);
    if (m) return make(m);
  }
  return { name: 'notFound', path };
}

export const href = {
  dashboard: () => '#/',
  specs: () => '#/specs',
  testCase: (key: string) => `#/tc/${key}`,
  runner: (key: string) => `#/tc/${key}/run`,
  run: (id: string) => `#/runs/${id}`,
  fixtures: (key?: string) => (key ? `#/fixtures/${key}` : '#/fixtures'),
  report: () => '#/report',
};

export const navigate = (to: string): void => {
  window.location.hash = to.replace(/^#/, '');
};

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
