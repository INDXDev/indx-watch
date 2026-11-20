/** Command dispatch with citty: flags, the --json envelope, human output and exit codes (docs/spec/cli.md). */
import { stripVTControlCharacters } from 'node:util';
import { BundleError } from '@indx-watch/bundle';
import { StoreError } from '@indx-watch/store';
import { type ArgsDef, type CommandDef, defineCommand, renderUsage, runCommand } from 'citty';
import { DeployError } from './deploy/index.js';
import { ErrorCode, EXIT_CODES } from './json.js';
import { type Args, B, CliError, type Ctx, type Out, S } from './util.js';

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
  return new CliError('INTERNAL', err?.stack ?? String(e));
}

export const problemLine = (p: unknown) => {
  const x = p as { severity?: string; file?: string; path?: string; code?: string; message?: string };
  const where = [x?.file, x?.path].filter(Boolean).join(' ');
  return x?.message
    ? `${where}${where ? ': ' : ''}${x.severity ?? ''} ${x.code ?? ''} ${x.message}`
    : String(p);
};

/** Print the result: one JSON envelope with --json, text otherwise; set the exit code. */
export function emit(name: string, json: boolean, r: Out | CliError): void {
  const write = (s: string) => process.stdout.write(s.endsWith('\n') ? s : `${s}\n`);
  const err = (s: string) => process.stderr.write(`${s}\n`);
  if (r instanceof CliError) {
    const { code, message, details, data } = r;
    if (json) write(JSON.stringify({ ok: false, command: name, error: { code, message, details }, data }));
    else if (r.text) write(r.text);
    if (!json) err(`error: ${message}`);
    if (!json && !r.text) for (const d of details ?? []) err(`  ${problemLine(d)}`);
    process.exitCode = EXIT_CODES[code];
    return;
  }
  const warnings = r.warnings ?? [];
  if (json) write(JSON.stringify({ ok: true, command: name, data: r.data, warnings }));
  else write(r.text ?? JSON.stringify(r.data, null, 2));
  if (!json) for (const w of warnings) err(`warning: ${problemLine(w)}`);
  process.exitCode = 0;
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
      emit(name, !!a.json, await spec.run(ctx, a).catch(toError));
    },
  });
}

/** Run `iw` with argv; sets process.exitCode. */
export async function main(commands: Record<string, Spec>, argv: string[], version: string): Promise<void> {
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
  const root = defineCommand({ meta: { name: 'iw', version, description }, subCommands: tree });
  if (argv[0] === '--version' || argv[0] === '-v') return void console.log(version);
  const words = argv.filter((t) => !t.startsWith('-'));
  if (!words.length || argv.includes('--help') || argv.includes('-h')) {
    let cmd: CommandDef = root;
    for (const w of words) cmd = (cmd.subCommands as Record<string, CommandDef> | undefined)?.[w] ?? cmd;
    // leaf names are full ("fixture add"), so the root is the parent of every command: "iw fixture add"
    const usage = await renderUsage(cmd, cmd === root ? undefined : root);
    const color = process.stdout.isTTY && !process.env.NO_COLOR;
    process.stdout.write(`${color ? usage : stripVTControlCharacters(usage)}\n`);
    return;
  }
  const name = groups[words[0]!] ? words.slice(0, 2).join(' ') : words[0]!;
  await runCommand(root, { rawArgs: argv }).catch((e) => emit(name, argv.includes('--json'), toError(e)));
}
