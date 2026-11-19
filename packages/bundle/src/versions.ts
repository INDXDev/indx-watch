/**
 * Content-hash versions (docs/spec/concepts.md#versions-and-staleness, ADR 0006).
 * CONTRACT: signatures frozen; implementation T-101.
 */
import type { Fixture, TestCase } from './schema/definitions.js';
import type { FixtureDataFile } from './types.js';

/** 'tcv:' + 12 hex over the canonical TOML of TEST_CASE_VERSION_FIELDS. */
export async function testCaseVersion(tc: TestCase): Promise<string> {
  void tc;
  throw new Error('not implemented (T-101)');
}

/** 'fxv:' + 12 hex over the canonical fixture (minus FIXTURE_VERSION_EXCLUDED) and its data file hashes. */
export async function fixtureVersion(fx: Fixture, files: FixtureDataFile[]): Promise<string> {
  void fx;
  void files;
  throw new Error('not implemented (T-101)');
}

/** 12 hex over the canonical source fields a translation table translates (docs/spec/i18n.md). */
export async function translationSourceHash(source: Record<string, unknown>, fields: readonly string[]): Promise<string> {
  void source;
  void fields;
  throw new Error('not implemented (T-101)');
}
