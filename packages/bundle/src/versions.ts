/**
 * Content-hash versions (docs/spec/concepts.md#versions-and-staleness, ADR 0006).
 * CONTRACT: signatures frozen; implementation T-101.
 */
import { z } from 'zod';
import { shortHash } from './hash.js';
import {
  FIXTURE_VERSION_EXCLUDED,
  Fixture,
  type Fixture as FixtureT,
  Step,
  TEST_CASE_VERSION_FIELDS,
  TestCase,
  type TestCase as TestCaseT,
  type UseCase,
  UseCase as UseCaseSchema,
} from './schema/definitions.js';
import { canonicalBody, formatBody } from './toml.js';
import type { FixtureDataFile } from './types.js';

const VersionTable = z.strictObject({
  covers: TestCase.shape.covers,
  criteria: z.array(z.string()).optional(),
  mode: TestCase.shape.mode,
  preconditions: TestCase.shape.preconditions,
  fixtures: TestCase.shape.fixtures,
  steps: z.array(Step.omit({ i18n: true })),
  judges: TestCase.shape.judges,
  decision_policy: TestCase.shape.decision_policy,
});

/**
 * 'tcv:' + 12 hex over canonicalBody of TEST_CASE_VERSION_FIELDS (steps without i18n) plus
 * `criteria` = texts of the covered criteria in `covers` order (docs/spec/concepts.md#versions-and-staleness).
 */
export async function testCaseVersion(
  tc: TestCaseT,
  criterionText: ReadonlyMap<string, string>,
): Promise<string> {
  const table: Record<string, unknown> = Object.fromEntries(TEST_CASE_VERSION_FIELDS.map((k) => [k, tc[k]]));
  table.criteria = tc.covers.flatMap((k) => criterionText.get(k) ?? []);
  table.steps = tc.steps.map(({ i18n: _, ...s }) => s);
  return `tcv:${await shortHash(formatBody(VersionTable, table, true))}`;
}

/** Excluded from the fixture hash; approved_version is excluded too (docs win over the frozen constant). */
const FX_EXCLUDED = new Set<string>([...FIXTURE_VERSION_EXCLUDED, 'approved_version']);

/** 'fxv:' + 12 hex over canonicalBody(fixture minus FIXTURE_VERSION_EXCLUDED) + '\n' + sorted '<name> <content sha256>' lines (pointer → pointer.sha256). */
export async function fixtureVersion(fx: FixtureT, files: FixtureDataFile[]): Promise<string> {
  const rest = Object.fromEntries(Object.entries(fx).filter(([k]) => !FX_EXCLUDED.has(k)));
  const lines = files.map((f) => `${f.name} ${f.pointer?.sha256 ?? f.sha256}\n`);
  lines.sort();
  return `fxv:${await shortHash(`${formatBody(Fixture, rest, true)}\n${lines.join('')}`)}`;
}

/** 12 hex over the canonical source fields a translation table translates (docs/spec/i18n.md). */
export async function translationSourceHash(
  source: Record<string, unknown>,
  fields: readonly string[],
): Promise<string> {
  const picked: Record<string, unknown> = {};
  for (const f of fields) if (source[f] !== undefined) picked[f] = source[f];
  return shortHash(canonicalBody(picked));
}

/** Translatable fields per entity (docs/spec/i18n.md#content-translations), in source-hash order. */
export const TRANSLATABLE_FIELDS = {
  feature: ['title', 'description'],
  'use-case': ['title', 'actor', 'goal'],
  criterion: ['text'],
  'test-case': ['title', 'preconditions'],
  step: ['instruction', 'expected'],
  fixture: ['title'],
  environment: ['title', 'guide'],
  release: ['title'],
  plan: ['title'],
} as const;

/**
 * Use case content hash used as approved_version: 'ucv:' + 12 hex over the use case without the same
 * cosmetic/lifecycle fields as a fixture; criteria keep only id, key and text.
 */
export async function useCaseVersion(uc: UseCase): Promise<string> {
  const rest: Record<string, unknown> = Object.fromEntries(
    Object.entries(uc).filter(([k]) => !FX_EXCLUDED.has(k)),
  );
  rest.criteria = uc.criteria.flatMap(({ id, key, text, status }) =>
    status === 'retired' ? [] : [{ id, key, text }],
  );
  return `ucv:${await shortHash(formatBody(UseCaseSchema, rest, true))}`;
}
