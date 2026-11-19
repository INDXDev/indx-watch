/**
 * Server package entry (runtime-neutral). CONTRACT: signatures frozen; implementation T-107.
 */
import type { ReportData } from '@indx-watch/core';
import type { AppDeps, RenderOptions } from './contract.js';

export * from './contract.js';

/** The Hono app used by both `iw serve` (Node) and the Worker. Returns an object with a fetch handler. */
export function createApp(deps: AppDeps): { fetch(request: Request): Promise<Response> } {
  void deps;
  throw new Error('not implemented (T-107)');
}

/** Render a report (docs/spec/reports.md). Markdown or a single self-contained HTML file. */
export async function renderReport(data: ReportData, opts: RenderOptions): Promise<string> {
  void data;
  void opts;
  throw new Error('not implemented (T-107)');
}
