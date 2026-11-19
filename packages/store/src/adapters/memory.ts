import type { Index, ObjectStore } from '../ports.js';
/** In-memory ObjectStore (tests). CONTRACT; implementation T-104. */
export function memoryObjectStore(url = 'memory://'): ObjectStore {
  void url;
  throw new Error('not implemented (T-104)');
}
/** In-memory Index. CONTRACT; implementation T-104. */
export function memoryIndex(): Index {
  throw new Error('not implemented (T-104)');
}
