/**
 * Node-side factories. CONTRACT: signatures frozen; implementation T-104.
 */
import type { StoreConfig } from '@indx-watch/bundle';
import type { ContextProvider, IdentityProvider, Index, LocalReplica, ObjectStore } from '../ports.js';

/** ObjectStore for a store URL (file://, s3://, https://). file:// paths resolve relative to bundleDir. */
export function openObjectStore(config: StoreConfig, opts: { bundleDir: string; env?: Record<string, string | undefined> }): ObjectStore {
  void config;
  void opts;
  throw new Error('not implemented (T-104)');
}

/** Local replica at <bundleDir>/runs/ (docs/spec/sync.md#local-replica-layout). */
export function openReplica(bundleDir: string): LocalReplica {
  void bundleDir;
  throw new Error('not implemented (T-104)');
}

/** Identity for local CLI/serve: IW_ACTOR env → GitHub Actions → git config → OS user (docs/spec/security.md#identity). */
export function processIdentity(opts?: { env?: Record<string, string | undefined>; cwd?: string }): IdentityProvider {
  void opts;
  throw new Error('not implemented (T-104)');
}

/** Build/CI context from git and GitHub Actions env (docs/spec/integrations.md#ci-identity). */
export function processContext(opts?: { env?: Record<string, string | undefined>; cwd?: string }): ContextProvider {
  void opts;
  throw new Error('not implemented (T-104)');
}

/** Index on Node: node:sqlite file at <bundleDir>/cache/index.sqlite when available, otherwise in memory. */
export function openNodeIndex(bundleDir: string, opts?: { memory?: boolean }): Promise<Index> {
  void bundleDir;
  void opts;
  throw new Error('not implemented (T-104)');
}
