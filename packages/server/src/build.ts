/** The running build: package version and, for a patched build, the patch-set hash (docs/spec/security.md#patched-servers). */
import PKG from '../package.json' with { type: 'json' };

export const VERSION: string = PKG.version;

/** `iw patch apply` puts the first 8 hex digits of the patch-set SHA-256 in front of worker.js as `globalThis.__IW_PATCHES__` */
export const patchesOf = (): string | undefined =>
  (globalThis as { __IW_PATCHES__?: string }).__IW_PATCHES__ || undefined;

/** `0.1.3`, or `0.1.3+p.ab12cd34` for a patched build */
export const buildVersion = (version: string = PKG.version, patches = patchesOf()) =>
  patches ? `${version}+p.${patches}` : version;

/** "INDX Watch 0.1.3+p.ab12cd34 (patched)"; undefined for an unpatched build */
export const patchedLabel = (version: string = PKG.version, patches = patchesOf()) =>
  patches ? `INDX Watch ${buildVersion(version, patches)} (patched)` : undefined;
