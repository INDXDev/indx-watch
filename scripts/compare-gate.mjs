// Demo smoke test: compare the hosted demo's gate (GET /api/status) with `iw status --json` on the sample.
// Fails when the demo has more untested cases (sample records missing); other differences only warn.
import { readFileSync } from 'node:fs';

const [localFile, demoFile] = process.argv.slice(2);
const local = JSON.parse(readFileSync(localFile, 'utf8')).data.gate.checks;
const demo = JSON.parse(readFileSync(demoFile, 'utf8')).gate.checks;
const lines = (checks) => checks.map((x) => `${x.key} ${x.actual}`).join('\n');
const untested = (checks) => Number.parseInt(checks.find((x) => x.key === 'max_untested')?.actual ?? 'NaN', 10);

console.log(lines(demo));
if (!(untested(demo) <= untested(local))) {
  console.log(`::error::the demo has more untested cases than the sample; sample gate:\n${lines(local)}`);
  process.exit(1);
}
if (lines(demo) !== lines(local)) console.log(`::warning::the demo's gate differs from the sample's:\n${lines(local)}`);
