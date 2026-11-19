import type { ObjectStore } from '../ports.js';
/** ObjectStore over a hosted server's /api/store/* (packages/server/src/contract.ts). CONTRACT; implementation T-104. */
export function httpObjectStore(opts: { baseUrl: string; headers?: () => Promise<Record<string, string>> }): ObjectStore {
  void opts;
  throw new Error('not implemented (T-104)');
}
