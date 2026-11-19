/**
 * Typed client for the HTTP API in packages/server/src/contract.ts. The UI talks to the server only through this file.
 * Types are imported from the server contract (type-only; no runtime code from the server package).
 */
import type {
  BlobResult,
  FixtureDetail,
  ManualRunInput,
  ManualRunResult,
  ProjectInfo,
  ReviewInput,
  RunDetail,
  RunSummary,
  SpecTree,
  StatusResult,
  TestCaseDetail,
} from '@indx-watch/server';

export type {
  BlobResult,
  FixtureDetail,
  ProjectInfo,
  RunDetail,
  RunSummary,
  SpecTree,
  StatusResult,
  TestCaseDetail,
};
export type Scope = { release?: string | undefined; env?: string | undefined };
export type PlanItemStatus = 'todo' | 'done' | 'blocked' | 'review';
/** GET /api/plans/:key — a plan file plus computed item status (status is optional until the contract types it). */
export interface PlanView {
  key: string;
  title: string;
  release?: string;
  environment?: string;
  due?: string;
  items?: {
    test_case: string;
    assignee?: string;
    environment?: string;
    due?: string;
    status?: PlanItemStatus;
  }[];
}
export type ReportQuery = Scope & {
  plan?: string | undefined;
  format: 'md' | 'html';
  audience: 'internal' | 'customer';
  locale: string;
};

/** A transport turns a request into a response; the mock API (src/mock/) replaces the network one in dev. */
export interface Transport {
  fetch(path: string, init?: RequestInit): Promise<Response>;
  blobUrl(sha256: string): string;
}

let transport: Transport = {
  fetch: (path, init) => fetch(path, init),
  blobUrl: (sha) => `api/blobs/${sha}`,
};
export const setTransport = (t: Transport): void => {
  transport = t;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Build a query string from defined values only. Pure; tested. */
export function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

async function call<T>(path: string, init?: RequestInit, as: 'json' | 'text' = 'json'): Promise<T> {
  // Relative paths ('api/…') keep the SPA working when served from a sub-path.
  const res = await transport.fetch(path, init);
  if (!res.ok) {
    let code = 'http';
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: { code: string; message: string } };
      if (body.error) ({ code, message } = body.error);
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, code, message);
  }
  return (as === 'json' ? res.json() : res.text()) as Promise<T>;
}
/** Marks writes as coming from this app: the server refuses writes a cross-site page could send (docs/spec/security.md). */
const WRITE = { 'X-IW-Request': '1' };
const post = <T>(path: string, body: unknown) =>
  call<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...WRITE },
    body: JSON.stringify(body),
  });
const scopeQ = (s: Scope) => ({ release: s.release, env: s.env });

export const api = {
  project: () => call<ProjectInfo>('api/project'),
  status: (s: Scope) => call<StatusResult>(`api/status${query(scopeQ(s))}`),
  specs: (s: Scope) => call<SpecTree>(`api/specs${query(scopeQ(s))}`),
  testCase: (key: string, s: Scope) => call<TestCaseDetail>(`api/test-cases/${key}${query(scopeQ(s))}`),
  fixtures: () => call<FixtureDetail[]>('api/fixtures'),
  fixture: (key: string) => call<FixtureDetail>(`api/fixtures/${key}`),
  plans: () => call<PlanView[]>('api/plans'),
  plan: (key: string) => call<PlanView>(`api/plans/${key}`),
  runs: (p: Scope & { tc?: string; limit?: number }) =>
    call<RunSummary[]>(`api/runs${query({ ...scopeQ(p), tc: p.tc, limit: p.limit })}`),
  run: (id: string) => call<RunDetail>(`api/runs/${id}`),
  createRun: (input: ManualRunInput) => post<ManualRunResult>('api/runs', input),
  review: (id: string, input: ReviewInput) => post<unknown>(`api/runs/${id}/judgements`, input),
  uploadBlob: (file: Blob, name: string) =>
    call<BlobResult>('api/blobs', {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': safeName(name),
        ...WRITE,
      },
      body: file,
    }),
  report: (q: ReportQuery) => call<string>(reportPath(q), undefined, 'text'),
  blobUrl: (sha256: string) => transport.blobUrl(sha256),
};

/** Header values must be ASCII: keep letters, digits, '.', '-' and '_'. Pure; tested. */
export const safeName = (name: string) => name.replace(/[^\w.-]+/g, '_').slice(-120) || 'file';

export const reportPath = (q: ReportQuery) =>
  `api/report${query({ release: q.release, env: q.env, plan: q.plan, format: q.format, audience: q.audience, locale: q.locale })}`;
