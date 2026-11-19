import { execFile, execFileSync } from 'node:child_process';

type Env = Record<string, string | undefined>;
/** コマンドを実行して stdout を返す。失敗（未インストール・非 0 終了）は null。テストで差し替えられる。 */
export type Exec = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: Env },
) => Promise<string | null>;
export type ExecSync = (cmd: string, args: string[], env?: Env) => string | null;

export const exec: Exec = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const o = { cwd: opts.cwd, env: opts.env as NodeJS.ProcessEnv, timeout: 30_000, windowsHide: true };
    execFile(cmd, args, o, (err, stdout) => resolve(err ? null : stdout.toString()));
  });

export const execSync: ExecSync = (cmd, args, env) => {
  try {
    return execFileSync(cmd, args, {
      env: env as NodeJS.ProcessEnv,
      timeout: 60_000,
      stdio: 'pipe',
    }).toString();
  } catch {
    return null;
  }
};
