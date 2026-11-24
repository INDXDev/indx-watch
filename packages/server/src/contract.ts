/**
 * HTTP API between the web UI / http store adapter and the server (docs/architecture.md#http-api).
 * FROZEN CONTRACT for v0.1: additive changes only. All JSON; errors are { error: { code, message } } with 4xx/5xx.
 */
import type {
  Actor,
  FileRecord,
  Fixture,
  Judgement,
  Locale,
  RunRecord,
  StepStatus,
  TestCase,
} from '@indx-watch/bundle';
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
  issue:
    'GET /api/issue?ref= (a run ID, TC-n, AC-n.m or UC-n → IssueResult: the prefilled GitHub issue; docs/spec/integrations.md#github-issues)',
  editTestCase:
    'PATCH /api/test-cases/:key (workspace mode; TestCaseEdit → { file, record? }; docs/spec/web.md#editing-in-workspace-mode)',
  createFixture: 'POST /api/fixtures (lead; FixtureInput → FixtureSaved; docs/spec/web.md#test-data)',
  editFixture: 'PATCH /api/fixtures/:key (lead; FixtureInput → FixtureSaved)',
  deleteFixture: 'DELETE /api/fixtures/:key (lead; git mode; → FixtureSaved)',
  invite:
    'POST /api/plans/:key/invites (lead; InviteInput → InviteResult; docs/spec/security.md#customer-uat)',
  uninvite: 'DELETE /api/plans/:key/invites/:email?items= (lead; → InviteResult)',
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
  secrets:
    'GET /api/secrets (v0.5; → SecretList, only the secrets shared with you; docs/spec/security.md#secrets)',
  saveSecret: 'PUT /api/secrets/:name (tester; SecretInput → SecretView)',
  deleteSecret: 'DELETE /api/secrets/:name (tester)',
  revealSecret: 'POST /api/secrets/:name/reveal (→ { value }; recorded)',
  access: 'GET /api/access?who= (lead; → AccessOverview; docs/spec/security.md#sharing)',
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
  /** (v0.4) keys of the features this identity owns; the web app starts in "My features" when not empty */
  owns?: string[];
  mode: 'local' | 'hosted';
  /** (v0.5) where "Open as GitHub issue" goes: `[github] repo`, else the git remote; absent: the button is hidden */
  github?: { repo: string };
  sync: { configured: boolean; store?: string; lastSyncAt?: string; lastError?: string };
  /** problems from loading the bundle (shown as a banner) */
  problems: { severity: string; message: string; file?: string }[];
  /** source for `iw clone` (this hosted app, or the local `[store].url`) */
  share: { clone: string | null };
  /** "Not you?" (iw_tester cookie), uploads and (v0.2) creating report share links are possible here */
  can: { declare: boolean; upload: boolean; share: boolean } & {
    run?: boolean;
    review?: boolean;
    approve?: boolean;
    /** (v0.2) edit test case definitions in workspace mode (PATCH /api/test-cases/:key) */
    edit?: boolean;
    /** (v0.5) create, edit and remove test data (POST /api/fixtures, PATCH and DELETE /api/fixtures/:key) */
    data?: boolean;
    /** (v0.5) the server holds IW_SECRETS_KEY, so `iw:` secrets can be read (and, with `data`, written) */
    secrets?: boolean;
  };
  /** (v0.5) the role table, so the app can say who has access; not for customers (docs/spec/security.md#sharing) */
  team?: import('@indx-watch/bundle').Roles;
  /** (v0.3) the role of this identity (docs/spec/security.md#roles); `lead` where no roles are configured */
  role?: import('@indx-watch/bundle').Role;
  /** (v0.5) a public deploy: anonymous viewers only, every write refused (docs/spec/security.md#public-deploys) */
  readOnly?: true;
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
    /** (v0.4) docs/spec/concepts.md#feature-owners */
    owners?: string[] | undefined;
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
    /** the fixture's files, downloadable from GET /api/blobs/:sha256 (v0.4) */
    files?: { name: string; sha256: string; size: number; media_type?: string }[];
    i18n?: unknown;
    /** (v0.5) an account's secret reference; an `iw:` one can be revealed (POST /api/secrets/:name/reveal) */
    secret_ref?: string;
    /** (v0.5) not shared with you: no values or files (docs/spec/security.md#sharing) */
    hidden?: true;
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
  /** dataset rows (first 1,000; `total` counts all), or seed JSON text; account shows username + secret_ref only */
  preview?: { rows?: Record<string, string>[]; columns?: string[]; total?: number; text?: string };
  usedBy: string[];
  /** (v0.5) who can see it and why (docs/spec/security.md#sharing) */
  access: Access[];
  /** (v0.5) not shared with you: only key, title and kind */
  hidden?: true;
}

/**
 * (v0.5) One line of "who has access": `everyone` (no roles configured: whoever opens the app), the role table's
 * `lead` entries, the team (`tester`, `viewer` and `default` entries) when the item is not restricted, or an entry
 * of its `shared_with`. `who` is an email, an ID or `group:<name>`.
 */
export interface Access {
  who: string;
  why: 'everyone' | 'lead' | 'team' | 'shared';
  role?: import('@indx-watch/bundle').Role;
}

/** (v0.5) GET /api/secrets: a secret's metadata; the value only through POST /api/secrets/:name/reveal. */
export interface SecretView {
  name: string;
  /** `iw:<name>`, for an account's or a hook's `secret_ref` */
  ref: string;
  title?: string;
  username?: string;
  notes?: string;
  shared_with?: string[];
  /** the last `set` */
  at: string;
  actor: Actor;
  /** fixture keys and environment names whose secret references name it */
  usedBy: string[];
  access: Access[];
  /** set, delete and reveal events, newest first (up to 50) */
  history: { action: 'set' | 'delete' | 'reveal'; at: string; actor: Actor }[];
}
export interface SecretList {
  /** false: the server has no IW_SECRETS_KEY */
  available: boolean;
  secrets: SecretView[];
}
/** (v0.5) PUT /api/secrets/:name body; `value` is required to create; `shared_with: null` shares with the team. */
export interface SecretInput {
  title?: string;
  username?: string;
  notes?: string;
  value?: string;
  shared_with?: string[] | null;
}

/** (v0.5) GET /api/access?who=: the people known to the project and, for one of them, what they can open. */
export interface AccessOverview {
  /** emails from the role table, sharing lists, feature owners and plan assignees */
  people: string[];
  groups: string[];
  who?: string;
  role?: import('@indx-watch/bundle').Role;
  items?: {
    type: 'fixture' | 'secret';
    key: string;
    title: string;
    can: boolean;
    why: Access['why'] | 'none';
    /** without access: the `group:` entries that would give it to a member */
    groups?: string[];
  }[];
}

export interface RunDetail {
  record: RunRecord;
  judgements: Judgement[];
  decision: Decision;
  stale: boolean;
  testCase: { key: string; title: string; currentVersion: string; i18n?: unknown; links?: string[] };
  /** run and judgement IDs whose verified `via` has no valid signature (docs/spec/security.md#signed-records) */
  unverified?: string[];
  /** sha256 of this run's screenshots that are the current approved baseline of their name (v0.2) */
  baselines?: string[];
}

/** POST /api/runs/:id/baselines: approve one PNG screenshot of the run as its visual baseline. */
export interface BaselineInput {
  sha256: string;
}

/** PATCH /api/test-cases/:key body (v0.2, workspace mode): only the fields that changed; `priority: null` removes it. */
export interface TestCaseEdit {
  title?: string;
  priority?: string | null;
  steps?: { instruction: string; expected: string }[];
  /** (v0.5) issue URLs of this test case; `null` removes them */
  links?: string[] | null;
}

/**
 * POST /api/fixtures and PATCH /api/fixtures/:key body (v0.5, docs/spec/web.md#test-data). `kind` only on create;
 * `table` rewrites a dataset's one data file, `json` a seed's payload; `add` adds or replaces data files (base64).
 */
export interface FixtureInput {
  title?: string;
  kind?: 'dataset' | 'seed' | 'file' | 'account';
  notes?: string | null;
  table?: { columns: string[]; rows: string[][]; row_key?: string };
  json?: string;
  account?: { username: string; secret_ref: string; fields?: Record<string, string> };
  add?: { name: string; data: string }[];
  remove?: string[];
  /** (v0.5) who may see it; null: the whole team (docs/spec/security.md#sharing) */
  shared_with?: string[] | null;
}
/** Answer of the fixture writes: the fixture and the bundle paths written and removed. */
export interface FixtureSaved {
  key: string;
  file: string;
  changed: string[];
  removed: string[];
}

/** POST /api/plans/:key/invites body (v0.3, docs/spec/security.md#customer-uat); no `items`: every item of the plan. */
export interface InviteInput {
  email: string;
  items?: string[];
}

/**
 * Answer of the invite routes: the saved plan version (no `record` when no item changed), the items whose assignee
 * changed, those taken from another assignee, and what happened to the Access policy.
 */
export interface InviteResult {
  file: string;
  record?: FileRecord;
  email: string;
  plan: string;
  items: string[];
  reassigned: string[];
  revoked: boolean;
  access: 'added' | 'removed' | 'kept' | 'manual';
}

/** POST /api/runs (manual runner). Actor comes from the server's IdentityProvider, never from the body. */
export interface ManualRunInput {
  test_case: string; // key
  release?: string;
  environment?: string;
  started_at?: string;
  locale?: Locale;
  /** `checks`: which of the step's checks were ticked, in source order (v0.4) */
  steps: { index: number; status: StepStatus; note?: string; evidence?: string[]; checks?: boolean[] }[];
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
