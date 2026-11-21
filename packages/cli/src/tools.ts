/** The MCP tools' output schemas: the `data` of the matching command (docs/spec/agents.md#mcp-server). */
import type { ToolOutputs } from '@indx-watch/server';
import { CommandData as D } from './json.js';

export const TOOL_OUTPUTS: ToolOutputs = {
  ...{ status: D.status, list: D.list, show: D.show, check: D.check, new: D.new },
  ...{ record_run: D.record, sync: D.sync },
};
