/** Every `iw` command by name ('deployment add' = a subcommand). */
import type { Spec } from '../cli.js';
import { mcpCommand } from '../mcp.js';
import { patchCommands } from '../patch.js';
import { appCommands } from './app.js';
import { dataCommands } from './data.js';
import { resultCommands } from './results.js';
import { shareCommands } from './share.js';
import { specCommands } from './specs.js';

export const COMMANDS: Record<string, Spec> = {
  ...specCommands,
  ...resultCommands,
  ...dataCommands,
  ...shareCommands,
  ...appCommands,
  ...patchCommands,
  mcp: mcpCommand,
};
