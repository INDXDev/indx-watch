/**
 * HTTP API between the web UI / http store adapter and the server (docs/architecture.md#http-api).
 * FROZEN CONTRACT for v0.1: additive changes only. All JSON; errors are { error: { code, message } } with 4xx/5xx.
 */
import type { Actor, Locale, RunRecord, StepStatus, TestCase, Fixture, Judgement } from '@indx-watch/bundle';
import type { Decision, ReportData, Scope, Status, StatusResult, TestCaseStatus } from '@indx-watch/core';
import type { IdentityProvider, ObjectStore } from '@indx-watch/store';
import type { Model } from '@indx-watch/core';

export const ROUTES = {
  health: 'GET /healthz',
  project: 'GET /api/project',
  status: 'GET /api/status?release=&env=',
  specs: 'GET /api/specs?release=&env=',
  testCase: 'GET /api/test-cases/:key?release=&env=',
  fixtures: 'GET /api/fixtures',
  fixture: 'GET /api/fixtures/:key',
  plans: 'GET /api/plans',
  plan: 'GET /api/plans/:key',
  runs: 'GET /api/runs?tc=&release=&env=&limit=',
  run: 'GET /api/runs/:id',
  createRun: 'POST /api/runs',
  addJudgement: 'POST /api/runs/:id/judgements',
  uploadBlob: 'POST /api/blobs',
  blob: 'GET /api/blobs/:sha256',
  report: 'GET /api/report?release=&env=&plan=&format=md|html&audience=internal|customer&locale=',
  storeGet: 'GET /api/store/objects/*',
  storeHead: 'HEAD /api/store/objects/*',
  storePut: 'PUT /api/store/objects/* (If-None-Match: * → 412 when it exists)',
  storeList: 'GET /api/store/list?prefix=&startAfter=&limit=',
} as const;

export interface ProjectInfo {
  project: { key: string; name: string; source_locale: Locale; locales: Locale[]; default_environment?: string; current_release?: string };
  releases: { version: string; title?: string; state: string }[];
  environments: { name: string; title: string; base_url: string; guide?: string; access?: string }[];
  identity: Actor;
  mode: 'local' | 'hosted';
  sync: { configured: boolean; store?: string; lastSyncAt?: string; lastError?: string };
  /** problems from loading the bundle (shown as a banner) */
  problems: { severity: string; message: string; file?: string }[];
}

export interface SpecTree {
  scope: Scope;
  features: {
    key: string;
    title: string;
    i18n?: unknown;
    useCases: {
      key: string;
      title: string;
      priority: string;
      status: Status;
      done: boolean;
      i18n?: unknown;
      criteria: { key: string; text: string; status: Status; testCases: { key: string; title: string; mode: string; status: Status }[]; i18n?: unknown }[];
    }[];
  }[];
}

export interface RunSummary {
  id: string;
  testCase: string;
  version: string;
  verdict: string;
  rule: number;
  stale: boolean;
  actor: Actor;
  source: string;
  release?: string;
  environment?: string;
  commit?: string;
  at: string;
  evidence: number;
}

export interface TestCaseDetail {
  key: string;
  file: string;
  version: string;
  priority: string;
  useCase: string;
  data: TestCase;
  fixtures: { key: string; title: string; kind: string; version: string; rows?: string[]; values?: Record<string, string>[] }[];
  status: TestCaseStatus;
  runs: RunSummary[];
}

export interface FixtureDetail {
  key: string;
  file: string;
  version: string;
  data: Fixture;
  files: { name: string; sha256: string; size: number; pointer: boolean; media_type?: string }[];
  /** dataset rows (first 200), or seed JSON text; account shows username + secret_ref only */
  preview?: { rows?: Record<string, string>[]; text?: string };
  usedBy: string[];
}

export interface RunDetail {
  record: RunRecord;
  judgements: Judgement[];
  decision: Decision;
  stale: boolean;
  testCase: { key: string; title: string; currentVersion: string };
}

/** POST /api/runs (manual runner). Actor comes from the server's IdentityProvider, never from the body. */
export interface ManualRunInput {
  test_case: string; // key
  release?: string;
  environment?: string;
  started_at?: string;
  locale?: Locale;
  steps: { index: number; status: StepStatus; note?: string; evidence?: string[] }[];
  /** the tester's verdict → a human judgement; 'blocked'/'skipped' also set run.reported */
  verdict: 'pass' | 'fail' | 'blocked' | 'skipped';
  note?: string;
  rows?: string[];
}
export interface ManualRunResult {
  run: RunRecord;
  decision: Decision;
}

/** POST /api/runs/:id/judgements (review). */
export interface ReviewInput {
  verdict: 'pass' | 'fail' | 'blocked' | 'skipped';
  reason: string;
}

/** POST /api/blobs: raw body; headers Content-Type and X-Filename. */
export interface BlobResult {
  sha256: string;
  size: number;
  media_type: string;
}

/** Dependencies of createApp (ADR 0007). */
export interface AppDeps {
  mode: 'local' | 'hosted';
  /** current model; implementations cache and refresh */
  loadModel(): Promise<{ model: Model; problems: ProjectInfo['problems'] }>;
  /** append a record (local replica on Node; store + index on Workers) */
  writeRecord(record: import('@indx-watch/bundle').AnyRecord): Promise<void>;
  putBlob(data: Uint8Array, contentType: string): Promise<string>;
  getBlob(sha256: string): Promise<Uint8Array | null>;
  identity: IdentityProvider;
  /** exposed under /api/store/* when present (hosted mode) */
  objects?: ObjectStore;
  /** called after /api/store PUT of a log object, so the index can ingest it */
  onLogObject?(key: string): Promise<void>;
  syncInfo?(): ProjectInfo['sync'];
  /** serves the SPA (Node: from disk; Workers: assets binding) */
  assets?(request: Request): Promise<Response>;
}

/** Report rendering options (docs/spec/reports.md). */
export interface RenderOptions {
  format: 'md' | 'html';
  locale: Locale;
  evidence: 'none' | 'links' | 'embed';
  getBlob?(sha256: string): Promise<Uint8Array | null>;
}

export type { ReportData, StatusResult };
