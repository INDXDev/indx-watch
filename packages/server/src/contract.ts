/**
 * HTTP API between the web UI / http store adapter and the server (docs/architecture.md#http-api).
 * FROZEN CONTRACT for v0.1: additive changes only. All JSON; errors are { error: { code, message } } with 4xx/5xx.
 */
import type { Actor, Fixture, Judgement, Locale, RunRecord, StepStatus, TestCase } from '@indx-watch/bundle';
import type {
  Decision,
  Model,
  ReportData,
  Scope,
  Status,
  StatusResult,
  TestCaseStatus,
} from '@indx-watch/core';
import type { IdentityProvider, ObjectStore } from '@indx-watch/store';

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
  editTestCase:
    'PATCH /api/test-cases/:key (workspace mode; TestCaseEdit → { file, record }; docs/spec/web.md#editing-in-workspace-mode)',
  createRun: 'POST /api/runs',
  addJudgement: 'POST /api/runs/:id/judgements',
  approveBaseline: 'POST /api/runs/:id/baselines (humans only; docs/spec/web.md#visual-baselines)',
  uploadBlob: 'POST /api/blobs',
  blob: 'GET /api/blobs/:sha256',
  report: 'GET /api/report?release=&env=&plan=&format=md|html&audience=internal|customer&locale=',
  storeGet: 'GET /api/store/objects/*',
  storeHead: 'HEAD /api/store/objects/*',
  storePut: 'PUT /api/store/objects/* (create-only: 412 when it exists; manifest, log objects, blobs)',
  storeList: 'GET /api/store/list?prefix=&startAfter=&limit=',
  sign: 'POST /api/sign (Authorization: Bearer <GitHub OIDC token>; { records } → { records } signed; docs/spec/security.md#github-oidc)',
  mcp: 'POST /mcp (MCP over Streamable HTTP, stateless; docs/spec/agents.md#mcp-server)',
  createShare:
    'POST /api/shares?release=&env=&plan=&audience=&locale=&evidence=none|embed&days= (v0.2, hosted)',
  shares: 'GET /api/shares',
  revokeShare: 'DELETE /api/shares/:id',
  openShare: 'GET /s/:token (no identity; the frozen HTML report of an active link, else 404)',
} as const;

/**
 * Response types per route (all JSON): project → ProjectInfo; status → StatusResult; specs → SpecTree; testCase → TestCaseDetail;
 * fixtures → FixtureDetail[]; fixture → FixtureDetail; plans → PlanView[]; plan → PlanView; runs → RunSummary[]; run → RunDetail;
 * createRun → ManualRunResult; addJudgement → ReviewResult; approveBaseline → { baseline: BaselineRecord }; uploadBlob → BlobResult; report → text/markdown or text/html.
 *
 * Translations: wherever an entity's `i18n` tables are returned, the server sets `status: "stale"` on a table whose source_hash no
 * longer matches the current source, so clients only need to check `status`.
 */
export interface PlanView {
  key: string;
  title: string;
  i18n?: unknown;
  release?: string;
  environment?: string;
  due?: string;
  items: {
    test_case: string;
    assignee?: string;
    environment?: string;
    due?: string;
    status: 'todo' | 'done' | 'blocked' | 'review';
  }[];
}

export interface ReviewResult {
  judgement: Judgement;
  decision: Decision;
}

/** GET /api/store/list response. PUT returns 201 (created), 412 (exists) or 400 (not a valid store object). GET/HEAD 404 when absent. */
export interface StoreListResponse {
  keys: { key: string; size: number; etag?: string }[];
  truncated: boolean;
}

export interface ProjectInfo {
  project: {
    key: string;
    name: string;
    source_locale: Locale;
    locales: Locale[];
    default_environment?: string;
    current_release?: string;
  };
  releases: { version: string; title?: string; state: string; i18n?: unknown }[];
  environments: {
    name: string;
    title: string;
    base_url: string;
    guide?: string;
    access?: string;
    i18n?: unknown;
  }[];
  identity: Actor;
  mode: 'local' | 'hosted';
  sync: { configured: boolean; store?: string; lastSyncAt?: string; lastError?: string };
  /** problems from loading the bundle (shown as a banner) */
  problems: { severity: string; message: string; file?: string }[];
  /** source for `iw clone` (this hosted app, or the local `[store].url`) */
  share: { clone: string | null };
  /** "Not you?" (iw_tester cookie), uploads and (v0.2) creating report share links are possible here */
  can: { declare: boolean; upload: boolean; share: boolean; edit?: boolean };
  /** newest bundle snapshot, when there is one */
  snapshot?: SnapshotSummary;
}

/** GET /api/shares item and DELETE /api/shares/:id response (docs/spec/reports.md#share-links); never the token. */
export interface ShareLink {
  id: string;
  at: string;
  actor: Actor;
  audience: 'internal' | 'customer';
  locale?: Locale;
  release?: string;
  environment?: string;
  plan?: string;
  expires_at: string;
  state: 'active' | 'expired' | 'revoked';
  opens: number;
  revoked?: { at: string; actor: Actor };
}
/** POST /api/shares response (201): the URL is returned only here. */
export interface ShareCreated {
  link: ShareLink;
  url: string;
}

/** GET /api/snapshots item: a bundle record (newest first). */
export interface SnapshotSummary {
  id: string;
  at: string;
  actor: Actor;
  source: string;
  commit?: string;
  ref?: string;
  files: number;
  dirty?: boolean;
  message?: string;
  sha256: string;
  /** the actor claims a verified `via` but the record has no valid signature (docs/spec/security.md#signed-records) */
  unverified?: true;
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
      criteria: {
        key: string;
        text: string;
        status: Status;
        testCases: {
          key: string;
          title: string;
          mode: string;
          status: Status;
          lifecycle: 'draft' | 'ready' | 'deprecated';
          i18n?: unknown;
          /** flake rate in the scope, only when flaky (docs/spec/concepts.md#flaky-tests) */
          flaky?: TestCaseStatus['flaky'];
        }[];
        i18n?: unknown;
      }[];
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
  /** the record claims a verified `via` without a valid signature (docs/spec/security.md#signed-records) */
  unverified?: true;
}

export interface TestCaseDetail {
  key: string;
  file: string;
  version: string;
  priority: string;
  useCase: string;
  data: TestCase;
  /** values: selected dataset rows; for account fixtures `[{ username }]` only, never secrets */
  fixtures: {
    key: string;
    title: string;
    kind: string;
    version: string;
    rows?: string[];
    values?: Record<string, string>[];
    i18n?: unknown;
  }[];
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
  testCase: { key: string; title: string; currentVersion: string; i18n?: unknown };
  /** run and judgement IDs whose verified `via` has no valid signature (docs/spec/security.md#signed-records) */
  unverified?: string[];
  /** sha256 of this run's screenshots that are the current approved baseline of their name (v0.2) */
  baselines?: string[];
}

/** POST /api/runs/:id/baselines: approve one PNG screenshot of the run as its visual baseline. */
export interface BaselineInput {
  sha256: string;
}

/** POST /api/runs (manual runner). Actor comes from the server's IdentityProvider, never from the body. */
/** PATCH /api/test-cases/:key body (v0.2, workspace mode): only the fields that changed; `priority: null` removes it. */
export interface TestCaseEdit {
  title?: string;
  priority?: string | null;
  steps?: { instruction: string; expected: string }[];
}

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
  /** content language the reviewer read (v0.2) */
  locale?: Locale;
}

/** POST /api/blobs: raw body; headers Content-Type and X-Filename (ASCII only; clients replace other characters with '_'). */
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
  /** the signer writeRecord applies, so share links can refuse a record that would not verify (hosted) */
  signRecord?<R extends import('@indx-watch/bundle').AnyRecord>(record: R): Promise<R>;
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
  /** prefix for evidence links in Markdown (`iw report --evidence-base`) */
  evidenceBase?: string;
}

export type { ReportData, StatusResult };
