import type { ObjectStore } from '../ports.js';
export interface S3Options {
  bucket: string;
  prefix?: string;
  endpoint?: string;
  region?: string;
  forcePathStyle?: boolean;
  credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
}
/** S3-compatible ObjectStore over aws4fetch (S3, R2, MinIO, GCS interop). CONTRACT; implementation T-104. */
export function s3ObjectStore(opts: S3Options): ObjectStore {
  void opts;
  throw new Error('not implemented (T-104)');
}
