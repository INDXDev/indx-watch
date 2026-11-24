/** The version of this CLI: injected by the build, else read from package.json when run from source. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { here } from './util.js';

declare const __IW_VERSION__: string | undefined;

export const VERSION: string =
  typeof __IW_VERSION__ === 'string'
    ? __IW_VERSION__
    : (JSON.parse(readFileSync(join(here, '../package.json'), 'utf8')) as { version: string }).version;
