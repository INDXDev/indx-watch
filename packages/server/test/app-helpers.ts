/** Shared fixtures for the app-*.test.ts files: an app over fakeDeps and a GET that expects 200. */
import { expect } from 'vitest';
import { createApp } from '../src/index.js';
import { fakeDeps, req } from './helpers.js';

/** createApp over fakeDeps, with the fakes returned alongside. */
export const app = async (o: Parameters<typeof fakeDeps>[0] = {}) => {
  const f = await fakeDeps(o);
  return { ...f, app: createApp(f.deps) };
};

/** GET a JSON route and assert a 200. */
export const get = async <T>(a: { fetch(r: Request): Promise<Response> }, path: string) => {
  const res = await a.fetch(req(path));
  expect(res.status, `${path}: ${res.status}`).toBe(200);
  return (await res.json()) as T;
};

/** The Japanese translation status of a node that carries `i18n`. */
export const jaStatus = (node: { i18n?: unknown }) => (node.i18n as { ja: { status: string } }).ja.status;

/** A project ID that is not the one examples/shop serves. */
export const OTHER_PROJECT = 'prj_01JF3Q8M5X2V7K9D4R6T1W0Y99';
