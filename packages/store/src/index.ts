/** Runtime-neutral exports (safe on Workers). Node-only factories: '@indx-watch/store/node'; Workers: '@indx-watch/store/workers'. */

export { githubOidcVerifier, oidcAudience, oidcSigner, usesGithubOidc } from './adapters/github-oidc.js';
export { httpObjectStore } from './adapters/http.js';
export { memoryIndex, memoryObjectStore } from './adapters/memory.js';
export { s3ObjectStore } from './adapters/s3.js';
export { type AgentRunInput, type AgentStepResult, runAgent } from './agent.js';
export { fakeBrowserProvider, fakeLlmClient } from './fakes.js';
export { CONFLICTS_META, conflictMessage, mergeStep, type Trust } from './merge.js';
export * from './ports.js';
export { createReplica } from './replica.js';
export { createResultStore, LOG_PREFIX, SNAPSHOT_PREFIX } from './result-store.js';
export { blobRefs, checkRecord, idTime, ulidTime } from './util.js';
