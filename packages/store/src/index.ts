/** Runtime-neutral exports (safe on Workers). Node-only factories: '@indx-watch/store/node'; Workers: '@indx-watch/store/workers'. */
export * from './ports.js';
export { memoryObjectStore, memoryIndex } from './adapters/memory.js';
export { s3ObjectStore } from './adapters/s3.js';
export { httpObjectStore } from './adapters/http.js';
export { createResultStore } from './result-store.js';
