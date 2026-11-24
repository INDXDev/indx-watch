/**
 * In-memory shape of a loaded bundle and the file-system port it is loaded through.
 * FROZEN CONTRACT for v0.1.
 */
import type {
  BlobPointer,
  Environment,
  Feature,
  Fixture,
  Plan,
  Project,
  Release,
  TestCase,
  UseCase,
} from './schema/definitions.js';

/** File access relative to the bundle root ('.indx-watch/'). Paths use '/'. */
export interface BundleFs {
  /** Bytes of a file, or null when it does not exist. */
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, data: Uint8Array | string): Promise<void>;
  /** Direct children of a directory; [] when it does not exist. */
  list(dir: string): Promise<{ name: string; dir: boolean }[]>;
  remove(path: string): Promise<void>;
}

export interface Problem {
  severity: 'error' | 'warning';
  /** kebab-case code, e.g. 'unknown-key', 'duplicate-key', 'secret', 'non-canonical', 'unresolved-ref' */
  code: string;
  /** path relative to the bundle root */
  file?: string;
  /** dotted path inside the file, e.g. 'steps[0].expected' */
  path?: string;
  message: string;
}

export interface Loaded<T> {
  /** path relative to the bundle root */
  file: string;
  data: T;
}

export interface FixtureDataFile {
  /** logical name as listed in fixture.files (without .blob.toml) */
  name: string;
  /** path relative to the bundle root of the data file or its pointer */
  file: string;
  sha256: string;
  size: number;
  /** present when the file is stored as a *.blob.toml pointer */
  pointer?: BlobPointer;
}

export interface LoadedUseCase extends Loaded<UseCase> {
  /** key of the feature directory it lives in */
  feature: string;
}
export interface LoadedTestCase extends Loaded<TestCase> {
  /** key of the use case directory it lives in */
  useCase: string;
  /** computed 'tcv:<12 hex>' */
  version: string;
}
export interface LoadedFixture extends Loaded<Fixture> {
  dataFiles: FixtureDataFile[];
  /** computed 'fxv:<12 hex>' */
  version: string;
}
export interface LoadedTemplate {
  file: string;
  kind: 'test-case' | 'use-case' | 'fixture';
  name: string;
  data: Record<string, unknown>;
}

export interface Bundle {
  project: Loaded<Project>;
  environments: Loaded<Environment>[];
  releases: Loaded<Release>[];
  features: Loaded<Feature>[];
  useCases: LoadedUseCase[];
  testCases: LoadedTestCase[];
  fixtures: LoadedFixture[];
  plans: Loaded<Plan>[];
  templates: LoadedTemplate[];
  /** files present but not part of the format (warnings) */
  unknownFiles: string[];
  /** files with a load error (left out of the bundle, or loaded with an error); the gate fails while any */
  invalidFiles?: string[];
}
