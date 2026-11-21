/**
 * Ports (docs/architecture.md#ports-and-adapters, ADR 0009).
 * FROZEN CONTRACT for v0.1: additive changes only.
 */
import type { Actor, AnyRecord, Build, CiContext } from '@indx-watch/bundle';

// ---------- ObjectStore ----------
export interface ObjectInfo {
  key: string;
  size: number;
  etag?: string | undefined;
}

export interface ObjectStore {
  /** Human-readable location, e.g. 's3://bucket/prefix'. Never contains credentials. */
  readonly url: string;
  get(key: string): Promise<Uint8Array | null>;
  head(key: string): Promise<ObjectInfo | null>;
  /**
   * Write an object. With ifNoneMatch, resolves to false (and does not overwrite) when the key exists;
   * adapters without native conditional writes emulate it with head() (best effort).
   */
  put(
    key: string,
    body: Uint8Array | string,
    opts?: { ifNoneMatch?: boolean; contentType?: string },
  ): Promise<boolean>;
  /** Lexicographic listing; at most `limit` (default 1000) keys after `startAfter`. */
  list(opts: {
    prefix: string;
    startAfter?: string;
    limit?: number;
  }): Promise<{ keys: ObjectInfo[]; truncated: boolean }>;
  delete(key: string): Promise<void>;
}

/** Thrown by adapters for transport/auth failures (CLI exit code 4). */
export class StoreError extends Error {
  constructor(
    public code: 'not-found' | 'unauthorized' | 'conflict' | 'network' | 'invalid' | 'wrong-project',
    message: string,
    public override cause?: unknown,
  ) {
    super(message);
  }
}

// ---------- ResultStore (protocol over an ObjectStore; docs/spec/sync.md#store-layout) ----------
export interface LogEntry {
  /** object key, e.g. 'v1/log/01JF…json' */
  key: string;
  writer: string;
  records: AnyRecord[];
  /** records that failed validation (kept out of `records`) */
  invalid: number;
}

export interface ResultStore {
  readonly objects: ObjectStore;
  /** Create or verify indx-watch-store.json for this project. Throws StoreError('wrong-project'). */
  init(projectId: string): Promise<void>;
  /** Upload records as one or more log objects (≤1000 records each). Returns the keys written. */
  appendLog(writer: string, records: AnyRecord[], now?: number): Promise<string[]>;
  listLog(opts: { startAfter?: string; limit?: number }): Promise<{ keys: string[]; truncated: boolean }>;
  readLog(key: string): Promise<LogEntry>;
  hasBlob(sha256: string): Promise<boolean>;
  /** Verifies the hash before writing; idempotent. */
  putBlob(sha256: string, data: Uint8Array, contentType?: string): Promise<void>;
  /** Verifies the hash after reading; null if absent. */
  getBlob(sha256: string): Promise<Uint8Array | null>;
  /** Upload a log snapshot of these log objects (ascending keys; docs/spec/sync.md#log-snapshots-v02). Returns its key. */
  putLogSnapshot(projectId: string, logs: LogCopy[]): Promise<string>;
  /**
   * The newest log snapshot whose key is not after `now`, or null when there is none.
   * Throws StoreError('invalid') when it is corrupt, newer, out of order or of another project.
   */
  readLogSnapshot(
    projectId: string,
    now?: number,
  ): Promise<{ key: string; upto: string; logs: LogCopy[] } | null>;
}

/** A log object as a log snapshot holds it: its key and its records. */
export type LogCopy = Pick<LogEntry, 'key' | 'records'>;

// ---------- Local replica (.indx-watch/runs/) ----------
export interface LocalReplica {
  /** Write a record if absent (by id). Returns false when it already existed. */
  putRecord(record: AnyRecord): Promise<boolean>;
  /** Overwrite the record with this ID. Only sync calls it, to apply the merge rule (docs/spec/sync.md#merge-rules). */
  replaceRecord(record: AnyRecord): Promise<void>;
  getRecord(id: string): Promise<AnyRecord | null>;
  /** All records (validated); invalid files are reported via onInvalid. */
  records(onInvalid?: (file: string, error: string) => void): Promise<AnyRecord[]>;
  putBlob(data: Uint8Array, contentType?: string): Promise<string /* sha256 */>;
  getBlob(sha256: string): Promise<Uint8Array | null>;
  hasBlob(sha256: string): Promise<boolean>;
  /** Called after each local write; returns an unsubscribe function. */
  onChange(listener: () => void): () => void;
}

// ---------- Index ----------
export interface IndexFilter {
  kinds?: AnyRecord['kind'][];
  testCaseId?: string;
  release?: string;
  since?: string;
  limit?: number;
}

export interface Index {
  /**
   * Add records read from the log object `logKey` (none: unknown, sorts last). Another body with a held ID replaces
   * the held copy when `trust` holds for it and not for the held copy, or (both or neither) its log key sorts first
   * (docs/spec/sync.md#merge-rules); both cases are noted in the meta key CONFLICTS_META. Safe to run concurrently.
   * Returns the number of records added or replaced plus conflicts noted.
   */
  ingest(
    records: AnyRecord[],
    logKey?: string,
    trust?: (record: AnyRecord) => Promise<boolean>,
  ): Promise<number>;
  records(filter?: IndexFilter): Promise<AnyRecord[]>;
  /** Current definition files (path → canonical text) when definitions come from snapshots/workspace. */
  setDefinitions(files: Map<string, string>, meta: { source: string; at: string }): Promise<void>;
  definitions(): Promise<{ files: Map<string, string>; source: string; at: string } | null>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  reset(): Promise<void>;
}

// ---------- Identity and build context ----------
export interface IdentityProvider {
  /** Identity of the current process, or of an HTTP request on the server. Throws StoreError('unauthorized') when a required identity is missing. */
  current(request?: Request): Promise<Actor>;
}

export interface ContextProvider {
  build(): Promise<Build>;
  ci(): Promise<CiContext | undefined>;
}

// ---------- Execution ports (v0.2: docs/spec/agents.md#agent-execution-mode-v02) ----------
export interface BrowserObservation {
  url: string;
  title: string;
  /** accessibility tree with element refs (e1, e2, …), truncated */
  tree: string;
  screenshot?: Uint8Array | undefined;
}
export type BrowserAction =
  | { type: 'navigate'; url: string }
  | { type: 'click'; ref: string }
  | { type: 'fill'; ref: string; value: string }
  | { type: 'press'; key: string }
  | { type: 'select'; ref: string; option: string };

export interface BrowserSession {
  observe(): Promise<BrowserObservation>;
  act(action: BrowserAction): Promise<{ ok: boolean; error?: string | undefined }>;
  close(): Promise<void>;
}
export interface BrowserProvider {
  open(opts: { baseUrl: string; viewport?: { width: number; height: number } }): Promise<BrowserSession>;
}

export interface LlmJudgement {
  verdict: 'pass' | 'fail' | 'unknown';
  confidence: number;
  reason: string;
  model: string;
}
/** What a browser agent does next in one step: a browser action, or the step's result. */
export type AgentAction =
  | BrowserAction
  | { type: 'step_done'; status: 'pass' | 'fail' | 'blocked'; note: string };
export interface AgentStepInput {
  /** the test case's key and title */
  goal: string;
  step: { index: number; instruction: string; expected: string };
  observation: BrowserObservation;
  /** actions taken in this step so far, with their outcome */
  history: string[];
}
export interface LlmClient {
  judge(input: {
    rubric: string[];
    expected: string;
    observation: BrowserObservation;
  }): Promise<LlmJudgement>;
  /** The next action of a browser agent (agent mode); optional, so judge-only clients stay valid. */
  next?(input: AgentStepInput): Promise<AgentAction>;
}

// ---------- GitHub OIDC (docs/spec/security.md#github-oidc) ----------
/** The claims of a verified GitHub Actions OIDC ID token that signing relies on. */
export interface GithubOidcClaims {
  repository: string;
  repository_id: string;
  actor: string;
  run_id: string;
}

export interface OidcVerifier {
  /** Verify signature (issuer JWKS), issuer, audience and expiry. Throws StoreError('unauthorized'). */
  verify(token: string, audience: string): Promise<GithubOidcClaims>;
}
