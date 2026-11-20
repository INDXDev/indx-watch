/** In-memory state of the mock API and the read models derived from it (dev only). */
import type { RunDetail, TestCaseDetail } from '@indx-watch/server';
import * as D from './data';

export type Run = RunDetail['record'];
type TestCaseData = (typeof D.testCases)[number];

/** The fixtures a test case references, narrowed to the rows it uses. */
function fixtureRefs(data: TestCaseData): TestCaseDetail['fixtures'] {
  return (data.fixtures ?? []).map((f) => {
    const fx = D.fixtures.find((x) => x.key === f.ref)!;
    const vals = D.fixtureValues[f.ref];
    const values = f.rows ? vals?.filter((v) => f.rows?.includes(v.code ?? '')) : vals;
    const { title, kind } = fx.data;
    return { key: fx.key, title, kind, version: fx.version, rows: f.rows, values };
  });
}

/** Fresh mutable state seeded from the shop sample, with helpers that read it. */
export function createState() {
  const runs: Run[] = [...D.runs];
  const decisions = { ...D.decisions };
  const tcStatus = { ...D.tcStatus };

  const decision = (r: Run): RunDetail['decision'] =>
    decisions[r.id] ?? { verdict: 'pass', rule: 8, reason: 'every judgement passed' };
  const summary = (r: Run) => ({
    id: r.id,
    testCase: r.test_case.key,
    version: r.test_case.version,
    verdict: decision(r).verdict,
    rule: decision(r).rule,
    stale: r.test_case.version !== D.tcv(Number(r.test_case.key.slice(3))),
    actor: r.actor,
    source: r.source,
    release: r.release,
    environment: r.environment,
    commit: r.build.commit,
    at: r.ended_at,
    evidence: r.evidence.length,
  });
  const ordered = () => [...runs].sort((a, b) => b.ended_at.localeCompare(a.ended_at));
  const testCase = (key: string): TestCaseDetail | undefined => {
    const n = Number(key.slice(3));
    const data = D.testCases.find((x) => x.key === key);
    if (!data) return undefined;
    const mine = ordered().filter((r) => r.test_case.key === key);
    const status = { key, status: tcStatus[key] as 'pass', stale: tcStatus[key] === 'stale' };
    return {
      key,
      file: `specs/…/${D.UC_OF[n]}/${key}.toml`,
      version: D.tcv(n),
      priority: D.PRIO[D.UC_OF[n]!]!,
      useCase: D.UC_OF[n]!,
      data,
      fixtures: fixtureRefs(data),
      status: { ...status, waived: false, hasEvidence: true, latestRun: mine[0]?.id },
      runs: mine.map(summary),
    };
  };
  return { runs, decisions, tcStatus, decision, summary, ordered, testCase };
}

/** The mock's state; handlers receive it explicitly. */
export type MockState = ReturnType<typeof createState>;
