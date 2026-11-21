/** Cloudflare Workers entry bundled into dist/worker.js for `iw deploy`. */
import { createWorker } from '@indx-watch/server/worker';
import { TOOL_OUTPUTS } from './tools.js';

export default createWorker(TOOL_OUTPUTS);
