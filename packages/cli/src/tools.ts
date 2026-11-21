/** The MCP tools' output schemas: the `data` of the matching command (docs/spec/agents.md#mcp-server). */
import { TOOL_OUTPUTS } from '@indx-watch/server';
import { CommandData as D } from './json.js';

Object.assign(TOOL_OUTPUTS, { status: D.status, list: D.list, show: D.show, check: D.check, new: D.new });
Object.assign(TOOL_OUTPUTS, { record_run: D.record, sync: D.sync });
