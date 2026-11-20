/**
 * INDX Watch reporter for Playwright (docs/spec/integrations.md#playwright-reporter), exported as `indx-watch/playwright`.
 * One run per (test case, Playwright project, fixture rows) per invocation; verdicts come from core.decide via buildModel.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { AnyRecord, Bundle, Evidence, RunRecord } from '@indx-watch/bundle';
import { encodeRecord, loadBundle, newId, sha256Hex } from '@indx-watch/bundle';
import { findBundleDir, nodeFs } from '@indx-watch/bundle/node';
import { buildModel, type Model, type TestCaseNode } from '@indx-watch/core';
import { createResultStore, type LocalReplica } from '@indx-watch/store';
import { openObjectStore, openReplica, processContext, processIdentity } from '@indx-watch/store/node';
import { pointerBlobs, syncOnce } from '@indx-watch/sync';
import { fileStateStore, writerId } from '@indx-watch/sync/node';
import type { FullConfig, FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import * as M from './map.js';

export interface IndxWatchReporterOptions {
  /** bundle directory (default: discovered from the Playwright config's directory, or IW_DIR) */
  dir?: string;
  /** default: IW_RELEASE → release resolution */
  release?: string;
  /** default: IW_ENV → project.default_environment */
  environment?: string;
  evidence?: 'all' | 'failures' | 'none';
  /** fail the Playwright run on unlinked tests, unknown keys and failed pushes */
  strict?: boolean;
  /** push after the run (default: when a store is configured) */
  sync?: boolean;
  dryRun?: boolean;
  /** 'always' keeps traces and videos of test cases that use an account fixture or run in an environment with secrets */
  traces?: 'auto' | 'always';
}

type Ctx = Pick<RunRecord, 'actor' | 'build' | 'ci' | 'release' | 'environment'> & { group: string };
interface Group {
  tc: TestCaseNode;
  project: string;
  rows: Map<string, string[]>;
  tests: Seen[];
}
interface Seen {
  test: TestCase;
  tcs: TestCaseNode[];
  pending: Promise<Evidence | null>[];
  /** attachment (name + path) → step number, from step.attachments where Playwright provides them */
  stepOf: Map<string, number>;
}

const PREFIX = '[indx-watch]';
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const log = (msg: string) => console.log(`${PREFIX} ${msg}`);
const warn = (msg: string) => {
  console.warn(`${PREFIX} ${msg}`);
  return null;
};
const read = (a: TestResult['attachments'][number]) => {
  try {
    return a.body ?? (a.path ? readFileSync(a.path) : undefined);
  } catch {}
};
const sourceKey = (t: TestCase) => t.titlePath().filter(Boolean).join(' › ');

export default class IndxWatchReporter implements Reporter {
  private readonly opts: IndxWatchReporterOptions;
  private readonly env = process.env;
  private bundle: Bundle | null = null;
  private model: Model | null = null;
  private dir = '';
  private root = '';
  private replica: LocalReplica | null = null;
  private redact = M.redactor([]);
  /** the run's environment has secret values set in this process (traces and videos could hold them) */
  private envSecrets = false;
  private readonly seen = new Map<string, Seen>();
  private readonly unlinked = new Set<string>();
  private readonly unknown = new Set<string>();
  private failed = false;
  private ready: Promise<void> = Promise.resolve();
  private readonly queue: Promise<void>[] = [];

  constructor(options: IndxWatchReporterOptions = {}) {
    this.opts = { evidence: 'all', traces: 'auto', ...options };
  }

  printsToStdio(): boolean {
    return false;
  }

  /** Playwright does not await onBegin: loading finishes in the background and onTestEnd/onEnd wait for it. */
  onBegin(config: FullConfig): void {
    this.ready = this.load(config).catch((e) => this.fail(`cannot load the bundle: ${(e as Error).message}`));
  }

  private async load(config: FullConfig): Promise<void> {
    const base = config.configFile ? dirname(config.configFile) : config.rootDir;
    const dir = this.opts.dir ? resolve(base, this.opts.dir) : findBundleDir(base, this.env);
    const loaded = dir ? await loadBundle(nodeFs(dir)) : null;
    if (!dir || !loaded?.bundle)
      return this.fail(dir ? `cannot load ${dir}: ${loaded?.problems[0]?.message}` : 'no .indx-watch/ found');
    this.dir = dir;
    this.bundle = loaded.bundle;
    this.model = buildModel(loaded.bundle, []).model;
    this.redact = M.redactor(M.secretValues(loaded.bundle, this.env));
    const env = loaded.bundle.environments.find((e) => e.data.name === this.environment(loaded.bundle!));
    this.envSecrets = !!env && M.resolveRefs(M.environmentRefs(env), this.env).length > 0;
    this.root = gitRoot(base) ?? base;
    if (!this.opts.dryRun) this.replica = openReplica(dir);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const policy = this.opts.evidence;
    const keep = policy === 'all' || (policy === 'failures' && result.status !== test.expectedStatus);
    // Read attachments now: Playwright may delete its output directory before the run ends.
    const files = result.attachments.map((a) => (keep ? read(a) : undefined));
    this.queue.push(this.ready.then(() => this.collect(test, result, files)));
  }

  private collect(test: TestCase, result: TestResult, files: (Uint8Array | undefined)[]): void {
    const seen = this.model && (this.seen.get(test.id) ?? this.mapTest(test));
    if (!seen) return;
    const secret =
      this.envSecrets ||
      seen.tcs.some((tc) =>
        tc.data.fixtures?.some((f) => this.model?.fixtures.get(f.ref)?.data.kind === 'account'),
      );
    for (const [n, step] of M.numberedSteps(result.steps))
      for (const a of step.attachments ?? []) seen.stepOf.set(`${a.name}\0${a.path}`, n);
    result.attachments.forEach((a, i) => {
      const kind = M.evidenceKind(a.name, a.contentType);
      let data = files[i];
      if (!data || (secret && (kind === 'trace' || kind === 'video') && this.opts.traces !== 'always'))
        return;
      if (M.isText(a.contentType))
        data = new TextEncoder().encode(this.redact(new TextDecoder().decode(data), 1e9));
      const name = this.redact(a.path ? a.path.split(/[\\/]/).at(-1)! : a.name, 200);
      const step = seen.stepOf.get(`${a.name}\0${a.path}`);
      const bytes = data;
      const put = this.replica ? this.replica.putBlob(bytes, a.contentType) : sha256Hex(bytes);
      seen.pending.push(
        put.then(
          (sha256): Evidence => ({ sha256, name, media_type: a.contentType, size: bytes.length, kind, step }),
          (e) => warn(`could not store ${name}: ${(e as Error).message}`),
        ),
      );
    });
  }

  async onEnd(_result: FullResult): Promise<{ status?: FullResult['status'] } | undefined> {
    try {
      await this.ready;
      await Promise.all(this.queue);
      if (this.bundle && this.model) await this.record(this.bundle, this.model);
    } catch (e) {
      this.fail(`recording failed: ${(e as Error).message}`);
    }
    return this.failed && this.opts.strict ? { status: 'failed' } : undefined;
  }

  private mapTest(test: TestCase): Seen | null {
    const model = this.model!;
    const tags = [...(test.tags ?? []), ...(test.title.match(/@[^\s@]+/g) ?? [])];
    const { tcs, unknown } = M.mapTags(model, tags);
    for (const tag of unknown) this.unknown.add(`${tag} (${sourceKey(test)})`);
    if (!tcs.length) {
      if (!unknown.length) this.unlinked.add(sourceKey(test));
      return null;
    }
    const seen: Seen = { test, tcs, pending: [], stepOf: new Map() };
    this.seen.set(test.id, seen);
    return seen;
  }

  private async record(bundle: Bundle, model: Model): Promise<void> {
    const [actor, build, ci] = await Promise.all([
      processIdentity({ env: this.env, cwd: this.dir }).current(),
      processContext({ env: this.env, cwd: this.dir }).build(),
      processContext({ env: this.env, cwd: this.dir }).ci(),
    ]);
    const explicit = this.opts.release ?? this.env.IW_RELEASE;
    const rel = M.resolveRelease(bundle, build, { explicit, inCi: !!ci || !!this.env.CI });
    if (rel.warning) warn(rel.warning);
    const environment = this.environment(bundle);
    const ctx: Ctx = { actor, build, ci, release: rel.release, environment, group: M.runGroup(this.env) };

    const groups = new Map<string, Group>();
    for (const s of this.seen.values()) {
      if (!s.test.results.length) continue;
      const project = s.test.titlePath()[1] ?? '';
      const rows = M.annotatedRows([
        ...s.test.annotations,
        ...s.test.results.flatMap((r) => r.annotations ?? []),
      ]);
      for (const tc of s.tcs) {
        const key = JSON.stringify([tc.data.key, project, [...rows].sort()]);
        const g = groups.get(key) ?? { tc, project, rows, tests: [] };
        g.tests.push(s);
        groups.set(key, g);
      }
    }
    const records: AnyRecord[] = [];
    for (const g of groups.values()) records.push(await this.run(model, g, ctx));
    const verdicts = buildModel(bundle, records).model.runs;
    const lines = (records as RunRecord[]).map(
      (r) =>
        `${r.test_case.key}${r.automation?.project ? ` [${r.automation.project}]` : ''} ${verdicts.get(r.id)?.decision.verdict}`,
    );
    if (this.opts.dryRun) for (const r of records) log(`would record ${encodeRecord(r)}`);
    else for (const r of records) await this.replica!.putRecord(r);
    const where = this.opts.dryRun
      ? '(dry run, nothing written)'
      : `to ${relative(process.cwd(), join(this.dir, 'runs')) || '.'}`;
    log(`${records.length} run(s) ${where}${lines.length ? `: ${lines.join(', ')}` : ''}`);
    if (this.unlinked.size)
      warn(`${this.unlinked.size} unlinked test(s):\n  ${[...this.unlinked].join('\n  ')}`);
    if (this.unknown.size) warn(`unknown test case keys:\n  ${[...this.unknown].join('\n  ')}`);
    if (this.unlinked.size || this.unknown.size) this.failed = true;
    if (!this.opts.dryRun && this.opts.sync !== false) await this.push(bundle, actor);
  }

  private async run(model: Model, g: Group, ctx: Ctx): Promise<AnyRecord> {
    const judgements: RunRecord['judgements'] = [];
    const steps = new Map<number, RunRecord['steps'][number]>();
    const evidence = new Map<string, Evidence>();
    let start = Number.POSITIVE_INFINITY;
    let end = 0;
    let interrupted = false;
    for (const s of g.tests) {
      for (const e of await Promise.all(s.pending))
        if (e && !evidence.has(e.sha256)) evidence.set(e.sha256, e);
      for (const r of s.test.results) {
        start = Math.min(start, r.startTime.getTime());
        end = Math.max(end, r.startTime.getTime() + r.duration);
      }
      const last = s.test.results.at(-1)!;
      const outcome = s.test.outcome();
      interrupted ||= last.status === 'interrupted';
      if (outcome === 'skipped' || last.status === 'interrupted') continue;
      const error = last.errors?.[0]?.message ?? last.error?.message;
      judgements.push({
        id: newId('jdg'),
        kind: 'assert',
        verdict: outcome === 'unexpected' ? 'fail' : 'pass',
        ...(outcome === 'unexpected' && error ? { reason: this.redact(error) } : {}),
        test: this.redact(s.test.titlePath().slice(2).join(' › '), 500),
        ...(outcome === 'flaky' ? { flaky: true } : {}),
      });
      for (const [n, st] of M.numberedSteps(last.steps)) {
        if (n > g.tc.data.steps.length || steps.get(n)?.status === 'fail') continue;
        const note = st.error?.message ? this.redact(st.error.message.split('\n')[0]!, 500) : undefined;
        steps.set(n, { index: n, status: st.error ? 'fail' : 'pass', note });
      }
    }
    const allSkipped = g.tests.every((s) => s.test.outcome() === 'skipped');
    const fixtureKeys = new Set([...(g.tc.data.fixtures ?? []).map((f) => f.ref), ...g.rows.keys()]);
    const fixtures = [...fixtureKeys].flatMap((key) => {
      const fx = model.fixtures.get(key);
      if (!fx) return [];
      const rows = g.rows.get(key) ?? g.tc.data.fixtures?.find((f) => f.ref === key)?.rows;
      return [{ id: fx.data.id, key, version: fx.version, ...(rows?.length ? { rows } : {}) }];
    });
    const file = g.tests[0]!.test.location.file;
    const shas = (n: number) => {
      const list = [...evidence.values()].filter((e) => e.step === n).map((e) => e.sha256);
      return list.length ? list : undefined;
    };
    const raw = {
      kind: 'run',
      id: newId('run'),
      v: 1,
      project: model.project.id,
      at: iso(Date.now()),
      actor: ctx.actor,
      source: 'playwright',
      test_case: { id: g.tc.data.id, key: g.tc.data.key, version: g.tc.version },
      fixtures,
      release: ctx.release,
      environment: ctx.environment,
      build: ctx.build,
      ci: ctx.ci,
      started_at: Number.isFinite(start) ? iso(start) : undefined,
      ended_at: iso(end || Date.now()),
      reported: interrupted ? 'blocked' : allSkipped ? 'skipped' : null,
      steps: [...steps.values()]
        .sort((a, b) => a.index - b.index)
        .map((st) => ({ ...st, evidence: shas(st.index) })),
      evidence: [...evidence.values()],
      judgements,
      automation: {
        framework: 'playwright',
        ...(g.project ? { project: g.project } : {}),
        group: ctx.group,
        file: relative(this.root, file).split(sep).join('/'),
      },
    };
    return JSON.parse(encodeRecord(raw)) as AnyRecord; // validated, canonical key order
  }

  private async push(bundle: Bundle, actor: RunRecord['actor']): Promise<void> {
    const p = bundle.project.data;
    const url = this.env.IW_STORE ?? p.store?.url;
    if (!url) return;
    try {
      const store = createResultStore(
        openObjectStore({ ...p.store, url }, { bundleDir: this.dir, env: this.env }),
      );
      const res = await syncOnce({
        replica: this.replica!,
        store,
        state: await fileStateStore(this.dir, store.objects.url),
        projectId: p.id,
        writer: await writerId(this.dir),
        direction: 'push',
        extraBlobs: pointerBlobs(bundle),
      });
      log(
        `pushed ${res.pushed.records} record(s), ${res.pushed.blobs} blob(s) to ${store.objects.url} as ${actor.id}`,
      );
      for (const w of res.warnings ?? []) warn(w);
    } catch (e) {
      this.fail(`push failed (run \`iw sync\` later): ${(e as Error).message}`);
    }
  }

  private environment(bundle: Bundle): string | undefined {
    return this.opts.environment ?? this.env.IW_ENV ?? bundle.project.data.default_environment;
  }

  private fail(msg: string) {
    this.failed = true;
    warn(msg);
  }
}

/** Repository root (the directory holding .git) above the Playwright config; automation.file is relative to it. */
function gitRoot(from: string): string | undefined {
  for (let d = from; ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) return d;
    if (dirname(d) === d) return undefined;
  }
}
