#!/usr/bin/env node
/** `iw` / `indx-watch` entry point. */
import { main } from './cli.js';
import { COMMANDS } from './commands/index.js';

declare const __IW_VERSION__: string | undefined;
const version = typeof __IW_VERSION__ === 'string' ? __IW_VERSION__ : '0.1.1';

void main(COMMANDS, process.argv.slice(2), version);
