import type { memFs } from './helpers.js';

/** Shared paths and helpers of the check tests (check, check-secrets, check-fix). */
export const TC3 = 'specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-3-valid-coupon.toml';
export const TC9 = 'specs/FEAT-3-account/UC-5-customer-adds-review-photo/TC-9-upload-review-photo.toml';
export const UC2 = 'specs/FEAT-2-checkout/UC-2-guest-applies-coupon/use-case.toml';

/** The codes of the problems of one severity. */
export const codes = (r: { problems: { code: string; severity: string }[] }, sev = 'error') =>
  r.problems.filter((p) => p.severity === sev).map((p) => p.code);

/** Rewrite one text file of a memFs bundle. */
export const edit = (fs: ReturnType<typeof memFs>, path: string, f: (t: string) => string) =>
  fs.files.set(path, new TextEncoder().encode(f(fs.text(path)!)));
