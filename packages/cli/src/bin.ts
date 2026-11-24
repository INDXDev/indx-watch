#!/usr/bin/env node
/** `iw` / `indx-watch` entry point. */
import { main } from './cli.js';
import { COMMANDS } from './commands/index.js';
import { VERSION } from './version.js';

void main(COMMANDS, process.argv.slice(2), VERSION);
