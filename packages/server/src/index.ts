/**
 * Server package entry (runtime-neutral). CONTRACT: signatures frozen; implementation T-107.
 * createApp(deps: AppDeps): the Hono app used by both `iw serve` (Node) and the Worker.
 * renderReport(data: ReportData, opts: RenderOptions): Markdown or a single self-contained HTML file
 * (docs/spec/reports.md); attach `texts` from reportTexts(model, locale) for localized titles and AC texts.
 */
export {
  createApp,
  declaredTester,
  errorResponse,
  HttpError,
  resolveRelease,
  type ServerDeps,
} from './app.js';
export * from './contract.js';
export { claimsMismatch, githubOidcSigning, pinnedRepositories } from './oidc.js';
export { type ReportTexts, renderReport, reportTexts } from './report.js';
export * from './tools.js';
export {
  memoryBundleFs,
  prepareUpload,
  type UploadFile,
  type UploadInput,
  type UploadResult,
} from './upload.js';
