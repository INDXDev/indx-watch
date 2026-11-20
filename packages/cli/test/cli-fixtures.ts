/** Shared setup for the CLI integration tests (cli-*.test.ts) on a temp copy of examples/shop. */
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderReport } from '@indx-watch/server';

/** The shop test case TC-3, relative to .indx-watch/. */
export const TC3 = 'specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-3-valid-coupon.toml';

/** Read a file of the bundle in `dir`. */
export const read = (dir: string, f: string) => readFileSync(join(dir, '.indx-watch', f), 'utf8');

/** The local record files written under .indx-watch/runs/records. */
export const records = (dir: string) => {
  const root = join(dir, '.indx-watch/runs/records');
  return existsSync(root)
    ? readdirSync(root, { recursive: true }).filter((f) => String(f).endsWith('.json'))
    : [];
};

/** renderReport / startNodeServer are implemented in packages/server (T-107) in parallel. */
export const serverReady = await renderReport({} as never, {
  format: 'md',
  locale: 'en',
  evidence: 'none',
}).then(
  () => true,
  (e: Error) => !/not implemented/.test(e.message),
);

/** Agent env for the worked examples. */
export const AGENT = { IW_ACTOR_KIND: 'agent', IW_AGENT_MODEL: 'claude-opus-5-5' };

const FAKE_MESSAGES_API = (log: string) => `const http = require('node:http'), fs = require('node:fs');
        http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
          fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ url: req.url, auth: req.headers.authorization, body: JSON.parse(b) }) + '\\n');
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: JSON.parse(b).model,
            content: [{ type: 'text', text: '{"verdict":"fail","confidence":0.9,"reason":"The total did not change."}' }],
            stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
        }); }).listen(0, '127.0.0.1', function () { console.log(this.address().port); });`;

/**
 * A Messages API stand-in in its own process (spawnSync in the tests blocks this one).
 * It logs each request to `log` and always answers with a confident llm fail.
 */
export async function fakeMessagesApi(log: string): Promise<{ server: ChildProcess; port: string }> {
  const server = spawn(process.execPath, ['-e', FAKE_MESSAGES_API(log)], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  try {
    const port = await new Promise<string>((ok, fail) => {
      server.stdout!.once('data', (d) => ok(String(d).trim()));
      server.once('exit', (code) => fail(new Error(`fake Messages API exited (${code})`)));
    });
    return { server, port };
  } catch (e) {
    server.kill();
    throw e;
  }
}
