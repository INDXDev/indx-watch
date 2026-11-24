/** Command dispatch with citty: flags, the --json envelope, human output and exit codes (docs/spec/cli.md). */
import { stripVTControlCharacters } from 'node:util';
import { BundleError, type Problem } from '@indx-watch/bundle';
import { StoreError } from '@indx-watch/store';
import { type ArgsDef, type CommandDef, defineCommand, renderUsage, runCommand } from 'citty';
import { DeployError } from './deploy/index.js';
import { ErrorCode, EXIT_CODES } from './json.js';
import { type Args, B, CliError, type Ctx, many, type Out, S } from './util.js';

export interface Spec {
  description: string;
  args?: ArgsDef;
  /** flags that may be given more than once (collected into arrays) */
  repeat?: string[];
  run(ctx: Ctx, a: Args): Promise<Out>;
}

const GLOBAL: ArgsDef = {
  json: B('Print one JSON envelope to stdout'),
  dir: S('Bundle directory (default: find .indx-watch/ upwards; IW_DIR)'),
  yes: B('Never prompt (iw never prompts without a TTY either)'),
};
const GROUPS: Record<string, string> = {
  baseline: 'Visual baselines (approve)',
  deployment: 'Record deployments (add)',
  fixture: 'Fixture data files (add, fetch)',
  skills: 'Agent skills (install)',
};
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Unknown flags are usage errors (exit 2); repeatable flags become arrays. */
function preparse(raw: string[], args: ArgsDef, repeat: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = Object.fromEntries(repeat.map((r) => [r, []]));
  for (let i = 0; i < raw.length && raw[i] !== '--'; i++) {
    const t = raw[i]!;
    if (!t.startsWith('-') || t === '-') continue;
    const [flag = '', inline] = t.replace(/^--?/, '').split(/=(.*)/s, 2);
    const name = Object.keys(args).find((k) => k === flag || kebab(k) === flag || `no-${k}` === flag);
    if (!name && flag !== 'help' && flag !== 'h')
      throw new CliError('USAGE', `Unknown flag ${t.split('=')[0]}`);
    if (!name || !['string', 'enum'].includes(args[name]!.type ?? '')) continue;
    const value = inline ?? raw[++i];
    if (value === undefined) throw new CliError('USAGE', `Missing value for --${flag}`);
    out[name]?.push(value);
  }
  return out;
}

export function toError(e: unknown): CliError {
  const err = e as Error & { code?: string; details?: unknown[] };
  if (e instanceof CliError) return e;
  if (e instanceof StoreError) return new CliError('STORE_ERROR', err.message);
  if (e instanceof DeployError) return new CliError(err.code as ErrorCode, err.message);
  const code = ErrorCode.safeParse(err?.code);
  if (e instanceof BundleError) return new CliError(code.data ?? 'INVALID_INPUT', err.message, err.details);
  if (err?.name === 'CLIError') return new CliError('USAGE', stripVTControlCharacters(err.message));
  // a file or folder the user named that is missing or unusable: no stack (docs/spec/cli.md#exit-codes)
  if (err?.code === 'ENOENT') return new CliError('NOT_FOUND', err.message);
  if (/^(EACCES|EPERM|EISDIR|ENOTDIR)$/.test(err?.code ?? ''))
    return new CliError('INVALID_INPUT', err.message);
  return new CliError('INTERNAL', err?.stack ?? String(e));
}

export const problemLine = (p: unknown) => {
  const x = p as { severity?: string; file?: string; path?: string; code?: string; message?: string };
  const where = [x?.file, x?.path].filter(Boolean).join(' ');
  return x?.message
    ? `${where}${where ? ': ' : ''}${x.severity ?? ''} ${x.code ?? ''} ${x.message}`
    : String(p);
};

/** Warnings without repeats (a command may open the project twice). */
export const unique = (ws: Problem[]) => [...new Map(ws.map((w) => [JSON.stringify(w), w])).values()];

const write = (s: string) => process.stdout.write(s.endsWith('\n') ? s : `${s}\n`);
const err = (s: string) => process.stderr.write(`${s}\n`);

/** The --json envelope of a result or an error. */
function envelope(name: string, r: Out | CliError, warnings: Problem[]) {
  if (!(r instanceof CliError)) return { ok: true, command: name, data: r.data, warnings };
  const { code, message, details, data } = r;
  const more = warnings.length ? { warnings } : {};
  return { ok: false, command: name, error: { code, message, details }, data, ...more };
}

/** Text output: the result (or an error's text) on stdout; warnings, the error and its details on stderr. */
function printText(r: Out | CliError, warnings: Problem[]) {
  const failed = r instanceof CliError;
  if (!failed || r.text) write(r.text ?? JSON.stringify(r.data, null, 2));
  for (const w of warnings) err(`warning: ${problemLine(w)}`);
  if (!failed) return;
  err(`error: ${r.message}`);
  if (!r.text) for (const d of r.details ?? []) err(`  ${problemLine(d)}`);
}

/** Print the result: one JSON envelope with --json, text otherwise; set the exit code. `notes`: ctx.notes. */
export function emit(name: string, json: boolean, r: Out | CliError, notes: Problem[] = []): void {
  const warnings = unique([...((r instanceof CliError ? [] : r.warnings) ?? []), ...notes]);
  if (json) write(JSON.stringify(envelope(name, r, warnings)));
  else printText(r, warnings);
  process.exitCode = r instanceof CliError ? EXIT_CODES[r.code] : 0;
}

export function makeCtx(env = process.env as Ctx['env'], cwd = process.cwd()): Ctx {
  const log = (l: string) => void process.stderr.write(`${l}\n`);
  const stdin = async () => {
    if (process.stdin.isTTY) throw new CliError('USAGE', '--from - needs input on stdin');
    let s = '';
    for await (const c of process.stdin) s += c;
    return s;
  };
  return { cwd, env, log, stdin };
}

/** The citty command for one spec. */
function leaf(name: string, spec: Spec, ctx: Ctx): CommandDef {
  const args = { ...spec.args, ...GLOBAL };
  return defineCommand({
    meta: { name, description: spec.description },
    args,
    async run({ args: parsed, rawArgs }) {
      const a: Args = { ...parsed, ...preparse(rawArgs, args, spec.repeat ?? []) };
      // a command without arguments takes no words: `iw sync s3://other` must not sync the configured store
      const extra = Object.values(args).some((d) => d.type === 'positional') ? [] : many(parsed._);
      if (extra.length) return emit(name, !!a.json, new CliError('USAGE', `Unexpected argument ${extra[0]}`));
      const c: Ctx = { ...ctx, notes: [] };
      emit(name, !!a.json, await spec.run(c, a).catch(toError), c.notes);
    },
  });
}

/** The root command: one leaf per spec, specs named "group sub" under their group. */
function commandTree(commands: Record<string, Spec>, version: string) {
  const ctx = makeCtx();
  const tree: Record<string, CommandDef> = {};
  const groups: Record<string, Record<string, CommandDef>> = {};
  for (const [name, spec] of Object.entries(commands)) {
    const [head, sub] = name.split(' ') as [string, string | undefined];
    if (sub) groups[head] = { ...groups[head], [sub]: leaf(name, spec, ctx) };
    else tree[head] = leaf(name, spec, ctx);
  }
  for (const [head, subs] of Object.entries(groups))
    tree[head] = defineCommand({ meta: { name: head, description: GROUPS[head] }, subCommands: subs });
  const description = 'INDX Watch: file-first, agent-native test management';
  return { root: defineCommand({ meta: { name: 'iw', version, description }, subCommands: tree }), groups };
}

/** Usage of the command the words name (the root when none). */
async function printHelp(root: CommandDef, words: string[]) {
  let cmd: CommandDef = root;
  for (const w of words) cmd = (cmd.subCommands as Record<string, CommandDef> | undefined)?.[w] ?? cmd;
  // leaf names are full ("fixture add"), so the root is the parent of every command: "iw fixture add"
  const usage = await renderUsage(cmd, cmd === root ? undefined : root);
  const color = process.stdout.isTTY && !process.env.NO_COLOR;
  process.stdout.write(`${color ? usage : stripVTControlCharacters(usage)}\n`);
}

/** Whether `t` is a global option that takes the next word as its value (`--dir x`, not `--dir=x`). */
const valueOfGlobal = (t = '') => /^--?[^=]+$/.test(t) && GLOBAL[t.replace(/^--?/, '')]?.type === 'string';

/** Run `iw` with argv; sets process.exitCode. */
export async function main(commands: Record<string, Spec>, argv: string[], version: string): Promise<void> {
  const { root, groups } = commandTree(commands, version);
  if (argv[0] === '--version' || argv[0] === '-v') return void console.log(version);
  // words name the command; the value of a global option before it (`--dir x`) is not one
  const words = argv.filter((t, i) => !t.startsWith('-') && !valueOfGlobal(argv[i - 1]));
  if (!words.length || argv.includes('--help') || argv.includes('-h')) return printHelp(root, words);
  const name = groups[words[0]!] ? words.slice(0, 2).join(' ') : words[0]!;
  await runCommand(root, { rawArgs: argv }).catch((e) => emit(name, argv.includes('--json'), toError(e)));
}
